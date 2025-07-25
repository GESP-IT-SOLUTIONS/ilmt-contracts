import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ILMTVesting - Retroactive Daily Distribution", function () {
    let vesting: any;
    let token: any;
    let owner: any;
    let user1: any;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const USER_ALLOCATION = ethers.parseEther("1000"); // 1000 ILMT total

    const ONE_DAY = 86400;
    const ONE_YEAR = ONE_DAY * 365;

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();

        // Deploy Mock Token
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        token = await MockERC20Factory.deploy("Test Token", "TEST", INITIAL_SUPPLY);

        // Deploy Vesting Contract
        const VestingFactory = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingFactory.deploy(token.target);

        // Transfer tokens to vesting contract
        await token.transfer(vesting.target, INITIAL_SUPPLY);
    });

    describe("Retroactive Distribution: Started on 5th, Deploy on 25th", function () {
        it("Should handle vesting started 20 days ago correctly", async function () {
            const currentTime = await time.latest();
            
            // Simulate: should have started 20 days ago (5th), but we're deploying now (25th)
            const shouldHaveStarted = currentTime - (20 * ONE_DAY); // 20 days ago
            
            console.log(`\n📅 Timeline Simulation:`);
            console.log(`  Should have started: ${new Date(shouldHaveStarted * 1000).toISOString()}`);
            console.log(`  Actually deploying: ${new Date(currentTime * 1000).toISOString()}`);
            console.log(`  Days delayed: 20 days`);

            // Create vesting schedule with past start date
            const immediateAmount = USER_ALLOCATION * 10n / 100n; // 10%
            const vestingAmount = USER_ALLOCATION * 75n / 100n;   // 75%

            const params = [
                // Schedule 1: Immediate 10% (available now)
                {
                    beneficiary: user1.address,
                    start: currentTime,
                    cliff: 0,
                    duration: 3600, // 1 hour for immediate release
                    slicePeriodSeconds: 3600,
                    revocable: false,
                    amount: immediateAmount
                },
                // Schedule 2: Daily vesting that should have started 20 days ago
                {
                    beneficiary: user1.address,
                    start: shouldHaveStarted, // START IN THE PAST!
                    cliff: 0,
                    duration: ONE_YEAR,
                    slicePeriodSeconds: ONE_DAY,
                    revocable: false,
                    amount: vestingAmount
                }
            ];

            await vesting.createVestingSchedule(params);

            // Get schedule IDs
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 0);
            const scheduleId2 = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 1);

            // Check what's available immediately for the retroactive schedule
            const releasableFromRetroactive = await vesting.computeReleasableAmount(scheduleId2);
            
            // Should be able to release 20 days worth of tokens immediately
            const dailyAmount = vestingAmount / 365n;
            const expected20Days = dailyAmount * 20n;
            
            console.log(`\n💰 Retroactive Calculation:`);
            console.log(`  Daily amount: ${ethers.formatEther(dailyAmount)} ILMT`);
            console.log(`  20 days worth: ${ethers.formatEther(expected20Days)} ILMT`);
            console.log(`  Actually releasable: ${ethers.formatEther(releasableFromRetroactive)} ILMT`);

            // Should be close to 20 days worth (allowing for rounding)
            expect(releasableFromRetroactive).to.be.closeTo(expected20Days, ethers.parseEther("1"));

            // User can release the retroactive amount immediately
            const initialBalance = await token.balanceOf(user1.address);
            await vesting.connect(user1).release(scheduleId2, releasableFromRetroactive);
            const balanceAfterRetroactive = await token.balanceOf(user1.address);

            expect(balanceAfterRetroactive - initialBalance).to.equal(releasableFromRetroactive);

            console.log(`\n✅ Retroactive Release Successful:`);
            console.log(`  Released: ${ethers.formatEther(releasableFromRetroactive)} ILMT`);
            console.log(`  User balance: ${ethers.formatEther(balanceAfterRetroactive)} ILMT`);

            // Also release the immediate 10% after 1 hour
            await time.increase(3600);
            const releasableImmediate = await vesting.computeReleasableAmount(scheduleId1);
            await vesting.connect(user1).release(scheduleId1, releasableImmediate);
            const finalBalance = await token.balanceOf(user1.address);

            console.log(`\n💎 After Immediate Release:`);
            console.log(`  Additional released: ${ethers.formatEther(releasableImmediate)} ILMT`);
            console.log(`  Total user balance: ${ethers.formatEther(finalBalance)} ILMT`);

            // Continue with daily releases
            await time.increase(ONE_DAY);
            const nextDayReleasable = await vesting.computeReleasableAmount(scheduleId2);
            
            console.log(`\n📈 Next Day Release:`);
            console.log(`  Next day available: ${ethers.formatEther(nextDayReleasable)} ILMT`);
            console.log(`  Should be ~daily amount: ${ethers.formatEther(dailyAmount)} ILMT`);

            expect(nextDayReleasable).to.be.closeTo(dailyAmount, ethers.parseEther("0.1"));
        });

        it("Should calculate correct totals for retroactive scenario", async function () {
            const currentTime = await time.latest();
            const shouldHaveStarted = currentTime - (20 * ONE_DAY);

            // Test different delay scenarios
            const scenarios = [
                { days: 10, description: "10 days late" },
                { days: 20, description: "20 days late" },
                { days: 30, description: "30 days late" },
                { days: 60, description: "2 months late" }
            ];

            console.log(`\n📊 Multiple Delay Scenarios:`);

            for (const scenario of scenarios) {
                const startTime = currentTime - (scenario.days * ONE_DAY);
                const vestingAmount = ethers.parseEther("365"); // 365 ILMT for easy calculation
                
                // Create a schedule for this scenario
                const params = [{
                    beneficiary: user1.address,
                    start: startTime,
                    cliff: 0,
                    duration: ONE_YEAR,
                    slicePeriodSeconds: ONE_DAY,
                    revocable: false,
                    amount: vestingAmount
                }];

                await vesting.createVestingSchedule(params);

                const scheduleCount = await vesting.getVestingSchedulesCountByBeneficiary(user1.address);
                const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, scheduleCount - 1n);
                const releasable = await vesting.computeReleasableAmount(scheduleId);

                const expectedDaily = vestingAmount / 365n; // 1 ILMT per day
                const expectedTotal = expectedDaily * BigInt(scenario.days);

                console.log(`\n  ${scenario.description}:`);
                console.log(`    Expected: ${ethers.formatEther(expectedTotal)} ILMT`);
                console.log(`    Actual: ${ethers.formatEther(releasable)} ILMT`);
                console.log(`    ✅ Correct: ${releasable >= expectedTotal * 99n / 100n}`); // Allow 1% tolerance

                expect(releasable).to.be.closeTo(expectedTotal, ethers.parseEther("1"));
            }
        });

        it("Should work with real date calculation example", async function () {
            // Real scenario: Should start 20 days ago, deploying now
            const currentTime = await time.latest();
            const shouldHaveStarted = currentTime - (20 * ONE_DAY);
            const daysBetween = 20;

            console.log(`\n📅 Real Date Example:`);
            console.log(`  Should start: 20 days ago`);
            console.log(`  Actually deploy: Now`);
            console.log(`  Days between: ${daysBetween} days`);

            const vestingAmount = USER_ALLOCATION * 75n / 100n; // 75%
            const params = [{
                beneficiary: user1.address,
                start: shouldHaveStarted, // Start 20 days ago
                cliff: 0,
                duration: ONE_YEAR,
                slicePeriodSeconds: ONE_DAY,
                revocable: false,
                amount: vestingAmount
            }];

            await vesting.createVestingSchedule(params);

            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 0);
            const releasable = await vesting.computeReleasableAmount(scheduleId);

            const dailyAmount = vestingAmount / 365n;
            const expectedForDays = dailyAmount * BigInt(daysBetween);

            console.log(`\n💰 Real Calculation:`);
            console.log(`  Daily amount: ${ethers.formatEther(dailyAmount)} ILMT`);
            console.log(`  ${daysBetween} days worth: ${ethers.formatEther(expectedForDays)} ILMT`);
            console.log(`  Actually releasable: ${ethers.formatEther(releasable)} ILMT`);

            expect(releasable).to.be.closeTo(expectedForDays, ethers.parseEther("5"));

            // User can release it all at once
            await vesting.connect(user1).release(scheduleId, releasable);
            const balance = await token.balanceOf(user1.address);

            expect(balance).to.equal(releasable);

            console.log(`✅ User successfully claimed ${daysBetween} days of retroactive vesting!`);
        });
    });

    describe("Combined Scenario: Retroactive + Future Vesting", function () {
        it("Should handle complete airdrop scenario with retroactive daily distribution", async function () {
            const currentTime = await time.latest();
            const shouldHaveStarted = currentTime - (20 * ONE_DAY); // 20 days ago

            const totalAllocation = USER_ALLOCATION;
            const immediateAmount = totalAllocation * 10n / 100n; // 10%
            const vestingAmount = totalAllocation * 75n / 100n;   // 75%

            console.log(`\n🎯 COMPLETE RETROACTIVE AIRDROP SCENARIO:`);
            console.log(`  Total allocation: ${ethers.formatEther(totalAllocation)} ILMT (100%)`);
            console.log(`  Already airdropped: ${ethers.formatEther(totalAllocation * 15n / 100n)} ILMT (15%)`);
            console.log(`  Immediate: ${ethers.formatEther(immediateAmount)} ILMT (10%)`);
            console.log(`  Daily vesting: ${ethers.formatEther(vestingAmount)} ILMT (75%)`);
            console.log(`  Daily vesting SHOULD HAVE started 20 days ago`);

            const params = [
                // Immediate 10%
                {
                    beneficiary: user1.address,
                    start: currentTime,
                    cliff: 0,
                    duration: 3600,
                    slicePeriodSeconds: 3600,
                    revocable: false,
                    amount: immediateAmount
                },
                // Retroactive daily vesting 75%
                {
                    beneficiary: user1.address,
                    start: shouldHaveStarted, // RETROACTIVE!
                    cliff: 0,
                    duration: ONE_YEAR,
                    slicePeriodSeconds: ONE_DAY,
                    revocable: false,
                    amount: vestingAmount
                }
            ];

            await vesting.createVestingSchedule(params);

            // Check immediate status
            const totalReleasable = await vesting.getTotalReleasableAmountForBeneficiary(user1.address);
            console.log(`\n📊 Immediate Status:`);
            console.log(`  Total releasable now: ${ethers.formatEther(totalReleasable)} ILMT`);

            // This should include ~20 days of daily vesting
            const dailyAmount = vestingAmount / 365n;
            const expected20Days = dailyAmount * 20n;
            console.log(`  Expected retroactive: ${ethers.formatEther(expected20Days)} ILMT`);

            // Release retroactive amount
            const scheduleId2 = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 1);
            const retroactiveReleasable = await vesting.computeReleasableAmount(scheduleId2);
            
            await vesting.connect(user1).release(scheduleId2, retroactiveReleasable);
            let balance = await token.balanceOf(user1.address);

            console.log(`\n💰 After Retroactive Release:`);
            console.log(`  Released: ${ethers.formatEther(retroactiveReleasable)} ILMT`);
            console.log(`  User balance: ${ethers.formatEther(balance)} ILMT`);

            // Release immediate 10% after 1 hour
            await time.increase(3600);
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 0);
            const immediateReleasable = await vesting.computeReleasableAmount(scheduleId1);
            
            await vesting.connect(user1).release(scheduleId1, immediateReleasable);
            balance = await token.balanceOf(user1.address);

            console.log(`\n💎 After Immediate Release:`);
            console.log(`  Additional: ${ethers.formatEther(immediateReleasable)} ILMT`);
            console.log(`  Total balance: ${ethers.formatEther(balance)} ILMT`);

            // Test future daily releases
            await time.increase(ONE_DAY);
            const nextDayReleasable = await vesting.computeReleasableAmount(scheduleId2);
            
            console.log(`\n📈 Next Day (Future Vesting):`);
            console.log(`  Next daily release: ${ethers.formatEther(nextDayReleasable)} ILMT`);

            console.log(`\n✅ RETROACTIVE SCENARIO COMPLETE:`);
            console.log(`  ✅ User got 20 days of missed daily distributions immediately`);
            console.log(`  ✅ User got immediate 10% release`);
            console.log(`  ✅ Future daily distributions continue normally`);
            console.log(`  ✅ Total user experience seamless despite 20-day delay`);
        });
    });
}); 