"""Warm-model synthesis built on speak.py (the migrated CLI).

The model is loaded once per process (cold load ~90s on Apple Silicon) and the
speaker conditionals are computed once, so every beat of every video shares
one narrator voice. `torch.manual_seed(seed + i)` per chunk keeps takes
reproducible (docs/pipeline-learnings.md §8).
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

# speak.py sets PYTORCH_ENABLE_MPS_FALLBACK before importing torch — import it first.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import speak  # noqa: E402

import torch  # noqa: E402
import torchaudio as ta  # noqa: E402

from .config import Settings  # noqa: E402

import re  # noqa: E402

_TAG_RE = re.compile(r"\[[^\]]{1,40}\]")
# punctuation that Chatterbox's punc_norm accepts as a sentence ender but that
# produces rising, unfinished intonation — the "speaker wants to continue" bug
_NON_TERMINAL = ",-;:—–"


def prepare_text(text: str, model_name: str) -> str:
    """Model-aware transcript prep on top of speak.clean_transcript.

    - Paralinguistic tags ([laugh], [sigh], …) are a turbo/nano-only feature;
      the standard/multilingual models would read them aloud, so strip them.
    - Guarantee terminal punctuation (., !, ?): punc_norm treats a trailing
      comma or dash as a sentence ender, which makes the delivery trail
      upward as if the narration were cut off mid-thought.
    """
    cleaned = speak.clean_transcript(text, strip_speakers=False, strip_cues=True, keep_tags=False)
    if model_name not in ("turbo", "nano"):
        lines = [" ".join(_TAG_RE.sub(" ", line).split()) for line in cleaned.splitlines()]
        cleaned = "\n".join(lines).strip()
    stripped = cleaned.rstrip()
    while stripped and stripped[-1] in _NON_TERMINAL:
        stripped = stripped[:-1].rstrip()
    if stripped and stripped[-1] not in ".!?":
        stripped += "."
    return stripped


class Synthesizer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device = speak.pick_device(settings.device)
        self._lock = threading.Lock()  # chatterbox models are not thread-safe
        speak.patch_torch_load(self.device)

        started = time.perf_counter()
        self.model = speak.build_model(settings.model, self.device)
        self.load_seconds = time.perf_counter() - started

        if settings.voice_ref:
            speak.prepare_voice(self.model, settings.model, settings.voice_ref, settings.exaggeration)
        elif self.model.conds is None:
            raise RuntimeError(f"Model {settings.model} has no built-in voice; set TTS_VOICE_REF")

    def _generation_kwargs(self) -> dict:
        s = self.settings
        if s.model in ("turbo", "nano"):
            return dict(temperature=0.8, top_p=0.95, top_k=1000, repetition_penalty=1.2)
        kwargs = dict(
            temperature=0.8,
            exaggeration=s.exaggeration,
            cfg_weight=s.cfg,
            min_p=0.05,
            top_p=1.0,
            repetition_penalty=1.2,
        )
        if s.model == "multilingual":
            kwargs["language_id"] = "en"
        return kwargs

    def synthesize(self, text: str, out_path: str, seed: int | None = None) -> tuple[float, torch.Tensor, int]:
        """Renders `text` to `out_path` (wav). Returns (duration_s, audio, sr)."""
        cleaned = prepare_text(text, self.settings.model)
        if not cleaned:
            raise ValueError("No text to speak after cleanup")
        chunks = speak.chunk_transcript(cleaned, speak.DEFAULT_MAX_CHARS)

        effective_seed = seed if seed is not None else self.settings.seed
        sr = self.model.sr
        gap = torch.zeros(1, int(sr * 0.20))
        kwargs = self._generation_kwargs()

        with self._lock:
            pieces: list[torch.Tensor] = []
            for i, (chunk, _ends_para) in enumerate(chunks, 1):
                torch.manual_seed(effective_seed + i)
                wav = self.model.generate(chunk, **kwargs)
                pieces.append(wav)
                if i < len(chunks):
                    pieces.append(gap)
            audio = torch.cat(pieces, dim=-1)

        path = Path(out_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        ta.save(str(path), audio.cpu(), sr)
        duration = audio.shape[-1] / sr
        return duration, audio.cpu(), sr
