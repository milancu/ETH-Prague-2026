import { useWriteContract, useAccount, useSwitchChain } from "wagmi"
import { readContract, waitForTransactionReceipt } from "wagmi/actions"
import { parseEventLogs, maxUint256 } from "viem"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { config } from "@/config"
import {
  PREDICTION_MARKET_ADDRESS,
  PREDICTION_MARKET_ABI,
  TABCOIN_ADDRESS,
  ERC20_ABI,
  DEFAULT_BOND,
  OUTCOME_TYPE,
} from "@/lib/contracts"
import type { CreateMarketInput } from "@/features/market/lib/schema"
import { postMarket } from "@/features/market/api/markets"

const TARGET_CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "84532")

function toISOString(dateStr: string, hour = 23, min = 59, sec = 59): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour, min, sec)).toISOString()
}

function toTimestamp(isoStr: string): bigint {
  return BigInt(Math.floor(new Date(isoStr).getTime() / 1000))
}

function outcomeSlotCount(data: CreateMarketInput): bigint {
  return data.outcomeType === "multi" ? BigInt(data.outcomes.length) : 2n
}

function buildOutcomeLabels(data: CreateMarketInput): string[] {
  if (data.outcomeType === "binary") return ["Yes", "No"]
  if (data.outcomeType === "scalar") return ["Higher", "Lower"]
  return data.outcomes.map((o) => o.label)
}

function buildOutcomes(data: CreateMarketInput): Array<{ label: string }> {
  return buildOutcomeLabels(data).map((label) => ({ label }))
}

export function useCreateMarket() {
  const { address, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()

  const createMarket = async (data: CreateMarketInput) => {
    if (!address) throw new Error("Wallet not connected")

    if (chainId !== TARGET_CHAIN_ID) {
      toast.loading("Switching network…", { id: "market-create" })
      await switchChainAsync({ chainId: TARGET_CHAIN_ID })
    }

    const expiresAt = toISOString(data.closingDate)
    const expiresAtTs = toTimestamp(expiresAt)
    const resolutionTs = expiresAtTs + 86400n

    // Check TAB balance
    const balance = await readContract(config, {
      address: TABCOIN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    })
    if (balance < DEFAULT_BOND) {
      throw new Error(
        `Insufficient TAB balance. You have ${balance / 10n ** 18n} TAB, need 50 TAB to post the bond.`,
      )
    }

    // Approve TAB if allowance is insufficient
    const allowance = await readContract(config, {
      address: TABCOIN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, PREDICTION_MARKET_ADDRESS],
    })

    const needsApproval = allowance < DEFAULT_BOND
    if (needsApproval) {
      toast.loading("Step 1/2: Approving TAB…", { id: "market-create" })
      const approveTxHash = await writeContractAsync({
        address: TABCOIN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PREDICTION_MARKET_ADDRESS, maxUint256],
        gas: 100_000n,
      })
      await waitForTransactionReceipt(config, { hash: approveTxHash })
    }

    toast.loading(needsApproval ? "Step 2/2: Creating market…" : "Creating market…", {
      id: "market-create",
    })
    const txHash = await writeContractAsync({
      address: PREDICTION_MARKET_ADDRESS,
      abi: PREDICTION_MARKET_ABI,
      functionName: "createMarket",
      args: [{
        name:             data.title,
        description:      data.description ?? "",
        category:         data.category,
        outcomeType:      OUTCOME_TYPE[data.outcomeType],
        outcomeSlotCount: outcomeSlotCount(data),
        outcomeLabels:    buildOutcomeLabels(data),
        oracle:           address,
        expiresAt:        expiresAtTs,
        resolutionTime:   resolutionTs,
      }],
      gas: 1_000_000n,
    })
    const receipt = await waitForTransactionReceipt(config, { hash: txHash })

    const [event] = parseEventLogs({
      abi: PREDICTION_MARKET_ABI,
      logs: receipt.logs,
      eventName: "MarketCreated",
    })

    toast.success("Market created!", { id: "market-create" })

    // Sync to BE — best-effort, market is already confirmed on-chain
    try {
      await postMarket({
        market_id: Number(event.args.marketId),
        condition_id: event.args.conditionId,
        tx_hash: txHash,
        chain_id: TARGET_CHAIN_ID,
        creator: address,
        title: data.title,
        description: data.description ?? null,
        rules: data.rules ?? null,
        category: data.category,
        outcome_type: data.outcomeType,
        outcomes: buildOutcomes(data),
        scalar_min: data.outcomeType === "scalar" ? (data.scalarMin ?? null) : null,
        scalar_max: data.outcomeType === "scalar" ? (data.scalarMax ?? null) : null,
        scalar_unit: data.outcomeType === "scalar" ? (data.scalarUnit ?? null) : null,
        current_value: data.outcomeType === "scalar" ? (data.currentValue ?? null) : null,
        expires_at: expiresAt,
        resolution_time: new Date(Number(resolutionTs) * 1000).toISOString(),
      })
      queryClient.invalidateQueries({ queryKey: ["markets"] })
    } catch {
      // BE sync failed (e.g. stale DB after redeployment) — market is on-chain.
      // Refresh anyway so any existing record with this market_id shows up.
      queryClient.invalidateQueries({ queryKey: ["markets"] })
    }
  }

  return { createMarket }
}