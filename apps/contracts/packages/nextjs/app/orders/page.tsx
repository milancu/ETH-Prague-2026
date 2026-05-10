"use client";

import { useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { readContract, writeContract as wagmiWriteContract } from "@wagmi/core";
import type { NextPage } from "next";
import { Address as AddressType, formatEther, maxUint256, parseEther, zeroAddress } from "viem";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id as keyof typeof deployedContracts;

const TAB_ADDR = deployedContracts[CHAIN_ID].TABcoin.address as AddressType;
const TABCLOB_ADDR = deployedContracts[CHAIN_ID].TabClob.address as AddressType;

const ORDER_TYPES = {
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
} as const;

const ORDER_TUPLE_COMPONENTS = [
  { name: "maker", type: "address" },
  { name: "taker", type: "address" },
  { name: "makerToken", type: "address" },
  { name: "takerToken", type: "address" },
  { name: "makerAmount", type: "uint128" },
  { name: "takerAmount", type: "uint128" },
  { name: "expiry", type: "uint64" },
  { name: "salt", type: "uint256" },
  { name: "marketId", type: "uint256" },
] as const;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TABCLOB_FILL_ABI = [
  {
    name: "fill",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "o", type: "tuple", components: ORDER_TUPLE_COMPONENTS },
      { name: "fillMakerAmount", type: "uint128" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "o", type: "tuple", components: ORDER_TUPLE_COMPONENTS }],
    outputs: [],
  },
] as const;

const ensureErc20Approval = async (token: AddressType, owner: AddressType, spender: AddressType, needed: bigint) => {
  const current = (await readContract(wagmiConfig, {
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
    chainId: 31337,
  })) as bigint;
  if (current >= needed) return;
  await wagmiWriteContract(wagmiConfig, {
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, maxUint256],
    chainId: 31337,
    // Explicit cap — Base L2 fork has a 16.7M tx gas cap; viem's auto-estimate can exceed it.
    gas: 200_000n,
  });
};

type WrapperEvent = {
  args: {
    collateral: AddressType;
    conditionId: `0x${string}`;
    indexSet: bigint;
    positionId: bigint;
    wrapper: AddressType;
  };
};

type CsvOrder = Record<string, string>;

const OrdersPage: NextPage = () => {
  const { address: connected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();

  const { data: wrapperEvents } = useScaffoldEventHistory({
    contractName: "PositionWrapperFactory",
    eventName: "WrapperCreated",
    watch: true,
  });

  const wrappers = useMemo(() => {
    const list = ((wrapperEvents ?? []) as unknown as WrapperEvent[]).map(e => e.args).filter(Boolean);
    const seen = new Set<string>();
    return list.filter(w => {
      if (seen.has(w.wrapper)) return false;
      seen.add(w.wrapper);
      return true;
    });
  }, [wrapperEvents]);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">TabClob — Limit Orders</h1>
      <p className="text-sm opacity-70 mb-1">
        Náš vlastní EIP-712 ERC-20 limit order book. Maker podepíše order off-chain, taker ho fillne on-chain.
      </p>
      <p className="text-xs opacity-60 mb-6">
        Kontrakt: <Address address={TABCLOB_ADDR} /> · domain{" "}
        {`{ name: "TabClob", version: "1", chainId, verifyingContract }`} · OZ EIP712 (chainId-aware) + SignatureChecker
        (EOA + EIP-1271).
      </p>

      <SignOrderForm connected={connected} chainId={chainId} walletClient={walletClient} wrappers={wrappers} />

      <h2 className="text-2xl font-bold mt-10 mb-4">Uložené orders (CSV)</h2>
      <OrdersTable connected={connected} />
    </div>
  );
};

export default OrdersPage;

const SignOrderForm = ({
  connected,
  chainId,
  walletClient,
  wrappers,
}: {
  connected?: AddressType;
  chainId: number;
  walletClient: ReturnType<typeof useWalletClient>["data"];
  wrappers: WrapperEvent["args"][];
}) => {
  const [makerTokenAddr, setMakerTokenAddr] = useState<AddressType | "">("");
  const [makerAmount, setMakerAmount] = useState("");
  const [takerAmount, setTakerAmount] = useState("");
  const [marketId, setMarketId] = useState("");
  const [taker, setTaker] = useState<AddressType>(zeroAddress);
  const [expiryHours, setExpiryHours] = useState(24);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const onApproveMaker = async () => {
    if (!connected || !makerTokenAddr) return notification.error("Připoj wallet a vyber wPos token");
    setBusy(true);
    try {
      await ensureErc20Approval(makerTokenAddr, connected, TABCLOB_ADDR, maxUint256);
      notification.success("Maker token schválen pro TabClob");
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  const onSign = async () => {
    if (!walletClient || !connected) return notification.error("Připoj wallet");
    if (!makerTokenAddr) return notification.error("Zvol wrapped pozici");
    if (!makerAmount || !takerAmount) return notification.error("Zadej amounty");
    if (!marketId.trim()) return notification.error("Zadej marketId (TabClob ho ověří proti wrapperům)");

    const signingAccount = (walletClient as unknown as { account?: { address: AddressType } }).account?.address;
    if (!signingAccount) return notification.error("Wallet account není dostupný");

    setBusy(true);
    try {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + expiryHours * 3600);
      const salt = BigInt(
        "0x" + crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), ""),
      );
      const takerNorm: AddressType = taker && /^0x[0-9a-fA-F]{40}$/.test(taker) ? taker : zeroAddress;
      const order = {
        maker: signingAccount,
        taker: takerNorm,
        makerToken: makerTokenAddr,
        takerToken: TAB_ADDR,
        makerAmount: parseEther(makerAmount),
        takerAmount: parseEther(takerAmount),
        expiry,
        salt,
        marketId: BigInt(marketId),
      };
      const domain = {
        name: "TabClob",
        version: "1",
        chainId,
        verifyingContract: TABCLOB_ADDR,
      };

      type SigningClient = {
        signTypedData: (a: {
          account?: AddressType;
          domain: typeof domain;
          types: typeof ORDER_TYPES;
          primaryType: "Order";
          message: typeof order;
        }) => Promise<`0x${string}`>;
      };
      const signature = await (walletClient as unknown as SigningClient).signTypedData({
        account: signingAccount,
        domain,
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });

      const payload = {
        maker: order.maker,
        taker: order.taker,
        makerToken: order.makerToken,
        takerToken: order.takerToken,
        makerAmount: order.makerAmount.toString(),
        takerAmount: order.takerAmount.toString(),
        expiry: order.expiry.toString(),
        salt: order.salt.toString(),
        marketId: order.marketId.toString(),
        chainId: String(chainId),
        verifyingContract: TABCLOB_ADDR,
        signature,
        note,
      };
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      notification.success("Order signed & saved");
      setMakerAmount("");
      setTakerAmount("");
      setMarketId("");
      setNote("");
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Podepsat nový order</h2>
        <div className="text-xs opacity-60 mb-2">
          Maker: {connected ? <Address address={connected} /> : "—"} · chainId: {chainId}
        </div>

        <label className="label">Wrapped position to sell</label>
        <select
          className="select select-bordered"
          value={makerTokenAddr}
          onChange={e => setMakerTokenAddr(e.target.value as AddressType)}
        >
          <option value="">— vyber —</option>
          {wrappers.length === 0 && <option disabled>Žádný wrapper zatím — vytvoř ho na záložce Markets</option>}
          {wrappers.map(w => (
            <option key={w.wrapper} value={w.wrapper}>
              {`${w.wrapper.slice(0, 10)}… · cond ${w.conditionId.slice(0, 10)}… · indexSet ${w.indexSet.toString()}`}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          <div>
            <label className="label">Maker amount (wPos)</label>
            <input
              className="input input-bordered w-full"
              value={makerAmount}
              onChange={e => setMakerAmount(e.target.value)}
              placeholder="10"
            />
          </div>
          <div>
            <label className="label">Taker amount (TAB)</label>
            <input
              className="input input-bordered w-full"
              value={takerAmount}
              onChange={e => setTakerAmount(e.target.value)}
              placeholder="6"
            />
            <div className="text-xs opacity-60 mt-1">
              Cena:{" "}
              {makerAmount && takerAmount
                ? `${(Number(takerAmount) / Number(makerAmount)).toFixed(4)} TAB / wPos`
                : "—"}
            </div>
          </div>
          <div>
            <label className="label">Market ID (TabClob ověří, že wPos patří tomuto marketu)</label>
            <input
              className="input input-bordered w-full"
              type="number"
              min={0}
              value={marketId}
              onChange={e => setMarketId(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Specific taker (0x0 = anyone)</label>
            <input
              className="input input-bordered w-full"
              value={taker}
              onChange={e => setTaker(e.target.value as AddressType)}
            />
          </div>
          <div>
            <label className="label">Expiry (hours)</label>
            <input
              type="number"
              className="input input-bordered w-full"
              min={1}
              value={expiryHours}
              onChange={e => setExpiryHours(Number(e.target.value || 0))}
            />
          </div>
        </div>

        <label className="label">Note (optional)</label>
        <input className="input input-bordered" value={note} onChange={e => setNote(e.target.value)} />

        <div className="card-actions justify-end mt-4 gap-2">
          <button
            className="btn btn-secondary"
            disabled={busy || !connected || !makerTokenAddr}
            onClick={onApproveMaker}
          >
            Approve maker token to TabClob
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={onSign}>
            {busy ? "Signing…" : "Sign & save"}
          </button>
        </div>
        <p className="text-xs opacity-60 mt-2">
          Postup: maker (1) jednou schválí ten wPos token na TabClob, (2) podepíše order. Taker pak kliká
          &bdquo;Fill&ldquo; v tabulce — TabClob automaticky stáhne TAB od takera a wPos od makera.
        </p>
      </div>
    </div>
  );
};

const OrdersTable = ({ connected }: { connected?: AddressType }) => {
  const [orders, setOrders] = useState<CsvOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orders");
      const j = await res.json();
      setOrders(j.orders ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onCopy = (o: CsvOrder) => {
    navigator.clipboard.writeText(JSON.stringify(o, null, 2));
    notification.success("JSON skopírován");
  };

  const onDelete = async (id: string) => {
    const res = await fetch(`/api/orders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      notification.success("Smazáno z CSV");
      refresh();
    }
  };

  const buildOrderTuple = (o: CsvOrder) => ({
    maker: o.maker as AddressType,
    taker: o.taker as AddressType,
    makerToken: o.makerToken as AddressType,
    takerToken: o.takerToken as AddressType,
    makerAmount: BigInt(o.makerAmount),
    takerAmount: BigInt(o.takerAmount),
    expiry: BigInt(o.expiry),
    salt: BigInt(o.salt),
    marketId: BigInt(o.marketId ?? "0"),
  });

  const promptFillAmount = (full: bigint): bigint | null => {
    const input = window.prompt(
      `Kolik makerToken-u chceš odebrat? (max ${formatEther(full)})\n` +
        `Nech prázdné nebo 0 pro full fill.`,
      formatEther(full),
    );
    if (input === null) return null; // user cancelled
    const trimmed = input.trim();
    if (!trimmed || trimmed === "0") return full;
    try {
      const parsed = parseEther(trimmed);
      if (parsed <= 0n || parsed > full) {
        notification.error(`Hodnota mimo rozsah (1..${formatEther(full)})`);
        return null;
      }
      return parsed;
    } catch {
      notification.error("Nepovolený formát čísla");
      return null;
    }
  };

  const onFill = async (o: CsvOrder) => {
    if (!connected) return notification.error("Připoj wallet");
    if (connected.toLowerCase() === o.maker?.toLowerCase()) {
      return notification.error("Nemůžeš fillnout vlastní order");
    }
    setBusy(o.id);
    try {
      const order = buildOrderTuple(o);
      const fillMakerAmount = promptFillAmount(order.makerAmount);
      if (fillMakerAmount === null) {
        setBusy(null);
        return;
      }
      // Pro-rata taker payment, ceil-rounded to favor maker.
      const takerPay =
        (fillMakerAmount * order.takerAmount + order.makerAmount - 1n) / order.makerAmount;
      // Approve TAB to TabClob if needed
      await ensureErc20Approval(order.takerToken, connected, TABCLOB_ADDR, takerPay);
      await wagmiWriteContract(wagmiConfig, {
        address: TABCLOB_ADDR,
        abi: TABCLOB_FILL_ABI,
        functionName: "fill",
        args: [order, fillMakerAmount, o.signature as `0x${string}`],
        chainId: 31337,
        gas: 500_000n,
      });
      notification.success(`Filled ${formatEther(fillMakerAmount)} of maker side`);
      // If fully filled, remove from CSV so it doesn't get re-attempted.
      if (fillMakerAmount === order.makerAmount) {
        await fetch(`/api/orders?id=${encodeURIComponent(o.id)}`, { method: "DELETE" });
      }
      refresh();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async (o: CsvOrder) => {
    if (!connected) return notification.error("Připoj wallet");
    if (connected.toLowerCase() !== o.maker?.toLowerCase()) {
      return notification.error("On-chain cancel může jen maker");
    }
    setBusy(o.id);
    try {
      const order = buildOrderTuple(o);
      await wagmiWriteContract(wagmiConfig, {
        address: TABCLOB_ADDR,
        abi: TABCLOB_FILL_ABI,
        functionName: "cancel",
        args: [order],
        chainId: 31337,
        gas: 100_000n,
      });
      notification.success("Order canceled on-chain");
      await fetch(`/api/orders?id=${encodeURIComponent(o.id)}`, { method: "DELETE" });
      refresh();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <button className="btn btn-sm btn-ghost mb-2" onClick={refresh}>
        {loading ? "Loading…" : "Refresh"}
      </button>
      {orders.length === 0 ? (
        <div className="alert">Žádné orders.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra table-xs">
            <thead>
              <tr>
                <th>created</th>
                <th>maker</th>
                <th>makerToken / amount</th>
                <th>takerToken / amount</th>
                <th>expiry</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const isMine = !!connected && connected.toLowerCase() === o.maker?.toLowerCase();
                return (
                  <tr key={o.id}>
                    <td>{o.createdAt}</td>
                    <td>
                      <code className="text-[10px]">{o.maker?.slice(0, 10)}…</code>
                      {isMine && <span className="badge badge-xs badge-info ml-1">you</span>}
                    </td>
                    <td>
                      <div>
                        <code className="text-[10px]">{o.makerToken?.slice(0, 10)}…</code>
                      </div>
                      <div>{safeFormatEther(o.makerAmount)}</div>
                    </td>
                    <td>
                      <div>
                        <code className="text-[10px]">{o.takerToken?.slice(0, 10)}…</code>
                      </div>
                      <div>{safeFormatEther(o.takerAmount)}</div>
                    </td>
                    <td>{o.expiry ? new Date(Number(o.expiry) * 1000).toLocaleString() : "—"}</td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {!isMine && (
                          <button className="btn btn-xs btn-success" disabled={busy === o.id} onClick={() => onFill(o)}>
                            {busy === o.id ? "Filling…" : "Fill"}
                          </button>
                        )}
                        {isMine && (
                          <button
                            className="btn btn-xs btn-warning"
                            disabled={busy === o.id}
                            onClick={() => onCancel(o)}
                          >
                            {busy === o.id ? "Canceling…" : "Cancel on-chain"}
                          </button>
                        )}
                        <button className="btn btn-xs" onClick={() => onCopy(o)}>
                          Copy
                        </button>
                        <button className="btn btn-xs btn-error" onClick={() => onDelete(o.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const safeFormatEther = (v?: string): string => {
  if (!v) return "—";
  try {
    return formatEther(BigInt(v));
  } catch {
    return v;
  }
};
