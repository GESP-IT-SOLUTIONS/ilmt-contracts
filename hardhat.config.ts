import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import dotenv from "dotenv"

dotenv.config()

// Only add networks if private key exists and is valid
const networks: any = {
  hardhat: {
    chainId: 1337,
  }
}

if (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.length >= 64) {
  networks.tbsc = {
    url: "https://data-seed-prebsc-1-s3.bnbchain.org:8545",
    accounts: [process.env.PRIVATE_KEY],
    chainId: 97,
  }
  networks.bnb = {
    url: "https://bsc-dataseed1.binance.org",
    accounts: [process.env.PRIVATE_KEY],
    chainId: 56,
  }
  networks.sepolia = {
    url: "https://sepolia.drpc.org",
    accounts: [process.env.PRIVATE_KEY],
    chainId: 11155111
  }
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      { version: "0.8.18" },
      { version: "0.8.19" },
      { version: "0.8.20" }
    ]
  },
  networks,
  etherscan: {
    apiKey: {
      sepolia: process.env.ETH_API_KEY ?? '',
      bnb: process.env.BSC_API_KEY ?? '',
      tbsc: process.env.BSC_API_KEY ?? '',
    }
  }
}

export default config
