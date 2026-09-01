"""API tests with a stubbed synthesizer — no model load, no GPU.

A real end-to-end synthesis test (loads ~3GB of weights) runs only with
RUN_SLOW=1.
"""
import os

import pytest
import torch
from fastapi.testclient import TestClient

import app.main as main


class StubSynth:
    device = "cpu"
    load_seconds = 0.0

    def synthesize(self, text: str, out_path: str, seed=None):
        sr = 16000
        audio = torch.zeros(1, sr * 2)  # 2s of silence
        return 2.0, audio, sr


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main, "_synth", StubSynth())
    # TestClient triggers lifespan; _synth is already set so no model loads
    with TestClient(main.app) as c:
        yield c


def test_health_reports_model_and_device(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["device"] == "cpu"


def test_synthesize_returns_duration_and_fallback_words(client, tmp_path):
    out = str(tmp_path / "beat.wav")
    res = client.post("/synthesize", json={"text": "hello world", "out_path": out})
    assert res.status_code == 200
    body = res.json()
    assert body["wav_path"] == out
    assert body["duration_seconds"] == 2.0
    # alignment (or its beat-level fallback) must produce monotonic word spans
    assert len(body["words"]) >= 1
    assert body["words"][0]["start"] >= 0.0
    assert body["words"][-1]["end"] <= 2.0 + 0.1


def test_synthesize_validates_body(client):
    res = client.post("/synthesize", json={"text": ""})
    assert res.status_code == 422


@pytest.mark.skipif(os.environ.get("RUN_SLOW") != "1", reason="loads real model weights")
def test_real_synthesis(tmp_path):
    from app.config import load_settings
    from app.synth import Synthesizer

    synth = Synthesizer(load_settings())
    duration, audio, sr = synth.synthesize(
        "This is a short verification sentence.", str(tmp_path / "real.wav")
    )
    assert duration > 0.5
    assert (tmp_path / "real.wav").exists()
