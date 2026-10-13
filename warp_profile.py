"""Load/save the WARP WireGuard profile in Postgres `secrets`.

Registering a fresh WARP account on every boot gets rate-limited from
datacenter IPs, so the profile is created once and reused.
  python warp_profile.py PATH          # load, exit 0 if written
  python warp_profile.py PATH --save   # persist PATH into the database
"""
import os
import sys

url = os.environ.get("DATABASE_URL")
if not url or len(sys.argv) < 2:
    sys.exit(1)

path = sys.argv[1]
save = "--save" in sys.argv[2:]

try:
    import psycopg
except Exception:
    sys.exit(1)

try:
    with psycopg.connect(url, prepare_threshold=None, connect_timeout=15) as con:
        con.execute(
            "CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        if save:
            value = open(path, encoding="utf-8").read()
            if not value.strip():
                sys.exit(1)
            con.execute(
                "INSERT INTO secrets(name, value) VALUES (%s, %s) "
                "ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value",
                ("warp_profile", value),
            )
            con.commit()
            print("WARP profile saved to database")
            sys.exit(0)
        row = con.execute(
            "SELECT value FROM secrets WHERE name='warp_profile'"
        ).fetchone()
except Exception as e:
    print(f"warp profile lookup failed: {e}", file=sys.stderr)
    sys.exit(1)

if save or not row:
    sys.exit(1)
with open(path, "w", encoding="utf-8") as f:
    f.write(row[0])
