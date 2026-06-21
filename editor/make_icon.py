#!/usr/bin/env python3
# Erzeugt ein 1024x1024 App-Icon (weißer Squircle + schwarzer Pinselstrich mit Druck-Verlauf).
# Reines Python, keine Abhängigkeiten -> PNG manuell mit zlib kodiert.
import zlib, struct, math, sys

S = 1024
buf = bytearray([0, 0, 0, 0]) * (S * S)  # RGBA, transparent

def idx(x, y): return (y * S + x) * 4
def setpx(x, y, r, g, b, a):
    if 0 <= x < S and 0 <= y < S:
        i = idx(x, y)
        # über vorhandenes alpha-blenden
        ba = buf[i+3] / 255.0
        fa = a / 255.0
        na = fa + ba * (1 - fa)
        if na <= 0: return
        for k, c in enumerate((r, g, b)):
            bc = buf[i+k]
            buf[i+k] = int((c * fa + bc * ba * (1 - fa)) / na)
        buf[i+3] = int(na * 255)

def rounded_rect(x0, y0, x1, y1, rad, col):
    r, g, b, a = col
    for y in range(y0, y1):
        for x in range(x0, x1):
            dx = dy = 0
            if x < x0 + rad: dx = x0 + rad - x
            elif x > x1 - rad: dx = x - (x1 - rad)
            if y < y0 + rad: dy = y0 + rad - y
            elif y > y1 - rad: dy = y - (y1 - rad)
            d = math.hypot(dx, dy)
            if d <= rad:
                aa = 1.0 if d <= rad - 1 else (rad - d)
                setpx(x, y, r, g, b, int(a * max(0, min(1, aa))))

def disc(cx, cy, rad, col):
    r, g, b, a = col
    x0, x1 = int(cx - rad - 1), int(cx + rad + 2)
    y0, y1 = int(cy - rad - 1), int(cy + rad + 2)
    for y in range(y0, y1):
        for x in range(x0, x1):
            d = math.hypot(x - cx, y - cy)
            if d <= rad:
                aa = 1.0 if d <= rad - 1 else (rad - d)
                setpx(x, y, r, g, b, int(a * max(0, min(1, aa))))

# Hintergrund: weißer Squircle
rounded_rect(40, 40, S - 40, S - 40, 230, (255, 255, 255, 255))

# Pinselstrich mit Druckverlauf (dünn -> dick -> dünn), als Bezierkurve
def bez(t, p0, p1, p2, p3):
    mt = 1 - t
    return (mt**3 * p0 + 3*mt**2*t*p1 + 3*mt*t**2*p2 + t**3*p3)

P = [(250, 760), (430, 300), (640, 880), (810, 320)]
steps = 600
for s in range(steps + 1):
    t = s / steps
    x = bez(t, P[0][0], P[1][0], P[2][0], P[3][0])
    y = bez(t, P[0][1], P[1][1], P[2][1], P[3][1])
    pressure = math.sin(t * math.pi)          # 0..1..0
    rad = 8 + 58 * pressure
    disc(x, y, rad, (16, 16, 16, 255))

# PNG schreiben
def chunk(typ, data):
    c = typ + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

raw = bytearray()
for y in range(S):
    raw.append(0)
    raw += buf[y*S*4:(y+1)*S*4]
png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

out = sys.argv[1] if len(sys.argv) > 1 else "icon_1024.png"
with open(out, "wb") as f:
    f.write(png)
print("geschrieben:", out)
