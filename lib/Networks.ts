export default interface NetworkConfigInterface {
  chainId: number
  symbol: string
  blockExplorer: {
    name: string
    generateContractUrl: (contractAddress: string) => string
    generateTransactionUrl: (transactionAddress: string) => string
  }
}

/*
 * Local networks
 */
export const hardhatLocal: NetworkConfigInterface = {
  chainId: 31337,
  symbol: "ETH (test)",
  blockExplorer: {
    name: "Block explorer (not available for local chains)",
    generateContractUrl: (contractAddress: string) => `#`,
    generateTransactionUrl: (transactionAddress: string) => `#`,
  },
}

export const bscTestnet: NetworkConfigInterface = {
  chainId: 97,
  symbol: "BNB (test)",
  blockExplorer: {
    name: "BscScan",
    generateContractUrl: (contractAddress: string) =>
      `https://testnet.bscscan.com/address/${contractAddress}`,
    generateTransactionUrl: (transactionAddress: string) =>
      `https://testnet.bscscan.com/tx/${transactionAddress}`,
  },
}

export const bscMainnet: NetworkConfigInterface = {
  chainId: 56,
  symbol: "BNB",
  blockExplorer: {
    name: "BscScan",
    generateContractUrl: (contractAddress: string) =>
      `https://bscscan.com/address/${contractAddress}`,
    generateTransactionUrl: (transactionAddress: string) =>
      `https://bscscan.com/tx/${transactionAddress}`,
  },
}

export const Networks = {
  mainnet: bscMainnet,
  testnet: bscTestnet,
  local: hardhatLocal,
}
