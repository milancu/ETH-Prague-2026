/**
 * Combined dev script: starts Hardhat node, waits for it, deploys contracts,
 * and keeps the node running. Triggered by `pnpm run dev` (turbo).
 *
 * After deploy, generateWebEnv.ts writes apps/web/.env.local with the fresh
 * contract addresses. Vite picks up the change and auto-reloads.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { spawn } from "child_process";
import * as net from "net";

const PORT = 8545;

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

function runAndWait(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(" ")}" exited with ${code}`));
    });
  });
}

async function main() {
  // 1. Start Hardhat node (keeps running in background of this process)
  const node = spawn("hardhat", ["node", "--network", "hardhat", "--no-deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  node.on("error", err => { console.error("Hardhat node error:", err); process.exit(1); });

  const cleanup = () => { try { node.kill(); } catch {} process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // 2. Wait for RPC to be ready
  console.log(`\n⏳  Waiting for Hardhat node on :${PORT}…`);
  await waitForPort(PORT);
  console.log("✅  Node ready\n");

  // 3. Deploy (also runs generateWebEnv → writes apps/web/.env.local)
  await runAndWait("hardhat", ["deploy"]);

  console.log("\n🎉  Contracts deployed — apps/web/.env.local updated\n");
  console.log("    hardhat[1]  0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  console.log("    PK:         0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d\n");

  // 4. Keep alive while node runs
  await new Promise((_, reject) => node.on("exit", code => reject(new Error(`Node exited: ${code}`))));
}

main().catch(err => { console.error(err); process.exit(1); });