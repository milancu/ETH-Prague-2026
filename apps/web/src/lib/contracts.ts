import { parseEther } from "viem"

// ── Addresses ────────────────────────────────────────────────────────────────
// Read from env vars (set by `yarn deploy` via generateWebEnv.ts for local,
// or hardcoded Base Sepolia fallbacks for production / devs without local node).

function addr(key: string, fallback: string): `0x${string}` {
  return ((import.meta.env[key] as string | undefined) ?? fallback) as `0x${string}`
}

export const PREDICTION_MARKET_ADDRESS = addr(
  "VITE_PREDICTION_MARKET_ADDRESS",
  "0xE5ddc8f9Ed573CfA1c23aaF97D6193FD2510EF93",
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
  "0xC34715695188b3cE1319C9BF7423713fB3C2A470",
)

export const POSITION_WRAPPER_FACTORY_ADDRESS = addr(
  "VITE_POSITION_WRAPPER_FACTORY_ADDRESS",
  "0x5F57977678EE0B53Ca91adeF98D9C6D315C5ab81",
)

// Hardhat account[0] — deployer on local; update via VITE_DEFAULT_ORACLE for other networks.
export const DEFAULT_ORACLE = addr(
  "VITE_DEFAULT_ORACLE",
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
)

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