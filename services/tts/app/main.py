"""Chatterbox TTS service: POST /synthesize renders one storyboard beat and
returns its measured duration plus forced-alignment word timings."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .config import load_settings

load_dotenv()
logger = logging.getLogger("tts")
logging.basicConfig(level=logging.INFO)

settings = load_settings()
_synth = None  # loaded in lifespan; module-global so tests can inject a stub


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    out_path: str = Field(min_length=1)
    seed: int | None = None


class WordTiming(BaseModel):
    word: str
    start: float
    end: float


class SynthesizeResponse(BaseModel):
    wav_path: str
    duration_seconds: float
    words: list[WordTiming]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _synth
    if _synth is None:
        from .synth import Synthesizer  # heavy import deferred so tests can stub

        logger.info("Loading chatterbox model '%s' (cold load can take ~90s)...", settings.model)
        _synth = Synthesizer(settings)
        logger.info("Model loaded in %.1fs on %s", _synth.load_seconds, _synth.device)
    yield


app = FastAPI(title="reel-agent-tts", lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):  # noqa: ANN001
    """Return the real error to the caller — a bare 'Internal Server Error'
    once cost us a lost render with no diagnosable trace."""
    from fastapi.responses import JSONResponse

    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


@app.get("/health")
def health() -> dict:
    return {
        "ok": _synth is not None,
        "model": settings.model,
        "device": getattr(_synth, "device", None),
    }


@app.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(req: SynthesizeRequest) -> SynthesizeResponse:
    if _synth is None:
        raise HTTPException(status_code=503, detail="Model is still loading")
    try:
        duration, audio, sr = _synth.synthesize(req.text, req.out_path, req.seed)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    words: list[WordTiming] = []
    try:
        from .align import align_words

        words = [WordTiming(word=s.word, start=s.start, end=s.end) for s in align_words(audio, sr, req.text)]
    except Exception as err:  # noqa: BLE001 — alignment is best-effort
        logger.warning("Forced alignment failed (%s) — falling back to beat-level cue", err)
        words = [WordTiming(word=req.text, start=0.0, end=round(duration, 3))]

    return SynthesizeResponse(
        wav_path=req.out_path,
        duration_seconds=round(duration, 3),
        words=words,
    )
