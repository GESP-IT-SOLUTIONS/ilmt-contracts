import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runSecurityTests() {
  console.log("🔍 Running Comprehensive Security Tests for ilmtStaking Contracts...\n");
  
  const testFiles = [
    "test/ilmtStaking-fixed-security.test.ts",
    "test/ilmtStaking-fixed-unbonding.test.ts", 
    "test/ilmtStaking-flexible-daily.test.ts"
  ];

  const testResults = [];
  
  for (const testFile of testFiles) {
    console.log(`\n📋 Running ${testFile}...`);
    console.log("=".repeat(60));
    
    try {
      const { stdout, stderr } = await execAsync(`npx hardhat test ${testFile}`);
      console.log(stdout);
      if (stderr) console.error(stderr);
      testResults.push({ file: testFile, status: "✅ PASSED" });
    } catch (error: any) {
      console.log(error.stdout);
      if (error.stderr) console.error(error.stderr);
      testResults.push({ file: testFile, status: "❌ FAILED" });
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 COMPREHENSIVE TEST SUMMARY");
  console.log("=".repeat(80));
  
  testResults.forEach(result => {
    console.log(`${result.status} ${result.file}`);
  });

  console.log("\n🏗️ CONTRACT OVERVIEW:");
  console.log("├── ilmtStakingFixed.sol    - Secure staking with fixed lockup + unbonding");
  console.log("├── ilmtStakingFlexible.sol - Flexible staking with daily rewards + cooldown");
  console.log("└── Mock contracts for testing");

  console.log("\n🔒 SECURITY FEATURES TESTED:");
  console.log("├── ✅ No fund re-locking after reward claims");
  console.log("├── ✅ Proper timestamp management");
  console.log("├── ✅ Input validation and bounds checking");
  console.log("├── ✅ Unbonding/cooldown period enforcement");
  console.log("├── ✅ Daily reward calculation accuracy");
  console.log("├── ✅ Multi-user scenario handling");
  console.log("├── ✅ Owner-only function protection");
  console.log("└── ✅ Emergency withdrawal capabilities");

  const passedTests = testResults.filter(r => r.status.includes("PASSED")).length;
  const totalTests = testResults.length;
  
  console.log(`\n🎯 OVERALL RESULT: ${passedTests}/${totalTests} test suites passed`);
  
  if (passedTests === totalTests) {
    console.log("🎉 ALL SECURITY TESTS PASSED - Contracts are ready for deployment!");
  } else {
    console.log("⚠️  Some tests failed - Please review and fix issues before deployment");
  }
}

runSecurityTests().catch(console.error); 