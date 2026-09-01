"""Word-level timings via torchaudio's MMS forced aligner.

The narration text is KNOWN, so we align it against the audio we just
generated — never transcribe (docs/pipeline-decisions.md §5 adapted to a
timestamp-less TTS). Runs on CPU: a 15-second beat aligns in well under a
second, and CPU avoids MPS op gaps.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import torch
import torchaudio
import torchaudio.functional as F


@dataclass
class WordSpan:
    word: str
    start: float
    end: float


_bundle = None
_model = None
_dictionary: dict[str, int] | None = None


def _load_aligner():
    global _bundle, _model, _dictionary
    if _model is None:
        _bundle = torchaudio.pipelines.MMS_FA
        _model = _bundle.get_model(with_star=False).to("cpu").eval()
        _dictionary = _bundle.get_dict(star=None)
    return _bundle, _model, _dictionary


def normalize_word(word: str) -> str:
    """MMS_FA's dictionary covers lowercase a–z and apostrophe."""
    return re.sub(r"[^a-z']", "", word.lower())


def align_words(audio: torch.Tensor, sample_rate: int, text: str) -> list[WordSpan]:
    """Returns per-word (start, end) seconds for `text` inside `audio`.

    Raises on failure — callers fall back to beat-level cues, which are exact
    by construction.
    """
    bundle, model, dictionary = _load_aligner()
    assert bundle is not None and dictionary is not None

    original_words = [w for w in text.strip().split() if w]
    normalized = [normalize_word(w) for w in original_words]
    pairs = [(orig, norm) for orig, norm in zip(original_words, normalized) if norm]
    if not pairs:
        raise ValueError("No alignable words in text")

    waveform = audio.mean(dim=0, keepdim=True) if audio.dim() == 2 and audio.size(0) > 1 else audio
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    if sample_rate != bundle.sample_rate:
        waveform = torchaudio.functional.resample(waveform, sample_rate, bundle.sample_rate)

    with torch.inference_mode():
        emission, _ = model(waveform)

    tokens = [dictionary[c] for _, norm in pairs for c in norm]
    targets = torch.tensor([tokens], dtype=torch.int32)
    alignments, scores = F.forced_align(emission, targets, blank=0)
    token_spans = F.merge_tokens(alignments[0], scores[0].exp())

    # frame index -> seconds
    ratio = waveform.size(1) / emission.size(1) / bundle.sample_rate

    spans: list[WordSpan] = []
    cursor = 0
    for orig, norm in pairs:
        length = len(norm)
        word_tokens = token_spans[cursor : cursor + length]
        cursor += length
        if not word_tokens:
            continue
        spans.append(
            WordSpan(
                word=orig,
                start=round(word_tokens[0].start * ratio, 3),
                end=round(word_tokens[-1].end * ratio, 3),
            )
        )
    if not spans:
        raise ValueError("Forced alignment produced no spans")
    return spans
