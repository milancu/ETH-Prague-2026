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
import scaffoldConfig from "~~/scaffold.config";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id as keyof typeof deployedContracts;

const OUTCOME_TYPES = ["BINARY", "MULTI", "SCALAR"] as const;
type OutcomeTypeName = (typeof OUTCOME_TYPES)[number];

const minSlotsFor = (t: OutcomeTypeName): number => (t === "MULTI" ? 3 : 2);
const maxSlotsFor = (t: OutcomeTypeName): number | undefined => (t === "BINARY" || t === "SCALAR" ? 2 : undefined);

const defaultLabelsFor = (t: OutcomeTypeName, slots: number): string[] => {
  if (t === "BINARY") return ["Ano", "Ne"];
  if (t === "SCALAR") return ["Pod", "Nad"];
  return Array.from({ length: slots }, (_, i) => `Možnost ${i + 1}`);
};

const toIsoLocal = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleString();
const nowSec = () => Math.floor(Date.now() / 1000);

const formatRemaining = (expiresAt: bigint): string => {
  const remaining = Number(expiresAt) - nowSec();
  if (remaining <= 0) return "expired";
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

type MarketStruct = {
  creator: AddressType;
  oracle: AddressType;
  questionId: `0x${string}`;
  conditionId: `0x${string}`;
  outcomeSlotCount: bigint;
  outcomeType: number;
  name: string;
  description: string;
  category: string;
  outcomeLabels: string[];
  createdAt: bigint;
  expiresAt: bigint;
  resolutionTime: bigint;
  bondAmount: bigint;
  lockedCollateral: bigint;
  bondClaimed: boolean;
  bondSlashed: boolean;
  verified: boolean;
  canceled: boolean;
  resolved: boolean;
  paused: boolean;
};

const PMV2_ADDR = deployedContracts[CHAIN_ID].PredictionMarketV2.address as AddressType;
const TAB_ADDR = deployedContracts[CHAIN_ID].TABcoin.address as AddressType;
const CT_ADDR = deployedContracts[CHAIN_ID].ConditionalTokens.address as AddressType;
const FACTORY_ADDR = deployedContracts[CHAIN_ID].PositionWrapperFactory.address as AddressType;
const AMM_ADDR = (deployedContracts[CHAIN_ID] as Record<string, { address: AddressType }>).PredictionAMM
  ?.address as AddressType;

// Spot price for outcome i derived from FPMM reserves:
// price_i = Π_{j≠i} R_j / Σ_k Π_{j≠k} R_j (sums to 1 across all outcomes).
const computeImpliedPrices = (reserves: bigint[]): number[] | null => {
  const N = reserves.length;
  if (N === 0 || reserves.some(r => r === 0n)) return null;
  const numerators: bigint[] = [];
  let denominator = 0n;
  for (let k = 0; k < N; k++) {
    let prod = 1n;
    for (let j = 0; j < N; j++) {
      if (j === k) continue;
      prod *= reserves[j];
    }
    numerators.push(prod);
    denominator += prod;
  }
  if (denominator === 0n) return null;
  return numerators.map(n => Number((n * 10000n) / denominator) / 100);
};

const erc20ApproveAbi = [
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
] as const;

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
  const factoryAbi = deployedContracts[CHAIN_ID].PositionWrapperFactory.abi;
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("crypto");
  const [outcomeType, setOutcomeType] = useState<OutcomeTypeName>("BINARY");
  const [slots, setSlots] = useState(2);
  const [outcomeLabels, setOutcomeLabels] = useState<string[]>(() => defaultLabelsFor("BINARY", 2));
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
      notification.error(getParsedError(e));
    } finally {
      setBusyApprove(false);
    }
  };

  const onCreate = async () => {
    if (!name.trim()) return notification.error("Název trhu je povinný");
    if (!oracle || !/^0x[0-9a-fA-F]{40}$/.test(oracle)) {
      return notification.error("Bad oracle address");
    }
    if (slots < minSlotsFor(outcomeType)) {
      return notification.error(`${outcomeType} needs ≥ ${minSlotsFor(outcomeType)} slots`);
    }
    const max = maxSlotsFor(outcomeType);
    if (max !== undefined && slots > max) {
      return notification.error(`${outcomeType} max ${max} slots`);
    }
    if (outcomeLabels.length !== slots || outcomeLabels.some(l => !l.trim())) {
      return notification.error(`Vyplň všech ${slots} názvů možností`);
    }
    if (needsApprove) return notification.error("Nejdřív schval TAB bond (krok 1).");

    const expiresAt = BigInt(nowSec() + expiresInHours * 3600);
    const resolutionTime = expiresAt + BigInt(resolveAfterHours * 3600);
    const outcomeIdx = OUTCOME_TYPES.indexOf(outcomeType);

    try {
      await writePMv2({
        functionName: "createMarket",
        args: [
          {
            name,
            description,
            category,
            outcomeType: outcomeIdx,
            outcomeSlotCount: BigInt(slots),
            outcomeLabels,
            oracle: oracle as AddressType,
            expiresAt,
            resolutionTime,
          },
        ],
      });
      notification.success("Market created");
      setName("");
      setDescription("");
      await refetchAllowance();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    }
  };

  const updateOutcomeType = (t: OutcomeTypeName) => {
    setOutcomeType(t);
    const newSlots = minSlotsFor(t);
    setSlots(newSlots);
    setOutcomeLabels(defaultLabelsFor(t, newSlots));
  };

  const updateSlots = (s: number) => {
    const min = minSlotsFor(outcomeType);
    const max = maxSlotsFor(outcomeType);
    const clamped = Math.max(min, max !== undefined ? Math.min(max, s) : s);
    setSlots(clamped);
    setOutcomeLabels(prev => {
      const next = [...prev];
      while (next.length < clamped) next.push(`Možnost ${next.length + 1}`);
      next.length = clamped;
      return next;
    });
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

        <label className="label">Název (krátký, povinný)</label>
        <input
          className="input input-bordered"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Např. Vyhraje Slavia ligový titul 2026?"
          maxLength={120}
        />

        <label className="label mt-2">Description (delší popis, volitelný)</label>
        <textarea
          className="textarea textarea-bordered"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />

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
              onChange={e => updateOutcomeType(e.target.value as OutcomeTypeName)}
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
              max={maxSlotsFor(outcomeType)}
              value={slots}
              disabled={maxSlotsFor(outcomeType) === minSlotsFor(outcomeType)}
              onChange={e => updateSlots(Number(e.target.value || 0))}
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

        <div className="mt-3">
          <label className="label">
            Názvy možností ({outcomeType === "SCALAR" ? "krajní hodnoty" : `${slots} možnosti`})
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {outcomeLabels.map((label, i) => (
              <input
                key={i}
                className="input input-bordered w-full"
                value={label}
                placeholder={
                  outcomeType === "SCALAR"
                    ? i === 0
                      ? "Nízká hodnota (např. 'Pod 100 USD')"
                      : "Vysoká hodnota (např. 'Nad 200 USD')"
                    : `Možnost ${i + 1}`
                }
                onChange={e => {
                  const next = [...outcomeLabels];
                  next[i] = e.target.value;
                  setOutcomeLabels(next);
                }}
              />
            ))}
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
    name,
    description,
    category,
    outcomeLabels,
    expiresAt,
    resolutionTime,
    bondAmount,
    lockedCollateral,
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
        <h3 className="font-bold text-lg">{name || description}</h3>
        {description && name && <p className="text-sm opacity-80 mt-0.5">{description}</p>}
        <div className="flex gap-1 flex-wrap mt-2">
          {outcomeLabels.map((label, i) => (
            <span key={i} className="badge badge-outline">
              {i}: {label}
            </span>
          ))}
        </div>
        <MarketPriceBadges marketId={marketId} labels={outcomeLabels} />
        <div className="text-xs opacity-60 space-y-0.5 mt-2">
          <div>category: {category}</div>
          <div className="flex gap-1 items-center">
            creator: <Address address={creator} />
          </div>
          <div className="flex gap-1 items-center">
            oracle: <Address address={oracle} />
          </div>
          <div>
            expires: {toIsoLocal(expiresAt)}{" "}
            {!resolved && !canceled && <span className="badge badge-sm badge-ghost">{formatRemaining(expiresAt)}</span>}
          </div>
          <div>resolves: {toIsoLocal(resolutionTime)}</div>
          <div>
            conditionId: <code className="text-[10px]">{conditionId.slice(0, 18)}…</code>
          </div>
          <div>
            bond: {formatEther(bondAmount)} TAB
            {bondClaimed && " · claimed"}
            {bondSlashed && " · slashed"}
          </div>
          <div>locked TVL: {formatEther(lockedCollateral)} TAB</div>
        </div>

        <MarketActions
          marketId={marketId}
          conditionId={conditionId}
          outcomeSlotCount={outcomeSlotCount}
          outcomeLabels={outcomeLabels}
          isCreator={isCreator}
          isOracle={isOracle}
          resolved={resolved}
          canceled={canceled}
          paused={paused}
          bondAvailable={!bondClaimed && !bondSlashed && bondAmount > 0n}
          connected={connected}
        />
      </div>
    </div>
  );
};

const MarketActions = ({
  marketId,
  conditionId,
  outcomeSlotCount,
  outcomeLabels,
  isCreator,
  isOracle,
  resolved,
  canceled,
  paused,
  bondAvailable,
  connected,
}: {
  marketId: bigint;
  conditionId: `0x${string}`;
  outcomeSlotCount: bigint;
  outcomeLabels: string[];
  isCreator: boolean;
  isOracle: boolean;
  resolved: boolean;
  canceled: boolean;
  paused: boolean;
  bondAvailable: boolean;
  connected?: AddressType;
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

  // Use PMv2 helpers (splitTo, mergeFrom, splitAndWrap, claimWinnings) so the
  // per-market `lockedCollateral` counter stays accurate. Direct CT calls are still
  // possible but bypass the counter — debug UI prefers PMv2 path.
  const onSplit = async () => {
    if (!splitAmount) return notification.error("Amount required");
    const amount = parseEther(splitAmount);
    try {
      await writeTab({ functionName: "approve", args: [PMV2_ADDR, amount] });
      await writePMv2({
        functionName: "splitTo",
        args: [marketId, partition, amount],
      });
      notification.success(`Bought ${splitAmount} of all ${N} positions`);
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    }
  };

  const onMergeBack = async () => {
    if (!splitAmount) return notification.error("Amount required");
    const amount = parseEther(splitAmount);
    try {
      // user must let PMv2 pull their ERC-1155 positions
      await writeCT({ functionName: "setApprovalForAll", args: [PMV2_ADDR, true] });
      await writePMv2({
        functionName: "mergeFrom",
        args: [marketId, partition, amount],
      });
      notification.success(`Merged ${splitAmount} TAB back from full position set`);
    } catch (e: unknown) {
      notification.error(getParsedError(e));
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
      notification.error(getParsedError(e));
    }
  };

  const onWrap = async () => {
    if (!splitAmount) return notification.error("Amount required");
    const indexSet = 1n << BigInt(wrapIndexBit);
    const amount = parseEther(splitAmount);
    try {
      // PMv2.splitAndWrap pulls TAB, splits on CT, wraps the chosen slot, returns ERC-20 to user.
      await writeTab({ functionName: "approve", args: [PMV2_ADDR, amount] });
      await writePMv2({
        functionName: "splitAndWrap",
        args: [marketId, amount, [indexSet]],
      });
      const w = await readWrapperAddress(TAB_ADDR, conditionId, indexSet);
      notification.success(
        `Split & wrapped ${splitAmount} of "${outcomeLabels[wrapIndexBit] ?? `slot ${wrapIndexBit}`}" → ${w ?? "wrapper"}`,
      );
    } catch (e: unknown) {
      notification.error(getParsedError(e));
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
      notification.error(getParsedError(e));
    }
  };

  const onCancel = async () => {
    try {
      await writePMv2({ functionName: "cancelMarket", args: [marketId] });
      notification.success("Canceled");
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    }
  };

  const onClaim = async () => {
    try {
      await writePMv2({ functionName: "claimCreatorBond", args: [marketId] });
      notification.success("Bond claimed");
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    }
  };

  const onRedeem = async () => {
    try {
      // claimWinnings pulls user's ERC-1155 positions, redeems on CT, returns TAB.
      await writeCT({ functionName: "setApprovalForAll", args: [PMV2_ADDR, true] });
      await writePMv2({
        functionName: "claimWinnings",
        args: [marketId, partition],
      });
      notification.success("Claim výhry hotov");
    } catch (e: unknown) {
      notification.error(getParsedError(e));
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
              Approve & Split (PMv2)
            </button>
            <button className="btn btn-warning btn-sm" onClick={onMergeBack} disabled={resolved || canceled}>
              Merge back → TAB
            </button>
            <select
              className="select select-bordered select-sm"
              value={wrapIndexBit}
              onChange={e => setWrapIndexBit(Number(e.target.value))}
            >
              {Array.from({ length: N }, (_, i) => (
                <option key={i} value={i}>
                  {outcomeLabels[i] ?? `Slot ${i}`}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={onWrap} disabled={resolved || canceled}>
              Split &amp; wrap slot
            </button>
            <button className="btn btn-outline btn-sm" onClick={onCreateAllWrappers}>
              Create wrappers (no wrap)
            </button>
            {resolved && (
              <button className="btn btn-accent btn-sm" onClick={onRedeem}>
                Claim winnings
              </button>
            )}
          </div>
          <p className="text-xs opacity-60">
            &bdquo;Create wrappers&ldquo; jen vyrobí ERC-20 obal pro každý slot (idempotentně). Bez splitu/wrapnutí —
            stačí proto, aby se wrappery objevily v dropdownu na záložce &bdquo;0x Orders&ldquo;.
          </p>
        </div>
      </details>

      <AmmTradePanel
        marketId={marketId}
        outcomeLabels={outcomeLabels}
        outcomeSlotCount={outcomeSlotCount}
        resolved={resolved}
        canceled={canceled}
        paused={paused}
      />

      <AmmLiquidityPanel
        marketId={marketId}
        outcomeSlotCount={outcomeSlotCount}
        resolved={resolved}
        canceled={canceled}
        paused={paused}
        connected={connected}
      />

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

const MarketPriceBadges = ({ marketId, labels }: { marketId: bigint; labels: string[] }) => {
  const { data: reserves } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getReserves",
    args: [marketId],
  });
  if (!Array.isArray(reserves) || reserves.length !== labels.length) return null;
  const prices = computeImpliedPrices(reserves as bigint[]);
  if (!prices) return null;
  return (
    <div className="flex gap-1 flex-wrap mt-1">
      {labels.map((label, i) => (
        <span key={i} className="badge badge-primary">
          {label}: {prices[i].toFixed(1)}%
        </span>
      ))}
    </div>
  );
};

const AmmTradePanel = ({
  marketId,
  outcomeLabels,
  outcomeSlotCount,
  resolved,
  canceled,
  paused,
}: {
  marketId: bigint;
  outcomeLabels: string[];
  outcomeSlotCount: bigint;
  resolved: boolean;
  canceled: boolean;
  paused: boolean;
}) => {
  const N = Number(outcomeSlotCount);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [outcomeIdx, setOutcomeIdx] = useState(0);
  const [amountStr, setAmountStr] = useState("");
  const disabled = resolved || canceled || paused;

  const { data: reserves } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getReserves",
    args: [marketId],
  });
  const { data: wrappers } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getWrappers",
    args: [marketId],
  });
  const poolExists = Array.isArray(reserves) && reserves.length === N;

  const amountWei = useMemo(() => {
    if (!amountStr) return 0n;
    try {
      return parseEther(amountStr);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const quoteFn = mode === "buy" ? "calcBuyAmount" : "calcSellAmount";
  const { data: quote } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: quoteFn,
    args: poolExists && amountWei > 0n ? [marketId, outcomeIdx, amountWei] : (undefined as never),
  });

  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writeAmm } = useScaffoldWriteContract({ contractName: "PredictionAMM" });

  const onBuy = async () => {
    if (!poolExists) return notification.error("Pool ještě neexistuje");
    if (amountWei === 0n) return notification.error("Zadej částku v TAB");
    try {
      await writeTab({ functionName: "approve", args: [AMM_ADDR, amountWei] });
      await writeAmm({ functionName: "buy", args: [marketId, outcomeIdx, amountWei, 0n] });
      notification.success(`Buy ${amountStr} TAB → ${outcomeLabels[outcomeIdx]}`);
      setAmountStr("");
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  const onSell = async () => {
    if (!poolExists) return notification.error("Pool ještě neexistuje");
    if (amountWei === 0n) return notification.error("Zadej požadovaný TAB výnos");
    if (!Array.isArray(wrappers)) return notification.error("Wrappery se ještě nenačetly");
    if (!quote) return notification.error("Quote se ještě nenačetl");
    const outcomeIn = (quote as readonly bigint[])[0];
    const wrapperAddr = (wrappers as AddressType[])[outcomeIdx];
    try {
      await wagmiWriteContract(wagmiConfig, {
        address: wrapperAddr,
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [AMM_ADDR, outcomeIn],
      });
      await writeAmm({ functionName: "sell", args: [marketId, outcomeIdx, amountWei, outcomeIn] });
      notification.success(`Sell ${outcomeLabels[outcomeIdx]} → ${amountStr} TAB`);
      setAmountStr("");
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  return (
    <details className="collapse collapse-arrow bg-base-200 mb-2" open>
      <summary className="collapse-title font-semibold">🔄 Trade (AMM)</summary>
      <div className="collapse-content space-y-2">
        {!poolExists && (
          <div className="alert alert-info text-sm py-2">
            Žádný AMM pool. Použij níže „Liquidity (AMM) → Create pool".
          </div>
        )}
        <div role="tablist" className="tabs tabs-boxed w-fit">
          <button
            role="tab"
            className={`tab tab-sm ${mode === "buy" ? "tab-active" : ""}`}
            onClick={() => setMode("buy")}
          >
            Buy
          </button>
          <button
            role="tab"
            className={`tab tab-sm ${mode === "sell" ? "tab-active" : ""}`}
            onClick={() => setMode("sell")}
          >
            Sell
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="select select-bordered select-sm"
            value={outcomeIdx}
            onChange={e => setOutcomeIdx(Number(e.target.value))}
          >
            {Array.from({ length: N }, (_, i) => (
              <option key={i} value={i}>
                {outcomeLabels[i] ?? `slot ${i}`}
              </option>
            ))}
          </select>
          <input
            className="input input-bordered input-sm"
            placeholder={mode === "buy" ? "TAB to spend" : "TAB to receive"}
            value={amountStr}
            onChange={e => setAmountStr(e.target.value)}
          />
        </div>
        {poolExists && Array.isArray(quote) && (
          <div className="text-xs opacity-80">
            {mode === "buy" ? (
              <>
                → receive ~ <b>{Number(formatEther((quote as readonly bigint[])[0])).toFixed(4)}</b>{" "}
                {outcomeLabels[outcomeIdx]} · fee{" "}
                {Number(formatEther((quote as readonly bigint[])[1])).toFixed(4)} TAB
              </>
            ) : (
              <>
                → send ~ <b>{Number(formatEther((quote as readonly bigint[])[0])).toFixed(4)}</b>{" "}
                {outcomeLabels[outcomeIdx]} · fee{" "}
                {Number(formatEther((quote as readonly bigint[])[1])).toFixed(4)} TAB
              </>
            )}
          </div>
        )}
        <button
          className={`btn btn-sm ${mode === "buy" ? "btn-primary" : "btn-warning"}`}
          onClick={mode === "buy" ? onBuy : onSell}
          disabled={disabled || !poolExists}
        >
          {mode === "buy" ? "Approve & Buy" : "Approve & Sell"} {outcomeLabels[outcomeIdx]}
        </button>
      </div>
    </details>
  );
};

const AmmLiquidityPanel = ({
  marketId,
  outcomeSlotCount,
  resolved,
  canceled,
  paused,
  connected,
}: {
  marketId: bigint;
  outcomeSlotCount: bigint;
  resolved: boolean;
  canceled: boolean;
  paused: boolean;
  connected?: AddressType;
}) => {
  const N = Number(outcomeSlotCount);
  const [createFunding, setCreateFunding] = useState("1000");
  const [createFeePct, setCreateFeePct] = useState("2");
  const [addAmount, setAddAmount] = useState("");
  const [removeShares, setRemoveShares] = useState("");
  const disabled = resolved || canceled || paused;

  const { data: reserves } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getReserves",
    args: [marketId],
  });
  const { data: shares } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getShares",
    args: [marketId, connected ?? zeroAddress],
  });
  const { data: pendingFees } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "pendingFeesOf",
    args: [marketId, connected ?? zeroAddress],
  });
  const poolExists = Array.isArray(reserves) && reserves.length === N;

  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writeAmm } = useScaffoldWriteContract({ contractName: "PredictionAMM" });

  const onCreatePool = async () => {
    try {
      const funding = parseEther(createFunding);
      const feePct = Number(createFeePct);
      if (!Number.isFinite(feePct) || feePct < 0 || feePct > 5) {
        return notification.error("Fee musí být 0–5 %");
      }
      const feeBps = Math.round(feePct * 100);
      await writeTab({ functionName: "approve", args: [AMM_ADDR, funding] });
      await writeAmm({ functionName: "createPool", args: [marketId, funding, feeBps] });
      notification.success(`Pool: ${createFunding} TAB · ${feePct}% (${feeBps} bps)`);
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  const onAddFunding = async () => {
    if (!addAmount) return notification.error("Zadej částku v TAB");
    try {
      const amount = parseEther(addAmount);
      await writeTab({ functionName: "approve", args: [AMM_ADDR, amount] });
      await writeAmm({ functionName: "addFunding", args: [marketId, amount, 0n] });
      notification.success(`Added ${addAmount} TAB`);
      setAddAmount("");
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  const onRemoveFunding = async () => {
    if (!removeShares) return notification.error("Zadej kolik shares burnout");
    try {
      const sharesIn = parseEther(removeShares);
      const minOut = Array.from({ length: N }, () => 0n);
      await writeAmm({ functionName: "removeFunding", args: [marketId, sharesIn, minOut, 0n] });
      notification.success(`Removed ${removeShares} shares`);
      setRemoveShares("");
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  const userShares = Array.isArray(shares) ? (shares as readonly bigint[])[0] : 0n;
  const totalShares = Array.isArray(shares) ? (shares as readonly bigint[])[1] : 0n;
  const sharePct = totalShares > 0n ? Number((userShares * 10000n) / totalShares) / 100 : 0;

  return (
    <details className="collapse collapse-arrow bg-base-200 mb-2">
      <summary className="collapse-title font-semibold">🌊 Liquidity (AMM)</summary>
      <div className="collapse-content space-y-3">
        {!poolExists ? (
          <>
            <p className="text-sm opacity-70">
              Pool ještě neexistuje. Vytvoř ho jako první LP — funding se rozdělí 50/50 přes všechny outcome sloty.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control">
                <span className="label-text text-xs opacity-70 mb-1">Initial funding (TAB)</span>
                <input
                  className="input input-bordered input-sm"
                  inputMode="decimal"
                  placeholder="e.g. 1000"
                  value={createFunding}
                  onChange={e => setCreateFunding(e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs opacity-70 mb-1">Trading fee (%, max 5)</span>
                <input
                  className="input input-bordered input-sm"
                  inputMode="decimal"
                  placeholder="e.g. 2"
                  value={createFeePct}
                  onChange={e => setCreateFeePct(e.target.value)}
                />
              </label>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onCreatePool} disabled={disabled}>
              Approve & Create pool
            </button>
          </>
        ) : (
          <>
            <div className="text-xs opacity-80 space-y-0.5">
              <div>
                Reserves:{" "}
                {(reserves as bigint[]).map(r => Number(formatEther(r)).toFixed(2)).join(" / ")} TAB-units
              </div>
              <div>Total shares: {Number(formatEther(totalShares)).toFixed(2)}</div>
              <div>
                Your shares: {Number(formatEther(userShares)).toFixed(2)} ({sharePct.toFixed(2)}%)
              </div>
              <div>Pending fees: {Number(formatEther((pendingFees as bigint) ?? 0n)).toFixed(4)} TAB</div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold">Add liquidity</p>
                <span className="label-text text-xs opacity-70">Amount (TAB)</span>
                <input
                  className="input input-bordered input-sm w-full"
                  inputMode="decimal"
                  placeholder="e.g. 500"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                />
                <button className="btn btn-secondary btn-sm" onClick={onAddFunding} disabled={disabled}>
                  Approve & Add
                </button>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">Remove liquidity</p>
                <span className="label-text text-xs opacity-70">Shares to burn</span>
                <input
                  className="input input-bordered input-sm w-full"
                  inputMode="decimal"
                  placeholder="e.g. 100"
                  value={removeShares}
                  onChange={e => setRemoveShares(e.target.value)}
                />
                <button className="btn btn-warning btn-sm" onClick={onRemoveFunding}>
                  Remove
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </details>
  );
};
