"""
인물 PNG(images/NN_fg.png)의 실루엣을 js/masks.js 로 만든다.
빨간 실이 인물과 겹치는 구간을 찾을 때 쓴다.

인물 이미지를 바꾸면 프로젝트 폴더에서 다시 실행:
    python3 tools/make_masks.py
"""
import base64
import glob
import json
import os

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCALE = 6          # 원본의 1/6 해상도로 저장
ALPHA = 40         # 이 값보다 불투명하면 인물로 본다
DILATE = 1         # 실루엣을 이만큼(칸) 넓혀서, 앞/뒤 전환이 인물 가장자리 바깥에서 일어나게

masks = {}
for path in sorted(glob.glob(os.path.join(ROOT, "images", "*_fg.png"))):
    im = Image.open(path).convert("RGBA")
    w, h = im.width // SCALE, im.height // SCALE
    alpha = im.getchannel("A").resize((w, h), Image.BILINEAR)
    alpha = alpha.point(lambda v: 255 if v > ALPHA else 0)
    if DILATE:
        alpha = alpha.filter(ImageFilter.MaxFilter(DILATE * 2 + 1))

    bits = bytearray((w * h + 7) // 8)
    for i, v in enumerate(alpha.getdata()):
        if v:
            bits[i >> 3] |= 1 << (i & 7)

    key = "images/" + os.path.basename(path)
    masks[key] = {"w": w, "h": h, "data": base64.b64encode(bytes(bits)).decode()}
    print(f"{key}: {w}x{h}")

out = os.path.join(ROOT, "js", "masks.js")
with open(out, "w") as f:
    f.write("// tools/make_masks.py 로 자동 생성 — 직접 수정하지 마세요\n")
    f.write("window.FG_MASKS = " + json.dumps(masks) + ";\n")
print("->", out, os.path.getsize(out) // 1024, "KB")
