"""Quick offline checks: chat upload MIME sniffing (iPhone formats) and lyrics matching.
Run: python -m unittest tests.test_chat_media_lyrics   (from the repo root)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server as s  # noqa: E402


def ftyp(major, *compat):
    body = major + b"\x00\x00\x00\x00" + b"".join(compat)
    return (8 + len(body)).to_bytes(4, "big") + b"ftyp" + body + b"\x00" * 64


class Sniff(unittest.TestCase):
    def t(self, data, kind, want, declared=""):
        self.assertEqual(s._media_sniff(data, kind, declared)[1], want)

    def test_iphone_photo(self):
        self.t(ftyp(b"heic", b"mif1", b"heic"), "image", "image/heic")
        self.t(ftyp(b"mif1", b"heic", b"miaf"), "image", "image/heic")
        self.t(ftyp(b"avif", b"mif1"), "image", "image/avif")
        self.t(b"\xff\xd8\xff\xe1" + b"\x00" * 40, "image", "image/jpeg")

    def test_iphone_video(self):
        self.t(ftyp(b"qt  ", b"qt  "), "video", "video/quicktime")
        self.t(ftyp(b"isom", b"iso2", b"avc1", b"mp41"), "video", "video/mp4")
        self.t(ftyp(b"mp42", b"isom"), "round", "video/mp4")
        self.t(b"\x00\x00\x00\x08wide" + b"\x00" * 40, "video", "video/quicktime")
        self.t(b"\x1a\x45\xdf\xa3" + b"\x00" * 40, "round", "video/webm")

    def test_iphone_audio(self):
        self.t(ftyp(b"M4A ", b"M4A ", b"mp42", b"isom"), "voice", "audio/mp4")
        self.t(ftyp(b"mp42", b"isom"), "audio", "audio/mp4")
        self.t(b"\xff\xf1\x50\x80" + b"\x00" * 40, "audio", "audio/aac")
        self.t(b"caff\x00\x01" + b"\x00" * 40, "audio", "audio/x-caf")
        self.t(b"ID3\x04" + b"\x00" * 40, "audio", "audio/mpeg")

    def test_declared_fallback_only_for_media(self):
        junk = b"\x00\x11\x22\x33" * 10
        self.t(junk, "video", "video/quicktime", "video/quicktime")
        self.t(junk, "audio", "audio/mp4", "audio/x-m4a")
        self.assertEqual(s._media_sniff(junk, "image", "image/heic"), (None, None))
        self.assertEqual(s._media_sniff(b"<html><script>", "video", "text/html"), (None, None))

    def test_reaction_canon(self):
        self.assertEqual(s.chat_react_canon("\u2764"), "\u2764\ufe0f")
        self.assertEqual(s.chat_react_canon("\u2764\ufe0f"), "\u2764\ufe0f")
        self.assertEqual(s.chat_react_canon("\U0001F525"), "\U0001F525")
        self.assertEqual(s.chat_react_canon("x"), "")


class Lyrics(unittest.TestCase):
    def test_identify(self):
        cases = [
            ("Daft Punk - Get Lucky (Official Video) feat. Pharrell Williams", "convar HUN", ("Daft Punk", "Get Lucky")),
            ("Blinding Lights", "The Weeknd - Topic", ("The Weeknd", "Blinding Lights")),
            ("The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO", ("The Weeknd", "Blinding Lights")),
            ("Imagine Dragons - Believer (Lyrics)", "7clouds", ("Imagine Dragons", "Believer")),
            ("Shape of You [Official Video]", "Ed Sheeran", ("Ed Sheeran", "Shape of You")),
        ]
        for raw, ch, want in cases:
            self.assertEqual(s.ly_identify(raw, ch)[:2], want, raw)

    def row(self, artist, title, dur, synced=True):
        return {"artistName": artist, "trackName": title, "duration": dur,
                "syncedLyrics": "[00:01.00] la" if synced else "", "plainLyrics": "la"}

    def test_score_accepts_exact(self):
        self.assertIsNotNone(s.ly_score(self.row("Daft Punk", "Get Lucky", 248), "Daft Punk", "Get Lucky", 249))
        self.assertIsNotNone(s.ly_score(self.row("Daft Punk feat. Pharrell", "Get Lucky (Radio Edit)", 248),
                                        "Daft Punk", "Get Lucky", 248, False))

    def test_score_rejects_mismatch(self):
        self.assertIsNone(s.ly_score(self.row("Some Cover Band", "Get Lucky", 248), "Daft Punk", "Get Lucky", 248))
        self.assertIsNone(s.ly_score(self.row("Daft Punk", "Lose Yourself to Dance", 248), "Daft Punk", "Get Lucky", 248))
        self.assertIsNone(s.ly_score(self.row("Post Malone", "Better Now", 231), "Post Malone", "Circles", 213))
        self.assertIsNone(s.ly_score(self.row("Linkin Park", "Numbers", 188), "Linkin Park", "Numb", 188))

    def test_duration_ranks_not_rejects(self):
        exact = s.ly_judge(self.row("Daft Punk", "Get Lucky", 248), "Daft Punk", "Get Lucky", 249)
        near = s.ly_judge(self.row("Daft Punk", "Get Lucky", 255), "Daft Punk", "Get Lucky", 249)
        mv = s.ly_judge(self.row("Ed Sheeran", "Shape of You", 234), "Ed Sheeran", "Shape of You", 264, True)
        self.assertTrue(exact[1] and near[1])
        self.assertGreater(exact[0], near[0])
        self.assertEqual(mv[1], False)            # MV intro: plain text, no wrong timestamps
        nodur = s.ly_judge(self.row("Daft Punk", "Get Lucky", 248), "Daft Punk", "Get Lucky", 0)
        self.assertIsNotNone(nodur)

    def test_fuzzy_names(self):
        ok = lambda ra, rt, a, t, d=200: s.ly_score(self.row(ra, rt, d), a, t, d)
        self.assertIsNotNone(ok("Скриптонит", "Положение", "Skryptonite", "Положение"))     # translit
        self.assertIsNotNone(ok("ROSALÍA", "DESPECHÁ", "Rosalia", "Despecha"))                # accents
        self.assertIsNotNone(ok("Travis Scott", "Travis Scott - SICKO MODE (Audio)", "Travis Scott", "Sicko Mode"))
        self.assertIsNotNone(ok("Lady Gaga & Bruno Mars", "Die With A Smile", "Bruno Mars", "Die With A Smile"))
        self.assertIsNotNone(ok("Miyagi, Andy Panda", "Kosandra", "Miyagi & Andy Panda", "Kosandra"))

    def test_title_only_needs_exact_and_duration(self):
        r = self.row("Adele", "Hello", 180)
        self.assertIsNone(s.ly_judge(r, "", "Hello", 180))                      # one generic word
        r = self.row("kizaru", "Money long", 135)
        self.assertIsNotNone(s.ly_judge(r, "", "Money long", 135, strict_title=True))
        self.assertIsNone(s.ly_judge(r, "", "Money long", 160, strict_title=True))

    def test_identify_channel_flag(self):
        self.assertEqual(s.ly_identify_ex("Money long", "HAUNTED FAMILY")[3], True)
        self.assertEqual(s.ly_identify_ex("Blinding Lights", "The Weeknd - Topic")[3], False)
        self.assertEqual(s.ly_identify("BTS: Dynamite | The Tonight Show", "Tonight Show")[:2], ("BTS", "Dynamite"))


if __name__ == "__main__":
    unittest.main()
