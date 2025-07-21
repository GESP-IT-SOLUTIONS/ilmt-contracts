import { ethers } from "hardhat";
import type { ILMTVesting } from "../typechain-types";

export interface UserVestingData {
    address: string;
    amount: string; // in ether format (e.g., "1000")
    cliff?: number; // cliff in days, default 0
    duration?: number; // duration in days, default 365
    revocable?: boolean; // default true
}

export async function deployBulkVesting(
    vestingContract: ILMTVesting,
    users: UserVestingData[],
    defaultParams: {
        startDate?: Date;
        cliffDays?: number;
        durationDays?: number;
        slicePeriodDays?: number;
        revocable?: boolean;
    } = {}
) {
    const {
        startDate = new Date(),
        cliffDays = 0,
        durationDays = 365,
        slicePeriodDays = 1,
        revocable = true
    } = defaultParams;

    const oneDay = 24 * 60 * 60;
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const cliffSeconds = cliffDays * oneDay;
    const durationSeconds = durationDays * oneDay;
    const slicePeriodSeconds = slicePeriodDays * oneDay;

    console.log(`📋 Starting bulk vesting deployment for ${users.length} users`);
    console.log(`⏰ Start date: ${startDate.toISOString()}`);
    console.log(`🏔️ Cliff period: ${cliffDays} days`);
    console.log(`⏳ Duration: ${durationDays} days`);
    console.log(`🔄 Slice period: ${slicePeriodDays} day(s)`);
    console.log(`🔒 Revocable: ${revocable}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Prepare vesting parameters
    const vestingParams = users.map(user => ({
        beneficiary: user.address,
        start: startTimestamp,
        cliff: user.cliff ? user.cliff * oneDay : cliffSeconds,
        duration: user.duration ? user.duration * oneDay : durationSeconds,
        slicePeriodSeconds: slicePeriodSeconds,
        revocable: user.revocable ?? revocable,
        amount: ethers.parseEther(user.amount)
    }));

    // Split into batches of MAX_BATCH_SIZE (100)
    const BATCH_SIZE = 100;
    const batches = [];
    for (let i = 0; i < vestingParams.length; i += BATCH_SIZE) {
        batches.push(vestingParams.slice(i, i + BATCH_SIZE));
    }

    console.log(`📦 Split into ${batches.length} batches of max ${BATCH_SIZE} users each`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const results = [];
    let totalProcessed = 0;

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`\n🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} users)...`);

        try {
            // Calculate total amount for this batch
            const batchTotal = batch.reduce((sum, param) => sum + param.amount, BigInt(0));
            console.log(`💰 Batch total amount: ${ethers.formatEther(batchTotal)} tokens`);

            // Check if contract has enough tokens
            const withdrawableAmount = await vestingContract.getWithdrawableAmount();
            if (withdrawableAmount < batchTotal) {
                throw new Error(`Insufficient tokens in contract. Need: ${ethers.formatEther(batchTotal)}, Available: ${ethers.formatEther(withdrawableAmount)}`);
            }

            // Create vesting schedules for this batch
            const tx = await vestingContract.createVestingSchedule(batch);
            console.log(`📝 Transaction sent: ${tx.hash}`);
            
            const receipt = await tx.wait();
            if (receipt) {
                console.log(`✅ Batch ${i + 1} completed successfully`);
                console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

                totalProcessed += batch.length;
                results.push({
                    batchIndex: i + 1,
                    usersProcessed: batch.length,
                    txHash: tx.hash,
                    gasUsed: receipt.gasUsed.toString(),
                    success: true
                });
            } else {
                throw new Error("Transaction receipt is null");
            }

            // Progress update
            const progress = (totalProcessed / users.length * 100).toFixed(2);
            console.log(`📊 Progress: ${totalProcessed}/${users.length} users (${progress}%)`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Batch ${i + 1} failed:`, errorMessage);
            results.push({
                batchIndex: i + 1,
                usersProcessed: batch.length,
                txHash: null,
                gasUsed: null,
                success: false,
                error: errorMessage
            });
            
            // Ask user if they want to continue
            console.log(`\n⚠️  Batch ${i + 1} failed. Continue with next batch? (y/n)`);
            // In a real scenario, you might want to add user input here
            // For now, we'll continue
        }

        // Add delay between batches to avoid rate limiting
        if (i < batches.length - 1) {
            console.log(`⏳ Waiting 2 seconds before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Summary report
    console.log('\n' + '━'.repeat(100));
    console.log('📋 BULK VESTING DEPLOYMENT SUMMARY');
    console.log('━'.repeat(100));
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalUsers = results.reduce((sum, r) => sum + r.usersProcessed, 0);
    
    console.log(`✅ Successful batches: ${successful}/${batches.length}`);
    console.log(`❌ Failed batches: ${failed}/${batches.length}`);
    console.log(`👥 Total users processed: ${totalUsers}/${users.length}`);
    
    // Calculate total gas used
    const totalGasUsed = results
        .filter(r => r.success && r.gasUsed !== null)
        .reduce((sum, r) => sum + BigInt(r.gasUsed!), BigInt(0));
    console.log(`⛽ Total gas used: ${totalGasUsed.toString()}`);

    // Show failed batches details
    if (failed > 0) {
        console.log('\n❌ Failed batches:');
        results.filter(r => !r.success).forEach(r => {
            console.log(`   Batch ${r.batchIndex}: ${r.error}`);
        });
    }

    return {
        totalBatches: batches.length,
        successfulBatches: successful,
        failedBatches: failed,
        totalUsers: totalUsers,
        totalGasUsed: totalGasUsed.toString(),
        results
    };
}

// Example usage function
export async function exampleBulkDeployment() {
    const [deployer] = await ethers.getSigners();
    
    // Get the deployed vesting contract
    const vestingAddress = "YOUR_VESTING_CONTRACT_ADDRESS"; // Replace with actual address
    const vestingContract = await ethers.getContractAt("ILMTVesting", vestingAddress);

    // Example: Large user list
    const users: UserVestingData[] = [
        { address: "0x1111111111111111111111111111111111111111", amount: "1000" },
        { address: "0x2222222222222222222222222222222222222222", amount: "2000" },
        { address: "0x3333333333333333333333333333333333333333", amount: "1500" },
        // ... add more users here
        // You can have thousands of users, they will be processed in batches
    ];

    // Default parameters for all users
    const defaultParams = {
        startDate: new Date(), // Start immediately
        cliffDays: 0, // No cliff
        durationDays: 365, // 1 year
        slicePeriodDays: 1, // Daily distribution
        revocable: true
    };

    // Deploy bulk vesting
    const result = await deployBulkVesting(vestingContract, users, defaultParams);
    console.log('\n🎉 Bulk deployment completed!');
    
    return result;
}

// Helper function to load users from CSV
export async function loadUsersFromCSV(csvFilePath: string): Promise<UserVestingData[]> {
    const fs = require('fs');
    const csv = require('csv-parser');
    
    return new Promise((resolve, reject) => {
        const users: UserVestingData[] = [];
        
        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (row: any) => {
                users.push({
                    address: row.address,
                    amount: row.amount,
                    cliff: row.cliff ? parseInt(row.cliff) : undefined,
                    duration: row.duration ? parseInt(row.duration) : undefined,
                    revocable: row.revocable ? row.revocable === 'true' : undefined
                });
            })
            .on('end', () => {
                console.log(`📄 Loaded ${users.length} users from CSV`);
                resolve(users);
            })
            .on('error', reject);
    });
}

// Run the example if this file is executed directly
if (require.main === module) {
    exampleBulkDeployment()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
} 