import { ethers } from "hardhat"

async function main() {
  const ilmtNFT = await ethers.deployContract("IlmtNFT", [""])

  await ilmtNFT.waitForDeployment()

  console.log("IlmtNFT deployed to:", ilmtNFT.target)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
