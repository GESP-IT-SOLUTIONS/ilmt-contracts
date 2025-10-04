import { ethers } from "hardhat";
import * as fs from 'fs';

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

async function loadCalculations() {
    const calculationsPath = 'scripts/vesting-calculations.json';
    
    if (!fs.existsSync(calculationsPath)) {
        console.log('❌ Nu există fișierul cu calculele. Rulează mai întâi: npm run calculate-vesting');
        process.exit(1);
    }
    
    const content = fs.readFileSync(calculationsPath, 'utf-8');
    return JSON.parse(content);
}

function generateVestingSchedules(calculations: any[]): VestingScheduleData[] {
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

async function createVestingSchedules(vestingContractAddress: string, schedules: VestingScheduleData[], dryRun: boolean = false) {
    console.log(`\n📅 CREATING ${schedules.length} VESTING SCHEDULES...\n`);
    console.log(`🏦 Vesting Contract: ${vestingContractAddress}\n`);
    
    let totalTokensNeeded = ethers.parseEther("0");
    let immediateSchedules = 0;
    let retroactiveSchedules = 0;
    
    // Get contract instance
    let vesting: any = null;
    if (!dryRun) {
        vesting = await ethers.getContractAt("ILMTVesting", vestingContractAddress);
    }
    
    // Prepare batch of all schedules for the contract
    const contractSchedules = [];
    
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
        
        // Prepare schedule for contract (struct format)
        contractSchedules.push({
            beneficiary: schedule.beneficiary,
            start: schedule.startTime,
            cliff: schedule.cliff,
            duration: schedule.duration,
            slicePeriodSeconds: schedule.scheduleType === 'immediate_cliff' ? 1 : 86400, // 1 sec for cliff, daily for yearly
            revocable: schedule.revocable,
            amount: schedule.amount
        });
        
        if (dryRun) {
            console.log(`🔍 DRY RUN - Schedule would be created`);
        }
    }
    
    // Create all schedules in one batch transaction
    if (!dryRun && vesting && contractSchedules.length > 0) {
        try {
            console.log(`\n🚀 Creating ${contractSchedules.length} schedules in batch transaction...`);
            
            const tx = await vesting.createVestingSchedule(contractSchedules);
            console.log(`✅ Transaction hash: ${tx.hash}`);
            
            console.log(`⏳ Waiting for transaction confirmation...`);
            await tx.wait();
            console.log(`✅ All ${contractSchedules.length} schedules created successfully!`);
            
        } catch (error: any) {
            console.error(`❌ Error creating batch schedules:`, error.message);
            throw error;
        }
    } else if (!dryRun) {
        console.log(`⚠️ No schedules to create or contract not available`);
    }
    
    return {
        totalTokensNeeded,
        immediateSchedules,
        retroactiveSchedules,
        totalSchedules: schedules.length
    };
}

function displaySummary(calculations: any[], stats: any) {
    console.log('\n' + '='.repeat(80));
    console.log('🌟 VESTING SCHEDULES SUMMARY');
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
    
    console.log('🎯 TOKENI NECESARI ÎN CONTRACT:');
    console.log(`   💰 ${(totalAllocation - totalDistributed).toLocaleString()} tokens`);
    console.log(`   💎 În Wei: ${ethers.formatEther(stats.totalTokensNeeded)} tokens`);
    console.log('');
    
    console.log('📋 BREAKDOWN:');
    console.log(`   🚀 Claimable imediat: ${totalImmediateClaimable.toLocaleString()} tokens`);
    console.log(`   ⏰ După 1 oră (primul schedule): ${totalFirstSchedule.toLocaleString()} tokens`);
    console.log(`   📅 Pe parcursul anului (al doilea schedule): ${totalSecondSchedule.toLocaleString()} tokens`);
    console.log('');
    
    console.log('📈 VESTING SCHEDULES:');
    console.log(`   🎯 Primul schedule (10% cu cliff 1h): ${stats.immediateSchedules}`);
    console.log(`   📅 Al doilea schedule (75% daily, retroactive): ${stats.retroactiveSchedules}`);
    console.log(`   📊 Total schedules: ${stats.totalSchedules}`);
    
    console.log('='.repeat(80));
}

async function main() {
    try {
        const vestingContractAddress = process.env.VESTING_CONTRACT;
        const dryRun = process.env.DRY_RUN === "true" || !vestingContractAddress;
        
        if (dryRun) {
            console.log('🔍 RUNNING IN DRY RUN MODE');
            if (!vestingContractAddress) {
                console.log('Pentru crearea reală de schedules, setează: VESTING_CONTRACT=0x... în .env');
            }
        }
        
        // Load calculations
        console.log('📊 Loading vesting calculations...');
        const calculations = await loadCalculations();
        console.log(`✅ Loaded calculations for ${calculations.length} addresses`);
        
        // Generate vesting schedules
        console.log('⚙️ Generating vesting schedules...');
        const schedules = generateVestingSchedules(calculations);
        console.log(`✅ Generated ${schedules.length} vesting schedules`);
        
        // Create vesting schedules
        const contractAddress = vestingContractAddress || "0x1234567890123456789012345678901234567890";
        const stats = await createVestingSchedules(contractAddress, schedules, dryRun);
        
        // Display summary
        displaySummary(calculations, stats);
        
        if (!dryRun) {
            console.log('\n🎉 VESTING SCHEDULES CREATED SUCCESSFULLY!');
        } else {
            console.log('\n📝 Pentru a crea schedules-urile real:');
            console.log('   export VESTING_CONTRACT=0xYourContractAddress');
            console.log('   npm run create-vesting-schedules');
        }
        
    } catch (error: any) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 