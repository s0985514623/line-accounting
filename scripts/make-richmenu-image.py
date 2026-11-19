"""
產生 LINE Rich Menu 圖片（2500x843，四格）：列表 / 新增 / 批次 / 圖表。

    python scripts/make-richmenu-image.py

輸出 scripts/assets/richmenu.png（已提交進版控，通常不需要重跑）。
格子順序必須與 scripts/line-richmenu.mjs 的 AREAS 一致。
字型：Windows 內建微軟正黑體（msjh / msjhbd）；其他系統可用 FONT_BOLD / FONT_REGULAR 環境變數指定路徑。
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 843
ITEMS = [
    ("列表", "記帳紀錄"),
    ("新增", "表單記一筆"),
    ("批次", "一次記多筆"),
    ("圖表", "本月統計"),
]
HIGHLIGHT = "新增"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts")
bold = ImageFont.truetype(os.environ.get("FONT_BOLD", os.path.join(FONTS, "msjhbd.ttc")), 120)
small = ImageFont.truetype(os.environ.get("FONT_REGULAR", os.path.join(FONTS, "msjh.ttc")), 48)

img = Image.new("RGB", (W, H), "#ffffff")
draw = ImageDraw.Draw(img)
cell = W // len(ITEMS)
for i, (title, sub) in enumerate(ITEMS):
    x0 = i * cell
    on = title == HIGHLIGHT
    fill = "#1f6feb" if on else "#f6f7f9"
    color = "#ffffff" if on else "#1d2939"
    muted = "#dbe7ff" if on else "#667085"
    draw.rectangle([x0 + 12, 12, x0 + cell - 12, H - 12], fill=fill, outline="#d0d5dd", width=4)
    cx = x0 + cell / 2
    draw.text((cx, H / 2 - 50), title, font=bold, fill=color, anchor="mm")
    draw.text((cx, H / 2 + 100), sub, font=small, fill=muted, anchor="mm")

out = os.path.join(ROOT, "scripts/assets/richmenu.png")
img.save(out, optimize=True)
print("done:", out)
