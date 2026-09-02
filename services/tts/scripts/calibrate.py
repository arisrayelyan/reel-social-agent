#!/usr/bin/env python3
"""Free pace calibration against the RUNNING TTS service.

Synthesizes a fixed 60-word documentary paragraph and prints the model's
native wpm, the stretch applied and the delivered wpm — plus a re-measurement
from the forced-alignment word timings, so the number is verified on the wav
that actually plays. Wavs land in --out so you can listen.

    pnpm tts:calibrate                      # service defaults
    pnpm tts:calibrate -- --target-wpm 140 --gap 0.5
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

PARAGRAPH = (
    "The tank stood five storeys high on the harbour front. It held two and a half "
    "million gallons of molasses, waiting to become alcohol. Neighbours had complained "
    "for years. The seams wept. Children carried home cups of the sweet drips. "
    "At half past twelve the rivets let go, and a brown wave fifteen feet high "
    "crossed the street faster than a man could run."
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("TTS_URL", "http://localhost:4042"))
    ap.add_argument("--target-wpm", type=float, default=None, help="override; 0 disables the stretch")
    ap.add_argument("--gap", type=float, default=None, help="sentence gap seconds; 0 = one chunk per beat")
    ap.add_argument("--out", default=os.environ.get("TTS_CALIBRATE_OUT", "/tmp/tts-calibrate"))
    ap.add_argument("--text", default=PARAGRAPH)
    # pnpm forwards a literal "--" separator; argparse must not see it
    args = ap.parse_args([a for a in sys.argv[1:] if a != "--"])

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = f"wpm{args.target_wpm if args.target_wpm is not None else 'default'}_gap{args.gap if args.gap is not None else 'default'}"
    wav = out_dir / f"calibrate_{tag}.wav"

    body = {"text": args.text, "out_path": str(wav), "seed": 42}
    if args.target_wpm is not None:
        body["target_wpm"] = args.target_wpm
    if args.gap is not None:
        body["sentence_gap_s"] = args.gap
    req = urllib.request.Request(
        f"{args.url}/synthesize",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as res:
        data = json.load(res)

    words = data["words"]
    span = (words[-1]["end"] - words[0]["start"]) if len(words) > 1 else data["duration_seconds"]
    aligned_wpm = data["word_count"] / (span / 60) if span > 0 else 0
    print(f"text words        : {data['word_count']}")
    print(f"native wpm        : {data['measured_wpm']}")
    print(f"stretch factor    : {data['stretch_factor']}")
    print(f"delivery wpm      : {data['delivery_wpm']}  (service estimate)")
    print(f"aligned wpm       : {aligned_wpm:.0f}  (from word timings on the final wav)")
    print(f"duration          : {data['duration_seconds']}s")
    print(f"wav               : {wav}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
