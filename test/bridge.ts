import { ethers } from "hardhat"

describe("TEST", () => {
  it("test", async () => {
    const [owner, otherAccount] = await ethers.getSigners()
    console.log(owner.address)
    const token = await ethers.deployContract("ITTT", [owner.address])
    console.log(token.target)
    await token.waitForDeployment()
    const bridge = await ethers.deployContract("MultichainTokenTransfers", [
      "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93",
      "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
      token.target,
    ])
    await bridge.waitForDeployment()
    console.log(bridge.target)

    await bridge.allowlistDestinationChain("13264668187771770619", true)
    await token.setMinter(bridge.target, true)
    await token.setBurner(bridge.target, true)

    await owner.sendTransaction({
      to: bridge.target,
      value: ethers.parseEther("1"),
    })

    await bridge.sendMessagePayNative(
      "13264668187771770619",
      "0x59DEfC26193ef5E5B3199B713637597cF70cB203",
      owner.address,
      token.target,
      ethers.parseEther("1")
    )
  })
})
