import { expect } from "chai";
import { ethers } from "hardhat";
import fs from 'fs';
import path from 'path';
import { RetroactiveVestingDeployer, VestingConfig } from "../scripts/deploy-retroactive-vesting";

describe("Retroactive Vesting Deployment Script", function () {
    let token: any;
    let vesting: any;
    let owner: any;
    let testConfig: VestingConfig;
    let testCsvPath: string;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy test contracts
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        token = await MockERC20Factory.deploy("Test Token", "TEST", INITIAL_SUPPLY);

        const VestingFactory = await ethers.getContractFactory("ILMTVesting");
        vesting = await VestingFactory.deploy(token.target);

        // Transfer tokens to vesting contract
        await token.transfer(vesting.target, INITIAL_SUPPLY);

        // Get additional signers for test addresses
        const [, addr1, addr2] = await ethers.getSigners();
        
        // Create test CSV file
        testCsvPath = path.join(__dirname, 'test-investors.csv');
        const csvContent = `address,totalAllocation,name
${owner.address},1000,Test Investor 1
${addr1.address},500,Test Investor 2
${addr2.address},750,Test Investor 3`;
        
        fs.writeFileSync(testCsvPath, csvContent);

        // Test configuration
        testConfig = {
            shouldHaveStartedDate: "2024-01-05",
            actualDeployDate: "2024-01-25",
            immediateReleaseHours: 1,
            csvFilePath: testCsvPath,
            contractAddress: vesting.target as string,
            tokenAddress: token.target as string,
            batchSize: 10, // Small batch for testing
            maxGasPrice: "20"
        };
    });

    afterEach(async function () {
        // Clean up test CSV file
        if (fs.existsSync(testCsvPath)) {
            fs.unlinkSync(testCsvPath);
        }
    });

    describe("CSV Loading and Validation", function () {
        it("Should load investors from CSV correctly", async function () {
            const deployer = new RetroactiveVestingDeployer(testConfig);
            const investors = await deployer.loadInvestorsFromCSV();

            expect(investors).to.have.lengthOf(3);
            expect(investors[0].address).to.equal(owner.address);
            expect(investors[0].totalAllocation).to.equal(1000);
            expect(investors[0].name).to.equal("Test Investor 1");
        });

        it("Should validate investor addresses", async function () {
            // Create CSV with invalid address
            const invalidCsvPath = path.join(__dirname, 'invalid-investors.csv');
            const invalidCsvContent = `address,totalAllocation,name
invalid_address,1000,Invalid Investor
${owner.address},500,Valid Investor`;
            
            fs.writeFileSync(invalidCsvPath, invalidCsvContent);

            const invalidConfig = { ...testConfig, csvFilePath: invalidCsvPath };
            const deployer = new RetroactiveVestingDeployer(invalidConfig);
            
            const investors = await deployer.loadInvestorsFromCSV();

            // Should only load valid investor
            expect(investors).to.have.lengthOf(1);
            expect(investors[0].address).to.equal(owner.address);

            // Clean up
            fs.unlinkSync(invalidCsvPath);
        });

        it("Should handle missing CSV file", async function () {
            const missingConfig = { ...testConfig, csvFilePath: "./non-existent.csv" };
            const deployer = new RetroactiveVestingDeployer(missingConfig);

            await expect(deployer.loadInvestorsFromCSV()).to.be.rejectedWith("CSV file not found");
        });
    });

    describe("Contract Setup and Validation", function () {
        it("Should setup contracts correctly", async function () {
            const deployer = new RetroactiveVestingDeployer(testConfig);
            await deployer.loadInvestorsFromCSV();
            await deployer.setupContracts();

            // Contract should be properly initialized
            const contractOwner = await vesting.owner();
            expect(contractOwner).to.equal(owner.address);
        });

        it("Should calculate token requirements correctly", async function () {
            const deployer = new RetroactiveVestingDeployer(testConfig);
            await deployer.loadInvestorsFromCSV();
            await deployer.setupContracts();

            // This should not throw and should show calculations
            const calculations = await deployer.validateAndCalculate();
            
            expect(calculations.daysDelayed).to.equal(20);
            expect(calculations.totalTokensNeeded).to.be.gt(0);
            expect(calculations.totalCompensation).to.be.gt(0);
        });

        it("Should detect insufficient tokens", async function () {
            // Create a vesting contract with no tokens
            const VestingFactory = await ethers.getContractFactory("ILMTVesting");
            const emptyVesting = await VestingFactory.deploy(token.target);
            
            const emptyConfig = { ...testConfig, contractAddress: emptyVesting.target as string };
            const deployer = new RetroactiveVestingDeployer(emptyConfig);
            
            await deployer.loadInvestorsFromCSV();
            await deployer.setupContracts();

            await expect(deployer.validateAndCalculate()).to.be.rejectedWith("Insufficient tokens");
        });
    });

    describe("Gas Optimization and Batch Processing", function () {
        it("Should generate correct vesting parameters", async function () {
            const deployer = new RetroactiveVestingDeployer(testConfig);
            await deployer.loadInvestorsFromCSV();
            await deployer.setupContracts();
            
            const calculations = await deployer.validateAndCalculate();
            const params = deployer.generateVestingParams(calculations.shouldHaveStarted);

            // Should have 2 schedules per investor (immediate + daily vesting)
            expect(params).to.have.lengthOf(6); // 3 investors × 2 schedules

            // Check first investor's schedules
            const immediateSchedule = params[0];
            const vestingSchedule = params[1];

            expect(immediateSchedule.beneficiary).to.equal(owner.address);
            expect(immediateSchedule.duration).to.equal(3600); // 1 hour
            expect(vestingSchedule.beneficiary).to.equal(owner.address);
            expect(vestingSchedule.duration).to.equal(365 * 24 * 3600); // 1 year
            expect(vestingSchedule.slicePeriodSeconds).to.equal(24 * 3600); // Daily
        });

        it("Should calculate realistic gas estimates", async function () {
            const deployer = new RetroactiveVestingDeployer(testConfig);
            await deployer.loadInvestorsFromCSV();
            await deployer.setupContracts();
            
            const calculations = await deployer.validateAndCalculate();
            const params = deployer.generateVestingParams(calculations.shouldHaveStarted);
            const gasEstimate = await deployer.estimateGasCosts(params);

            if (gasEstimate) {
                expect(gasEstimate.gasPerBatch).to.be.gt(0);
                expect(gasEstimate.totalGas).to.be.gt(0);
                expect(gasEstimate.batchCount).to.be.gt(0);
            }
        });
    });

    describe("Full Deployment Simulation", function () {
        it("Should complete full deployment process", async function () {
            this.timeout(30000); // Increase timeout for full deployment

            const deployer = new RetroactiveVestingDeployer(testConfig);
            const report = await deployer.run();

            // Verify deployment completed
            expect(report.totalInvestors).to.equal(3);
            expect(report.processedInvestors).to.equal(3);
            expect(report.successRate).to.equal(100);
            expect(report.contractAddress).to.equal(vesting.target);

            // Verify schedules were created
            const finalScheduleCount = await vesting.getVestingSchedulesCount();
            expect(finalScheduleCount).to.equal(6); // 3 investors × 2 schedules

            console.log(`✅ Full deployment test completed successfully!`);
            console.log(`   Contract: ${report.contractAddress}`);
            console.log(`   Investors processed: ${report.processedInvestors}/${report.totalInvestors}`);
            console.log(`   Success rate: ${report.successRate}%`);
        });

        it("Should handle batch processing correctly", async function () {
            // Create config with small batch size to test batching
            const batchConfig = { ...testConfig, batchSize: 1 }; // 1 investor per batch
            const deployer = new RetroactiveVestingDeployer(batchConfig);
            
            const report = await deployer.run();

            // Should still process all investors despite small batches
            expect(report.processedInvestors).to.equal(3);
            expect(report.successRate).to.equal(100);
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle empty CSV file", async function () {
            const emptyCsvPath = path.join(__dirname, 'empty-investors.csv');
            fs.writeFileSync(emptyCsvPath, 'address,totalAllocation,name\n');

            const emptyConfig = { ...testConfig, csvFilePath: emptyCsvPath };
            const deployer = new RetroactiveVestingDeployer(emptyConfig);
            
            const investors = await deployer.loadInvestorsFromCSV();
            expect(investors).to.have.lengthOf(0);

            fs.unlinkSync(emptyCsvPath);
        });

        it("Should validate date format and calculate days correctly", async function () {
            const deployer = new RetroactiveVestingDeployer(testConfig);
            await deployer.loadInvestorsFromCSV();
            await deployer.setupContracts();
            
            const calculations = await deployer.validateAndCalculate();
            
            // Should calculate 20 days between Jan 5 and Jan 25
            expect(calculations.daysDelayed).to.equal(20);
        });

        it("Should handle different allocation amounts correctly", async function () {
            const [, addr1, addr2] = await ethers.getSigners();
            
            const mixedCsvPath = path.join(__dirname, 'mixed-investors.csv');
            const mixedCsvContent = `address,totalAllocation,name
${owner.address},100,Small Investor
${addr1.address},10000,Large Investor
${addr2.address},0.5,Micro Investor`;
            
            fs.writeFileSync(mixedCsvPath, mixedCsvContent);

            const mixedConfig = { ...testConfig, csvFilePath: mixedCsvPath };
            const deployer = new RetroactiveVestingDeployer(mixedConfig);
            
            const investors = await deployer.loadInvestorsFromCSV();
            
            expect(investors).to.have.lengthOf(3);
            expect(investors[0].totalAllocation).to.equal(100);
            expect(investors[1].totalAllocation).to.equal(10000);
            expect(investors[2].totalAllocation).to.equal(0.5);

            fs.unlinkSync(mixedCsvPath);
        });
    });
}); 