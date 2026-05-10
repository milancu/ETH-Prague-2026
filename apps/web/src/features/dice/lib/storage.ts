const STORAGE_KEY = "kowalsky.dice.commitments.v1"

export interface DiceLocalRecord {
  commitmentId: number
  commitmentHash: string
  marketId: number | null
  title: string
  chainId: number
  targetSequence: number
  estimatedRevealUnix: number
  delayMinutes: number
  createdAtUnix: number
  result: number | null
}

type Registry = Record<string, DiceLocalRecord>

function read(): Registry {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) return {}
    return parsed as Registry
  } catch {
    return {}
  }
}

function write(reg: Registry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reg))
  } catch {
    /* noop — quota / disabled */
  }
}

export function saveDiceRecord(record: DiceLocalRecord): void {
  const reg = read()
  reg[String(record.commitmentId)] = record
  write(reg)
}

export function getDiceRecord(commitmentId: number): DiceLocalRecord | null {
  const reg = read()
  return reg[String(commitmentId)] ?? null
}

export function patchDiceRecord(
  commitmentId: number,
  patch: Partial<DiceLocalRecord>,
): DiceLocalRecord | null {
  const reg = read()
  const existing = reg[String(commitmentId)]
  if (!existing) return null
  const updated: DiceLocalRecord = { ...existing, ...patch }
  reg[String(commitmentId)] = updated
  write(reg)
  return updated
}

export function findDiceRecordByMarketId(marketId: number): DiceLocalRecord | null {
  const reg = read()
  for (const rec of Object.values(reg)) {
    if (rec.marketId === marketId) return rec
  }
  return null
}

export function listDiceRecords(): DiceLocalRecord[] {
  return Object.values(read()).sort((a, b) => b.createdAtUnix - a.createdAtUnix)
}

/** Drops records that never linked to an on-chain market. They are unrecoverable —
 *  the createMarket tx never succeeded, so reveal can't resolve them. */
export function purgeOrphanDiceRecords(): number {
  const reg = read()
  let removed = 0
  for (const [key, rec] of Object.entries(reg)) {
    if (rec.marketId === null) {
      delete reg[key]
      removed++
    }
  }
  if (removed > 0) write(reg)
  return removed
}
