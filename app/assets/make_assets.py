"""生成 Expo 需要的图标资源（纯 Pillow，无外部依赖）。
   icon.png            1024x1024  应用图标
   adaptive-icon.png   1024x1024  安卓自适应前景（透明底 + 居中图形）
   splash.png          1284x2778  启动图
   notification-icon.png 96x96    通知小图标（纯白，安卓会自动染色）
   favicon.png         48x48      web
"""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
INK = (11, 9, 18, 255)
LAMP = (155, 140, 255, 255)
WARM = (255, 196, 107, 255)
MINT = (94, 224, 168, 255)
SKY = (95, 208, 245, 255)
ROSE = (255, 143, 177, 255)


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def bg(w, h=None):
    """竖向渐变底。bg(1024) 出正方形，bg(w, h) 出任意比例"""
    h = h or w
    img = Image.new('RGBA', (w, h), (11, 9, 18, 255))
    d = ImageDraw.Draw(img)
    top = (20, 16, 33)
    bottom = (11, 9, 18)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        d.line([(0, y), (w, y)], fill=c)
    return img


def bubble(draw, cx, cy, w, h, color, tail=True, alpha=255):
    """一个聊天气泡"""
    r = h // 2
    box = [cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2]
    draw.rounded_rectangle(box, radius=r, fill=color[:3] + (alpha,))
    if tail:
        tx = box[0] + r // 2
        ty = box[3] - 2
        draw.polygon([(tx, ty), (tx + r, ty), (tx, ty + r)], fill=color[:3] + (alpha,))


def draw_mark(img, scale=1.0):
    """三个气泡 = 一群 AI 在说话"""
    d = ImageDraw.Draw(img)
    W = img.size[0]
    u = W / 1024.0 * scale

    # 主气泡（最大，紫色）
    bw, bh = int(560 * u), int(210 * u)
    cx, cy = int(W * 0.46), int(W * 0.44)
    bubble(d, cx, cy, bw, bh, LAMP)

    # 右上小气泡（暖黄）
    bw2, bh2 = int(300 * u), int(130 * u)
    bubble(d, int(W * 0.72), int(W * 0.25), bw2, bh2, WARM)

    # 左下小气泡（薄荷）
    bw3, bh3 = int(260 * u), int(112 * u)
    bubble(d, int(W * 0.26), int(W * 0.68), bw3, bh3, MINT)

    # 气泡里的「字」——三根短线
    def lines(cx, cy, w, h, color, n=3):
        gap = h / (n + 1)
        for i in range(n):
            y = cy - h / 2 + gap * (i + 1)
            x0 = cx - w / 2 + int(46 * u)
            x1 = cx + w / 2 - int(46 * u) - (int(70 * u) if i == n - 1 else 0)
            d.rounded_rectangle([x0, y - int(9 * u), x1, y + int(9 * u)],
                                radius=int(9 * u), fill=(255, 255, 255, 210))

    lines(cx, cy, bw, bh, None)
    d.rounded_rectangle([cx - bw // 2 + int(34 * u), cy + bh // 2 - int(30 * u),
                         cx + bw // 2 - int(34 * u), cy + bh // 2 - int(22 * u)],
                        radius=int(4 * u), fill=(255, 255, 255, 60))


# ---------------- icon ----------------
icon = bg(1024)
draw_mark(icon)
# 底部再压一层暗，让内容更聚拢
ov = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
od = ImageDraw.Draw(ov)
for y in range(760, 1024):
    a = int(150 * (y - 760) / 264)
    od.line([(0, y), (1024, y)], fill=(11, 9, 18, a))
icon = Image.alpha_composite(icon, ov)
icon.convert('RGB').save(os.path.join(OUT, 'icon.png'))

# ---------------- adaptive icon（透明底 + 安全区内图形） ----------------
ad = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw_mark(ad, scale=0.72)
ad.save(os.path.join(OUT, 'adaptive-icon.png'))

# ---------------- splash ----------------
SW, SH = 1284, 2778
sp = bg(SW, SH)
mark = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw_mark(mark, scale=0.78)
sp.alpha_composite(mark, (int((SW - 1024) / 2), int(SH * 0.30)))
d = ImageDraw.Draw(sp)
d.text((0, 0), '', fill=(0, 0, 0, 0))
# 底部一句标语
try:
    from PIL import ImageFont
    font = ImageFont.load_default(size=int(52))
    d.text((SW // 2, int(SH * 0.63)), 'AI 游戏厅', anchor='mm',
           fill=(255, 255, 255, 220), font=font)
    font2 = ImageFont.load_default(size=int(30))
    d.text((SW // 2, int(SH * 0.63) + 62), '一群 AI 围一桌，你负责看戏', anchor='mm',
           fill=(255, 255, 255, 110), font=font2)
except Exception as e:  # 字号 API 差异不影响出图
    print('splash text skipped:', e)
sp.convert('RGB').save(os.path.join(OUT, 'splash.png'))

# ---------------- notification icon（纯白，系统染色） ----------------
nt = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
nd = ImageDraw.Draw(nt)
nd.rounded_rectangle([16, 26, 80, 66], radius=20, fill=(255, 255, 255, 255))
nd.polygon([(30, 66), (52, 66), (30, 86)], fill=(255, 255, 255, 255))
nt.save(os.path.join(OUT, 'notification-icon.png'))

# ---------------- favicon ----------------
icon.resize((48, 48), Image.LANCZOS).save(os.path.join(OUT, 'favicon.png'))

for f in ['icon.png', 'adaptive-icon.png', 'splash.png', 'notification-icon.png', 'favicon.png']:
    p = os.path.join(OUT, f)
    print(f, os.path.getsize(p), 'bytes')
