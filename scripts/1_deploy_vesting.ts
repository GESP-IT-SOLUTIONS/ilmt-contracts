import { ethers } from "hardhat";

async function main() {
  const ilmtVesting = await ethers.deployContract('ILMTVesting');

  await ilmtVesting.waitForDeployment();

  console.log("iluminary vesting deployed to:", ilmtVesting.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
