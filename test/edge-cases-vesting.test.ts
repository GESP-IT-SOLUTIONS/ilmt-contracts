import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ILMTVesting - Edge Cases: Multiple Schedules per Address", function () {
    let vesting: any;
    let token: any;
    let owner: any;
    let beneficiary: any;
    let otherAccount: any;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const VESTING_AMOUNT = ethers.parseEther("1000");
    const CLIFF_DURATION = 86400; // 1 day
    const VESTING_DURATION = 86400 * 30; // 30 days
    const SLICE_PERIOD = 86400; // 1 day

    beforeEach(async function () {
        [owner, beneficiary, otherAccount] = await ethers.getSigners();

        // Deploy Mock Token
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        token = await MockERC20Factory.deploy("Test Token", "TEST", INITIAL_SUPPLY);

        // Deploy Vesting Contract
        const VestingFactory = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingFactory.deploy(token.target);

        // Transfer tokens to vesting contract
        await token.transfer(vesting.target, INITIAL_SUPPLY);
    });

    describe("Multiple Vesting Schedules per Address", function () {
        it("Should allow creating multiple vesting schedules for same beneficiary", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime + 86400, // Start 1 day later
                    cliff: CLIFF_DURATION * 2,
                    duration: VESTING_DURATION * 2,
                    slicePeriodSeconds: SLICE_PERIOD * 2,
                    revocable: false,
                    amount: VESTING_AMOUNT * 2n
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime + 172800, // Start 2 days later
                    cliff: 0, // No cliff
                    duration: VESTING_DURATION / 2,
                    slicePeriodSeconds: SLICE_PERIOD / 2,
                    revocable: true,
                    amount: VESTING_AMOUNT / 2n
                }
            ];

            await vesting.createVestingSchedule(params);

            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary.address)).to.equal(3);
            
            // Check all schedules are created correctly
            const schedules = await vesting.getAllVestingSchedulesForBeneficiary(beneficiary.address);
            expect(schedules.length).to.equal(3);
            
            expect(schedules[0].amountTotal).to.equal(VESTING_AMOUNT);
            expect(schedules[1].amountTotal).to.equal(VESTING_AMOUNT * 2n);
            expect(schedules[2].amountTotal).to.equal(VESTING_AMOUNT / 2n);
        });

        it("Should calculate correct vesting schedule IDs for multiple schedules", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT
                }
            ];

            await vesting.createVestingSchedule(params);

            const scheduleId0 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 1);

            expect(scheduleId0).to.not.equal(scheduleId1);

            const schedule0 = await vesting.getVestingSchedule(scheduleId0);
            const schedule1 = await vesting.getVestingSchedule(scheduleId1);

            expect(schedule0.revocable).to.be.true;
            expect(schedule1.revocable).to.be.false;
        });

        it("Should handle releasing from multiple schedules correctly", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0, // No cliff for immediate release
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0, // No cliff for immediate release
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT * 2n
                }
            ];

            await vesting.createVestingSchedule(params);

            const scheduleId0 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 1);

            // Advance time to make some tokens releasable
            await time.increase(SLICE_PERIOD);

            const releasable0 = await vesting.computeReleasableAmount(scheduleId0);
            const releasable1 = await vesting.computeReleasableAmount(scheduleId1);

            expect(releasable0).to.be.gt(0);
            expect(releasable1).to.be.gt(0);

            // Release from first schedule
            const initialBalance = await token.balanceOf(beneficiary.address);
            await vesting.connect(beneficiary).release(scheduleId0, releasable0);
            
            let newBalance = await token.balanceOf(beneficiary.address);
            expect(newBalance - initialBalance).to.equal(releasable0);

            // Release from second schedule
            await vesting.connect(beneficiary).release(scheduleId1, releasable1);
            
            const finalBalance = await token.balanceOf(beneficiary.address);
            expect(finalBalance - newBalance).to.equal(releasable1);
        });

        it("Should correctly calculate total releasable amount across all schedules", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT * 2n
                }
            ];

            await vesting.createVestingSchedule(params);

            await time.increase(SLICE_PERIOD);

            const totalReleasable = await vesting.getTotalReleasableAmountForBeneficiary(beneficiary.address);
            
            const scheduleId0 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 1);
            
            const releasable0 = await vesting.computeReleasableAmount(scheduleId0);
            const releasable1 = await vesting.computeReleasableAmount(scheduleId1);

            expect(totalReleasable).to.equal(releasable0 + releasable1);
        });

        it("Should handle revoking one schedule while keeping others active", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT * 2n
                }
            ];

            await vesting.createVestingSchedule(params);

            const scheduleId0 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 1);

            // Revoke first schedule (revocable)
            await vesting.revoke(scheduleId0);

            const schedule0 = await vesting.getVestingSchedule(scheduleId0);
            const schedule1 = await vesting.getVestingSchedule(scheduleId1);

            expect(schedule0.revoked).to.be.true;
            expect(schedule1.revoked).to.be.false;

            // Should not be able to revoke non-revocable schedule
            await expect(vesting.revoke(scheduleId1))
                .to.be.revertedWith("ILMTVesting: vesting is not revocable");
        });
    });

    describe("Edge Cases and Attack Vectors", function () {
        it("Should prevent overflow in holdersVestingCount", async function () {
            // This is a theoretical test - in practice, MAX_BATCH_SIZE limits this
            const startTime = await time.latest();
            
            // Create multiple batches to test counter
            for (let batch = 0; batch < 3; batch++) {
                const params = [];
                for (let i = 0; i < 10; i++) {
                    params.push({
                        beneficiary: beneficiary.address,
                        start: startTime + (batch * 1000) + i,
                        cliff: 0,
                        duration: VESTING_DURATION,
                        slicePeriodSeconds: SLICE_PERIOD,
                        revocable: true,
                        amount: ethers.parseEther("10")
                    });
                }
                await vesting.createVestingSchedule(params);
            }

            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary.address)).to.equal(30);
        });

        it("Should handle gas limits when retrieving many schedules", async function () {
            const startTime = await time.latest();
            
            // Create many schedules for the same beneficiary
            const params = [];
            for (let i = 0; i < 50; i++) {
                params.push({
                    beneficiary: beneficiary.address,
                    start: startTime + i,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: ethers.parseEther("10")
                });
            }
            await vesting.createVestingSchedule(params);

            // This should work but might be gas-intensive
            const schedules = await vesting.getAllVestingSchedulesForBeneficiary(beneficiary.address);
            expect(schedules.length).to.equal(50);
        });

        it("Should maintain correct state when mixing single and batch operations", async function () {
            const startTime = await time.latest();
            
            // First batch
            let params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                }
            ];
            await vesting.createVestingSchedule(params);

            // Second batch with same beneficiary
            params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime + 86400,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT * 2n
                }
            ];
            await vesting.createVestingSchedule(params);

            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary.address)).to.equal(2);
            
            const scheduleIds = await vesting.getAllVestingScheduleIdsForBeneficiary(beneficiary.address);
            expect(scheduleIds.length).to.equal(2);
            expect(scheduleIds[0]).to.not.equal(scheduleIds[1]);
        });

        it("Should handle zero-amount edge case correctly", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: 0 // This should fail
                }
            ];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: amount must be > 0");
        });

        it("Should correctly handle different slice periods in multiple schedules", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: 3600, // 1 hour
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary.address,
                    start: startTime,
                    cliff: 0,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: 86400, // 1 day
                    revocable: false,
                    amount: VESTING_AMOUNT
                }
            ];

            await vesting.createVestingSchedule(params);

            // Advance time by 1 hour
            await time.increase(3600);

            const scheduleId0 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 0);
            const scheduleId1 = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary.address, 1);

            const releasable0 = await vesting.computeReleasableAmount(scheduleId0);
            const releasable1 = await vesting.computeReleasableAmount(scheduleId1);

            // First schedule should have releasable tokens (1-hour slice)
            expect(releasable0).to.be.gt(0);
            // Second schedule should have no releasable tokens yet (1-day slice)
            expect(releasable1).to.equal(0);
        });
    });
}); 