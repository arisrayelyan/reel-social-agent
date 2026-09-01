#!/usr/bin/env python3
"""Report median F0 of a wav, as a rough speaker-gender / register check."""
import sys
import librosa
import numpy as np

for path in sys.argv[1:]:
    y, sr = librosa.load(path, sr=22050, mono=True)
    f0, voiced, _ = librosa.pyin(
        y, fmin=60, fmax=400, sr=sr, frame_length=2048,
    )
    vals = f0[~np.isnan(f0)]
    if vals.size == 0:
        print(f"{path}: no voiced frames detected")
        continue

    median = float(np.median(vals))
    p10, p90 = np.percentile(vals, [10, 90])
    voiced_pct = 100.0 * voiced.mean()

    if median < 155:
        register = "male"
    elif median < 175:
        register = "ambiguous / low female or high male"
    else:
        register = "female"

    print(f"{path}")
    print(f"  median F0 : {median:6.1f} Hz  -> {register}")
    print(f"  10-90 pct : {p10:6.1f} - {p90:.1f} Hz")
    print(f"  voiced    : {voiced_pct:.0f}% of frames")
