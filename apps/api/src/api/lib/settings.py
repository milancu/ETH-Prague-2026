from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    clob_match_tiebreaker: Literal["fifo", "random"] = "fifo"
    spacecomputer_api_url: str | None = None
    spacecomputer_api_key: str | None = None
    spacecomputer_seed_ttl_s: int = 30


settings = Settings()

if settings.clob_match_tiebreaker == "random" and not settings.spacecomputer_api_url:
    raise RuntimeError(
        "CLOB_MATCH_TIEBREAKER=random vyžaduje SPACECOMPUTER_API_URL"
    )
