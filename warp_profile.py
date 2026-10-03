"""Write the saved WARP WireGuard profile from the database to the given path.

Registering a fresh WARP account on every boot gets rate-limited from
datacenter IPs, so the profile is created once and stored in `secrets`.
Exit code 0 = profile written, 1 = none available.
"""
import os
import sys

url = os.environ.get("DATABASE_URL")
if not url:
    sys.exit(1)
try:
    import psycopg

    with psycopg.connect(url, prepare_threshold=None, connect_timeout=15) as con:
        row = con.execute("SELECT value FROM secrets WHERE name='warp_profile'").fetchone()
except Exception as e:
    print(f"warp profile lookup failed: {e}", file=sys.stderr)
    sys.exit(1)
if not row:
    sys.exit(1)
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write(row[0])
