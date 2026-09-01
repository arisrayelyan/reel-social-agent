from app.config import load_settings


def test_defaults_match_house_preset():
    s = load_settings(env={})
    assert s.model == "standard"
    assert s.seed == 42
    assert s.cfg == 0.3
    assert s.exaggeration == 0.35
    assert s.device == "auto"
    assert s.voice_ref is None


def test_env_overrides():
    s = load_settings(env={"TTS_MODEL": "nano", "TTS_SEED": "7", "TTS_VOICE_REF": "ref.wav", "PORT": "5000"})
    assert s.model == "nano"
    assert s.seed == 7
    assert s.voice_ref == "ref.wav"
    assert s.port == 5000


def test_empty_voice_ref_is_none():
    assert load_settings(env={"TTS_VOICE_REF": ""}).voice_ref is None
