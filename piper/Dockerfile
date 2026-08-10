# Piper TTS HTTP sidecar for mit-dem-baby.
# Serves POST /synthesize, POST /download, GET /voices on :5000.
# German voices are baked in; more can be downloaded at runtime into /voices.
FROM python:3.12-slim

# onnxruntime needs libgomp at runtime; espeak-ng is bundled in the wheel.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "piper-tts[http]"

# Preload a couple of German voices so it works out of the box. Others in the
# catalog are downloaded on demand via the app's Settings → Pronunciation.
RUN python3 -m piper.download_voices \
      de_DE-thorsten-high de_DE-thorsten-medium de_DE-eva_k-x_low \
      --data-dir /voices

EXPOSE 5000

# Default voice is Thorsten (high); any voice present in /voices loads on first
# request without a restart.
CMD ["python3", "-m", "piper.http_server", \
     "-m", "de_DE-thorsten-high", \
     "--data-dir", "/voices", \
     "--host", "0.0.0.0", "--port", "5000"]
