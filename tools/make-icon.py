#!/usr/bin/env python
"""生成 dsh-skill-audit 的 512x512 头像：深蓝底 + 盾牌 + 对勾。

用法：
    E:\\python313\\python.exe tools/make-icon.py

依赖 Pillow。输出 assets/icon.png（512×512 PNG）。
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "icon.png"))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))  # type: ignore[return-value]


def build_background() -> Image.Image:
    """深蓝对角渐变 + 中心冷光 + 暗角。"""
    img = Image.new("RGB", (SIZE, SIZE), (8, 18, 38))
    px = img.load()
    top = (7, 17, 38)
    bottom = (13, 48, 92)
    for y in range(SIZE):
        for x in range(SIZE):
            t = (y * 0.8 + (SIZE - x) * 0.35) / (SIZE * 1.15)
            px[x, y] = mix(top, bottom, max(0.0, min(1.0, t)))

    # 中心冷光
    glow = Image.new("L", (SIZE, SIZE), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((70, 40, 442, 400), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    tint = Image.new("RGB", (SIZE, SIZE), (18, 92, 160))
    img = Image.composite(tint, img, glow.point(lambda v: int(v * 0.55)))

    # 暗角
    vignette = Image.new("L", (SIZE, SIZE), 0)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse((-140, -140, SIZE + 140, SIZE + 140), fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(110))
    dark = Image.new("RGB", (SIZE, SIZE), (3, 8, 18))
    img = Image.composite(img, dark, vignette)
    return img


def shield_points() -> list[tuple[float, float]]:
    """带弧线底部的盾牌轮廓（右侧下行 -> 二次曲线收到底尖）。"""
    left, right = 118.0, 394.0
    top, shoulder, tip = 104.0, 300.0, 428.0
    points: list[tuple[float, float]] = [(left, top), (right, top), (right, shoulder)]
    cx, cy = (left + right) / 2.0, tip
    control = (right, 388.0)
    steps = 30
    for i in range(1, steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * right + 2 * (1 - t) * t * control[0] + t**2 * cx
        y = (1 - t) ** 2 * shoulder + 2 * (1 - t) * t * control[1] + t**2 * cy
        points.append((x, y))
    control_l = (left, 388.0)
    for i in range(1, steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * cx + 2 * (1 - t) * t * control_l[0] + t**2 * left
        y = (1 - t) ** 2 * cy + 2 * (1 - t) * t * control_l[1] + t**2 * shoulder
        points.append((x, y))
    return points


def draw_icon() -> Image.Image:
    img = build_background().convert("RGB")

    # 细网格（扫描台质感）
    grid = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for pos in range(32, SIZE, 48):
        gd.line((pos, 0, pos, SIZE), fill=(120, 200, 255, 12), width=1)
        gd.line((0, pos, SIZE, pos), fill=(120, 200, 255, 12), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), grid).convert("RGB")

    # 盾牌外发光
    glow_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow_layer)
    points = shield_points()
    gdraw.polygon(points, fill=(34, 211, 238, 160))
    gdraw.line(points + [points[0]], fill=(94, 234, 255, 220), width=18, joint="curve")
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(26))
    img = Image.alpha_composite(img.convert("RGBA"), glow_layer).convert("RGB")

    draw = ImageDraw.Draw(img)

    # 盾牌本体：上浅下深的蓝绿
    shield_mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(shield_mask).polygon(points, fill=255)
    body = Image.new("RGB", (SIZE, SIZE), (10, 62, 100))
    bpx = body.load()
    for y in range(SIZE):
        t = max(0.0, min(1.0, (y - 90) / 350.0))
        color = mix((16, 106, 138), (18, 46, 120), t)
        for x in range(SIZE):
            bpx[x, y] = color
    sheen = Image.new("L", (SIZE, SIZE), 0)
    sd = ImageDraw.Draw(sheen)
    sd.polygon([(118, 104), (394, 104), (394, 220), (118, 300)], fill=70)
    sheen = sheen.filter(ImageFilter.GaussianBlur(26))
    body = Image.composite(Image.new("RGB", (SIZE, SIZE), (120, 220, 255)), body, sheen.point(lambda v: int(v * 0.5)))
    img = Image.composite(body, img, shield_mask).convert("RGB")

    # 盾牌描边 + 内侧细线
    draw = ImageDraw.Draw(img)
    draw.line(points + [points[0]], fill=(94, 234, 255), width=11, joint="curve")
    inner = [(x * 0.86 + 256 * 0.14, y * 0.86 + 250 * 0.14) for x, y in points]
    draw.line(inner + [inner[0]], fill=(56, 189, 248), width=2, joint="curve")

    # 对勾（白色圆头折线）
    check = [(188, 258), (238, 314), (338, 176)]
    draw.line(check, fill=(255, 255, 255), width=30, joint="curve")
    for x, y in check:
        r = 15
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255))

    # 对勾投影（在盾牌上留一点层次）
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.line([(cx + 3, cy + 6) for cx, cy in check], fill=(3, 16, 32, 110), width=30, joint="curve")
    shadow = shadow.filter(ImageFilter.GaussianBlur(7))
    img = Image.alpha_composite(img.convert("RGBA"), shadow).convert("RGB")
    draw = ImageDraw.Draw(img)
    draw.line(check, fill=(255, 255, 255), width=30, joint="curve")
    for x, y in check:
        r = 15
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255))

    # 角落装饰：三个小点 + 两条引线（扫描 / 信号）
    accent = (125, 211, 252)
    for cx, cy, r in [(74, 430, 5), (92, 430, 3), (110, 430, 3)]:
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=accent)
    draw.line((74, 410, 74, 400), fill=accent, width=3)
    draw.line((74, 400, 96, 400), fill=accent, width=3)
    for cx, cy, r in [(438, 82, 4), (438, 100, 3)]:
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=accent)

    # 外圈细边框（圆角）
    frame = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle((10, 10, SIZE - 11, SIZE - 11), radius=96, outline=(125, 211, 252, 70), width=2)
    img = Image.alpha_composite(img.convert("RGBA"), frame).convert("RGB")

    return img


def main() -> None:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    icon = draw_icon()
    icon = icon.resize((SIZE, SIZE), Image.LANCZOS)
    icon.save(OUT, "PNG", optimize=True)
    size = os.path.getsize(OUT)
    with Image.open(OUT) as check:
        print(f"icon: {OUT}")
        print(f"size: {check.size[0]}x{check.size[1]}  {check.mode}  {size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
