import { ethers } from "hardhat";
import fs from 'fs';
import csvParser from 'csv-parser';
import path from 'path';

interface FundingConfig {
    vestingContractAddress: string;
    tokenAddress: string;
    csvFilePath: string;
    dryRun?: boolean; // Just check, don't transfer
}

class VestingContractFunder {
    private config: FundingConfig;
    private tokenContract: any;
    private owner: any;
    private investors: any[] = [];

    constructor(config: FundingConfig) {
        this.config = config;
    }

    async loadInvestorsFromCSV(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const investors: any[] = [];
            const csvPath = path.resolve(this.config.csvFilePath);

            console.log(`📄 Loading investors from: ${csvPath}`);

            fs.createReadStream(csvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    const address = row.address?.trim();
                    const totalAllocation = parseFloat(row.totalAllocation);

                    if (address && ethers.isAddress(address) && totalAllocation > 0) {
                        investors.push({ address, totalAllocation });
                    }
                })
                .on('end', () => {
                    console.log(`✅ Loaded ${investors.length} investors`);
                    resolve(investors);
                })
                .on('error', reject);
        });
    }

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
            "function decimals() view returns (uint8)",
            "function allowance(address owner, address spender) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)"
        ];
        
        this.tokenContract = new ethers.Contract(this.config.tokenAddress, tokenABI, owner);
        
        const symbol = await this.tokenContract.symbol();
        const decimals = await this.tokenContract.decimals();
        console.log(`🪙 Token: ${symbol} (${decimals} decimals)`);
    }

    async calculateTokenRequirements() {
        console.log('\n📊 Calculating token requirements...');

        let totalTokensNeeded = 0n;
        let totalImmediate = 0n;
        let totalVesting = 0n;

        console.log(`💰 Token breakdown:`);
        console.log(`${'Address'.padEnd(42)} ${'Total'.padEnd(12)} ${'Immediate'.padEnd(12)} ${'Vesting'.padEnd(12)}`);
        console.log('─'.repeat(90));

        for (const investor of this.investors) {
            const totalAllocation = ethers.parseEther(investor.totalAllocation.toString());
            const immediateAmount = totalAllocation * 10n / 100n; // 10%
            const vestingAmount = totalAllocation * 75n / 100n;   // 75%

            totalTokensNeeded += immediateAmount + vestingAmount;
            totalImmediate += immediateAmount;
            totalVesting += vestingAmount;

            const shortAddress = `${investor.address.slice(0, 6)}...${investor.address.slice(-4)}`;
            console.log(
                `${shortAddress.padEnd(42)} ` +
                `${investor.totalAllocation.toString().padEnd(12)} ` +
                `${ethers.formatEther(immediateAmount).padEnd(12)} ` +
                `${ethers.formatEther(vestingAmount).padEnd(12)}`
            );
        }

        console.log('─'.repeat(90));
        console.log(`Total investors: ${this.investors.length}`);
        console.log(`Total tokens needed: ${ethers.formatEther(totalTokensNeeded)} ILMT`);
        console.log(`  - Immediate (10%): ${ethers.formatEther(totalImmediate)} ILMT`);
        console.log(`  - Vesting (75%):   ${ethers.formatEther(totalVesting)} ILMT`);

        return {
            totalTokensNeeded,
            totalImmediate,
            totalVesting,
            investorCount: this.investors.length
        };
    }

    async checkContractBalance(requirements: any) {
        console.log('\n🏦 Checking contract balances...');

        // Check vesting contract balance
        const contractBalance = BigInt(await this.tokenContract.balanceOf(this.config.vestingContractAddress));
        console.log(`📄 Vesting contract: ${this.config.vestingContractAddress}`);
        console.log(`💰 Current balance: ${ethers.formatEther(contractBalance)} ILMT`);
        console.log(`🎯 Required balance: ${ethers.formatEther(requirements.totalTokensNeeded)} ILMT`);

        const deficit = requirements.totalTokensNeeded - contractBalance;
        
        if (deficit > 0) {
            console.log(`❌ DEFICIT: ${ethers.formatEther(deficit)} ILMT`);
            
            // Check owner balance
            const ownerBalance = await this.tokenContract.balanceOf(this.owner.address);
            console.log(`\n👤 Owner token balance: ${ethers.formatEther(ownerBalance)} ILMT`);
            
            if (ownerBalance >= deficit) {
                console.log(`✅ Owner has sufficient tokens to cover deficit`);
                return { needsTransfer: true, deficit, canTransfer: true };
            } else {
                console.log(`❌ Owner doesn't have enough tokens!`);
                console.log(`   Owner has: ${ethers.formatEther(ownerBalance)} ILMT`);
                console.log(`   Still need: ${ethers.formatEther(deficit - ownerBalance)} ILMT`);
                return { needsTransfer: true, deficit, canTransfer: false };
            }
        } else {
            console.log(`✅ Contract has sufficient tokens`);
            if (deficit < 0) {
                console.log(`💎 Extra tokens: ${ethers.formatEther(-deficit)} ILMT`);
            }
            return { needsTransfer: false, deficit: BigInt(0), canTransfer: true };
        }
    }

    async transferTokens(deficit: bigint) {
        console.log(`\n💸 Transferring ${ethers.formatEther(deficit)} ILMT to vesting contract...`);

        if (this.config.dryRun) {
            console.log(`🔍 DRY RUN: Would transfer ${ethers.formatEther(deficit)} ILMT`);
            return { success: true, txHash: "DRY_RUN" };
        }

        try {
            console.log(`📤 Initiating transfer...`);
            const tx = await this.tokenContract.transfer(this.config.vestingContractAddress, deficit);
            console.log(`📝 Transaction sent: ${tx.hash}`);
            
            console.log(`⏳ Waiting for confirmation...`);
            const receipt = await tx.wait();
            console.log(`✅ Transfer confirmed in block ${receipt.blockNumber}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toLocaleString()}`);

            // Verify the transfer
            const newBalance = await this.tokenContract.balanceOf(this.config.vestingContractAddress);
            console.log(`🏦 New contract balance: ${ethers.formatEther(newBalance)} ILMT`);

            return { success: true, txHash: tx.hash };
        } catch (error: any) {
            console.error(`❌ Transfer failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async run() {
        try {
            console.log('🏦 VESTING CONTRACT FUNDING SCRIPT');
            console.log('═══════════════════════════════════════════\n');

            // Step 1: Load investors
            this.investors = await this.loadInvestorsFromCSV();

            // Step 2: Setup contracts
            await this.setupContracts();

            // Step 3: Calculate requirements
            const requirements = await this.calculateTokenRequirements();

            // Step 4: Check current balance
            const balanceCheck = await this.checkContractBalance(requirements);

            if (!balanceCheck.needsTransfer) {
                console.log(`\n🎉 READY TO DEPLOY!`);
                console.log(`Contract is already funded and ready for vesting schedule creation.`);
                return { 
                    status: 'ready',
                    contractBalance: 'sufficient',
                    nextStep: 'Run deployment script'
                };
            }

            if (!balanceCheck.canTransfer) {
                console.log(`\n❌ CANNOT PROCEED!`);
                console.log(`You need to acquire more ILMT tokens before deployment.`);
                return {
                    status: 'blocked',
                    contractBalance: 'insufficient',
                    nextStep: 'Acquire more ILMT tokens'
                };
            }

            // Step 5: Transfer tokens if needed and not dry run
            const transferResult = await this.transferTokens(balanceCheck.deficit);

            if (transferResult.success) {
                console.log(`\n🎉 FUNDING COMPLETED SUCCESSFULLY!`);
                console.log(`✅ Contract is now funded and ready for vesting schedule creation.`);
                console.log(`\n🚀 Next step: Run the deployment script:`);
                console.log(`   npm run deploy:retroactive`);
                
                return {
                    status: 'funded',
                    contractBalance: 'sufficient',
                    transferTxHash: transferResult.txHash,
                    nextStep: 'Run deployment script'
                };
            } else {
                console.log(`\n❌ FUNDING FAILED!`);
                console.log(`Error: ${transferResult.error}`);
                return {
                    status: 'failed',
                    contractBalance: 'insufficient',
                    error: transferResult.error,
                    nextStep: 'Fix error and retry'
                };
            }

        } catch (error: any) {
            console.error('❌ Script failed:', error.message);
            throw error;
        }
    }
}

// Configuration
const fundingConfig: FundingConfig = {
    vestingContractAddress: process.env.VESTING_CONTRACT_ADDRESS || "0x...",
    tokenAddress: process.env.ILMT_TOKEN_ADDRESS || "0x...", 
    csvFilePath: "./scripts/investors.csv",
    dryRun: process.env.DRY_RUN === "true" // Set DRY_RUN=true to just check
};

// Main execution
async function main() {
    const funder = new VestingContractFunder(fundingConfig);
    return await funder.run();
}

// Export for testing
export { VestingContractFunder, FundingConfig };

// Run if called directly
if (require.main === module) {
    main()
        .then((result) => {
            console.log(`\n✅ Funding script completed!`);
            console.log(`Status: ${result.status}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Funding script failed:', error);
            process.exit(1);
        });
} 