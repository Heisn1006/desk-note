import os
HERE = os.path.dirname(os.path.abspath(__file__))
"""生成 64x64 托盘图标：深墨色圆角方块 + 奶油色便签线 + 朱红圆点。"""
from PIL import Image, ImageDraw

S = 32
SS = 4  # 超采样，缩小后边缘更干净
img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def sc(v):
    return v * SS


# 圆角底板
d.rounded_rectangle(
    [sc(1), sc(1), sc(S - 1), sc(S - 1)], radius=sc(8), fill=(43, 38, 32, 255)
)

# 便签横线
line_color = (255, 246, 229, 255)
for i, (y, x2) in enumerate([(11, 22), (16, 22), (21, 17)]):
    d.rounded_rectangle([sc(7), sc(y), sc(x2), sc(y + 2.5)], radius=sc(1.2), fill=line_color)

# 右上角朱红圆点
d.ellipse([sc(21), sc(5), sc(27), sc(11)], fill=(228, 87, 46, 255))

img = img.resize((S, S), Image.LANCZOS)
img.save(os.path.join(HERE, "icon.png"))
print("icon written")
