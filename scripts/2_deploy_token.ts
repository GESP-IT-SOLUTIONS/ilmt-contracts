import { ethers } from "hardhat";

async function main() {
  const ilmtToken = await ethers.getContractFactory("IluminaryToken");

  const contractDeployed = await ilmtToken.deploy(
    "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  );

  await contractDeployed.deployed();

  console.log("Iluminary Token deployed to:", contractDeployed.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
