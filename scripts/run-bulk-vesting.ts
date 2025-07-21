import { deployBulkVesting, loadUsersFromCSV, type UserVestingData } from "./bulk-vesting-deployment";
import { ethers } from "hardhat";

async function main() {
    console.log("🚀 Starting Bulk Vesting Deployment Script");
    console.log("==========================================");

    // Get the deployer account
    const [deployer] = await ethers.getSigners();
    console.log(`📋 Deploying from account: ${deployer.address}`);

    // Replace with your actual vesting contract address
    const VESTING_CONTRACT_ADDRESS = process.env.VESTING_CONTRACT_ADDRESS || "YOUR_CONTRACT_ADDRESS_HERE";
    
    if (VESTING_CONTRACT_ADDRESS === "YOUR_CONTRACT_ADDRESS_HERE") {
        console.error("❌ Please set VESTING_CONTRACT_ADDRESS environment variable or update the script");
        process.exit(1);
    }

    // Connect to the vesting contract
    const vestingContract = await ethers.getContractAt("ILMTVesting", VESTING_CONTRACT_ADDRESS);
    console.log(`📄 Connected to vesting contract: ${VESTING_CONTRACT_ADDRESS}`);

    // Check contract balance
    const tokenAddress = await vestingContract.token();
    const tokenContract = await ethers.getContractAt("IERC20", tokenAddress);
    const contractBalance = await tokenContract.balanceOf(VESTING_CONTRACT_ADDRESS);
    const withdrawableAmount = await vestingContract.getWithdrawableAmount();
    
    console.log(`💰 Contract token balance: ${ethers.formatEther(contractBalance)} tokens`);
    console.log(`💸 Withdrawable amount: ${ethers.formatEther(withdrawableAmount)} tokens`);

    // Choose deployment method
    const deploymentMethod = process.env.DEPLOYMENT_METHOD || "hardcoded"; // "csv" or "hardcoded"

    let users: UserVestingData[] = [];

    if (deploymentMethod === "csv") {
        // Load users from CSV file
        const csvFilePath = process.env.CSV_FILE_PATH || "./scripts/users-example.csv";
        console.log(`📄 Loading users from CSV: ${csvFilePath}`);
        users = await loadUsersFromCSV(csvFilePath);
    } else {
        // Hardcoded users (for testing or small deployments)
        console.log("📝 Using hardcoded user list");
        users = [
            { address: "0x1111111111111111111111111111111111111111", amount: "1000" },
            { address: "0x2222222222222222222222222222222222222222", amount: "2000" },
            { address: "0x3333333333333333333333333333333333333333", amount: "1500" },
            { address: "0x4444444444444444444444444444444444444444", amount: "5000", cliff: 30 },
            { address: "0x5555555555555555555555555555555555555555", amount: "800", duration: 180 },
            // Add more users as needed
        ];
    }

    console.log(`👥 Total users to process: ${users.length}`);

    // Calculate total amount needed
    const totalAmount = users.reduce((sum, user) => {
        return sum + BigInt(ethers.parseEther(user.amount));
    }, BigInt(0));

    console.log(`💎 Total tokens needed: ${ethers.formatEther(totalAmount)} tokens`);

    // Check if we have enough tokens
    if (withdrawableAmount < totalAmount) {
        console.error(`❌ Insufficient tokens in contract!`);
        console.error(`   Need: ${ethers.formatEther(totalAmount)} tokens`);
        console.error(`   Available: ${ethers.formatEther(withdrawableAmount)} tokens`);
        console.error(`   Missing: ${ethers.formatEther(totalAmount - withdrawableAmount)} tokens`);
        process.exit(1);
    }

    // Configure vesting parameters
    const vestingParams = {
        startDate: new Date(), // Start immediately
        cliffDays: parseInt(process.env.CLIFF_DAYS || "0"), // Default: no cliff
        durationDays: parseInt(process.env.DURATION_DAYS || "365"), // Default: 1 year
        slicePeriodDays: parseInt(process.env.SLICE_PERIOD_DAYS || "1"), // Default: daily
        revocable: process.env.REVOCABLE !== "false" // Default: true
    };

    console.log("\n🔧 Vesting Configuration:");
    console.log(`   Start Date: ${vestingParams.startDate.toISOString()}`);
    console.log(`   Cliff Period: ${vestingParams.cliffDays} days`);
    console.log(`   Duration: ${vestingParams.durationDays} days`);
    console.log(`   Slice Period: ${vestingParams.slicePeriodDays} day(s)`);
    console.log(`   Revocable: ${vestingParams.revocable}`);

    // Ask for confirmation
    console.log("\n⚠️  IMPORTANT: This will create vesting schedules for all users!");
    console.log("   Make sure you have reviewed the user list and parameters.");
    console.log("   Type 'yes' to continue or anything else to abort:");

    // In a real scenario, you might want to add user input here
    // For now, we'll proceed automatically if not in interactive mode
    const shouldProceed = process.env.AUTO_CONFIRM === "true" || process.env.NODE_ENV === "test";
    
    if (!shouldProceed) {
        console.log("⏸️  Deployment aborted by user");
        process.exit(0);
    }

    // Deploy bulk vesting
    console.log("\n🚀 Starting bulk vesting deployment...");
    const result = await deployBulkVesting(vestingContract, users, vestingParams);

    // Final report
    console.log("\n" + "🎉".repeat(20));
    console.log("DEPLOYMENT COMPLETED!");
    console.log("🎉".repeat(20));
    console.log(`✅ Successfully processed: ${result.successfulBatches}/${result.totalBatches} batches`);
    console.log(`👥 Total users processed: ${result.totalUsers}/${users.length}`);
    console.log(`⛽ Total gas used: ${result.totalGasUsed}`);

    if (result.failedBatches > 0) {
        console.log(`❌ Failed batches: ${result.failedBatches}`);
        console.log("   Check the logs above for details on failed batches");
    }

    console.log("\n📊 You can now use the following view functions to verify:");
    console.log("   - getVestingSchedulesCount()");
    console.log("   - getVestingSchedulesTotalAmount()");
    console.log("   - getVestingSchedulesCountByBeneficiary(address)");
    console.log("   - getAllVestingSchedulesForBeneficiary(address)");
}

// Error handling
main()
    .then(() => {
        console.log("\n✅ Script completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ Script failed with error:", error);
        process.exit(1);
    }); 