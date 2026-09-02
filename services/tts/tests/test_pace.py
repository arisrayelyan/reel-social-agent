"""Pace math and the ffmpeg stretch — no model, no GPU."""
import math

import pytest
import torch

from app.pace import (
    MIN_STRETCH_FACTOR,
    ffmpeg_available,
    measured_wpm,
    speech_bounds,
    stretch_audio,
    stretch_factor,
)
from app.synth import sentence_units


def test_stretch_factor_brings_fast_speech_to_target():
    assert stretch_factor(170.0, 145.0) == pytest.approx(145 / 170, abs=1e-3)


def test_stretch_factor_never_below_floor():
    assert stretch_factor(400.0, 145.0) == MIN_STRETCH_FACTOR


def test_stretch_factor_is_noop_when_already_slow_or_disabled():
    assert stretch_factor(140.0, 145.0) == 1.0
    assert stretch_factor(190.0, 0.0) == 1.0
    assert stretch_factor(0.0, 145.0) == 1.0


def test_measured_wpm():
    assert measured_wpm(30, 10.0) == 180.0
    assert measured_wpm(0, 10.0) == 0.0
    assert measured_wpm(10, 0.0) == 0.0


def test_speech_bounds_trims_leading_and_trailing_silence():
    sr = 16000
    t = torch.arange(sr) / sr
    tone = 0.3 * torch.sin(2 * math.pi * 220 * t)
    audio = torch.cat([torch.zeros(sr // 2), tone, torch.zeros(sr // 4)]).unsqueeze(0)
    start, end = speech_bounds(audio, sr)
    assert start == pytest.approx(0.5, abs=0.03)
    assert end == pytest.approx(1.5, abs=0.03)


def test_speech_bounds_on_silence_returns_full_span():
    sr = 16000
    assert speech_bounds(torch.zeros(1, sr), sr) == (0.0, 1.0)


def test_sentence_units_one_generation_per_sentence():
    units = sentence_units("Told to stay indoors. Over twenty thousand never got out.")
    assert units == [
        ("Told to stay indoors.", True),
        ("Over twenty thousand never got out.", True),
    ]


def test_sentence_units_folds_fragments_into_previous_sentence():
    units = sentence_units("It does not splash. It shoves. Ok.")
    assert units[-1][0].endswith("It shoves. Ok.")


def test_sentence_units_splits_an_overlong_sentence_with_intra_flags():
    long = ("the tank groaned all through that winter while the neighbours complained again and again " * 4).strip() + "."
    units = sentence_units(long, max_chars=120)
    assert len(units) > 1
    assert [ends for _, ends in units] == [False] * (len(units) - 1) + [True]


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg not on PATH")
def test_stretch_audio_lengthens_by_the_factor_and_keeps_sample_rate():
    sr = 24000
    t = torch.arange(sr) / sr
    audio = (0.3 * torch.sin(2 * math.pi * 220 * t)).unsqueeze(0)
    out = stretch_audio(audio, sr, 0.8)
    assert out.shape[0] == 1
    assert out.shape[-1] / sr == pytest.approx(1.25, abs=0.05)


def test_stretch_audio_noop_near_one():
    audio = torch.zeros(1, 1000)
    assert stretch_audio(audio, 16000, 0.999) is audio
