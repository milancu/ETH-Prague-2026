import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from api.lib.x402_server import get_middleware, is_paywall_enabled
from api.routes import markets, orders
from api.routes.intelligence import router as intelligence_router
from api.routes.markets import balance_router
from api.routes.prepare import router as prepare_router

load_dotenv()

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


app.include_router(markets.router)
app.include_router(balance_router)
app.include_router(orders.router)
app.include_router(prepare_router)
app.include_router(intelligence_router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
