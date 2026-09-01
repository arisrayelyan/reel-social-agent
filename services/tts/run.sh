#!/usr/bin/env bash
# Runs the TTS service natively (macOS: keeps MPS acceleration, which Docker cannot use).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating venv (python 3.11 via uv)..."
  uv venv --python 3.11 .venv
  uv sync --python .venv
fi

exec uv run --python .venv uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-4042}"
