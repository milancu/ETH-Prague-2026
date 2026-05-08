import { ethers, network } from "hardhat"

const TAB_ADDRESS = "0x1157c1D6027A5f4Cd62682A7F0d1da426A4b65E3"
const AUTHORIZER = "0x48c5632dCC220Abf56000F93B1C4DEB501c64588"
const RECIPIENT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" // hardhat[0]

async function main() {
  const tab = await ethers.getContractAt("TABcoin", TAB_ADDRESS)

  // Fund AUTHORIZER so it can pay gas, then impersonate it
  await network.provider.send("hardhat_setBalance", [AUTHORIZER, "0x56BC75E2D63100000"]) // 100 ETH
  await network.provider.send("hardhat_impersonateAccount", [AUTHORIZER])

  const authSigner = await ethers.getSigner(AUTHORIZER)
  await (tab.connect(authSigner) as typeof tab).authorizeClaim(RECIPIENT, { gasLimit: 100_000 })
  console.log("✓ Claim authorized")

  await network.provider.send("hardhat_stopImpersonatingAccount", [AUTHORIZER])

  // Now claim as the recipient
  const [deployer] = await ethers.getSigners()
  await (tab.connect(deployer) as typeof tab).claim({ gasLimit: 100_000 })

  const balance = await tab.balanceOf(RECIPIENT)
  console.log(`✓ TAB claimed. Balance: ${ethers.formatEther(balance)} TAB`)
}

main().catch(console.error)