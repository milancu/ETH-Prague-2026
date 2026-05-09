import { useState, useEffect } from "react"
import { parseEther } from "viem"
import {
  useAccount,
  useSimulateContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { TABCOIN_ADDRESS, TABCOIN_ABI } from "@/lib/contracts"

const QUICK_AMOUNTS = ["100", "1000", "10000"] as const

export function useMintTab() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const [rawAmount, setRawAmount] = useState("1000")

  const amountWei = (() => {
    try { return rawAmount ? parseEther(rawAmount) : 0n }
    catch { return 0n }
  })()

  const { data: simData, error: simError } = useSimulateContract({
    address: TABCOIN_ADDRESS,
    abi: TABCOIN_ABI,
    functionName: "mint",
    args: address && amountWei > 0n ? [address, amountWei] : undefined,
    query: { enabled: !!address && amountWei > 0n },
  })

  const { writeContract, data: txHash, isPending: isWriting, reset } = useWriteContract()

  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  })

  useEffect(() => {
    if (!isSuccess) return
    toast.success(`Minted ${rawAmount} TAB`)
    queryClient.invalidateQueries()
    reset()
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  function mint() {
    if (!simData?.request) return
    writeContract(simData.request, {
      onError: (e) => toast.error(e.message.split("\n")[0]),
    })
  }

  return {
    amount: rawAmount,
    setAmount: setRawAmount,
    quickAmounts: QUICK_AMOUNTS,
    canMint: !!simData?.request && !isWriting && !isConfirming,
    isPending: isWriting || isConfirming,
    simError,
    mint,
  }
}