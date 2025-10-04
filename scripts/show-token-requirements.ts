import * as fs from 'fs';

async function main() {
    try {
        // Load calculations
        const calculationsPath = 'scripts/vesting-calculations.json';
        
        if (!fs.existsSync(calculationsPath)) {
            console.log('❌ Nu există fișierul cu calculele. Rulează mai întâi: npm run calculate-vesting');
            process.exit(1);
        }
        
        const content = fs.readFileSync(calculationsPath, 'utf-8');
        const calculations = JSON.parse(content);
        
        // Calculate totals
        const totalAllocation = calculations.reduce((sum: number, calc: any) => sum + calc.totalAllocation, 0);
        const totalDistributed = calculations.reduce((sum: number, calc: any) => sum + calc.alreadyDistributed, 0);
        const totalImmediateClaimable = calculations.reduce((sum: number, calc: any) => sum + calc.secondSchedule.immediatelyClaimable, 0);
        const totalFirstSchedule = calculations.reduce((sum: number, calc: any) => sum + calc.firstSchedule.amount, 0);
        const totalSecondSchedule = calculations.reduce((sum: number, calc: any) => sum + calc.secondSchedule.amount, 0);
        const tokensNeeded = totalAllocation - totalDistributed;
        
        console.log('\n' + '='.repeat(80));
        console.log('💎 ILMT TOKEN REQUIREMENTS - SUMMARY');
        console.log('='.repeat(80));
        
        console.log(`📊 Total Users: ${calculations.length}`);
        console.log(`📊 Total Allocation: ${totalAllocation.toLocaleString()} ILMT`);
        console.log(`✅ Already Distributed (15%): ${totalDistributed.toLocaleString()} ILMT`);
        console.log('');
        
        console.log('🎯 EXACT TOKENS NEEDED IN VESTING CONTRACT:');
        console.log(`   💰 ${tokensNeeded.toLocaleString()} ILMT tokens`);
        console.log('');
        
        console.log('📋 BREAKDOWN:');
        console.log(`   🚀 Claimable imediat (retroactive): ${totalImmediateClaimable.toLocaleString()} ILMT`);
        console.log(`   ⏰ După 1 oră (primul schedule): ${totalFirstSchedule.toLocaleString()} ILMT`);
        console.log(`   📅 Pe parcursul anului (al doilea schedule): ${totalSecondSchedule.toLocaleString()} ILMT`);
        console.log('');
        
        console.log('🔢 PENTRU DEPLOYMENT:');
        console.log(`   💎 Wei amount: ${tokensNeeded}000000000000000000`);
        console.log(`   💎 Decimal format: ${tokensNeeded}.0`);
        console.log('');
        
        console.log('📈 SCHEDULES TO CREATE:');
        console.log(`   🎯 ${calculations.length} primul schedule (10% cu cliff 1h)`);
        console.log(`   📅 ${calculations.length} al doilea schedule (75% daily, retroactive 22 days)`);
        console.log(`   📊 Total: ${calculations.length * 2} schedules`);
        
        console.log('='.repeat(80));
        
    } catch (error: any) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 