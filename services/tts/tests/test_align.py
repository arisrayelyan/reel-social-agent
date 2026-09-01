from app.align import normalize_word


def test_normalize_lowercases_and_strips_punctuation():
    assert normalize_word("Hello,") == "hello"
    assert normalize_word("don't") == "don't"
    assert normalize_word("WORLD!") == "world"


def test_normalize_drops_digits_and_symbols():
    # narration should never contain digits, but alignment must not crash on them
    assert normalize_word("1986") == ""
    assert normalize_word("co2-level") == "colevel"
