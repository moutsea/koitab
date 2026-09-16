#!/usr/bin/env python3
"""
KoiTab logo pipeline — requires Pillow only.

输入:手绘水墨 logo(白纸黑墨 + 红色笔尖)
输出:宣纸底黑墨的统一图标 —— 手绘原样保留,底板颜色与水墨界面同调(不区分深浅色主题)

  extension/icons/icon{16,32,48,128}.png   插件工具栏图标
  nextjs/public/assets/logo.png (512px)    当前官网页头 / 页脚
  nextjs/public/assets/favicon.png (64px)  浏览器标签页图标
  landing/assets/                         同步保留旧版静态页资源

用法:
  python3 tools/apply-logo.py            生成正式图标
  python3 tools/apply-logo.py --preview  生成 preview/fill-comparison.png 对比图

调主体大小:改 FILL(墨迹占图标比例),再重跑。
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "logo-source.jpg")

WORK = 640            # 处理分辨率上限(输出最大 512,足够)
TRIM_THRESHOLD = 25   # 淡于此值的像素视为纸张噪点,裁剪时忽略
FILL = 0.86           # 墨迹占图标比例(已裁净留白后的真实占比)
RADIUS_RATIO = 0.22   # 圆角半径占边长比例
PAPER_PLATE = (245, 240, 228, 255)   # 宣纸色底板,同 popup 的 --paper #f5f0e4
BORDER_ALPHA = 26     # 底板细描边透明度,让纸色在浅色工具栏上也有边界
ALPHA_GAIN = 1.12     # 墨色浓度增益,保证细笔画在小尺寸不消失

PREVIEW_FILLS = [0.72, 0.80, 0.86, 0.94]
LIGHT_BG = (241, 243, 244)   # Chrome 浅色工具栏
DARK_BG = (32, 33, 36)       # Chrome 深色工具栏


def unmix_white_background(img):
    """C = a*F + (1-a)*255 反混合:用最小通道估算墨色浓度作为 alpha,
    同时还原前景真实颜色(保留红色笔尖)。"""
    px = img.load()
    w, h = img.size
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            a = 255 - min(r, g, b)
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            af = a / 255.0
            fr = max(0, min(255, round((r - 255 * (1 - af)) / af)))
            fg = max(0, min(255, round((g - 255 * (1 - af)) / af)))
            fb = max(0, min(255, round((b - 255 * (1 - af)) / af)))
            op[x, y] = (fr, fg, fb, a)
    return out


def load_ink(fill_note=True):
    """原图 -> 反混合 -> 按阈值裁掉纸张噪点 -> 裁到墨迹包围盒 -> 提升浓度"""
    src = Image.open(SRC).convert("RGB")
    if max(src.size) > WORK:
        ratio = WORK / max(src.size)
        src = src.resize((round(src.width * ratio), round(src.height * ratio)),
                         Image.LANCZOS)

    ink = unmix_white_background(src)

    # 关键:先把淡噪点清零,再 getbbox();否则包围盒会等于整张画布
    alpha = ink.getchannel("A").point(lambda v: 0 if v < TRIM_THRESHOLD else v)
    ink.putalpha(alpha)
    ink = ink.crop(ink.getbbox())

    alpha = ink.getchannel("A").point(lambda v: min(255, int(v * ALPHA_GAIN)))
    ink.putalpha(alpha)

    if fill_note:
        print(f"墨迹裁边后: {ink.size}(工作画布 {src.size}),"
              f"占原画布 {ink.width / src.width:.0%} x {ink.height / src.height:.0%}")
    return ink


def render_icon(ink, size, fill=FILL, plate=True):
    """墨迹合成到宣纸色圆角底板;fill 控制墨迹占比(>1 会从中心裁掉边缘)"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    radius = size * RADIUS_RATIO

    if plate:
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius,
                               fill=PAPER_PLATE)

    iw, ih = ink.size
    scale = (size * fill) / max(iw, ih)
    nw, nh = max(1, round(iw * scale)), max(1, round(ih * scale))
    scaled = ink.resize((nw, nh), Image.LANCZOS)
    if size <= 32:
        scaled = scaled.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))

    canvas.paste(scaled, (round((size - nw) / 2), round((size - nh) / 2)), scaled)

    if plate and size >= 32:
        draw.rounded_rectangle([0.5, 0.5, size - 1.5, size - 1.5], radius=radius,
                               outline=(0, 0, 0, BORDER_ALPHA),
                               width=max(1, round(size * 0.012)))
    return canvas


def ink_bbox_ratio(icon):
    """图标内「墨迹」包围盒占图标边长的比例,用于自检主体大小。
    只统计明显深于白底、且不透明的像素(排除白底与圆角透明区)。"""
    w, h = icon.size
    px = icon.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and (r + g + b) < 600:
                xs.append(x)
                ys.append(y)
    if not xs:
        return 0.0
    return max(max(xs) - min(xs) + 1, max(ys) - min(ys) + 1) / w


def emit(icon, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    icon.save(path, "PNG")
    print("wrote", path)


def build_all():
    ink = load_ink()
    ext = os.path.join(ROOT, "extension", "icons")
    for s in (16, 32, 48, 128):
        icon = render_icon(ink, s)
        emit(icon, os.path.join(ext, f"icon{s}.png"))
        if s == 128:
            print(f"  FILL={FILL} 时,墨迹实际占图标 {ink_bbox_ratio(icon):.0%}")

    for directory in (("nextjs", "public", "assets"), ("landing", "assets")):
        assets = os.path.join(ROOT, *directory)
        emit(render_icon(ink, 512), os.path.join(assets, "logo.png"))
        emit(render_icon(ink, 64), os.path.join(assets, "favicon.png"))


def build_preview():
    """生成 FILL 对比图:两行(浅色/深色工具栏背景) x 四个放大档位,
    每格含 128px 图标 + 32px / 16px 小尺寸,方便直接挑。"""
    ink = load_ink()
    pad, big, small = 20, 128, 32
    cell_w = big + 16 + small + 24
    cell_h = big + 2 * pad
    W = pad + len(PREVIEW_FILLS) * cell_w
    H = 2 * (cell_h + pad)

    sheet = Image.new("RGB", (W, H), LIGHT_BG)
    draw = ImageDraw.Draw(sheet)

    for row, bg in enumerate((LIGHT_BG, DARK_BG)):
        y0 = row * (cell_h + pad)
        draw.rectangle([0, y0, W, y0 + cell_h + pad - 1], fill=bg)
        for col, fill in enumerate(PREVIEW_FILLS):
            x0 = pad + col * cell_w
            icon = render_icon(ink, big, fill=fill)
            sheet.paste(icon, (x0, y0 + pad), icon)
            sx = x0 + big + 16
            for k, s in enumerate((small, 16)):
                si = render_icon(ink, s, fill=fill)
                sheet.paste(si, (sx, y0 + pad + k * (small + 8)), si)

    out = os.path.join(ROOT, "preview", "fill-comparison.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out, "PNG")
    print("wrote", out)
    print(f"四档 FILL(左→右): {PREVIEW_FILLS};上排浅色工具栏,下排深色工具栏")


if __name__ == "__main__":
    build_preview() if "--preview" in sys.argv else build_all()
