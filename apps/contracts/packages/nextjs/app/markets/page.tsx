"use client";

import { useMemo, useState } from "react";
import { Address, AddressInput } from "@scaffold-ui/components";
import { writeContract as wagmiWriteContract } from "@wagmi/core";
import { getPublicClient } from "@wagmi/core";
import type { NextPage } from "next";
import {
  Address as AddressType,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  parseEther,
  zeroAddress,
} from "viem";
import { useAccount } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import { notification } from "~~/utils/scaffold-eth";

const OUTCOME_TYPES = ["BINARY", "MULTI", "SCALAR", "ORDINAL"] as const;
type OutcomeTypeName = (typeof OUTCOME_TYPES)[number];

const minSlotsFor = (t: OutcomeTypeName): number => (t === "BINARY" || t === "SCALAR" ? 2 : t === "MULTI" ? 3 : 2);

const toIsoLocal = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleString();
const nowSec = () => Math.floor(Date.now() / 1000);

type MarketStruct = {
  creator: AddressType;
  oracle: AddressType;
  questionId: `0x${string}`;
  conditionId: `0x${string}`;
  outcomeSlotCount: bigint;
  outcomeType: number;
  description: string;
  category: string;
  createdAt: bigint;
  expiresAt: bigint;
  resolutionTime: bigint;
  bondAmount: bigint;
  bondClaimed: boolean;
  bondSlashed: boolean;
  verified: boolean;
  canceled: boolean;
  resolved: boolean;
  paused: boolean;
};

const PMV2_ADDR = deployedContracts[31337].PredictionMarketV2.address as AddressType;
const TAB_ADDR = deployedContracts[31337].TABcoin.address as AddressType;
const CT_ADDR = deployedContracts[31337].ConditionalTokens.address as AddressType;
const FACTORY_ADDR = deployedContracts[31337].PositionWrapperFactory.address as AddressType;

const wrapAbi = [
  {
    name: "wrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const readWrapperAddress = async (
  collateral: AddressType,
  conditionId: `0x${string}`,
  indexSet: bigint,
): Promise<AddressType | undefined> => {
  const factoryAbi = deployedContracts[31337].PositionWrapperFactory.abi;
  const client = getPublicClient(wagmiConfig);
  if (!client) return;
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: "getWrapper",
    args: [collateral, conditionId, indexSet],
  });
  const ret = await client.call({ to: FACTORY_ADDR, data });
  if (!ret.data) return;
  const decoded = decodeFunctionResult({ abi: factoryAbi, functionName: "getWrapper", data: ret.data });
  return decoded as AddressType;
};

const MarketsPage: NextPage = () => {
  const { address: connected } = useAccount();
  const { data: marketCount } = useScaffoldReadContract({
    contractName: "PredictionMarketV2",
    functionName: "marketCount",
  });
  const { data: defaultBond } = useScaffoldReadContract({
    contractName: "PredictionMarketV2",
    functionName: "defaultBond",
  });

  const ids = useMemo(() => {
    const n = marketCount ? Number(marketCount) : 0;
    return Array.from({ length: n }, (_, i) => i).reverse();
  }, [marketCount]);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-2">Prediction Markets</h1>
      <p className="text-sm opacity-70 mb-6">Vytvoř market, kup pozice, wrapni do ERC-20, resolve a claim bond.</p>

      <CreateMarketForm defaultBond={defaultBond} connected={connected} />

      <h2 className="text-2xl font-bold mt-10 mb-4">Existující trhy ({marketCount?.toString() ?? "0"})</h2>
      {ids.length === 0 ? (
        <div className="alert">Žádné trhy. Vytvoř první výše.</div>
      ) : (
        <div className="space-y-4">
          {ids.map(id => (
            <MarketCard key={id} marketId={BigInt(id)} connected={connected} />
          ))}
        </div>
      )}
    </div>
  );
};

export default MarketsPage;

const CreateMarketForm = ({ defaultBond, connected }: { defaultBond?: bigint; connected?: AddressType }) => {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("crypto");
  const [outcomeType, setOutcomeType] = useState<OutcomeTypeName>("BINARY");
  const [slots, setSlots] = useState(2);
  const [oracle, setOracle] = useState<string>("");
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [resolveAfterHours, setResolveAfterHours] = useState(1);
  const [busyApprove, setBusyApprove] = useState(false);

  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "allowance",
    args: [connected, PMV2_ADDR],
  });
  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writePMv2, isPending } = useScaffoldWriteContract({
    contractName: "PredictionMarketV2",
  });

  const needsApprove = !!defaultBond && (!allowance || (allowance as bigint) < defaultBond);

  const onApprove = async () => {
    if (!defaultBond) return;
    setBusyApprove(true);
    try {
      await writeTab({ functionName: "approve", args: [PMV2_ADDR, defaultBond] });
      // refetch so the UI flips to "ready"
      await refetchAllowance();
      notification.success("Approve confirmed");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyApprove(false);
    }
  };

  const onCreate = async () => {
    if (!description.trim()) return notification.error("Description required");
    if (!oracle || !/^0x[0-9a-fA-F]{40}$/.test(oracle)) {
      return notification.error("Bad oracle address");
    }
    if (slots < minSlotsFor(outcomeType)) {
      return notification.error(`${outcomeType} needs ≥ ${minSlotsFor(outcomeType)} slots`);
    }
    if (needsApprove) return notification.error("Nejdřív schval TAB bond (krok 1).");

    const expiresAt = BigInt(nowSec() + expiresInHours * 3600);
    const resolutionTime = expiresAt + BigInt(resolveAfterHours * 3600);
    const outcomeIdx = OUTCOME_TYPES.indexOf(outcomeType);

    try {
      await writePMv2({
        functionName: "createMarket",
        args: [description, category, outcomeIdx, BigInt(slots), oracle as AddressType, expiresAt, resolutionTime],
      });
      notification.success("Market created");
      setDescription("");
      await refetchAllowance();
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Vytvořit nový trh</h2>
        <div className="text-xs opacity-60 mb-2 flex gap-2 items-center flex-wrap">
          <span>Bond: {defaultBond ? formatEther(defaultBond) : "?"} TAB</span>
          <span>·</span>
          <span>Connected: {connected ? <Address address={connected} /> : "—"}</span>
        </div>

        <label className="label">Description</label>
        <input className="input input-bordered" value={description} onChange={e => setDescription(e.target.value)} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          <div>
            <label className="label">Category</label>
            <input
              className="input input-bordered w-full"
              value={category}
              onChange={e => setCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Outcome type</label>
            <select
              className="select select-bordered w-full"
              value={outcomeType}
              onChange={e => {
                const v = e.target.value as OutcomeTypeName;
                setOutcomeType(v);
                setSlots(minSlotsFor(v));
              }}
            >
              {OUTCOME_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Slots</label>
            <input
              className="input input-bordered w-full"
              type="number"
              min={minSlotsFor(outcomeType)}
              value={slots}
              onChange={e => setSlots(Math.max(minSlotsFor(outcomeType), Number(e.target.value || 0)))}
            />
          </div>
          <div>
            <label className="label">Oracle address</label>
            <AddressInput value={oracle} onChange={setOracle} placeholder="0x…" />
          </div>
          <div>
            <label className="label">Expires in (hours)</label>
            <input
              type="number"
              className="input input-bordered w-full"
              min={1}
              value={expiresInHours}
              onChange={e => setExpiresInHours(Number(e.target.value || 0))}
            />
          </div>
          <div>
            <label className="label">Resolution buffer (hours after expiry)</label>
            <input
              type="number"
              className="input input-bordered w-full"
              min={0}
              value={resolveAfterHours}
              onChange={e => setResolveAfterHours(Number(e.target.value || 0))}
            />
          </div>
        </div>

        <div className="text-xs opacity-70 mt-3">
          Allowance PMv2 → {allowance !== undefined ? formatEther(allowance as bigint) : "?"} TAB
          {needsApprove ? " (nedostatečné)" : " ✓"}
        </div>

        <div className="card-actions justify-end mt-4 gap-2">
          <button
            className="btn btn-secondary"
            disabled={!needsApprove || busyApprove || !connected}
            onClick={onApprove}
          >
            {busyApprove ? "Approving…" : `1. Approve ${defaultBond ? formatEther(defaultBond) : ""} TAB`}
          </button>
          <button className="btn btn-primary" disabled={isPending || needsApprove || !connected} onClick={onCreate}>
            {isPending ? "Creating…" : "2. Create Market"}
          </button>
        </div>
      </div>
    </div>
  );
};

const MarketCard = ({ marketId, connected }: { marketId: bigint; connected?: AddressType }) => {
  const { data: m } = useScaffoldReadContract({
    contractName: "PredictionMarketV2",
    functionName: "getMarket",
    args: [marketId],
  });
  const market = m as unknown as MarketStruct | undefined;

  if (!market) {
    return <div className="card bg-base-100 shadow-md p-4">Loading market #{marketId.toString()}…</div>;
  }

  const {
    creator,
    oracle,
    conditionId,
    outcomeSlotCount,
    outcomeType,
    description,
    category,
    expiresAt,
    resolutionTime,
    bondAmount,
    bondClaimed,
    bondSlashed,
    verified,
    canceled,
    resolved,
    paused,
  } = market;

  const isCreator = !!connected && connected.toLowerCase() === creator.toLowerCase();
  const isOracle = !!connected && connected.toLowerCase() === oracle.toLowerCase();
  const status = canceled
    ? "CANCELED"
    : resolved
      ? "RESOLVED"
      : paused
        ? "PAUSED"
        : nowSec() > Number(expiresAt)
          ? "EXPIRED"
          : "ACTIVE";
  const statusColor =
    status === "ACTIVE"
      ? "badge-success"
      : status === "RESOLVED"
        ? "badge-info"
        : status === "CANCELED"
          ? "badge-error"
          : "badge-warning";

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="badge badge-neutral">#{marketId.toString()}</span>
          <span className={`badge ${statusColor}`}>{status}</span>
          {verified && <span className="badge badge-info">verified</span>}
          <span className="badge badge-ghost">{OUTCOME_TYPES[outcomeType]}</span>
          <span className="badge badge-ghost">{outcomeSlotCount.toString()} slots</span>
        </div>
        <h3 className="font-bold text-lg">{description}</h3>
        <div className="text-xs opacity-60 space-y-0.5 mt-1">
          <div>category: {category}</div>
          <div className="flex gap-1 items-center">
            creator: <Address address={creator} />
          </div>
          <div className="flex gap-1 items-center">
            oracle: <Address address={oracle} />
          </div>
          <div>expires: {toIsoLocal(expiresAt)}</div>
          <div>resolves: {toIsoLocal(resolutionTime)}</div>
          <div>
            conditionId: <code className="text-[10px]">{conditionId.slice(0, 18)}…</code>
          </div>
          <div>
            bond: {formatEther(bondAmount)} TAB
            {bondClaimed && " · claimed"}
            {bondSlashed && " · slashed"}
          </div>
        </div>

        <MarketActions
          marketId={marketId}
          conditionId={conditionId}
          outcomeSlotCount={outcomeSlotCount}
          isCreator={isCreator}
          isOracle={isOracle}
          resolved={resolved}
          canceled={canceled}
          bondAvailable={!bondClaimed && !bondSlashed && bondAmount > 0n}
        />
      </div>
    </div>
  );
};

const MarketActions = ({
  marketId,
  conditionId,
  outcomeSlotCount,
  isCreator,
  isOracle,
  resolved,
  canceled,
  bondAvailable,
}: {
  marketId: bigint;
  conditionId: `0x${string}`;
  outcomeSlotCount: bigint;
  isCreator: boolean;
  isOracle: boolean;
  resolved: boolean;
  canceled: boolean;
  bondAvailable: boolean;
}) => {
  const N = Number(outcomeSlotCount);
  const partition = useMemo(() => Array.from({ length: N }, (_, i) => 1n << BigInt(i)), [N]);

  const [splitAmount, setSplitAmount] = useState("");
  const [wrapIndexBit, setWrapIndexBit] = useState(0);
  const [resolvePayouts, setResolvePayouts] = useState<string[]>(() => Array(N).fill("0"));

  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writeCT } = useScaffoldWriteContract({ contractName: "ConditionalTokens" });
  const { writeContractAsync: writePMv2 } = useScaffoldWriteContract({ contractName: "PredictionMarketV2" });
  const { writeContractAsync: writeFactory } = useScaffoldWriteContract({
    contractName: "PositionWrapperFactory",
  });

  const onSplit = async () => {
    if (!splitAmount) return notification.error("Amount required");
    const amount = parseEther(splitAmount);
    try {
      await writeTab({ functionName: "approve", args: [CT_ADDR, amount] });
      await writeCT({
        functionName: "splitPosition",
        args: [TAB_ADDR, conditionId, partition, amount],
      });
      notification.success(`Bought ${splitAmount} of all ${N} positions`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Pre-create wrappers for every slot without splitting/wrapping. Useful when you want
  // wrappers to show up in the 0x Orders dropdown before any positions exist.
  const onCreateAllWrappers = async () => {
    try {
      for (let i = 0; i < N; i++) {
        const indexSet = 1n << BigInt(i);
        const existing = await readWrapperAddress(TAB_ADDR, conditionId, indexSet);
        if (existing && existing !== zeroAddress) continue;
        await writeFactory({
          functionName: "getOrCreateWrapper",
          args: [TAB_ADDR, conditionId, indexSet],
        });
      }
      notification.success(`Wrappery připravené pro všech ${N} slotů`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onWrap = async () => {
    if (!splitAmount) return notification.error("Amount required");
    const indexSet = 1n << BigInt(wrapIndexBit);
    const amount = parseEther(splitAmount);
    try {
      await writeFactory({
        functionName: "getOrCreateWrapper",
        args: [TAB_ADDR, conditionId, indexSet],
      });
      const w = await readWrapperAddress(TAB_ADDR, conditionId, indexSet);
      if (!w || w === zeroAddress) return notification.error("Wrapper not found after create");
      await writeCT({ functionName: "setApprovalForAll", args: [w, true] });
      await wagmiWriteContract(wagmiConfig, {
        address: w,
        abi: wrapAbi,
        functionName: "wrap",
        args: [amount],
        // Stay under Base L2's 16.7M tx gas cap; wrap is ~115k.
        gas: 500_000n,
      });
      notification.success(`Wrapped ${splitAmount} of slot ${wrapIndexBit} into ${w}`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onResolve = async () => {
    try {
      const payouts = resolvePayouts.map(s => BigInt(s || "0"));
      if (payouts.length !== N) return;
      if (payouts.every(p => p === 0n)) return notification.error("Sum must be > 0");
      await writePMv2({ functionName: "resolveMarket", args: [marketId, payouts] });
      notification.success("Resolved");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onCancel = async () => {
    try {
      await writePMv2({ functionName: "cancelMarket", args: [marketId] });
      notification.success("Canceled");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onClaim = async () => {
    try {
      await writePMv2({ functionName: "claimCreatorBond", args: [marketId] });
      notification.success("Bond claimed");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onRedeem = async () => {
    try {
      await writeCT({
        functionName: "redeemPositions",
        args: [TAB_ADDR, conditionId, partition],
      });
      notification.success("Redeemed");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mt-3 border-t pt-3">
      <details className="collapse collapse-arrow bg-base-200 mb-2">
        <summary className="collapse-title font-semibold">🛒 Buy positions (split TAB → all {N} slots)</summary>
        <div className="collapse-content space-y-2">
          <input
            className="input input-bordered w-full"
            placeholder="Amount in TAB (e.g. 10)"
            value={splitAmount}
            onChange={e => setSplitAmount(e.target.value)}
          />
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary btn-sm" onClick={onSplit} disabled={resolved || canceled}>
              Approve & Split
            </button>
            <select
              className="select select-bordered select-sm"
              value={wrapIndexBit}
              onChange={e => setWrapIndexBit(Number(e.target.value))}
            >
              {Array.from({ length: N }, (_, i) => (
                <option key={i} value={i}>
                  Slot {i}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={onWrap}>
              Wrap slot to ERC-20
            </button>
            <button className="btn btn-outline btn-sm" onClick={onCreateAllWrappers}>
              Create wrappers (no wrap)
            </button>
            {resolved && (
              <button className="btn btn-accent btn-sm" onClick={onRedeem}>
                Redeem all positions
              </button>
            )}
          </div>
          <p className="text-xs opacity-60">
            &bdquo;Create wrappers&ldquo; jen vyrobí ERC-20 obal pro každý slot (idempotentně). Bez splitu/wrapnutí —
            stačí proto, aby se wrappery objevily v dropdownu na záložce &bdquo;0x Orders&ldquo;.
          </p>
        </div>
      </details>

      {isOracle && !resolved && !canceled && (
        <details className="collapse collapse-arrow bg-base-200 mb-2">
          <summary className="collapse-title font-semibold">⚖️ Resolve (oracle only)</summary>
          <div className="collapse-content space-y-2">
            <p className="text-xs opacity-70">
              Zadej payout vektor (sum &gt; 0). Klasicky: BINARY YES = [1,0], NO = [0,1].
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {resolvePayouts.map((v, i) => (
                <input
                  key={i}
                  className="input input-bordered input-sm"
                  type="number"
                  min={0}
                  value={v}
                  onChange={e => {
                    const next = [...resolvePayouts];
                    next[i] = e.target.value;
                    setResolvePayouts(next);
                  }}
                />
              ))}
            </div>
            <button className="btn btn-warning btn-sm" onClick={onResolve}>
              resolveMarket
            </button>
          </div>
        </details>
      )}

      <div className="flex gap-2 flex-wrap">
        {(isCreator || isOracle) && !resolved && !canceled && (
          <button className="btn btn-error btn-xs" onClick={onCancel}>
            Cancel market
          </button>
        )}
        {isCreator && resolved && bondAvailable && (
          <button className="btn btn-success btn-xs" onClick={onClaim}>
            Claim bond
          </button>
        )}
      </div>
    </div>
  );
};
