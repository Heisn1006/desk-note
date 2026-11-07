import os
HERE = os.path.dirname(os.path.abspath(__file__))
"""生成 256px 主图标 + 多尺寸 ico（16/24/32/48/64/128/256）"""
from PIL import Image, ImageDraw

S = 256
SS = 4
img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def sc(v):
    return int(v * SS)


# 圆角底板
d.rounded_rectangle([sc(12), sc(12), sc(S - 12), sc(S - 12)], radius=sc(56), fill=(43, 38, 32, 255))

# 便签横线（三条，最后一条短）
for y, x2 in [(96, 176), (128, 176), (160, 140)]:
    d.rounded_rectangle([sc(56), sc(y), sc(x2), sc(y + 16)], radius=sc(8), fill=(255, 246, 229, 255))

# 右上角朱红圆点
d.ellipse([sc(168), sc(44), sc(212), sc(88)], fill=(228, 87, 46, 255))

img = img.resize((S, S), Image.LANCZOS)
img.save(os.path.join(HERE, "icon-256.png"))
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save(os.path.join(HERE, "icon.ico"), sizes=sizes)
print("icon-256.png + icon.ico written")
