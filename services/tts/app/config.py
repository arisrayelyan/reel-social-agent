"""Typed settings, read from the environment exactly once."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    port: int
    model: str            # standard | turbo | nano | multilingual
    seed: int
    cfg: float            # standard/multilingual only — house preset 0.3
    exaggeration: float   # house preset 0.35 (flat, factual)
    device: str           # auto -> cuda > mps > cpu
    voice_ref: str | None # optional ~10s reference clip, locks timbre harder than a seed
    # Delivery pace. Chatterbox exposes no rate control and the house preset
    # measures 182–194 wpm on real beats (2 Sep 2026), so pace is produced
    # AFTER synthesis: silence between sentences plus a pitch-preserving
    # time-stretch down to target_wpm (0 disables the stretch).
    target_wpm: float
    sentence_gap_s: float


def load_settings(env: dict[str, str] | None = None) -> Settings:
    e = env if env is not None else dict(os.environ)
    return Settings(
        port=int(e.get("PORT", "4042")),
        model=e.get("TTS_MODEL", "standard"),
        seed=int(e.get("TTS_SEED", "42")),
        cfg=float(e.get("TTS_CFG", "0.3")),
        exaggeration=float(e.get("TTS_EXAGGERATION", "0.35")),
        device=e.get("TTS_DEVICE", "auto"),
        voice_ref=e.get("TTS_VOICE_REF") or None,
        target_wpm=float(e.get("TTS_TARGET_WPM", "152")),
        sentence_gap_s=float(e.get("TTS_SENTENCE_GAP_SECONDS", "0.35")),
    )
