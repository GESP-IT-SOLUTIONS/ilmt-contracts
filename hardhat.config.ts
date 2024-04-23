import { HardhatUserConfig } from "hardhat/config"
import { bscTestnet } from "./lib/Networks"

require("@nomiclabs/hardhat-ethers")
require("dotenv").config()

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    hardhat: {
      chainId: 1337,
    },
    tbsc: {
      url: "https://bsc-testnet.publicnode.com",
      accounts: [process.env.PRIVATE_KEY],
      chainId: bscTestnet.chainId,
    },
    bnb: {
      url: "https://bsc-dataseed1.binance.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 56,
    },
  },
}

export default config
// 0xC3c7873d1eb8F93d229C06c13189aD8AF2F912A2
// 0x5fbdb2315678afecb367f032d93f642f64180aa3
