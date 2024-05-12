import { ethers } from "hardhat"

async function main() {
    const ilmtNFTStaking = await ethers.deployContract('IlmtNFTStaking', ['', '']);

    await ilmtNFTStaking.waitForDeployment()

    console.log("IlmtNFTStaking deployed to:", ilmtNFTStaking.target)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
