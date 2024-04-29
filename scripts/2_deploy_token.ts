import { ethers } from "hardhat";

async function main() {
  const ilmtToken = await ethers.deployContract("IluminaryToken", [
    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  ]);

  await ilmtToken.waitForDeployment();

  console.log("Iluminary Token deployed to:", ilmtToken.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
