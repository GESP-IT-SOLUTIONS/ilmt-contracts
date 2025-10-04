import hre from "hardhat";
const { ethers } = hre;
import * as fs from 'fs';

interface DeploymentInfo {
    vestingContract: string;
    tokenAddress: string;
    ownerAddress: string;
    totalTokensNeeded: string;
    users: number;
}

interface FundingConfig {
    vestingContract: string;
    tokenAddress: string;
    amount: string;
    dryRun: boolean;
}

async function loadDeploymentInfo(): Promise<DeploymentInfo | null> {
    const deploymentPath = 'scripts/deployment-info.json';
    
    if (!fs.existsSync(deploymentPath)) {
        return null;
    }
    
    const content = fs.readFileSync(deploymentPath, 'utf-8');
    return JSON.parse(content);
}

async function loadVestingCalculations() {
    const calculationsPath = 'scripts/vesting-calculations.json';
    
    if (!fs.existsSync(calculationsPath)) {
        throw new Error('Nu există fișierul cu calculele. Rulează mai întâi: npm run calculate-vesting');
    }
    
    const content = fs.readFileSync(calculationsPath, 'utf-8');
    const calculations = JSON.parse(content);
    
    // Calculate total tokens needed
    const totalAllocation = calculations.reduce((sum: number, calc: any) => sum + calc.totalAllocation, 0);
    const totalDistributed = calculations.reduce((sum: number, calc: any) => sum + calc.alreadyDistributed, 0);
    const tokensNeeded = totalAllocation - totalDistributed;
    
    return {
        calculations,
        tokensNeeded,
        totalUsers: calculations.length,
        totalAllocation,
        totalDistributed
    };
}

async function checkTokenBalance(tokenAddress: string, holderAddress: string, requiredAmount: bigint) {
    const token = await ethers.getContractAt("IERC20", tokenAddress);
    const balance = await token.balanceOf(holderAddress);
    const symbol = await token.symbol();
    
    console.log(`💰 Balance check pentru ${symbol}:`);
    console.log(`   📊 Required: ${ethers.formatEther(requiredAmount)} tokens`);
    console.log(`   💎 Available: ${ethers.formatEther(balance)} tokens`);
    console.log(`   ✅ Sufficient: ${balance >= requiredAmount ? 'YES' : 'NO'}`);
    
    if (balance < requiredAmount) {
        const shortfall = requiredAmount - balance;
        console.log(`   ❌ Shortfall: ${ethers.formatEther(shortfall)} tokens`);
        throw new Error(`Insufficient token balance. Need ${ethers.formatEther(shortfall)} more tokens.`);
    }
    
    return { balance, symbol };
}

async function checkVestingContractBalance(vestingAddress: string, tokenAddress: string) {
    const token = await ethers.getContractAt("IERC20", tokenAddress);
    const balance = await token.balanceOf(vestingAddress);
    const symbol = await token.symbol();
    
    console.log(`🏦 Vesting contract balance:`);
    console.log(`   💎 Current: ${ethers.formatEther(balance)} ${symbol}`);
    
    return balance;
}

async function fundVestingContract(config: FundingConfig) {
    const [signer] = await ethers.getSigners();
    const signerAddress = await signer.getAddress();
    
    console.log('\n🚀 FUNDING VESTING CONTRACT...\n');
    console.log(`👤 Signer: ${signerAddress}`);
    console.log(`🏦 Vesting Contract: ${config.vestingContract}`);
    console.log(`💎 Token Contract: ${config.tokenAddress}`);
    console.log(`💰 Amount: ${ethers.formatEther(config.amount)} tokens`);
    
    if (config.dryRun) {
        console.log('\n🔍 DRY RUN MODE - Nu se fac transferuri reale\n');
        return;
    }
    
    // Check balances
    await checkTokenBalance(config.tokenAddress, signerAddress, BigInt(config.amount));
    const currentBalance = await checkVestingContractBalance(config.vestingContract, config.tokenAddress);
    
    // Get token contract
    const token = await ethers.getContractAt("IERC20", config.tokenAddress);
    const symbol = await token.symbol();
    
    // Check allowance
    const allowance = await token.allowance(signerAddress, config.vestingContract);
    console.log(`\n🔐 Allowance check:`);
    console.log(`   💎 Current allowance: ${ethers.formatEther(allowance)} ${symbol}`);
    console.log(`   📊 Required: ${ethers.formatEther(config.amount)} ${symbol}`);
    
    if (allowance < BigInt(config.amount)) {
        console.log(`\n⏳ Approving token transfer...`);
        const approveTx = await token.approve(config.vestingContract, config.amount);
        console.log(`   🔄 Transaction hash: ${approveTx.hash}`);
        await approveTx.wait();
        console.log(`   ✅ Approval successful!`);
    } else {
        console.log(`   ✅ Sufficient allowance already exists`);
    }
    
    // Transfer tokens
    console.log(`\n💸 Transferring tokens to vesting contract...`);
    const transferTx = await token.transfer(config.vestingContract, config.amount);
    console.log(`   🔄 Transaction hash: ${transferTx.hash}`);
    await transferTx.wait();
    console.log(`   ✅ Transfer successful!`);
    
    // Verify final balance
    const finalBalance = await checkVestingContractBalance(config.vestingContract, config.tokenAddress);
    const expectedBalance = currentBalance + BigInt(config.amount);
    
    console.log(`\n🎯 Final verification:`);
    console.log(`   💎 Expected balance: ${ethers.formatEther(expectedBalance)} ${symbol}`);
    console.log(`   💎 Actual balance: ${ethers.formatEther(finalBalance)} ${symbol}`);
    console.log(`   ✅ Success: ${finalBalance >= expectedBalance ? 'YES' : 'NO'}`);
    
    if (finalBalance < expectedBalance) {
        throw new Error('Transfer verification failed!');
    }
}

async function displayFundingSummary(data: any) {
    console.log('\n' + '='.repeat(80));
    console.log('💰 FUNDING SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`📊 Total Users: ${data.totalUsers}`);
    console.log(`📊 Total Allocation: ${data.totalAllocation.toLocaleString()} tokens`);
    console.log(`✅ Already Distributed (15%): ${data.totalDistributed.toLocaleString()} tokens`);
    console.log(`💰 Tokens Needed in Contract: ${data.tokensNeeded.toLocaleString()} tokens`);
    console.log(`💎 Amount in Wei: ${ethers.formatEther(ethers.parseEther(data.tokensNeeded.toString()))} tokens`);
    
    console.log('\n📋 BREAKDOWN:');
    
    const immediateClaimable = data.calculations.reduce((sum: number, calc: any) => sum + calc.secondSchedule.immediatelyClaimable, 0);
    const firstSchedule = data.calculations.reduce((sum: number, calc: any) => sum + calc.firstSchedule.amount, 0);
    const secondSchedule = data.calculations.reduce((sum: number, calc: any) => sum + calc.secondSchedule.amount, 0);
    
    console.log(`   🚀 Claimable imediat: ${immediateClaimable.toLocaleString()} tokens`);
    console.log(`   ⏰ După 1 oră (primul schedule): ${firstSchedule.toLocaleString()} tokens`);
    console.log(`   📅 Pe parcursul anului (al doilea schedule): ${secondSchedule.toLocaleString()} tokens`);
    
    console.log('\n🚨 ASIGURĂ-TE CĂ:');
    console.log('   1. Ai suficienți tokeni în wallet');
    console.log('   2. Contractul de vesting este deployed');
    console.log('   3. Ai setat corect TOKEN_ADDRESS și VESTING_CONTRACT');
    console.log('='.repeat(80));
}

async function main() {
    try {
        const dryRun = process.env.DRY_RUN === "true";
        
        if (dryRun) {
            console.log('🔍 RUNNING IN DRY RUN MODE');
        }
        
        // Load vesting calculations
        console.log('📊 Loading vesting calculations...');
        const data = await loadVestingCalculations();
        
        // Display funding summary
        await displayFundingSummary(data);
        
        // Get configuration
        let config: FundingConfig;
        
        // Try to load from deployment info first
        const deploymentInfo = await loadDeploymentInfo();
        
        if (deploymentInfo && !process.env.VESTING_CONTRACT) {
            console.log('\n✅ Using deployment info from previous deployment');
            config = {
                vestingContract: deploymentInfo.vestingContract,
                tokenAddress: deploymentInfo.tokenAddress,
                amount: ethers.parseEther(data.tokensNeeded.toString()).toString(),
                dryRun
            };
        } else {
            // Use environment variables
            const vestingContract = process.env.VESTING_CONTRACT;
            const tokenAddress = process.env.TOKEN_ADDRESS;
            
            if (!vestingContract || !tokenAddress) {
                console.log('\n❌ Missing configuration. Set environment variables:');
                console.log('   - VESTING_CONTRACT: address of deployed vesting contract');
                console.log('   - TOKEN_ADDRESS: address of ILMT token contract');
                console.log('\n   Or run deployment first: npm run deploy:dual-vesting');
                process.exit(1);
            }
            
            config = {
                vestingContract,
                tokenAddress,
                amount: ethers.parseEther(data.tokensNeeded.toString()).toString(),
                dryRun
            };
        }
        
        // Fund the contract
        await fundVestingContract(config);
        
        console.log('\n🎉 FUNDING COMPLETED SUCCESSFULLY!');
        console.log('\n📝 Next steps:');
        console.log('   1. Verify contract balance');
        console.log('   2. Test vesting schedules');
        console.log('   3. Notify users about their allocations');
        
    } catch (error: any) {
        console.error('❌ Funding failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 