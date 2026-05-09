import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from api.routes import comments, markets, orders
from api.lib.x402_mcp import mcp_x402_middleware
from api.lib.x402_server import get_middleware, is_paywall_enabled
from api.mcp.server import mcp as mcp_server
from api.routes import markets, orders
from api.routes.intelligence import router as intelligence_router
from api.routes.markets import balance_router
from api.routes.prepare import router as prepare_router

load_dotenv()

# Build the FastMCP ASGI sub-app once so session_manager is created before
# the lifespan runs.
_mcp_sub_app = mcp_server.streamable_http_app()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    async with mcp_server.session_manager.run():
        yield


app = FastAPI(
    title="Prediction Market Agent API",
    version="1.0.0",
    description=(
        "Agent-agnostic REST API for the Czech prediction-market dApp.  "
        "Free endpoints: market reads and calldata builders.  "
        "Paywalled endpoints (paywall:x402): intelligence tools — "
        "pay $0.50–$0.75 USDC on Base mainnet per call."
    ),
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173")
_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def x402_paywall(
    request: Request,
    call_next: object,
) -> Response:
    """x402 inbound paywall for /v1/intelligence/* routes.

    Skipped entirely if X402_IN_WALLET_ADDRESS is not set so the app starts
    cleanly in dev without a funded wallet configured.
    """
    from collections.abc import Awaitable, Callable

    _call_next: Callable[[Request], Awaitable[Response]] = call_next  # type: ignore[assignment]
    if not is_paywall_enabled():
        return await _call_next(request)
    return await get_middleware()(request, _call_next)


@app.middleware("http")
async def x402_mcp_paywall(
    request: Request,
    call_next: object,
) -> Response:
    """x402 inbound paywall for paywalled MCP tool calls on POST /mcp.

    Peeks at the JSON-RPC body to identify the tool name, then enforces the
    same x402 challenge/verify/settle flow as the REST paywall.  Skipped if
    X402_IN_WALLET_ADDRESS is not set.
    """
    from collections.abc import Awaitable, Callable

    _call_next: Callable[[Request], Awaitable[Response]] = call_next  # type: ignore[assignment]
    return await mcp_x402_middleware(request, _call_next)


app.include_router(markets.router)
app.include_router(balance_router)
app.include_router(orders.router)
app.include_router(comments.router)
app.include_router(prepare_router)
app.include_router(intelligence_router)

# Mount FastMCP at /mcp — streamable HTTP transport (modern MCP standard).
# Clients connect to http://<host>/mcp.
# FastMCP is configured with streamable_http_path='/' so the sub-app's own
# route is at '/', which aligns with Starlette's path stripping after mount.
app.mount("/mcp", _mcp_sub_app)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
