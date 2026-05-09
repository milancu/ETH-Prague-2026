/**
 * Self-healing dev script for the Hardhat node + contract deploy.
 *
 *   pnpm dev (turbo)
 *     ├── apps/contracts/packages/hardhat dev → THIS SCRIPT
 *     │     · 8545 free            → start node + deploy
 *     │     · 8545 taken, deployed → reuse (preserve state)
 *     │     · 8545 taken, broken   → kill + restart + deploy
 *     ├── apps/web dev             → vite
 *     ├── apps/api dev             → fastapi
 *     └── …
 *
 * After deploy, generateWebEnv.ts writes apps/web/.env.local with the fresh
 * addresses, and Vite auto-reloads.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { spawn, exec } from "child_process";
import * as net from "net";

const PORT = 8545;

// Addresses the BE has hard-coded as defaults for chain 31337
// (apps/api/src/api/lib/web3_client.py _HARDHAT_DEFAULTS).
// Hardhat deterministically deploys to these from a fresh node
// (deployer nonce 0–4). If any is empty we deem the chain "broken".
const EXPECTED_CONTRACTS = [
  "0x5FbDB2315678afecb367f032d93F642f64180aa3", // TABcoin
  "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", // ConditionalTokens
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", // PredictionMarketV2
  "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9", // PositionWrapperFactory
  "0x0165878A594ca255338adfa4d48449f69242Eb8F", // TabClob
];

// Default Hardhat account #0 — used as deployer in hardhat-deploy. With
// BASE_FORK off (default), the node starts at nonce 0 and the setNonce call
// below is a no-op. With BASE_FORK=true the same key inherits its real
// mainnet nonce (~42k+); setNonce will fail in that mode and we surface a
// clear warning, because contracts then land at NON-canonical addresses
// that BE web3_client._HARDHAT_DEFAULTS won't find.
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEPLOYER_BALANCE = "0x21e19e0c9bab2400000"; // 10 000 ETH in wei (hex)

// Well-known Hardhat default mnemonic accounts — safe to print, public test keys.
// https://hardhat.org/hardhat-network/docs/reference#initial-state
const DEV_ACCOUNTS: { index: number; address: string; pk: string; note?: string }[] = [
  {
    index: 0,
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    pk: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    note: "deployer / oracle",
  },
  {
    index: 1,
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    index: 2,
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
  {
    index: 3,
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    pk: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  },
  {
    index: 4,
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  },
];

// TABcoin lives at the deterministic CREATE address of nonce 0. Used to
// query balances for the printout — kept in sync with EXPECTED_CONTRACTS[0].
const TAB_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const TAB_BALANCE_OF_SELECTOR = "0x70a08231"; // balanceOf(address)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => { sock.destroy(); resolve(false); });
  });
}

function waitForPort(port: number, maxAttempts = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const try_ = () => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.on("connect", () => { sock.destroy(); resolve(); });
      sock.on("error", () => {
        sock.destroy();
        if (++attempts >= maxAttempts) {
          reject(new Error(`Port ${port} not ready after ${maxAttempts}s`));
        } else {
          setTimeout(try_, 1000);
        }
      });
    };
    try_();
  });
}

async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

async function isHardhatChain(): Promise<boolean> {
  try {
    const chainHex = await rpc<string>("eth_chainId", []);
    return parseInt(chainHex, 16) === 31337;
  } catch {
    return false;
  }
}

async function allContractsDeployed(): Promise<boolean> {
  for (const addr of EXPECTED_CONTRACTS) {
    const code = await rpc<string>("eth_getCode", [addr, "latest"]);
    if (!code || code === "0x") return false;
  }
  return true;
}

// Decimal ETH (18 decimals) from a 0x-prefixed wei hex string. We avoid pulling
// in ethers just for printing — small inline helper is fine.
function formatEth(weiHex: string): string {
  const wei = BigInt(weiHex);
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  // 4-decimal precision; trim trailing zeros.
  const fracStr = (frac / 10n ** 14n).toString().padStart(4, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

async function getEthBalance(addr: string): Promise<string> {
  try {
    const hex = await rpc<string>("eth_getBalance", [addr, "latest"]);
    return formatEth(hex);
  } catch {
    return "?";
  }
}

async function getTabBalance(addr: string): Promise<string> {
  try {
    const data = TAB_BALANCE_OF_SELECTOR + addr.slice(2).toLowerCase().padStart(64, "0");
    const hex = await rpc<string>("eth_call", [{ to: TAB_ADDRESS, data }, "latest"]);
    return formatEth(hex);
  } catch {
    return "?";
  }
}

async function printSummary(): Promise<void> {
  const lines: string[] = [];
  lines.push("");
  lines.push("══════════════════════════════════════════════════════════════════════");
  lines.push("  ✅  Local stack ready");
  lines.push("");
  lines.push("  Network");
  lines.push("    Chain ID  :  31337");
  lines.push("    RPC URL   :  http://127.0.0.1:8545");
  lines.push("    Currency  :  ETH");
  lines.push("");
  lines.push("  Test accounts — paste the PK into MetaMask → Import account");
  for (const acc of DEV_ACCOUNTS) {
    const [eth, tab] = await Promise.all([
      getEthBalance(acc.address),
      getTabBalance(acc.address),
    ]);
    const tag = acc.note ? `  (${acc.note})` : "";
    lines.push(`    [${acc.index}] ${acc.address}${tag}`);
    lines.push(`        ETH: ${eth}    TAB: ${tab}`);
    lines.push(`        PK:  ${acc.pk}`);
  }
  lines.push("");
  lines.push("  Apps");
  lines.push("    web :  http://localhost:5173");
  lines.push("    api :  http://localhost:8000/docs");
  lines.push("══════════════════════════════════════════════════════════════════════");
  lines.push("");
  console.log(lines.join("\n"));
}

function killPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "win32"
        ? `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`
        : `lsof -ti :${port} | xargs -r kill -9`;
    exec(cmd, () => resolve()); // best-effort, ignore errors
  });
}

function runAndWait(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(" ")}" exited with ${code}`));
    });
  });
}

function startNode(): ReturnType<typeof spawn> {
  const node = spawn(
    "hardhat",
    ["node", "--network", "hardhat", "--no-deploy"],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  node.on("error", (err) => {
    console.error("Hardhat node error:", err);
    process.exit(1);
  });
  const cleanup = () => {
    try { node.kill(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  return node;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const taken = await isPortOpen(PORT);

  if (taken) {
    const isOurs = await isHardhatChain();
    if (!isOurs) {
      console.error(
        `\n❌  Port ${PORT} is in use by a non-Hardhat process. Free it and re-run.\n`,
      );
      process.exit(1);
    }
    const ready = await allContractsDeployed();
    if (ready) {
      console.log(
        `\n✅  Hardhat node + contracts already running on :${PORT} — reusing.`,
      );
      await printSummary();
      // Stay alive so turbo keeps this task "running".
      await new Promise(() => {});
      return;
    }
    console.warn(
      `\n⚠   Hardhat on :${PORT} has no contracts deployed at expected addresses (deployer nonce drifted).`,
    );
    console.warn(`   Killing it and starting fresh…\n`);
    await killPort(PORT);
    await new Promise((r) => setTimeout(r, 500)); // let the OS release the socket
  }

  // ── Fresh start ────────────────────────────────────────────────────────────
  const node = startNode();

  console.log(`\n⏳  Waiting for Hardhat node on :${PORT}…`);
  await waitForPort(PORT);
  console.log("✅  Node ready\n");

  // Defensive: ensure deployer has a sane state. setNonce will fail on a
  // forked chain (Base mainnet inherits ~42k nonce for this well-known key);
  // we surface a clear warning in that case. With forking off (default) the
  // node starts at nonce 0 and this is a no-op.
  try {
    await rpc("hardhat_setNonce", [DEPLOYER, "0x0"]);
  } catch (err) {
    console.warn(
      `⚠   Could not reset deployer nonce — likely BASE_FORK=true. ` +
        `Contracts will deploy at NON-default addresses, BE will not find them.\n   ${(err as Error).message}\n`,
    );
  }
  await rpc("hardhat_setBalance", [DEPLOYER, DEPLOYER_BALANCE]);

  // --reset clears deployments/localhost so contracts always redeploy from
  // nonce 0 → addresses match _HARDHAT_DEFAULTS in BE web3_client.py.
  await runAndWait("hardhat", ["deploy", "--reset"]);

  console.log("\n🎉  Contracts deployed — apps/web/.env.local updated");
  await printSummary();

  await new Promise((_, reject) =>
    node.on("exit", (code) => reject(new Error(`Node exited: ${code}`))),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});