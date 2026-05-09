import { useBalance, useReadContract } from "wagmi"
import { TABCOIN_ADDRESS, ERC20_ABI } from "@/lib/contracts"

export function useWalletBalances(address?: `0x${string}`) {
  const { data: ethData, isLoading: ethLoading } = useBalance({
    address,
    query: { enabled: !!address },
  })

  const { data: tabRaw, isLoading: tabLoading } = useReadContract({
    address: TABCOIN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  return {
    eth: ethData?.value ?? 0n,
    tab: (tabRaw ?? 0n) as bigint,
    isLoading: ethLoading || tabLoading,
  }
}