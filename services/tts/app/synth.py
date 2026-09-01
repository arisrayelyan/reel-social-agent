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
        cleaned = speak.clean_transcript(text, strip_speakers=False, strip_cues=True, keep_tags=False)
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
