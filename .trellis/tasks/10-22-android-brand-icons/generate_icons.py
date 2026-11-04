"""Generate Android launcher icon packaging from the six intact user sources.

This is a one-shot asset packaging helper. It is not referenced by Gradle and
must not be required at build time. It only rescales the supplied artwork and
replaces the source's outer white page with the icon's own background colour;
the artwork itself is not redrawn.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / ".trellis/tasks/10-22-android-brand-recording/assets"
APP = ROOT / "clients/android/app/src/main"
BRAND = APP / "brand"
RES = APP / "res"

EXPECTED_SHA256 = {
    1: "b97b69a63055e95adbefa63e110f009e257b793cadab82c6de04bd0d269c5f8c",
    2: "2aeca781c695090f1e86ce6b3bcd9e7048e88a688121d4aa717d483695a0336a",
    3: "167b2f09a9b3ff5599f4cb4e52ad28750ec943d51d2308c5138a83ff6bf82401",
    4: "cd0d6502c0225a5ea8f7eba0e9ce0294ef11b8d74214fb1b7deae755920ce2ea",
    5: "bf8fa32e76d678f4341b266dbce19f0877a5cd75ab55ded83f3f03712cc2ac1a",
    6: "15779b85f739d8e8acd3c179c273ea70d495ad2ad2ea5b3f6174afd205bcf12f",
}

DENSITY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def background_colour(im: Image.Image) -> tuple[int, int, int]:
    """Sample a ring just inside the supplied rounded-square background."""
    a = np.asarray(im.convert("RGB"))
    nonwhite = a.min(axis=2) < 249
    ys, xs = np.where(nonwhite)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    samples = []
    for x, y in (
        (x0 + 20, (y0 + y1) // 2),
        (x1 - 20, (y0 + y1) // 2),
        ((x0 + x1) // 2, y0 + 20),
        ((x0 + x1) // 2, y1 - 20),
    ):
        samples.append(a[y - 5 : y + 5, x - 5 : x + 5].reshape(-1, 3))
    return tuple(int(v) for v in np.median(np.concatenate(samples), axis=0))


def flatten_outer_white(im: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """Replace only the connected outer white page with the icon background.

    The notebook pages in the supplied art are enclosed by black strokes, so a
    border flood fill cannot reach them. A short dilation removes the antialiased
    fringe between the white page and the rounded square.
    """
    probe = im.convert("RGB").copy()
    ImageDraw.floodfill(probe, (0, 0), (255, 0, 255), thresh=6)
    arr = np.asarray(probe)
    mask = np.all(arr == np.array([255, 0, 255]), axis=2)
    # 8-neighbour dilation of the external mask to cover the white antialias fringe.
    grown = mask.copy()
    for _ in range(8):
        shifted = grown.copy()
        shifted[1:, :] |= grown[:-1, :]
        shifted[:-1, :] |= grown[1:, :]
        shifted[:, 1:] |= grown[:, :-1]
        shifted[:, :-1] |= grown[:, 1:]
        grown = shifted
    src = np.asarray(im.convert("RGB")).copy()
    # Fill the whole dilated exterior (not just white pixels) so the antialiased
    # edge of the supplied rounded square cannot leave a lighter ring when the
    # flattened bitmap sits on the same solid adaptive background.
    src[grown] = bg
    return Image.fromarray(src, "RGB")


def rounded_alpha(size: int, radius_ratio: float = 0.20) -> Image.Image:
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=int(size * scale * radius_ratio),
        fill=255,
    )
    return mask.resize((size, size), Image.LANCZOS)


def circular_alpha(size: int) -> Image.Image:
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def save_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    (RES / "values").mkdir(parents=True, exist_ok=True)
    colors = []
    for icon_id in range(1, 7):
        source = ASSETS / f"icon-{icon_id}-source.png"
        digest = sha256(source)
        if digest != EXPECTED_SHA256[icon_id]:
            raise SystemExit(f"source hash mismatch for icon {icon_id}: {digest}")
        # Byte-for-byte permanent copy; generated resources are derived from it.
        permanent = BRAND / f"icon-{icon_id}-source.png"
        if not permanent.exists() or permanent.read_bytes() != source.read_bytes():
            permanent.write_bytes(source.read_bytes())
        if sha256(permanent) != digest:
            raise SystemExit(f"permanent copy failed for icon {icon_id}")

        original = Image.open(source).convert("RGB")
        bg = background_colour(original)
        colors.append((icon_id, bg))
        flat = flatten_outer_white(original, bg)

        # Settings preview: the supplied rounded-square design, isolated on the
        # card background. Only the outer white page becomes transparent.
        preview = original.resize((192, 192), Image.LANCZOS).convert("RGBA")
        preview.putalpha(rounded_alpha(192, 0.20))
        save_png(preview, RES / "drawable-nodpi" / f"ic_launcher_preview_{icon_id}.png")

        # Adaptive foreground: full artwork on a flat background. The artwork
        # radius stays inside the 66dp adaptive safe circle; no content is cut.
        for density, px in FOREGROUND_SIZES.items():
            save_png(
                flat.resize((px, px), Image.LANCZOS),
                RES / f"drawable-{density}" / f"ic_launcher_{icon_id}_foreground.png",
            )

        # Legacy square and round bitmaps for launchers that do not consume the
        # v26 adaptive XML. Both use the flattened background so no white corner
        # wedges leak through a circular launcher mask.
        for density, px in DENSITY_SIZES.items():
            square = flat.resize((px, px), Image.LANCZOS)
            save_png(square, RES / f"mipmap-{density}" / f"ic_launcher_{icon_id}.png")
            rounded = square.convert("RGBA")
            rounded.putalpha(circular_alpha(px))
            save_png(rounded, RES / f"mipmap-{density}" / f"ic_launcher_round_{icon_id}.png")

        for suffix in (f"ic_launcher_{icon_id}.xml", f"ic_launcher_round_{icon_id}.xml"):
            adaptive = (
                '<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                f'    <background android:drawable="@color/ic_launcher_{icon_id}_background" />\n'
                f'    <foreground android:drawable="@drawable/ic_launcher_{icon_id}_foreground" />\n'
                "</adaptive-icon>\n"
            )
            (RES / "mipmap-anydpi-v26" / suffix).write_text(adaptive, encoding="utf-8")

    color_lines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"]
    for icon_id, (r, g, b) in colors:
        color_lines.append(
            f'    <color name="ic_launcher_{icon_id}_background">#{r:02X}{g:02X}{b:02X}</color>'
        )
    color_lines.append("</resources>")
    (RES / "values" / "colors.xml").write_text("\n".join(color_lines) + "\n", encoding="utf-8")
    print("generated icons:", colors)


if __name__ == "__main__":
    main()
