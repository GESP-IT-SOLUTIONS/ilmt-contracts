// Quick calculator for your real delay scenario
// Run: node scripts/calculate-delay.js

const shouldHaveStarted = "2025-06-01"; // Update with your real date
const actuallyDeploying = "2025-07-25"; // Today

function calculateDelay(startDate, deployDate) {
    const start = new Date(startDate + 'T00:00:00Z');
    const deploy = new Date(deployDate + 'T00:00:00Z');
    
    const diffTime = deploy.getTime() - start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    console.log(`📅 DELAY CALCULATION:`);
    console.log(`================================================`);
    console.log(`  Daily vesting should have started: ${startDate}`);
    console.log(`  Actually deploying today:          ${deployDate}`);
    console.log(`  Days delayed:                      ${diffDays} days`);
    
    // Example investor calculations
    const exampleInvestor = 1000; // 1000 ILMT
    const dailyVestingAmount = (exampleInvestor * 0.75) / 365; // 75% over 365 days
    const compensation = dailyVestingAmount * diffDays;
    
    console.log(`\n💰 COMPENSATION FOR 1000 ILMT INVESTOR:`);
    console.log(`  Daily vesting amount: ${dailyVestingAmount.toFixed(6)} ILMT per day`);
    console.log(`  Total compensation:   ${compensation.toFixed(6)} ILMT`);
    console.log(`  Percentage of total:  ${(compensation / exampleInvestor * 100).toFixed(2)}%`);
    
    // Vesting timeline
    const vestingEnd = new Date(start.getTime() + (365 * 24 * 60 * 60 * 1000));
    console.log(`\n📅 VESTING TIMELINE:`);
    console.log(`  Vesting starts from:  ${startDate} (original date)`);
    console.log(`  Vesting ends on:      ${vestingEnd.toISOString().split('T')[0]}`);
    console.log(`  Total duration:       365 days`);
    console.log(`  Days remaining:       ${365 - diffDays} days after deployment`);
    
    return {
        daysDelayed: diffDays,
        compensationPercentage: (compensation / exampleInvestor * 100),
        vestingEndDate: vestingEnd.toISOString().split('T')[0],
        daysRemaining: 365 - diffDays
    };
}

// Run calculation
const result = calculateDelay(shouldHaveStarted, actuallyDeploying);

console.log(`\n🎯 QUICK SUMMARY:`);
console.log(`================================================`);
console.log(`✅ Users get ${result.daysDelayed} days of compensation immediately`);
console.log(`✅ Daily vesting continues for ${result.daysRemaining} more days`);
console.log(`✅ Total vesting period: exactly 365 days from ${shouldHaveStarted}`);
console.log(`✅ No tokens lost due to delay!`);

// Export for use in deployment
module.exports = { calculateDelay, result }; 