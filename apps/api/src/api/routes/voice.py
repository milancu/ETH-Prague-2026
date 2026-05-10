"""ElevenLabs voice routes — speech-to-text + text-to-speech proxy.

Keeps ELEVENLABS_API_KEY on the server. The frontend never sees it.

- POST /v1/voice/stt   multipart audio    -> {"text": "..."}
- POST /v1/voice/tts   {text, voice_id?}  -> audio/mpeg stream
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from functools import lru_cache

from elevenlabs.client import ElevenLabs
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/v1/voice", tags=["voice"])
limiter = Limiter(key_func=get_remote_address)

_DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
_DEFAULT_TTS_MODEL = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5")
_STT_MODEL = "scribe_v2"
# Browser MediaRecorder typically produces audio/webm chunks <1MB for 60s.
# Cap at 25MB to keep the BE memory bounded.
_MAX_AUDIO_BYTES = 25 * 1024 * 1024
_MAX_TTS_CHARS = 4000


@lru_cache(maxsize=1)
def _client() -> ElevenLabs:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ELEVENLABS_API_KEY not configured on the server.",
        )
    return ElevenLabs(api_key=api_key)


# ---------------------------------------------------------------------------
# Speech-to-text
# ---------------------------------------------------------------------------


class STTResponse(BaseModel):
    text: str
    language_code: str | None = None


@router.post(
    "/stt",
    response_model=STTResponse,
    summary="Transcribe audio to text",
)
@limiter.limit("30/minute")
async def stt(
    request: Request,
    file: UploadFile = File(...),
    language_code: str | None = Form(default=None),
) -> STTResponse:
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="empty audio file")
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio file too large")

    try:
        result = _client().speech_to_text.convert(
            file=audio_bytes,
            model_id=_STT_MODEL,
            language_code=language_code,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"STT failed: {exc}") from exc

    return STTResponse(
        text=getattr(result, "text", "") or "",
        language_code=getattr(result, "language_code", None),
    )


# ---------------------------------------------------------------------------
# Text-to-speech
# ---------------------------------------------------------------------------


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=_MAX_TTS_CHARS)
    voice_id: str | None = None
    model_id: str | None = None


@router.post(
    "/tts",
    summary="Generate speech (mp3) from text",
    response_class=StreamingResponse,
)
@limiter.limit("30/minute")
async def tts(body: TTSRequest, request: Request) -> StreamingResponse:
    voice_id = body.voice_id or _DEFAULT_VOICE_ID
    model_id = body.model_id or _DEFAULT_TTS_MODEL

    try:
        audio_iter = _client().text_to_speech.convert(
            text=body.text,
            voice_id=voice_id,
            model_id=model_id,
            output_format="mp3_44100_128",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"TTS failed: {exc}") from exc

    async def stream() -> AsyncIterator[bytes]:
        for chunk in audio_iter:
            if chunk:
                yield chunk

    return StreamingResponse(
        stream(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )