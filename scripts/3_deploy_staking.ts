import { ethers } from "hardhat"

async function main() {
    const ilmtToken = await ethers.deployContract('IlmtStaking', ['0xAf060d531ad131092ba68a93D9954Af6E0C184f0']);

    await ilmtToken.waitForDeployment()

    console.log("IlmtStaking deployed to:", ilmtToken.target)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
