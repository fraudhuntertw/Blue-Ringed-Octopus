"""
產生 Blue Ringed Octopus icon。

五套狀態：
  - octopus-normal-{16,48,128}.png    淡黃身體 + 沉穩藍環（一般網站）
  - octopus-alert-{16,48,128}.png     紅身體 + 鮮藍環（< 30 天告警）
  - octopus-warn-{16,48,128}.png      橘身體 + 暗藍灰環（高風險 TLD / 註冊商提醒）
  - octopus-blacklist-{16,48,128}.png 黑身體 + 灰白環（手動黑名單，最強阻擋）
  - octopus-whitelist-{16,48,128}.png 同 normal 但半透明（白名單 / 可信 TLD）

純 stdlib，無需 PIL。

藝術警告：這是程式化幾何拼湊出來的章魚，造型誠意有但細緻度不足，
作為佔位用。要美化請另外用 SVG / Figma 畫好後匯出，
覆蓋同名 PNG 即可（manifest 不需改）。
"""
import struct
import zlib
import math
import os


def make_octopus(size: int, state: str):
    """
    回傳 size×size 的 RGBA 像素矩陣，畫出章魚。

    配色策略：在生物正確（黃身體 + 藍環）的基準上，
    刻意把各狀態的身體色拉開距離，以保留 16px 工具列下的辨識度。

    state:
      - "normal"    淡黃身體 + 深藍環（一般網站，平靜的藍環章魚）
      - "alert"     紅身體 + 鮮藍環（< 30 天告警，「煮熟」的視覺隱喻）
      - "warn"      橘身體 + 暗藍灰環（高風險 TLD / 註冊商，提醒級）
      - "blacklist" 黑身體 + 灰白環（手動黑名單，最強阻擋）
      - "whitelist" normal 配色但 alpha=110（半透明，淡淡存在感）

    環的畫法為兩層：外圈 ring 色 + 內圈 body 色，產生中空甜甜圈外觀，
    比實心圓點更貼近真實的「藍環」。
    """

    # 用 alpha 控制「隱形感」
    alpha = 110 if state == "whitelist" else 255

    if state == "alert":
        # < 30 天告警：紅身體 + 鮮藍環，最強對比，一眼分辨
        body = (220, 38, 38, alpha)          # #dc2626 警告紅
        body_dark = (153, 27, 27, alpha)     # #991b1b 深紅
        ring = (37, 99, 235, alpha)          # #2563eb 鮮藍
    elif state == "warn":
        # 高風險提醒：橘身體 + 暗藍灰環
        body = (251, 146, 60, alpha)         # #fb923c 橘
        body_dark = (194, 65, 12, alpha)     # #c2410c 深橘
        ring = (51, 65, 85, alpha)           # #334155 暗藍灰
    elif state == "blacklist":
        # 手動黑名單：黑身體 + 灰白環，最強阻擋語意
        body = (38, 38, 38, alpha)           # #262626 近黑
        body_dark = (10, 10, 10, alpha)      # #0a0a0a 純黑邊緣
        ring = (229, 231, 235, alpha)        # #e5e7eb 灰白，黑底上仍可見
    else:
        # normal 與 whitelist 共用：淡黃身體 + 沉穩深藍環
        body = (253, 230, 138, alpha)        # #fde68a 淡黃
        body_dark = (217, 119, 6, alpha)     # #d97706 琥珀
        ring = (29, 78, 216, alpha)          # #1d4ed8 深藍

    eye = (255, 255, 255, alpha)
    pupil = (0, 0, 0, alpha)
    transparent = (0, 0, 0, 0)

    pixels = [[transparent] * size for _ in range(size)]

    cx = (size - 1) / 2.0
    head_cy = size * 0.36
    head_rx = size * 0.38
    head_ry = size * 0.30

    # === 觸手（先畫，會被頭部蓋住一部分作為自然銜接）===
    n_tentacles = 8
    tentacle_top_y = head_cy + head_ry * 0.65
    tentacle_bot_y = size * 0.97
    base_w = max(1.5, size * 0.07)

    for i in range(n_tentacles):
        # 散開角度：扇形展開
        angle = (i - (n_tentacles - 1) / 2.0) * 0.32

        # 起點：在頭底部邊緣
        start_x = cx + math.sin(angle * 0.4) * head_rx * 0.85
        start_y = tentacle_top_y

        # 終點：向外散開
        end_x = cx + math.sin(angle) * head_rx * 1.7
        end_y = tentacle_bot_y

        # 取樣密度設為每像素 2 個樣本：避免 (end_y - start_y) / steps 略大於 1
        # 時，int(ty) 跳號造成某些 iy 整列被跳過（特別是 48px 會在 y=34 出現
        # 一整列透明縫，看起來像水平黑線）。
        steps = max(2, int((end_y - start_y) * 2))
        for s in range(steps + 1):
            t = s / steps
            ty = start_y + (end_y - start_y) * t
            # 波浪
            wave = math.sin(t * 7 + i * 1.3) * (size * 0.05) * t
            tx = start_x + (end_x - start_x) * t + wave
            # 觸手由粗變細
            half_w = base_w * (1 - t * 0.55) / 2.0
            iy = int(ty)
            if 0 <= iy < size:
                ix_lo = int(tx - half_w - 0.5)
                ix_hi = int(tx + half_w + 0.5)
                for ix in range(ix_lo, ix_hi + 1):
                    if 0 <= ix < size:
                        # 邊緣稍深
                        edge = abs(ix - tx) > half_w * 0.6
                        pixels[iy][ix] = body_dark if edge else body

    # === 頭部（橢圓）===
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / head_rx
            dy = (y - head_cy) / head_ry
            r2 = dx * dx + dy * dy
            if r2 <= 1.0:
                pixels[y][x] = body_dark if r2 > 0.88 else body

    # === 環點 / 斑點 ===
    rings = [
        (cx - head_rx * 0.50, head_cy - head_ry * 0.30, 0.10),
        (cx + head_rx * 0.50, head_cy - head_ry * 0.30, 0.10),
        (cx - head_rx * 0.65, head_cy + head_ry * 0.25, 0.09),
        (cx + head_rx * 0.65, head_cy + head_ry * 0.25, 0.09),
        (cx, head_cy + head_ry * 0.45, 0.10),
    ]
    for rx, ry, rr in rings:
        ring_r = size * rr
        ir = ring_r * ring_r
        # 內圈半徑 ~ 50%，畫成「環」（中空甜甜圈）。
        # 過小（< ~1.2px）就退回實心圓，避免 16px 內圈消失成一團髒點。
        inner_r = ring_r * 0.5
        inner_ir = inner_r * inner_r
        draw_hole = inner_r >= 1.2
        for y in range(max(0, int(ry - ring_r - 1)), min(size, int(ry + ring_r + 2))):
            for x in range(max(0, int(rx - ring_r - 1)), min(size, int(rx + ring_r + 2))):
                ddx = x - rx
                ddy = y - ry
                d2 = ddx * ddx + ddy * ddy
                if d2 <= ir:
                    # 只在頭部主體內
                    hdx = (x - cx) / head_rx
                    hdy = (y - head_cy) / head_ry
                    if hdx * hdx + hdy * hdy <= 0.88:
                        if draw_hole and d2 <= inner_ir:
                            pixels[y][x] = body  # 中空：身體色
                        else:
                            pixels[y][x] = ring

    # === 眼睛 ===
    eyes = [
        (cx - head_rx * 0.38, head_cy - head_ry * 0.05),
        (cx + head_rx * 0.38, head_cy - head_ry * 0.05),
    ]
    eye_r = max(2.0, size * 0.075)
    pupil_r = max(1.0, size * 0.035)
    for ex, ey in eyes:
        er2 = eye_r * eye_r
        pr2 = pupil_r * pupil_r
        for y in range(max(0, int(ey - eye_r - 1)), min(size, int(ey + eye_r + 2))):
            for x in range(max(0, int(ex - eye_r - 1)), min(size, int(ex + eye_r + 2))):
                ddx = x - ex
                ddy = y - ey
                d2 = ddx * ddx + ddy * ddy
                if d2 <= er2:
                    pixels[y][x] = eye
                if d2 <= pr2:
                    pixels[y][x] = pupil

    return pixels


def write_png(path: str, size: int, state: str):
    pixels = make_octopus(size, state)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # PNG filter byte: None
        for x in range(size):
            raw.extend(pixels[y][x])

    def chunk(name: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + name + data
                + struct.pack(">I", zlib.crc32(name + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw))

    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


STATES = ("normal", "alert", "warn", "blacklist", "whitelist")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for size in (16, 48, 128):
        for state in STATES:
            name = f"octopus-{state}-{size}.png"
            path = os.path.join(here, name)
            write_png(path, size, state)
            print(f"wrote {name} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
