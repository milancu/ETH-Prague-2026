import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Persist TabClob signed limit orders to packages/nextjs/data/orders.csv.
// Layout: id,createdAt,maker,taker,makerToken,takerToken,makerAmount,takerAmount,expiry,salt,chainId,verifyingContract,signature,note

const CSV_PATH = path.join(process.cwd(), "data", "orders.csv");
const HEADER =
  "id,createdAt,maker,taker,makerToken,takerToken,makerAmount,takerAmount,expiry,salt,chainId,verifyingContract,signature,note";

const columnOrder = HEADER.split(",");

const csvEscape = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const ensureFile = async () => {
  const dir = path.dirname(CSV_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(CSV_PATH);
  } catch {
    await fs.writeFile(CSV_PATH, HEADER + "\n", "utf8");
  }
};

const parseCsv = (text: string): Record<string, string>[] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // skip
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

export async function GET() {
  await ensureFile();
  const text = await fs.readFile(CSV_PATH, "utf8");
  return NextResponse.json({ orders: parseCsv(text) });
}

export async function POST(req: NextRequest) {
  await ensureFile();
  const body = await req.json();
  const id = body.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const row = { id, createdAt, ...body };
  const line = columnOrder.map(c => csvEscape(row[c])).join(",");
  await fs.appendFile(CSV_PATH, line + "\n", "utf8");
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  await ensureFile();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  const text = await fs.readFile(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  const filtered = rows.filter(r => r.id !== id);
  const out = [HEADER, ...filtered.map(r => columnOrder.map(c => csvEscape(r[c])).join(","))].join("\n") + "\n";
  await fs.writeFile(CSV_PATH, out, "utf8");
  return NextResponse.json({ ok: true });
}
