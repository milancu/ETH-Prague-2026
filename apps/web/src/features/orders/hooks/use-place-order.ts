import { useState } from "react"
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi"
import { maxUint256, formatEther } from "viem"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  CONDITIONAL_TOKENS_ABI,
  CONDITIONAL_TOKENS_ADDRESS,
  ERC20_ABI,
  FACTORY_ABI,
  POSITION_WRAPPER_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCLOB_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import { getPositionId } from "@/features/positions/lib/utils"
import { useCreateOrder } from "@/features/orders/hooks/use-create-order"
import type { Market } from "@/features/market/types"

export interface PlaceOrderParams {
  market: Market
  outcomeId: string
  side: "buy" | "sell"
  quantityWei: bigint    // outcome tokens (18 decimals)
  priceWei: bigint       // TAB per outcome token (18 decimals, e.g. 0.6 TAB = 6e17)
  note?: string | null
}

// ── Index-set helpers ─────────────────────────────────────────────────────────

function outcomeToIndexSet(market: Market, outcomeId: string): bigint {
  if (market.outcomeType === "binary") return outcomeId === "yes" ? 1n : 2n
  if (market.outcomeType === "scalar") return outcomeId === "higher" ? 1n : 2n
  return 1n << BigInt(parseInt(outcomeId, 10))
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const
const TOAST_ID = "place-order"

export function usePlaceOrder() {
  const { address } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()
  const { mutateAsync: postOrder } = useCreateOrder()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  async function placeOrder({ market, outcomeId, side, quantityWei, priceWei, note }: PlaceOrderParams) {
    if (!address || !publicClient) throw new Error("Not connected")
    setIsPending(true)
    try {
      const indexSet = outcomeToIndexSet(market, outcomeId)
      const conditionId = market.conditionId as `0x${string}`

      // TAB total = quantity * price / 1e18
      const tabTotalWei = (quantityWei * priceWei) / (10n ** 18n)

      // ── 1. Get / create outcome wrapper ──────────────────────────────────
      let wrapperAddress = await publicClient.readContract({
        address: POSITION_WRAPPER_FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "getWrapper",
        args: [TABCOIN_ADDRESS, conditionId, indexSet],
      })
      if (BigInt(wrapperAddress) === 0n) {
        toast.loading("Creating outcome wrapper…", { id: TOAST_ID })
        const txHash = await writeContractAsync({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getOrCreateWrapper",
          args: [TABCOIN_ADDRESS, conditionId, indexSet],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        wrapperAddress = await publicClient.readContract({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getWrapper",
          args: [TABCOIN_ADDRESS, conditionId, indexSet],
        })
      }

      let makerToken: `0x${string}`
      let takerToken: `0x${string}`
      let makerAmountWei: bigint
      let takerAmountWei: bigint

      if (side === "buy") {
        // ── BUY: maker offers TABcoin, taker delivers outcome wrapper ────────
        makerToken = TABCOIN_ADDRESS
        takerToken = wrapperAddress as `0x${string}`
        makerAmountWei = tabTotalWei
        takerAmountWei = quantityWei

        // Check TAB balance is sufficient to back the order
        const tabBalance = await publicClient.readContract({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })
        if (tabBalance < makerAmountWei) {
          throw new Error(
            `Insufficient TAB balance. Need ${formatEther(makerAmountWei)} TAB, have ${formatEther(tabBalance)} TAB.`,
          )
        }

        const allowance = await publicClient.readContract({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, TABCLOB_ADDRESS],
        })
        if (allowance < makerAmountWei) {
          toast.loading("Approving TAB for CLOB…", { id: TOAST_ID })
          const txHash = await writeContractAsync({
            address: TABCOIN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [TABCLOB_ADDRESS, maxUint256],
          })
          await publicClient.waitForTransactionReceipt({ hash: txHash })
        }
      } else {
        // ── SELL: maker offers outcome wrapper, taker delivers TABcoin ───────
        makerToken = wrapperAddress as `0x${string}`
        takerToken = TABCOIN_ADDRESS
        makerAmountWei = quantityWei
        takerAmountWei = tabTotalWei

        // Check ERC-20 wrapper balance; auto-wrap ERC-1155 if short
        const erc20Balance = await publicClient.readContract({
          address: wrapperAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })
        if (erc20Balance < quantityWei) {
          const needToWrap = quantityWei - erc20Balance
          const positionId = getPositionId(conditionId, indexSet)
          const erc1155Balance = await publicClient.readContract({
            address: CONDITIONAL_TOKENS_ADDRESS,
            abi: CONDITIONAL_TOKENS_ABI,
            functionName: "balanceOf",
            args: [address, positionId],
          })
          if (erc1155Balance < needToWrap) {
            throw new Error("Insufficient position balance to sell")
          }

          const isApproved = await publicClient.readContract({
            address: CONDITIONAL_TOKENS_ADDRESS,
            abi: CONDITIONAL_TOKENS_ABI,
            functionName: "isApprovedForAll",
            args: [address, wrapperAddress as `0x${string}`],
          })
          if (!isApproved) {
            toast.loading("Approving positions for wrapper…", { id: TOAST_ID })
            const txHash = await writeContractAsync({
              address: CONDITIONAL_TOKENS_ADDRESS,
              abi: CONDITIONAL_TOKENS_ABI,
              functionName: "setApprovalForAll",
              args: [wrapperAddress as `0x${string}`, true],
            })
            await publicClient.waitForTransactionReceipt({ hash: txHash })
          }

          toast.loading("Wrapping position tokens…", { id: TOAST_ID })
          const txHash = await writeContractAsync({
            address: wrapperAddress as `0x${string}`,
            abi: POSITION_WRAPPER_ABI,
            functionName: "wrap",
            args: [needToWrap],
          })
          await publicClient.waitForTransactionReceipt({ hash: txHash })
        }

        // Approve wrapper ERC-20 for CLOB
        const wrapperAllowance = await publicClient.readContract({
          address: wrapperAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, TABCLOB_ADDRESS],
        })
        if (wrapperAllowance < quantityWei) {
          toast.loading("Approving outcome tokens for CLOB…", { id: TOAST_ID })
          const txHash = await writeContractAsync({
            address: wrapperAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [TABCLOB_ADDRESS, maxUint256],
          })
          await publicClient.waitForTransactionReceipt({ hash: txHash })
        }
      }

      // ── 2. Build & sign EIP-712 order ─────────────────────────────────────
      const salt =
        BigInt(Date.now()) * 1_000_000n +
        BigInt(Math.floor(Math.random() * 1_000_000))
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600)

      const msg = {
        maker:       address,
        taker:       ZERO_ADDRESS as `0x${string}`,
        makerToken,
        takerToken,
        makerAmount: makerAmountWei,
        takerAmount: takerAmountWei,
        expiry,
        salt,
        marketId:    BigInt(market.marketId),
      }

      toast.loading("Sign the order…", { id: TOAST_ID })
      const signature = await signTypedDataAsync({
        domain: { name: "TabClob", version: "1", chainId, verifyingContract: TABCLOB_ADDRESS },
        types: {
          Order: [
            { name: "maker",       type: "address" },
            { name: "taker",       type: "address" },
            { name: "makerToken",  type: "address" },
            { name: "takerToken",  type: "address" },
            { name: "makerAmount", type: "uint128" },
            { name: "takerAmount", type: "uint128" },
            { name: "expiry",      type: "uint64"  },
            { name: "salt",        type: "uint256" },
            { name: "marketId",    type: "uint256" },
          ],
        },
        primaryType: "Order",
        message: msg,
      })

      // ── 3. POST to BE ─────────────────────────────────────────────────────
      toast.loading("Posting order…", { id: TOAST_ID })
      await postOrder({
        maker:              address,
        taker:              ZERO_ADDRESS,
        makerToken,
        takerToken,
        makerAmount:        makerAmountWei.toString(),
        takerAmount:        takerAmountWei.toString(),
        expiry:             Number(expiry),
        salt:               salt.toString(),
        chainId,
        verifyingContract:  TABCLOB_ADDRESS,
        signature,
        marketId:           market.marketId,
        note:               note ?? null,
      })

      queryClient.invalidateQueries()
      toast.success(
        side === "buy"
          ? "Limit buy order posted — fills when a seller matches"
          : "Limit sell order posted — tokens transfer when a buyer matches",
        { id: TOAST_ID },
      )
    } catch (err: unknown) {
      const rejected =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rejected") ||
          err.message.toLowerCase().includes("denied"))
      if (rejected) toast.dismiss(TOAST_ID)
      else toast.error("Failed to place order", { id: TOAST_ID })
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { placeOrder, isPending }
}