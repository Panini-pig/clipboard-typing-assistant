"""Generate localized Microsoft Edge Add-ons store assets (zh + en)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "store"
OUT = ROOT / "tools" / "out"
ICON = ROOT / "extension" / "icons" / "icon512.png"

FONT_EN_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_EN_SEMI = "C:/Windows/Fonts/seguisb.ttf"
FONT_EN_REG = "C:/Windows/Fonts/segoeui.ttf"
FONT_ZH_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_ZH_REG = "C:/Windows/Fonts/msyh.ttc"

BG_TOP = (9, 14, 28)
BG_BOTTOM = (18, 28, 54)
WHITE = (248, 250, 252)
MUTED = (148, 163, 184)
SOFT = (203, 213, 225)
INDIGO = (165, 180, 252)
CYAN = (34, 211, 238)
GREEN = (134, 239, 172)
BORDER = (42, 53, 80)

SHOT = {
    "en": {
        "eyebrow": "MICROSOFT EDGE ADD-ON",
        "title1": "Paste is blocked?",
        "title2": "Type it instead.",
        "paragraph": "Clipboard Typing Assistant fills text fields by simulating keystrokes. No paste event, no retyping.",
        "bullets": [
            "textarea, input, contenteditable and iframes",
            "Native input events for React / Vue editors",
            "100% local — no network, no tracking",
        ],
        "footer": "Clipboard Typing Assistant  ·  v1.1",
        "caption": "Settings  ·  character-by-character or whole-text input",
        "title_size": 54,
        "paragraph_size": 19,
        "bullet_size": 16,
    },
    "zh": {
        "eyebrow": "MICROSOFT EDGE 加载项",
        "title1": "粘贴被禁用？",
        "title2": "改用键入。",
        "paragraph": "用模拟键盘输入填入文本框，不触发粘贴事件，也不用重新打字。",
        "bullets": [
            "支持 textarea、input、contenteditable 和 iframe",
            "兼容 React / Vue 富文本编辑器",
            "100% 本地处理，不联网、不上传",
        ],
        "footer": "剪贴板键入助手  ·  v1.1",
        "caption": "设置  ·  逐字键入 / 整段输入",
        "title_size": 54,
        "paragraph_size": 18,
        "bullet_size": 16,
    },
}

SMALL = {
    "en": {
        "title1": "Clipboard",
        "title2": "Typing Assistant",
        "tagline": "Paste as typing for Microsoft Edge",
        "chips": [("NO PASTE EVENT", INDIGO), ("100% LOCAL", (103, 232, 249))],
        "footer": "Microsoft Edge Add-on",
        "title_size": 27,
        "tagline_size": 13,
    },
    "zh": {
        "title1": "剪贴板",
        "title2": "键入助手",
        "tagline": "在禁止粘贴的输入框里，用键盘输入",
        "chips": [("无粘贴事件", INDIGO), ("100% 本地", (103, 232, 249))],
        "footer": "Microsoft Edge 加载项",
        "title_size": 27,
        "tagline_size": 12.5,
    },
}

LARGE = {
    "en": {
        "eyebrow": "MICROSOFT EDGE ADD-ON",
        "title": "Clipboard Typing Assistant",
        "tagline": "Type clipboard content into fields that block pasting.",
        "chips": ["Native input events", "Character-by-character", "100% local"],
        "card_label": "Message",
        "card_text": "Hello, world!",
        "card_status": "Typed with 0 paste events",
        "card_hint": "Right-click  ·  Alt+Shift+V",
        "title_size": 50,
        "tagline_size": 22,
    },
    "zh": {
        "eyebrow": "MICROSOFT EDGE 加载项",
        "title": "剪贴板键入助手",
        "tagline": "把剪贴板内容以模拟键盘输入的方式填进输入框。",
        "chips": ["原生输入事件", "逐字 / 整段", "100% 本地"],
        "card_label": "消息",
        "card_text": "你好，世界！",
        "card_status": "已输入 · 0 次粘贴事件",
        "card_hint": "右键菜单  ·  Alt+Shift+V",
        "title_size": 56,
        "tagline_size": 22,
    },
}


def font(size: int, weight: str = "regular", lang: str = "en") -> ImageFont.FreeTypeFont:
    if lang.startswith("zh"):
        path = FONT_ZH_BOLD if weight in {"bold", "semi"} else FONT_ZH_REG
    else:
        path = {
            "bold": FONT_EN_BOLD,
            "semi": FONT_EN_SEMI,
            "regular": FONT_EN_REG,
        }[weight]
    return ImageFont.truetype(path, int(round(size)), index=0)


def fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    size: float,
    weight: str,
    lang: str,
    min_size: float = 11,
) -> ImageFont.FreeTypeFont:
    current = size
    fnt = font(current, weight, lang)
    while draw.textlength(text, font=fnt) > max_width and current > min_size:
        current -= 1
        fnt = font(current, weight, lang)
    return fnt


def vertical_gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    width, height = size
    img = Image.new("RGB", size, bottom)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return img.convert("RGBA")


def add_glow(base: Image.Image, center: tuple[int, int], radius: int, color: tuple, alpha: int) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x, y = center
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius // 2))
    base.alpha_composite(layer)


def add_grid(base: Image.Image, step: int = 48, alpha: int = 8) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    width, height = base.size
    for x in range(0, width, step):
        draw.line([(x, 0), (x, height)], fill=(255, 255, 255, alpha), width=1)
    for y in range(0, height, step):
        draw.line([(0, y), (width, y)], fill=(255, 255, 255, alpha), width=1)
    base.alpha_composite(layer)


def background(width: int, height: int) -> Image.Image:
    base = vertical_gradient((width, height), BG_TOP, BG_BOTTOM)
    add_glow(base, (int(width * 0.18), int(height * 0.05)), int(width * 0.35), (79, 70, 229), 55)
    add_glow(base, (int(width * 0.92), int(height * 0.95)), int(width * 0.32), (8, 145, 178), 45)
    add_grid(base)
    return base


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill: tuple,
    tracking: int = 0,
) -> None:
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=fnt, fill=fill, anchor="la")
        x += draw.textlength(char, font=fnt) + tracking


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    fnt: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = (line + " " + word).strip()
        if draw.textlength(candidate, font=fnt) <= max_width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def chip(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill: tuple,
    text_fill: tuple,
    outline: tuple | None = None,
    padding_x: int = 14,
    padding_y: int = 7,
    radius: int = 16,
) -> int:
    x, y = xy
    text_width = draw.textlength(text, font=fnt)
    height = fnt.size + padding_y * 2
    width = int(text_width + padding_x * 2)
    draw.rounded_rectangle(
        [x, y, x + width, y + height],
        radius=radius,
        fill=fill,
        outline=outline,
        width=1 if outline else 0,
    )
    draw.text((x + padding_x, y + padding_y - 1), text, font=fnt, fill=text_fill, anchor="la")
    return width


def shadowed_icon(base: Image.Image, icon: Image.Image, box: tuple[int, int, int, int], radius: int = 24) -> None:
    x, y, width, height = box
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.rounded_rectangle(
        [x + 4, y + 14, x + width + 4, y + height + 14],
        radius=radius,
        fill=(0, 0, 0, 130),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    base.alpha_composite(shadow)

    resized = icon.resize((width, height), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=255)
    base.paste(resized, (x, y), mask)


def paste_rounded(base: Image.Image, img: Image.Image, box: tuple[int, int, int, int], radius: int = 20) -> None:
    x, y, width, height = box
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.rounded_rectangle(
        [x + 2, y + 16, x + width + 2, y + height + 16],
        radius=radius,
        fill=(0, 0, 0, 150),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    base.alpha_composite(shadow)

    resized = img.resize((width, height), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=255)
    base.paste(resized, (x, y), mask)
    ImageDraw.Draw(base).rounded_rectangle(
        [x, y, x + width, y + height],
        radius=radius,
        outline=(63, 76, 110),
        width=1,
    )


def bullet(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt: ImageFont.FreeTypeFont) -> None:
    x, y = xy
    draw.ellipse([x, y + 1, x + 20, y + 21], fill=(79, 70, 229))
    draw.line([(x + 5, y + 11), (x + 9, y + 15), (x + 15, y + 6)], fill=(255, 255, 255), width=2)
    draw.text((x + 32, y + 1), text, font=fnt, fill=SOFT, anchor="la")


def make_logo() -> None:
    icon = Image.open(ICON).convert("RGBA")
    icon.resize((300, 300), Image.LANCZOS).save(STORE / "logo-300.png", optimize=True)
    print("wrote store/logo-300.png")


def make_small_promo(icon: Image.Image, lang: str) -> None:
    cfg = SMALL[lang]
    width, height = 440, 280
    base = background(width, height)
    draw = ImageDraw.Draw(base)

    shadowed_icon(base, icon, (28, 28, 64, 64), radius=18)
    draw = ImageDraw.Draw(base)

    title_font = font(cfg["title_size"], "bold", lang)
    draw.text((108, 30), cfg["title1"], font=title_font, fill=WHITE, anchor="la")
    draw.text((108, 62), cfg["title2"], font=title_font, fill=WHITE, anchor="la")

    tagline_font = fit_font(draw, cfg["tagline"], 380, cfg["tagline_size"], "regular", lang)
    draw.text((28, 122), cfg["tagline"], font=tagline_font, fill=SOFT, anchor="la")

    draw.line([(28, 166), (412, 166)], fill=BORDER, width=1)

    chip_font = font(11, "semi", lang)
    x = 28
    for label, text_color in cfg["chips"]:
        width_chip = chip(
            draw,
            (x, 206),
            label,
            chip_font,
            fill=(18, 28, 52),
            text_fill=text_color,
            outline=(79, 70, 229) if text_color == INDIGO else (8, 145, 178),
            padding_x=11,
            padding_y=6,
            radius=12,
        )
        x += width_chip + 8

    draw.text((28, 246), cfg["footer"], font=font(10, "regular", lang), fill=MUTED, anchor="la")
    base.convert("RGB").save(STORE / f"small-promo-{lang}-440x280.png", optimize=True)
    print(f"wrote store/small-promo-{lang}-440x280.png")


def make_large_promo(icon: Image.Image, lang: str) -> None:
    cfg = LARGE[lang]
    width, height = 1400, 560
    base = background(width, height)
    draw = ImageDraw.Draw(base)

    shadowed_icon(base, icon, (88, 112, 132, 132), radius=32)
    draw = ImageDraw.Draw(base)

    draw_tracked(draw, (262, 92), cfg["eyebrow"], font(13, "semi", lang), INDIGO, tracking=2)

    title_font = fit_font(draw, cfg["title"], 640, cfg["title_size"], "bold", lang)
    draw.text((260, 120), cfg["title"], font=title_font, fill=WHITE, anchor="la")

    tagline_font = fit_font(draw, cfg["tagline"], 620, cfg["tagline_size"], "regular", lang)
    draw.text((262, 192), cfg["tagline"], font=tagline_font, fill=SOFT, anchor="la")

    chip_font = font(15, "semi", lang)
    x = 262
    for label in cfg["chips"]:
        w = chip(
            draw,
            (x, 258),
            label,
            chip_font,
            fill=(18, 28, 52),
            text_fill=SOFT,
            outline=(71, 85, 120),
            padding_x=14,
            padding_y=8,
            radius=18,
        )
        x += w + 10

    # Floating input card.
    card_x, card_y, card_w, card_h = 924, 132, 396, 296
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [card_x + 4, card_y + 16, card_x + card_w + 4, card_y + card_h + 16],
        radius=26,
        fill=(0, 0, 0, 150),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    base.alpha_composite(shadow)

    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle(
        [card_x, card_y, card_x + card_w, card_y + card_h],
        radius=26,
        fill=(13, 20, 38),
        outline=(48, 60, 92),
        width=1,
    )
    for index, color in enumerate([(239, 68, 68), (245, 158, 11), (34, 197, 94)]):
        cx = card_x + 26 + index * 18
        draw.ellipse([cx, card_y + 22, cx + 8, card_y + 30], fill=color)

    draw.text(
        (card_x + 26, card_y + 52),
        cfg["card_label"],
        font=font(13, "regular", lang),
        fill=MUTED,
        anchor="la",
    )
    draw.rounded_rectangle(
        [card_x + 22, card_y + 80, card_x + card_w - 22, card_y + 168],
        radius=14,
        fill=(9, 15, 30),
        outline=(48, 60, 92),
        width=1,
    )

    text_font = fit_font(draw, cfg["card_text"], 290, 26, "regular", lang)
    draw.text((card_x + 44, card_y + 106), cfg["card_text"], font=text_font, fill=WHITE, anchor="la")
    text_w = draw.textlength(cfg["card_text"], font=text_font)
    draw.rounded_rectangle(
        [card_x + 44 + text_w + 4, card_y + 108, card_x + 44 + text_w + 7, card_y + 146],
        radius=2,
        fill=CYAN,
    )

    draw.ellipse([card_x + 30, card_y + 208, card_x + 40, card_y + 218], fill=(34, 197, 94))
    draw.text(
        (card_x + 50, card_y + 202),
        cfg["card_status"],
        font=font(14, "semi", lang),
        fill=GREEN,
        anchor="la",
    )
    draw.text(
        (card_x + 26, card_y + 244),
        cfg["card_hint"],
        font=font(13, "regular", lang),
        fill=MUTED,
        anchor="la",
    )

    base.convert("RGB").save(STORE / f"large-promo-{lang}-1400x560.png", optimize=True)
    print(f"wrote store/large-promo-{lang}-1400x560.png")


def make_screenshot_settings(popup_path: Path, out_path: Path, lang: str) -> None:
    cfg = SHOT[lang]
    width, height = 1280, 800
    base = background(width, height)
    draw = ImageDraw.Draw(base)

    draw_tracked(draw, (80, 78), cfg["eyebrow"], font(13, "semi", lang), INDIGO, tracking=2)
    title_font = font(cfg["title_size"], "bold", lang)
    draw.text((80, 112), cfg["title1"], font=title_font, fill=WHITE, anchor="la")
    draw.text((80, 178), cfg["title2"], font=title_font, fill=CYAN, anchor="la")

    paragraph_font = font(cfg["paragraph_size"], "regular", lang)
    if lang.startswith("zh"):
        paragraphs = [cfg["paragraph"]]
        while draw.textlength(paragraphs[0], font=paragraph_font) > 600 and paragraph_font.size > 14:
            paragraph_font = font(paragraph_font.size - 1, "regular", lang)
    else:
        paragraphs = wrap_text(draw, cfg["paragraph"], paragraph_font, 560)

    y = 286
    for line in paragraphs:
        draw.text((80, y), line, font=paragraph_font, fill=SOFT, anchor="la")
        y += 30

    bullet_font = font(cfg["bullet_size"], "regular", lang)
    y = 384
    for line in cfg["bullets"]:
        bullet(draw, (80, y), line, bullet_font)
        y += 42

    small_icon = Image.open(ICON).convert("RGBA").resize((30, 30), Image.LANCZOS)
    base.alpha_composite(small_icon, (80, 700))
    draw = ImageDraw.Draw(base)
    draw.text((120, 705), cfg["footer"], font=font(13, "regular", lang), fill=MUTED, anchor="la")

    popup = Image.open(popup_path).convert("RGBA")
    paste_rounded(base, popup, (852, 80, 360, 640), radius=20)
    draw = ImageDraw.Draw(base)
    draw.text((852, 736), cfg["caption"], font=font(12, "regular", lang), fill=MUTED, anchor="la")

    base.convert("RGB").save(out_path, optimize=True)
    print(f"wrote {out_path.relative_to(ROOT)}")


def make_screenshot_zh_test_page() -> None:
    page = Image.open(OUT / "test-page-zh-full.png").convert("RGB")
    target_width = 1280
    target_height = round(page.height * target_width / page.width)
    page = page.resize((target_width, target_height), Image.LANCZOS)
    page = page.crop((0, 0, target_width, 800))
    page.save(STORE / "screenshot-zh-2.png", optimize=True)
    print("wrote store/screenshot-zh-2.png")


def check_en_test_page() -> None:
    path = STORE / "screenshot-en-2.png"
    image = Image.open(path)
    print(f"screenshot-en-2.png: {image.size}")
    if image.size != (1280, 800):
        raise SystemExit("screenshot-en-2.png must be 1280x800")


def main() -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    icon = Image.open(ICON).convert("RGBA")

    make_logo()

    for lang in ("en", "zh"):
        make_small_promo(icon, lang)
        make_large_promo(icon, lang)

    make_screenshot_settings(OUT / "popup-en.png", STORE / "screenshot-en-1.png", "en")
    make_screenshot_settings(OUT / "popup-zh.png", STORE / "screenshot-zh-1.png", "zh")
    make_screenshot_zh_test_page()
    check_en_test_page()


if __name__ == "__main__":
    main()
