import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ilmtStakingFixed - Unbonding Period Tests", function () {
  let stakingToken: any;
  let rewardToken: any;
  let stakingFixed: any;
  let owner: any;
  let user1: any;
  let user2: any;

  const STAKE_AMOUNT = ethers.parseEther("1000");
  const REWARD_RATE = 10; // 10%
  const LOCKUP_PERIOD = 30 * 24 * 60 * 60; // 30 days
  const UNBONDING_PERIOD = 7 * 24 * 60 * 60; // 7 days
  const MAX_STAKING_AMOUNT = ethers.parseEther("10000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Staking Token", "STK", ethers.parseEther("1000000"));
    rewardToken = await MockToken.deploy("Reward Token", "RWD", ethers.parseEther("1000000"));

    await stakingToken.waitForDeployment();
    await rewardToken.waitForDeployment();

    // Deploy Fixed contract
    const StakingFixed = await ethers.getContractFactory("ilmtStakingFixed");
    stakingFixed = await StakingFixed.deploy(await stakingToken.getAddress());
    await stakingFixed.waitForDeployment();
    
    // Set unbonding period to 7 days
    await stakingFixed.setUnbondingPeriod(UNBONDING_PERIOD);

    // Setup
    await stakingToken.transfer(user1.address, ethers.parseEther("20000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("20000"));
    await rewardToken.transfer(await stakingFixed.getAddress(), ethers.parseEther("100000"));

    // Add pool
    await stakingFixed.addPool(await rewardToken.getAddress(), REWARD_RATE, LOCKUP_PERIOD, MAX_STAKING_AMOUNT);

    // Approve
    await stakingToken.connect(user1).approve(await stakingFixed.getAddress(), ethers.MaxUint256);
    await stakingToken.connect(user2).approve(await stakingFixed.getAddress(), ethers.MaxUint256);
  });

  describe("🚀 Normal Staking & Unstaking (after lockup)", function () {
    it("Should allow normal unstake after lockup period", async function () {
      // Stake
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait for lockup
      await time.increase(LOCKUP_PERIOD + 1);
      
      // Normal unstake - no penalty
      const balanceBefore = await stakingToken.balanceOf(user1.address);
      await stakingFixed.connect(user1).unstake(0);
      const balanceAfter = await stakingToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });
  });

  describe("⏰ Early Unstake with Unbonding Period", function () {
    it("Should require unbonding period for early unstake", async function () {
      // Stake
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Try normal unstake before lockup
      await expect(
        stakingFixed.connect(user1).unstake(0)
      ).to.be.revertedWith("Tokens are still locked");
      
      // Early unstake request
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      
      // Check unbonding info
      const unbondingInfo = await stakingFixed.getUnbondingInfo(user1.address, 0);
      expect(unbondingInfo.amount).to.equal(STAKE_AMOUNT);
      expect(unbondingInfo.claimed).to.be.false;
      expect(unbondingInfo.timeLeft).to.be.greaterThan(0);
    });

    it("Should not allow claiming before unbonding period", async function () {
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      
      // Try to claim immediately - should fail
      await expect(
        stakingFixed.connect(user1).claimUnbonding(0)
      ).to.be.revertedWith("Unbonding period not finished");
      
      // Wait partial period - should still fail
      await time.increase(UNBONDING_PERIOD / 2);
      
      await expect(
        stakingFixed.connect(user1).claimUnbonding(0)
      ).to.be.revertedWith("Unbonding period not finished");
    });

    it("Should allow claiming after unbonding period", async function () {
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      
      // Wait full unbonding period
      await time.increase(UNBONDING_PERIOD + 1);
      
      // Check that now can claim
      const unbondingInfo = await stakingFixed.getUnbondingInfo(user1.address, 0);
      expect(unbondingInfo.timeLeft).to.equal(0);
      
      // Claim tokens
      const balanceBefore = await stakingToken.balanceOf(user1.address);
      await stakingFixed.connect(user1).claimUnbonding(0);
      const balanceAfter = await stakingToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
      
      // Check that request is marked as claimed
      const finalUnbondingInfo = await stakingFixed.getUnbondingInfo(user1.address, 0);
      expect(finalUnbondingInfo.claimed).to.be.true;
    });

    it("Should not allow double claiming", async function () {
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      await time.increase(UNBONDING_PERIOD + 1);
      
      // First claiming
      await stakingFixed.connect(user1).claimUnbonding(0);
      
      // Second claiming - should fail
      await expect(
        stakingFixed.connect(user1).claimUnbonding(0)
      ).to.be.revertedWith("Already claimed");
    });
  });

  describe("🔧 Owner Functions", function () {
    it("Should allow owner to change unbonding period", async function () {
      const newPeriod = 14 * 24 * 60 * 60; // 14 days
      
      await expect(stakingFixed.setUnbondingPeriod(newPeriod))
        .to.emit(stakingFixed, "UnbondingPeriodUpdated")
        .withArgs(newPeriod);
      
      expect(await stakingFixed.unbondingPeriod()).to.equal(newPeriod);
    });

    it("Should not allow non-owner to change unbonding period", async function () {
      await expect(
        stakingFixed.connect(user1).setUnbondingPeriod(14 * 24 * 60 * 60)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("📊 Complex Scenarios", function () {
    it("Should handle multiple users with different unbonding requests", async function () {
      // User1 stakes and does early unstake
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      
      // User2 stakes later and also does early unstake
      await time.increase(3 * 24 * 60 * 60); // 3 days
      await stakingFixed.connect(user2).stake(0, STAKE_AMOUNT * 2n);
      await stakingFixed.connect(user2).requestEarlyUnstake(0);
      
      // User1 can claim first (7 days from request)
      await time.increase(4 * 24 * 60 * 60 + 1); // another 4 days + 1 sec
      
      const user1Info = await stakingFixed.getUnbondingInfo(user1.address, 0);
      const user2Info = await stakingFixed.getUnbondingInfo(user2.address, 0);
      
      expect(user1Info.timeLeft).to.equal(0);
      expect(user2Info.timeLeft).to.be.greaterThan(0); // not yet
      
      // User1 claims
      await stakingFixed.connect(user1).claimUnbonding(0);
      
      // User2 needs to wait more
      await time.increase(3 * 24 * 60 * 60); // another 3 days
      
      const user2InfoAfter = await stakingFixed.getUnbondingInfo(user2.address, 0);
      expect(user2InfoAfter.timeLeft).to.equal(0);
      
      await stakingFixed.connect(user2).claimUnbonding(0);
    });

    it("Should not allow multiple early unstake requests", async function () {
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      
      // Try to make another early unstake request
      await expect(
        stakingFixed.connect(user1).requestEarlyUnstake(0)
      ).to.be.revertedWith("No tokens staked");
    });
  });

  describe("⏱️ Time Functions", function () {
    it("Should return correct time until unlock", async function () {
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Check remaining time
      const timeInfo = await stakingFixed.getTimeUntilUnlock(user1.address, 0);
      expect(timeInfo).to.be.greaterThan(LOCKUP_PERIOD - 10); // approximately
      
      // Wait half lockup period
      await time.increase(LOCKUP_PERIOD / 2);
      
      const timeInfoAfter = await stakingFixed.getTimeUntilUnlock(user1.address, 0);
      expect(timeInfoAfter).to.be.lessThan(timeInfo);
      expect(timeInfoAfter).to.be.greaterThan(0);
    });
  });

  describe("🧪 Complete User Journey", function () {
    it("Should handle complete user journey with unbonding", async function () {
      console.log("\n🎯 COMPLETE USER JOURNEY TEST");
      
      // 1. Stake
      await stakingFixed.connect(user1).stake(0, STAKE_AMOUNT);
      
      const stakeInfo = await stakingFixed.getStakeInfo(user1.address, 0);
      expect(stakeInfo.amount).to.equal(STAKE_AMOUNT);
      console.log("1. ✅ Staked successfully");
      
      // 2. Check time until unlock
      const timeInfo = await stakingFixed.getTimeUntilUnlock(user1.address, 0);
      expect(timeInfo).to.be.greaterThan(0);
      
      // 3. Request early unstake
      await stakingFixed.connect(user1).requestEarlyUnstake(0);
      
      const unbondingInfo = await stakingFixed.getUnbondingInfo(user1.address, 0);
      expect(unbondingInfo.amount).to.equal(STAKE_AMOUNT);
      expect(unbondingInfo.claimed).to.be.false;
      expect(unbondingInfo.timeLeft).to.be.greaterThan(0);
      console.log("2. 🚀 Early unstake requested");
      
      // 4. Wait and claim
      await time.increase(UNBONDING_PERIOD + 1);
      
      const balanceBefore = await stakingToken.balanceOf(user1.address);
      await stakingFixed.connect(user1).claimUnbonding(0);
      const balanceAfter = await stakingToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
      console.log("3. 🎉 Successfully claimed from unbonding!");
      
      console.log("\n🏆 COMPLETE JOURNEY SUCCESSFUL!");
    });
  });
}); 