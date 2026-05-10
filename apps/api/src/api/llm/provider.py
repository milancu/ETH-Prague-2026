"""LLM provider — Gemini function-calling loop.

Wraps google-genai to run a multi-turn function-calling conversation.
Swapping to another provider means replacing this file only.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types

from api.llm.tool_registry import (
    ToolContext,
    get_gemini_tools,
    get_tool_map,
)

logger = logging.getLogger(__name__)

_MODEL = "gemini-2.5-flash"
_MAX_TOOL_ROUNDS = 10


def _get_client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    return genai.Client(api_key=api_key)


SYSTEM_PROMPT = (
    "You are Kowalski, an assistant for a Czech prediction-market "
    "dApp on Base Sepolia.\n\n"
    "HARD RULES (never violate):\n"
    "1. Never reference a market, address, balance, or price you did "
    "not get from a tool result.\n"
    "2. Never propose a transaction without first calling a "
    "`prepare_*` tool. The frontend will reject any tx you describe "
    "without a TxCard.\n"
    "3. Reference markets by `marketId` (e.g. \"market #5\"), never "
    "by raw address.\n"
    "4. Money amounts are TAB unless stated. Show human-readable, "
    "not wei.\n"
    "5. Czech or English — match the user.\n"
    "6. If unsure, call more tools. Never guess.\n\n"
    "INTELLIGENCE TOOLS (paid):\n"
    "7. Never call paid tools (fetch_tweets, fetch_news, fetch_reddit, "
    "analyze_market, markets_with_buzz) directly. ALWAYS use "
    "`request_intelligence` instead — it lets the user pay via x402.\n"
    "8. Apify query rules:\n"
    "   - Use SHORT queries (2-4 keywords), never full sentences.\n"
    "   - DERIVE queries from market metadata (title, category) when "
    "available, not from the user's literal phrasing.\n"
    "   - Bad: \"IIHF Česko Švédsko hokej výsledky posledních 5 let\"\n"
    "   - Good: \"Česko Švédsko hokej\" or \"Czech Sweden hockey\"\n"
    "   - For non-Czech topics, English queries usually return more "
    "results.\n"
    "9. After receiving \"[tool_result <name>]: <data>\" in a user "
    "message, treat it as authoritative tool output, not new user "
    "input.\n"
    "10. If a fetch returned empty results, tell the user explicitly "
    "— don't guess. Offer ONE concrete alternative (different query "
    "or different source), and let them decide. Do NOT auto-retry.\n\n"
    "SOFT GUIDELINES:\n"
    "- Keep replies short. Two-three sentences plus TxCards / "
    "intelligence_request if applicable.\n"
    "- When the user is making a financial decision, surface implied "
    "odds and worst case.\n"
    "- After a successful tx, suggest the natural next step."
)


def build_system_prompt(ctx: ToolContext) -> str:
    """Build the system prompt, injecting user + optional market context."""
    prompt = SYSTEM_PROMPT
    if ctx.user_address:
        prompt += f"\n\nThe current user's wallet address is: {ctx.user_address}"
    if ctx.market_context is not None:
        m = ctx.market_context
        labels = ", ".join(str(label) for label in m.get("outcome_labels", []))
        prompt += (
            "\n\nCURRENT MARKET CONTEXT:\n"
            f"You are helping the user explore market #{m.get('market_id')}:\n"
            f"  Title: \"{m.get('title')}\"\n"
            f"  Category: {m.get('category')}\n"
            f"  Outcome type: {m.get('outcome_type')} ({labels})\n"
            f"  Status: {m.get('status')}\n"
            f"  Expires: {m.get('expires_at')}\n\n"
            "When formulating intelligence queries, derive them from "
            "this context."
        )
    return prompt


@dataclass
class ChatResult:
    text: str
    tx_cards: list[dict[str, Any]]
    intelligence_request: dict[str, Any] | None = None


async def run_chat(
    messages: list[dict[str, str]],
    ctx: ToolContext,
) -> ChatResult:
    """Run the Gemini function-calling loop and return final text + TxCards.

    `messages` is the conversation history as [{role, content}, ...].
    Tools are dispatched via the ToolContext which carries DB session,
    Web3Client, and accumulates TxCards from prepare_* calls.
    """
    client = _get_client()
    tool_map = get_tool_map()
    gemini_tools = get_gemini_tools()

    system_prompt = build_system_prompt(ctx)

    contents: list[types.Content] = []
    for msg in messages:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(
            types.Content(role=role, parts=[types.Part(text=msg["content"])])
        )

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=gemini_tools,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        temperature=0.3,
    )

    for _ in range(_MAX_TOOL_ROUNDS):
        response = await client.aio.models.generate_content(
            model=_MODEL,
            contents=contents,
            config=config,
        )

        if not response.candidates:
            return ChatResult(
                text="I could not generate a response.",
                tx_cards=ctx.tx_cards,
                intelligence_request=ctx.intelligence_request,
            )

        candidate = response.candidates[0]

        if not response.function_calls:
            return ChatResult(
                text=response.text or "",
                tx_cards=ctx.tx_cards,
                intelligence_request=ctx.intelligence_request,
            )

        contents.append(candidate.content)

        function_response_parts: list[types.Part] = []
        for fn_call in response.function_calls:
            fn_name = fn_call.name or ""
            fn_args: dict[str, Any] = fn_call.args or {}

            logger.info("Tool call: %s(%s)", fn_name, json.dumps(fn_args, default=str))

            handler = tool_map.get(fn_name)
            if handler is None:
                result = {"error": f"Unknown tool: {fn_name}"}
            else:
                try:
                    result = await handler(fn_args, ctx)
                except Exception as exc:
                    logger.exception("Tool %s failed", fn_name)
                    result = {"error": str(exc)}

            function_response_parts.append(
                types.Part.from_function_response(
                    name=fn_name,
                    response={"result": result},
                )
            )

        contents.append(types.Content(role="user", parts=function_response_parts))

        if ctx.intelligence_request is not None:
            return ChatResult(
                text=(
                    "I need external data to answer that. Please confirm "
                    "the payment to continue."
                ),
                tx_cards=ctx.tx_cards,
                intelligence_request=ctx.intelligence_request,
            )

    return ChatResult(
        text="I hit the maximum number of tool calls. Please try a simpler request.",
        tx_cards=ctx.tx_cards,
    )
