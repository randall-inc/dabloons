"""Halloween home hero, light theme: skull island on a golden afternoon, 800x300 dither grid.

Usage: python scene.py SMOOTH_OUT.png FRAME_OUT.png PHASE
PHASE is 0..1 around the animation loop; 0 is the still frame.
The palette is every color the scene passes to hexc(), so new colors join it automatically.
"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2
W, H = 800, 300
DW, DH = W * S, H * S
U = DW / 160                      # scene is 160 x 60 units
PH = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
TAU = 2 * math.pi
rng = np.random.default_rng(13)   # scene layout
prng = np.random.default_rng(17)  # animation phases

yy, xx = np.mgrid[0:DH, 0:DW].astype(np.float32)
img = np.zeros((DH, DW, 3), np.float32)
USED = set()

def hexc(h):
    USED.add(h)
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)

def ramp(t, stops):
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (t >= p0) & (t <= p1)
        f = ((t - p0) / max(p1 - p0, 1e-6))[..., None]
        out[m] = (hexc(c0) * (1 - f) + hexc(c1) * f)[m]
    return out

def comp(mask, color):
    global img
    a = np.clip(mask, 0, 1)[..., None]
    img = img * (1 - a) + np.broadcast_to(color, img.shape) * a

def pil_mask(fn, blur=0):
    m = Image.new('L', (DW, DH), 0)
    fn(ImageDraw.Draw(m))
    if blur: m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(m, np.float32) / 255

def batch(items, fn):
    m = Image.new('L', (DW, DH), 0)
    dr = ImageDraw.Draw(m)
    for it in items: fn(dr, *it)
    return np.asarray(m, np.float32) / 255

P = lambda x, y: (x * U, y * U)
HZ = 30 * U
s = lambda k, f=1: math.sin(TAU * (f * PH + k))
SUNX = 108                         # low afternoon sun

# ---- sky -------------------------------------------------------------
img[:] = ramp(yy / HZ, [(0, '#b4c2ea'), (0.3, '#c9d0f0'), (0.55, '#e2daf0'), (0.75, '#f4e0dc'),
                        (0.9, '#fad8b8'), (1, '#fbcf9e')])
# afterglow hugging the horizon where the sun set, stepping through the sky's own warm colors
d = np.hypot((xx - SUNX * U) / 2.6, yy - HZ)
above = (yy < HZ).astype(np.float32)
comp(np.exp(-(d / (11 * U)) ** 2) * 0.45 * above, hexc('#fad8b8'))
# low sun: glow steps through the sky's own peach and cream, kept tight so it never meets the blue
sd = np.hypot(xx - SUNX * U, yy - 24 * U)
comp(np.exp(-(sd / (6 * U)) ** 2) * 0.6 * above, hexc('#fde6c4'))
comp(np.exp(-(sd / (4.2 * U)) ** 2) * 0.7 * above, hexc('#fff1c4'))
comp(np.clip((3.4 * U - sd) / 2, 0, 1) * above, ramp(sd / (3.4 * U), [(0, '#fffbe6'), (0.7, '#fff1c4'), (1, '#ffe2a0')]))

# stars (unused in daylight)
stars = [(rng.uniform(0, 160), rng.uniform(0.5, 13), prng.uniform()) for _ in range(110)]
items = [(x, y, int(255 * (1 - y / 14) * (0.4 + 0.6 * (0.5 + 0.5 * s(k, 2))))) for x, y, k in stars]
# (daytime: no stars painted; the draws above keep the layout rng in step)

# pale daytime crescent moon, high on the right
moon = pil_mask(lambda dr: dr.ellipse([P(118, 4), P(124, 10)], fill=255))
moon *= 1 - pil_mask(lambda dr: dr.ellipse([P(119.8, 3.2), P(125.8, 9.2)], fill=255))
comp(moon * 0.85, hexc('#ffffff'))

# soft afternoon clouds, warm underneath
for cy, x0, x1, th in ((19, 64, 112, 1.3), (22.5, 100, 150, 1.1), (25.5, 70, 98, 0.9), (16, 128, 162, 1.0)):
    dx = 0.9 * s(cy / 11)
    m = pil_mask(lambda dr: dr.rounded_rectangle([P(x0 + dx, cy), P(x1 + dx, cy + th)], radius=th * U / 2, fill=255), blur=1.5)
    comp(m, ramp((yy - cy * U) / (th * U), [(0, '#ffffff'), (0.55, '#f6eaf0'), (1, '#f4cdb4')]))

# ---- skull island, right horizon --------------------------------------
def skull_island():
    cx, top = 141, 12.5
    cran = pil_mask(lambda dr: (
        dr.ellipse([P(cx - 9.5, top), P(cx + 9.5, top + 14.5)], fill=255),
        dr.rounded_rectangle([P(cx - 7, top + 8), P(cx + 7, top + 18.5)], radius=2.2 * U, fill=255)))
    base = pil_mask(lambda dr: dr.polygon([P(cx - 18, 30.4), P(cx - 14, 28.2), P(cx - 10, 26.2), P(cx - 6, 25.6), P(cx + 6, 25.6),
                                           P(cx + 10, 26.4), P(cx + 15, 27.8), P(cx + 21, 30.4)], fill=255))
    m = np.maximum(cran, base)
    # solid rock silhouette, warm rim on the side facing the afterglow (left)
    col = ramp((xx / U - (cx - 10)) / 22, [(0, '#b88c9c'), (0.12, '#8e7aa2'), (0.45, '#73628e'), (1, '#5c4c78')])
    comp(m, col)
    grown = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)), np.float32) / 255
    rim = np.clip(m - grown, 0, 1) * (xx < (cx - 2) * U) * (yy < 28 * U)
    comp(rim * 0.8, hexc('#f4cdb4'))
    # cracks in the cranium
    for pts in (((cx - 2, top + 0.6), (cx - 1.2, top + 2.4), (cx - 2.2, top + 4)), ((cx + 5.5, top + 2), (cx + 4.4, top + 3.6))):
        comp(pil_mask(lambda dr: dr.line([P(*q) for q in pts], fill=255, width=max(1, int(0.5 * U)))), hexc('#46385e'))
    # eye caves glowing from inside (alpha pulse only)
    pulse = 0.5 + 0.5 * s(0.15, 1)
    flick = 0.85 + 0.1 * s(0.4, 4) + 0.05 * s(0.8, 7)
    for side in (-1, 1):
        ex, ey = cx + side * 4.2, top + 8.6
        dl = np.hypot(xx - ex * U, (yy - ey * U) * 1.2)
        comp(np.exp(-(dl / (5 * U)) ** 2) * (0.15 + 0.2 * pulse) * m, hexc('#b88c9c'))
        sock = [P(ex - side * 3, ey - 1.6), P(ex + side * 2.6, ey - 2.0), P(ex + side * 2.9, ey + 0.6),
                P(ex + side * 1.0, ey + 2.6), P(ex - side * 2.2, ey + 2.2), P(ex - side * 3.1, ey + 0.4)]
        comp(pil_mask(lambda dr: dr.polygon(sock, fill=255)), hexc('#2a1b3a'))
        comp(pil_mask(lambda dr: dr.ellipse([P(ex - 1.7, ey - 1.2), P(ex + 1.7, ey + 1.8)], fill=255), blur=1.5) * (0.6 + 0.4 * pulse) * flick,
             ramp((yy / U - (ey - 1.2)) / 3, [(0, '#ffd27a'), (0.5, '#ffa94a'), (1, '#ee7a3a')]))
    # nose cave
    comp(pil_mask(lambda dr: dr.polygon([P(cx, top + 11), P(cx - 1.6, top + 14), P(cx - 0.3, top + 14.4), P(cx, top + 13.8),
                                         P(cx + 0.3, top + 14.4), P(cx + 1.6, top + 14)], fill=255)), hexc('#2a1b3a'))
    # mouth: dark gap with blocky teeth
    comp(pil_mask(lambda dr: dr.rounded_rectangle([P(cx - 5.4, top + 15.3), P(cx + 5.4, top + 18)], radius=0.6 * U, fill=255)), hexc('#2a1b3a'))
    teeth = [(tx, y0, y1) for tx in np.arange(cx - 4.6, cx + 4.7, 1.55) for y0, y1 in ((15.6, 16.5), (16.8, 17.7))]
    comp(batch(teeth, lambda dr, tx, y0, y1: dr.rectangle([P(tx - 0.5, top + y0), P(tx + 0.5, top + y1)], fill=255)),
         ramp((xx / U - (cx - 6)) / 12, [(0, '#e8dce4'), (1, '#b4a2bc')]))
skull_island()

# far headland on the left horizon (low, keeps the text area calm)
comp(pil_mask(lambda dr: dr.polygon([P(-1, 30.3), P(-1, 28.4), P(6, 27.6), P(14, 28.2), P(22, 29.3), P(30, 30.3)], fill=255)),
     hexc('#a49ac0'))

# bats, loose flock drifting over the sea, flapping
def bat(x, y, sc, k):
    x += 1.1 * s(k); y += 0.5 * s(k, 2)
    up = s(k, 3) > 0
    tip, mid = (-1.1, -0.2) if up else (0.9, 0.5)
    pts = [(-3.2, tip), (-2.2, mid - 0.2), (-1.6, mid + 0.5), (-0.9, 0.2), (-0.5, -0.5), (0, -0.2), (0.5, -0.5),
           (0.9, 0.2), (1.6, mid + 0.5), (2.2, mid - 0.2), (3.2, tip), (2.2, mid + 0.9), (1.2, 0.9), (0, 1.2),
           (-1.2, 0.9), (-2.2, mid + 0.9)]
    comp(pil_mask(lambda dr: dr.polygon([P(x + px * sc, y + py * sc) for px, py in pts], fill=255)), hexc('#2a1b3a'))
for x, y, sc in ((98, 9, 0.9), (104, 6.5, 0.75), (108.5, 11, 0.85), (113, 8, 0.6), (93, 13.5, 0.65),
                 (101, 15.5, 0.55), (116.5, 12.5, 0.5), (88.5, 7.5, 0.5)):
    bat(x, y, sc, prng.uniform())

# ---- sea -------------------------------------------------------------
SEA_END = 46 * U
sea = (yy >= HZ).astype(np.float32)
comp(sea, ramp((yy - HZ) / (SEA_END - HZ), [(0, '#f4cdb4'), (0.06, '#c6c6e6'), (0.3, '#a2c0e2'),
                                             (0.65, '#88bcd8'), (1, '#9ed2d4')]))
comp(np.exp(-((yy - HZ) / (0.8 * U)) ** 2) * sea * 0.5, hexc('#fad8b8'))

# wave streaks
streaks = []
for _ in range(320):
    y = rng.uniform(31, 44.5); f = (y - 30) / 15
    x = rng.uniform(-4, 160); L = rng.uniform(1, 2 + 5 * f)
    k = prng.uniform()
    streaks.append((x + 0.8 * s(k), y, L, 0.35 + 0.25 * f,
                    int(255 * (0.3 + 0.35 * f) * (0.55 + 0.45 * (0.5 + 0.5 * s(k, 2))))))
comp(batch(streaks, lambda dr, x, y, L, th, a: dr.rectangle([P(x, y), P(x + L, y + th)], fill=a)), hexc('#eef6fa'))

# sun reflection column, golden glints
refl = []
for _ in range(170):
    y = rng.uniform(30.4, 44); f = (y - 30) / 14
    x = SUNX + rng.normal(0, 2 + 4.5 * f)
    L = rng.uniform(0.8, 3.2 - f)
    k = prng.uniform()
    on = 1.0 if s(k, 2) > -0.3 else 0.3
    refl.append((x + 0.6 * s(k, 2), y, L, int(255 * (0.9 - 0.5 * f) * on), f))
comp(batch([r for r in refl if r[4] >= 0.3], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#ffd27a'))
comp(batch([r for r in refl if r[4] < 0.3], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#fff1c4'))
# eye-glow reflections under the skull
for ex in (136.6, 145.4):
    eyes = [(ex + rng.normal(0, 0.8), rng.uniform(31, 36), rng.uniform(0.6, 1.6), prng.uniform()) for _ in range(10)]
    comp(batch(eyes, lambda dr, x, y, L, k: dr.rectangle([P(x + 0.4 * s(k, 2) - L / 2, y), P(x + 0.4 * s(k, 2) + L / 2, y + 0.35)],
                                                         fill=int(120 * (0.5 + 0.5 * s(0.15))))), hexc('#ffa94a'))

# ---- ship, anchored mid-scene, dark sails as an accent on the light sky --
def ship():
    dy = 0.35 * s(0.0)
    Q = lambda x, y: P(x, y + dy)
    comp(pil_mask(lambda dr: dr.rectangle([Q(70, 38.6), Q(101, 41)], fill=255)) * 0.4 *
         (np.sin(yy / (0.5 * U) * math.pi) > -0.2), hexc('#5a6a9a'))
    for mx in (78.5, 91.5):
        comp(pil_mask(lambda dr: dr.rectangle([Q(mx - 0.45, 14.5), Q(mx + 0.45, 34)], fill=255)), hexc('#2a1b3a'))
        for y0, y1, hw in ((19, 25, 4.3), (25.5, 31.5, 5.5)):
            sail = pil_mask(lambda dr: dr.rounded_rectangle([Q(mx - hw, y0), Q(mx + hw, y1)], radius=2.2 * U, fill=255))
            # torn hem: a couple of ragged notches
            sail *= 1 - pil_mask(lambda dr: [dr.polygon([Q(mx + nx - 0.5, y1 + 0.2), Q(mx + nx, y1 - 0.8), Q(mx + nx + 0.5, y1 + 0.2)], fill=255)
                                             for nx in (-hw * 0.6, -hw * 0.15, hw * 0.3, hw * 0.7)])
            comp(sail, ramp((xx / U - (mx - hw)) / (2 * hw), [(0, '#7a6290'), (0.45, '#5a4672'), (1, '#3e2e56')]))
        comp(pil_mask(lambda dr: dr.rectangle([Q(mx - 0.45, 18), Q(mx + 0.45, 33)], fill=255)), hexc('#2a1b3a'))
    # jolly roger + pennant
    comp(pil_mask(lambda dr: dr.rectangle([Q(78, 14.5), Q(82, 17.5)], fill=255)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: dr.rectangle([Q(79.4, 15.4), Q(80.6, 16.5)], fill=255)), hexc('#f6ecd8'))
    comp(pil_mask(lambda dr: dr.polygon([Q(92, 14.5), Q(94.6, 15.7 + 0.25 * s(0.3, 2)), Q(92, 16.8)], fill=255)), hexc('#ee7a3a'))
    hull = pil_mask(lambda dr: dr.polygon([Q(68, 32.3), Q(71, 32), Q(71.5, 33.5), Q(99, 33.5), Q(101.5, 32.6),
                                           Q(100, 36), Q(98, 39), Q(72, 39), Q(69.5, 36)], fill=255))
    comp(hull, ramp((yy / U - 32 - dy) / 7, [(0, '#7a5050'), (0.35, '#57384a'), (1, '#2a1b3a')]))
    comp(pil_mask(lambda dr: dr.rectangle([Q(69.5, 35), Q(100, 35.7)], fill=255)) * hull, hexc('#a8456a'))
    # lit cabin windows
    for px in range(74, 99, 4):
        comp(pil_mask(lambda dr: dr.rectangle([Q(px, 36.2), Q(px + 0.9, 37)], fill=255)) * (0.85 + 0.15 * s(px / 9, 3)), hexc('#ffa94a'))
    comp(pil_mask(lambda dr: dr.line([Q(100.5, 33), Q(102, 32)], fill=255, width=int(0.6 * U))), hexc('#2a1b3a'))
    # anchor line
    comp(pil_mask(lambda dr: dr.line([Q(70.5, 34), P(69, 39.8)], fill=255, width=max(1, int(0.3 * U)))) * 0.8, hexc('#2a1b3a'))
ship()

# shoreline foam
def shoreline(x, base, amp, ph):
    return base + amp * np.sin(x / (9 * U) + ph) + 0.4 * amp * np.sin(x / (3.7 * U) + ph * 2)

sand_top = shoreline(xx, (45.5 + 0.25 * s(0.16)) * U, 0.9 * U, 0.3)
for base, a in ((41.6, 0.45), (43.6, 0.7)):
    edge = shoreline(xx, (base + 0.4 * s(base / 10)) * U, 0.7 * U, base)
    comp(np.clip(1 - np.abs(yy - edge) / (0.55 * U), 0, 1) * a, hexc('#ffffff'))

# ---- sand ------------------------------------------------------------
comp(np.clip((yy - sand_top) / (0.6 * U), 0, 1),
     ramp((yy - 44 * U) / (16 * U), [(0, '#d4b49c'), (0.12, '#e2c4a4'), (0.45, '#eed4b0'), (1, '#f4dcb6')]))
comp(np.clip(1 - np.abs(yy - sand_top) / (0.6 * U), 0, 1) * 0.85, hexc('#ffffff'))
speck = [(rng.uniform(0, 160), rng.uniform(47.5, 60), rng.choice([0, 1])) for _ in range(520)]
comp(batch([p for p in speck if p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.35, y + 0.35)], fill=190)), hexc('#f8e8c8'))
comp(batch([p for p in speck if not p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.35, y + 0.35)], fill=190)), hexc('#cca684'))

# ---- pumpkin patch -----------------------------------------------------
def vine(pts):
    comp(pil_mask(lambda dr: dr.line([P(*p) for p in pts], fill=255, width=max(1, int(0.55 * U)), joint='curve')), hexc('#2e4a2a'))

def leaf(x, y, r, ang):
    pts = [P(x + r * math.cos(ang + a) * (0.78 if i % 2 else 1), y + r * 0.7 * math.sin(ang + a) * (0.78 if i % 2 else 1))
           for i, a in enumerate(np.linspace(0, TAU, 11)[:-1])]
    comp(pil_mask(lambda dr: dr.polygon(pts, fill=255)), ramp((yy / U - (y - r)) / (2 * r), [(0, '#4e7a3a'), (1, '#24401f')]))

def pumpkin(cx, cy, w, h, face=None, k=0.0):
    # shadow
    comp(pil_mask(lambda dr: dr.ellipse([P(cx - w * 0.6, cy + h * 0.38), P(cx + w * 0.7, cy + h * 0.62)], fill=255)) * 0.35, hexc('#c09a7e'))
    body = pil_mask(lambda dr: [dr.ellipse([P(cx + ox * w - w * 0.3, cy - h / 2), P(cx + ox * w + w * 0.3, cy + h / 2)], fill=255)
                                for ox in (-0.2, 0.2, 0)])
    # lit from the sunset (upper right): bright orange facing it, dark red away
    stops = ([(0, '#5a2018'), (0.4, '#9a3a1e'), (0.75, '#c4501e'), (1, '#ee7a3a')] if face else
             [(0, '#7a2e22'), (0.35, '#c4501e'), (0.7, '#ee7a3a'), (1, '#ffa94a')])
    comp(body, ramp((xx / U - (cx - w / 2)) / w * 0.7 + (cy + h / 2 - yy / U) / h * 0.3, stops))
    # ribs
    for ox in (-0.2, 0.2):
        comp(pil_mask(lambda dr: dr.arc([P(cx + ox * w - w * 0.3, cy - h / 2), P(cx + ox * w + w * 0.3, cy + h / 2)],
                                         90 if ox < 0 else 270, 270 if ox < 0 else 90, fill=255, width=max(1, int(0.4 * U)))) * body * 0.6,
             hexc('#7a2e22'))
    # stem
    comp(pil_mask(lambda dr: dr.polygon([P(cx - 0.35, cy - h / 2 + 0.3), P(cx - 0.2, cy - h / 2 - 1.1), P(cx + 0.6, cy - h / 2 - 1.4),
                                         P(cx + 0.45, cy - h / 2 + 0.3)], fill=255)), hexc('#3a4a22'))
    if face:
        flick = 0.78 + 0.14 * s(k, 3) + 0.08 * s(k + 0.37, 5)
        g = np.hypot(xx - cx * U, yy - cy * U)
        comp(np.exp(-(g / (w * 1.1 * U)) ** 2) * 0.2 * flick * (1 - body), hexc('#ffa94a'))
        lit = ramp((yy / U - (cy - h * 0.3)) / (h * 0.7), [(0, '#fff1c4'), (0.5, '#ffd27a'), (1, '#ffa94a')])
        ew = w * 0.13
        fm = pil_mask(lambda dr: (
            dr.polygon([P(cx - w * 0.3, cy - h * 0.02), P(cx - w * 0.3 + ew, cy - h * 0.26), P(cx - w * 0.3 + 2 * ew, cy - h * 0.02)], fill=255),
            dr.polygon([P(cx + w * 0.3 - 2 * ew, cy - h * 0.02), P(cx + w * 0.3 - ew, cy - h * 0.26), P(cx + w * 0.3, cy - h * 0.02)], fill=255),
            dr.polygon([P(cx - w * 0.36, cy + h * 0.1), P(cx - w * 0.2, cy + h * 0.17), P(cx - w * 0.12, cy + h * 0.1),
                        P(cx, cy + h * 0.18), P(cx + w * 0.12, cy + h * 0.1), P(cx + w * 0.2, cy + h * 0.17),
                        P(cx + w * 0.36, cy + h * 0.1), P(cx + w * 0.22, cy + h * 0.33), P(cx - w * 0.22, cy + h * 0.33)], fill=255)))
        comp(fm, hexc('#3a1410'))
        comp(fm * (0.55 + 0.45 * flick), lit)

vine([(4, 52.5), (10, 51.6), (16, 53.4), (24, 52.2), (32, 54.2), (40, 53.6), (48, 55.2)])
vine([(14, 56.4), (20, 57.6), (28, 56.8), (36, 58.6)])
for x, y, r, a in ((8, 51.2, 1.4, 0.4), (19, 51.8, 1.3, 2.2), (27.5, 51.6, 1.5, 1.0), (37, 53.1, 1.2, 2.6), (45, 54.1, 1.3, 0.6),
                   (24, 56.4, 1.2, 1.7), (33, 57.8, 1.1, 0.3)):
    leaf(x, y, r, a)
pumpkin(12, 53.6, 7, 4.8, face=True, k=0.1)
pumpkin(22.5, 55.6, 4.4, 3.1)
pumpkin(32, 54.4, 8.4, 5.6, face=True, k=0.55)
pumpkin(42, 56.6, 4, 2.8)
pumpkin(5, 58, 3.8, 2.6)
pumpkin(48.5, 57.8, 5.6, 3.8, face=True, k=0.8)

# ---- lantern on a crooked post, by a crooked sign ----------------------
def lantern_post():
    lx, ly, base = 61, 41.5, 57
    comp(pil_mask(lambda dr: dr.ellipse([P(lx - 2, base - 0.5), P(lx + 3, base + 0.7)], fill=255)) * 0.35, hexc('#c09a7e'))
    comp(pil_mask(lambda dr: dr.polygon([P(lx - 0.45, base), P(lx + 0.45, base), P(lx + 0.95, ly), P(lx + 0.05, ly)], fill=255)),
         ramp((xx / U - lx) / 1.2, [(0, '#2e1c0e'), (1, '#5a3919')]))
    comp(pil_mask(lambda dr: dr.rectangle([P(lx + 0.5, ly), P(lx + 3.4, ly + 0.55)], fill=255)), hexc('#2e1c0e'))
    sw = 0.25 * s(0.7)
    hx = lx + 3 + sw
    flick = 0.75 + 0.15 * s(0.2, 3) + 0.1 * s(0.7, 5)
    gl = np.hypot(xx - hx * U, yy - (ly + 2.6) * U)
    comp(np.exp(-(gl / (7 * U)) ** 2) * 0.3 * flick, hexc('#fad8b8'))
    comp(np.exp(-(gl / (3 * U)) ** 2) * 0.5 * flick, hexc('#fff1c4'))
    comp(pil_mask(lambda dr: dr.line([P(lx + 3, ly + 0.5), P(hx, ly + 1.2)], fill=255, width=1)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: dr.rectangle([P(hx - 0.9, ly + 1.2), P(hx + 0.9, ly + 4)], fill=255)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: dr.rectangle([P(hx - 0.5, ly + 1.7), P(hx + 0.5, ly + 3.5)], fill=255)) * flick, hexc('#ffe6a0'))
    # crooked sign beside it
    comp(pil_mask(lambda dr: dr.polygon([P(66.4, base + 0.3), P(67.2, base + 0.3), P(67.9, 49), P(67.1, 49)], fill=255)),
         ramp((xx / U - 66.4) / 1.4, [(0, '#2e1c0e'), (1, '#5a3919')]))
    board = [P(63.6, 49.4), P(71.8, 48.2), P(72.2, 51.1), P(64, 52.3)]
    bm = pil_mask(lambda dr: dr.polygon(board, fill=255))
    comp(bm, ramp((yy / U - 48.2) / 4, [(0, '#b8854f'), (0.5, '#8a5a2e'), (1, '#5a3919')]))
    comp(pil_mask(lambda dr: dr.line([P(64.2, 50.85), P(71.9, 49.65)], fill=255, width=1)) * bm * 0.6, hexc('#4a2e17'))
    # a little skull painted on it
    comp(pil_mask(lambda dr: (dr.ellipse([P(67, 49.2), P(68.8, 50.8)], fill=255), dr.rectangle([P(67.4, 50.4), P(68.4, 51.2)], fill=255))),
         hexc('#f6ecd8'))
    comp(pil_mask(lambda dr: [dr.rectangle([P(ex, 49.8), P(ex + 0.45, 50.3)], fill=255) for ex in (67.4, 68.0)]), hexc('#2e1c0e'))
lantern_post()

# washed-up driftwood and a bone or two on the right beach
comp(pil_mask(lambda dr: dr.line([P(118, 55.2), P(130, 54.2)], fill=255, width=int(0.9 * U))), hexc('#8a5a2e'))
comp(pil_mask(lambda dr: dr.line([P(118, 55.6), P(130, 54.6)], fill=255, width=int(0.4 * U))), hexc('#4a2e17'))
for bx, by in ((104, 57.5), (140, 52.8)):
    comp(pil_mask(lambda dr: (dr.line([P(bx, by), P(bx + 2.6, by - 0.5)], fill=255, width=int(0.5 * U)),
                              [dr.ellipse([P(bx + ox - 0.45, by + oy - 0.45), P(bx + ox + 0.45, by + oy + 0.45)], fill=255)
                               for ox, oy in ((0, -0.3), (0, 0.3), (2.6, -0.8), (2.6, -0.2))])), hexc('#e8d8c4'))

# ---- downsample + dither --------------------------------------------
smooth = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
smooth.save(sys.argv[1])
pal = np.stack([hexc(c) for c in sorted(USED)])

def bayer(n):
    m = np.array([[0, 2], [3, 1]])
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return (m + 0.5) / m.size - 0.5

src = np.asarray(smooth, np.float32)
thr = np.tile(bayer(8), (H // 8 + 1, W // 8 + 1))[:H, :W, None]
pert = src + thr * 34.0
out = pal[((pert[:, :, None, :] - pal[None, None]) ** 2).sum(-1).argmin(-1)].astype(np.uint8)
Image.fromarray(out).save(sys.argv[2], optimize=True)
