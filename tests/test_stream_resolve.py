"""Stream start-up regressions: client order memory, gate bypass, delayed warm."""
import os, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server as S


def _label(sp):
    return (S.YTM_CLIENT if sp.get("ytm") else sp["client"]).get("clientName")


def test_order_unchanged_without_memory():
    assert S.innertube_order(S._INNERTUBE_PLAYERS, None) == list(S._INNERTUBE_PLAYERS)


def test_last_good_client_first():
    labels = [_label(sp) for sp in S._INNERTUBE_PLAYERS]
    good = labels[-1]
    out = S.innertube_order(S._INNERTUBE_PLAYERS, good)
    assert _label(out[0]) == good and len(out) == len(labels)


def test_innertube_bypasses_full_gate(monkeypatch):
    monkeypatch.setattr(S, "_cached_audio", lambda v: None)
    monkeypatch.setattr(S, "_innertube_audio", lambda v: {"audio_url": "https://x/a", "ext": "m4a"})
    S._full_gate.acquire()          # simulate a slow yt-dlp resolve holding the gate
    try:
        out = {}
        t = threading.Thread(target=lambda: out.setdefault("r", S._resolve_audio("abcdefghijk")))
        t.start(); t.join(2)
        assert out.get("r", {}).get("audio_url") == "https://x/a"
    finally:
        S._full_gate.release()


def test_warm_is_delayed(monkeypatch):
    calls = []
    monkeypatch.setattr(S, "_warm_audio", lambda v, force=False: calls.append(v))
    S._warm_audio_later("abcdefghijk", 0.2)
    assert calls == []
    time.sleep(0.4)
    assert calls == ["abcdefghijk"]
