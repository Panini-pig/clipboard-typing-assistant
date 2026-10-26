"""Generate the extension icons (clipboard + typing caret) with Pillow."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
C1 = np.array([79, 70, 229], dtype=np.float32)   # indigo
C2 = np.array([8, 145, 178], dtype=np.float32)   # cyan
INDIGO = (79, 70, 229, 255)
CYAN = (8, 145, 178, 255)

OUT_DIR = Path(__file__).resolve().parent.parent / "extension" / "icons"


def gradient() -> Image.Image:
    x = np.linspace(0.0, 1.0, SIZE, dtype=np.float32)[None, :]
    y = np.linspace(0.0, 1.0, SIZE, dtype=np.float32)[:, None]
    t = np.clip(x * 0.55 + y * 0.45, 0.0, 1.0)[..., None]
    rgb = C1[None, None, :] * (1.0 - t) + C2[None, None, :] * t
    alpha = np.full((SIZE, SIZE, 1), 255.0, dtype=np.float32)
    arr = np.concatenate([rgb, alpha], axis=2).astype(np.uint8)
    return Image.fromarray(arr, mode="RGBA")


def build() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1], radius=112, fill=255
    )

    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base.paste(gradient(), (0, 0), mask)

    # Drop shadow under the clipboard.
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [146, 136, 374, 440], radius=46, fill=(0, 0, 0, 72)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(shadow)

    draw = ImageDraw.Draw(base)

    # Clipboard board.
    draw.rounded_rectangle([140, 118, 372, 430], radius=46, fill=(255, 255, 255, 255))

    # Clip at the top.
    draw.rounded_rectangle([214, 84, 298, 158], radius=26, fill=(255, 255, 255, 255))
    draw.rounded_rectangle([234, 104, 278, 128], radius=12, fill=INDIGO)

    # Text lines.
    draw.rounded_rectangle([178, 204, 334, 226], radius=11, fill=INDIGO)
    draw.rounded_rectangle([178, 256, 306, 278], radius=11, fill=(99, 102, 241, 255))
    draw.rounded_rectangle([178, 308, 334, 330], radius=11, fill=(129, 140, 248, 255))

    # Typing caret with a baseline.
    draw.rounded_rectangle([296, 356, 310, 404], radius=7, fill=CYAN)
    draw.rounded_rectangle([282, 408, 324, 418], radius=5, fill=(8, 145, 178, 235))

    return base


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    icon = build()
    for size in (16, 32, 48, 128):
        resized = icon.resize((size, size), Image.LANCZOS)
        resized.save(OUT_DIR / f"icon{size}.png", format="PNG", optimize=True)
        print("wrote", OUT_DIR / f"icon{size}.png")

    icon.save(OUT_DIR / "icon512.png", format="PNG", optimize=True)


if __name__ == "__main__":
    main()
