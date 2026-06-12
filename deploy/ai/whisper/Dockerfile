FROM python@sha256:8dca233de9f3d9bb410665f00a4da6dd06f331083137e0e98ccf227236fcc438

ARG WHISPER_MODEL=small
ARG WHISPER_MODEL_URL=https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt
ARG WHISPER_MODEL_SHA256=9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/opt/signacare/whisper \
    WHISPER_CACHE_DIR=/opt/signacare/whisper/cache \
    WHISPER_MODEL=${WHISPER_MODEL} \
    WHISPER_MODEL_SHA256=${WHISPER_MODEL_SHA256}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python -m pip install --upgrade pip==26.1.2 \
  && python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.12.0 \
  && python -m pip install flask==3.1.3 flask-cors==6.0.2 gunicorn==23.0.0 openai-whisper==20250625

COPY deploy/whisper-server/server.py /app/server.py
COPY deploy/ai/whisper/entrypoint.sh /usr/local/bin/signacare-whisper
RUN chmod +x /usr/local/bin/signacare-whisper \
  && mkdir -p /opt/signacare/whisper/cache

RUN set -eux; \
  target="${WHISPER_CACHE_DIR}/${WHISPER_MODEL}.pt"; \
  curl -fsSL "$WHISPER_MODEL_URL" -o "$target"; \
  actual="$(sha256sum "$target" | awk '{print $1}')"; \
  test "$actual" = "$WHISPER_MODEL_SHA256"; \
  python -c "import os, whisper; whisper.load_model(os.environ['WHISPER_MODEL'], device='cpu', download_root=os.environ['WHISPER_CACHE_DIR'])"

EXPOSE 8080

CMD ["/usr/local/bin/signacare-whisper"]
