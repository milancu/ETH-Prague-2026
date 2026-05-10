import { parseEther } from "viem"

// ── Addresses ────────────────────────────────────────────────────────────────
// Read from env vars (set by `yarn deploy` via generateWebEnv.ts for local,
// or hardcoded Base Sepolia fallbacks for production / devs without local node).

function addr(key: string, fallback: string): `0x${string}` {
  return ((import.meta.env[key] as string | undefined) ?? fallback) as `0x${string}`
}

export const PREDICTION_MARKET_ADDRESS = addr(
  "VITE_PREDICTION_MARKET_ADDRESS",
  "0x64f7F7f1E89C8a059276CC6dfF7A965720D94e50",
)

export const TABCOIN_ADDRESS = addr(
  "VITE_TABCOIN_ADDRESS",
  "0xe987bdb99fE70af574D4d9eeA5A7700fe29feB16",
)

export const CONDITIONAL_TOKENS_ADDRESS = addr(
  "VITE_CONDITIONAL_TOKENS_ADDRESS",
  "0x912c5a72B5a024Ff88987B19632D670185c5A65e",
)

export const TABCLOB_ADDRESS = addr(
  "VITE_TABCLOB_ADDRESS",
  "0x6f62254A1850b50A3ACc287e3dda0f0e53F1C961",
)

export const POSITION_WRAPPER_FACTORY_ADDRESS = addr(
  "VITE_POSITION_WRAPPER_FACTORY_ADDRESS",
  "0x5F57977678EE0B53Ca91adeF98D9C6D315C5ab81",
)

export const PREDICTION_AMM_ADDRESS = addr(
  "VITE_PREDICTION_AMM_ADDRESS",
  "0xf3916455D945731183De9ed26a6b7D5A835f9A2A",
)

// Set VITE_DEFAULT_ORACLE in .env.local (local: auto-written by deploy script via ORACLE_ADDRESS).
// For Sepolia/mainnet: set it in your deployment environment (Vercel env vars etc.).
// Never leave this unset in production — use a wallet you control or a Gnosis Safe.
const _oracle = import.meta.env.VITE_DEFAULT_ORACLE as string | undefined
if (!_oracle && import.meta.env.PROD) {
  console.error("[contracts] VITE_DEFAULT_ORACLE is not set. Markets cannot be created or resolved.")
}
export const DEFAULT_ORACLE = (_oracle ?? "0x92e30b6A54911a3385Bcd69F2dEc998A13ef692f") as `0x${string}`

export const DEFAULT_BOND = parseEther("50")

// ── Outcome type enum (mirrors PredictionMarketV2.OutcomeType) ────────────────

export const OUTCOME_TYPE = {
  binary: 0,
  multi: 1,
  scalar: 2,
} as const

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

export const PREDICTION_MARKET_ABI = [
  {
    name: "createMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name",             type: "string"   },
          { name: "description",      type: "string"   },
          { name: "category",         type: "string"   },
          { name: "outcomeType",      type: "uint8"    },
          { name: "outcomeSlotCount", type: "uint256"  },
          { name: "outcomeLabels",    type: "string[]" },
          { name: "oracle",           type: "address"  },
          { name: "expiresAt",        type: "uint256"  },
          { name: "resolutionTime",   type: "uint256"  },
        ],
      },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
  },
  {
    name: "splitTo",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",  type: "uint256"   },
      { name: "partition", type: "uint256[]" },
      { name: "amount",    type: "uint256"   },
    ],
    outputs: [],
  },
  {
    name: "mergeFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",  type: "uint256"   },
      { name: "partition", type: "uint256[]" },
      { name: "amount",    type: "uint256"   },
    ],
    outputs: [],
  },
  {
    name: "splitAndWrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",      type: "uint256"   },
      { name: "amount",        type: "uint256"   },
      { name: "wrapIndexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "claimWinnings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",  type: "uint256"   },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "resolveMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256"   },
      { name: "payouts",  type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "markets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "creator",          type: "address" },
      { name: "oracle",           type: "address" },
      { name: "questionId",       type: "bytes32" },
      { name: "conditionId",      type: "bytes32" },
      { name: "outcomeSlotCount", type: "uint256" },
      { name: "outcomeType",      type: "uint8"   },
      { name: "name",             type: "string"  },
      { name: "description",      type: "string"  },
      { name: "category",         type: "string"  },
      { name: "createdAt",        type: "uint256" },
      { name: "expiresAt",        type: "uint256" },
      { name: "resolutionTime",   type: "uint256" },
      { name: "bondAmount",       type: "uint256" },
      { name: "lockedCollateral", type: "uint256" },
      { name: "bondClaimed",      type: "bool"    },
      { name: "bondSlashed",      type: "bool"    },
      { name: "verified",         type: "bool"    },
      { name: "canceled",         type: "bool"    },
      { name: "resolved",         type: "bool"    },
      { name: "paused",           type: "bool"    },
    ],
  },
  {
    name: "MarketCreated",
    type: "event",
    inputs: [
      { name: "marketId",         type: "uint256", indexed: true  },
      { name: "creator",          type: "address", indexed: true  },
      { name: "conditionId",      type: "bytes32", indexed: true  },
      { name: "outcomeType",      type: "uint8",   indexed: false },
      { name: "outcomeSlotCount", type: "uint256", indexed: false },
      { name: "expiresAt",        type: "uint256", indexed: false },
      { name: "bondAmount",       type: "uint256", indexed: false },
    ],
  },
  // Custom errors — keep in sync with PredictionMarketV2.sol so viem can
  // decode revert reasons in pre-flight simulations.
  { type: "error", name: "ZeroAddress",            inputs: [] },
  { type: "error", name: "ExpiresInPast",          inputs: [] },
  { type: "error", name: "ResolutionBeforeExpiry", inputs: [] },
  { type: "error", name: "EmptyName",              inputs: [] },
  {
    type: "error",
    name: "OutcomeLabelsLengthMismatch",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "got",      type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "EmptyOutcomeLabel",
    inputs: [{ name: "index", type: "uint256" }],
  },
  {
    type: "error",
    name: "BadOutcomeShape",
    inputs: [
      { name: "t",     type: "uint8"   },
      { name: "slots", type: "uint256" },
    ],
  },
  { type: "error", name: "MarketBadState",     inputs: [] },
  { type: "error", name: "NotAuthorized",      inputs: [] },
  { type: "error", name: "MarketNotResolved",  inputs: [] },
  { type: "error", name: "MarketIsCanceled",   inputs: [] },
  { type: "error", name: "MarketAlreadyPaused", inputs: [] },
  {
    type: "error",
    name: "MarketNotFound",
    inputs: [{ name: "marketId", type: "uint256" }],
  },
] as const

export const CONDITIONAL_TOKENS_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id",      type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool"    },
    ],
    outputs: [],
  },
  {
    name: "isApprovedForAll",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account",  type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "payoutNumerators",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "conditionId", type: "bytes32" },
      { name: "index",       type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "payoutDenominator",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "conditionId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

const ORDER_COMPONENTS = [
  { name: "maker",       type: "address" },
  { name: "taker",       type: "address" },
  { name: "makerToken",  type: "address" },
  { name: "takerToken",  type: "address" },
  { name: "makerAmount", type: "uint128" },
  { name: "takerAmount", type: "uint128" },
  { name: "expiry",      type: "uint64"  },
  { name: "salt",        type: "uint256" },
  { name: "marketId",    type: "uint256" },
] as const

export const TABCLOB_ABI = [
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "o", type: "tuple", components: ORDER_COMPONENTS }],
    outputs: [],
  },
  {
    name: "fill",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "o",               type: "tuple", components: ORDER_COMPONENTS },
      { name: "fillMakerAmount", type: "uint128" },
      { name: "signature",       type: "bytes"   },
    ],
    outputs: [],
  },
  {
    name: "filledMakerAmount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    name: "hashOrder",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "o", type: "tuple", components: ORDER_COMPONENTS }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const

export const POSITION_WRAPPER_ABI = [
  {
    name: "indexSet",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "wrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "unwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const

export const FACTORY_ABI = [
  {
    name: "getWrapper",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "collateral",  type: "address" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSet",    type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getOrCreateWrapper",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateral",  type: "address" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSet",    type: "uint256" },
    ],
    outputs: [{ name: "w", type: "address" }],
  },
] as const

export const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

export const PREDICTION_AMM_ABI = [
  {
    name: "createPool",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",       type: "uint256" },
      { name: "initialFunding", type: "uint256" },
      { name: "feeBps",         type: "uint16"  },
    ],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    name: "addFunding",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",     type: "uint256" },
      { name: "amount",       type: "uint256" },
      { name: "minSharesOut", type: "uint256" },
    ],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    name: "removeFunding",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",      type: "uint256"   },
      { name: "sharesIn",      type: "uint256"   },
      { name: "minOutcomeOut", type: "uint256[]" },
      { name: "minFeeOut",     type: "uint256"   },
    ],
    outputs: [
      { name: "outcomeOut", type: "uint256[]" },
      { name: "feeOut",     type: "uint256"   },
    ],
  },
  {
    name: "buy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",         type: "uint256" },
      { name: "outcomeIndex",     type: "uint8"   },
      { name: "investmentAmount", type: "uint256" },
      { name: "minOutcomeOut",    type: "uint256" },
    ],
    outputs: [{ name: "outcomeOut", type: "uint256" }],
  },
  {
    name: "sell",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",     type: "uint256" },
      { name: "outcomeIndex", type: "uint8"   },
      { name: "returnAmount", type: "uint256" },
      { name: "maxOutcomeIn", type: "uint256" },
    ],
    outputs: [{ name: "outcomeIn", type: "uint256" }],
  },
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getWrappers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getShares",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user",     type: "address" },
    ],
    outputs: [
      { name: "shares",      type: "uint256" },
      { name: "totalShares", type: "uint256" },
    ],
  },
  {
    name: "pendingFeesOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user",     type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "calcBuyAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId",         type: "uint256" },
      { name: "outcomeIndex",     type: "uint8"   },
      { name: "investmentAmount", type: "uint256" },
    ],
    outputs: [
      { name: "outcomeOut", type: "uint256" },
      { name: "feeAmount",  type: "uint256" },
    ],
  },
  {
    name: "calcSellAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "marketId",     type: "uint256" },
      { name: "outcomeIndex", type: "uint8"   },
      { name: "returnAmount", type: "uint256" },
    ],
    outputs: [
      { name: "outcomeIn", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
    ],
  },
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "exists",           type: "bool"      },
          { name: "outcomeSlotCount", type: "uint8"     },
          { name: "feeBps",           type: "uint16"    },
          { name: "conditionId",      type: "bytes32"   },
          { name: "totalShares",      type: "uint256"   },
          { name: "feeAccumulated",   type: "uint256"   },
          { name: "reserves",         type: "uint256[]" },
          { name: "wrappers",         type: "address[]" },
        ],
      },
    ],
  },
  {
    name: "PoolCreated",
    type: "event",
    inputs: [
      { name: "marketId",         type: "uint256", indexed: true  },
      { name: "creator",          type: "address", indexed: true  },
      { name: "feeBps",           type: "uint16",  indexed: false },
      { name: "initialFunding",   type: "uint256", indexed: false },
      { name: "outcomeSlotCount", type: "uint8",   indexed: false },
    ],
  },
  {
    name: "FundingAdded",
    type: "event",
    inputs: [
      { name: "marketId",      type: "uint256",   indexed: true  },
      { name: "funder",        type: "address",   indexed: true  },
      { name: "amountIn",      type: "uint256",   indexed: false },
      { name: "sharesMinted",  type: "uint256",   indexed: false },
      { name: "reservesAfter", type: "uint256[]", indexed: false },
    ],
  },
  {
    name: "FundingRemoved",
    type: "event",
    inputs: [
      { name: "marketId",     type: "uint256",   indexed: true  },
      { name: "funder",       type: "address",   indexed: true  },
      { name: "sharesBurned", type: "uint256",   indexed: false },
      { name: "outcomeOut",   type: "uint256[]", indexed: false },
      { name: "feeOut",       type: "uint256",   indexed: false },
    ],
  },
  {
    name: "Bought",
    type: "event",
    inputs: [
      { name: "marketId",         type: "uint256", indexed: true  },
      { name: "buyer",            type: "address", indexed: true  },
      { name: "outcomeIndex",     type: "uint8",   indexed: false },
      { name: "investmentAmount", type: "uint256", indexed: false },
      { name: "feeAmount",        type: "uint256", indexed: false },
      { name: "outcomeOut",       type: "uint256", indexed: false },
    ],
  },
  {
    name: "Sold",
    type: "event",
    inputs: [
      { name: "marketId",     type: "uint256", indexed: true  },
      { name: "seller",       type: "address", indexed: true  },
      { name: "outcomeIndex", type: "uint8",   indexed: false },
      { name: "returnAmount", type: "uint256", indexed: false },
      { name: "feeAmount",    type: "uint256", indexed: false },
      { name: "outcomeIn",    type: "uint256", indexed: false },
    ],
  },
] as const

export const TABCOIN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "authorizeClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    name: "claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "claimAuthorized",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "CLAIM_AMOUNT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const