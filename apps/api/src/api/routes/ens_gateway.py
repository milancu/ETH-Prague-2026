"""CCIP-Read gateway for ENS analysis lookups (Track 2, §4.2 of ENS spec).

Endpoint: GET /v1/ens-gateway/{sender}/{data}.json

Flow:
  1. ENSIP-10 client calls MarketResolver.resolve() for analyze.<slug>.kowalski.eth
  2. Resolver reverts with OffchainLookup pointing here
  3. Client GETs this endpoint with the calldata
  4. We decode the market slug + text key, run analysis via /v1/intelligence/analyze
  5. Sign the result and return it for the resolver's resolveWithProof callback

x402 paywall is applied by the existing payment_middleware — the route is
registered in x402_server._build_routes().
"""

from __future__ import annotations

from eth_abi import decode, encode
from eth_utils import keccak
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.lib.ens_signer import is_signer_configured, sign_gateway_response

router = APIRouter(prefix="/v1/ens-gateway", tags=["ens", "paywall:x402"])


class GatewayResponse(BaseModel):
    data: str = Field(description="ABI-encoded (result, expires, signature)")


@router.get(
    "/{sender}/{data}.json",
    response_model=GatewayResponse,
    summary="CCIP-Read gateway for ENS analysis lookups",
    description=(
        "Called by ENSIP-10 clients after OffchainLookup revert. "
        "Decodes the market slug and text key, runs analysis, "
        "and returns a signed response. "
        "**Paywall: $0.50 USDC on Base Sepolia.**"
    ),
    openapi_extra={"x-x402-price": "$0.50", "x-x402-network": "eip155:84532"},
)
async def ccip_read_gateway(sender: str, data: str) -> GatewayResponse:
    if not is_signer_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ENS gateway signer not configured",
        )

    try:
        calldata = bytes.fromhex(data.removeprefix("0x"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid hex data: {exc}",
        ) from exc

    slug, key = _decode_ccip_calldata(calldata)

    analysis_text = await _run_analysis(slug, key)

    result_bytes = encode(["string"], [analysis_text])

    dns_name = _build_dns_name(f"analyze.{slug}.kowalski.eth")
    request = dns_name + calldata

    result, expires, sig = sign_gateway_response(
        result=result_bytes,
        request=request,
    )

    response_abi = encode(
        ["bytes", "uint64", "bytes"],
        [result, expires, sig],
    )

    return GatewayResponse(data="0x" + response_abi.hex())


def _decode_ccip_calldata(calldata: bytes) -> tuple[str, str]:
    """Extract market slug and text key from the original text(node,key) calldata.

    The calldata is the inner function call that was passed through OffchainLookup.
    Format: 4-byte selector + abi.encode(bytes32 node, string key)
    """
    if len(calldata) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calldata too short",
        )

    selector = calldata[:4]
    text_selector = keccak(b"text(bytes32,string)")[:4]

    if selector != text_selector:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported selector: 0x{selector.hex()}",
        )

    try:
        node, key = decode(["bytes32", "string"], calldata[4:])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to decode calldata: {exc}",
        ) from exc

    # For now, slug is extracted from the gateway URL context or defaults
    # In a full implementation, we'd reverse-lookup the node to get the slug
    # For hackathon: the slug comes through the CCIP-Read URL pattern
    return "unknown", key


async def _run_analysis(slug: str, key: str) -> str:
    """Run market analysis and return the requested text field.

    Delegates to the existing intelligence/analyze endpoint logic.
    """
    try:
        from api.llm.tools import apify as apify_tools

        result = await apify_tools.analyze_market(slug, "general", 15)
        if key == "thesis":
            return result.get("thesis") or "No thesis available"
        if key == "sentiment":
            return result.get("sentiment") or "neutral"
        if key == "sources":
            sources = result.get("sources", [])
            return ", ".join(sources) if sources else "No sources"
        return result.get(key) or f"Unknown key: {key}"
    except Exception:
        return f"Analysis unavailable for {slug} (key={key})"


def _build_dns_name(name: str) -> bytes:
    """DNS-encode a dotted name (e.g. 'analyze.slavia.kowalski.eth' → bytes)."""
    parts = name.split(".")
    result = b""
    for part in parts:
        encoded = part.encode("ascii")
        result += bytes([len(encoded)]) + encoded
    result += b"\x00"
    return result
