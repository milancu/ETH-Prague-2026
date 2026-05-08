import { useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { maxUint256 } from "viem";
import { toast } from "sonner";
import {
  ERC20_ABI,
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCLOB_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts";
import { useCreateOrder } from "@/features/orders/hooks/use-create-order";
import type { Market } from "@/features/market/types";

export interface PlaceOrderParams {
  market: Market;
  outcomeId: string; // "yes"/"no", "higher"/"lower", or multi outcome index as string
  tabAmountWei: bigint;
  note?: string | null;
}

function outcomeToIndexSet(market: Market, outcomeId: string): bigint {
  if (market.outcomeType === "binary") return outcomeId === "yes" ? 1n : 2n;
  if (market.outcomeType === "scalar") return outcomeId === "higher" ? 1n : 2n;
  return 1n << BigInt(parseInt(outcomeId, 10));
}

function outcomeAmountWei(
  market: Market,
  outcomeId: string,
  tabWei: bigint,
): bigint {
  if (market.outcomeType === "binary") {
    const pct = outcomeId === "yes" ? market.yesPrice : market.noPrice;
    return (tabWei * 100n) / BigInt(pct > 0 ? pct : 50);
  }
  if (market.outcomeType === "multi") {
    const o = market.outcomes.find((o) => o.id === outcomeId);
    const defaultPct = Math.round(100 / market.outcomes.length);
    const pct = o && o.price > 0 ? o.price : defaultPct;
    return (tabWei * 100n) / BigInt(pct);
  }
  return tabWei * 2n; // scalar defaults to 50%
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const TOAST_ID = "place-order";

export function usePlaceOrder() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { mutateAsync: postOrder } = useCreateOrder();
  const [isPending, setIsPending] = useState(false);

  async function placeOrder({
    market,
    outcomeId,
    tabAmountWei,
    note,
  }: PlaceOrderParams) {
    if (!address || !publicClient) throw new Error("Not connected");

    setIsPending(true);
    try {
      const indexSet = outcomeToIndexSet(market, outcomeId);
      const conditionId = market.conditionId as `0x${string}`;

      // 1. Ensure PositionWrapper ERC-20 exists for this outcome
      let wrapperAddress = await publicClient.readContract({
        address: POSITION_WRAPPER_FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "getWrapper",
        args: [TABCOIN_ADDRESS, conditionId, indexSet],
      });

      if (BigInt(wrapperAddress) === 0n) {
        toast.loading("Creating outcome wrapper…", { id: TOAST_ID });
        const txHash = await writeContractAsync({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getOrCreateWrapper",
          args: [TABCOIN_ADDRESS, conditionId, indexSet],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        wrapperAddress = await publicClient.readContract({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getWrapper",
          args: [TABCOIN_ADDRESS, conditionId, indexSet],
        });
      }

      // 2. Approve TABcoin for TabClob if needed
      const allowance = await publicClient.readContract({
        address: TABCOIN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, TABCLOB_ADDRESS],
      });

      if (allowance < tabAmountWei) {
        toast.loading("Approving TAB for TabClob…", { id: TOAST_ID });
        const txHash = await writeContractAsync({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [TABCLOB_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      // 3. Build order values
      const takerAmountWei = outcomeAmountWei(market, outcomeId, tabAmountWei);
      const salt =
        BigInt(Date.now()) * 1_000_000n +
        BigInt(Math.floor(Math.random() * 1_000_000));
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600); // 30 days

      const msg = {
        maker: address,
        taker: ZERO_ADDRESS as `0x${string}`,
        makerToken: TABCOIN_ADDRESS as `0x${string}`,
        takerToken: wrapperAddress as `0x${string}`,
        makerAmount: tabAmountWei,
        takerAmount: takerAmountWei,
        expiry,
        salt,
        marketId: BigInt(market.marketId),
      };

      // 4. EIP-712 sign
      toast.loading("Sign the order…", { id: TOAST_ID });
      const signature = await signTypedDataAsync({
        domain: {
          name: "TabClob",
          version: "1",
          chainId,
          verifyingContract: TABCLOB_ADDRESS,
        },
        types: {
          Order: [
            { name: "maker", type: "address" },
            { name: "taker", type: "address" },
            { name: "makerToken", type: "address" },
            { name: "takerToken", type: "address" },
            { name: "makerAmount", type: "uint128" },
            { name: "takerAmount", type: "uint128" },
            { name: "expiry", type: "uint64" },
            { name: "salt", type: "uint256" },
            { name: "marketId", type: "uint256" },
          ],
        },
        primaryType: "Order",
        message: msg,
      });

      // 5. POST to BE
      toast.loading("Posting order…", { id: TOAST_ID });
      await postOrder({
        maker: address,
        taker: ZERO_ADDRESS,
        makerToken: TABCOIN_ADDRESS,
        takerToken: wrapperAddress as string,
        makerAmount: tabAmountWei.toString(),
        takerAmount: takerAmountWei.toString(),
        expiry: Number(expiry),
        salt: salt.toString(),
        chainId,
        verifyingContract: TABCLOB_ADDRESS,
        signature,
        marketId: market.marketId,
        note: note ?? null,
      });

      toast.success("Order placed", { id: TOAST_ID });
    } catch (err: unknown) {
      const rejected =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rejected") ||
          err.message.toLowerCase().includes("denied"));
      if (rejected) toast.dismiss(TOAST_ID);
      else toast.error("Failed to place order", { id: TOAST_ID });
      throw err;
    } finally {
      setIsPending(false);
    }
  }

  return { placeOrder, isPending };
}
