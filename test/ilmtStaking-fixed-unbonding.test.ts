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
  const REWARD_RATE = 1000; // 10% in basis points (1000 bp = 10%)
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

  it("Should prevent setting unbonding period to zero", async function () {
    await expect(stakingFixed.setUnbondingPeriod(0))
      .to.be.revertedWith("Unbonding period must be > 0");
  });
});

describe("Restake Functionality", function () {
  let stakingContract: any;
  let mockToken: any;
  let owner: any;
  let user1: any;
  let user2: any;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    // Deploy mock token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Test Token", "TEST", ethers.parseEther("1000000"));
    
    // Deploy staking contract
    const StakingContract = await ethers.getContractFactory("ilmtStakingFixed");
    stakingContract = await StakingContract.deploy(await mockToken.getAddress());
    
    // Add a pool (30 days lockup, 20% reward rate)
    await stakingContract.addPool(
      await mockToken.getAddress(),
      20, // 20% reward rate
      30 * 24 * 60 * 60, // 30 days lockup
      ethers.parseEther("1000") // 1000 tokens max
    );
    
    // Transfer tokens to users
    await mockToken.transfer(user1.address, ethers.parseEther("500"));
    await mockToken.transfer(user2.address, ethers.parseEther("500"));
    
    // Approve staking contract
    await mockToken.connect(user1).approve(await stakingContract.getAddress(), ethers.parseEther("1000"));
    await mockToken.connect(user2).approve(await stakingContract.getAddress(), ethers.parseEther("1000"));
    
    // Fund contract with reward tokens
    await mockToken.transfer(await stakingContract.getAddress(), ethers.parseEther("10000"));
  });

  it("Should not allow restaking before lockup period ends", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Try to restake immediately (should fail)
    await expect(stakingContract.connect(user1).restake(0, false))
      .to.be.revertedWith("Tokens are still locked");
  });

  it("Should allow restaking after lockup period without rewards", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Check restake info
    const restakeInfo = await stakingContract.getRestakeInfo(user1.address, 0);
    expect(restakeInfo.canRestake).to.be.true;
    expect(restakeInfo.currentStakedAmount).to.equal(ethers.parseEther("100"));
    expect(restakeInfo.rewardTokenSameAsStaking).to.be.true;
    
    // Restake without including rewards
    const tx = await stakingContract.connect(user1).restake(0, false);
    await expect(tx).to.emit(stakingContract, "Restaked")
      .withArgs(user1.address, 0, ethers.parseEther("100"), 0, ethers.parseEther("100"));
    
    // Check that stake was reset
    const stakeInfo = await stakingContract.getStakeInfo(user1.address, 0);
    expect(stakeInfo.amount).to.equal(ethers.parseEther("100"));
    expect(stakeInfo.since).to.be.closeTo(await time.latest(), 2);
  });

  it("Should allow restaking with rewards included (same token)", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Check pending rewards
    const pendingReward = await stakingContract.getPendingReward(user1.address, 0);
    expect(pendingReward).to.be.gt(0);
    
    // Get initial balance
    const initialBalance = await mockToken.balanceOf(user1.address);
    
    // Restake with rewards included
    const tx = await stakingContract.connect(user1).restake(0, true);
    const expectedTotal = ethers.parseEther("100") + pendingReward;
    
    await expect(tx).to.emit(stakingContract, "Restaked");
    
    // Check the event arguments separately for more flexibility
    const receipt = await tx.wait();
    const restakedEvent = receipt.logs.find((log: any) => log.fragment?.name === "Restaked");
    expect(restakedEvent.args[0]).to.equal(user1.address);
    expect(restakedEvent.args[1]).to.equal(0);
    expect(restakedEvent.args[2]).to.equal(ethers.parseEther("100"));
    expect(restakedEvent.args[3]).to.be.gt(0); // Reward amount should be > 0
    expect(restakedEvent.args[4]).to.equal(restakedEvent.args[2] + restakedEvent.args[3]); // Total should equal staked + reward
    
    // Check that total staked amount increased
    const stakeInfo = await stakingContract.getStakeInfo(user1.address, 0);
    expect(stakeInfo.amount).to.be.gt(ethers.parseEther("100")); // Should be more than original stake
    
    // User balance should remain the same (rewards were restaked)
    const finalBalance = await mockToken.balanceOf(user1.address);
    expect(finalBalance).to.equal(initialBalance);
  });

  it("Should claim rewards separately when restaking with different reward token", async function () {
    // Deploy different reward token
    const MockRewardToken = await ethers.getContractFactory("MockERC20");
    const rewardToken = await MockRewardToken.deploy("Reward Token", "REWARD", ethers.parseEther("1000000"));
    
    // Add pool with different reward token
    await stakingContract.addPool(
      await rewardToken.getAddress(),
      15, // 15% reward rate
      30 * 24 * 60 * 60, // 30 days lockup
      ethers.parseEther("1000") // 1000 tokens max
    );
    
    // Fund contract with reward tokens
    await rewardToken.transfer(await stakingContract.getAddress(), ethers.parseEther("10000"));
    
    // User stakes in new pool
    await stakingContract.connect(user1).stake(1, ethers.parseEther("100"));
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Get initial reward token balance
    const initialRewardBalance = await rewardToken.balanceOf(user1.address);
    
    // Restake with rewards (should claim rewards in different token)
    const tx = await stakingContract.connect(user1).restake(1, true);
    
    await expect(tx).to.emit(stakingContract, "RewardClaimed");
    await expect(tx).to.emit(stakingContract, "Restaked")
      .withArgs(user1.address, 1, ethers.parseEther("100"), 0, ethers.parseEther("100"));
    
    // Check that reward tokens were claimed
    const finalRewardBalance = await rewardToken.balanceOf(user1.address);
    expect(finalRewardBalance).to.be.gt(initialRewardBalance);
    
    // Staked amount should remain the same
    const stakeInfo = await stakingContract.getStakeInfo(user1.address, 1);
    expect(stakeInfo.amount).to.equal(ethers.parseEther("100"));
  });

  it("Should respect maximum staking limit when restaking with rewards", async function () {
    // Add a pool with low max staking amount
    await stakingContract.addPool(
      await mockToken.getAddress(),
      50, // 50% reward rate (high to generate significant rewards)
      30 * 24 * 60 * 60, // 30 days lockup
      ethers.parseEther("110") // Low max limit
    );
    
    // User stakes maximum amount
    await stakingContract.connect(user1).stake(1, ethers.parseEther("100"));
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Check if restake would exceed limit
    const restakeInfo = await stakingContract.getRestakeInfo(user1.address, 1);
    const wouldExceedLimit = restakeInfo.maxRestakeAmount > ethers.parseEther("110");
    
    if (wouldExceedLimit) {
      // Should fail if trying to restake with rewards
      await expect(stakingContract.connect(user1).restake(1, true))
        .to.be.revertedWith("Restake amount exceeds maximum staking limit");
      
      // Should succeed without rewards
      await expect(stakingContract.connect(user1).restake(1, false))
        .to.not.be.reverted;
    } else {
      // Should succeed in both cases
      await expect(stakingContract.connect(user1).restake(1, true))
        .to.not.be.reverted;
    }
  });

  it("Should not allow restaking with inactive pool", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Deactivate pool
    await stakingContract.setPoolStatus(0, false);
    
    // Should not allow restaking
    await expect(stakingContract.connect(user1).restake(0, false))
      .to.be.revertedWith("Pool is not active");
  });

  it("Should handle restaking with no pending rewards", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Fast forward exactly to lockup end (minimal rewards)
    await time.increase(30 * 24 * 60 * 60); // Exactly 30 days
    
    // Restake (should work even with minimal/no rewards)
    const tx = await stakingContract.connect(user1).restake(0, true);
    
    // Should emit restake event
    await expect(tx).to.emit(stakingContract, "Restaked");
    
    // Stake should be reset
    const stakeInfo = await stakingContract.getStakeInfo(user1.address, 0);
    expect(stakeInfo.since).to.be.closeTo(await time.latest(), 2);
  });

  it("Should correctly update pool and total staked amounts", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Get initial totals
    const initialPoolStaked = (await stakingContract.pools(0)).totalStaked;
    const initialTotalStaked = await stakingContract.totalStaked();
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Get pending reward
    const pendingReward = await stakingContract.getPendingReward(user1.address, 0);
    
    // Restake with rewards
    await stakingContract.connect(user1).restake(0, true);
    
    // Check updated totals
    const finalPoolStaked = (await stakingContract.pools(0)).totalStaked;
    const finalTotalStaked = await stakingContract.totalStaked();
    
    // Should have increased by the reward amount
    expect(finalPoolStaked).to.be.gt(initialPoolStaked);
    expect(finalTotalStaked).to.be.gt(initialTotalStaked);
  });

  it("Should reset lastClaimedTimestamp on restake", async function () {
    // User stakes 100 tokens
    await stakingContract.connect(user1).stake(0, ethers.parseEther("100"));
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // Restake
    await stakingContract.connect(user1).restake(0, false);
    
    // Check that lastClaimedTimestamp was reset
    const stakeInfo = await stakingContract.getStakeInfo(user1.address, 0);
    expect(stakeInfo.lastClaimedTimestamp).to.be.closeTo(await time.latest(), 2);
    
    // Should have no pending rewards immediately after restake
    const pendingReward = await stakingContract.getPendingReward(user1.address, 0);
    expect(pendingReward).to.equal(0);
  });
});

describe("Statistics Tracking", function () {
  let stakingFixed: any;
  let stakingToken: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let user3: any;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    
    // Deploy mock token
    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Test Token", "TEST", ethers.parseEther("1000000"));
    
    // Deploy staking contract
    const StakingContract = await ethers.getContractFactory("ilmtStakingFixed");
    stakingFixed = await StakingContract.deploy(await stakingToken.getAddress());
    
    // Add multiple pools
    await stakingFixed.addPool(
      await stakingToken.getAddress(),
      20, // 20% reward rate
      30 * 24 * 60 * 60, // 30 days lockup
      ethers.parseEther("1000") // 1000 tokens max
    );
    
    await stakingFixed.addPool(
      await stakingToken.getAddress(),
      15, // 15% reward rate
      60 * 24 * 60 * 60, // 60 days lockup
      ethers.parseEther("2000") // 2000 tokens max
    );
    
    // Transfer tokens to users
    await stakingToken.transfer(user1.address, ethers.parseEther("1000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("1000"));
    await stakingToken.transfer(user3.address, ethers.parseEther("1000"));
    
    // Approve staking contract
    await stakingToken.connect(user1).approve(await stakingFixed.getAddress(), ethers.parseEther("1000"));
    await stakingToken.connect(user2).approve(await stakingFixed.getAddress(), ethers.parseEther("1000"));
    await stakingToken.connect(user3).approve(await stakingFixed.getAddress(), ethers.parseEther("1000"));
    
    // Fund contract with reward tokens
    await stakingToken.transfer(await stakingFixed.getAddress(), ethers.parseEther("10000"));
  });

  it("Should track total value locked correctly", async function () {
    // Initially should be 0
    expect(await stakingFixed.getTotalValueLocked()).to.equal(0);
    
    // User1 stakes 100 tokens in pool 0
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("100"));
    
    // User2 stakes 200 tokens in pool 1
    await stakingFixed.connect(user2).stake(1, ethers.parseEther("200"));
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("300"));
    
    // User1 stakes additional 50 tokens in pool 1
    await stakingFixed.connect(user1).stake(1, ethers.parseEther("50"));
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("350"));
  });

  it("Should track pool-specific TVL correctly", async function () {
    // Initially both pools should have 0 TVL
    expect(await stakingFixed.getPoolTVL(0)).to.equal(0);
    expect(await stakingFixed.getPoolTVL(1)).to.equal(0);
    
    // User1 stakes in pool 0
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    expect(await stakingFixed.getPoolTVL(0)).to.equal(ethers.parseEther("100"));
    expect(await stakingFixed.getPoolTVL(1)).to.equal(0);
    
    // User2 stakes in pool 1
    await stakingFixed.connect(user2).stake(1, ethers.parseEther("200"));
    expect(await stakingFixed.getPoolTVL(0)).to.equal(ethers.parseEther("100"));
    expect(await stakingFixed.getPoolTVL(1)).to.equal(ethers.parseEther("200"));
  });

  it("Should track total active stakers correctly", async function () {
    // Initially should be 0
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(0);
    
    // User1 stakes - should become active
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(1);
    
    // User1 stakes in another pool - should still be 1 (same user)
    await stakingFixed.connect(user1).stake(1, ethers.parseEther("50"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(1);
    
    // User2 stakes - should become 2
    await stakingFixed.connect(user2).stake(0, ethers.parseEther("200"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(2);
    
    // User3 stakes - should become 3
    await stakingFixed.connect(user3).stake(1, ethers.parseEther("300"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(3);
  });

  it("Should track pool-specific active stakers correctly", async function () {
    // Initially both pools should have 0 active stakers
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(0);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(0);
    
    // User1 stakes in pool 0
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(1);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(0);
    
    // User1 stakes in pool 1
    await stakingFixed.connect(user1).stake(1, ethers.parseEther("50"));
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(1);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(1);
    
    // User2 stakes in pool 0
    await stakingFixed.connect(user2).stake(0, ethers.parseEther("200"));
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(2);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(1);
  });

  it("Should update statistics when users unstake", async function () {
    // Setup: multiple users stake
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    await stakingFixed.connect(user1).stake(1, ethers.parseEther("50"));
    await stakingFixed.connect(user2).stake(0, ethers.parseEther("200"));
    
    // Verify initial state
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("350"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(2);
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(2);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(1);
    
    // Fast forward past lockup period
    await time.increase(31 * 24 * 60 * 60); // 31 days
    
    // User1 unstakes from pool 0
    await stakingFixed.connect(user1).unstake(0);
    
    // Check updated statistics
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("250"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(2); // User1 still has stake in pool 1
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(1);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(1);
    
    // Fast forward more for pool 1 lockup
    await time.increase(30 * 24 * 60 * 60); // Additional 30 days
    
    // User1 unstakes from pool 1 (last pool)
    await stakingFixed.connect(user1).unstake(1);
    
    // Now user1 should be removed from active stakers
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("200"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(1); // Only user2 remains
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(1);
    expect(await stakingFixed.getPoolActiveStakers(1)).to.equal(0);
  });

  it("Should provide comprehensive pool statistics", async function () {
    // Stake some tokens
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    await stakingFixed.connect(user2).stake(0, ethers.parseEther("200"));
    
    const poolStats = await stakingFixed.getPoolStats(0);
    
    expect(poolStats.poolTotalStaked).to.equal(ethers.parseEther("300"));
    expect(poolStats.poolActiveStakers).to.equal(2);
    expect(poolStats.rewardRate).to.equal(20);
    expect(poolStats.lockupPeriod).to.equal(30 * 24 * 60 * 60);
    expect(poolStats.maxStakingAmount).to.equal(ethers.parseEther("1000"));
    expect(poolStats.isActive).to.be.true;
    expect(poolStats.rewardToken).to.equal(await stakingToken.getAddress());
  });

  it("Should provide comprehensive protocol statistics", async function () {
    // Stake in multiple pools
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    await stakingFixed.connect(user2).stake(1, ethers.parseEther("200"));
    await stakingFixed.connect(user3).stake(0, ethers.parseEther("150"));
    
    const protocolStats = await stakingFixed.getProtocolStats();
    
    expect(protocolStats.totalValueLocked).to.equal(ethers.parseEther("450"));
    expect(protocolStats.protocolActiveStakers).to.equal(3);
    expect(protocolStats.totalPools).to.equal(2);
    expect(protocolStats.activePools).to.equal(2);
    
    // Deactivate one pool
    await stakingFixed.setPoolStatus(1, false);
    
    const updatedStats = await stakingFixed.getProtocolStats();
    expect(updatedStats.activePools).to.equal(1);
  });

  it("Should provide comprehensive user statistics", async function () {
    // User1 stakes in multiple pools
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    await stakingFixed.connect(user1).stake(1, ethers.parseEther("200"));
    
    const userStats = await stakingFixed.getUserStats(user1.address);
    
    expect(userStats.totalStakedByUser).to.equal(ethers.parseEther("300"));
    expect(userStats.activePoolsCount).to.equal(2);
    expect(userStats.totalPendingRewards).to.equal(0); // No rewards yet (before lockup)
    expect(userStats.isActive).to.be.true;
    
    // Check user with no stakes
    const emptyUserStats = await stakingFixed.getUserStats(user3.address);
    expect(emptyUserStats.totalStakedByUser).to.equal(0);
    expect(emptyUserStats.activePoolsCount).to.equal(0);
    expect(emptyUserStats.isActive).to.be.false;
  });

  it("Should handle statistics correctly with emergency withdrawals", async function () {
    // Setup
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    await stakingFixed.connect(user2).stake(0, ethers.parseEther("200"));
    
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(2);
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(2);
    
    // Emergency withdraw
    await stakingFixed.connect(user1).emergencyWithdraw(0);
    
    // Statistics should be updated
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("200"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(1);
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(1);
  });

  it("Should handle statistics correctly with early unstake", async function () {
    // Setup
    await stakingFixed.connect(user1).stake(0, ethers.parseEther("100"));
    await stakingFixed.connect(user2).stake(0, ethers.parseEther("200"));
    
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(2);
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(2);
    
    // Request early unstake (before lockup period)
    await stakingFixed.connect(user1).requestEarlyUnstake(0);
    
    // Statistics should be updated immediately
    expect(await stakingFixed.getTotalValueLocked()).to.equal(ethers.parseEther("200"));
    expect(await stakingFixed.getTotalActiveStakers()).to.equal(1);
    expect(await stakingFixed.getPoolActiveStakers(0)).to.equal(1);
  });
}); 