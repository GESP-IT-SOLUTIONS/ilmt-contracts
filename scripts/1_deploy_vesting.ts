import { ethers } from "hardhat";

async function main() {
  const IluminaryVesting = await ethers.getContractFactory("ILMTVesting");

  const contractDeployed = await IluminaryVesting.deploy();

  await contractDeployed.deployed();

  console.log("iluminary vesting deployed to:", contractDeployed.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
