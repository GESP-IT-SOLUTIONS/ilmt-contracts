import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ILMTVesting", function () {
    let vesting: any;
    let token: any;
    let owner: any;
    let beneficiary1: any;
    let beneficiary2: any;
    let beneficiary3: any;
    let nonOwner: any;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const VESTING_AMOUNT = ethers.parseEther("1000");
    const CLIFF_DURATION = 86400; // 1 day
    const VESTING_DURATION = 365 * 86400; // 1 year
    const SLICE_PERIOD = 86400; // 1 day

    beforeEach(async function () {
        [owner, beneficiary1, beneficiary2, beneficiary3, nonOwner] = await ethers.getSigners();

        // Deploy mock token
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        token = await MockERC20Factory.deploy("Test Token", "TEST", INITIAL_SUPPLY);
        await token.waitForDeployment();

        // Deploy vesting contract
        const VestingFactory = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingFactory.deploy(await token.getAddress());
        await vesting.waitForDeployment();

        // Transfer tokens to vesting contract
        await token.transfer(await vesting.getAddress(), INITIAL_SUPPLY);
    });

    describe("Deployment", function () {
        it("Should set the correct token address", async function () {
            expect(await vesting.token()).to.equal(await token.getAddress());
        });

        it("Should set the correct owner", async function () {
            expect(await vesting.owner()).to.equal(owner.address);
        });

        it("Should revert if token address is zero", async function () {
            const VestingFactory = await ethers.getContractFactory("ILMTVesting");
            await expect(VestingFactory.deploy(ethers.ZeroAddress))
                .to.be.revertedWith("ILMTVesting: invalid token address");
        });

        it("Should start unpaused", async function () {
            expect(await vesting.paused()).to.be.false;
        });
    });

    describe("Pause/Unpause", function () {
        it("Should pause the contract", async function () {
            await vesting.pause();
            expect(await vesting.paused()).to.be.true;
        });

        it("Should unpause the contract", async function () {
            await vesting.pause();
            await vesting.unpause();
            expect(await vesting.paused()).to.be.false;
        });

        it("Should emit events when pausing/unpausing", async function () {
            await expect(vesting.pause())
                .to.emit(vesting, "ContractPaused")
                .withArgs(owner.address);

            await expect(vesting.unpause())
                .to.emit(vesting, "ContractUnpaused")
                .withArgs(owner.address);
        });

        it("Should revert if non-owner tries to pause", async function () {
            await expect(vesting.connect(nonOwner).pause())
                .to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should revert operations when paused", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await vesting.pause();

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("Pausable: paused");
        });
    });

    describe("Create Vesting Schedule", function () {
        it("Should create a single vesting schedule", async function () {
            const startTime = await time.latest();
            const params = [{
                beneficiary: beneficiary1.address,
                start: startTime,
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.emit(vesting, "VestingScheduleCreated");

            expect(await vesting.getVestingSchedulesCount()).to.equal(1);
            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary1.address)).to.equal(1);
        });

        it("Should create multiple vesting schedules", async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary1.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary2.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT
                }
            ];

            await vesting.createVestingSchedule(params);

            expect(await vesting.getVestingSchedulesCount()).to.equal(2);
            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary1.address)).to.equal(1);
            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary2.address)).to.equal(1);
        });

        it("Should revert if params array is empty", async function () {
            await expect(vesting.createVestingSchedule([]))
                .to.be.revertedWith("ILMTVesting: empty params array");
        });

        it("Should revert if batch size exceeds limit", async function () {
            const params = Array(101).fill({
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: ethers.parseEther("1")
            });

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: batch size exceeds limit");
        });

        it("Should revert if beneficiary is zero address", async function () {
            const params = [{
                beneficiary: ethers.ZeroAddress,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: beneficiary cannot be zero address");
        });

        it("Should revert if amount is zero", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: 0
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: amount must be > 0");
        });

        it("Should revert if duration is zero", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: 0,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: duration must be > 0");
        });

        it("Should revert if cliff is greater than duration", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: VESTING_DURATION + 1,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: duration must be >= cliff");
        });

        it("Should revert if slice period is greater than duration", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: VESTING_DURATION + 1,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: slicePeriodSeconds must be <= duration");
        });

        it("Should revert if insufficient tokens", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: INITIAL_SUPPLY + 1n
            }];

            await expect(vesting.createVestingSchedule(params))
                .to.be.revertedWith("ILMTVesting: cannot create vesting schedule because not sufficient tokens");
        });

        it("Should revert if non-owner tries to create vesting schedule", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await expect(vesting.connect(nonOwner).createVestingSchedule(params))
                .to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Token Release", function () {
        let scheduleId: string;
        let startTime: number;

        beforeEach(async function () {
            startTime = await time.latest();
            const params = [{
                beneficiary: beneficiary1.address,
                start: startTime,
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await vesting.createVestingSchedule(params);
            scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary1.address, 0);
        });

        it("Should not release tokens before cliff", async function () {
            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            expect(releasableAmount).to.equal(0);
        });

        it("Should release tokens after cliff", async function () {
            // Move time to after cliff
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            expect(releasableAmount).to.be.gt(0);
        });

        it("Should allow beneficiary to release tokens", async function () {
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            const initialBalance = await token.balanceOf(beneficiary1.address);

            await expect(vesting.connect(beneficiary1).release(scheduleId, releasableAmount))
                .to.emit(vesting, "TokensReleased")
                .withArgs(scheduleId, beneficiary1.address, releasableAmount);

            const finalBalance = await token.balanceOf(beneficiary1.address);
            expect(finalBalance - initialBalance).to.equal(releasableAmount);
        });

        it("Should allow owner to release tokens", async function () {
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            const initialBalance = await token.balanceOf(beneficiary1.address);

            await vesting.release(scheduleId, releasableAmount);

            const finalBalance = await token.balanceOf(beneficiary1.address);
            expect(finalBalance - initialBalance).to.equal(releasableAmount);
        });

        it("Should revert if non-beneficiary/non-owner tries to release", async function () {
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);

            await expect(vesting.connect(nonOwner).release(scheduleId, releasableAmount))
                .to.be.revertedWith("ILMTVesting: only beneficiary and owner can release vested tokens");
        });

        it("Should revert if trying to release more than available", async function () {
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);

            await expect(vesting.connect(beneficiary1).release(scheduleId, releasableAmount + 1n))
                .to.be.revertedWith("ILMTVesting: cannot release tokens, not enough vested tokens");
        });

        it("Should release all tokens after vesting period ends", async function () {
            await time.increaseTo(startTime + VESTING_DURATION + 1);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            expect(releasableAmount).to.equal(VESTING_AMOUNT);
        });
    });

    describe("Revoke Vesting Schedule", function () {
        let scheduleId: string;
        let startTime: number;

        beforeEach(async function () {
            startTime = await time.latest();
            const params = [{
                beneficiary: beneficiary1.address,
                start: startTime,
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await vesting.createVestingSchedule(params);
            scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary1.address, 0);
        });

        it("Should revoke vesting schedule", async function () {
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);

            await expect(vesting.revoke(scheduleId))
                .to.emit(vesting, "VestingScheduleRevoked")
                .withArgs(scheduleId, beneficiary1.address, releasableAmount, VESTING_AMOUNT - releasableAmount);

            const schedule = await vesting.getVestingSchedule(scheduleId);
            expect(schedule.revoked).to.be.true;
        });

        it("Should release vested tokens before revoking", async function () {
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const initialBalance = await token.balanceOf(beneficiary1.address);
            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);

            await vesting.revoke(scheduleId);

            const finalBalance = await token.balanceOf(beneficiary1.address);
            expect(finalBalance - initialBalance).to.equal(releasableAmount);
        });

        it("Should revert if trying to revoke non-revocable schedule", async function () {
            const params = [{
                beneficiary: beneficiary2.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: false,
                amount: VESTING_AMOUNT
            }];

            await vesting.createVestingSchedule(params);
            const nonRevocableScheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary2.address, 0);

            await expect(vesting.revoke(nonRevocableScheduleId))
                .to.be.revertedWith("ILMTVesting: vesting is not revocable");
        });

        it("Should revert if trying to revoke already revoked schedule", async function () {
            await vesting.revoke(scheduleId);

            await expect(vesting.revoke(scheduleId))
                .to.be.revertedWith("ILMTVesting: vesting schedule is revoked");
        });

        it("Should revert if non-owner tries to revoke", async function () {
            await expect(vesting.connect(nonOwner).revoke(scheduleId))
                .to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Withdraw", function () {
        it("Should allow owner to withdraw unallocated tokens", async function () {
            const withdrawAmount = ethers.parseEther("1000");
            const initialBalance = await token.balanceOf(owner.address);

            await expect(vesting.withdraw(withdrawAmount))
                .to.emit(vesting, "TokensWithdrawn")
                .withArgs(owner.address, withdrawAmount);

            const finalBalance = await token.balanceOf(owner.address);
            expect(finalBalance - initialBalance).to.equal(withdrawAmount);
        });

        it("Should revert if trying to withdraw more than available", async function () {
            // Create a vesting schedule to allocate some tokens
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: CLIFF_DURATION,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await vesting.createVestingSchedule(params);

            const withdrawableAmount = await vesting.getWithdrawableAmount();
            
            await expect(vesting.withdraw(withdrawableAmount + 1n))
                .to.be.revertedWith("ILMTVesting: not enough withdrawable funds");
        });

        it("Should revert if non-owner tries to withdraw", async function () {
            await expect(vesting.connect(nonOwner).withdraw(ethers.parseEther("1000")))
                .to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            const startTime = await time.latest();
            const params = [
                {
                    beneficiary: beneficiary1.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary1.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: false,
                    amount: VESTING_AMOUNT
                },
                {
                    beneficiary: beneficiary2.address,
                    start: startTime,
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: VESTING_AMOUNT
                }
            ];

            await vesting.createVestingSchedule(params);
        });

        it("Should return correct vesting schedules count", async function () {
            expect(await vesting.getVestingSchedulesCount()).to.equal(3);
        });

        it("Should return correct vesting schedules count by beneficiary", async function () {
            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary1.address)).to.equal(2);
            expect(await vesting.getVestingSchedulesCountByBeneficiary(beneficiary2.address)).to.equal(1);
        });

        it("Should return correct total vesting amount", async function () {
            expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(VESTING_AMOUNT * 3n);
        });

        it("Should return correct withdrawable amount", async function () {
            const expectedWithdrawable = INITIAL_SUPPLY - (VESTING_AMOUNT * 3n);
            expect(await vesting.getWithdrawableAmount()).to.equal(expectedWithdrawable);
        });

        it("Should return vesting schedule by address and index", async function () {
            const schedule = await vesting.getVestingScheduleByAddressAndIndex(beneficiary1.address, 0);
            expect(schedule.beneficiary).to.equal(beneficiary1.address);
            expect(schedule.amountTotal).to.equal(VESTING_AMOUNT);
        });

        it("Should return vesting ID at index", async function () {
            const scheduleId = await vesting.getVestingIdAtIndex(0);
            expect(scheduleId).to.not.equal(ethers.ZeroHash);
        });

        it("Should return last vesting schedule for holder", async function () {
            const lastSchedule = await vesting.getLastVestingScheduleForHolder(beneficiary1.address);
            expect(lastSchedule.beneficiary).to.equal(beneficiary1.address);
            expect(lastSchedule.revocable).to.be.false; // Second schedule is non-revocable
        });

        it("Should return all vesting schedules for beneficiary", async function () {
            const schedules = await vesting.getAllVestingSchedulesForBeneficiary(beneficiary1.address);
            expect(schedules.length).to.equal(2);
            expect(schedules[0].beneficiary).to.equal(beneficiary1.address);
            expect(schedules[1].beneficiary).to.equal(beneficiary1.address);
        });

        it("Should return all vesting schedule IDs for beneficiary", async function () {
            const scheduleIds = await vesting.getAllVestingScheduleIdsForBeneficiary(beneficiary1.address);
            expect(scheduleIds.length).to.equal(2);
        });

        it("Should return total releasable amount for beneficiary", async function () {
            const startTime = await time.latest();
            await time.increaseTo(startTime + CLIFF_DURATION + SLICE_PERIOD);

            const totalReleasable = await vesting.getTotalReleasableAmountForBeneficiary(beneficiary1.address);
            expect(totalReleasable).to.be.gt(0);
        });

        it("Should return total vested amount for beneficiary", async function () {
            const totalVested = await vesting.getTotalVestedAmountForBeneficiary(beneficiary1.address);
            expect(totalVested).to.equal(VESTING_AMOUNT * 2n);
        });

        it("Should check if vesting schedule exists", async function () {
            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary1.address, 0);
            expect(await vesting.vestingScheduleExists(scheduleId)).to.be.true;

            const nonExistentId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary3.address, 0);
            expect(await vesting.vestingScheduleExists(nonExistentId)).to.be.false;
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero cliff period", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: 0,
                duration: VESTING_DURATION,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await vesting.createVestingSchedule(params);
            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary1.address, 0);

            // Should be able to release after first slice period
            await time.increase(SLICE_PERIOD);
            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            expect(releasableAmount).to.be.gt(0);
        });

        it("Should handle single slice period vesting", async function () {
            const params = [{
                beneficiary: beneficiary1.address,
                start: await time.latest(),
                cliff: 0,
                duration: SLICE_PERIOD,
                slicePeriodSeconds: SLICE_PERIOD,
                revocable: true,
                amount: VESTING_AMOUNT
            }];

            await vesting.createVestingSchedule(params);
            const scheduleId = await vesting.computeVestingScheduleIdForAddressAndIndex(beneficiary1.address, 0);

            await time.increase(SLICE_PERIOD);

            const releasableAmount = await vesting.computeReleasableAmount(scheduleId);
            expect(releasableAmount).to.equal(VESTING_AMOUNT);
        });

        it("Should handle large batch operations efficiently", async function () {
            const batchSize = 50;
            const params = [];

            for (let i = 0; i < batchSize; i++) {
                params.push({
                    beneficiary: beneficiary1.address,
                    start: await time.latest(),
                    cliff: CLIFF_DURATION,
                    duration: VESTING_DURATION,
                    slicePeriodSeconds: SLICE_PERIOD,
                    revocable: true,
                    amount: ethers.parseEther("10")
                });
            }

            await vesting.createVestingSchedule(params);
            expect(await vesting.getVestingSchedulesCount()).to.equal(batchSize);
        });
    });
}); 