#!/usr/bin/env python3
"""
speak.py - paste a transcript, get an audio file.

Usage:
    ./speak.py                          # paste transcript, then Ctrl-D
    ./speak.py transcript.txt           # read from a file
    cat transcript.txt | ./speak.py     # read from a pipe
    ./speak.py -t "inline text"         # one-liner

    ./speak.py script.txt --voice ref.wav --out narration.wav
    ./speak.py script.txt --model standard --exaggeration 0.7 --cfg 0.3
    ./speak.py script.txt --model multilingual --lang fr
"""

import os

# Must be set before torch is imported: some chatterbox ops have no MPS kernel
# and need to silently fall back to CPU instead of raising.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import torch
import torchaudio as ta

MODELS = ("turbo", "nano", "standard", "multilingual")

# The English models cap generation at 1000 speech tokens (~40s of audio), so a
# transcript has to be split. ~300 chars lands well inside that with headroom.
DEFAULT_MAX_CHARS = 300


# --------------------------------------------------------------------------- #
# device
# --------------------------------------------------------------------------- #

def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def silence_tqdm() -> None:
    """Chatterbox draws a per-token tqdm bar for every chunk; that's a wall of
    output for a transcript. Patch the class so bars bound at import stay quiet."""
    import tqdm as _tqdm

    original_init = _tqdm.std.tqdm.__init__

    def patched(self, *args, **kwargs):
        kwargs["disable"] = True
        original_init(self, *args, **kwargs)

    _tqdm.std.tqdm.__init__ = patched


def patch_torch_load(device: str) -> None:
    """Checkpoints are CUDA-saved; force map_location so mps/cpu loads work."""
    if device == "cuda":
        return
    original = torch.load
    cpu = torch.device("cpu")

    def patched(*args, **kwargs):
        kwargs.setdefault("map_location", cpu)
        return original(*args, **kwargs)

    torch.load = patched


# --------------------------------------------------------------------------- #
# transcript cleanup
# --------------------------------------------------------------------------- #

# "Alice:", "ALICE:", "Dr. Chen:", "Speaker 1:" at the start of a line.
SPEAKER_RE = re.compile(r"^[ \t]*([A-Z][\w.'\- ]{0,28}?)[ \t]*:[ \t]+")
# "[00:12]", "(1:02:33)", "00:12:33.400 --> 00:12:36.100" (WebVTT/SRT cues).
TIMESTAMP_RE = re.compile(
    r"^[ \t]*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?[\])]?"
    r"(?:[ \t]*-+>[ \t]*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?[\])]?)?[ \t]*"
)
# A bare SRT cue index on its own line.
CUE_INDEX_RE = re.compile(r"^[ \t]*\d{1,5}[ \t]*$")
# "[crosstalk]", "(laughs)" - stage directions the English models can't speak.
# Turbo/Nano paralinguistic tags are kept; see PARALINGUISTIC.
# The exact tags Turbo/Nano render, from upstream's gradio_tts_turbo_app.py.
PARALINGUISTIC = {
    "clear throat", "sigh", "shush", "cough", "groan",
    "sniff", "gasp", "chuckle", "laugh",
}
# Variants people actually type, folded onto the canonical tag above.
PARALINGUISTIC_ALIASES = {
    "laughs": "laugh", "laughter": "laugh", "laughing": "laugh",
    "chuckles": "chuckle", "chuckling": "chuckle",
    "coughs": "cough", "coughing": "cough",
    "sighs": "sigh", "sighing": "sigh",
    "gasps": "gasp", "gasping": "gasp",
    "sniffs": "sniff", "sniffing": "sniff", "sniffle": "sniff",
    "groans": "groan", "groaning": "groan",
    "shushes": "shush",
    "clears throat": "clear throat", "clearing throat": "clear throat",
    "throat clear": "clear throat", "clears his throat": "clear throat",
    "clears her throat": "clear throat", "clears their throat": "clear throat",
}
BRACKETED_RE = re.compile(r"[\[(]([^\])]{1,40})[\])]")


def _normalise_tag(match: re.Match) -> str:
    """Keep real paralinguistic tags (normalised to `[canonical]`), drop the rest.

    Turns `(laughs)` into `[laugh]` so transcripts written for humans still
    trigger the model's tags, and strips `[crosstalk]`-style stage direction
    that would otherwise be read aloud.
    """
    inner = " ".join(match.group(1).split()).lower()
    canonical = PARALINGUISTIC_ALIASES.get(inner, inner)
    return f"[{canonical}]" if canonical in PARALINGUISTIC else " "


def clean_transcript(text: str, strip_speakers: bool, strip_cues: bool,
                     keep_tags: bool) -> str:
    lines = []
    for line in text.splitlines():
        if strip_cues:
            if CUE_INDEX_RE.match(line):
                continue
            line = TIMESTAMP_RE.sub("", line)
        if strip_speakers:
            line = SPEAKER_RE.sub("", line)
        if not keep_tags:
            line = BRACKETED_RE.sub(_normalise_tag, line)
        lines.append(line.rstrip())

    out = "\n".join(lines)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# --------------------------------------------------------------------------- #
# chunking
# --------------------------------------------------------------------------- #

ABBREVIATIONS = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "jr.", "sr.", "vs.", "no.",
    "inc.", "ltd.", "co.", "fig.", "approx.", "dept.", "est.", "e.g.", "i.e.",
    "etc.", "al.", "u.s.", "u.k.", "a.m.", "p.m.",
}
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?…])[\"'”’)\]]*\s+")
CLAUSE_SPLIT_RE = re.compile(r"(?<=[,;:—])\s+")


def _ends_with_abbreviation(text: str) -> bool:
    tail = text.rstrip().split()[-1].lower() if text.strip() else ""
    if tail in ABBREVIATIONS:
        return True
    # A single initial, e.g. "Ronald A. Fisher".
    return bool(re.fullmatch(r"[a-z]\.", tail))


def split_sentences(paragraph: str) -> list[str]:
    parts = SENTENCE_SPLIT_RE.split(paragraph)
    merged: list[str] = []
    for part in parts:
        if merged and _ends_with_abbreviation(merged[-1]):
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return [p.strip() for p in merged if p.strip()]


def _pack(pieces: list[str], max_chars: int) -> list[str]:
    packed: list[str] = []
    buf = ""
    for piece in pieces:
        if not buf:
            buf = piece
        elif len(buf) + 1 + len(piece) <= max_chars:
            buf = f"{buf} {piece}"
        else:
            packed.append(buf)
            buf = piece
    if buf:
        packed.append(buf)
    return packed


def split_long_sentence(sentence: str, max_chars: int) -> list[str]:
    """Break an over-long sentence on clause boundaries, then on words."""
    if len(sentence) <= max_chars:
        return [sentence]

    out: list[str] = []
    for clause in _pack(CLAUSE_SPLIT_RE.split(sentence), max_chars):
        if len(clause) <= max_chars:
            out.append(clause)
            continue
        for piece in _pack(clause.split(), max_chars):
            # A single token can still exceed the budget (long URL, base64 blob).
            # Slice it so nothing ever overruns the model's text window.
            while len(piece) > max_chars:
                out.append(piece[:max_chars])
                piece = piece[max_chars:]
            if piece:
                out.append(piece)
    return out


def _merge_runts(packed: list[str], max_chars: int, min_chars: int) -> list[str]:
    """Fold undersized chunks into a neighbour; short prompts generate poorly."""
    merged: list[str] = []
    for chunk in packed:
        if (merged and len(chunk) < min_chars
                and len(merged[-1]) + 1 + len(chunk) <= max_chars):
            merged[-1] = f"{merged[-1]} {chunk}"
        else:
            merged.append(chunk)
    # A runt in first position has no predecessor to fold into, so push it right.
    if len(merged) > 1 and len(merged[0]) < min_chars \
            and len(merged[0]) + 1 + len(merged[1]) <= max_chars:
        merged[1] = f"{merged[0]} {merged[1]}"
        merged.pop(0)
    return merged


def chunk_transcript(text: str, max_chars: int) -> list[tuple[str, bool]]:
    """Return (chunk, ends_paragraph) pairs, sentence-aligned where possible."""
    min_chars = min(40, max_chars // 2)
    chunks: list[tuple[str, bool]] = []
    for paragraph in re.split(r"\n\s*\n", text):
        paragraph = " ".join(paragraph.split())
        if not paragraph:
            continue

        pieces: list[str] = []
        for sentence in split_sentences(paragraph):
            pieces.extend(split_long_sentence(sentence, max_chars))

        packed = _merge_runts(_pack(pieces, max_chars), max_chars, min_chars)
        for i, chunk in enumerate(packed):
            chunks.append((chunk, i == len(packed) - 1))
    return chunks


# --------------------------------------------------------------------------- #
# input
# --------------------------------------------------------------------------- #

def read_transcript(args) -> str:
    if args.text:
        return args.text
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    if not sys.stdin.isatty():
        return sys.stdin.read()

    eof = "Ctrl-Z then Enter" if os.name == "nt" else "Ctrl-D"
    print(f"Paste your transcript, then press {eof} on a blank line:\n",
          file=sys.stderr)
    return sys.stdin.read()


# --------------------------------------------------------------------------- #
# model
# --------------------------------------------------------------------------- #

def build_model(name: str, device: str):
    if name in ("turbo", "nano"):
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        return ChatterboxTurboTTS.from_pretrained(device=device, nano=(name == "nano"))
    if name == "standard":
        from chatterbox.tts import ChatterboxTTS
        return ChatterboxTTS.from_pretrained(device=device)
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    return ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")


def prepare_voice(model, name: str, voice: str, exaggeration: float) -> None:
    """Compute speaker conditionals once, so every chunk shares one voice."""
    if name in ("turbo", "nano"):
        model.prepare_conditionals(voice, exaggeration=0.0)
    else:
        model.prepare_conditionals(voice, exaggeration=exaggeration)


def generation_kwargs(name: str, args) -> dict:
    if name in ("turbo", "nano"):
        # Turbo/Nano ignore CFG + exaggeration and warn if they are non-zero.
        return dict(
            temperature=args.temperature,
            top_p=args.top_p if args.top_p is not None else 0.95,
            top_k=args.top_k,
            repetition_penalty=args.repetition_penalty,
        )
    kwargs = dict(
        temperature=args.temperature,
        exaggeration=args.exaggeration,
        cfg_weight=args.cfg,
        min_p=args.min_p,
        top_p=args.top_p if args.top_p is not None else 1.0,
        repetition_penalty=args.repetition_penalty,
    )
    if name == "multilingual":
        kwargs["language_id"] = args.lang
    return kwargs


# --------------------------------------------------------------------------- #
# output
# --------------------------------------------------------------------------- #

def to_mp3(wav_path: Path) -> Path | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("  (skipping mp3: ffmpeg not on PATH)", file=sys.stderr)
        return None
    mp3_path = wav_path.with_suffix(".mp3")
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav_path),
         "-codec:a", "libmp3lame", "-qscale:a", "2", str(mp3_path)],
        check=True,
    )
    return mp3_path


def format_duration(seconds: float) -> str:
    minutes, secs = divmod(int(round(seconds)), 60)
    return f"{minutes}m{secs:02d}s" if minutes else f"{secs}s"


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Turn a pasted transcript into an audio file with Chatterbox.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("file", nargs="?", help="transcript file (default: stdin / paste)")
    p.add_argument("-t", "--text", help="inline text instead of a file")
    p.add_argument("-o", "--out", default="output.wav", help="output wav (default: output.wav)")
    p.add_argument("--mp3", action="store_true", help="also write an mp3 next to the wav")

    p.add_argument("-m", "--model", default="turbo", choices=MODELS,
                   help="turbo=fast English (default), nano=CPU-friendly, "
                        "standard=CFG/exaggeration controls, multilingual=23 languages")
    p.add_argument("--voice", help="reference clip (~10s wav/mp3) to clone; omit for the built-in voice")
    p.add_argument("--lang", default="en", help="language id for --model multilingual (default: en)")
    p.add_argument("--device", default="auto", choices=("auto", "cuda", "mps", "cpu"))

    p.add_argument("--exaggeration", type=float, default=0.5,
                   help="emotion intensity, standard/multilingual only (default: 0.5)")
    p.add_argument("--cfg", type=float, default=0.5,
                   help="CFG weight; lower = slower, more deliberate pacing (default: 0.5)")
    p.add_argument("--temperature", type=float, default=0.8)
    p.add_argument("--min-p", type=float, default=0.05)
    p.add_argument("--top-p", type=float, default=None)
    p.add_argument("--top-k", type=int, default=1000, help="turbo/nano only")
    p.add_argument("--repetition-penalty", type=float, default=1.2)
    p.add_argument("--seed", type=int, help="fix the RNG for reproducible takes")

    p.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS,
                   help=f"max characters per generated chunk (default: {DEFAULT_MAX_CHARS})")
    p.add_argument("--gap", type=float, default=0.20,
                   help="seconds of silence between chunks (default: 0.20)")
    p.add_argument("--para-gap", type=float, default=0.45,
                   help="seconds of silence between paragraphs (default: 0.45)")

    p.add_argument("--strip-speakers", action="store_true",
                   help='drop leading "Name:" labels from transcript lines')
    p.add_argument("--keep-cues", action="store_true",
                   help="keep SRT/VTT timestamps and cue numbers instead of dropping them")
    p.add_argument("--keep-tags", action="store_true",
                   help="keep all [bracketed] text (default keeps only paralinguistic tags)")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="show the model's per-token progress bars")
    p.add_argument("--dry-run", action="store_true",
                   help="print the chunks that would be spoken, then exit")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    raw = read_transcript(args)
    text = clean_transcript(
        raw,
        strip_speakers=args.strip_speakers,
        strip_cues=not args.keep_cues,
        keep_tags=args.keep_tags,
    )
    if not text:
        print("No text to speak.", file=sys.stderr)
        return 1

    chunks = chunk_transcript(text, args.max_chars)
    print(f"{len(text)} chars -> {len(chunks)} chunk(s)", file=sys.stderr)

    if args.dry_run:
        for i, (chunk, ends_para) in enumerate(chunks, 1):
            marker = " <para>" if ends_para else ""
            print(f"\n[{i:>3}] ({len(chunk)} chars){marker}\n{chunk}")
        return 0

    device = pick_device(args.device)
    patch_torch_load(device)
    print(f"device: {device} | model: {args.model}", file=sys.stderr)

    load_started = time.perf_counter()
    model = build_model(args.model, device)
    print(f"model loaded in {time.perf_counter() - load_started:.1f}s", file=sys.stderr)

    if not args.verbose:
        silence_tqdm()

    if args.voice:
        prepare_voice(model, args.model, args.voice, args.exaggeration)
        print(f"voice: {args.voice}", file=sys.stderr)
    elif model.conds is None:
        print("This model has no built-in voice; pass --voice ref.wav", file=sys.stderr)
        return 1

    kwargs = generation_kwargs(args.model, args)
    sr = model.sr
    gap = torch.zeros(1, int(sr * args.gap))
    para_gap = torch.zeros(1, int(sr * args.para_gap))

    pieces: list[torch.Tensor] = []
    started = time.perf_counter()
    for i, (chunk, ends_para) in enumerate(chunks, 1):
        if args.seed is not None:
            torch.manual_seed(args.seed + i)

        chunk_started = time.perf_counter()
        wav = model.generate(chunk, **kwargs)
        elapsed = time.perf_counter() - chunk_started
        seconds = wav.shape[-1] / sr

        preview = chunk if len(chunk) <= 60 else chunk[:57] + "..."
        print(f"[{i}/{len(chunks)}] {seconds:5.1f}s audio in {elapsed:5.1f}s "
              f"({seconds / elapsed:.2f}x realtime)  {preview}", file=sys.stderr)

        pieces.append(wav)
        if i < len(chunks):
            pieces.append(para_gap if ends_para else gap)

    audio = torch.cat(pieces, dim=-1)
    out_path = Path(args.out)
    if out_path.parent != Path(""):
        out_path.parent.mkdir(parents=True, exist_ok=True)
    ta.save(str(out_path), audio, sr)

    total = time.perf_counter() - started
    duration = audio.shape[-1] / sr
    print(f"\n{out_path}  ({format_duration(duration)} @ {sr} Hz, "
          f"generated in {format_duration(total)}, {duration / total:.2f}x realtime)",
          file=sys.stderr)

    if args.mp3:
        mp3_path = to_mp3(out_path)
        if mp3_path:
            print(f"{mp3_path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
