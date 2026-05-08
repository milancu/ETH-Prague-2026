"use client";

import { useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { getBalance, readContract } from "@wagmi/core";
import type { NextPage } from "next";
import { Address as AddressType, formatEther, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const TAB_ADDR = deployedContracts[31337].TABcoin.address as AddressType;
const CT_ADDR = deployedContracts[31337].ConditionalTokens.address as AddressType;
const PMV2_ADDR = deployedContracts[31337].PredictionMarketV2.address as AddressType;
const FACTORY_ADDR = deployedContracts[31337].PositionWrapperFactory.address as AddressType;

const PMV2_ABI = deployedContracts[31337].PredictionMarketV2.abi;
const CT_ABI = deployedContracts[31337].ConditionalTokens.abi;
const FACTORY_ABI = deployedContracts[31337].PositionWrapperFactory.abi;

const TAB_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const WRAPPER_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const FUNDED_ACCOUNTS: { label: string; addr: AddressType }[] = [
  { label: "0x92e3… (user A)", addr: "0x92e30b6A54911a3385Bcd69F2dEc998A13ef692f" },
  { label: "0x933a… (user B)", addr: "0x933a8f32D8C2BA04643De7dBcaA38232c4a7847F" },
  { label: "0x48c5… (TAB authorizer)", addr: "0x48c5632dCC220Abf56000F93B1C4DEB501c64588" },
];

const OUTCOME_TYPES = ["BINARY", "MULTI", "SCALAR", "ORDINAL"] as const;

type SlotInfo = {
  slot: number;
  indexSet: bigint;
  positionId: bigint;
  raw1155: bigint;
  wrapperAddr: AddressType;
  wrapperSymbol?: string;
  wrapped: bigint;
};

type MarketInfo = {
  id: number;
  description: string;
  category: string;
  outcomeType: number;
  resolved: boolean;
  canceled: boolean;
  conditionId: `0x${string}`;
  slots: SlotInfo[];
};

type WrapperInfo = {
  wrapper: AddressType;
  conditionId: `0x${string}`;
  indexSet: bigint;
  symbol: string;
  balance: bigint;
};

type AccountSnapshot = {
  eth: bigint;
  tab: bigint;
  markets: MarketInfo[];
  wrappers: WrapperInfo[];
};

const BalancesPage: NextPage = () => {
  const { address: connected } = useAccount();
  const [selected, setSelected] = useState<AddressType | "connected">("connected");
  const [snap, setSnap] = useState<AccountSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const { data: wrapperEvents } = useScaffoldEventHistory({
    contractName: "PositionWrapperFactory",
    eventName: "WrapperCreated",
    watch: true,
  });

  const targetAddress: AddressType | undefined = selected === "connected" ? connected : selected;

  const wrappersFromEvents = useMemo(() => {
    type WE = { args: { wrapper: AddressType; conditionId: `0x${string}`; indexSet: bigint } };
    const list = ((wrapperEvents ?? []) as unknown as WE[]).map(e => e.args).filter(Boolean);
    const seen = new Set<string>();
    return list.filter(w => {
      if (seen.has(w.wrapper)) return false;
      seen.add(w.wrapper);
      return true;
    });
  }, [wrapperEvents]);

  useEffect(() => {
    if (!targetAddress) {
      setSnap(null);
      return;
    }
    let canceled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [ethBal, tabBal, marketCount] = await Promise.all([
          getBalance(wagmiConfig, { address: targetAddress, chainId: 31337 }),
          readContract(wagmiConfig, {
            address: TAB_ADDR,
            abi: TAB_ABI,
            functionName: "balanceOf",
            args: [targetAddress],
            chainId: 31337,
          }) as Promise<bigint>,
          readContract(wagmiConfig, {
            address: PMV2_ADDR,
            abi: PMV2_ABI,
            functionName: "marketCount",
            chainId: 31337,
          }) as Promise<bigint>,
        ]);

        const N = Number(marketCount);
        const markets: MarketInfo[] = [];
        for (let i = 0; i < N; i++) {
          const m = (await readContract(wagmiConfig, {
            address: PMV2_ADDR,
            abi: PMV2_ABI,
            functionName: "getMarket",
            args: [BigInt(i)],
            chainId: 31337,
          })) as {
            description: string;
            category: string;
            outcomeType: number;
            outcomeSlotCount: bigint;
            conditionId: `0x${string}`;
            resolved: boolean;
            canceled: boolean;
          };

          const slotCount = Number(m.outcomeSlotCount);
          const slotPromises = Array.from({ length: slotCount }, (_, s) => loadSlot(targetAddress, m.conditionId, s));
          const slots = await Promise.all(slotPromises);

          markets.push({
            id: i,
            description: m.description,
            category: m.category,
            outcomeType: m.outcomeType,
            resolved: m.resolved,
            canceled: m.canceled,
            conditionId: m.conditionId,
            slots,
          });
        }

        // Standalone wrapper balances (every wrapper ever created — useful even for ones outside markets[i])
        const wrappers: WrapperInfo[] = await Promise.all(
          wrappersFromEvents.map(async w => {
            const [bal, sym] = await Promise.all([
              readContract(wagmiConfig, {
                address: w.wrapper,
                abi: WRAPPER_ABI,
                functionName: "balanceOf",
                args: [targetAddress],
                chainId: 31337,
              }) as Promise<bigint>,
              readContract(wagmiConfig, {
                address: w.wrapper,
                abi: WRAPPER_ABI,
                functionName: "symbol",
                chainId: 31337,
              }) as Promise<string>,
            ]);
            return {
              wrapper: w.wrapper,
              conditionId: w.conditionId,
              indexSet: w.indexSet,
              symbol: sym,
              balance: bal,
            };
          }),
        );

        if (canceled) return;
        setSnap({ eth: ethBal.value, tab: tabBal, markets, wrappers });
      } catch (e: unknown) {
        if (!canceled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [targetAddress, refreshTick, wrappersFromEvents]);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Balances</h1>
      <p className="text-sm opacity-70 mb-6">Přehled všech zůstatků pro vybraný účet (read-only).</p>

      <div className="card bg-base-100 shadow-xl mb-6">
        <div className="card-body">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="label-text whitespace-nowrap">Účet:</label>
            <select
              className="select select-bordered select-sm flex-1 min-w-[280px]"
              value={selected}
              onChange={e => setSelected(e.target.value as AddressType | "connected")}
            >
              <option value="connected">
                Connected wallet {connected ? `(${connected.slice(0, 10)}…)` : "(none)"}
              </option>
              {FUNDED_ACCOUNTS.map(a => (
                <option key={a.addr} value={a.addr}>
                  {a.label}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => setRefreshTick(t => t + 1)} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {targetAddress && (
            <div className="text-xs opacity-60 mt-2 flex gap-1 items-center">
              Zobrazuju: <Address address={targetAddress} />
            </div>
          )}
          {err && <div className="alert alert-error mt-2 text-xs">{err}</div>}
        </div>
      </div>

      {!targetAddress && <div className="alert">Připoj wallet nebo vyber jeden z funded účtů.</div>}

      {snap && (
        <>
          <NativeAndTabSection eth={snap.eth} tab={snap.tab} />
          <MarketsSection markets={snap.markets} />
          <WrappersSection wrappers={snap.wrappers} />
        </>
      )}
    </div>
  );
};

export default BalancesPage;

const loadSlot = async (account: AddressType, conditionId: `0x${string}`, slot: number): Promise<SlotInfo> => {
  const indexSet = 1n << BigInt(slot);
  const collectionId = (await readContract(wagmiConfig, {
    address: CT_ADDR,
    abi: CT_ABI,
    functionName: "getCollectionId",
    args: [conditionId, indexSet],
    chainId: 31337,
  })) as `0x${string}`;
  const positionId = (await readContract(wagmiConfig, {
    address: CT_ADDR,
    abi: CT_ABI,
    functionName: "getPositionId",
    args: [TAB_ADDR, collectionId],
    chainId: 31337,
  })) as bigint;
  const raw1155 = (await readContract(wagmiConfig, {
    address: CT_ADDR,
    abi: CT_ABI,
    functionName: "balanceOf",
    args: [account, positionId],
    chainId: 31337,
  })) as bigint;
  const wrapperAddr = (await readContract(wagmiConfig, {
    address: FACTORY_ADDR,
    abi: FACTORY_ABI,
    functionName: "getWrapper",
    args: [TAB_ADDR, conditionId, indexSet],
    chainId: 31337,
  })) as AddressType;

  let wrapped = 0n;
  let wrapperSymbol: string | undefined;
  if (wrapperAddr && wrapperAddr !== zeroAddress) {
    const [bal, sym] = await Promise.all([
      readContract(wagmiConfig, {
        address: wrapperAddr,
        abi: WRAPPER_ABI,
        functionName: "balanceOf",
        args: [account],
        chainId: 31337,
      }) as Promise<bigint>,
      readContract(wagmiConfig, {
        address: wrapperAddr,
        abi: WRAPPER_ABI,
        functionName: "symbol",
        chainId: 31337,
      }) as Promise<string>,
    ]);
    wrapped = bal;
    wrapperSymbol = sym;
  }

  return { slot, indexSet, positionId, raw1155, wrapperAddr, wrapperSymbol, wrapped };
};

const NativeAndTabSection = ({ eth, tab }: { eth: bigint; tab: bigint }) => (
  <div className="card bg-base-100 shadow-xl mb-6">
    <div className="card-body">
      <h2 className="card-title">Native + TAB</h2>
      <div className="grid grid-cols-2 gap-4 text-lg">
        <div>
          <div className="text-xs opacity-60">ETH</div>
          <div className="font-mono">{formatEther(eth)}</div>
        </div>
        <div>
          <div className="text-xs opacity-60">TABcoin</div>
          <div className="font-mono">{formatEther(tab)}</div>
        </div>
      </div>
    </div>
  </div>
);

const MarketsSection = ({ markets }: { markets: MarketInfo[] }) => {
  if (markets.length === 0) {
    return (
      <div className="card bg-base-100 shadow-xl mb-6">
        <div className="card-body">
          <h2 className="card-title">Markets</h2>
          <div className="text-sm opacity-60">Žádné trhy.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card bg-base-100 shadow-xl mb-6">
      <div className="card-body">
        <h2 className="card-title">Markets</h2>
        <div className="space-y-4">
          {markets.map(m => {
            const status = m.canceled ? "CANCELED" : m.resolved ? "RESOLVED" : "ACTIVE";
            return (
              <div key={m.id} className="border border-base-300 rounded-lg p-3">
                <div className="flex gap-2 items-center flex-wrap mb-1">
                  <span className="badge badge-neutral">#{m.id}</span>
                  <span
                    className={`badge ${
                      status === "ACTIVE" ? "badge-success" : status === "RESOLVED" ? "badge-info" : "badge-error"
                    }`}
                  >
                    {status}
                  </span>
                  <span className="badge badge-ghost">{OUTCOME_TYPES[m.outcomeType]}</span>
                </div>
                <div className="font-medium">{m.description}</div>
                <div className="text-xs opacity-60 mb-2">category: {m.category}</div>
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Raw ERC-1155</th>
                      <th>Wrapper</th>
                      <th>Wrapped ERC-20</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.slots.map(s => (
                      <tr key={s.slot}>
                        <td>{s.slot}</td>
                        <td className="font-mono">{formatEther(s.raw1155)}</td>
                        <td>
                          {s.wrapperAddr !== zeroAddress ? (
                            <code className="text-[10px]">
                              {s.wrapperSymbol ?? ""} {s.wrapperAddr.slice(0, 10)}…
                            </code>
                          ) : (
                            <span className="opacity-40">— not created —</span>
                          )}
                        </td>
                        <td className="font-mono">{formatEther(s.wrapped)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const WrappersSection = ({ wrappers }: { wrappers: WrapperInfo[] }) => {
  if (wrappers.length === 0) {
    return (
      <div className="card bg-base-100 shadow-xl mb-6">
        <div className="card-body">
          <h2 className="card-title">Standalone wPos wrappers</h2>
          <div className="text-sm opacity-60">Žádné wrappery zatím.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card bg-base-100 shadow-xl mb-6">
      <div className="card-body">
        <h2 className="card-title">Standalone wPos wrappers</h2>
        <p className="text-xs opacity-60 mb-2">
          Všechny vyrobené wPos wrappery na chainu (= seznam přes WrapperCreated event), s tvým ERC-20 zůstatkem.
        </p>
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Wrapper</th>
              <th>conditionId</th>
              <th>indexSet</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {wrappers.map(w => (
              <tr key={w.wrapper}>
                <td>{w.symbol}</td>
                <td>
                  <code className="text-[10px]">{w.wrapper.slice(0, 10)}…</code>
                </td>
                <td>
                  <code className="text-[10px]">{w.conditionId.slice(0, 10)}…</code>
                </td>
                <td>{w.indexSet.toString()}</td>
                <td className="font-mono">{formatEther(w.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
