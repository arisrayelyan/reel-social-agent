"""Delivery pace: measure words-per-minute on the rendered audio and stretch
it, pitch-preserved, down to a target.

Why this exists: Chatterbox has no rate parameter. The documented house preset
(cfg 0.3, exaggeration 0.35) was believed to land at 137–145 wpm; measured on
the first published reels it delivered 182–194 wpm (docs/pipeline-learnings.md
§8). The only honest fix is to measure the take and stretch it — ffmpeg's
`atempo` is a WSOLA time-stretch that keeps pitch, and stays clean for speech
down to about 0.8x.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

import torch
import torchaudio as ta

logger = logging.getLogger("tts.pace")

# Below this the WSOLA artefacts (smearing, doubled consonants) become audible.
MIN_STRETCH_FACTOR = 0.80
# Anything closer to 1.0 than this is not worth a re-encode.
NOOP_FACTOR = 0.995


def speech_bounds(audio: torch.Tensor, sr: int, threshold_db: float = -40.0, frame_ms: int = 20) -> tuple[float, float]:
    """(start_s, end_s) of the non-silent span, by frame RMS against a dBFS floor.

    Leading and trailing silence are model artefacts, not delivery, so the pace
    measurement excludes them. Silence BETWEEN sentences is delivery and stays in.
    """
    mono = audio.mean(dim=0) if audio.dim() == 2 else audio
    n = mono.numel()
    if n == 0:
        return 0.0, 0.0
    frame = max(1, int(sr * frame_ms / 1000))
    frames = mono[: (n // frame) * frame].reshape(-1, frame) if n >= frame else mono.reshape(1, -1)
    rms = frames.pow(2).mean(dim=1).sqrt()
    db = 20 * torch.log10(rms.clamp_min(1e-9))
    loud = (db > threshold_db).nonzero().flatten()
    if loud.numel() == 0:
        return 0.0, n / sr
    start = int(loud[0]) * frame / sr
    end = min(n, (int(loud[-1]) + 1) * frame) / sr
    return round(start, 3), round(end, 3)


def measured_wpm(word_count: int, speech_seconds: float) -> float:
    if speech_seconds <= 0 or word_count <= 0:
        return 0.0
    return round(word_count / (speech_seconds / 60.0), 1)


def stretch_factor(measured: float, target: float, floor: float = MIN_STRETCH_FACTOR) -> float:
    """atempo factor that brings `measured` wpm down to `target`, never below `floor`.

    1.0 when the take is already slow enough or when the target is disabled (<= 0).
    """
    if target <= 0 or measured <= 0 or measured <= target:
        return 1.0
    return round(max(floor, target / measured), 3)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def stretch_audio(audio: torch.Tensor, sr: int, factor: float) -> torch.Tensor:
    """Time-stretches `audio` by `factor` (<1 slows it down) with ffmpeg atempo.

    Returns the input unchanged when the factor is a no-op or ffmpeg is missing —
    a missing binary costs pace, never the render.
    """
    if factor >= NOOP_FACTOR:
        return audio
    if not ffmpeg_available():
        logger.warning("ffmpeg not on PATH — narration pace left at the model's native speed")
        return audio
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.wav"
        dst = Path(tmp) / "out.wav"
        ta.save(str(src), audio.cpu(), sr)
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src),
            "-af", f"atempo={factor:.4f}",
            "-ar", str(sr), "-ac", "1",
            str(dst),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        stretched, out_sr = ta.load(str(dst))
    if out_sr != sr:  # ffmpeg honoured -ar; defensive only
        stretched = ta.functional.resample(stretched, out_sr, sr)
    return stretched
