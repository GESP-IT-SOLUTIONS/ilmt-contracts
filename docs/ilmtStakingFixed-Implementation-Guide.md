# 🛠️ Step-by-Step Implementation Guide - ilmtStakingFixed

## 📋 Table of Contents

1. [Environment Setup](#1-environment-setup)
2. [Contract Deployment](#2-contract-deployment)
3. [Initial Configuration](#3-initial-configuration)
4. [Functionality Testing](#4-functionality-testing)
5. [Monitoring & Maintenance](#5-monitoring--maintenance)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Environment Setup

### 🔧 **Dependencies Installation**

**Step 1: Project initialization**

```bash
mkdir staking-project
cd staking-project
npm init -y
```

**Step 2: Install Hardhat and dependencies**

```bash
npm install --save-dev hardhat
npm install --save-dev @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
```

**Step 3: Initialize Hardhat**

```bash
npx hardhat init
# Select "Create a TypeScript project"
```

### 📁 **Project Structure**

```
staking-project/
├── contracts/
│   ├── ilmtStakingFixed.sol
│   └── Mock/
│       └── MockERC20.sol
├── scripts/
│   ├── deploy.ts
│   └── configure.ts
├── test/
│   └── ilmtStaking.test.ts
├── hardhat.config.ts
└── package.json
```

### ⚙️ **Configure hardhat.config.ts**

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.MAINNET_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
};

export default config;
```

---

## 2. Contract Deployment

### 📝 **Deployment Script**

**Create file `scripts/deploy.ts`:**

```typescript
import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting ilmtStakingFixed deployment...");

  // 1. Deploy MockERC20 for testing (testnet only)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const stakingToken = await MockERC20.deploy(
    "ILMT Token",
    "ILMT",
    18,
    ethers.parseEther("1000000000") // 1 billion tokens
  );
  await stakingToken.waitForDeployment();
  console.log(`📄 MockERC20 deployed at: ${await stakingToken.getAddress()}`);

  // 2. Deploy ilmtStakingFixed
  const IlmtStakingFixed = await ethers.getContractFactory("ilmtStakingFixed");
  const stakingContract = await IlmtStakingFixed.deploy(
    await stakingToken.getAddress()
  );
  await stakingContract.waitForDeployment();
  console.log(
    `🏦 ilmtStakingFixed deployed at: ${await stakingContract.getAddress()}`
  );

  // 3. Verify deployment
  console.log("\n✅ Verifying initial configuration:");
  console.log(`- Staking Token: ${await stakingContract.stakingToken()}`);
  console.log(
    `- Unbonding Period: ${await stakingContract.unbondingPeriod()} seconds`
  );
  console.log(
    `- Emergency Penalty: ${await stakingContract.emergencyPenaltyRate()} basis points`
  );
  console.log(`- Owner: ${await stakingContract.owner()}`);

  // 4. Save addresses for next scripts
  const addresses = {
    stakingToken: await stakingToken.getAddress(),
    stakingContract: await stakingContract.getAddress(),
    deployer: (await ethers.getSigners())[0].address,
  };

  console.log("\n📋 Addresses for configuration:");
  console.log(JSON.stringify(addresses, null, 2));

  return addresses;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment error:", error);
    process.exit(1);
  });
```

### 🚀 **Execute Deployment**

**On local network (Hardhat):**

```bash
npx hardhat run scripts/deploy.ts --network hardhat
```

**On testnet (Goerli):**

```bash
# Set environment variables
export PRIVATE_KEY="your_private_key_here"
export GOERLI_URL="https://goerli.infura.io/v3/your_project_id"

# Run deployment
npx hardhat run scripts/deploy.ts --network goerli
```

**On mainnet:**

```bash
# WARNING: Triple check before mainnet deployment!
export PRIVATE_KEY="your_private_key_here"
export MAINNET_URL="https://mainnet.infura.io/v3/your_project_id"

npx hardhat run scripts/deploy.ts --network mainnet
```

---

## 3. Initial Configuration

### 🏊 **Adding Pools**

**Create file `scripts/configure.ts`:**

```typescript
import { ethers } from "hardhat";

async function main() {
  // Replace with real addresses from deployment
  const STAKING_CONTRACT_ADDRESS = "0x...";
  const REWARD_TOKEN_ADDRESS = "0x...";

  const stakingContract = await ethers.getContractAt(
    "ilmtStakingFixed",
    STAKING_CONTRACT_ADDRESS
  );

  console.log("🔧 Configuring pools...");

  // Pool 1: Short-term (30 days, 5% reward)
  await stakingContract.addPool(
    REWARD_TOKEN_ADDRESS, // Reward token
    500, // 5% (500 basis points)
    30 * 24 * 60 * 60, // 30 days
    ethers.parseEther("100000") // Max 100k tokens per user
  );
  console.log("✅ Pool 0 added: Short-term (30 days, 5%)");

  // Pool 2: Medium-term (90 days, 12% reward)
  await stakingContract.addPool(
    REWARD_TOKEN_ADDRESS,
    1200, // 12% (1200 basis points)
    90 * 24 * 60 * 60, // 90 days
    ethers.parseEther("500000") // Max 500k tokens per user
  );
  console.log("✅ Pool 1 added: Medium-term (90 days, 12%)");

  // Pool 3: Long-term (180 days, 25% reward)
  await stakingContract.addPool(
    REWARD_TOKEN_ADDRESS,
    2500, // 25% (2500 basis points)
    180 * 24 * 60 * 60, // 180 days
    ethers.parseEther("1000000") // Max 1M tokens per user
  );
  console.log("✅ Pool 2 added: Long-term (180 days, 25%)");

  // Verify pools
  const poolsLength = await stakingContract.getPoolsLength();
  console.log(`\n📊 Total pools created: ${poolsLength}`);

  for (let i = 0; i < poolsLength; i++) {
    const poolStats = await stakingContract.getPoolStats(i);
    console.log(`\nPool ${i}:`);
    console.log(`- Reward Rate: ${poolStats.rewardRate} bp`);
    console.log(`- Lockup Period: ${poolStats.lockupPeriod} seconds`);
    console.log(
      `- Max Staking: ${ethers.formatEther(poolStats.maxStakingAmount)} tokens`
    );
    console.log(`- Active: ${poolStats.isActive}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Configuration error:", error);
    process.exit(1);
  });
```

### ⚙️ **Advanced Configurations**

**Script for parameter adjustment:**

```typescript
// scripts/adjust-parameters.ts
import { ethers } from "hardhat";

async function main() {
  const STAKING_CONTRACT_ADDRESS = "0x...";
  const stakingContract = await ethers.getContractAt(
    "ilmtStakingFixed",
    STAKING_CONTRACT_ADDRESS
  );

  // Adjust emergency penalty to 5%
  await stakingContract.setEmergencyPenalty(500);
  console.log("✅ Emergency penalty set to 5%");

  // Adjust unbonding period to 14 days
  await stakingContract.setUnbondingPeriod(14 * 24 * 60 * 60);
  console.log("✅ Unbonding period set to 14 days");

  // Verify new settings
  const emergencyPenalty = await stakingContract.emergencyPenaltyRate();
  const unbondingPeriod = await stakingContract.unbondingPeriod();

  console.log(`\n📋 Current configurations:`);
  console.log(
    `- Emergency Penalty: ${emergencyPenalty} bp (${emergencyPenalty / 100}%)`
  );
  console.log(
    `- Unbonding Period: ${unbondingPeriod} seconds (${
      unbondingPeriod / (24 * 60 * 60)
    } days)`
  );
}
```

---

## 4. Functionality Testing

### 🧪 **Interactive Testing Script**

**Create file `scripts/test-functionality.ts`:**

```typescript
import { ethers } from "hardhat";

async function main() {
  const [owner, user1, user2] = await ethers.getSigners();

  // Contract addresses (replace with real ones)
  const STAKING_CONTRACT_ADDRESS = "0x...";
  const STAKING_TOKEN_ADDRESS = "0x...";

  const stakingContract = await ethers.getContractAt(
    "ilmtStakingFixed",
    STAKING_CONTRACT_ADDRESS
  );
  const stakingToken = await ethers.getContractAt(
    "MockERC20",
    STAKING_TOKEN_ADDRESS
  );

  console.log("🧪 Starting functionality tests...");

  // Test 1: Distribute tokens to users
  console.log("\n1️⃣ Distributing tokens...");
  await stakingToken.transfer(user1.address, ethers.parseEther("10000"));
  await stakingToken.transfer(user2.address, ethers.parseEther("10000"));

  const balance1 = await stakingToken.balanceOf(user1.address);
  const balance2 = await stakingToken.balanceOf(user2.address);
  console.log(`✅ User1 balance: ${ethers.formatEther(balance1)} tokens`);
  console.log(`✅ User2 balance: ${ethers.formatEther(balance2)} tokens`);

  // Test 2: Approve and Stake
  console.log("\n2️⃣ Testing stake...");
  await stakingToken
    .connect(user1)
    .approve(STAKING_CONTRACT_ADDRESS, ethers.parseEther("1000"));
  await stakingContract.connect(user1).stake(0, ethers.parseEther("1000"));

  const stakeInfo = await stakingContract.getStakeInfo(user1.address, 0);
  console.log(
    `✅ User1 staked: ${ethers.formatEther(stakeInfo.amount)} tokens`
  );
  console.log(`✅ Rewards active: ${stakeInfo.rewardsActive}`);

  // Test 3: Check rewards (before lockup)
  console.log("\n3️⃣ Checking rewards before lockup...");
  const rewardBefore = await stakingContract.getPendingReward(user1.address, 0);
  console.log(
    `✅ Rewards before lockup: ${ethers.formatEther(rewardBefore)} tokens`
  );

  // Test 4: Simulate time passage
  console.log("\n4️⃣ Simulating time passage (30 days)...");
  await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]); // 30 days
  await ethers.provider.send("evm_mine", []);

  const rewardAfter = await stakingContract.getPendingReward(user1.address, 0);
  console.log(
    `✅ Rewards after lockup: ${ethers.formatEther(rewardAfter)} tokens`
  );

  // Test 5: Claim rewards
  console.log("\n5️⃣ Testing reward claim...");
  const balanceBeforeClaim = await stakingToken.balanceOf(user1.address);
  await stakingContract.connect(user1).claimReward(0);
  const balanceAfterClaim = await stakingToken.balanceOf(user1.address);

  console.log(`✅ Balance before: ${ethers.formatEther(balanceBeforeClaim)}`);
  console.log(`✅ Balance after: ${ethers.formatEther(balanceAfterClaim)}`);
  console.log(
    `✅ Reward received: ${ethers.formatEther(
      balanceAfterClaim - balanceBeforeClaim
    )}`
  );

  // Test 6: Verify rewards stopped
  console.log("\n6️⃣ Verifying rewards stopped after claim...");
  const stakeInfoAfterClaim = await stakingContract.getStakeInfo(
    user1.address,
    0
  );
  console.log(
    `✅ Rewards active after claim: ${stakeInfoAfterClaim.rewardsActive}`
  );

  // Test 7: Test restaking
  console.log("\n7️⃣ Testing restake...");
  await stakingContract.connect(user1).restake(0, false);
  const stakeInfoAfterRestake = await stakingContract.getStakeInfo(
    user1.address,
    0
  );
  console.log(
    `✅ Rewards active after restake: ${stakeInfoAfterRestake.rewardsActive}`
  );

  // Test 8: Test emergency withdraw
  console.log("\n8️⃣ Testing emergency withdraw (User2)...");
  await stakingToken
    .connect(user2)
    .approve(STAKING_CONTRACT_ADDRESS, ethers.parseEther("1000"));
  await stakingContract.connect(user2).stake(0, ethers.parseEther("1000"));

  const balanceBeforeEmergency = await stakingToken.balanceOf(user2.address);
  await stakingContract.connect(user2).emergencyWithdraw(0);
  const balanceAfterEmergency = await stakingToken.balanceOf(user2.address);

  console.log(
    `✅ Balance before emergency: ${ethers.formatEther(balanceBeforeEmergency)}`
  );
  console.log(
    `✅ Balance after emergency: ${ethers.formatEther(balanceAfterEmergency)}`
  );
  console.log(
    `✅ Penalty applied: ${ethers.formatEther(
      ethers.parseEther("1000") -
        (balanceAfterEmergency - balanceBeforeEmergency)
    )}`
  );

  console.log("\n🎉 All tests completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Testing error:", error);
    process.exit(1);
  });
```

### 🏃 **Execute Tests**

```bash
# Run tests on local network
npx hardhat run scripts/test-functionality.ts --network hardhat

# Or on testnet
npx hardhat run scripts/test-functionality.ts --network goerli
```

---

## 5. Monitoring & Maintenance

### 📊 **Monitoring Script**

**Create file `scripts/monitor.ts`:**

```typescript
import { ethers } from "hardhat";

async function main() {
  const STAKING_CONTRACT_ADDRESS = "0x...";
  const stakingContract = await ethers.getContractAt(
    "ilmtStakingFixed",
    STAKING_CONTRACT_ADDRESS
  );

  console.log("📊 Monitoring Report - ilmtStakingFixed");
  console.log("=".repeat(50));

  // 1. General statistics
  const protocolStats = await stakingContract.getProtocolStats();
  console.log("\n🏛️ Protocol Statistics:");
  console.log(
    `- Total Value Locked: ${ethers.formatEther(
      protocolStats.totalValueLocked
    )} tokens`
  );
  console.log(`- Total Active Stakers: ${protocolStats.protocolActiveStakers}`);
  console.log(`- Total Pools: ${protocolStats.totalPools}`);
  console.log(`- Active Pools: ${protocolStats.activePools}`);

  // 2. Per-pool statistics
  const poolsLength = await stakingContract.getPoolsLength();
  console.log("\n🏊 Pool Statistics:");

  for (let i = 0; i < poolsLength; i++) {
    const poolStats = await stakingContract.getPoolStats(i);
    const poolTVL = await stakingContract.getPoolTVL(i);

    console.log(`\nPool ${i}:`);
    console.log(`- TVL: ${ethers.formatEther(poolTVL)} tokens`);
    console.log(`- Active Stakers: ${poolStats.poolActiveStakers}`);
    console.log(
      `- Reward Rate: ${poolStats.rewardRate} bp (${
        poolStats.rewardRate / 100
      }%)`
    );
    console.log(
      `- Lockup Period: ${poolStats.lockupPeriod / (24 * 60 * 60)} days`
    );
    console.log(`- Status: ${poolStats.isActive ? "Active" : "Inactive"}`);
  }

  // 3. Current configurations
  console.log("\n⚙️ Current Configurations:");
  const emergencyPenalty = await stakingContract.emergencyPenaltyRate();
  const unbondingPeriod = await stakingContract.unbondingPeriod();
  const owner = await stakingContract.owner();

  console.log(
    `- Emergency Penalty: ${emergencyPenalty} bp (${emergencyPenalty / 100}%)`
  );
  console.log(`- Unbonding Period: ${unbondingPeriod / (24 * 60 * 60)} days`);
  console.log(`- Owner: ${owner}`);
  console.log(`- Contract Paused: ${await stakingContract.paused()}`);

  // 4. Contract balance
  const stakingTokenAddress = await stakingContract.stakingToken();
  const stakingToken = await ethers.getContractAt(
    "IERC20",
    stakingTokenAddress
  );
  const contractBalance = await stakingToken.balanceOf(
    STAKING_CONTRACT_ADDRESS
  );
  const totalStaked = await stakingContract.getTotalValueLocked();

  console.log("\n💰 Contract Balance:");
  console.log(`- Total Balance: ${ethers.formatEther(contractBalance)} tokens`);
  console.log(`- Total Staked: ${ethers.formatEther(totalStaked)} tokens`);
  console.log(
    `- Available (Penalties/Rewards): ${ethers.formatEther(
      contractBalance - totalStaked
    )} tokens`
  );

  console.log("\n✅ Monitoring report completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Monitoring error:", error);
    process.exit(1);
  });
```

### 🔔 **Alerting & Notifications**

**Script for automated checks:**

```typescript
// scripts/health-check.ts
import { ethers } from "hardhat";

async function healthCheck() {
  const STAKING_CONTRACT_ADDRESS = "0x...";
  const stakingContract = await ethers.getContractAt(
    "ilmtStakingFixed",
    STAKING_CONTRACT_ADDRESS
  );

  const issues: string[] = [];

  // Check if contract is paused
  if (await stakingContract.paused()) {
    issues.push("⚠️ Contract is paused!");
  }

  // Check contract balance
  const stakingTokenAddress = await stakingContract.stakingToken();
  const stakingToken = await ethers.getContractAt(
    "IERC20",
    stakingTokenAddress
  );
  const contractBalance = await stakingToken.balanceOf(
    STAKING_CONTRACT_ADDRESS
  );
  const totalStaked = await stakingContract.getTotalValueLocked();

  if (contractBalance < totalStaked) {
    issues.push("🚨 CRITICAL: Contract balance < Total Staked!");
  }

  // Check active pools
  const protocolStats = await stakingContract.getProtocolStats();
  if (protocolStats.activePools === 0n) {
    issues.push("⚠️ No active pools exist!");
  }

  // Report results
  if (issues.length === 0) {
    console.log("✅ Health Check: All systems operating normally");
  } else {
    console.log("❌ Health Check: Issues detected:");
    issues.forEach((issue) => console.log(issue));
  }

  return issues.length === 0;
}
```

---

## 6. Troubleshooting

### 🐛 **Common Issues & Solutions**

#### **Issue 1: Transaction Failed - "Amount below minimum stake"**

```
Error: Amount below minimum stake
```

**Cause**: Trying to stake less than 1 token (MIN_STAKE_AMOUNT)

**Solution**:

```typescript
// Wrong
await stakingContract.stake(0, ethers.parseEther("0.5"));

// Correct
await stakingContract.stake(0, ethers.parseEther("1.0"));
```

#### **Issue 2: Transaction Failed - "No rewards to claim"**

```
Error: No rewards to claim
```

**Possible causes**:

1. Lockup period hasn't passed
2. Rewards were deactivated after previous claim
3. Pool is deactivated

**Checks**:

```typescript
// Check stake status
const stakeInfo = await stakingContract.getStakeInfo(userAddress, poolId);
console.log("Rewards active:", stakeInfo.rewardsActive);

// Check pending rewards
const reward = await stakingContract.getPendingReward(userAddress, poolId);
console.log("Pending reward:", ethers.formatEther(reward));

// Check if pool is active
const poolStats = await stakingContract.getPoolStats(poolId);
console.log("Pool active:", poolStats.isActive);
```

#### **Issue 3: Gas Limit Exceeded**

```
Error: Transaction ran out of gas
```

**Solution**:

```typescript
// Add manual gas limit
await stakingContract.stake(0, amount, {
  gasLimit: 300000,
});
```

#### **Issue 4: "Tokens are still locked"**

```
Error: Tokens are still locked
```

**Check**:

```typescript
// Check time remaining until unlock
const timeLeft = await stakingContract.getTimeUntilUnlock(userAddress, poolId);
console.log(`Time remaining: ${timeLeft} seconds`);
```

### 🔧 **Useful Debug Commands**

**Contract state verification:**

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Check gas usage
npx hardhat test --gas-reporter

# Analyze contract
npx hardhat size-contracts
```

**Contract interaction:**

```bash
# Open Hardhat console
npx hardhat console --network goerli

# In console:
const contract = await ethers.getContractAt("ilmtStakingFixed", "0x...");
await contract.getProtocolStats();
```

### 📝 **Logs & Events**

**Event monitoring:**

```typescript
// Listen to events in real-time
stakingContract.on("Staked", (user, poolId, amount) => {
  console.log(
    `🔥 Staked: ${user} staked ${ethers.formatEther(amount)} in pool ${poolId}`
  );
});

stakingContract.on("RewardClaimed", (user, poolId, reward) => {
  console.log(
    `💰 Reward: ${user} received ${ethers.formatEther(
      reward
    )} from pool ${poolId}`
  );
});

stakingContract.on("EmergencyWithdraw", (user, poolId, amount) => {
  console.log(
    `🚨 Emergency: ${user} withdrew ${ethers.formatEther(
      amount
    )} from pool ${poolId}`
  );
});
```

---

## 📋 **Final Production Checklist**

### ✅ **Pre-Deployment**

- [ ] All tests pass (76/76)
- [ ] Gas costs optimized
- [ ] Parameters configured correctly
- [ ] Private keys secured
- [ ] Source code backup

### ✅ **Deployment**

- [ ] Deploy on testnet and test
- [ ] Contract verification on Etherscan
- [ ] Initial pool configuration
- [ ] Testing with real users

### ✅ **Post-Deployment**

- [ ] Monitoring setup
- [ ] Documentation updated
- [ ] Team training for administration
- [ ] Emergency procedures defined
- [ ] Security audit (recommended)

---

## 🎯 **Conclusion**

This guide provides a step-by-step approach for complete implementation of the `ilmtStakingFixed` contract. Following these steps, you'll have a functional, secure, and monitored staking system.

**Key points to remember:**

- Always test on testnet before mainnet
- Constantly monitor contract state
- Keep backups of all configurations
- Document all changes and upgrades

For additional support or questions, consult the detailed technical documentation or contact the development team.
