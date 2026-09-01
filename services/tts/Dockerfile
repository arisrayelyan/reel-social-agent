# For future Linux/CUDA deployment. On macOS run natively (./run.sh) — Docker
# cannot reach MPS and falls back to slow CPU inference.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV HF_HUB_DISABLE_XET=1 \
    TOKENIZERS_PARALLELISM=false \
    PYTHONUNBUFFERED=1

WORKDIR /srv/tts
COPY pyproject.toml ./
COPY chatterbox ./chatterbox
RUN pip install --no-cache-dir uv && uv pip install --system -e ./chatterbox \
    fastapi uvicorn python-dotenv pydantic

COPY speak.py voicecheck.py ./
COPY app ./app

# Model weights (~3GB) download lazily on first request; mount a volume to persist:
#   -v hf-cache:/root/.cache/huggingface
EXPOSE 4042
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4042"]
