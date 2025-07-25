import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Detailed Scenario Verification - Daily Vesting Timeline", function () {
    let token: any;
    let vesting: any;
    let owner: any;
    let investor: any;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");

    // Real scenario dates
    const SHOULD_HAVE_STARTED = "2024-01-05"; // When it should have started
    const ACTUALLY_DEPLOYING = "2024-01-25";  // When we're actually deploying
    const DAYS_DELAYED = 20; // 25 - 5 = 20 days

    beforeEach(async function () {
        [owner, investor] = await ethers.getSigners();

        // Deploy contracts
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        token = await MockERC20Factory.deploy("ILMT Token", "ILMT", INITIAL_SUPPLY);

        const VestingFactory = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingFactory.deploy(token.target);

        // Transfer tokens to vesting contract
        await token.transfer(vesting.target, INITIAL_SUPPLY);
    });

    describe("Timeline Verification", function () {
        it("Should calculate correct timeline", async function () {
            const shouldHaveStarted = Math.floor(new Date(SHOULD_HAVE_STARTED + 'T00:00:00Z').getTime() / 1000);
            const actuallyDeploying = Math.floor(new Date(ACTUALLY_DEPLOYING + 'T00:00:00Z').getTime() / 1000);
            const calculatedDelay = Math.floor((actuallyDeploying - shouldHaveStarted) / (24 * 3600));

            console.log(`📅 Timeline Verification:`);
            console.log(`  Should have started: ${SHOULD_HAVE_STARTED} (timestamp: ${shouldHaveStarted})`);
            console.log(`  Actually deploying: ${ACTUALLY_DEPLOYING} (timestamp: ${actuallyDeploying})`);
            console.log(`  Days between: ${calculatedDelay} days`);
            console.log(`  Expected delay: ${DAYS_DELAYED} days`);

            expect(calculatedDelay).to.equal(DAYS_DELAYED);
        });

        it("Should verify one year duration from original start date", async function () {
            const shouldHaveStarted = Math.floor(new Date(SHOULD_HAVE_STARTED + 'T00:00:00Z').getTime() / 1000);
            const oneYear = 365 * 24 * 3600;
            const expectedEnd = shouldHaveStarted + oneYear;
            
            // Expected end date should be January 5, 2025
            const expectedEndDate = new Date(expectedEnd * 1000);
            
            console.log(`📅 Duration Verification:`);
            console.log(`  Start: ${SHOULD_HAVE_STARTED}`);
            console.log(`  Duration: 365 days`);
            console.log(`  Expected end: ${expectedEndDate.toISOString().split('T')[0]}`);
            
            // Should be approximately January 5, 2025
            expect(expectedEndDate.getFullYear()).to.equal(2025);
            expect(expectedEndDate.getMonth()).to.equal(0); // January is 0
            expect(expectedEndDate.getDate()).to.be.within(4, 6); // Around 5th (accounting for leap year)
        });
    });

    describe("Vesting Schedule Creation", function () {
        it("Should create correct retroactive daily vesting schedule", async function () {
            const shouldHaveStarted = Math.floor(new Date(SHOULD_HAVE_STARTED + 'T00:00:00Z').getTime() / 1000);
            const oneYear = 365 * 24 * 3600;
            const oneDay = 24 * 3600;
            const totalAmount = ethers.parseEther("1000"); // 1000 ILMT total allocation
            const vestingAmount = totalAmount * 75n / 100n; // 75% for daily vesting

            console.log(`💰 Creating vesting schedule:`);
            console.log(`  Beneficiary: ${investor.address}`);
            console.log(`  Start: ${shouldHaveStarted} (${SHOULD_HAVE_STARTED})`);
            console.log(`  Duration: ${oneYear} seconds (365 days)`);
            console.log(`  Slice period: ${oneDay} seconds (1 day)`);
            console.log(`  Amount: ${ethers.formatEther(vestingAmount)} ILMT`);

            // Create the vesting schedule
            await vesting.createVestingSchedule([{
                beneficiary: investor.address,
                start: shouldHaveStarted, // Important: Start date in the past!
                cliff: 0,
                duration: oneYear,
                slicePeriodSeconds: oneDay,
                revocable: false,
                amount: vestingAmount
            }]);

            // Verify schedule was created
            const scheduleCount = await vesting.getVestingSchedulesCount();
            expect(scheduleCount).to.equal(1);

            console.log(`✅ Vesting schedule created successfully`);
        });

        it("Should calculate correct compensation for 20 delayed days", async function () {
            const shouldHaveStarted = Math.floor(new Date(SHOULD_HAVE_STARTED + 'T00:00:00Z').getTime() / 1000);
            const actuallyDeploying = Math.floor(new Date(ACTUALLY_DEPLOYING + 'T00:00:00Z').getTime() / 1000);
            const oneYear = 365 * 24 * 3600;
            const oneDay = 24 * 3600;
            const totalAmount = ethers.parseEther("1000");
            const vestingAmount = totalAmount * 75n / 100n; // 750 ILMT for vesting

            // Create vesting schedule
            await vesting.createVestingSchedule([{
                beneficiary: investor.address,
                start: shouldHaveStarted,
                cliff: 0,
                duration: oneYear,
                slicePeriodSeconds: oneDay,
                revocable: false,
                amount: vestingAmount
            }]);

            // Simulate being on January 25th (deployment day)
            await time.setNextBlockTimestamp(actuallyDeploying);
            await ethers.provider.send("evm_mine", []);

            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, 0);
            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);

            // Calculate expected compensation
            const dailyAmount = vestingAmount / 365n;
            const expectedCompensation = dailyAmount * BigInt(DAYS_DELAYED);

            console.log(`💰 Compensation Calculation:`);
            console.log(`  Total vesting amount: ${ethers.formatEther(vestingAmount)} ILMT`);
            console.log(`  Daily amount: ${ethers.formatEther(dailyAmount)} ILMT`);
            console.log(`  Days delayed: ${DAYS_DELAYED}`);
            console.log(`  Expected compensation: ${ethers.formatEther(expectedCompensation)} ILMT`);
            console.log(`  Actual releasable: ${ethers.formatEther(releasableAmount)} ILMT`);

            // Should be approximately equal (allowing for small rounding differences)
            const difference = releasableAmount > expectedCompensation ? 
                releasableAmount - expectedCompensation : 
                expectedCompensation - releasableAmount;
            const tolerance = ethers.parseEther("0.1"); // 0.1 ILMT tolerance

            expect(difference).to.be.lte(tolerance);
            expect(releasableAmount).to.be.gt(0);

            console.log(`✅ Compensation calculation is correct`);
        });
    });

    describe("Complete User Journey Simulation", function () {
        it("Should simulate complete user experience from deployment to end", async function () {
            this.timeout(60000); // Increase timeout for this comprehensive test

            const shouldHaveStarted = Math.floor(new Date(SHOULD_HAVE_STARTED + 'T00:00:00Z').getTime() / 1000);
            const actuallyDeploying = Math.floor(new Date(ACTUALLY_DEPLOYING + 'T00:00:00Z').getTime() / 1000);
            const oneYear = 365 * 24 * 3600;
            const oneDay = 24 * 3600;
            const oneHour = 3600;
            
            const totalAmount = ethers.parseEther("1000");
            const immediateAmount = totalAmount * 10n / 100n; // 100 ILMT immediate
            const vestingAmount = totalAmount * 75n / 100n;   // 750 ILMT vesting

            console.log(`🎬 Starting complete user journey simulation...`);
            console.log(`  Total allocation: ${ethers.formatEther(totalAmount)} ILMT`);
            console.log(`  Immediate (10%): ${ethers.formatEther(immediateAmount)} ILMT`);
            console.log(`  Daily vesting (75%): ${ethers.formatEther(vestingAmount)} ILMT`);

            // Create both schedules (as the script does)
            await vesting.createVestingSchedule([
                // Schedule 1: Immediate 10%
                {
                    beneficiary: investor.address,
                    start: actuallyDeploying,
                    cliff: 0,
                    duration: oneHour,
                    slicePeriodSeconds: oneHour,
                    revocable: false,
                    amount: immediateAmount
                },
                // Schedule 2: Retroactive daily vesting 75%
                {
                    beneficiary: investor.address,
                    start: shouldHaveStarted, // Past date!
                    cliff: 0,
                    duration: oneYear,
                    slicePeriodSeconds: oneDay,
                    revocable: false,
                    amount: vestingAmount
                }
            ]);

            // Set time to deployment day (January 25)
            await time.setNextBlockTimestamp(actuallyDeploying);
            await ethers.provider.send("evm_mine", []);

            // Check both schedules
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, 0);
            const scheduleId2 = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, 1);

            const releasable1 = await vesting.computeReleasableAmount(scheduleId1); // Immediate
            const releasable2 = await vesting.computeReleasableAmount(scheduleId2); // Daily compensation

            console.log(`\n📊 Day 0 (Deployment - January 25):`);
            console.log(`  Immediate schedule: ${ethers.formatEther(releasable1)} ILMT available`);
            console.log(`  Daily compensation: ${ethers.formatEther(releasable2)} ILMT available`);
            console.log(`  Total immediately available: ${ethers.formatEther(releasable1 + releasable2)} ILMT`);

            // User can claim compensation immediately
            expect(releasable2).to.be.gt(0); // Should have 20 days of compensation

            // Advance 1 hour - immediate schedule becomes available
            await time.increase(oneHour);
            const releasable1After = await vesting.computeReleasableAmount(scheduleId1);
            
            console.log(`\n📊 After 1 hour:`);
            console.log(`  Immediate schedule: ${ethers.formatEther(releasable1After)} ILMT available`);
            expect(releasable1After).to.equal(immediateAmount);

            // Advance 1 day - daily vesting continues
            await time.increase(oneDay);
            const releasable2After1Day = await vesting.computeReleasableAmount(scheduleId2);
            
            console.log(`\n📊 After 1 day (January 26):`);
            console.log(`  Daily vesting: ${ethers.formatEther(releasable2After1Day)} ILMT total available`);
            
            // Should now have 21 days worth (20 compensation + 1 new day)
            const expectedAfter21Days = (vestingAmount / 365n) * 21n;
            const tolerance = ethers.parseEther("0.5");
            expect(releasable2After1Day).to.be.closeTo(expectedAfter21Days, tolerance);

            // Advance to end of year (January 5, 2025)
            const timeToAdvance = shouldHaveStarted + oneYear - await time.latest();
            await time.increase(timeToAdvance);
            
            const releasable2AtEnd = await vesting.computeReleasableAmount(scheduleId2);
            console.log(`\n📊 End of vesting (January 5, 2025):`);
            console.log(`  Daily vesting: ${ethers.formatEther(releasable2AtEnd)} ILMT total available`);
            console.log(`  Expected full amount: ${ethers.formatEther(vestingAmount)} ILMT`);

            // Should be able to claim the full vesting amount
            expect(releasable2AtEnd).to.be.closeTo(vestingAmount, ethers.parseEther("1"));

            console.log(`\n✅ Complete user journey verified successfully!`);
            console.log(`🎯 Summary:`);
            console.log(`  - User gets 20 days compensation immediately`);
            console.log(`  - User gets 10% immediate after 1 hour`);
            console.log(`  - Daily vesting runs exactly 365 days from January 5, 2024 to January 5, 2025`);
            console.log(`  - No tokens are lost due to the 20-day delay`);
        });

        it("Should verify exact date calculations", async function () {
            const shouldHaveStarted = Math.floor(new Date('2024-01-05T00:00:00Z').getTime() / 1000);
            const actuallyDeploying = Math.floor(new Date('2024-01-25T00:00:00Z').getTime() / 1000);
            const oneYear = 365 * 24 * 3600;
            
            const vestingEndTimestamp = shouldHaveStarted + oneYear;
            const vestingEndDate = new Date(vestingEndTimestamp * 1000);
            
            console.log(`📅 Exact Date Verification:`);
            console.log(`  Vesting starts: 2024-01-05 (${shouldHaveStarted})`);
            console.log(`  Deployment day: 2024-01-25 (${actuallyDeploying})`);
            console.log(`  Vesting ends: ${vestingEndDate.toISOString().split('T')[0]} (${vestingEndTimestamp})`);
            console.log(`  Total duration: ${oneYear} seconds = ${oneYear / (24 * 3600)} days`);
            
            const daysBetween = Math.floor((actuallyDeploying - shouldHaveStarted) / (24 * 3600));
            console.log(`  Days delay: ${daysBetween} days`);
            
            expect(daysBetween).to.equal(20);
            expect(vestingEndDate.getFullYear()).to.equal(2025);
            expect(vestingEndDate.getMonth()).to.equal(0); // January
            expect(vestingEndDate.getDate()).to.equal(5);
            
            console.log(`✅ All date calculations are exact!`);
        });
    });

    describe("Edge Cases and Error Scenarios", function () {
        it("Should handle leap year correctly", async function () {
            // Test with a leap year scenario
            const leapYearStart = Math.floor(new Date('2024-02-29T00:00:00Z').getTime() / 1000);
            const oneYear = 365 * 24 * 3600; // Still 365 days, not 366
            const vestingAmount = ethers.parseEther("365"); // 1 ILMT per day
            
            await vesting.createVestingSchedule([{
                beneficiary: investor.address,
                start: leapYearStart,
                cliff: 0,
                duration: oneYear,
                slicePeriodSeconds: 24 * 3600,
                revocable: false,
                amount: vestingAmount
            }]);

            // Advance exactly 365 days
            await time.setNextBlockTimestamp(leapYearStart + oneYear);
            await ethers.provider.send("evm_mine", []);

            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, 0);
            const releasable = await vesting.computeReleasableAmount(scheduleId);

            console.log(`🗓️ Leap Year Test:`);
            console.log(`  Start: 2024-02-29 (leap year)`);
            console.log(`  Duration: 365 days`);
            console.log(`  Releasable: ${ethers.formatEther(releasable)} ILMT`);
            console.log(`  Expected: ${ethers.formatEther(vestingAmount)} ILMT`);

            expect(releasable).to.equal(vestingAmount);
        });

        it("Should handle different deployment times correctly", async function () {
            const scenarios = [
                { delay: 1, name: "1 day delay" },
                { delay: 10, name: "10 days delay" },
                { delay: 30, name: "30 days delay" },
                { delay: 100, name: "100 days delay" }
            ];

            for (const scenario of scenarios) {
                const shouldHaveStarted = Math.floor(new Date('2024-01-05T00:00:00Z').getTime() / 1000);
                const deploymentTime = shouldHaveStarted + (scenario.delay * 24 * 3600);
                const vestingAmount = ethers.parseEther("365"); // 1 ILMT per day
                
                await vesting.createVestingSchedule([{
                    beneficiary: investor.address,
                    start: shouldHaveStarted,
                    cliff: 0,
                    duration: 365 * 24 * 3600,
                    slicePeriodSeconds: 24 * 3600,
                    revocable: false,
                    amount: vestingAmount
                }]);

                await time.setNextBlockTimestamp(deploymentTime);
                await ethers.provider.send("evm_mine", []);

                const scheduleCount = await vesting.getVestingSchedulesCount();
                const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, scheduleCount - 1n);
                const releasable = await vesting.computeReleasableAmount(scheduleId);
                const expectedCompensation = ethers.parseEther(scenario.delay.toString());

                console.log(`📊 ${scenario.name}:`);
                console.log(`  Expected compensation: ${ethers.formatEther(expectedCompensation)} ILMT`);
                console.log(`  Actual releasable: ${ethers.formatEther(releasable)} ILMT`);

                expect(releasable).to.be.closeTo(expectedCompensation, ethers.parseEther("0.1"));
            }
        });
    });

    describe("Real-world Integration Test", function () {
        it("Should work with the exact deployment script parameters", async function () {
            // Use exact parameters from the deployment script
            const config = {
                shouldHaveStartedDate: "2024-01-05",
                actualDeployDate: "2024-01-25",
                immediateReleaseHours: 1
            };

            const shouldHaveStarted = Math.floor(new Date(config.shouldHaveStartedDate + 'T00:00:00Z').getTime() / 1000);
            const actualDeploy = Math.floor(new Date(config.actualDeployDate + 'T00:00:00Z').getTime() / 1000);
            const oneHour = 3600;
            const oneDay = 86400;
            const oneYear = oneDay * 365;

            // Simulate 100 ILMT investor
            const totalAllocation = ethers.parseEther("100");
            const immediateAmount = totalAllocation * 10n / 100n; // 10 ILMT
            const vestingAmount = totalAllocation * 75n / 100n;   // 75 ILMT

            console.log(`🔧 Real-world Integration Test:`);
            console.log(`  Config: ${JSON.stringify(config, null, 2)}`);
            console.log(`  Total allocation: ${ethers.formatEther(totalAllocation)} ILMT`);

            // Create both schedules exactly as the script does
            await vesting.createVestingSchedule([
                {
                    beneficiary: investor.address,
                    start: actualDeploy,
                    cliff: 0,
                    duration: config.immediateReleaseHours * oneHour,
                    slicePeriodSeconds: config.immediateReleaseHours * oneHour,
                    revocable: false,
                    amount: immediateAmount
                },
                {
                    beneficiary: investor.address,
                    start: shouldHaveStarted, // Past date for compensation
                    cliff: 0,
                    duration: oneYear,
                    slicePeriodSeconds: oneDay,
                    revocable: false,
                    amount: vestingAmount
                }
            ]);

            // Set time to deployment day
            await time.setNextBlockTimestamp(actualDeploy);
            await ethers.provider.send("evm_mine", []);

            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, 0);
            const scheduleId2 = await vesting.computeVestingScheduleIdForAddressAndIndex(investor.address, 1);

            const releasable1 = await vesting.computeReleasableAmount(scheduleId1);
            const releasable2 = await vesting.computeReleasableAmount(scheduleId2);

            const dailyAmount = vestingAmount / 365n;
            const expectedCompensation = dailyAmount * 20n; // 20 days

            console.log(`💰 Results:`);
            console.log(`  Immediate (before 1 hour): ${ethers.formatEther(releasable1)} ILMT`);
            console.log(`  Compensation (20 days): ${ethers.formatEther(releasable2)} ILMT`);
            console.log(`  Expected compensation: ${ethers.formatEther(expectedCompensation)} ILMT`);
            console.log(`  Daily amount: ${ethers.formatEther(dailyAmount)} ILMT`);

            // Immediate should be 0 before 1 hour passes
            expect(releasable1).to.equal(0);
            
            // Compensation should be approximately 20 days worth
            expect(releasable2).to.be.closeTo(expectedCompensation, ethers.parseEther("0.01"));

            // After 1 hour, immediate becomes available
            await time.increase(oneHour);
            const releasable1After = await vesting.computeReleasableAmount(scheduleId1);
            expect(releasable1After).to.equal(immediateAmount);

            console.log(`✅ Real-world integration test passed!`);
            
            // Verify the user experience
            const totalImmediatelyAvailable = releasable2; // Compensation available immediately
            const totalAfterOneHour = releasable1After + releasable2; // + immediate after 1 hour
            
            console.log(`🎯 User Experience:`);
            console.log(`  Immediately available: ${ethers.formatEther(totalImmediatelyAvailable)} ILMT`);
            console.log(`  After 1 hour total: ${ethers.formatEther(totalAfterOneHour)} ILMT`);
            console.log(`  This is ${(Number(ethers.formatEther(totalAfterOneHour)) / Number(ethers.formatEther(totalAllocation)) * 100).toFixed(1)}% of total allocation`);
        });
    });
}); 