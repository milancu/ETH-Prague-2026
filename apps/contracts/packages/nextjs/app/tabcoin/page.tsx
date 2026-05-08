"use client";

import { useState } from "react";
import { Address, AddressInput } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { Address as AddressType, formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const TabcoinPage: NextPage = () => {
  const { address: connected } = useAccount();
  const { data: authorizer } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "AUTHORIZER",
  });
  const { data: balance } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "balanceOf",
    args: [connected],
  });
  const { data: claimAuthorized } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "claimAuthorized",
    args: [connected],
  });
  const { data: claimAmount } = useScaffoldReadContract({
    contractName: "TABcoin",
    functionName: "CLAIM_AMOUNT",
  });

  const isAuthorizer =
    !!connected && !!authorizer && connected.toLowerCase() === (authorizer as AddressType).toLowerCase();

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">TABcoin</h1>
      <p className="text-sm opacity-70 mb-6">ERC-20 kolaterál a bond token pro PredictionMarketV2.</p>

      <div className="card bg-base-100 shadow-xl mb-6">
        <div className="card-body">
          <h2 className="card-title">Tvůj účet</h2>
          <div className="text-sm space-y-1">
            <div className="flex gap-1 items-center">
              Adresa: {connected ? <Address address={connected} /> : "— nepřipojeno —"}
            </div>
            <div>Balance: {balance !== undefined ? `${formatEther(balance as bigint)} TAB` : "—"}</div>
            <div>
              Claim allowance: {claimAuthorized ? "✅ máš povolený claim" : "—"}{" "}
              {claimAmount !== undefined && (
                <span className="opacity-60">(po claimu obdržíš {formatEther(claimAmount as bigint)} TAB)</span>
              )}
            </div>
          </div>
          <ClaimButton enabled={!!claimAuthorized} />
        </div>
      </div>

      {isAuthorizer ? (
        <AuthorizerPanel />
      ) : (
        <div className="alert alert-info">
          <span>
            Authorizer (mint / authorize / revoke) může volat pouze adresa{" "}
            <code className="text-xs">{authorizer ? (authorizer as string) : "…"}</code>. Připoj se touto wallet pro
            přístup k admin panelu.
          </span>
        </div>
      )}
    </div>
  );
};

export default TabcoinPage;

const ClaimButton = ({ enabled }: { enabled: boolean }) => {
  const { writeContractAsync, isPending } = useScaffoldWriteContract({ contractName: "TABcoin" });
  return (
    <div className="card-actions justify-end mt-2">
      <button
        className="btn btn-primary"
        disabled={!enabled || isPending}
        onClick={async () => {
          try {
            await writeContractAsync({ functionName: "claim" });
            notification.success("Claimed");
          } catch (e: unknown) {
            notification.error(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {isPending ? "Claiming…" : "claim()"}
      </button>
    </div>
  );
};

const AuthorizerPanel = () => {
  const [target, setTarget] = useState("");
  const [mintAmount, setMintAmount] = useState("");

  const { writeContractAsync, isPending } = useScaffoldWriteContract({ contractName: "TABcoin" });

  const valid = /^0x[0-9a-fA-F]{40}$/.test(target);

  const onAuthorize = async () => {
    if (!valid) return notification.error("Zadej platnou adresu");
    try {
      await writeContractAsync({ functionName: "authorizeClaim", args: [target as AddressType] });
      notification.success(`Authorized ${target}`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onRevoke = async () => {
    if (!valid) return notification.error("Zadej platnou adresu");
    try {
      await writeContractAsync({ functionName: "revokeClaim", args: [target as AddressType] });
      notification.success(`Revoked ${target}`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onMint = async () => {
    if (!valid) return notification.error("Zadej platnou adresu");
    if (!mintAmount) return notification.error("Zadej množství");
    try {
      await writeContractAsync({
        functionName: "mint",
        args: [target as AddressType, parseEther(mintAmount)],
      });
      notification.success(`Minted ${mintAmount} TAB → ${target}`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl border-2 border-warning">
      <div className="card-body">
        <h2 className="card-title">🔐 Authorizer panel</h2>
        <label className="label">Cílová adresa</label>
        <AddressInput value={target} onChange={setTarget} placeholder="0x…" />

        <div className="flex flex-wrap gap-2 mt-3">
          <button className="btn btn-outline btn-sm" disabled={isPending || !valid} onClick={onAuthorize}>
            authorizeClaim
          </button>
          <button className="btn btn-outline btn-error btn-sm" disabled={isPending || !valid} onClick={onRevoke}>
            revokeClaim
          </button>
        </div>

        <div className="divider"></div>

        <label className="label">Mint amount (TAB)</label>
        <input
          className="input input-bordered"
          placeholder="100"
          value={mintAmount}
          onChange={e => setMintAmount(e.target.value)}
        />
        <div className="card-actions justify-end mt-2">
          <button className="btn btn-warning" disabled={isPending || !valid || !mintAmount} onClick={onMint}>
            mint(to, amount)
          </button>
        </div>
      </div>
    </div>
  );
};
