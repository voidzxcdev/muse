from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(__file__).resolve().parents[2] / "static" / "muselogo.png"
RES = ROOT / "app" / "src" / "main" / "res"
WHITE = (255, 255, 255, 255)

logo = Image.open(SRC).convert("RGBA")
arr = np.array(logo)
luma = arr[:, :, :3].astype(np.int32).sum(2)
alpha = arr[:, :, 3]
ys, xs = np.where((luma > 180) & (alpha > 20))
minx, maxx = int(xs.min()), int(xs.max())
miny, maxy = int(ys.min()), int(ys.max())
cx = (minx + maxx) / 2.0
cy = (miny + maxy) / 2.0
side = int(max(maxx - minx, maxy - miny)) + 4
left = max(0, int(round(cx - side / 2.0)))
top = max(0, int(round(cy - side / 2.0)))
cropped = logo.crop((left, top, left + side, top + side)).resize(
    (1024, 1024), Image.Resampling.LANCZOS
)

c = np.array(cropped)
cluma = c[:, :, :3].astype(np.int32).sum(2)
h, w = cluma.shape
yy, xx = np.ogrid[:h, :w]
dist = np.sqrt((xx - w / 2.0) ** 2 + (yy - h / 2.0) ** 2)
r = min(w, h) / 2.0
keep = (cluma < 520) & (dist < r * 0.97) & (c[:, :, 3] > 8)
aa = np.clip(255 - cluma // 3, 0, 255).astype(np.uint8)
wave = np.zeros((h, w, 4), dtype=np.uint8)
wave[:, :, 3] = np.where(keep, aa, 0)
wave_im = Image.fromarray(wave, "RGBA")


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def disc_with_wave(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    white = Image.new("RGBA", (size, size), WHITE)
    canvas.paste(white, mask=circle_mask(size))
    canvas.alpha_composite(wave_im.resize((size, size), Image.Resampling.LANCZOS))
    return canvas


legacy = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
for folder, size in legacy.items():
    d = RES / folder
    d.mkdir(parents=True, exist_ok=True)
    icon = disc_with_wave(size)
    icon.save(d / "ic_launcher.png")
    icon.save(d / "ic_launcher_round.png")

fg = {
    "drawable-mdpi": 108,
    "drawable-hdpi": 162,
    "drawable-xhdpi": 216,
    "drawable-xxhdpi": 324,
    "drawable-xxxhdpi": 432,
}
for folder, size in fg.items():
    d = RES / folder
    d.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(round(size * 0.72))
    pad = (size - inner) // 2
    canvas.alpha_composite(
        wave_im.resize((inner, inner), Image.Resampling.LANCZOS), (pad, pad)
    )
    canvas.save(d / "ic_launcher_foreground.png")
    canvas.save(d / "ic_launcher_monochrome.png")

print("icons ok")
