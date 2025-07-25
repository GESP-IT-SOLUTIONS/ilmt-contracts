// Example: Implementing Airdrop + Vesting Scenario
// Scenario: Users got 15% via airdrop, need 10% immediate + 75% vested daily over 1 year

import { ethers } from 'ethers';

/**
 * SCENARIO BREAKDOWN:
 * - Total allocation per user: 1000 ILMT (example)
 * - Already airdropped: 150 ILMT (15%)  ✅ DONE
 * - Immediate release: 100 ILMT (10%)   📦 Schedule 1
 * - Daily vesting: 750 ILMT (75%)       📅 Schedule 2 (365 days)
 */

class AirdropVestingImplementation {
  constructor(vestingContractAddress, provider) {
    this.vestingContract = vestingContractAddress;
    this.provider = provider;
  }

  /**
   * Create the vesting schedules for the airdrop scenario
   * @param {Array} users - Array of user objects with {address, totalAllocation}
   * @param {Object} signer - Contract owner signer
   */
  async implementAirdropVesting(users, signer) {
    const vestingContract = new ethers.Contract(
      this.vestingContract,
      [
        "function createVestingSchedule(tuple(address beneficiary, uint256 start, uint256 cliff, uint256 duration, uint256 slicePeriodSeconds, bool revocable, uint256 amount)[] params) external"
      ],
      signer
    );

    const currentTime = Math.floor(Date.now() / 1000);
    const oneDay = 86400; // 1 day in seconds
    const oneYear = oneDay * 365; // 1 year in seconds

    // Process users in batches (max 100 per batch due to MAX_BATCH_SIZE)
    const batchSize = 50; // Use 50 to be safe
    const batches = [];
    
    for (let i = 0; i < users.length; i += batchSize) {
      batches.push(users.slice(i, i + batchSize));
    }

    console.log(`Processing ${users.length} users in ${batches.length} batches`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const vestingParams = [];

      for (const user of batch) {
        // Calculate amounts (assuming totalAllocation is in wei)
        const totalAllocation = ethers.parseEther(user.totalAllocation.toString());
        const immediateAmount = totalAllocation * 10n / 100n; // 10%
        const vestingAmount = totalAllocation * 75n / 100n;   // 75%

                 // Schedule 1: Immediate 10% release (cliff = 0, very short duration for immediate release)
         vestingParams.push({
           beneficiary: user.address,
           start: currentTime,
           cliff: 0, // No cliff - immediate
           duration: 3600, // 1 hour duration for near-immediate release
           slicePeriodSeconds: 3600, // Release all after 1 hour
           revocable: false, // Not revocable for fairness
           amount: immediateAmount
         });

        // Schedule 2: Daily vesting for 75% over 1 year
        vestingParams.push({
          beneficiary: user.address,
          start: currentTime,
          cliff: 0, // No cliff - start immediately
          duration: oneYear, // 1 year total duration
          slicePeriodSeconds: oneDay, // Daily releases
          revocable: false, // Not revocable for fairness
          amount: vestingAmount
        });
      }

      console.log(`Creating batch ${batchIndex + 1}/${batches.length} with ${vestingParams.length} schedules`);
      
      try {
        const tx = await vestingContract.createVestingSchedule(vestingParams);
        console.log(`Batch ${batchIndex + 1} transaction hash: ${tx.hash}`);
        await tx.wait();
        console.log(`Batch ${batchIndex + 1} confirmed`);
      } catch (error) {
        console.error(`Error processing batch ${batchIndex + 1}:`, error);
        throw error;
      }
    }

    console.log('All vesting schedules created successfully!');
  }

  /**
   * Verify implementation for a specific user
   * @param {string} userAddress - User address to check
   * @param {string} expectedTotal - Expected total allocation
   */
  async verifyUserImplementation(userAddress, expectedTotal) {
    const vestingContract = new ethers.Contract(
      this.vestingContract,
      [
        "function getVestingSchedulesCountByBeneficiary(address) external view returns (uint256)",
        "function getAllVestingSchedulesForBeneficiary(address) external view returns (tuple(address,uint256,uint256,uint256,uint256,bool,uint256,uint256,bool)[])",
        "function getTotalReleasableAmountForBeneficiary(address) external view returns (uint256)",
        "function getTotalVestedAmountForBeneficiary(address) external view returns (uint256)"
      ],
      this.provider
    );

    const scheduleCount = await vestingContract.getVestingSchedulesCountByBeneficiary(userAddress);
    const schedules = await vestingContract.getAllVestingSchedulesForBeneficiary(userAddress);
    const totalVested = await vestingContract.getTotalVestedAmountForBeneficiary(userAddress);
    const totalReleasable = await vestingContract.getTotalReleasableAmountForBeneficiary(userAddress);

    const expectedTotalWei = ethers.parseEther(expectedTotal.toString());
    const expectedImmediate = expectedTotalWei * 10n / 100n;
    const expectedVesting = expectedTotalWei * 75n / 100n;

    console.log('\n=== VERIFICATION RESULTS ===');
    console.log(`User: ${userAddress}`);
    console.log(`Number of schedules: ${scheduleCount.toString()}`);
    console.log(`Total vested amount: ${ethers.formatEther(totalVested)} ILMT`);
    console.log(`Currently releasable: ${ethers.formatEther(totalReleasable)} ILMT`);

    if (schedules.length >= 2) {
      console.log('\n--- Schedule Details ---');
      
      // Schedule 1 (Immediate 10%)
      const schedule1 = schedules[0];
      console.log(`Schedule 1 (Immediate 10%):`);
      console.log(`  Amount: ${ethers.formatEther(schedule1.amountTotal)} ILMT`);
      console.log(`  Duration: ${Number(schedule1.duration) / 86400} days`);
      console.log(`  Slice period: ${Number(schedule1.slicePeriodSeconds) / 86400} days`);
      console.log(`  Expected: ${ethers.formatEther(expectedImmediate)} ILMT`);
      console.log(`  ✅ Correct: ${schedule1.amountTotal === expectedImmediate}`);

      // Schedule 2 (Daily vesting 75%)
      const schedule2 = schedules[1];
      console.log(`\nSchedule 2 (Daily vesting 75%):`);
      console.log(`  Amount: ${ethers.formatEther(schedule2.amountTotal)} ILMT`);
      console.log(`  Duration: ${Number(schedule2.duration) / 86400} days`);
      console.log(`  Slice period: ${Number(schedule2.slicePeriodSeconds) / 86400} days`);
      console.log(`  Expected: ${ethers.formatEther(expectedVesting)} ILMT`);
      console.log(`  ✅ Correct: ${schedule2.amountTotal === expectedVesting}`);
      console.log(`  ✅ Daily release: ${Number(schedule2.slicePeriodSeconds) === 86400}`);
      console.log(`  ✅ One year duration: ${Number(schedule2.duration) === 365 * 86400}`);
    }

    const totalContractAmount = expectedImmediate + expectedVesting;
    console.log(`\n--- Summary ---`);
    console.log(`Expected total in contract: ${ethers.formatEther(totalContractAmount)} ILMT (85%)`);
    console.log(`Actual total in contract: ${ethers.formatEther(totalVested)} ILMT`);
    console.log(`Already airdropped: ${expectedTotal * 0.15} ILMT (15%)`);
    console.log(`Grand total allocation: ${expectedTotal} ILMT (100%)`);
    console.log(`✅ Implementation correct: ${totalVested === totalContractAmount}`);

    return {
      correct: totalVested === totalContractAmount,
      scheduleCount: scheduleCount.toString(),
      totalVested: ethers.formatEther(totalVested),
      totalReleasable: ethers.formatEther(totalReleasable),
      schedules: schedules.map((s, i) => ({
        index: i,
        amount: ethers.formatEther(s.amountTotal),
        duration: Number(s.duration) / 86400,
        slicePeriod: Number(s.slicePeriodSeconds) / 86400,
        cliff: Number(s.cliff),
        revocable: s.revocable
      }))
    };
  }

  /**
   * Generate user data from CSV or array
   * @param {string} csvPath - Path to CSV file with user data
   * @returns {Array} Processed user data
   */
  async generateUserDataFromCSV(csvPath) {
    const fs = require('fs');
    const csvParser = require('csv-parser');

    return new Promise((resolve, reject) => {
      const users = [];
      
      fs.createReadStream(csvPath)
        .pipe(csvParser())
        .on('data', (row) => {
          // Assuming CSV has columns: address, totalAllocation
          users.push({
            address: row.address,
            totalAllocation: parseFloat(row.totalAllocation)
          });
        })
        .on('end', () => {
          console.log(`Loaded ${users.length} users from CSV`);
          resolve(users);
        })
        .on('error', reject);
    });
  }

  /**
   * Calculate total tokens needed for the contract
   * @param {Array} users - Array of user objects
   * @returns {string} Total tokens needed (in ILMT, not wei)
   */
  calculateTotalTokensNeeded(users) {
    let total = 0;
    
    for (const user of users) {
      // 85% goes to vesting contract (10% immediate + 75% vesting)
      total += user.totalAllocation * 0.85;
    }
    
    return total.toString();
  }
}

// Example usage script:
async function implementAirdropScenario() {
  const contractAddress = "0x..."; // Your vesting contract address
  const provider = new ethers.JsonRpcProvider("https://...");
  const signer = new ethers.Wallet("0x...", provider); // Owner private key

  const airdropImpl = new AirdropVestingImplementation(contractAddress, provider);

  // Example users data
  const users = [
    { address: "0x1111...", totalAllocation: 1000 }, // 1000 ILMT total
    { address: "0x2222...", totalAllocation: 500 },  // 500 ILMT total
    { address: "0x3333...", totalAllocation: 2000 }, // 2000 ILMT total
  ];

  // Or load from CSV:
  // const users = await airdropImpl.generateUserDataFromCSV('./users-airdrop.csv');

  console.log('=== AIRDROP VESTING IMPLEMENTATION ===');
  console.log(`Processing ${users.length} users`);
  
  const totalNeeded = airdropImpl.calculateTotalTokensNeeded(users);
  console.log(`Total tokens needed in contract: ${totalNeeded} ILMT`);

  try {
    // Step 1: Implement vesting schedules
    await airdropImpl.implementAirdropVesting(users, signer);

    // Step 2: Verify implementation for first user
    await airdropImpl.verifyUserImplementation(users[0].address, users[0].totalAllocation);

    console.log('\n✅ Airdrop vesting implementation completed successfully!');
    
    // Step 3: Show user experience
    console.log('\n=== USER EXPERIENCE ===');
    console.log('Each user will see:');
    console.log('1. Schedule #1: 10% available immediately');
    console.log('2. Schedule #2: 75% vesting daily over 365 days');
    console.log('3. Total: 85% through vesting contract + 15% already airdropped = 100%');

  } catch (error) {
    console.error('Implementation failed:', error);
  }
}

// CSV format example (users-airdrop.csv):
/*
address,totalAllocation
0x1234567890123456789012345678901234567890,1000
0x2345678901234567890123456789012345678901,500
0x3456789012345678901234567890123456789012,2000
*/

export { AirdropVestingImplementation, implementAirdropScenario }; 