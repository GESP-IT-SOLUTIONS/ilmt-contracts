import { ethers } from "hardhat";
import fs from 'fs';
import csvParser from 'csv-parser';
import path from 'path';

// Configuration interface
interface VestingConfig {
    shouldHaveStartedDate: string; // "2024-01-05"
    actualDeployDate: string;      // "2024-01-25"
    immediateReleaseHours: number; // 1
    csvFilePath: string;           // "./investors.csv"
    contractAddress?: string;      // Optional if deploying new contract
    tokenAddress: string;          // ILMT token address
    batchSize: number;            // Optimize for gas
    gasLimit?: number;            // Optional gas limit override
    maxGasPrice?: string;         // Optional max gas price in gwei
}

// Investor data structure
interface InvestorData {
    address: string;
    totalAllocation: number; // In ILMT (not wei)
    name?: string;           // Optional for logging
}

// Batch processing result
interface BatchResult {
    batchNumber: number;
    transactionHash: string;
    gasUsed: string;
    investorsProcessed: number;
    success: boolean;
    error?: string;
}

class RetroactiveVestingDeployer {
    private config: VestingConfig;
    private investors: InvestorData[] = [];
    private vestingContract: any;
    private tokenContract: any;
    private owner: any;
    
    constructor(config: VestingConfig) {
        this.config = config;
    }

    /**
     * Load investors from CSV file
     */
    async loadInvestorsFromCSV(): Promise<InvestorData[]> {
        return new Promise((resolve, reject) => {
            const investors: InvestorData[] = [];
            const csvPath = path.resolve(this.config.csvFilePath);

            console.log(`📄 Loading investors from: ${csvPath}`);

            if (!fs.existsSync(csvPath)) {
                reject(new Error(`CSV file not found: ${csvPath}`));
                return;
            }

            fs.createReadStream(csvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    // Expected CSV columns: address, totalAllocation, name (optional)
                    const address = row.address?.trim();
                    const totalAllocation = parseFloat(row.totalAllocation);
                    const name = row.name?.trim() || '';

                    // Validation
                    if (!address || !ethers.isAddress(address)) {
                        console.warn(`⚠️ Invalid address: ${address}`);
                        return;
                    }

                    if (!totalAllocation || totalAllocation <= 0) {
                        console.warn(`⚠️ Invalid allocation for ${address}: ${totalAllocation}`);
                        return;
                    }

                    investors.push({
                        address,
                        totalAllocation,
                        name
                    });
                })
                .on('end', () => {
                    console.log(`✅ Loaded ${investors.length} investors from CSV`);
                    this.investors = investors;
                    resolve(investors);
                })
                .on('error', (error) => {
                    console.error('❌ Error reading CSV:', error);
                    reject(error);
                });
        });
    }

    /**
     * Setup contracts and signer
     */
    async setupContracts() {
        console.log('\n🔧 Setting up contracts...');
        
        const [owner] = await ethers.getSigners();
        this.owner = owner;
        
        console.log(`👤 Owner address: ${owner.address}`);
        console.log(`💰 Owner balance: ${ethers.formatEther(await ethers.provider.getBalance(owner.address))} ETH`);

        // Setup token contract
        const tokenABI = [
            "function balanceOf(address) view returns (uint256)",
            "function transfer(address to, uint256 amount) returns (bool)",
            "function symbol() view returns (string)",
            "function decimals() view returns (uint8)"
        ];
        
        this.tokenContract = new ethers.Contract(this.config.tokenAddress, tokenABI, owner);
        
        const symbol = await this.tokenContract.symbol();
        const decimals = await this.tokenContract.decimals();
        console.log(`🪙 Token: ${symbol} (${decimals} decimals)`);

        // Setup or deploy vesting contract
        if (this.config.contractAddress) {
            // Use existing contract
            const vestingABI = [
                "function createVestingSchedule(tuple(address beneficiary, uint256 start, uint256 cliff, uint256 duration, uint256 slicePeriodSeconds, bool revocable, uint256 amount)[] params) external",
                "function getVestingSchedulesCount() external view returns (uint256)",
                "function getWithdrawableAmount() external view returns (uint256)",
                "function owner() external view returns (address)"
            ];
            
            this.vestingContract = new ethers.Contract(this.config.contractAddress, vestingABI, owner);
            console.log(`📄 Using existing vesting contract: ${this.config.contractAddress}`);
            
            // Verify ownership
            const contractOwner = await this.vestingContract.owner();
            if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
                throw new Error(`❌ Not contract owner. Owner: ${contractOwner}, Your address: ${owner.address}`);
            }
            
        } else {
            // Deploy new vesting contract
            console.log('🚀 Deploying new vesting contract...');
            const VestingFactory = await ethers.getContractFactory("ILMTVesting");
            this.vestingContract = await VestingFactory.deploy(this.config.tokenAddress);
            await this.vestingContract.waitForDeployment();
            
            console.log(`✅ Vesting contract deployed: ${this.vestingContract.target}`);
            this.config.contractAddress = this.vestingContract.target as string;
        }
    }

    /**
     * Calculate requirements and validate
     */
    async validateAndCalculate() {
        console.log('\n📊 Calculating requirements...');
        
        // Calculate timestamps
        const shouldHaveStarted = Math.floor(new Date(this.config.shouldHaveStartedDate + 'T00:00:00Z').getTime() / 1000);
        const actualDeploy = Math.floor(new Date(this.config.actualDeployDate + 'T00:00:00Z').getTime() / 1000);
        const daysDelayed = Math.floor((actualDeploy - shouldHaveStarted) / (24 * 3600));

        console.log(`📅 Timeline:`);
        console.log(`  Should have started: ${this.config.shouldHaveStartedDate}`);
        console.log(`  Actually deploying: ${this.config.actualDeployDate}`);
        console.log(`  Days delayed: ${daysDelayed} days`);

        // Calculate total tokens needed
        let totalTokensNeeded = 0n;
        let totalCompensation = 0n;
        let totalImmediate = 0n;

        console.log(`\n💰 Per-investor breakdown:`);
        console.log(`${'Address'.padEnd(42)} ${'Total'.padEnd(12)} ${'Immediate'.padEnd(12)} ${'Compensation'.padEnd(15)} ${'Name'}`);
        console.log('─'.repeat(100));

        for (const investor of this.investors) {
            const totalAllocation = ethers.parseEther(investor.totalAllocation.toString());
            const immediateAmount = totalAllocation * 10n / 100n; // 10%
            const vestingAmount = totalAllocation * 75n / 100n;   // 75%
            const dailyAmount = vestingAmount / 365n;
            const compensationAmount = dailyAmount * BigInt(daysDelayed);

            totalTokensNeeded += immediateAmount + vestingAmount;
            totalImmediate += immediateAmount;
            totalCompensation += compensationAmount;

            const shortAddress = `${investor.address.slice(0, 6)}...${investor.address.slice(-4)}`;
            console.log(
                `${shortAddress.padEnd(42)} ` +
                `${investor.totalAllocation.toString().padEnd(12)} ` +
                `${ethers.formatEther(immediateAmount).padEnd(12)} ` +
                `${ethers.formatEther(compensationAmount).padEnd(15)} ` +
                `${investor.name || ''}`
            );
        }

        console.log('─'.repeat(100));
        console.log(`Total investors: ${this.investors.length}`);
        console.log(`Total tokens needed: ${ethers.formatEther(totalTokensNeeded)} ILMT`);
        console.log(`Total immediate (10%): ${ethers.formatEther(totalImmediate)} ILMT`);
        console.log(`Total compensation (${daysDelayed} days): ${ethers.formatEther(totalCompensation)} ILMT`);

        // Check contract balance
        const contractBalance = await this.tokenContract.balanceOf(this.config.contractAddress);
        console.log(`\n🏦 Contract token balance: ${ethers.formatEther(contractBalance)} ILMT`);

        if (contractBalance < totalTokensNeeded) {
            const needed = totalTokensNeeded - contractBalance;
            console.log(`❌ Insufficient tokens in contract!`);
            console.log(`   Need additional: ${ethers.formatEther(needed)} ILMT`);
            throw new Error('Insufficient tokens in vesting contract');
        }

        console.log(`✅ Contract has sufficient tokens`);

        return {
            daysDelayed,
            totalTokensNeeded,
            totalCompensation,
            shouldHaveStarted
        };
    }

    /**
     * Generate vesting parameters with gas optimization
     */
    generateVestingParams(shouldHaveStarted: number) {
        console.log(`\n⚙️ Generating vesting parameters...`);
        
        const actualDeploy = Math.floor(new Date(this.config.actualDeployDate + 'T00:00:00Z').getTime() / 1000);
        const oneHour = 3600;
        const oneDay = 86400;
        const oneYear = oneDay * 365;

        const allParams: any[] = [];

        for (const investor of this.investors) {
            const totalAllocation = ethers.parseEther(investor.totalAllocation.toString());
            const immediateAmount = totalAllocation * 10n / 100n; // 10%
            const vestingAmount = totalAllocation * 75n / 100n;   // 75%

            // Schedule 1: Immediate 10%
            allParams.push({
                beneficiary: investor.address,
                start: actualDeploy,
                cliff: 0,
                duration: this.config.immediateReleaseHours * oneHour,
                slicePeriodSeconds: this.config.immediateReleaseHours * oneHour,
                revocable: false,
                amount: immediateAmount
            });

            // Schedule 2: Retroactive daily vesting 75%
            allParams.push({
                beneficiary: investor.address,
                start: shouldHaveStarted, // Past date for compensation
                cliff: 0,
                duration: oneYear,
                slicePeriodSeconds: oneDay,
                revocable: false,
                amount: vestingAmount
            });
        }

        console.log(`📋 Generated ${allParams.length} vesting parameters (2 per investor)`);
        return allParams;
    }

    /**
     * Estimate gas costs
     */
    async estimateGasCosts(allParams: any[]) {
        console.log(`\n⛽ Estimating gas costs...`);

        const batchCount = Math.ceil(allParams.length / this.config.batchSize);
        
        try {
            // Estimate for a small sample batch
            const sampleSize = Math.min(this.config.batchSize, allParams.length);
            const sampleParams = allParams.slice(0, sampleSize);
            
            const gasEstimate = await this.vestingContract.createVestingSchedule.estimateGas(sampleParams);
            const gasPrice = await ethers.provider.getFeeData();
            
            const gasPerBatch = gasEstimate;
            const totalGas = gasPerBatch * BigInt(batchCount);
            const totalCost = totalGas * (gasPrice.gasPrice || 0n);

            console.log(`📊 Gas Estimation:`);
            console.log(`  Parameters per batch: ${this.config.batchSize}`);
            console.log(`  Total batches: ${batchCount}`);
            console.log(`  Gas per batch: ${gasPerBatch.toLocaleString()}`);
            console.log(`  Total gas: ${totalGas.toLocaleString()}`);
            console.log(`  Gas price: ${ethers.formatUnits(gasPrice.gasPrice || 0n, 'gwei')} gwei`);
            console.log(`  Total cost: ${ethers.formatEther(totalCost)} ETH`);

            return {
                gasPerBatch,
                totalGas,
                totalCost: ethers.formatEther(totalCost),
                batchCount
            };
        } catch (error) {
            console.warn('⚠️ Could not estimate gas, using defaults');
            return null;
        }
    }

    /**
     * Execute deployment in optimized batches
     */
    async executeDeployment(allParams: any[]): Promise<BatchResult[]> {
        console.log(`\n🚀 Starting deployment...`);

        const batchCount = Math.ceil(allParams.length / this.config.batchSize);
        const results: BatchResult[] = [];

        for (let i = 0; i < batchCount; i++) {
            const batchStart = i * this.config.batchSize;
            const batchEnd = Math.min(batchStart + this.config.batchSize, allParams.length);
            const batchParams = allParams.slice(batchStart, batchEnd);
            const batchNumber = i + 1;

            console.log(`\n📦 Processing batch ${batchNumber}/${batchCount} (${batchParams.length} schedules)...`);

            try {
                // Prepare transaction with gas optimization
                const txOptions: any = {};
                
                if (this.config.gasLimit) {
                    txOptions.gasLimit = this.config.gasLimit;
                }
                
                if (this.config.maxGasPrice) {
                    txOptions.gasPrice = ethers.parseUnits(this.config.maxGasPrice, 'gwei');
                }

                // Execute transaction
                const tx = await this.vestingContract.createVestingSchedule(batchParams, txOptions);
                console.log(`  📤 Transaction sent: ${tx.hash}`);
                
                // Wait for confirmation
                const receipt = await tx.wait();
                console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
                console.log(`  ⛽ Gas used: ${receipt.gasUsed.toLocaleString()}`);

                results.push({
                    batchNumber,
                    transactionHash: tx.hash,
                    gasUsed: receipt.gasUsed.toString(),
                    investorsProcessed: batchParams.length / 2, // 2 schedules per investor
                    success: true
                });

                // Delay between batches to avoid nonce issues
                if (i < batchCount - 1) {
                    console.log(`  ⏳ Waiting 2 seconds before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error: any) {
                console.error(`  ❌ Batch ${batchNumber} failed:`, error.message);
                
                results.push({
                    batchNumber,
                    transactionHash: '',
                    gasUsed: '0',
                    investorsProcessed: 0,
                    success: false,
                    error: error.message
                });

                // Ask user if they want to continue with remaining batches
                if (i < batchCount - 1) {
                    console.log(`\n❓ Continue with remaining batches? (Y/n)`);
                    // In a real script, you might want to add readline for user input
                    // For now, we'll stop on error
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Generate summary report
     */
    generateReport(results: BatchResult[], calculations: any) {
        console.log(`\n📋 DEPLOYMENT SUMMARY REPORT`);
        console.log(`═══════════════════════════════════════════════════════`);

        const successfulBatches = results.filter(r => r.success);
        const failedBatches = results.filter(r => !r.success);
        const totalInvestorsProcessed = successfulBatches.reduce((sum, r) => sum + r.investorsProcessed, 0);
        const totalGasUsed = successfulBatches.reduce((sum, r) => sum + BigInt(r.gasUsed), 0n);

        // Timeline info
        console.log(`📅 Timeline:`);
        console.log(`  Should have started: ${this.config.shouldHaveStartedDate}`);
        console.log(`  Actually deployed: ${this.config.actualDeployDate}`);
        console.log(`  Days compensated: ${calculations.daysDelayed} days`);

        // Processing stats
        console.log(`\n📊 Processing Statistics:`);
        console.log(`  Total investors: ${this.investors.length}`);
        console.log(`  Successfully processed: ${totalInvestorsProcessed}`);
        console.log(`  Failed: ${this.investors.length - totalInvestorsProcessed}`);
        console.log(`  Success rate: ${((totalInvestorsProcessed / this.investors.length) * 100).toFixed(1)}%`);

        // Transaction stats
        console.log(`\n⛽ Gas Statistics:`);
        console.log(`  Successful batches: ${successfulBatches.length}/${results.length}`);
        console.log(`  Total gas used: ${totalGasUsed.toLocaleString()}`);
        console.log(`  Average gas per batch: ${successfulBatches.length > 0 ? (totalGasUsed / BigInt(successfulBatches.length)).toLocaleString() : 'N/A'}`);

        // Token stats
        console.log(`\n💰 Token Distribution:`);
        console.log(`  Total allocated: ${ethers.formatEther(calculations.totalTokensNeeded)} ILMT`);
        console.log(`  Immediate compensation: ${ethers.formatEther(calculations.totalCompensation)} ILMT`);

        // Batch details
        if (results.length > 0) {
            console.log(`\n📦 Batch Details:`);
            console.log(`${'Batch'.padEnd(8)} ${'Status'.padEnd(10)} ${'Investors'.padEnd(12)} ${'Gas Used'.padEnd(15)} ${'Transaction Hash'}`);
            console.log('─'.repeat(80));
            
            for (const result of results) {
                const status = result.success ? '✅ Success' : '❌ Failed';
                const hash = result.success ? `${result.transactionHash.slice(0, 10)}...` : 'N/A';
                
                console.log(
                    `${result.batchNumber.toString().padEnd(8)} ` +
                    `${status.padEnd(10)} ` +
                    `${result.investorsProcessed.toString().padEnd(12)} ` +
                    `${BigInt(result.gasUsed).toLocaleString().padEnd(15)} ` +
                    `${hash}`
                );
            }
        }

        // Failed batches details
        if (failedBatches.length > 0) {
            console.log(`\n❌ Failed Batches:`);
            for (const failed of failedBatches) {
                console.log(`  Batch ${failed.batchNumber}: ${failed.error}`);
            }
        }

        // Next steps
        console.log(`\n🎯 Next Steps for Users:`);
        console.log(`  1. Users can immediately claim ${calculations.daysDelayed} days of compensation`);
        console.log(`  2. Users can claim 10% immediate allocation after ${this.config.immediateReleaseHours} hour(s)`);
        console.log(`  3. Daily vesting continues automatically for remaining ${365 - calculations.daysDelayed} days`);
        
        console.log(`\n✅ Deployment ${successfulBatches.length === results.length ? 'COMPLETED SUCCESSFULLY' : 'PARTIALLY COMPLETED'}!`);
        
        return {
            totalInvestors: this.investors.length,
            processedInvestors: totalInvestorsProcessed,
            successRate: (totalInvestorsProcessed / this.investors.length) * 100,
            totalGasUsed: totalGasUsed.toString(),
            contractAddress: this.config.contractAddress
        };
    }

    /**
     * Main execution function
     */
    async run() {
        try {
            console.log('🚀 RETROACTIVE VESTING DEPLOYMENT SCRIPT');
            console.log('═══════════════════════════════════════════\n');

            // Step 1: Load investors
            await this.loadInvestorsFromCSV();

            // Step 2: Setup contracts
            await this.setupContracts();

            // Step 3: Validate and calculate
            const calculations = await this.validateAndCalculate();

            // Step 4: Generate vesting parameters
            const allParams = this.generateVestingParams(calculations.shouldHaveStarted);

            // Step 5: Estimate gas costs
            await this.estimateGasCosts(allParams);

            // Step 6: Confirmation prompt
            console.log(`\n❓ Ready to proceed with deployment?`);
            console.log(`   This will create ${allParams.length} vesting schedules for ${this.investors.length} investors.`);
            console.log(`   Contract: ${this.config.contractAddress}`);
            console.log(`\n⚠️  IMPORTANT: This action cannot be undone!`);
            
            // In real usage, add readline confirmation here
            console.log(`\n✅ Proceeding with deployment...`);

            // Step 7: Execute deployment
            const results = await this.executeDeployment(allParams);

            // Step 8: Generate report
            const report = this.generateReport(results, calculations);

            return report;

        } catch (error: any) {
            console.error('❌ Deployment failed:', error.message);
            throw error;
        }
    }
}

// Example configuration
const config: VestingConfig = {
    shouldHaveStartedDate: "2024-01-05",
    actualDeployDate: "2024-01-25", 
    immediateReleaseHours: 1,
    csvFilePath: "./scripts/investors.csv",
    contractAddress: process.env.VESTING_CONTRACT_ADDRESS, // Optional
    tokenAddress: process.env.ILMT_TOKEN_ADDRESS || "0x...",
    batchSize: 25, // Optimize for gas - 25 investors = 50 schedules per batch
    maxGasPrice: "20" // 20 gwei max
};

// Main execution
async function main() {
    const deployer = new RetroactiveVestingDeployer(config);
    return await deployer.run();
}

// Export for testing and reuse
export { RetroactiveVestingDeployer, VestingConfig, InvestorData };

// Run if called directly
if (require.main === module) {
    main()
        .then((report) => {
            console.log(`\n🎉 Script completed successfully!`);
            console.log(`   Processed: ${report.processedInvestors}/${report.totalInvestors} investors`);
            console.log(`   Success rate: ${report.successRate.toFixed(1)}%`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Script failed:', error);
            process.exit(1);
        });
} 