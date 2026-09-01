from app.synth import prepare_text


def test_strips_tags_for_standard_model():
    # tags are turbo/nano-only; standard would read them aloud
    assert prepare_text("He opened the door. [sigh] Nothing was there.", "standard") == (
        "He opened the door. Nothing was there."
    )


def test_keeps_paralinguistic_tags_for_turbo():
    out = prepare_text("He opened the door. (sighs) Nothing.", "turbo")
    assert "[sigh]" in out


def test_trailing_comma_becomes_period():
    # punc_norm accepts a trailing comma as a sentence ender -> unfinished intonation
    assert prepare_text("The lake is still loaded,", "standard").endswith("loaded.")


def test_trailing_dash_becomes_period():
    assert prepare_text("And then the lights died —", "standard").endswith("died.")


def test_terminal_punctuation_preserved():
    assert prepare_text("Would you have believed it?", "standard").endswith("?")
    assert prepare_text("It never happened again.", "standard").endswith("again.")


def test_stage_direction_stripped_everywhere():
    assert "[dramatic pause]" not in prepare_text("Wait. [dramatic pause] Listen.", "standard")
