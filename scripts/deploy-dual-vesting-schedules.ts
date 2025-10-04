import { ethers } from "hardhat";
import * as fs from 'fs';
import { calculateVestingSchedules, VestingCalculation } from './calculate-vesting-schedules';

interface DeploymentConfig {
    tokenAddress: string;
    ownerAddress: string;
    dryRun: boolean;
}

interface VestingScheduleData {
    beneficiary: string;
    amount: string;
    cliff: number;
    duration: number;
    startTime: number;
    revocable: boolean;
    scheduleType: 'immediate_cliff' | 'daily_retroactive';
    description: string;
}

async function loadCalculations(): Promise<VestingCalculation[]> {
    const calculationsPath = 'scripts/vesting-calculations.json';
    
    if (!fs.existsSync(calculationsPath)) {
        console.log('❌ Nu există fișierul cu calculele. Rulează mai întâi: npm run calculate-vesting');
        process.exit(1);
    }
    
    const content = fs.readFileSync(calculationsPath, 'utf-8');
    return JSON.parse(content);
}

function parseCSVData(csvPath: string): Array<{address: string, amount: number}> {
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    return lines.map(line => {
        const parts = line.split(',');
        return {
            address: parts[0].trim(),
            amount: parseFloat(parts[1].trim())
        };
    }).filter(item => item.address && item.amount > 0);
}

async function generateVestingSchedules(calculations: VestingCalculation[]): Promise<VestingScheduleData[]> {
    const schedules: VestingScheduleData[] = [];
    const now = Math.floor(Date.now() / 1000);
    const oneHour = 3600; // 1 hour in seconds
    const oneDay = 86400; // 1 day in seconds
    const oneYear = 365 * oneDay; // 1 year in seconds
    const retroactiveDays = 22;
    const retroactiveSeconds = retroactiveDays * oneDay;
    
    for (const calc of calculations) {
        // 1. PRIMUL VESTING SCHEDULE: 10% cu cliff de 1 oră
        schedules.push({
            beneficiary: calc.address,
            amount: ethers.parseEther(calc.firstSchedule.amount.toString()).toString(),
            cliff: oneHour, // 1 hour cliff
            duration: oneHour, // Total duration = cliff (claimable once after cliff)
            startTime: now,
            revocable: true,
            scheduleType: 'immediate_cliff',
            description: `First Schedule: ${calc.firstSchedule.amount.toLocaleString()} tokens (10%) - 1h cliff, claimable once`
        });
        
        // 2. AL DOILEA VESTING SCHEDULE: 75% pe 365 zile, început cu 22 zile în urmă
        const retroactiveStartTime = now - retroactiveSeconds;
        
        schedules.push({
            beneficiary: calc.address,
            amount: ethers.parseEther(calc.secondSchedule.amount.toString()).toString(),
            cliff: 0, // No cliff pentru ca a început deja
            duration: oneYear,
            startTime: retroactiveStartTime, // Started 22 days ago
            revocable: true,
            scheduleType: 'daily_retroactive',
            description: `Second Schedule: ${calc.secondSchedule.amount.toLocaleString()} tokens (75%) - Daily over 1 year, started ${retroactiveDays} days ago`
        });
    }
    
    return schedules;
}

async function deployVestingContract(config: DeploymentConfig) {
    console.log('\n🚀 DEPLOYING VESTING CONTRACT...\n');
    
    const VestingContract = await ethers.getContractFactory("ILMTVesting");
    
    if (config.dryRun) {
        console.log('🔍 DRY RUN MODE - Nu se face deployment real');
        console.log(`📄 Token Address: ${config.tokenAddress}`);
        console.log(`👤 Owner Address: ${config.ownerAddress}`);
        return null;
    }
    
    const vesting = await VestingContract.deploy(config.tokenAddress);
    await vesting.waitForDeployment();
    
    const vestingAddress = await vesting.getAddress();
    console.log(`✅ Vesting Contract deployed la: ${vestingAddress}`);
    
    // Transfer ownership if needed
    if (config.ownerAddress !== (await vesting.owner())) {
        console.log(`🔄 Transfering ownership to: ${config.ownerAddress}`);
        await vesting.transferOwnership(config.ownerAddress);
    }
    
    return vesting;
}

async function createVestingSchedules(vesting: any, schedules: VestingScheduleData[], dryRun: boolean) {
    console.log(`\n📅 CREATING ${schedules.length} VESTING SCHEDULES...\n`);
    
    let totalTokensNeeded = ethers.parseEther("0");
    let immediateSchedules = 0;
    let retroactiveSchedules = 0;
    
    for (let i = 0; i < schedules.length; i++) {
        const schedule = schedules[i];
        totalTokensNeeded = totalTokensNeeded + BigInt(schedule.amount);
        
        if (schedule.scheduleType === 'immediate_cliff') {
            immediateSchedules++;
        } else {
            retroactiveSchedules++;
        }
        
        console.log(`\n--- Schedule ${i + 1}/${schedules.length} ---`);
        console.log(`🎯 ${schedule.scheduleType === 'immediate_cliff' ? 'PRIMUL' : 'AL DOILEA'} SCHEDULE`);
        console.log(`👤 Beneficiary: ${schedule.beneficiary}`);
        console.log(`💰 Amount: ${ethers.formatEther(schedule.amount)} tokens`);
        console.log(`⏰ Cliff: ${schedule.cliff === 0 ? 'No cliff' : `${schedule.cliff / 3600} hour(s)`}`);
        console.log(`📅 Duration: ${schedule.duration / 86400} days`);
        console.log(`🕐 Start Time: ${new Date(schedule.startTime * 1000).toLocaleString()}`);
        console.log(`🔄 Revocable: ${schedule.revocable ? 'YES' : 'NO'}`);
        console.log(`📝 ${schedule.description}`);
        
        if (!dryRun && vesting) {
            try {
                const tx = await vesting.createVestingSchedule(
                    schedule.beneficiary,
                    schedule.startTime,
                    schedule.cliff,
                    schedule.duration,
                    1, // slicePeriodSeconds - 1 second for precision
                    schedule.revocable,
                    schedule.amount
                );
                
                console.log(`✅ Transaction hash: ${tx.hash}`);
                await tx.wait();
                console.log(`✅ Schedule created successfully!`);
                
                // Small delay between transactions
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error: any) {
                console.error(`❌ Error creating schedule for ${schedule.beneficiary}:`, error.message);
                throw error;
            }
        }
    }
    
    return {
        totalTokensNeeded,
        immediateSchedules,
        retroactiveSchedules,
        totalSchedules: schedules.length
    };
}

function displaySummary(calculations: VestingCalculation[], stats: any) {
    console.log('\n' + '='.repeat(80));
    console.log('🌟 SUMMARY FINAL - TOKENI NECESARI PENTRU CONTRACT');
    console.log('='.repeat(80));
    
    const totalAllocation = calculations.reduce((sum, calc) => sum + calc.totalAllocation, 0);
    const totalDistributed = calculations.reduce((sum, calc) => sum + calc.alreadyDistributed, 0);
    const totalImmediateClaimable = calculations.reduce((sum, calc) => sum + calc.secondSchedule.immediatelyClaimable, 0);
    const totalFirstSchedule = calculations.reduce((sum, calc) => sum + calc.firstSchedule.amount, 0);
    const totalSecondSchedule = calculations.reduce((sum, calc) => sum + calc.secondSchedule.amount, 0);
    
    console.log(`📊 Total Users: ${calculations.length}`);
    console.log(`📊 Total Allocation: ${totalAllocation.toLocaleString()} tokens`);
    console.log(`✅ Already Distributed (15%): ${totalDistributed.toLocaleString()} tokens`);
    console.log('');
    console.log('💰 TOKENI NECESARI ÎN CONTRACT:');
    console.log(`   🚀 Claimable imediat: ${totalImmediateClaimable.toLocaleString()} tokens`);
    console.log(`   ⏰ După 1 oră (primul schedule): ${totalFirstSchedule.toLocaleString()} tokens`);
    console.log(`   📅 Pe parcursul anului (al doilea schedule): ${totalSecondSchedule.toLocaleString()} tokens`);
    console.log('');
    console.log(`🎯 TOTAL NECESAR: ${(totalAllocation - totalDistributed).toLocaleString()} tokens`);
    console.log(`💎 TOTAL ÎN WEI: ${ethers.formatEther(stats.totalTokensNeeded)} tokens`);
    console.log('');
    console.log('📈 VESTING SCHEDULES CREATED:');
    console.log(`   🎯 Primul schedule (10% cu cliff 1h): ${stats.immediateSchedules}`);
    console.log(`   📅 Al doilea schedule (75% daily, retroactive): ${stats.retroactiveSchedules}`);
    console.log(`   📊 Total schedules: ${stats.totalSchedules}`);
    console.log('');
    console.log('🚨 IMPORTANT: Contractul trebuie să aibă exact');
    console.log(`    ${(totalAllocation - totalDistributed).toLocaleString()} tokens`);
    console.log('    înainte de a crea schedule-urile!');
    console.log('='.repeat(80));
}

async function main() {
    try {
        // Configuration
        const config: DeploymentConfig = {
            tokenAddress: process.env.TOKEN_ADDRESS || "0x1234567890123456789012345678901234567890",
            ownerAddress: process.env.OWNER_ADDRESS || "0x1234567890123456789012345678901234567890", 
            dryRun: process.env.DRY_RUN === "true" || !process.env.TOKEN_ADDRESS
        };
        
        if (config.dryRun) {
            console.log('🔍 RUNNING IN DRY RUN MODE');
            console.log('Pentru deployment real, setează: TOKEN_ADDRESS și OWNER_ADDRESS în .env');
        }
        
        // Load calculations
        console.log('📊 Loading vesting calculations...');
        const calculations = await loadCalculations();
        console.log(`✅ Loaded calculations for ${calculations.length} addresses`);
        
        // Generate vesting schedules
        console.log('⚙️ Generating vesting schedules...');
        const schedules = await generateVestingSchedules(calculations);
        console.log(`✅ Generated ${schedules.length} vesting schedules`);
        
        // Deploy vesting contract
        const vesting = await deployVestingContract(config);
        
        // Create vesting schedules
        const stats = await createVestingSchedules(vesting, schedules, config.dryRun);
        
        // Display final summary
        displaySummary(calculations, stats);
        
        // Save deployment info
        if (!config.dryRun && vesting) {
            const deploymentInfo = {
                vestingContract: await vesting.getAddress(),
                tokenAddress: config.tokenAddress,
                ownerAddress: config.ownerAddress,
                schedulesCreated: stats.totalSchedules,
                totalTokensNeeded: ethers.formatEther(stats.totalTokensNeeded),
                deploymentTime: new Date().toISOString(),
                users: calculations.length
            };
            
            fs.writeFileSync('scripts/deployment-info.json', JSON.stringify(deploymentInfo, null, 2));
            console.log('\n💾 Deployment info saved to: scripts/deployment-info.json');
        }
        
    } catch (error: any) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 