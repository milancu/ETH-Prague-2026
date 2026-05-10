/**
 * Address book — known contracts the AI is allowed to target.
 *
 * Used by the TxCard validator (CLAUDE.md §"AI Transaction Card validation"):
 *   2. `to` matches a known contract for the current chainId.
 *   3. function selector is in the allow-list for that contract.
 *
 * Selectors are derived from the ABIs in `@/lib/contracts` via viem's
 * `toFunctionSelector`, so they cannot drift away from the on-chain signatures.
 */

import { toFunctionSelector, type Abi, type AbiFunction } from "viem"
import {
  CONDITIONAL_TOKENS_ABI,
  CONDITIONAL_TOKENS_ADDRESS,
  ERC20_ABI,
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
  TABCLOB_ABI,
  TABCLOB_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"

function selectorOf(abi: readonly unknown[], name: string): `0x${string}` {
  const item = abi.find(
    (x): x is AbiFunction =>
      typeof x === "object" && x !== null && (x as AbiFunction).type === "function" && (x as AbiFunction).name === name,
  )
  if (!item) throw new Error(`address-book: function "${name}" not found in ABI`)
  return toFunctionSelector(item)
}

interface ContractEntry {
  label: string
  allow: ReadonlySet<string>
  abi: Abi
}

function buildRegistry(): Map<string, ContractEntry> {
  const r = new Map<string, ContractEntry>()
  r.set(TABCOIN_ADDRESS.toLowerCase(), {
    label: "TABcoin",
    allow: new Set([selectorOf(ERC20_ABI, "approve")]),
    abi: ERC20_ABI as unknown as Abi,
  })
  r.set(PREDICTION_MARKET_ADDRESS.toLowerCase(), {
    label: "PredictionMarketV2",
    allow: new Set([
      selectorOf(PREDICTION_MARKET_ABI, "createMarket"),
      selectorOf(PREDICTION_MARKET_ABI, "splitTo"),
      selectorOf(PREDICTION_MARKET_ABI, "mergeFrom"),
      selectorOf(PREDICTION_MARKET_ABI, "splitAndWrap"),
      selectorOf(PREDICTION_MARKET_ABI, "claimWinnings"),
    ]),
    abi: PREDICTION_MARKET_ABI as unknown as Abi,
  })
  r.set(CONDITIONAL_TOKENS_ADDRESS.toLowerCase(), {
    label: "ConditionalTokens",
    allow: new Set([selectorOf(CONDITIONAL_TOKENS_ABI, "setApprovalForAll")]),
    abi: CONDITIONAL_TOKENS_ABI as unknown as Abi,
  })
  r.set(TABCLOB_ADDRESS.toLowerCase(), {
    label: "TabClob",
    allow: new Set([selectorOf(TABCLOB_ABI, "cancel"), selectorOf(TABCLOB_ABI, "fill")]),
    abi: TABCLOB_ABI as unknown as Abi,
  })
  r.set(POSITION_WRAPPER_FACTORY_ADDRESS.toLowerCase(), {
    label: "PositionWrapperFactory",
    allow: new Set([selectorOf(FACTORY_ABI, "getOrCreateWrapper")]),
    abi: FACTORY_ABI as unknown as Abi,
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
  return { allowed: entry.allow.has(selector), selector }
}

/** ABI for a registered contract, or undefined if `address` isn't in the registry. */
export function abiFor(address: string): Abi | undefined {
  return REGISTRY.get(address.toLowerCase())?.abi
}