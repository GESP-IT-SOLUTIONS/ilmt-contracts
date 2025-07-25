// Example: Retroactive Airdrop Implementation
// Scenario: Daily vesting should have started on Jan 5, but deploying on Jan 25 (20 days late)

import { ethers } from 'ethers';

/**
 * RETROACTIVE SCENARIO:
 * - Users got 15% via airdrop (already done)
 * - Should have started daily vesting on Jan 5th
 * - Actually deploying on Jan 25th (20 days late)
 * - Need to compensate users for the 20 missed days
 * 
 * SOLUTION:
 * - Set vesting start date to Jan 5th (in the past)
 * - Contract will automatically calculate that 20 days worth is immediately releasable
 * - Users get immediate access to their missed daily distributions
 * - Future daily distributions continue normally
 */

class RetroactiveAirdropImplementation {
  constructor(vestingContractAddress, provider) {
    this.vestingContract = vestingContractAddress;
    this.provider = provider;
  }

  /**
   * Implement retroactive airdrop with compensation for delayed start
   * @param {Array} users - Array of user objects with {address, totalAllocation}
   * @param {Object} config - Configuration object
   * @param {Object} signer - Contract owner signer
   */
  async implementRetroactiveAirdrop(users, config, signer) {
    const {
      shouldHaveStartedDate, // When daily vesting should have started (e.g., "2024-01-05")
      actualDeployDate,      // When actually deploying (e.g., "2024-01-25")
      immediateReleaseHours = 1 // Hours for immediate 10% release
    } = config;

    // Calculate timestamps
    const shouldHaveStartedTimestamp = Math.floor(new Date(shouldHaveStartedDate + 'T00:00:00Z').getTime() / 1000);
    const actualDeployTimestamp = Math.floor(new Date(actualDeployDate + 'T00:00:00Z').getTime() / 1000);
    const daysDelayed = Math.floor((actualDeployTimestamp - shouldHaveStartedTimestamp) / (24 * 3600));

    console.log(`\n🎯 RETROACTIVE AIRDROP IMPLEMENTATION:`);
    console.log(`  Should have started: ${shouldHaveStartedDate}`);
    console.log(`  Actually deploying: ${actualDeployDate}`);
    console.log(`  Days delayed: ${daysDelayed} days`);
    console.log(`  Processing ${users.length} users`);

    const vestingContract = new ethers.Contract(
      this.vestingContract,
      [
        "function createVestingSchedule(tuple(address beneficiary, uint256 start, uint256 cliff, uint256 duration, uint256 slicePeriodSeconds, bool revocable, uint256 amount)[] params) external"
      ],
      signer
    );

    const oneHour = 3600;
    const oneDay = 86400;
    const oneYear = oneDay * 365;

    // Process users in batches
    const batchSize = 50;
    const batches = [];
    
    for (let i = 0; i < users.length; i += batchSize) {
      batches.push(users.slice(i, i + batchSize));
    }

    console.log(`\nProcessing in ${batches.length} batches...`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const vestingParams = [];

      for (const user of batch) {
        const totalAllocation = ethers.parseEther(user.totalAllocation.toString());
        const immediateAmount = totalAllocation * 10n / 100n; // 10%
        const vestingAmount = totalAllocation * 75n / 100n;   // 75%

        // Schedule 1: Immediate 10% release
        vestingParams.push({
          beneficiary: user.address,
          start: actualDeployTimestamp,
          cliff: 0,
          duration: immediateReleaseHours * oneHour,
          slicePeriodSeconds: immediateReleaseHours * oneHour,
          revocable: false,
          amount: immediateAmount
        });

        // Schedule 2: RETROACTIVE daily vesting (75%)
        // KEY: Set start date in the past!
        vestingParams.push({
          beneficiary: user.address,
          start: shouldHaveStartedTimestamp, // PAST DATE!
          cliff: 0,
          duration: oneYear,
          slicePeriodSeconds: oneDay,
          revocable: false,
          amount: vestingAmount
        });
      }

      console.log(`Creating batch ${batchIndex + 1}/${batches.length} with ${vestingParams.length} schedules`);
      
      try {
        const tx = await vestingContract.createVestingSchedule(vestingParams);
        console.log(`Batch ${batchIndex + 1} transaction: ${tx.hash}`);
        await tx.wait();
        console.log(`Batch ${batchIndex + 1} confirmed ✅`);
      } catch (error) {
        console.error(`Error in batch ${batchIndex + 1}:`, error);
        throw error;
      }
    }

    // Calculate compensation summary
    const dailyAmountPerUser = users.map(user => {
      const totalAllocation = ethers.parseEther(user.totalAllocation.toString());
      const vestingAmount = totalAllocation * 75n / 100n;
      const dailyAmount = vestingAmount / 365n;
      const compensationAmount = dailyAmount * BigInt(daysDelayed);
      
      return {
        address: user.address,
        totalAllocation: user.totalAllocation,
        dailyAmount: ethers.formatEther(dailyAmount),
        compensationAmount: ethers.formatEther(compensationAmount),
        daysCompensated: daysDelayed
      };
    });

    console.log(`\n✅ RETROACTIVE IMPLEMENTATION COMPLETE!`);
    console.log(`\n📊 COMPENSATION SUMMARY:`);
    console.log(`  Total users: ${users.length}`);
    console.log(`  Days compensated: ${daysDelayed}`);
    console.log(`  Each user can immediately claim ${daysDelayed} days of missed vesting`);
    
    return {
      success: true,
      daysDelayed,
      usersProcessed: users.length,
      compensationDetails: dailyAmountPerUser
    };
  }

  /**
   * Verify retroactive implementation for a specific user
   * @param {string} userAddress - User address to verify
   * @param {string} expectedTotal - Expected total allocation
   * @param {Object} config - Configuration with dates
   */
  async verifyRetroactiveImplementation(userAddress, expectedTotal, config) {
    const vestingContract = new ethers.Contract(
      this.vestingContract,
      [
        "function getVestingSchedulesCountByBeneficiary(address) external view returns (uint256)",
        "function getAllVestingSchedulesForBeneficiary(address) external view returns (tuple(address,uint256,uint256,uint256,uint256,bool,uint256,uint256,bool)[])",
        "function getTotalReleasableAmountForBeneficiary(address) external view returns (uint256)",
        "function computeReleasableAmount(bytes32) external view returns (uint256)",
        "function computeVestingScheduleIdForAddressAndIndex(address,uint256) external view returns (bytes32)"
      ],
      this.provider
    );

    const scheduleCount = await vestingContract.getVestingSchedulesCountByBeneficiary(userAddress);
    const schedules = await vestingContract.getAllVestingSchedulesForBeneficiary(userAddress);
    const totalReleasable = await vestingContract.getTotalReleasableAmountForBeneficiary(userAddress);

    // Calculate expected retroactive amount
    const shouldHaveStartedTimestamp = Math.floor(new Date(config.shouldHaveStartedDate + 'T00:00:00Z').getTime() / 1000);
    const actualDeployTimestamp = Math.floor(new Date(config.actualDeployDate + 'T00:00:00Z').getTime() / 1000);
    const daysDelayed = Math.floor((actualDeployTimestamp - shouldHaveStartedTimestamp) / (24 * 3600));

    const expectedTotalWei = ethers.parseEther(expectedTotal.toString());
    const expectedVesting = expectedTotalWei * 75n / 100n;
    const expectedDaily = expectedVesting / 365n;
    const expectedRetroactive = expectedDaily * BigInt(daysDelayed);

    console.log(`\n🔍 RETROACTIVE VERIFICATION FOR: ${userAddress}`);
    console.log(`  Schedule count: ${scheduleCount.toString()}`);
    console.log(`  Total releasable now: ${ethers.formatEther(totalReleasable)} ILMT`);

    if (schedules.length >= 2) {
      // Check retroactive schedule (should be second one)
      const retroactiveScheduleId = await vestingContract.computeVestingScheduleIdForAddressAndIndex(userAddress, 1);
      const retroactiveReleasable = await vestingContract.computeReleasableAmount(retroactiveScheduleId);

      console.log(`\n📅 RETROACTIVE SCHEDULE ANALYSIS:`);
      console.log(`  Expected daily amount: ${ethers.formatEther(expectedDaily)} ILMT`);
      console.log(`  Days delayed: ${daysDelayed}`);
      console.log(`  Expected retroactive: ${ethers.formatEther(expectedRetroactive)} ILMT`);
      console.log(`  Actually releasable: ${ethers.formatEther(retroactiveReleasable)} ILMT`);
      console.log(`  ✅ Compensation correct: ${retroactiveReleasable >= expectedRetroactive * 95n / 100n}`);

      // Check schedule details
      const retroSchedule = schedules[1];
      console.log(`\n📋 SCHEDULE DETAILS:`);
      console.log(`  Start time: ${new Date(Number(retroSchedule.start) * 1000).toISOString()}`);
      console.log(`  Should have started: ${config.shouldHaveStartedDate}T00:00:00Z`);
      console.log(`  Duration: ${Number(retroSchedule.duration) / (24 * 3600)} days`);
      console.log(`  Slice period: ${Number(retroSchedule.slicePeriodSeconds) / 3600} hours`);
    }

    return {
      correct: totalReleasable >= expectedRetroactive * 95n / 100n,
      scheduleCount: scheduleCount.toString(),
      totalReleasable: ethers.formatEther(totalReleasable),
      expectedRetroactive: ethers.formatEther(expectedRetroactive),
      daysCompensated: daysDelayed
    };
  }

  /**
   * Calculate what users will see in their dApp
   * @param {Array} users - Array of users
   * @param {Object} config - Configuration with dates
   */
  async simulateUserExperience(users, config) {
    const shouldHaveStartedTimestamp = Math.floor(new Date(config.shouldHaveStartedDate + 'T00:00:00Z').getTime() / 1000);
    const actualDeployTimestamp = Math.floor(new Date(config.actualDeployDate + 'T00:00:00Z').getTime() / 1000);
    const daysDelayed = Math.floor((actualDeployTimestamp - shouldHaveStartedTimestamp) / (24 * 3600));

    console.log(`\n👥 USER EXPERIENCE SIMULATION:`);
    console.log(`  Deployment date: ${config.actualDeployDate}`);
    console.log(`  Days of compensation: ${daysDelayed}`);

    for (const user of users.slice(0, 3)) { // Show first 3 users
      const totalAllocation = ethers.parseEther(user.totalAllocation.toString());
      const airdropped = totalAllocation * 15n / 100n;
      const immediate = totalAllocation * 10n / 100n;
      const vestingTotal = totalAllocation * 75n / 100n;
      const dailyAmount = vestingTotal / 365n;
      const retroactiveAmount = dailyAmount * BigInt(daysDelayed);

      console.log(`\n💰 User ${user.address}:`);
      console.log(`  Total allocation: ${ethers.formatEther(totalAllocation)} ILMT`);
      console.log(`  Already airdropped: ${ethers.formatEther(airdropped)} ILMT (15%)`);
      console.log(`  Available immediately:`);
      console.log(`    - Immediate 10%: ${ethers.formatEther(immediate)} ILMT`);
      console.log(`    - Retroactive ${daysDelayed} days: ${ethers.formatEther(retroactiveAmount)} ILMT`);
      console.log(`    - Total available now: ${ethers.formatEther(immediate + retroactiveAmount)} ILMT`);
      console.log(`  Future daily releases: ${ethers.formatEther(dailyAmount)} ILMT/day`);
      console.log(`  Remaining vesting days: ${365 - daysDelayed} days`);
    }

    console.log(`\n📱 WHAT USERS SEE IN dApp:`);
    console.log(`  "Welcome! We've compensated you for ${daysDelayed} days of delayed vesting."`);
    console.log(`  "You have immediate access to your missed daily distributions!"`);
    console.log(`  "Schedule 1: 10% available in 1 hour"`);
    console.log(`  "Schedule 2: ${daysDelayed} days of compensation available now + daily vesting continues"`);
  }
}

// Example usage for real scenario
async function implementRetroactiveScenario() {
  const contractAddress = "0x..."; // Your vesting contract address
  const provider = new ethers.JsonRpcProvider("https://...");
  const signer = new ethers.Wallet("0x...", provider); // Owner private key

  const retroactiveImpl = new RetroactiveAirdropImplementation(contractAddress, provider);

  // Configuration for your specific scenario
  const config = {
    shouldHaveStartedDate: "2024-01-05", // When you planned to start
    actualDeployDate: "2024-01-25",      // When you're actually deploying
    immediateReleaseHours: 1             // Hours for immediate 10% release
  };

  // Example users (replace with your actual user data)
  const users = [
    { address: "0x1111...", totalAllocation: 1000 },
    { address: "0x2222...", totalAllocation: 500 },
    { address: "0x3333...", totalAllocation: 2000 },
  ];

  try {
    console.log('🚀 Starting Retroactive Airdrop Implementation...');
    
    // Step 1: Show user experience simulation
    await retroactiveImpl.simulateUserExperience(users, config);

    // Step 2: Implement the retroactive vesting
    const result = await retroactiveImpl.implementRetroactiveAirdrop(users, config, signer);

    // Step 3: Verify implementation for first user
    await retroactiveImpl.verifyRetroactiveImplementation(users[0].address, users[0].totalAllocation, config);

    console.log('\n🎉 RETROACTIVE IMPLEMENTATION SUCCESS!');
    console.log(`✅ ${result.usersProcessed} users processed`);
    console.log(`✅ ${result.daysDelayed} days of compensation provided`);
    console.log(`✅ Users can immediately claim their missed daily distributions`);
    console.log(`✅ Future daily vesting continues seamlessly`);

  } catch (error) {
    console.error('❌ Implementation failed:', error);
  }
}

// Quick calculation helper
function calculateRetroactiveCompensation(totalAllocation, shouldStartDate, actualDeployDate) {
  const shouldStart = Math.floor(new Date(shouldStartDate + 'T00:00:00Z').getTime() / 1000);
  const actualDeploy = Math.floor(new Date(actualDeployDate + 'T00:00:00Z').getTime() / 1000);
  const daysDelayed = Math.floor((actualDeploy - shouldStart) / (24 * 3600));
  
  const vestingAmount = totalAllocation * 0.75; // 75%
  const dailyAmount = vestingAmount / 365;
  const compensationAmount = dailyAmount * daysDelayed;
  
  return {
    daysDelayed,
    dailyAmount,
    compensationAmount,
    totalCompensation: compensationAmount,
    summary: `${daysDelayed} days × ${dailyAmount.toFixed(4)} ILMT = ${compensationAmount.toFixed(4)} ILMT compensation`
  };
}

export { 
  RetroactiveAirdropImplementation, 
  implementRetroactiveScenario,
  calculateRetroactiveCompensation 
}; 