#!/bin/sh
# Route YouTube traffic through Cloudflare WARP: YouTube refuses Render's
# datacenter IPs. Any failure here falls back to a direct connection.
set -u
cd /tmp
PROFILE=/tmp/wgcf-profile.conf

if [ "${WARP:-1}" = "1" ]; then
  if python /app/warp_profile.py "$PROFILE"; then
    echo "WARP profile loaded from database"
  elif wgcf register --accept-tos >/dev/null 2>&1 && wgcf generate >/dev/null 2>&1; then
    echo "WARP profile freshly registered"
  else
    echo "WARP registration failed; going direct"
    rm -f "$PROFILE"
  fi

  if [ -f "$PROFILE" ]; then
    # IPv4 only: stream URLs are bound to one IP, and a tunnel that exits over
    # both v4 and v6 can resolve on one and download on the other.
    sed -i -E '/^(Address|AllowedIPs|DNS) *= *[^ ]*:/d' "$PROFILE"
    cat > wireproxy.conf <<EOF
WGConfig = $PROFILE

[http]
BindAddress = 127.0.0.1:40001
EOF
    wireproxy -c wireproxy.conf >/tmp/wireproxy.log 2>&1 &
    i=0
    while [ $i -lt 30 ]; do
      if curl -s -o /dev/null -x http://127.0.0.1:40001 --max-time 5 https://www.cloudflare.com/cdn-cgi/trace; then
        export YT_PROXY=http://127.0.0.1:40001
        echo "WARP up: $(curl -s -x http://127.0.0.1:40001 https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|warp)=' | tr '\n' ' ')"
        break
      fi
      i=$((i + 1))
      sleep 1
    done
    [ -z "${YT_PROXY:-}" ] && echo "WARP proxy never came up; going direct" && cat /tmp/wireproxy.log
  fi
fi

cd /app
exec python server.py
