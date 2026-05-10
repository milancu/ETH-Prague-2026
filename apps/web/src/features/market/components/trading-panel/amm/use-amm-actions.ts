import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { maxUint256 } from "viem"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  ERC20_ABI,
  PREDICTION_AMM_ABI,
  PREDICTION_AMM_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"

const TOAST = {
  createPool: "amm-create-pool",
  addFunding: "amm-add-funding",
  removeFunding: "amm-remove-funding",
  buy: "amm-buy",
  sell: "amm-sell",
} as const

function describeError(err: unknown): { rejected: boolean; message: string } {
  if (err instanceof Error) {
    const lower = err.message.toLowerCase()
    if (lower.includes("rejected") || lower.includes("denied") || lower.includes("user denied")) {
      return { rejected: true, message: "Transaction rejected" }
    }
    return { rejected: false, message: err.message }
  }
  return { rejected: false, message: "Unknown error" }
}

/**
 * All write actions against PredictionAMM. Each enforces the relevant
 * approval first (`maxUint256`, matching the rest of the codebase), then
 * submits the action and waits for the receipt. Toasts at every step.
 */
export function useAmmActions(marketId: number | null | undefined) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<keyof typeof TOAST | null>(null)

  function invalidate() {
    if (marketId != null) {
      queryClient.invalidateQueries({ queryKey: ["amm", marketId], exact: false })
    }
    queryClient.invalidateQueries({ queryKey: ["positions"], exact: false })
    queryClient.invalidateQueries({ queryKey: ["readContracts"], exact: false })
    queryClient.invalidateQueries({ queryKey: ["readContract"], exact: false })
  }

  async function ensureTabApproval(amount: bigint, toastId: string): Promise<void> {
    if (!address || !publicClient) throw new Error("Not connected")
    const allowance = (await publicClient.readContract({
      address: TABCOIN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, PREDICTION_AMM_ADDRESS],
    })) as bigint
    if (allowance >= amount) return
    toast.loading("Approving TAB…", { id: toastId })
    const tx = await writeContractAsync({
      address: TABCOIN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PREDICTION_AMM_ADDRESS, maxUint256],
      gas: 100_000n,
    })
    await publicClient.waitForTransactionReceipt({ hash: tx })
  }

  async function ensureWrapperApproval(
    wrapper: `0x${string}`,
    amount: bigint,
    toastId: string,
  ): Promise<void> {
    if (!address || !publicClient) throw new Error("Not connected")
    const allowance = (await publicClient.readContract({
      address: wrapper,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, PREDICTION_AMM_ADDRESS],
    })) as bigint
    if (allowance >= amount) return
    toast.loading("Approving outcome tokens…", { id: toastId })
    const tx = await writeContractAsync({
      address: wrapper,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PREDICTION_AMM_ADDRESS, maxUint256],
      gas: 100_000n,
    })
    await publicClient.waitForTransactionReceipt({ hash: tx })
  }

  async function createPool(funding: bigint, feeBps: number) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (marketId == null) throw new Error("No marketId")
    const id = TOAST.createPool
    setPendingAction("createPool")
    try {
      await ensureTabApproval(funding, id)
      toast.loading("Creating pool…", { id })
      const tx = await writeContractAsync({
        address: PREDICTION_AMM_ADDRESS,
        abi: PREDICTION_AMM_ABI,
        functionName: "createPool",
        args: [BigInt(marketId), funding, feeBps],
        gas: 1_500_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      invalidate()
      toast.success("Pool created!", { id })
    } catch (err) {
      const { rejected, message } = describeError(err)
      if (rejected) toast.dismiss(id)
      else toast.error(`Failed to create pool: ${message.slice(0, 80)}`, { id })
      throw err
    } finally {
      setPendingAction(null)
    }
  }

  async function addFunding(amount: bigint) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (marketId == null) throw new Error("No marketId")
    const id = TOAST.addFunding
    setPendingAction("addFunding")
    try {
      await ensureTabApproval(amount, id)
      toast.loading("Adding liquidity…", { id })
      const tx = await writeContractAsync({
        address: PREDICTION_AMM_ADDRESS,
        abi: PREDICTION_AMM_ABI,
        functionName: "addFunding",
        args: [BigInt(marketId), amount, 0n],
        gas: 1_200_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      invalidate()
      toast.success("Liquidity added!", { id })
    } catch (err) {
      const { rejected, message } = describeError(err)
      if (rejected) toast.dismiss(id)
      else toast.error(`Failed to add liquidity: ${message.slice(0, 80)}`, { id })
      throw err
    } finally {
      setPendingAction(null)
    }
  }

  async function removeFunding(sharesIn: bigint, outcomeSlotCount: number) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (marketId == null) throw new Error("No marketId")
    const id = TOAST.removeFunding
    setPendingAction("removeFunding")
    try {
      const minOut = Array.from({ length: outcomeSlotCount }, () => 0n)
      toast.loading("Removing liquidity…", { id })
      const tx = await writeContractAsync({
        address: PREDICTION_AMM_ADDRESS,
        abi: PREDICTION_AMM_ABI,
        functionName: "removeFunding",
        args: [BigInt(marketId), sharesIn, minOut, 0n],
        gas: 1_000_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      invalidate()
      toast.success("Liquidity removed!", { id })
    } catch (err) {
      const { rejected, message } = describeError(err)
      if (rejected) toast.dismiss(id)
      else toast.error(`Failed to remove liquidity: ${message.slice(0, 80)}`, { id })
      throw err
    } finally {
      setPendingAction(null)
    }
  }

  async function buy(outcomeIndex: number, investmentAmount: bigint, minOutcomeOut: bigint) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (marketId == null) throw new Error("No marketId")
    const id = TOAST.buy
    setPendingAction("buy")
    try {
      await ensureTabApproval(investmentAmount, id)
      toast.loading("Buying…", { id })
      const tx = await writeContractAsync({
        address: PREDICTION_AMM_ADDRESS,
        abi: PREDICTION_AMM_ABI,
        functionName: "buy",
        args: [BigInt(marketId), outcomeIndex, investmentAmount, minOutcomeOut],
        gas: 1_200_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      invalidate()
      toast.success("Bought!", { id })
    } catch (err) {
      const { rejected, message } = describeError(err)
      if (rejected) toast.dismiss(id)
      else toast.error(`Buy failed: ${message.slice(0, 80)}`, { id })
      throw err
    } finally {
      setPendingAction(null)
    }
  }

  async function sell(
    outcomeIndex: number,
    returnAmount: bigint,
    maxOutcomeIn: bigint,
    wrapper: `0x${string}`,
  ) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (marketId == null) throw new Error("No marketId")
    const id = TOAST.sell
    setPendingAction("sell")
    try {
      await ensureWrapperApproval(wrapper, maxOutcomeIn, id)
      toast.loading("Selling…", { id })
      const tx = await writeContractAsync({
        address: PREDICTION_AMM_ADDRESS,
        abi: PREDICTION_AMM_ABI,
        functionName: "sell",
        args: [BigInt(marketId), outcomeIndex, returnAmount, maxOutcomeIn],
        gas: 1_200_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      invalidate()
      toast.success("Sold!", { id })
    } catch (err) {
      const { rejected, message } = describeError(err)
      if (rejected) toast.dismiss(id)
      else toast.error(`Sell failed: ${message.slice(0, 80)}`, { id })
      throw err
    } finally {
      setPendingAction(null)
    }
  }

  return {
    createPool,
    addFunding,
    removeFunding,
    buy,
    sell,
    pendingAction,
    isPending: pendingAction !== null,
  }
}
