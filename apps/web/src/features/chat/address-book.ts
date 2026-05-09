/**
 * Address book — known contracts the AI is allowed to target.
 *
 * Used by the TxCard validator (CLAUDE.md §"AI Transaction Card validation"):
 *   2. `to` matches a known contract for the current chainId.
 *   3. function selector is in the allow-list for that contract.
 *
 * Selectors are first 4 bytes of keccak("functionSig(types...)").
 * We hard-code them so an attacker can't smuggle unknown calldata through.
 */

import {
  CONDITIONAL_TOKENS_ADDRESS,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  PREDICTION_MARKET_ADDRESS,
  TABCLOB_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"

const SELECTORS = {
  approve: "0x095ea7b3",
  createMarket: "0xb487a72d",
  splitTo: "0x9d8a8d28",
  mergeFrom: "0xfe2bb5d3",
  splitAndWrap: "0x73c1f4dc",
  claimWinnings: "0x65c8eb7f",
  setApprovalForAll: "0xa22cb465",
  cancel: "0x80b41246",
  fill: "0x9c3a3a18",
  getOrCreateWrapper: "0xfa72f5a9",
} as const

type Selector = (typeof SELECTORS)[keyof typeof SELECTORS]

interface ContractEntry {
  label: string
  allow: ReadonlySet<Selector>
}

function buildRegistry(): Map<string, ContractEntry> {
  const r = new Map<string, ContractEntry>()
  r.set(TABCOIN_ADDRESS.toLowerCase(), {
    label: "TABcoin",
    allow: new Set<Selector>([SELECTORS.approve]),
  })
  r.set(PREDICTION_MARKET_ADDRESS.toLowerCase(), {
    label: "PredictionMarketV2",
    allow: new Set<Selector>([
      SELECTORS.createMarket,
      SELECTORS.splitTo,
      SELECTORS.mergeFrom,
      SELECTORS.splitAndWrap,
      SELECTORS.claimWinnings,
    ]),
  })
  r.set(CONDITIONAL_TOKENS_ADDRESS.toLowerCase(), {
    label: "ConditionalTokens",
    allow: new Set<Selector>([SELECTORS.setApprovalForAll]),
  })
  r.set(TABCLOB_ADDRESS.toLowerCase(), {
    label: "TabClob",
    allow: new Set<Selector>([SELECTORS.cancel, SELECTORS.fill]),
  })
  r.set(POSITION_WRAPPER_FACTORY_ADDRESS.toLowerCase(), {
    label: "PositionWrapperFactory",
    allow: new Set<Selector>([SELECTORS.getOrCreateWrapper]),
  })
  return r
}

const REGISTRY = buildRegistry()

export interface AddressLookup {
  known: boolean
  label?: string
}

export function lookupAddress(address: string): AddressLookup {
  const entry = REGISTRY.get(address.toLowerCase())
  return entry ? { known: true, label: entry.label } : { known: false }
}

export interface FunctionLookup {
  allowed: boolean
  selector: string
}

export function lookupFunction(address: string, data: string): FunctionLookup {
  const selector = data.slice(0, 10).toLowerCase()
  const entry = REGISTRY.get(address.toLowerCase())
  if (!entry) return { allowed: false, selector }
  return { allowed: entry.allow.has(selector as Selector), selector }
}