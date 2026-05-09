"use client";

import { useEffect, useMemo, useState } from "react";
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
// PredictionAMM is optional — only present if 09_deploy_prediction_amm.ts ran.
const AMM_ADDR =
  ("PredictionAMM" in deployedContracts[CHAIN_ID]
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((deployedContracts[CHAIN_ID] as any).PredictionAMM.address as AddressType)
    : undefined);

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
          bondAvailable={!bondClaimed && !bondSlashed && bondAmount > 0n}
        />

        {AMM_ADDR && (
          <AmmPanel
            marketId={marketId}
            outcomeLabels={outcomeLabels}
            connected={connected}
            resolved={resolved}
            canceled={canceled}
          />
        )}
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
  bondAvailable,
}: {
  marketId: bigint;
  conditionId: `0x${string}`;
  outcomeSlotCount: bigint;
  outcomeLabels: string[];
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

/* ────────────────────────────────────────────────────────────────────────
   AMM Panel — buy / sell / LP via PredictionAMM (multi-outcome FPMM)
   ──────────────────────────────────────────────────────────────────────── */

type AmmPoolView = {
  exists: boolean;
  outcomeSlotCount: number;
  feeBps: number;
  conditionId: `0x${string}`;
  totalShares: bigint;
  feeAccumulated: bigint;
  reserves: readonly bigint[];
  wrappers: readonly AddressType[];
};

const erc20MinAbi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const tryParseEther = (v: string): bigint | null => {
  if (!v.trim()) return null;
  try {
    return parseEther(v);
  } catch {
    return null;
  }
};

const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const AmmPanel = ({
  marketId,
  outcomeLabels,
  connected,
  resolved,
  canceled,
}: {
  marketId: bigint;
  outcomeLabels: string[];
  connected?: AddressType;
  resolved: boolean;
  canceled: boolean;
}) => {
  const { data: poolData, refetch: refetchPool } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getPool",
    args: [marketId],
  });
  const pool = poolData as unknown as AmmPoolView | undefined;
  const poolExists = !!pool?.exists;
  const tradingDisabled = resolved || canceled;

  if (!AMM_ADDR) return null;

  const summary = poolExists
    ? `🏊 AMM Pool · ${formatEther(pool!.totalShares)} shares · ${(Number(pool!.feeBps) / 100).toFixed(2)}% fee`
    : "🏊 AMM Pool (not created)";

  return (
    <details className="collapse collapse-arrow bg-base-300 mt-3 border border-base-content/10">
      <summary className="collapse-title font-semibold text-sm">{summary}</summary>
      <div className="collapse-content space-y-3 text-sm">
        {!poolExists ? (
          <CreatePoolForm
            marketId={marketId}
            connected={connected}
            disabled={tradingDisabled}
            onDone={() => refetchPool()}
          />
        ) : (
          <PoolOperations
            marketId={marketId}
            outcomeLabels={outcomeLabels}
            connected={connected}
            tradingDisabled={tradingDisabled}
            pool={pool!}
            refetchPool={() => refetchPool()}
          />
        )}
      </div>
    </details>
  );
};

const CreatePoolForm = ({
  marketId,
  connected,
  disabled,
  onDone,
}: {
  marketId: bigint;
  connected?: AddressType;
  disabled: boolean;
  onDone: () => void;
}) => {
  const [funding, setFunding] = useState("100");
  const [feeBps, setFeeBps] = useState("100");
  const [busy, setBusy] = useState(false);

  const { data: allowance, refetch: refetchAllow } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "allowance",
    args: [connected, AMM_ADDR],
  });
  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writeAmm } = useScaffoldWriteContract({ contractName: "PredictionAMM" });

  const onCreate = async () => {
    if (!connected) return notification.error("Connect wallet first");
    if (disabled) return notification.error("Market resolved or canceled");
    const amount = tryParseEther(funding);
    if (!amount || amount === 0n) return notification.error("Funding > 0 TAB");
    const fee = Number(feeBps);
    if (!Number.isFinite(fee) || fee < 0 || fee > 500) return notification.error("Fee 0–500 bps");

    setBusy(true);
    try {
      const cur = (allowance ?? 0n) as bigint;
      if (cur < amount) {
        await writeTab({ functionName: "approve", args: [AMM_ADDR, amount] });
        await refetchAllow();
      }
      await writeAmm({ functionName: "createPool", args: [marketId, amount, fee] });
      notification.success(`Pool created: ${funding} TAB at ${(fee / 100).toFixed(2)}% fee`);
      onDone();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="opacity-70 text-xs">
        Pool ještě neexistuje. Vytvoř ho s počáteční likviditou — všechny outcomes začnou se stejnou cenou.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label label-text text-xs py-1">Initial funding (TAB)</label>
          <input
            className="input input-bordered input-sm w-full"
            value={funding}
            onChange={e => setFunding(e.target.value)}
          />
        </div>
        <div>
          <label className="label label-text text-xs py-1">Fee bps (0–500)</label>
          <input
            className="input input-bordered input-sm w-full"
            type="number"
            min={0}
            max={500}
            value={feeBps}
            onChange={e => setFeeBps(e.target.value)}
          />
        </div>
      </div>
      <button
        className="btn btn-primary btn-sm"
        onClick={onCreate}
        disabled={!connected || disabled || busy}
      >
        {busy ? "Creating…" : "Approve & Create Pool"}
      </button>
    </div>
  );
};

const PoolOperations = ({
  marketId,
  outcomeLabels,
  connected,
  tradingDisabled,
  pool,
  refetchPool,
}: {
  marketId: bigint;
  outcomeLabels: string[];
  connected?: AddressType;
  tradingDisabled: boolean;
  pool: AmmPoolView;
  refetchPool: () => void;
}) => {
  const N = outcomeLabels.length;
  const reservesSum = pool.reserves.reduce((a, b) => a + b, 0n);

  // Spot price per outcome: P_i = (Σ R_j for j≠i) / Σ R_j  (in 1e-4 precision via bigint)
  const spotPrices = pool.reserves.map((_, i) => {
    if (reservesSum === 0n) return 0;
    const sumOther = reservesSum - pool.reserves[i];
    return Number((sumOther * 100000n) / reservesSum) / 100000;
  });

  return (
    <>
      <div className="bg-base-200 rounded p-2 text-xs space-y-1">
        <div className="font-semibold">Pool stats</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <div>Total LP shares: {formatEther(pool.totalShares)}</div>
          <div>Accrued fees: {formatEther(pool.feeAccumulated)} TAB</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-1">
          {outcomeLabels.map((label, i) => (
            <div key={i} className="flex justify-between border-b border-base-content/5 py-0.5">
              <span>
                <span className="badge badge-sm badge-outline mr-1">{i}</span>
                {label}
              </span>
              <span className="text-right">
                <span className="opacity-70">{formatEther(pool.reserves[i])}</span>
                {" · "}
                <span className="font-semibold">{formatPct(spotPrices[i])}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <BuySection
        marketId={marketId}
        outcomeLabels={outcomeLabels}
        connected={connected}
        disabled={tradingDisabled}
        refetchPool={refetchPool}
      />
      <SellSection
        marketId={marketId}
        outcomeLabels={outcomeLabels}
        connected={connected}
        disabled={tradingDisabled}
        wrappers={pool.wrappers}
        refetchPool={refetchPool}
      />
      <LpSection
        marketId={marketId}
        outcomeLabels={outcomeLabels}
        connected={connected}
        disabled={tradingDisabled}
        refetchPool={refetchPool}
      />
    </>
  );
};

const BuySection = ({
  marketId,
  outcomeLabels,
  connected,
  disabled,
  refetchPool,
}: {
  marketId: bigint;
  outcomeLabels: string[];
  connected?: AddressType;
  disabled: boolean;
  refetchPool: () => void;
}) => {
  const [outcomeIdx, setOutcomeIdx] = useState(0);
  const [amount, setAmount] = useState("10");
  const [slippagePct, setSlippagePct] = useState("1");
  const [busy, setBusy] = useState(false);

  const parsedAmount = tryParseEther(amount);
  const { data: quote } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "calcBuyAmount",
    args: parsedAmount && parsedAmount > 0n ? [marketId, outcomeIdx, parsedAmount] : undefined,
  });
  const [outcomeOut, feeAmount] = (quote ?? [0n, 0n]) as readonly [bigint, bigint];

  const slippageBps = Math.floor((Number(slippagePct) || 0) * 100);
  const minOut = (outcomeOut * BigInt(10_000 - slippageBps)) / 10_000n;

  const { data: allowance, refetch: refetchAllow } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "allowance",
    args: [connected, AMM_ADDR],
  });
  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writeAmm } = useScaffoldWriteContract({ contractName: "PredictionAMM" });

  const onBuy = async () => {
    if (!connected) return notification.error("Connect wallet first");
    if (!parsedAmount || parsedAmount === 0n) return notification.error("Bad amount");
    setBusy(true);
    try {
      const cur = (allowance ?? 0n) as bigint;
      if (cur < parsedAmount) {
        await writeTab({ functionName: "approve", args: [AMM_ADDR, parsedAmount] });
        await refetchAllow();
      }
      await writeAmm({
        functionName: "buy",
        args: [marketId, outcomeIdx, parsedAmount, minOut],
      });
      notification.success(`Bought ${formatEther(outcomeOut)} of "${outcomeLabels[outcomeIdx]}"`);
      refetchPool();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="collapse collapse-arrow bg-base-200">
      <summary className="collapse-title font-semibold text-sm">🛒 Buy outcome (TAB → wrapped position)</summary>
      <div className="collapse-content space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-1">
            <label className="label label-text text-xs py-1">Outcome</label>
            <select
              className="select select-bordered select-sm w-full"
              value={outcomeIdx}
              onChange={e => setOutcomeIdx(Number(e.target.value))}
            >
              {outcomeLabels.map((l, i) => (
                <option key={i} value={i}>
                  {i}: {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label label-text text-xs py-1">Amount (TAB)</label>
            <input
              className="input input-bordered input-sm w-full"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label label-text text-xs py-1">Slippage (%)</label>
            <input
              className="input input-bordered input-sm w-full"
              type="number"
              step="0.1"
              value={slippagePct}
              onChange={e => setSlippagePct(e.target.value)}
            />
          </div>
        </div>
        <div className="text-xs opacity-70">
          Quote: <span className="font-mono">{formatEther(outcomeOut)}</span> &quot;{outcomeLabels[outcomeIdx]}&quot;
          {" · fee "}
          <span className="font-mono">{formatEther(feeAmount)}</span> TAB
          {" · min out "}
          <span className="font-mono">{formatEther(minOut)}</span>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={onBuy}
          disabled={busy || disabled || !connected || !parsedAmount}
        >
          {busy ? "Buying…" : "Approve & Buy"}
        </button>
      </div>
    </details>
  );
};

const SellSection = ({
  marketId,
  outcomeLabels,
  connected,
  disabled,
  wrappers,
  refetchPool,
}: {
  marketId: bigint;
  outcomeLabels: string[];
  connected?: AddressType;
  disabled: boolean;
  wrappers: readonly AddressType[];
  refetchPool: () => void;
}) => {
  const [outcomeIdx, setOutcomeIdx] = useState(0);
  const [returnTab, setReturnTab] = useState("5");
  const [slippagePct, setSlippagePct] = useState("1");
  const [busy, setBusy] = useState(false);

  const parsedReturn = tryParseEther(returnTab);
  const { data: quote } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "calcSellAmount",
    args: parsedReturn && parsedReturn > 0n ? [marketId, outcomeIdx, parsedReturn] : undefined,
  });
  const [outcomeIn, feeAmount] = (quote ?? [0n, 0n]) as readonly [bigint, bigint];

  const slippageBps = Math.floor((Number(slippagePct) || 0) * 100);
  const maxIn = (outcomeIn * BigInt(10_000 + slippageBps)) / 10_000n;

  // Wrapper allowance / approve via raw wagmi (wrapper address is dynamic).
  const wrapperAddr = wrappers[outcomeIdx];

  const onSell = async () => {
    if (!connected) return notification.error("Connect wallet first");
    if (!parsedReturn || parsedReturn === 0n) return notification.error("Bad amount");
    if (!wrapperAddr) return notification.error("Wrapper missing");
    setBusy(true);
    try {
      const client = getPublicClient(wagmiConfig);
      // Read current allowance against AMM
      let cur = 0n;
      if (client) {
        const data = encodeFunctionData({
          abi: erc20MinAbi,
          functionName: "allowance",
          args: [connected, AMM_ADDR!],
        });
        const ret = await client.call({ to: wrapperAddr, data });
        if (ret.data) {
          cur = decodeFunctionResult({
            abi: erc20MinAbi,
            functionName: "allowance",
            data: ret.data,
          }) as bigint;
        }
      }
      if (cur < maxIn) {
        await wagmiWriteContract(wagmiConfig, {
          address: wrapperAddr,
          abi: erc20MinAbi,
          functionName: "approve",
          args: [AMM_ADDR!, maxIn],
        });
      }
      await wagmiWriteContract(wagmiConfig, {
        address: AMM_ADDR!,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: (deployedContracts[CHAIN_ID] as any).PredictionAMM.abi,
        functionName: "sell",
        args: [marketId, outcomeIdx, parsedReturn, maxIn],
      });
      notification.success(`Sold ~${formatEther(outcomeIn)} of "${outcomeLabels[outcomeIdx]}" for ${returnTab} TAB`);
      refetchPool();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="collapse collapse-arrow bg-base-200">
      <summary className="collapse-title font-semibold text-sm">💸 Sell outcome (wrapped position → TAB)</summary>
      <div className="collapse-content space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-1">
            <label className="label label-text text-xs py-1">Outcome</label>
            <select
              className="select select-bordered select-sm w-full"
              value={outcomeIdx}
              onChange={e => setOutcomeIdx(Number(e.target.value))}
            >
              {outcomeLabels.map((l, i) => (
                <option key={i} value={i}>
                  {i}: {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label label-text text-xs py-1">Want back (TAB)</label>
            <input
              className="input input-bordered input-sm w-full"
              value={returnTab}
              onChange={e => setReturnTab(e.target.value)}
            />
          </div>
          <div>
            <label className="label label-text text-xs py-1">Slippage (%)</label>
            <input
              className="input input-bordered input-sm w-full"
              type="number"
              step="0.1"
              value={slippagePct}
              onChange={e => setSlippagePct(e.target.value)}
            />
          </div>
        </div>
        <div className="text-xs opacity-70">
          Need to send: <span className="font-mono">{formatEther(outcomeIn)}</span>{" "}
          &quot;{outcomeLabels[outcomeIdx]}&quot;
          {" · fee "}
          <span className="font-mono">{formatEther(feeAmount)}</span> TAB
          {" · max in "}
          <span className="font-mono">{formatEther(maxIn)}</span>
        </div>
        <button
          className="btn btn-warning btn-sm"
          onClick={onSell}
          disabled={busy || disabled || !connected || !parsedReturn}
        >
          {busy ? "Selling…" : "Approve & Sell"}
        </button>
      </div>
    </details>
  );
};

const LpSection = ({
  marketId,
  outcomeLabels,
  connected,
  disabled,
  refetchPool,
}: {
  marketId: bigint;
  outcomeLabels: string[];
  connected?: AddressType;
  disabled: boolean;
  refetchPool: () => void;
}) => {
  const N = outcomeLabels.length;
  const [addAmount, setAddAmount] = useState("10");
  const [removeShares, setRemoveShares] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: shareData, refetch: refetchShares } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "getShares",
    args: [marketId, connected],
  });
  const [userShares, totalShares] = (shareData ?? [0n, 0n]) as readonly [bigint, bigint];

  const { data: pendingFees, refetch: refetchPending } = useScaffoldReadContract({
    contractName: "PredictionAMM",
    functionName: "pendingFeesOf",
    args: [marketId, connected],
  });

  // Auto-fill remove field with user's full shares once available
  useEffect(() => {
    if (!removeShares && userShares > 0n) {
      setRemoveShares(formatEther(userShares));
    }
  }, [userShares, removeShares]);

  const { data: allowance, refetch: refetchAllow } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "allowance",
    args: [connected, AMM_ADDR],
  });
  const { writeContractAsync: writeTab } = useScaffoldWriteContract({ contractName: "TABcoin" });
  const { writeContractAsync: writeAmm } = useScaffoldWriteContract({ contractName: "PredictionAMM" });

  const onAdd = async () => {
    if (!connected) return notification.error("Connect wallet first");
    const amount = tryParseEther(addAmount);
    if (!amount || amount === 0n) return notification.error("Bad amount");
    setBusy(true);
    try {
      const cur = (allowance ?? 0n) as bigint;
      if (cur < amount) {
        await writeTab({ functionName: "approve", args: [AMM_ADDR, amount] });
        await refetchAllow();
      }
      await writeAmm({
        functionName: "addFunding",
        args: [marketId, amount, 0n], // accept any shares (no slippage check for simplicity)
      });
      notification.success(`Added ${addAmount} TAB liquidity`);
      refetchPool();
      refetchShares();
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!connected) return notification.error("Connect wallet first");
    const shares = tryParseEther(removeShares);
    if (!shares || shares === 0n) return notification.error("Bad shares");
    if (shares > userShares) return notification.error("Insufficient shares");
    setBusy(true);
    try {
      await writeAmm({
        functionName: "removeFunding",
        args: [marketId, shares, Array(N).fill(0n), 0n], // accept any out
      });
      notification.success(`Removed ${removeShares} shares`);
      refetchPool();
      refetchShares();
      refetchPending();
      setRemoveShares("");
    } catch (e: unknown) {
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="collapse collapse-arrow bg-base-200">
      <summary className="collapse-title font-semibold text-sm">
        🏦 Liquidity ·{" "}
        <span className="font-mono opacity-70">
          {formatEther(userShares)} / {formatEther(totalShares)}
        </span>
        {(pendingFees as bigint | undefined) !== undefined && (pendingFees as bigint) > 0n && (
          <span className="badge badge-success badge-sm ml-1">
            +{formatEther(pendingFees as bigint)} fees
          </span>
        )}
      </summary>
      <div className="collapse-content space-y-3">
        <div>
          <label className="label label-text text-xs py-1">Add liquidity (TAB)</label>
          <div className="flex gap-2">
            <input
              className="input input-bordered input-sm flex-1"
              value={addAmount}
              onChange={e => setAddAmount(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={onAdd}
              disabled={busy || disabled || !connected}
            >
              Add
            </button>
          </div>
          <p className="text-xs opacity-60 mt-1">Drží stávající cenu, zbytek wrapperu rare strany se vrátí.</p>
        </div>
        <div>
          <label className="label label-text text-xs py-1">Remove liquidity (shares)</label>
          <div className="flex gap-2">
            <input
              className="input input-bordered input-sm flex-1"
              value={removeShares}
              onChange={e => setRemoveShares(e.target.value)}
              placeholder={formatEther(userShares)}
            />
            <button
              className="btn btn-warning btn-sm"
              onClick={onRemove}
              disabled={busy || !connected || userShares === 0n}
            >
              Remove
            </button>
          </div>
          <p className="text-xs opacity-60 mt-1">
            Burn shares pro pro-rata reserves + slice fees. Povoleno i post-resolution.
          </p>
        </div>
      </div>
    </details>
  );
};
