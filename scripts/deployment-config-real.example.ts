import { VestingConfig } from './deploy-retroactive-vesting';

// REAL DEPLOYMENT CONFIGURATION - July 25, 2025
// Update these dates with your actual scenario

export const realDeploymentConfig: VestingConfig = {
    // 🎯 IMPORTANT: Update these dates for your real scenario!
    shouldHaveStartedDate: "2025-??-??",    // When daily vesting should have started
    actualDeployDate: "2025-07-25",         // Today when you're deploying
    
    // Contract and file configuration
    immediateReleaseHours: 1,                // Hours to wait for 10% immediate release
    csvFilePath: "./scripts/investors.csv",  // Path to your 100 investors CSV
    tokenAddress: "0x...",                   // Your ILMT token contract address
    contractAddress: "0x...",                // Your vesting contract address (optional)
    
    // Gas optimization for 100 investors
    batchSize: 25,                          // 25 investors per batch = 4 batches total
    gasLimit: 800000,                       // Gas limit per batch
    maxGasPrice: "20"                       // Max gas price in gwei
};

// Example scenarios - pick the one that matches your situation:

// Scenario 1: Daily vesting should have started 30 days ago
export const scenario30DaysLate: VestingConfig = {
    ...realDeploymentConfig,
    shouldHaveStartedDate: "2025-06-25",    // 30 days ago
    actualDeployDate: "2025-07-25",         // Today
    // Result: Users get 30 days of compensation immediately
};

// Scenario 2: Daily vesting should have started 60 days ago  
export const scenario60DaysLate: VestingConfig = {
    ...realDeploymentConfig,
    shouldHaveStartedDate: "2025-05-26",    // 60 days ago
    actualDeployDate: "2025-07-25",         // Today
    // Result: Users get 60 days of compensation immediately
};

// Scenario 3: Daily vesting should have started 90 days ago
export const scenario90DaysLate: VestingConfig = {
    ...realDeploymentConfig,
    shouldHaveStartedDate: "2025-04-26",    // 90 days ago
    actualDeployDate: "2025-07-25",         // Today
    // Result: Users get 90 days of compensation immediately
};

// Common configurations for different networks
export const mainnetConfig: VestingConfig = {
    ...realDeploymentConfig,
    maxGasPrice: "15",      // Conservative gas for mainnet
    batchSize: 20           // Smaller batches for mainnet safety
};

export const testnetConfig: VestingConfig = {
    ...realDeploymentConfig,
    maxGasPrice: "50",      // Higher gas acceptable for testnet
    batchSize: 30           // Larger batches OK for testnet
};

// Export the config you want to use
export default realDeploymentConfig; 