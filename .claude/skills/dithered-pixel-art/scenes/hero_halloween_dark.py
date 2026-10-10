"""Halloween home hero: haunted cove with ghost ship under a harvest moon, 800x300 dither grid.

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

def batch(items, fn, blur=0):
    m = Image.new('L', (DW, DH), 0)
    dr = ImageDraw.Draw(m)
    for it in items: fn(dr, *it)
    if blur: m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(m, np.float32) / 255

P = lambda x, y: (x * U, y * U)
HZ = 30 * U
s = lambda k, f=1: math.sin(TAU * (f * PH + k))

# ---- sky -------------------------------------------------------------
img[:] = ramp(yy / HZ, [(0, '#0e0b26'), (0.25, '#1a1440'), (0.55, '#2e1f5e'), (0.78, '#4a2a6e'),
                        (0.92, '#7a3a6a'), (1, '#a24a62')])

# stars, twinkling, kept to the upper sky
stars = [(rng.uniform(0, 160), rng.uniform(0.5, 17), prng.uniform()) for _ in range(110)]
items = [(x, y, int(255 * (1 - y / 19) * (0.4 + 0.6 * (0.5 + 0.5 * s(k, 2))))) for x, y, k in stars]
comp(batch(items, lambda dr, x, y, a: dr.rectangle([P(x, y), P(x + 0.32, y + 0.32)], fill=a)), hexc('#e8e0ff'))
for x, y in ((14, 4), (148, 3), (62, 6.5)):
    a = 0.7 + 0.3 * s(x / 50, 2)
    comp(pil_mask(lambda dr: (dr.rectangle([P(x - 1, y - 0.14), P(x + 1, y + 0.14)], fill=255),
                              dr.rectangle([P(x - 0.14, y - 1), P(x + 0.14, y + 1)], fill=255))) * a, hexc('#ffffff'))

# harvest moon, low and huge, glow steps through warm purples so it never muds
mx, my, mr = 127 * U, 17 * U, 10 * U
d = np.hypot(xx - mx, yy - my)
sky = (yy < HZ).astype(np.float32)
comp(np.exp(-(d / (34 * U)) ** 2) * 0.55 * sky, hexc('#7a3a6a'))
comp(np.exp(-(d / (20 * U)) ** 2) * 0.55 * sky, hexc('#c2565a'))
comp(np.exp(-(d / (13 * U)) ** 2) * 0.6 * sky, hexc('#e8743b'))
disc = np.clip((mr - d) / 2, 0, 1)
comp(disc, ramp((yy - (my - mr)) / (2 * mr) + (xx - mx) / (6 * mr),
                [(0, '#ffd08a'), (0.45, '#f7a35c'), (0.85, '#e8843b'), (1, '#d86a3a')]))
# craters / maria
for cx, cy, rx, ry in ((-3.5, -3, 2.6, 2), (2.5, -4.5, 1.6, 1.2), (3.5, 1.5, 3, 2.3), (-4, 3.5, 1.8, 1.4), (0, 6.2, 1.4, 0.9)):
    comp(pil_mask(lambda dr: dr.ellipse([P(127 + cx - rx, 17 + cy - ry), P(127 + cx + rx, 17 + cy + ry)], fill=255), blur=1.2) * disc * 0.45,
         hexc('#d86a3a'))

# thin cloud bands drifting across the moon
for cy, x0, x1, th, k, a in ((11.5, 128, 156, 1.2, 0.1, 0.85), (20.5, 133, 162, 1.0, 0.5, 0.8), (25.2, 48, 86, 0.9, 0.3, 0.5)):
    dx = 1.2 * s(k)
    m = pil_mask(lambda dr: dr.rounded_rectangle([P(x0 + dx, cy), P(x1 + dx, cy + th)], radius=th * U / 2, fill=255), blur=3)
    comp(m * a, ramp((yy - cy * U) / (th * U), [(0, '#2e1f5e'), (0.6, '#4a2a6e'), (1, '#7a3a6a')]))

# bats flapping across the moon
def bat(x, y, sc=1.0, k=0.0):
    x += 1.2 * s(k); y += 0.5 * s(k, 2)
    up = s(k, 3) > 0
    tip, mid = (-1.6, -0.6) if up else (0.9, 0.5)
    pts = [(0, -0.5), (0.45, -0.85), (0.6, -0.3), (1.6, mid - 0.4), (3.0, tip), (2.6, 0.2 + max(0, tip) * 0.5),
           (2.0, 0.0 + max(0, tip) * 0.4), (1.5, 0.45 + max(0, tip) * 0.3), (0.9, 0.2), (0.4, 0.75), (0, 0.85)]
    poly = [P(x + px * sc, y + py * sc) for px, py in pts] + [P(x - px * sc, y + py * sc) for px, py in reversed(pts)]
    comp(pil_mask(lambda dr: dr.polygon(poly, fill=255)), hexc('#120c22'))
bat(129, 13.5, 1.15, 0.1); bat(134.5, 19.5, 0.9, 0.45); bat(124, 22, 0.75, 0.7); bat(142, 8.5, 0.7, 0.25); bat(150, 15, 0.6, 0.9)

# distant island silhouette
comp(pil_mask(lambda dr: dr.polygon([P(138, 30.2), P(141, 28.8), P(144, 27.6), P(147, 27.9), P(150, 26.6),
                                     P(153, 28.4), P(158, 29.4), P(160, 30.2)], fill=255)), hexc('#2a1b3a'))

# ---- sea -------------------------------------------------------------
SEA_END = 46 * U
sea = (yy >= HZ).astype(np.float32)
comp(sea, ramp((yy - HZ) / (SEA_END - HZ), [(0, '#5c3a6e'), (0.06, '#3d2a62'), (0.35, '#2a2256'),
                                             (0.7, '#1f1c48'), (1, '#262a5c')]))
comp(np.exp(-((yy - HZ) / (0.8 * U)) ** 2) * sea * 0.5, hexc('#a24a62'))

streaks = []
for _ in range(240):
    y = rng.uniform(31, 44); f = (y - 30) / 14
    x = rng.uniform(-4, 160); L = rng.uniform(1, 2 + 5 * f)
    k = prng.uniform()
    streaks.append((x + 0.8 * s(k), y, L, 0.35 + 0.25 * f,
                    int(255 * (0.3 + 0.35 * f) * (0.55 + 0.45 * (0.5 + 0.5 * s(k, 2))))))
comp(batch(streaks, lambda dr, x, y, L, th, a: dr.rectangle([P(x, y), P(x + L, y + th)], fill=a)), hexc('#4a3a78'))

# moon reflection column
refl = []
for _ in range(170):
    y = rng.uniform(30.5, 45); f = (y - 30) / 15
    x = 127 + rng.normal(0, 2 + 4 * f)
    L = rng.uniform(0.6, 2.8 - f)
    k = prng.uniform()
    on = 1.0 if s(k, 2) > -0.3 else 0.3
    refl.append((x + 0.6 * s(k, 2), y, L, int(255 * (0.95 - 0.5 * f) * on), f))
comp(batch([r for r in refl if r[4] >= 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.42)], fill=a)), hexc('#e8743b'))
comp(batch([r for r in refl if r[4] < 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.42)], fill=a)), hexc('#f7a35c'))

# ---- ghost ship ------------------------------------------------------
def ghost_ship():
    dy = 0.35 * s(0.15)
    OX = -5
    Q = lambda x, y: P(x + OX, y + dy)
    # eerie reflection
    comp(pil_mask(lambda dr: dr.rectangle([Q(97, 39), Q(131, 41.2)], fill=255)) * 0.3 *
         (np.sin(yy / (0.5 * U) * math.pi) > -0.2), hexc('#3e8a74'))
    # spectral glow around the rigging (tight, over the moon/sky)
    gm = pil_mask(lambda dr: dr.rounded_rectangle([Q(99, 13), Q(131, 37)], radius=6 * U, fill=255), blur=12)
    comp(gm * 0.18, hexc('#3e8a74'))
    # masts
    for mxx, top in ((107, 11.5), (121, 12.5)):
        comp(pil_mask(lambda dr: dr.rectangle([Q(mxx - 0.45, top), Q(mxx + 0.45, 34)], fill=255)), hexc('#1a1430'))
    # tattered sails: billowed shapes with ragged bottoms and holes, glowing pale green
    srng = np.random.default_rng(23)
    for mxx in (107, 121):
        for y0, y1, hw in ((15.5, 21.8, 4.2), (22.6, 31, 5.4)):
            k = mxx / 30 + y0 / 10
            b = 0.25 * s(k)     # billow
            def sail(dr):
                pts = [Q(mxx - hw + 0.6, y0), Q(mxx + hw - 0.6, y0), Q(mxx + hw + b, (y0 + y1) / 2)]
                n = 9
                for i in range(n + 1):
                    t = i / n
                    xr = mxx + hw + b - t * (2 * hw)
                    jag = srng.uniform(-1.4, 0.2) if 0 < i < n else 0
                    pts.append(Q(xr, y1 + jag))
                pts.append(Q(mxx - hw + b, (y0 + y1) / 2))
                dr.polygon(pts, fill=255)
            m = pil_mask(sail)
            holes = pil_mask(lambda dr: [dr.ellipse([Q(hx - hr, hy - hr * 0.8), Q(hx + hr, hy + hr * 0.8)], fill=255)
                                         for hx, hy, hr in [(mxx + srng.uniform(-hw + 1.2, hw - 1.2), srng.uniform(y0 + 1.2, y1 - 1.5),
                                                             srng.uniform(0.45, 0.9)) for _ in range(2)]])
            m = m * (1 - holes)
            comp(m * 0.92, ramp((xx - (mxx - hw) * U) / (2 * hw * U) * 0.6 + (yy - (y0 + dy) * U) / ((y1 - y0) * U) * 0.4,
                                [(0, '#dff5e0'), (0.35, '#a8e6b8'), (0.7, '#6fc49a'), (1, '#3e8a74')]))
            comp(pil_mask(lambda dr: dr.rectangle([Q(mxx - hw, y0 - 0.5), Q(mxx + hw, y0)], fill=255)), hexc('#1a1430'))
        comp(pil_mask(lambda dr: dr.rectangle([Q(mxx - 0.45, 15), Q(mxx + 0.45, 31)], fill=255)) * 0.6, hexc('#1a1430'))
    # tattered pennant flapping
    fl = 0.4 * s(0.3, 2)
    comp(pil_mask(lambda dr: dr.polygon([Q(107.4, 11.5), Q(111.5, 12 + fl), Q(110.2, 12.6 + fl), Q(111.8, 13.4 + fl), Q(107.4, 13.6)], fill=255)),
         hexc('#15151f'))
    comp(pil_mask(lambda dr: dr.rectangle([Q(108.3, 12.2), Q(109.2, 13)], fill=255)), hexc('#dff5e0'))
    # rigging lines
    comp(pil_mask(lambda dr: (dr.line([Q(107, 11.8), Q(97.5, 32.5)], fill=255, width=1),
                              dr.line([Q(107, 11.8), Q(121, 12.8)], fill=255, width=1),
                              dr.line([Q(121, 12.8), Q(131.5, 32)], fill=255, width=1))) * 0.8, hexc('#1a1430'))
    # hull, rotten wood silhouette with green rim light
    hull = pil_mask(lambda dr: dr.polygon([Q(96, 32.3), Q(99, 31.6), Q(99.5, 33.4), Q(127, 33.4),
                                           Q(130, 32.2), Q(133, 31.4), Q(131, 35.5), Q(128.5, 39), Q(100.5, 39), Q(98, 36)], fill=255))
    comp(hull, ramp((yy - (32 + dy) * U) / (7 * U), [(0, '#3a2a48'), (0.35, '#2a1b3a'), (1, '#1a1430')]))
    # bulwark with a broken railing, stern castle
    comp(pil_mask(lambda dr: dr.polygon([Q(99.5, 31.2), Q(127, 31.2), Q(127, 33.6), Q(99.5, 33.6)], fill=255)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: dr.polygon([Q(124, 28.6), Q(132.2, 28.4), Q(131.8, 31.6), Q(124, 31.6)], fill=255)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: (dr.rectangle([Q(99.5, 30.6), Q(112, 31.1)], fill=255), dr.rectangle([Q(114.5, 30.6), Q(124, 31.1)], fill=255),
                              dr.rectangle([Q(124, 28.1), Q(132.4, 28.6)], fill=255))), hexc('#3e8a74'))
    for bx in range(101, 124, 2):
        if bx != 113:
            comp(pil_mask(lambda dr: dr.rectangle([Q(bx, 31), Q(bx + 0.5, 31.4)], fill=255)), hexc('#1a1430'))
    comp(pil_mask(lambda dr: dr.line([Q(99.5, 33.6), Q(127, 33.6)], fill=255, width=max(1, int(0.45 * U)))), hexc('#3e8a74'))
    # broken planks
    for px, py in ((104, 36.8), (115, 37.4), (123, 36.2)):
        comp(pil_mask(lambda dr: dr.polygon([Q(px, py), Q(px + 2, py - 0.3), Q(px + 1.4, py + 0.7)], fill=255)), hexc('#0e0b26'))
    # portholes glowing green, pulsing
    pulse = 0.65 + 0.35 * s(0.4, 2)
    for px in range(103, 127, 5):
        comp(pil_mask(lambda dr: dr.rectangle([Q(px, 35.2), Q(px + 1, 36.1)], fill=255)) * pulse, hexc('#7dffb0'))
    # green lanterns on bow and stern
    for lx, ly, k in ((99, 29.6, 0.1), (131.5, 26.4, 0.6)):
        fl = 0.7 + 0.2 * s(k, 3) + 0.1 * s(k + 0.3, 5)
        gl = np.hypot(xx - (lx + OX) * U, yy - (ly + dy) * U)
        comp(np.exp(-(gl / (2.8 * U)) ** 2) * 0.45 * fl, hexc('#3e8a74'))
        comp(np.exp(-(gl / (1.4 * U)) ** 2) * 0.6 * fl, hexc('#7dffb0'))
        comp(pil_mask(lambda dr: dr.rectangle([Q(lx - 0.5, ly - 0.7), Q(lx + 0.5, ly + 0.7)], fill=255)) * fl, hexc('#dff5e0'))
        comp(pil_mask(lambda dr: dr.line([Q(lx, ly - 0.7), Q(lx, ly + 2.2)], fill=255, width=1)), hexc('#1a1430'))
    # bowsprit
    comp(pil_mask(lambda dr: dr.line([Q(132.5, 31.8), Q(136, 30.2)], fill=255, width=max(1, int(0.5 * U)))), hexc('#1a1430'))
ghost_ship()

# low fog wisps drifting over the water
fog_bands = [(31.5, -10, 60, 1.6, 0.0, 0.45), (33.5, 70, 150, 1.4, 0.35, 0.4), (36.5, 20, 95, 1.8, 0.6, 0.5),
             (38.5, 110, 175, 1.5, 0.8, 0.45), (41.5, -15, 50, 1.6, 0.2, 0.4)]
for cy, x0, x1, th, k, a in fog_bands:
    dx = 3 * s(k)
    m = pil_mask(lambda dr: [dr.ellipse([P(x0 + dx + i * (x1 - x0) / 5, cy - th * (0.6 + 0.3 * ((i * 7) % 3) / 2)),
                                         P(x0 + dx + i * (x1 - x0) / 5 + (x1 - x0) / 3, cy + th)], fill=255) for i in range(5)], blur=7)
    comp(m * a, ramp((yy - (cy - th) * U) / (2 * th * U), [(0, '#8a7aa8'), (0.6, '#6a5a90'), (1, '#4a3a78')]))

# ---- shore -----------------------------------------------------------
def shoreline(x, base, amp, ph):
    return base + amp * np.sin(x / (9 * U) + ph) + 0.4 * amp * np.sin(x / (3.7 * U) + ph * 2)

sand_top = shoreline(xx, (45.5 + 0.25 * s(0.16)) * U, 0.9 * U, 0.3)
for base, col, a in ((41.6, '#8a7aa8', 0.5), (43.6, '#b8a8c8', 0.75)):
    edge = shoreline(xx, (base + 0.4 * s(base / 10)) * U, 0.7 * U, base)
    comp(np.clip(1 - np.abs(yy - edge) / (0.55 * U), 0, 1) * a, hexc(col))

wet = np.clip((yy - sand_top) / (0.6 * U), 0, 1)
comp(wet, ramp((yy - 44 * U) / (16 * U), [(0, '#4a3a5a'), (0.1, '#5a4664'), (0.4, '#6e566e'), (1, '#7a6070')]))
comp(np.clip(1 - np.abs(yy - sand_top) / (0.6 * U), 0, 1) * 0.85, hexc('#b8a8c8'))
speck = [(rng.uniform(0, 160), rng.uniform(47, 60), rng.choice([0, 1])) for _ in range(500)]
comp(batch([p for p in speck if p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.35, y + 0.35)], fill=200)), hexc('#8a7080'))
comp(batch([p for p in speck if not p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.35, y + 0.35)], fill=200)), hexc('#4a3a5a'))

# rock with skull-ish shading, lit from the moon (right)
rock = pil_mask(lambda dr: dr.chord([P(140, 46.5), P(151, 54)], 180, 360, fill=255))
comp(rock, ramp((151 * U - xx) / (11 * U) + (yy - 47 * U) / (8 * U), [(0, '#7a6070'), (0.6, '#4a3a5a'), (1.3, '#2a1b3a')]))

# warm pumpkin light on the sand (painted before the chest/pumpkins so it sits under them)
FLICK = {}
LANTERNS = [(63.5, 55.2, 1.0, 0.05), (81, 54.6, 1.25, 0.4), (85.5, 56.6, 0.8, 0.75)]
for px, py, sc, k in LANTERNS:
    fl = 0.78 + 0.14 * s(k, 3) + 0.08 * s(k + 0.5, 5)
    FLICK[k] = fl
    gl = np.hypot(xx - px * U, (yy - py * U) * 1.6)
    comp(np.exp(-(gl / (7 * sc * U)) ** 2) * 0.4 * fl, hexc('#a86a5e'))
    comp(np.exp(-(gl / (3.6 * sc * U)) ** 2) * 0.35 * fl, hexc('#c98f6a'))

# treasure chest + spilled coins
def chest():
    comp(pil_mask(lambda dr: dr.ellipse([P(66.5, 53.8), P(79, 56)], fill=255)) * 0.35, hexc('#2a1b3a'))
    lid = pil_mask(lambda dr: dr.chord([P(68, 48), P(77, 53)], 180, 360, fill=255))
    body = pil_mask(lambda dr: dr.rectangle([P(68, 50.5), P(77, 55)], fill=255))
    box = np.maximum(lid, body)
    comp(box, ramp((xx - 68 * U) / (9 * U) * 0.5 + (yy - 48 * U) / (7 * U) * 0.5,
                   [(0, '#8f6538'), (0.4, '#6e4a28'), (1, '#43281a')]))
    comp(pil_mask(lambda dr: dr.rectangle([P(68, 50.6), P(77, 51.3)], fill=255)), hexc('#d9ae42'))
    for bx in (69.2, 75.3):
        comp(pil_mask(lambda dr: dr.rectangle([P(bx, 48.6), P(bx + 0.7, 55)], fill=255)) * box, hexc('#d9ae42'))
    comp(pil_mask(lambda dr: dr.rectangle([P(72.1, 51), P(73, 52.3)], fill=255)), hexc('#15151f'))
    comp(pil_mask(lambda dr: dr.ellipse([P(69.5, 47.6), P(75.5, 49.4)], fill=255)) * 0.95, hexc('#ffd84a'))
    for cx, cy in ((66, 54.6), (65.2, 56.6), (78.3, 55.8), (77.2, 57.6), (70.3, 47.8), (74, 47.7)):
        comp(pil_mask(lambda dr: dr.ellipse([P(cx - 0.55, cy - 0.45), P(cx + 0.55, cy + 0.45)], fill=255)), hexc('#ffd84a'))
chest()

# jack-o'-lanterns, carved faces flickering
def pumpkin(cx, cy, sc, k):
    fl = FLICK[k]
    r = 2.2 * sc
    comp(pil_mask(lambda dr: dr.ellipse([P(cx - r * 1.1, cy + r * 0.55), P(cx + r * 1.1, cy + r * 1.05)], fill=255)) * 0.4, hexc('#2a1b3a'))
    body = pil_mask(lambda dr: [dr.ellipse([P(cx + ox * r - r * 0.62, cy - r * 0.85), P(cx + ox * r + r * 0.62, cy + r * 0.85)], fill=255)
                                for ox in (-0.45, 0.45, 0)])
    # lit from the moon (right) and slightly from within
    comp(body, ramp((xx - (cx - r * 1.1) * U) / (2.2 * r * U) * 0.7 + (yy - (cy - r) * U) / (2 * r * U) * 0.3,
                    [(0, '#7a2a2a'), (0.35, '#c2501e'), (0.75, '#e8743b'), (1, '#f7a35c')]))
    # ribs
    for ox in (-0.42, 0.42):
        comp(pil_mask(lambda dr: dr.arc([P(cx + ox * r - r * 0.3, cy - r * 0.8), P(cx + ox * r + r * 0.3, cy + r * 0.8)],
                                        90 if ox < 0 else 270, 270 if ox < 0 else 90, fill=255, width=max(1, int(0.3 * U)))) * 0.6,
             hexc('#7a2a2a'))
    # stem
    comp(pil_mask(lambda dr: dr.polygon([P(cx - 0.25 * sc, cy - r * 0.8), P(cx + 0.35 * sc, cy - r * 0.8),
                                         P(cx + 0.6 * sc, cy - r * 1.25), P(cx + 0.1 * sc, cy - r * 1.2)], fill=255)), hexc('#3d5a2a'))
    # face
    glow = ramp(np.full(img.shape[:2], fl), [(0, '#e8843b'), (0.8, '#ffd862'), (1, '#ffe6a0')])
    face = pil_mask(lambda dr: (
        dr.polygon([P(cx - 0.95 * r * 0.75, cy - 0.12 * r), P(cx - 0.55 * r * 0.75, cy - 0.62 * r), P(cx - 0.18 * r * 0.75, cy - 0.12 * r)], fill=255),
        dr.polygon([P(cx + 0.18 * r * 0.75, cy - 0.12 * r), P(cx + 0.55 * r * 0.75, cy - 0.62 * r), P(cx + 0.95 * r * 0.75, cy - 0.12 * r)], fill=255),
        dr.polygon([P(cx - 0.18 * r, cy + 0.0), P(cx + 0.18 * r, cy + 0.0), P(cx, cy + 0.22 * r)], fill=255),
        dr.polygon([P(cx - 0.75 * r, cy + 0.2 * r), P(cx - 0.45 * r, cy + 0.36 * r), P(cx - 0.3 * r, cy + 0.24 * r),
                    P(cx - 0.12 * r, cy + 0.42 * r), P(cx + 0.12 * r, cy + 0.26 * r), P(cx + 0.3 * r, cy + 0.42 * r),
                    P(cx + 0.45 * r, cy + 0.26 * r), P(cx + 0.75 * r, cy + 0.2 * r), P(cx + 0.45 * r, cy + 0.6 * r),
                    P(cx - 0.45 * r, cy + 0.6 * r)], fill=255)))
    comp(face, hexc('#43281a'))
    comp(face * fl, glow)
for px, py, sc, k in LANTERNS:
    pumpkin(px, py - 1.4 * sc, sc, k)

# small skull on the sand
def skull(cx, cy):
    comp(pil_mask(lambda dr: dr.ellipse([P(cx - 1.3, cy + 0.9), P(cx + 1.5, cy + 1.6)], fill=255)) * 0.4, hexc('#2a1b3a'))
    m = pil_mask(lambda dr: (dr.ellipse([P(cx - 1.1, cy - 1.1), P(cx + 1.1, cy + 0.7)], fill=255),
                             dr.rectangle([P(cx - 0.6, cy + 0.3), P(cx + 0.6, cy + 1.2)], fill=255)))
    comp(m, ramp((xx - (cx - 1.1) * U) / (2.2 * U), [(0, '#8a7080'), (0.6, '#cfc2d8'), (1, '#e8e0ff')]))
    for ex in (-0.45, 0.45):
        comp(pil_mask(lambda dr: dr.ellipse([P(cx + ex - 0.32, cy - 0.35), P(cx + ex + 0.32, cy + 0.25)], fill=255)), hexc('#1a1430'))
    comp(pil_mask(lambda dr: dr.rectangle([P(cx - 0.08, cy + 0.6), P(cx + 0.08, cy + 1.2)], fill=255)), hexc('#4a3a5a'))
skull(104.5, 55.5)

# bare twisted dead tree on the left
def dead_tree():
    comp(pil_mask(lambda dr: dr.ellipse([P(12, 56.6), P(32, 58.8)], fill=255)) * 0.4, hexc('#2a1b3a'))
    m = Image.new('L', (DW, DH), 0); dr = ImageDraw.Draw(m)

    def limb(p0, p1, p2, r0, r1, n=40):
        for i in range(n):
            t = i / (n - 1)
            q = (1 - t) ** 2 * np.array(p0) + 2 * (1 - t) * t * np.array(p1) + t * t * np.array(p2)
            r = r0 + (r1 - r0) * t
            dr.ellipse([P(q[0] - r, q[1] - r), P(q[0] + r, q[1] + r)], fill=255)

    sw = 0.3 * s(0.2)
    # trunk: leaning, gnarled S-curve reaching up into the sky
    limb((20.5, 58.2), (16.5, 47), (21.5, 37), 2.1, 1.15, 80)
    limb((21.5, 37), (25.5, 29), (22.5, 19), 1.15, 0.5, 70)
    # roots
    limb((20.5, 57.5), (16.5, 58), (12.5, 58.7), 0.9, 0.35)
    limb((21.5, 57.5), (25, 57.6), (28.5, 58.7), 0.9, 0.35)
    limb((19.6, 57.8), (18.5, 58.6), (17, 59.2), 0.6, 0.3)
    # branches as (start, control, end, r0, r1); tips sway a little
    br = [((21.8, 38), (28, 34.5), (35, 27), 0.85, 0.35),
          ((30.5, 31.5), (34, 31.5), (38, 33.8), 0.45, 0.25),
          ((33.5, 28.8), (35.5, 25), (34, 21.5), 0.4, 0.25),
          ((20.6, 42), (14.5, 38.5), (9.5, 30), 0.85, 0.35),
          ((12.6, 34.6), (8.5, 33.5), (5.5, 35.5), 0.42, 0.25),
          ((10.6, 31.8), (10, 28), (12.5, 25.5), 0.38, 0.25),
          ((23.4, 27), (28.5, 23.5), (30.5, 17), 0.55, 0.28),
          ((28.6, 21), (31.5, 20), (33.5, 18.5), 0.3, 0.25),
          ((23.3, 29), (18, 25.5), (15.5, 19.5), 0.55, 0.28),
          ((17, 23), (14, 22), (12.5, 22.8), 0.3, 0.25),
          ((22.6, 21), (21, 17), (23.5, 13.5), 0.4, 0.25),
          ((22.7, 22), (25.5, 18.5), (26.5, 15.5), 0.32, 0.25)]
    for a, b, c, r0, r1 in br:
        k = c[0] / 20
        c = (c[0] + 0.35 * s(k), c[1] + 0.15 * s(k))
        limb(a, b, c, r0, r1)
    tm = np.asarray(m, np.float32) / 255
    comp(tm, ramp((xx - 8 * U) / (28 * U), [(0, '#0e0b26'), (0.6, '#120c22'), (1, '#1f1430')]))
    # moon-side rim light on the trunk
    shifted = np.roll(tm, -int(0.5 * U), axis=1)
    comp(np.clip(tm - shifted, 0, 1) * 0.8, hexc('#5c3577'))
    # knot hole
    comp(pil_mask(lambda dr: dr.ellipse([P(18.2, 46.5), P(19.4, 48.2)], fill=255)), hexc('#0e0b26'))
dead_tree()

# a crooked grave marker near the tree
def cross(cx, cy):
    comp(pil_mask(lambda dr: dr.polygon([P(cx - 0.4, cy - 4), P(cx + 0.4, cy - 4.1), P(cx + 0.55, cy), P(cx - 0.35, cy)], fill=255)),
         ramp((xx - (cx - 0.4) * U) / (0.9 * U), [(0, '#43281a'), (1, '#6e4a28')]))
    comp(pil_mask(lambda dr: dr.polygon([P(cx - 1.8, cy - 3.0), P(cx + 1.7, cy - 3.3), P(cx + 1.7, cy - 2.6), P(cx - 1.8, cy - 2.3)], fill=255)),
         ramp((xx - (cx - 1.8) * U) / (3.5 * U), [(0, '#43281a'), (1, '#6e4a28')]))
cross(36, 57.5)

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
