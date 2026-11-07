import os
HERE = os.path.dirname(os.path.abspath(__file__))
"""生成 64x64 托盘图标：深墨色圆角方块 + 奶油色便签线 + 朱红圆点。"""
from PIL import Image, ImageDraw

S = 64
SS = 4  # 超采样，缩小后边缘更干净
img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)


def sc(v):
    return v * SS


# 圆角底板
d.rounded_rectangle(
    [sc(3), sc(3), sc(S - 3), sc(S - 3)], radius=sc(15), fill=(43, 38, 32, 255)
)

# 便签横线
line_color = (255, 246, 229, 255)
for i, (y, x2) in enumerate([(24, 44), (32, 44), (40, 35)]):
    d.rounded_rectangle([sc(16), sc(y), sc(x2), sc(y + 4)], radius=sc(2), fill=line_color)

# 右上角朱红圆点
d.ellipse([sc(42), sc(12), sc(52), sc(22)], fill=(228, 87, 46, 255))

img = img.resize((S, S), Image.LANCZOS)
img.save(os.path.join(HERE, "icon.png"))
print("icon written")
