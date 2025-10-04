import * as fs from 'fs';
import * as path from 'path';

// Constants at module level
const ALREADY_DISTRIBUTED_PERCENT = 0.15; // 15%
const FIRST_SCHEDULE_PERCENT = 0.10; // 10% additional
const SECOND_SCHEDULE_PERCENT = 0.75; // 75% remaining (85% - 10% = 75%)
const RETROACTIVE_DAYS = 22;
const TOTAL_VESTING_DAYS = 365;

interface VestingCalculation {
    address: string;
    totalAllocation: number;
    alreadyDistributed: number;
    remainingToDistribute: number;
    firstSchedule: {
        amount: number;
        description: string;
        cliff: number; // in hours
        claimableOnce: boolean;
    };
    secondSchedule: {
        amount: number;
        description: string;
        daysStartedAgo: number;
        totalDuration: number; // in days
        dailyAmount: number;
        immediatelyClaimable: number;
    };
}

function parseCSV(csvPath: string): Array<{address: string, amount: number}> {
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    // Check if first line looks like headers
    const firstLine = lines[0];
    const hasHeaders = firstLine.toLowerCase().includes('address') || firstLine.toLowerCase().includes('total');
    
    const dataLines = hasHeaders ? lines.slice(1) : lines;
    
    return dataLines.map(line => {
        const parts = line.split(',');
        const address = parts[0].trim();
        const amount = parseFloat(parts[1].trim());
        
        if (!address || isNaN(amount)) {
            throw new Error(`Invalid line: ${line}`);
        }
        
        return { address, amount };
    }).filter(item => item.address && item.amount > 0);
}

function calculateVestingSchedules(data: Array<{address: string, amount: number}>): VestingCalculation[] {
    return data.map(item => {
        const totalAllocation = item.amount;
        const alreadyDistributed = Math.floor(totalAllocation * ALREADY_DISTRIBUTED_PERCENT);
        const remainingToDistribute = totalAllocation - alreadyDistributed;
        
        // First schedule: 10% with 1 hour cliff, all claimable once
        const firstScheduleAmount = Math.floor(totalAllocation * FIRST_SCHEDULE_PERCENT);
        
        // Second schedule: 75% over 1 year daily, starting 22 days ago
        const secondScheduleAmount = totalAllocation - alreadyDistributed - firstScheduleAmount;
        const dailyAmount = secondScheduleAmount / TOTAL_VESTING_DAYS;
        const immediatelyClaimable = Math.floor(dailyAmount * RETROACTIVE_DAYS);
        
        return {
            address: item.address,
            totalAllocation,
            alreadyDistributed,
            remainingToDistribute,
            firstSchedule: {
                amount: firstScheduleAmount,
                description: "10% cu cliff de 1 oră, claimable o singură dată",
                cliff: 1, // 1 hour
                claimableOnce: true
            },
            secondSchedule: {
                amount: secondScheduleAmount,
                description: "75% restant pe 365 de zile cu distribuție zilnică",
                daysStartedAgo: RETROACTIVE_DAYS,
                totalDuration: TOTAL_VESTING_DAYS,
                dailyAmount: dailyAmount,
                immediatelyClaimable
            }
        };
    });
}

function displayResults(calculations: VestingCalculation[]) {
    console.log('\n=== CALCULUL VESTING SCHEDULES ===\n');
    
    calculations.forEach((calc, index) => {
        console.log(`\n--- Adresa ${index + 1}: ${calc.address} ---`);
        console.log(`📊 Total Allocation: ${calc.totalAllocation.toLocaleString()} tokeni`);
        console.log(`✅ Deja distribuit (15%): ${calc.alreadyDistributed.toLocaleString()} tokeni`);
        console.log(`⏳ Rămâne de distribuit (85%): ${calc.remainingToDistribute.toLocaleString()} tokeni`);
        
        console.log(`\n🎯 PRIMUL VESTING SCHEDULE:`);
        console.log(`   • Sumă: ${calc.firstSchedule.amount.toLocaleString()} tokeni (10% din total)`);
        console.log(`   • ${calc.firstSchedule.description}`);
        console.log(`   • Cliff: ${calc.firstSchedule.cliff} oră`);
        console.log(`   • Revocabil: DA`);
        
        console.log(`\n📅 AL DOILEA VESTING SCHEDULE:`);
        console.log(`   • Sumă: ${calc.secondSchedule.amount.toLocaleString()} tokeni (75% din total)`);
        console.log(`   • ${calc.secondSchedule.description}`);
        console.log(`   • Început: cu ${calc.secondSchedule.daysStartedAgo} zile în urmă`);
        console.log(`   • Sumă zilnică: ${calc.secondSchedule.dailyAmount.toFixed(4)} tokeni/zi`);
        console.log(`   • 🚀 CLAIMABLE IMEDIAT: ${calc.secondSchedule.immediatelyClaimable.toLocaleString()} tokeni (${calc.secondSchedule.daysStartedAgo} zile acumulate)`);
        console.log(`   • Revocabil: DA`);
        
        console.log(`\n💰 SUMMARY:`);
        console.log(`   • Total primit până acum: ${calc.alreadyDistributed.toLocaleString()} tokeni`);
        console.log(`   • Va primi imediat la deployment: ${(calc.secondSchedule.immediatelyClaimable).toLocaleString()} tokeni`);
        console.log(`   • Va primi după 1 oră: ${calc.firstSchedule.amount.toLocaleString()} tokeni`);
        console.log(`   • Va primi zilnic: ${calc.secondSchedule.dailyAmount.toFixed(4)} tokeni × ${TOTAL_VESTING_DAYS - RETROACTIVE_DAYS} zile rămase`);
        
        console.log('\n' + '='.repeat(80));
    });
    
    // Summary totals
    const totalAllocation = calculations.reduce((sum, calc) => sum + calc.totalAllocation, 0);
    const totalDistributed = calculations.reduce((sum, calc) => sum + calc.alreadyDistributed, 0);
    const totalImmediateClaimable = calculations.reduce((sum, calc) => sum + calc.secondSchedule.immediatelyClaimable, 0);
    const totalFirstSchedule = calculations.reduce((sum, calc) => sum + calc.firstSchedule.amount, 0);
    
    console.log(`\n🌟 TOTALE GENERALE:`);
    console.log(`📊 Total Allocation pentru toți: ${totalAllocation.toLocaleString()} tokeni`);
    console.log(`✅ Total deja distribuit: ${totalDistributed.toLocaleString()} tokeni`);
    console.log(`🚀 Total claimable imediat: ${totalImmediateClaimable.toLocaleString()} tokeni`);
    console.log(`🎯 Total primul schedule: ${totalFirstSchedule.toLocaleString()} tokeni`);
    console.log(`📈 Numărul de adrese: ${calculations.length}`);
}

// Main execution
function main() {
    try {
        // Check if CSV file path is provided as argument
        const csvPath = process.argv[2] || 'scripts/users-example.csv';
        
        if (!fs.existsSync(csvPath)) {
            console.error(`❌ Fișierul CSV nu există: ${csvPath}`);
            console.log('Usage: npm run calculate-vesting [path-to-csv]');
            console.log('Exemplu: npm run calculate-vesting scripts/investors.csv');
            process.exit(1);
        }
        
        console.log(`📂 Se citește fișierul: ${csvPath}`);
        
        const data = parseCSV(csvPath);
        console.log(`✅ S-au găsit ${data.length} adrese în CSV`);
        
        const calculations = calculateVestingSchedules(data);
        displayResults(calculations);
        
        // Save calculations to JSON for later use
        const outputPath = 'scripts/vesting-calculations.json';
        fs.writeFileSync(outputPath, JSON.stringify(calculations, null, 2));
        console.log(`\n💾 Calculele au fost salvate în: ${outputPath}`);
        
    } catch (error: any) {
        console.error('❌ Eroare:', error?.message || 'Unknown error');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { calculateVestingSchedules, VestingCalculation }; 