import { VestingConfig } from './deploy-retroactive-vesting';

// Example configuration for retroactive vesting deployment
// Copy this file to 'deployment-config.ts' and update with your values

export const deploymentConfig: VestingConfig = {
    // Timeline Configuration
    shouldHaveStartedDate: "2024-01-05",    // When daily vesting should have started
    actualDeployDate: "2024-01-25",         // When you're actually deploying (today)
    immediateReleaseHours: 1,               // Hours to wait for 10% immediate release
    
    // File and Contract Configuration
    csvFilePath: "./scripts/investors.csv",  // Path to investors CSV file
    tokenAddress: "0x...",                  // ILMT token contract address
    contractAddress: undefined,             // Vesting contract address (optional - will deploy new if not provided)
    
    // Gas Optimization
    batchSize: 25,                         // Investors per batch (25 investors = 50 schedules per tx)
    gasLimit: 800000,                      // Optional gas limit override
    maxGasPrice: "20"                      // Maximum gas price in gwei
};

// Environment-specific configurations
export const configs = {
    // Testnet configuration
    testnet: {
        ...deploymentConfig,
        tokenAddress: "0x...", // Testnet token address
        maxGasPrice: "50"       // Higher gas for testnet
    },
    
    // Mainnet configuration  
    mainnet: {
        ...deploymentConfig,
        tokenAddress: "0x...",  // Mainnet token address
        maxGasPrice: "15",      // Conservative gas for mainnet
        batchSize: 20           // Smaller batches for mainnet safety
    }
};

// Export default config
export default deploymentConfig; 