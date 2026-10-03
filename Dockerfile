FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
# Cloudflare WARP in userspace (no root networking needed): wgcf makes the
# WireGuard profile, wireproxy exposes it as a local HTTP proxy.
RUN curl -fsSL -o /usr/local/bin/wgcf \
        https://github.com/ViRb3/wgcf/releases/download/v2.3.0/wgcf_2.3.0_linux_amd64 \
    && chmod +x /usr/local/bin/wgcf \
    && curl -fsSL https://github.com/pufferffish/wireproxy/releases/download/v1.1.3/wireproxy_linux_amd64.tar.gz \
        | tar -xz -C /usr/local/bin wireproxy

WORKDIR /app
COPY requirements.txt .
# Without yt-dlp-ejs, yt-dlp skips the JS challenge solver: it costs ~13s per
# song on Render's free CPU, and audio-only formats resolve fine without it.
RUN pip install --no-cache-dir -r requirements.txt && pip uninstall -y yt-dlp-ejs
COPY . .

ENV PYTHONUNBUFFERED=1
CMD ["sh", "/app/docker-start.sh"]
