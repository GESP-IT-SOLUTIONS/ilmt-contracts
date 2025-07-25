import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ILMTVesting - Airdrop Scenario Implementation", function () {
    let vesting: any;
    let token: any;
    let owner: any;
    let user1: any;
    let user2: any;
    let user3: any;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    
    // User allocations (example)
    const USER1_TOTAL = ethers.parseEther("1000"); // 1000 ILMT total allocation
    const USER2_TOTAL = ethers.parseEther("500");  // 500 ILMT total allocation
    const USER3_TOTAL = ethers.parseEther("2000"); // 2000 ILMT total allocation

    const ONE_DAY = 86400;
    const ONE_YEAR = ONE_DAY * 365;

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy Mock Token
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        token = await MockERC20Factory.deploy("Test Token", "TEST", INITIAL_SUPPLY);

        // Deploy Vesting Contract
        const VestingFactory = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingFactory.deploy(token.target);

        // Transfer tokens to vesting contract
        await token.transfer(vesting.target, INITIAL_SUPPLY);
    });

    describe("Airdrop Scenario: 15% airdropped + 10% immediate + 75% daily vesting", function () {
        it("Should implement complete airdrop scenario for multiple users", async function () {
            const startTime = await time.latest();

            // Simulate the airdrop scenario implementation
            const users = [
                { address: user1.address, totalAllocation: USER1_TOTAL },
                { address: user2.address, totalAllocation: USER2_TOTAL },
                { address: user3.address, totalAllocation: USER3_TOTAL }
            ];

            const allVestingParams = [];

            // Create vesting schedules for all users
            for (const user of users) {
                // Calculate amounts
                const immediateAmount = user.totalAllocation * 10n / 100n; // 10%
                const vestingAmount = user.totalAllocation * 75n / 100n;   // 75%

                // Schedule 1: Immediate 10% release
                allVestingParams.push({
                    beneficiary: user.address,
                    start: startTime,
                    cliff: 0, // No cliff - immediate
                    duration: ONE_DAY, // 1 day duration for single release
                    slicePeriodSeconds: ONE_DAY, // Release all at once
                    revocable: false,
                    amount: immediateAmount
                });

                // Schedule 2: Daily vesting for 75% over 1 year
                allVestingParams.push({
                    beneficiary: user.address,
                    start: startTime,
                    cliff: 0, // No cliff - start immediately
                    duration: ONE_YEAR, // 1 year total duration
                    slicePeriodSeconds: ONE_DAY, // Daily releases
                    revocable: false,
                    amount: vestingAmount
                });
            }

            // Create all vesting schedules at once
            await vesting.createVestingSchedule(allVestingParams);

            // Verify implementation for each user
            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                const userAddress = user.address;
                const expectedTotal = user.totalAllocation;

                // Check schedule count
                const scheduleCount = await vesting.getVestingSchedulesCountByBeneficiary(userAddress);
                expect(scheduleCount).to.equal(2);

                // Get all schedules
                const schedules = await vesting.getAllVestingSchedulesForBeneficiary(userAddress);
                expect(schedules.length).to.equal(2);

                // Verify Schedule 1 (Immediate 10%)
                const schedule1 = schedules[0];
                const expectedImmediate = expectedTotal * 10n / 100n;
                expect(schedule1.amountTotal).to.equal(expectedImmediate);
                expect(schedule1.duration).to.equal(ONE_DAY);
                expect(schedule1.slicePeriodSeconds).to.equal(ONE_DAY);
                expect(schedule1.cliff).to.equal(startTime); // cliff = start + 0
                expect(schedule1.revocable).to.be.false;

                // Verify Schedule 2 (Daily vesting 75%)
                const schedule2 = schedules[1];
                const expectedVesting = expectedTotal * 75n / 100n;
                expect(schedule2.amountTotal).to.equal(expectedVesting);
                expect(schedule2.duration).to.equal(ONE_YEAR);
                expect(schedule2.slicePeriodSeconds).to.equal(ONE_DAY);
                expect(schedule2.cliff).to.equal(startTime); // cliff = start + 0
                expect(schedule2.revocable).to.be.false;

                // Check totals
                const totalVested = await vesting.getTotalVestedAmountForBeneficiary(userAddress);
                const expectedContractTotal = expectedImmediate + expectedVesting; // 85%
                expect(totalVested).to.equal(expectedContractTotal);

                console.log(`\n✅ User ${i + 1} verification passed:`);
                console.log(`  Address: ${userAddress}`);
                console.log(`  Total allocation: ${ethers.formatEther(expectedTotal)} ILMT (100%)`);
                console.log(`  Already airdropped: ${ethers.formatEther(expectedTotal * 15n / 100n)} ILMT (15%)`);
                console.log(`  Immediate release: ${ethers.formatEther(expectedImmediate)} ILMT (10%)`);
                console.log(`  Daily vesting: ${ethers.formatEther(expectedVesting)} ILMT (75%)`);
                console.log(`  Total in contract: ${ethers.formatEther(totalVested)} ILMT (85%)`);
            }
        });

        it("Should allow immediate release from Schedule 1", async function () {
            const startTime = await time.latest();

            // Create vesting schedules for user1
            const immediateAmount = USER1_TOTAL * 10n / 100n; // 10%
            const vestingAmount = USER1_TOTAL * 75n / 100n;   // 75%

            const params = [
                {
                    beneficiary: user1.address,
                    start: startTime,
                    cliff: 0,
                    duration: ONE_DAY,
                    slicePeriodSeconds: ONE_DAY,
                    revocable: false,
                    amount: immediateAmount
                },
                {
                    beneficiary: user1.address,
                    start: startTime,
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

            // Check releasable amounts immediately
            const releasable1 = await vesting.computeReleasableAmount(scheduleId1);
            const releasable2 = await vesting.computeReleasableAmount(scheduleId2);

            // For immediate release, we need to advance time by 1 day to complete the first slice
            await time.increase(ONE_DAY);
            const releasable1Updated = await vesting.computeReleasableAmount(scheduleId1);
            const releasable2Updated = await vesting.computeReleasableAmount(scheduleId2);
            
            // Schedule 1 should be fully releasable after 1 day (single release)
            expect(releasable1Updated).to.equal(immediateAmount);
            // Schedule 2 should have daily amount releasable (1/365 of total)
            const expectedDaily = vestingAmount / 365n;
            expect(releasable2Updated).to.be.closeTo(expectedDaily, ethers.parseEther("0.1"));

            // Release from Schedule 1
            const initialBalance = await token.balanceOf(user1.address);
            await vesting.connect(user1).release(scheduleId1, releasable1Updated);
            const newBalance = await token.balanceOf(user1.address);

            expect(newBalance - initialBalance).to.equal(releasable1Updated);
            console.log(`✅ Released immediate 10%: ${ethers.formatEther(releasable1Updated)} ILMT`);
        });

        it("Should handle daily vesting from Schedule 2 correctly", async function () {
            const startTime = await time.latest();

            // Create daily vesting schedule only for simplicity
            const vestingAmount = USER1_TOTAL * 75n / 100n; // 75%

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

            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 0);

            // Initially no tokens releasable
            let releasable = await vesting.computeReleasableAmount(scheduleId);
            expect(releasable).to.equal(0);

            // Advance 1 day
            await time.increase(ONE_DAY);
            releasable = await vesting.computeReleasableAmount(scheduleId);

            // Should be able to release 1/365 of the total amount
            const expectedDaily = vestingAmount / 365n;
            expect(releasable).to.be.closeTo(expectedDaily, ethers.parseEther("0.1")); // Allow small rounding difference

            // Release daily amount
            const initialBalance = await token.balanceOf(user1.address);
            await vesting.connect(user1).release(scheduleId, releasable);
            const newBalance = await token.balanceOf(user1.address);

            expect(newBalance - initialBalance).to.equal(releasable);

            // Advance 10 more days
            await time.increase(ONE_DAY * 10);
            releasable = await vesting.computeReleasableAmount(scheduleId);

            // Should be able to release 10 more days worth
            const expectedFor10Days = expectedDaily * 10n;
            expect(releasable).to.be.closeTo(expectedFor10Days, ethers.parseEther("1")); // Allow rounding

            console.log(`✅ Daily vesting working correctly:`);
            console.log(`  Daily amount: ~${ethers.formatEther(expectedDaily)} ILMT`);
            console.log(`  10 days amount: ~${ethers.formatEther(releasable)} ILMT`);
        });

        it("Should calculate correct percentages for the complete scenario", async function () {
            // This test verifies the math for the complete airdrop scenario
            const totalAllocation = ethers.parseEther("1000"); // 1000 ILMT

            // Percentages
            const airdropped = totalAllocation * 15n / 100n;    // 150 ILMT (15%)
            const immediate = totalAllocation * 10n / 100n;     // 100 ILMT (10%)
            const vesting = totalAllocation * 75n / 100n;       // 750 ILMT (75%)

            // Verify totals
            const contractTotal = immediate + vesting;           // 850 ILMT (85%)
            const grandTotal = airdropped + contractTotal;      // 1000 ILMT (100%)

            expect(airdropped).to.equal(ethers.parseEther("150"));
            expect(immediate).to.equal(ethers.parseEther("100"));
            expect(vesting).to.equal(ethers.parseEther("750"));
            expect(contractTotal).to.equal(ethers.parseEther("850"));
            expect(grandTotal).to.equal(totalAllocation);

            console.log(`✅ Percentage calculations verified:`);
            console.log(`  Total allocation: ${ethers.formatEther(totalAllocation)} ILMT (100%)`);
            console.log(`  Already airdropped: ${ethers.formatEther(airdropped)} ILMT (15%)`);
            console.log(`  Immediate release: ${ethers.formatEther(immediate)} ILMT (10%)`);
            console.log(`  Daily vesting: ${ethers.formatEther(vesting)} ILMT (75%)`);
            console.log(`  Contract total: ${ethers.formatEther(contractTotal)} ILMT (85%)`);
            console.log(`  Grand total: ${ethers.formatEther(grandTotal)} ILMT (100%)`);
        });
    });

    describe("User Experience Simulation", function () {
        it("Should simulate complete user journey", async function () {
            const startTime = await time.latest();

            // Setup user1 with complete scenario
            const totalAllocation = USER1_TOTAL;
            const immediateAmount = totalAllocation * 10n / 100n; // 10%
            const vestingAmount = totalAllocation * 75n / 100n;   // 75%

            const params = [
                {
                    beneficiary: user1.address,
                    start: startTime,
                    cliff: 0,
                    duration: ONE_DAY,
                    slicePeriodSeconds: ONE_DAY,
                    revocable: false,
                    amount: immediateAmount
                },
                {
                    beneficiary: user1.address,
                    start: startTime,
                    cliff: 0,
                    duration: ONE_YEAR,
                    slicePeriodSeconds: ONE_DAY,
                    revocable: false,
                    amount: vestingAmount
                }
            ];

            await vesting.createVestingSchedule(params);

            console.log(`\n🎯 SIMULATING USER JOURNEY FOR ${user1.address}`);
            console.log(`Total allocation: ${ethers.formatEther(totalAllocation)} ILMT`);

            // Step 1: User checks their vesting info
            const scheduleCount = await vesting.getVestingSchedulesCountByBeneficiary(user1.address);
            const totalVested = await vesting.getTotalVestedAmountForBeneficiary(user1.address);
            const totalReleasable = await vesting.getTotalReleasableAmountForBeneficiary(user1.address);

            console.log(`\n📊 Initial Status:`);
            console.log(`  Vesting schedules: ${scheduleCount.toString()}`);
            console.log(`  Total in vesting contract: ${ethers.formatEther(totalVested)} ILMT`);
            console.log(`  Currently releasable: ${ethers.formatEther(totalReleasable)} ILMT`);

            // Step 2: User releases immediate 10%
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 0);
            const releasable1 = await vesting.computeReleasableAmount(scheduleId1);
            
            await vesting.connect(user1).release(scheduleId1, releasable1);
            let balance = await token.balanceOf(user1.address);
            
            console.log(`\n💰 After Immediate Release:`);
            console.log(`  Released: ${ethers.formatEther(releasable1)} ILMT (10%)`);
            console.log(`  User balance: ${ethers.formatEther(balance)} ILMT`);

            // Step 3: Simulate daily releases over time
            const scheduleId2 = await vesting.computeVestingScheduleIdForAddressAndIndex(user1.address, 1);
            
            for (let day = 1; day <= 5; day++) {
                await time.increase(ONE_DAY);
                
                const dailyReleasable = await vesting.computeReleasableAmount(scheduleId2);
                if (dailyReleasable > 0) {
                    await vesting.connect(user1).release(scheduleId2, dailyReleasable);
                    balance = await token.balanceOf(user1.address);
                    
                    console.log(`\n📅 Day ${day}:`);
                    console.log(`  Daily release: ${ethers.formatEther(dailyReleasable)} ILMT`);
                    console.log(`  Total balance: ${ethers.formatEther(balance)} ILMT`);
                }
            }

            // Final status
            const finalReleasable = await vesting.getTotalReleasableAmountForBeneficiary(user1.address);
            console.log(`\n🏁 After 5 days:`);
            console.log(`  Total user balance: ${ethers.formatEther(balance)} ILMT`);
            console.log(`  Still releasable: ${ethers.formatEther(finalReleasable)} ILMT`);
            console.log(`  Remaining vesting: ~${365 - 5} days`);
        });
    });
}); 