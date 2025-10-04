import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ILMTVesting } from "../typechain-types";
import * as fs from 'fs';

interface TestUser {
    address: string;
    totalAllocation: number;
    alreadyDistributed: number;
    firstScheduleAmount: number;
    secondScheduleAmount: number;
    immediatelyClaimable: number;
}

describe("🧪 Vesting Distribution Validation", function () {
    let vesting: ILMTVesting;
    let token: any;
    let owner: SignerWithAddress;
    let users: SignerWithAddress[];
    let testUsers: TestUser[];
    
    // Constants matching the real scenario
    const ALREADY_DISTRIBUTED_PERCENT = 0.15; // 15%
    const FIRST_SCHEDULE_PERCENT = 0.10; // 10%
    const RETROACTIVE_DAYS = 22;
    const TOTAL_VESTING_DAYS = 365;
    const ONE_HOUR = 3600;
    const ONE_DAY = 86400;
    const ONE_YEAR = 365 * ONE_DAY;

    before(async function () {
        console.log("\n🚀 Setting up vesting distribution test...");
        
        // Get signers
        [owner, ...users] = await ethers.getSigners();
        
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        token = await MockToken.deploy("ILMT Token", "ILMT", ethers.parseEther("10000000")); // 10M tokens
        
        // Deploy vesting contract
        const VestingContract = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingContract.deploy(await token.getAddress());
        
        // Load real user data and prepare test data
        await loadTestUsers();
        
        console.log(`✅ Test setup complete with ${testUsers.length} users`);
    });

    async function loadTestUsers() {
        console.log("📂 Loading real user data...");
        
        // Load calculations from the real file
        const calculationsPath = 'scripts/vesting-calculations.json';
        if (!fs.existsSync(calculationsPath)) {
            throw new Error('❌ Run "npm run calculate-vesting" first to generate calculations');
        }
        
        const calculations = JSON.parse(fs.readFileSync(calculationsPath, 'utf-8'));
        
        // Convert to test format (take first 3 users for faster testing)
        testUsers = calculations.slice(0, 3).map((calc: any, index: number) => ({
            address: users[index].address, // Use test addresses
            totalAllocation: calc.totalAllocation,
            alreadyDistributed: calc.alreadyDistributed,
            firstScheduleAmount: calc.firstSchedule.amount,
            secondScheduleAmount: calc.secondSchedule.amount,
            immediatelyClaimable: calc.secondSchedule.immediatelyClaimable
        }));
        
        console.log(`✅ Loaded ${testUsers.length} test users from real data`);
    }

    describe("📊 Distribution Validation", function () {
        
        it("Should validate calculation correctness", async function () {
            console.log("\n🔍 Validating calculations...");
            
            for (const user of testUsers) {
                // Validate percentages
                const expectedDistributed = Math.floor(user.totalAllocation * ALREADY_DISTRIBUTED_PERCENT);
                const expectedFirstSchedule = Math.floor(user.totalAllocation * FIRST_SCHEDULE_PERCENT);
                const expectedSecondSchedule = user.totalAllocation - expectedDistributed - expectedFirstSchedule;
                
                expect(user.alreadyDistributed).to.equal(expectedDistributed, 
                    `❌ Already distributed mismatch for ${user.address}`);
                expect(user.firstScheduleAmount).to.equal(expectedFirstSchedule,
                    `❌ First schedule amount mismatch for ${user.address}`);
                expect(user.secondScheduleAmount).to.equal(expectedSecondSchedule,
                    `❌ Second schedule amount mismatch for ${user.address}`);
                
                // Validate retroactive calculation
                const dailyAmount = expectedSecondSchedule / TOTAL_VESTING_DAYS;
                const expectedImmediate = Math.floor(dailyAmount * RETROACTIVE_DAYS);
                
                expect(user.immediatelyClaimable).to.equal(expectedImmediate,
                    `❌ Immediately claimable mismatch for ${user.address}`);
            }
            
            console.log("✅ All calculations validated correctly");
        });

        it("Should fund contract with exact tokens needed", async function () {
            console.log("\n💰 Funding vesting contract...");
            
            // Calculate total tokens needed
            const totalNeeded = testUsers.reduce((sum, user) => 
                sum + user.firstScheduleAmount + user.secondScheduleAmount, 0);
            
            const tokenAmount = ethers.parseEther(totalNeeded.toString());
            
            // Transfer tokens to vesting contract
            await token.transfer(await vesting.getAddress(), tokenAmount);
            
            const contractBalance = await token.balanceOf(await vesting.getAddress());
            expect(contractBalance).to.equal(tokenAmount, "❌ Contract funding mismatch");
            
            console.log(`✅ Contract funded with ${ethers.formatEther(tokenAmount)} tokens`);
        });

        it("Should create all vesting schedules correctly", async function () {
            console.log("\n📅 Creating vesting schedules...");
            
            const now = Math.floor(Date.now() / 1000);
            const retroactiveStart = now - (RETROACTIVE_DAYS * ONE_DAY);
            
            // Prepare batch of schedules for all users
            const allSchedules = [];
            
            for (let i = 0; i < testUsers.length; i++) {
                const user = testUsers[i];
                const userSigner = users[i];
                
                // First schedule (10% with 1 hour cliff)
                allSchedules.push({
                    beneficiary: userSigner.address,
                    start: now,
                    cliff: ONE_HOUR, // 1 hour relative cliff
                    duration: ONE_HOUR, // total duration is 1 hour (claimable once after cliff)
                    slicePeriodSeconds: 1,
                    revocable: true,
                    amount: ethers.parseEther(user.firstScheduleAmount.toString())
                });
                
                // Second schedule (75% daily, retroactive)
                allSchedules.push({
                    beneficiary: userSigner.address,
                    start: retroactiveStart,
                    cliff: 0, // no cliff (starts immediately)
                    duration: ONE_YEAR, // 1 year duration
                    slicePeriodSeconds: ONE_DAY, // daily releases
                    revocable: true,
                    amount: ethers.parseEther(user.secondScheduleAmount.toString())
                });
            }
            
            console.log(`Creating ${allSchedules.length} schedules in batch...`);
            
            // Create all schedules in one transaction
            await vesting.createVestingSchedule(allSchedules);
            
            // Verify schedules were created
            const totalSchedules = await vesting.getVestingSchedulesCount();
            expect(totalSchedules).to.equal(allSchedules.length, "❌ Incorrect number of schedules created");
            
            console.log("✅ All vesting schedules created");
        });

        it("Should allow immediate claiming of retroactive amounts", async function () {
            console.log("\n🚀 Testing immediate retroactive claims...");
            
            for (let i = 0; i < testUsers.length; i++) {
                const user = testUsers[i];
                const userSigner = users[i];
                
                // Get user's second schedule (the retroactive one) - index 1 for each user
                const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(
                    userSigner.address, 
                    1 // second schedule (0-indexed)
                );
                
                // Check releasable amount
                const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
                const expectedReleasable = ethers.parseEther(user.immediatelyClaimable.toString());
                
                // Allow for small rounding differences (within 1% or 1 token)
                const tolerance = ethers.parseEther("1");
                const difference = releasableAmount > expectedReleasable 
                    ? releasableAmount - expectedReleasable
                    : expectedReleasable - releasableAmount;
                
                expect(difference).to.be.lessThan(tolerance, 
                    `❌ Releasable amount mismatch for ${user.address}: expected ${ethers.formatEther(expectedReleasable)}, got ${ethers.formatEther(releasableAmount)}`);
                
                console.log(`✅ User ${i + 1}: Can claim ${ethers.formatEther(releasableAmount)} tokens immediately`);
            }
            
            console.log("✅ All retroactive amounts validated");
        });

        it("Should NOT allow claiming first schedule before cliff period", async function () {
            console.log("\n⏰ Testing cliff period enforcement...");
            
            const user = testUsers[0];
            const userSigner = users[0];
            
            // Get user's first schedule (the one with cliff) - index 0
            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(
                userSigner.address, 
                0 // first schedule
            );
            
            // Check releasable amount (should be 0 before cliff)
            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            expect(releasableAmount).to.equal(0, "❌ Should not be able to claim before cliff");
            
            console.log("✅ Cliff period correctly enforced");
        });

        it("Should allow claiming first schedule after cliff period", async function () {
            console.log("\n⏳ Testing post-cliff claiming...");
            
            // Fast forward time by 1 hour + 1 minute
            await ethers.provider.send("evm_increaseTime", [ONE_HOUR + 60]);
            await ethers.provider.send("evm_mine", []);
            
            const user = testUsers[0];
            const userSigner = users[0];
            
            // Get user's first schedule
            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(
                userSigner.address, 
                0 // first schedule
            );
            
            // Check releasable amount (should now be full amount)
            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            const expectedAmount = ethers.parseEther(user.firstScheduleAmount.toString());
            
            expect(releasableAmount).to.equal(expectedAmount, 
                "❌ Should be able to claim full amount after cliff");
            
            console.log(`✅ Post-cliff: Can claim ${ethers.formatEther(releasableAmount)} tokens`);
        });

        it("Should validate daily vesting progression", async function () {
            console.log("\n📈 Testing daily vesting progression...");
            
            const user = testUsers[0];
            const userSigner = users[0];
            
            // Get second schedule ID
            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(
                userSigner.address, 
                1 // second schedule
            );
            
            const initialReleasable = await vesting.computeReleasableAmount(scheduleId);
            
            // Fast forward by 1 day
            await ethers.provider.send("evm_increaseTime", [ONE_DAY]);
            await ethers.provider.send("evm_mine", []);
            
            const afterOneDayReleasable = await vesting.computeReleasableAmount(scheduleId);
            
            // Should have more available after 1 day
            expect(afterOneDayReleasable).to.be.greaterThan(initialReleasable,
                "❌ Vesting should progress daily");
            
            const dailyIncrease = afterOneDayReleasable - initialReleasable;
            const expectedDailyAmount = ethers.parseEther((user.secondScheduleAmount / TOTAL_VESTING_DAYS).toFixed(6));
            
            // Allow for reasonable rounding differences
            const tolerance = ethers.parseEther("0.001");
            const difference = dailyIncrease > expectedDailyAmount 
                ? dailyIncrease - expectedDailyAmount
                : expectedDailyAmount - dailyIncrease;
            
            expect(difference).to.be.lessThan(tolerance,
                `❌ Daily vesting amount should match expected. Expected: ${ethers.formatEther(expectedDailyAmount)}, Got: ${ethers.formatEther(dailyIncrease)}`);
            
            console.log(`✅ Daily progression: +${ethers.formatEther(dailyIncrease)} tokens per day`);
        });

        it("Should validate total distribution equals allocation", async function () {
            console.log("\n🧮 Validating total distribution...");
            
            let totalContractFunded = 0;
            let totalShouldDistribute = 0;
            let totalAlreadyDistributed = 0;
            
            for (const user of testUsers) {
                totalContractFunded += user.firstScheduleAmount + user.secondScheduleAmount;
                totalShouldDistribute += user.totalAllocation;
                totalAlreadyDistributed += user.alreadyDistributed;
            }
            
            // Validate the math
            const expectedContractFunding = totalShouldDistribute - totalAlreadyDistributed;
            expect(totalContractFunded).to.equal(expectedContractFunding,
                "❌ Contract funding doesn't match expected distribution");
            
            // Validate percentages
            const distributedPercent = (totalAlreadyDistributed / totalShouldDistribute) * 100;
            const contractPercent = (totalContractFunded / totalShouldDistribute) * 100;
            
            expect(Math.abs(distributedPercent - 15)).to.be.lessThan(0.1, 
                "❌ Already distributed should be ~15%");
            expect(Math.abs(contractPercent - 85)).to.be.lessThan(0.1,
                "❌ Contract funding should be ~85%");
            
            console.log(`✅ Distribution validation:`);
            console.log(`   📊 Total allocation: ${totalShouldDistribute.toLocaleString()} tokens`);
            console.log(`   ✅ Already distributed: ${totalAlreadyDistributed.toLocaleString()} tokens (${distributedPercent.toFixed(1)}%)`);
            console.log(`   💰 Contract funded: ${totalContractFunded.toLocaleString()} tokens (${contractPercent.toFixed(1)}%)`);
        });

        it("Should demonstrate full scenario walkthrough", async function () {
            console.log("\n🎬 FULL SCENARIO DEMONSTRATION");
            console.log("=".repeat(60));
            
            const user = testUsers[0];
            const userSigner = users[0];
            
            console.log(`👤 User: ${user.address}`);
            console.log(`📊 Total Allocation: ${user.totalAllocation.toLocaleString()} tokens`);
            console.log(`✅ Already Received (15%): ${user.alreadyDistributed.toLocaleString()} tokens`);
            console.log();
            
            // Show retroactive claimable
            const retroactiveScheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(
                userSigner.address, 1
            );
            const retroactiveClaimable = await vesting.computeReleasableAmount(retroactiveScheduleId);
            
            console.log(`🚀 IMMEDIATELY CLAIMABLE (22 days retroactive):`);
            console.log(`   Amount: ${ethers.formatEther(retroactiveClaimable)} tokens`);
            console.log(`   Expected: ${user.immediatelyClaimable.toLocaleString()} tokens`);
            console.log();
            
            // Show cliff schedule
            const cliffScheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(
                userSigner.address, 0
            );
            const cliffClaimable = await vesting.computeReleasableAmount(cliffScheduleId);
            
            console.log(`⏰ AFTER 1 HOUR CLIFF:`);
            console.log(`   Amount: ${ethers.formatEther(cliffClaimable)} tokens`);
            console.log(`   Expected: ${user.firstScheduleAmount.toLocaleString()} tokens`);
            console.log();
            
            // Calculate remaining daily
            const dailyAmount = user.secondScheduleAmount / TOTAL_VESTING_DAYS;
            const remainingDays = TOTAL_VESTING_DAYS - RETROACTIVE_DAYS;
            const remainingAmount = dailyAmount * remainingDays;
            
            console.log(`📅 DAILY OVER ${remainingDays} REMAINING DAYS:`);
            console.log(`   Daily: ${dailyAmount.toFixed(4)} tokens/day`);
            console.log(`   Total remaining: ${remainingAmount.toLocaleString()} tokens`);
            console.log();
            
            // Summary
            const totalFromVesting = 
                parseFloat(ethers.formatEther(retroactiveClaimable)) +
                parseFloat(ethers.formatEther(cliffClaimable)) +
                remainingAmount;
            
            console.log(`💰 TOTAL FROM VESTING CONTRACT: ${totalFromVesting.toLocaleString()} tokens`);
            console.log(`💎 GRAND TOTAL: ${(user.alreadyDistributed + totalFromVesting).toLocaleString()} tokens`);
            console.log(`✅ Matches allocation: ${Math.abs(user.totalAllocation - (user.alreadyDistributed + totalFromVesting)) < 1}`);
            
            console.log("=".repeat(60));
            console.log("🎉 SCENARIO VALIDATION COMPLETE!");
        });
    });
}); 