FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno-real
# Cap the V8 heap so one challenge solve can't take the 512 MB instance down.
RUN printf '%s\n' \
        '#!/bin/sh' \
        'HEAP="${DENO_HEAP:-256}"' \
        'case "$1" in -*|"") exec /usr/local/bin/deno-real "$@";; esac' \
        'sub="$1"; shift' \
        'exec /usr/local/bin/deno-real "$sub" --v8-flags=--max-old-space-size="$HEAP" "$@"' \
        > /usr/local/bin/deno \
    && chmod +x /usr/local/bin/deno
# PO token generator, run per request in script mode (a resident server pushed
# the instance past 512 MB). Version must match the pip plugin.
ARG BGUTIL=2.0.1
RUN git clone --depth 1 --single-branch --branch ${BGUTIL} \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && deno-real install --allow-scripts=npm:canvas --frozen
# Cloudflare WARP in userspace (no root networking needed): wgcf makes the
# WireGuard profile, wireproxy exposes it as a local HTTP proxy.
RUN curl -fsSL -o /usr/local/bin/wgcf \
        https://github.com/ViRb3/wgcf/releases/download/v2.3.0/wgcf_2.3.0_linux_amd64 \
    && chmod +x /usr/local/bin/wgcf \
    && curl -fsSL https://github.com/pufferffish/wireproxy/releases/download/v1.1.3/wireproxy_linux_amd64.tar.gz \
        | tar -xz -C /usr/local/bin wireproxy

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PYTHONUNBUFFERED=1
CMD ["sh", "/app/docker-start.sh"]
