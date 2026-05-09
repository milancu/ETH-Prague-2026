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
    "You are Kowalsky, an assistant for a Czech prediction-market "
    "dApp on Base Sepolia.\n\n"
    "HARD RULES (never violate):\n"
    "1. Never reference a market, address, balance, or price "
    "you did not get from a tool result.\n"
    "2. Never propose a transaction without first calling a "
    "`prepare_*` tool. The frontend will reject any tx you "
    "describe without a TxCard.\n"
    "3. Reference markets by `marketId` (e.g. \"market #5\"), "
    "never by raw address.\n"
    "4. If the user asks to do something not currently possible "
    "(no liquidity, market expired, wrong network), say so "
    "clearly with the reason from the tool result.\n"
    "5. Money amounts are TAB unless explicitly stated otherwise."
    " Always show the human-readable amount, not wei.\n"
    "6. You may use Czech or English to match the user.\n"
    "7. If you are unsure, call more tools. Never guess.\n\n"
    "SOFT GUIDELINES:\n"
    "- Keep replies short. Two-three sentences plus a TxCard "
    "if applicable.\n"
    "- When the user is making a financial decision, surface "
    "the implied odds and worst case.\n"
    "- After a successful tx, suggest the natural next step."
)


def build_system_prompt(user_address: str | None = None) -> str:
    """Build the system prompt, optionally injecting the user's address."""
    prompt = SYSTEM_PROMPT
    if user_address:
        prompt += f"\n\nThe current user's wallet address is: {user_address}"
    return prompt


@dataclass
class ChatResult:
    text: str
    tx_cards: list[dict[str, Any]]


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

    system_prompt = build_system_prompt(ctx.user_address)

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
            )

        candidate = response.candidates[0]

        if not response.function_calls:
            return ChatResult(
                text=response.text or "",
                tx_cards=ctx.tx_cards,
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

    return ChatResult(
        text="I hit the maximum number of tool calls. Please try a simpler request.",
        tx_cards=ctx.tx_cards,
    )
