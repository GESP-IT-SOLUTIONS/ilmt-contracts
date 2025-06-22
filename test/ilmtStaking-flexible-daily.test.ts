import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ilmtStakingFlexible - Daily Rewards & Cooldown Tests", function () {
  let stakingToken: any;
  let rewardToken: any;
  let stakingFlexible: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let user3: any;

  const STAKE_AMOUNT = ethers.parseEther("1000");
  const DAILY_REWARD_RATE = 100; // 1% per day (100 basis points)
  const COOLDOWN_PERIOD = 10 * 24 * 60 * 60; // 10 days
  const MAX_STAKING_AMOUNT = ethers.parseEther("10000");

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Staking Token", "STK", ethers.parseEther("1000000"));
    rewardToken = await MockToken.deploy("Reward Token", "RWD", ethers.parseEther("1000000"));

    await stakingToken.waitForDeployment();
    await rewardToken.waitForDeployment();

    // Deploy Flexible contract
    const StakingFlexible = await ethers.getContractFactory("ilmtStakingFlexible");
    stakingFlexible = await StakingFlexible.deploy(await stakingToken.getAddress());
    await stakingFlexible.waitForDeployment();

    // Setup
    await stakingToken.transfer(user1.address, ethers.parseEther("20000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("20000"));
    await stakingToken.transfer(user3.address, ethers.parseEther("20000"));
    await rewardToken.transfer(await stakingFlexible.getAddress(), ethers.parseEther("100000"));

    // Add pool with daily rewards
    await stakingFlexible.addPool(await rewardToken.getAddress(), DAILY_REWARD_RATE, MAX_STAKING_AMOUNT);

    // Approve
    await stakingToken.connect(user1).approve(await stakingFlexible.getAddress(), ethers.MaxUint256);
    await stakingToken.connect(user2).approve(await stakingFlexible.getAddress(), ethers.MaxUint256);
    await stakingToken.connect(user3).approve(await stakingFlexible.getAddress(), ethers.MaxUint256);
  });

  describe("🚀 Basic Staking Functionality", function () {
    it("Should allow staking and track timestamps", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      const stakeInfo = await stakingFlexible.getStakeInfo(user1.address, 0);
      expect(stakeInfo.amount).to.equal(STAKE_AMOUNT);
      expect(stakeInfo.since).to.be.greaterThan(0);
      expect(stakeInfo.lastClaimedTimestamp).to.equal(stakeInfo.since);
    });

    it("Should allow additional staking without resetting timestamps", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      const initialInfo = await stakingFlexible.getStakeInfo(user1.address, 0);
      
      // Wait 1 day and stake more
      await time.increase(24 * 60 * 60);
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      const finalInfo = await stakingFlexible.getStakeInfo(user1.address, 0);
      expect(finalInfo.amount).to.equal(STAKE_AMOUNT * 2n);
      expect(finalInfo.since).to.equal(initialInfo.since); // Timestamp preserved
    });
  });

  describe("📊 Statistics Tracking", function () {
    it("Should track total value locked correctly", async function () {
      // Initial TVL should be 0
      expect(await stakingFlexible.getTotalValueLocked()).to.equal(0);
      expect(await stakingFlexible.getPoolTVL(0)).to.equal(0);
      
      // User1 stakes
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalValueLocked()).to.equal(STAKE_AMOUNT);
      expect(await stakingFlexible.getPoolTVL(0)).to.equal(STAKE_AMOUNT);
      
      // User2 stakes
      await stakingFlexible.connect(user2).stake(0, STAKE_AMOUNT * 2n);
      expect(await stakingFlexible.getTotalValueLocked()).to.equal(STAKE_AMOUNT * 3n);
      expect(await stakingFlexible.getPoolTVL(0)).to.equal(STAKE_AMOUNT * 3n);
    });

    it("Should track active stakers correctly", async function () {
      // Initial active stakers should be 0
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(0);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(0);
      
      // User1 stakes
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(1);
      
      // User2 stakes
      await stakingFlexible.connect(user2).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(2);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(2);
      
      // User1 stakes more (shouldn't increase active stakers)
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(2);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(2);
    });

    it("Should decrease active stakers when users unstake", async function () {
      // Setup: 2 users stake
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user2).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(2);
      
      // User1 requests unstake
      await stakingFlexible.connect(user1).requestUnstake(0);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(1);
      
      // User2 also unstakes
      await stakingFlexible.connect(user2).requestUnstake(0);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(0);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(0);
    });

    it("Should handle emergency withdraw correctly for statistics", async function () {
      // Setup
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user2).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(2);
      expect(await stakingFlexible.getTotalValueLocked()).to.equal(STAKE_AMOUNT * 2n);
      
      // Emergency withdraw
      await stakingFlexible.connect(user1).emergencyWithdraw(0);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1);
      expect(await stakingFlexible.getTotalValueLocked()).to.equal(STAKE_AMOUNT);
    });

    it("Should return comprehensive pool statistics", async function () {
      // Add users to pool
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user2).stake(0, STAKE_AMOUNT * 2n);
      
      const poolStats = await stakingFlexible.getPoolStats(0);
      expect(poolStats.poolTotalStaked).to.equal(STAKE_AMOUNT * 3n);
      expect(poolStats.activeStakers).to.equal(2);
      expect(poolStats.dailyRewardRate).to.equal(DAILY_REWARD_RATE);
      expect(poolStats.maxStakingAmount).to.equal(MAX_STAKING_AMOUNT);
      expect(poolStats.isActive).to.be.true;
    });

    it("Should return comprehensive protocol statistics", async function () {
      // Add second pool
      await stakingFlexible.addPool(await rewardToken.getAddress(), 200, MAX_STAKING_AMOUNT); // 2% daily
      
      // Add users to pools
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user2).stake(1, STAKE_AMOUNT);
      await stakingFlexible.connect(user3).stake(0, STAKE_AMOUNT); // user3 in pool 0
      
      const protocolStats = await stakingFlexible.getProtocolStats();
      expect(protocolStats.totalValueLocked).to.equal(STAKE_AMOUNT * 3n);
      expect(protocolStats.globalActiveStakers).to.equal(3); // 3 unique users
      expect(protocolStats.totalPools).to.equal(2);
    });

    it("Should handle multi-pool staking for same user correctly", async function () {
      // Add second pool
      await stakingFlexible.addPool(await rewardToken.getAddress(), 200, MAX_STAKING_AMOUNT);
      
      // User1 stakes in pool 0
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(1);
      expect(await stakingFlexible.getPoolActiveStakers(1)).to.equal(0);
      
      // User1 also stakes in pool 1 (shouldn't increase total active stakers)
      await stakingFlexible.connect(user1).stake(1, STAKE_AMOUNT);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1); // Still 1 unique user
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(1);
      expect(await stakingFlexible.getPoolActiveStakers(1)).to.equal(1);
      
      // User1 unstakes from pool 0 (should still be active in pool 1)
      await stakingFlexible.connect(user1).requestUnstake(0);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1); // Still active in pool 1
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(0);
      expect(await stakingFlexible.getPoolActiveStakers(1)).to.equal(1);
      
      // User1 unstakes from pool 1 (should remove from total active stakers)
      await stakingFlexible.connect(user1).requestUnstake(1);
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(0);
      expect(await stakingFlexible.getPoolActiveStakers(0)).to.equal(0);
      expect(await stakingFlexible.getPoolActiveStakers(1)).to.equal(0);
    });
  });

  describe("💰 Daily Rewards System", function () {
    it("Should calculate correct daily rewards", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Check daily reward calculation
      const dailyReward = await stakingFlexible.getDailyReward(user1.address, 0);
      const expectedDailyReward = (STAKE_AMOUNT * BigInt(DAILY_REWARD_RATE)) / 10000n;
      expect(dailyReward).to.equal(expectedDailyReward);
    });

    it("Should allow claiming rewards after 1 day", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 1 day
      await time.increase(24 * 60 * 60);
      
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 0);
      expect(pendingReward).to.be.greaterThan(0);
      
      // Claim rewards
      const balanceBefore = await rewardToken.balanceOf(user1.address);
      await stakingFlexible.connect(user1).claimReward(0);
      const balanceAfter = await rewardToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(pendingReward);
    });

    it("Should accumulate rewards over multiple days", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 3 days
      await time.increase(3 * 24 * 60 * 60);
      
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 0);
      const expectedReward = (STAKE_AMOUNT * BigInt(DAILY_REWARD_RATE) * 3n) / 10000n;
      
      expect(pendingReward).to.equal(expectedReward);
    });

    it("Should not give rewards for partial days", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 23 hours (less than 1 day)
      await time.increase(23 * 60 * 60);
      
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 0);
      expect(pendingReward).to.equal(0);
    });

    it("Should reset reward timer after claiming", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 1 day and claim
      await time.increase(24 * 60 * 60);
      await stakingFlexible.connect(user1).claimReward(0);
      
      // Check that pending rewards are 0 immediately after claim
      const pendingAfterClaim = await stakingFlexible.getPendingReward(user1.address, 0);
      expect(pendingAfterClaim).to.equal(0);
      
      // Wait another day
      await time.increase(24 * 60 * 60);
      
      // Should have rewards for 1 day only
      const pendingAfterSecondDay = await stakingFlexible.getPendingReward(user1.address, 0);
      const expectedDailyReward = (STAKE_AMOUNT * BigInt(DAILY_REWARD_RATE)) / 10000n;
      expect(pendingAfterSecondDay).to.equal(expectedDailyReward);
    });
  });

  describe("⏰ Cooldown System", function () {
    it("Should initiate cooldown when requesting unstake", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 2 days to accumulate rewards
      await time.increase(2 * 24 * 60 * 60);
      
      // Request unstake
      const rewardBalanceBefore = await rewardToken.balanceOf(user1.address);
      await stakingFlexible.connect(user1).requestUnstake(0);
      const rewardBalanceAfter = await rewardToken.balanceOf(user1.address);
      
      // Should have auto-claimed pending rewards
      expect(rewardBalanceAfter).to.be.greaterThan(rewardBalanceBefore);
      
      // Check cooldown info
      const cooldownInfo = await stakingFlexible.getCooldownInfo(user1.address, 0);
      expect(cooldownInfo.amount).to.equal(STAKE_AMOUNT);
      expect(cooldownInfo.claimed).to.be.false;
      expect(cooldownInfo.timeLeft).to.be.greaterThan(0);
    });

    it("Should not allow claiming before cooldown period", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user1).requestUnstake(0);
      
      // Try to claim immediately
      await expect(
        stakingFlexible.connect(user1).claimUnstake(0)
      ).to.be.revertedWith("Cooldown period not finished");
      
      // Wait partial period - should still fail
      await time.increase(COOLDOWN_PERIOD / 2);
      
      await expect(
        stakingFlexible.connect(user1).claimUnstake(0)
      ).to.be.revertedWith("Cooldown period not finished");
    });

    it("Should allow claiming after cooldown period", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user1).requestUnstake(0);
      
      // Wait full cooldown period
      await time.increase(COOLDOWN_PERIOD + 1);
      
      // Check cooldown info
      const cooldownInfo = await stakingFlexible.getCooldownInfo(user1.address, 0);
      expect(cooldownInfo.timeLeft).to.equal(0);
      
      // Claim unstake
      const balanceBefore = await stakingToken.balanceOf(user1.address);
      await stakingFlexible.connect(user1).claimUnstake(0);
      const balanceAfter = await stakingToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
      
      // Check that cooldown is marked as claimed
      const finalCooldownInfo = await stakingFlexible.getCooldownInfo(user1.address, 0);
      expect(finalCooldownInfo.claimed).to.be.true;
    });

    it("Should not allow double claiming", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user1).requestUnstake(0);
      await time.increase(COOLDOWN_PERIOD + 1);
      
      // First claim
      await stakingFlexible.connect(user1).claimUnstake(0);
      
      // Second claim should fail
      await expect(
        stakingFlexible.connect(user1).claimUnstake(0)
      ).to.be.revertedWith("Already claimed");
    });
  });

  describe("🔧 Owner Functions", function () {
    it("Should allow owner to change cooldown period", async function () {
      const newPeriod = 14 * 24 * 60 * 60; // 14 days
      
      await expect(stakingFlexible.setCooldownPeriod(newPeriod))
        .to.emit(stakingFlexible, "CooldownPeriodUpdated")
        .withArgs(newPeriod);
      
      expect(await stakingFlexible.cooldownPeriod()).to.equal(newPeriod);
    });

    it("Should not allow non-owner to change cooldown period", async function () {
      await expect(
        stakingFlexible.connect(user1).setCooldownPeriod(14 * 24 * 60 * 60)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should validate daily reward rate limits", async function () {
      // Should reject rates > 10% (1000 basis points)
      await expect(
        stakingFlexible.addPool(await rewardToken.getAddress(), 1001, MAX_STAKING_AMOUNT)
      ).to.be.revertedWith("Invalid daily reward rate");
      
      // Should accept valid rates
      await stakingFlexible.addPool(await rewardToken.getAddress(), 500, MAX_STAKING_AMOUNT); // 5% daily
    });
  });

  describe("📊 Complex Scenarios", function () {
    it("Should handle multiple users with different stake times", async function () {
      // User1 stakes on day 0
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 2 days, then User2 stakes
      await time.increase(2 * 24 * 60 * 60);
      await stakingFlexible.connect(user2).stake(0, STAKE_AMOUNT * 2n);
      
      // Wait another 3 days
      await time.increase(3 * 24 * 60 * 60);
      
      // Check rewards
      const user1Reward = await stakingFlexible.getPendingReward(user1.address, 0);
      const user2Reward = await stakingFlexible.getPendingReward(user2.address, 0);
      
      // User1: 5 days * 1% * 1000 tokens = 50 tokens
      const expectedUser1Reward = (STAKE_AMOUNT * BigInt(DAILY_REWARD_RATE) * 5n) / 10000n;
      // User2: 3 days * 1% * 2000 tokens = 60 tokens  
      const expectedUser2Reward = (STAKE_AMOUNT * 2n * BigInt(DAILY_REWARD_RATE) * 3n) / 10000n;
      
      expect(user1Reward).to.equal(expectedUser1Reward);
      expect(user2Reward).to.equal(expectedUser2Reward);
    });

    it("Should handle partial claims and continued staking", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      
      // Wait 3 days and claim
      await time.increase(3 * 24 * 60 * 60);
      await stakingFlexible.connect(user1).claimReward(0);
      
      // Wait 2 more days
      await time.increase(2 * 24 * 60 * 60);
      
      // Should have rewards for 2 days only
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 0);
      const expectedReward = (STAKE_AMOUNT * BigInt(DAILY_REWARD_RATE) * 2n) / 10000n;
      expect(pendingReward).to.equal(expectedReward);
    });

    it("Should not allow multiple cooldown requests", async function () {
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      await stakingFlexible.connect(user1).requestUnstake(0);
      
      // Try to request unstake again
      await expect(
        stakingFlexible.connect(user1).requestUnstake(0)
      ).to.be.revertedWith("No tokens staked");
    });
  });

  describe("🧪 Complete User Journey", function () {
    it("Should handle complete flexible staking journey", async function () {
      console.log("\n🎯 COMPLETE FLEXIBLE STAKING JOURNEY");
      
      // 1. Stake
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      console.log("1. ✅ Staked successfully");
      
      // 2. Wait and claim rewards multiple times
      await time.increase(2 * 24 * 60 * 60); // 2 days
      await stakingFlexible.connect(user1).claimReward(0);
      console.log("2. 💰 Claimed 2-day rewards");
      
      await time.increase(3 * 24 * 60 * 60); // 3 more days
      await stakingFlexible.connect(user1).claimReward(0);
      console.log("3. 💰 Claimed 3-day rewards");
      
      // 3. Add more stake
      await stakingFlexible.connect(user1).stake(0, STAKE_AMOUNT);
      console.log("4. ➕ Added more stake");
      
      // 4. Wait and request unstake (auto-claims pending rewards)
      await time.increase(1 * 24 * 60 * 60); // 1 day
      const rewardBalanceBefore = await rewardToken.balanceOf(user1.address);
      await stakingFlexible.connect(user1).requestUnstake(0);
      const rewardBalanceAfter = await rewardToken.balanceOf(user1.address);
      console.log("5. 🚀 Requested unstake with auto-claim");
      
      // Should have auto-claimed 1 day of rewards for 2000 tokens
      const expectedAutoReward = (STAKE_AMOUNT * 2n * BigInt(DAILY_REWARD_RATE)) / 10000n;
      expect(rewardBalanceAfter - rewardBalanceBefore).to.equal(expectedAutoReward);
      
      // 5. Wait cooldown and claim tokens
      await time.increase(COOLDOWN_PERIOD + 1);
      const stakeBalanceBefore = await stakingToken.balanceOf(user1.address);
      await stakingFlexible.connect(user1).claimUnstake(0);
      const stakeBalanceAfter = await stakingToken.balanceOf(user1.address);
      console.log("6. 🎉 Claimed unstake after cooldown");
      
      expect(stakeBalanceAfter - stakeBalanceBefore).to.equal(STAKE_AMOUNT * 2n);
      
      console.log("\n🏆 COMPLETE FLEXIBLE JOURNEY SUCCESSFUL!");
    });
  });

  describe("💰 Compounding Features", function() {
    beforeEach(async function() {
      // Create additional pool for testing
      await stakingFlexible.addPool(
        await rewardToken.getAddress(), // reward token
        5,                              // dailyRewardRate: 0.05% (19% APY)
        ethers.parseEther("10000")      // maxStaking: 10,000 ILMT  
      );
      
      // User stakes 1000 ILMT in the new pool (pool ID 1)
      const stakeAmount = ethers.parseEther("1000");
      await stakingToken.connect(user1).approve(stakingFlexible.target, stakeAmount);
      await stakingFlexible.connect(user1).stake(1, stakeAmount);
    });

    it("Should compound rewards correctly", async function() {
      // Wait 10 days to accumulate rewards
      await time.increase(10 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      const initialStake = ethers.parseEther("1000");
      const expectedReward = ethers.parseEther("5"); // 1000 * 0.05% * 10 days

      // Check pending reward
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 1);
      expect(pendingReward).to.be.closeTo(expectedReward, ethers.parseEther("0.1"));

      // Compound rewards
      const tx = await stakingFlexible.connect(user1).compoundRewards(1);
      
      // Check events
              await expect(tx)
          .to.emit(stakingFlexible, "RewardClaimed")
          .withArgs(user1.address, 1, pendingReward);
        await expect(tx)
          .to.emit(stakingFlexible, "Staked")
          .withArgs(user1.address, 1, pendingReward);
        await expect(tx)
          .to.emit(stakingFlexible, "RewardCompounded")
          .withArgs(user1.address, 1, pendingReward);

        // Check new stake amount
        const userStakeAfter = await stakingFlexible.getStakeInfo(user1.address, 1);
        expect(userStakeAfter.amount).to.equal(initialStake + pendingReward);

        // Check no pending rewards after compounding
        const pendingAfterCompound = await stakingFlexible.getPendingReward(user1.address, 1);
      expect(pendingAfterCompound).to.equal(0);
    });

    it("Should update pool statistics when compounding", async function() {
      // Wait for rewards
      await time.increase(5 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      const initialTVL = await stakingFlexible.getTotalValueLocked();
      const initialPoolTVL = await stakingFlexible.getPoolTVL(1);
      
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 1);
      
      // Compound rewards
      await stakingFlexible.connect(user1).compoundRewards(1);

      // Check TVL increased by reward amount
      const newTVL = await stakingFlexible.getTotalValueLocked();
      const newPoolTVL = await stakingFlexible.getPoolTVL(1);
      
      expect(newTVL).to.equal(initialTVL + pendingReward);
      expect(newPoolTVL).to.equal(initialPoolTVL + pendingReward);
      
      // Active stakers should remain the same
      expect(await stakingFlexible.getTotalActiveStakers()).to.equal(1);
      expect(await stakingFlexible.getPoolActiveStakers(1)).to.equal(1);
    });

    it("Should fail to compound if no rewards available", async function() {
      // Try to compound immediately after staking (no time passed)
      await expect(
        stakingFlexible.connect(user1).compoundRewards(1)
      ).to.be.revertedWith("No rewards to compound");
    });

    it("Should fail to compound if would exceed max staking limit", async function() {
      // Create pool with low max limit (pool ID 2)
      await stakingFlexible.addPool(
        await rewardToken.getAddress(), // reward token
        50,                             // high reward rate
        ethers.parseEther("1001")       // maxStaking: just above current stake
      );

      // Stake close to max in the new pool
      const stakeAmount = ethers.parseEther("1000");
      await stakingToken.connect(user1).approve(stakingFlexible.target, stakeAmount);
      await stakingFlexible.connect(user1).stake(2, stakeAmount);

      // Wait for significant rewards
      await time.increase(10 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      // Should fail to compound due to max limit
      await expect(
        stakingFlexible.connect(user1).compoundRewards(2)
      ).to.be.revertedWith("Compounding would exceed maximum staking limit");
    });

    it("Should use claimRewardWithOption correctly", async function() {
      // Wait for rewards
      await time.increase(5 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      const initialBalance = await rewardToken.balanceOf(user1.address);
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 1);

      // Claim without compounding
      await stakingFlexible.connect(user1).claimRewardWithOption(1, false);
      
      // Should receive tokens (note: reward is in rewardToken, not stakingToken)
      const balanceAfterClaim = await rewardToken.balanceOf(user1.address);
      expect(balanceAfterClaim).to.equal(pendingReward);

      // Wait for more rewards
      await time.increase(5 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      const initialStake = await stakingFlexible.getStakeInfo(user1.address, 1);
      const newPendingReward = await stakingFlexible.getPendingReward(user1.address, 1);

      // Claim with compounding
      await stakingFlexible.connect(user1).claimRewardWithOption(1, true);
      
      // Should not receive additional tokens (compounded instead)
      const balanceAfterCompound = await rewardToken.balanceOf(user1.address);
      expect(balanceAfterCompound).to.equal(balanceAfterClaim);

      // But stake should increase
      const stakeAfterCompound = await stakingFlexible.getStakeInfo(user1.address, 1);
      expect(stakeAfterCompound.amount).to.equal(initialStake.amount + newPendingReward);
    });

    it("Should return correct compounded amount", async function() {
      // Wait for rewards
      await time.increase(7 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      const currentStake = await stakingFlexible.getStakeInfo(user1.address, 1);
      const pendingReward = await stakingFlexible.getPendingReward(user1.address, 1);
      const compoundedAmount = await stakingFlexible.getCompoundedAmount(user1.address, 1);

      expect(compoundedAmount).to.equal(currentStake.amount + pendingReward);
    });

    it("Should correctly check if compounding is possible", async function() {
      // Initially no rewards, so can't compound
      expect(await stakingFlexible.canCompoundRewards(user1.address, 1)).to.be.false;

      // Wait for rewards
      await time.increase(3 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      // Now should be able to compound
      expect(await stakingFlexible.canCompoundRewards(user1.address, 1)).to.be.true;

      // Create pool with max limit that would prevent compounding (pool ID 2)
      await stakingFlexible.addPool(
        await rewardToken.getAddress(), // reward token
        50,                             // High reward rate
        ethers.parseEther("1001")       // Just above current stake
      );

      await stakingToken.connect(user1).approve(stakingFlexible.target, ethers.parseEther("1000"));
      await stakingFlexible.connect(user1).stake(2, ethers.parseEther("1000"));

      // Wait for rewards that would exceed max
      await time.increase(10 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      // Should not be able to compound due to max limit
      expect(await stakingFlexible.canCompoundRewards(user1.address, 2)).to.be.false;
    });

    it("Should handle compounding for multiple users independently", async function() {
      // User2 stakes in the same pool
      const stakeAmount = ethers.parseEther("500");
      await stakingToken.connect(user2).approve(stakingFlexible.target, stakeAmount);
      await stakingFlexible.connect(user2).stake(1, stakeAmount);

      // Wait for rewards
      await time.increase(5 * 24 * 60 * 60);
      await time.increase(1); // Mine one block

      // Get initial states
      const user1InitialStake = await stakingFlexible.getStakeInfo(user1.address, 1);
      const user2InitialStake = await stakingFlexible.getStakeInfo(user2.address, 1);
      const user1PendingReward = await stakingFlexible.getPendingReward(user1.address, 1);
      const user2PendingReward = await stakingFlexible.getPendingReward(user2.address, 1);

      // Only user1 compounds
      await stakingFlexible.connect(user1).compoundRewards(1);

      // Check user1 stake increased
      const user1FinalStake = await stakingFlexible.getStakeInfo(user1.address, 1);
      expect(user1FinalStake.amount).to.equal(user1InitialStake.amount + user1PendingReward);

      // Check user2 stake unchanged
      const user2FinalStake = await stakingFlexible.getStakeInfo(user2.address, 1);
      expect(user2FinalStake.amount).to.equal(user2InitialStake.amount);

      // User2 still has pending rewards
      const user2StillPendingReward = await stakingFlexible.getPendingReward(user2.address, 1);
      expect(user2StillPendingReward).to.be.closeTo(user2PendingReward, ethers.parseEther("0.01"));
    });
  });

  describe("🔧 Edge Cases and Security", function() {
    // Add edge case tests here
  });
}); 