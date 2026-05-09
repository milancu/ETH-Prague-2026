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
  "0xf56DD038B0eC671AbEBAA6499fdd5b195Cf089e4", // TABcoin
  "0x05fa1e1EE3249C26db881930F0bF2cb1fe05da98", // ConditionalTokens
  "0x1157c1D6027A5f4Cd62682A7F0d1da426A4b65E3", // PredictionMarketV2
  "0x1e79FAc6B154B49101252C447E0e68a0a20fc3c0", // PositionWrapperFactory
  "0xb6Df8d192e0d8EFD03E248aeC59C37E55C5A9998", // TabClob
];

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
        `\n✅  Hardhat node + contracts already running on :${PORT} — reusing.\n`,
      );
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

  // --reset clears deployments/localhost so contracts always redeploy from
  // nonce 0 → addresses match _HARDHAT_DEFAULTS in BE web3_client.py.
  await runAndWait("hardhat", ["deploy", "--reset"]);

  console.log("\n🎉  Contracts deployed — apps/web/.env.local updated");
  console.log("    hardhat[1]  0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  console.log("    PK:         0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d\n");

  await new Promise((_, reject) =>
    node.on("exit", (code) => reject(new Error(`Node exited: ${code}`))),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});