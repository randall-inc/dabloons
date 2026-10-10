"""Home page hero: wide beach with pirate ship, 800x300 dither grid.

Usage: python hero_beach.py SMOOTH_OUT.png FRAME_OUT.png PHASE
PHASE is 0..1 around the animation loop; 0 is the still frame.
"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2                      # supersample factor for drawing
W, H = 800, 300            # final dither grid
DW, DH = W * S, H * S
U = DW / 160               # original 160x60 art units -> draw px

rng = np.random.default_rng(7)
prng = np.random.default_rng(11)   # per-element animation phases, separate so the scene stays identical
PH = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
TAU = 2 * math.pi
yy, xx = np.mgrid[0:DH, 0:DW].astype(np.float32)
img = np.zeros((DH, DW, 3), np.float32)

def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)

def ramp(t, stops):
    """Piecewise-linear color ramp. stops: [(pos, '#hex'), ...]"""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (t >= p0) & (t <= p1)
        f = ((t - p0) / max(p1 - p0, 1e-6))[..., None]
        out[m] = (hexc(c0) * (1 - f) + hexc(c1) * f)[m]
    return out

def comp(mask, color):
    """Alpha-composite a color (rgb array or HxWx3) through a 0..1 mask."""
    global img
    a = np.clip(mask, 0, 1)[..., None]
    img = img * (1 - a) + np.broadcast_to(color, img.shape) * a

def pil_mask(draw_fn):
    m = Image.new('L', (DW, DH), 0)
    draw_fn(ImageDraw.Draw(m))
    return np.asarray(m, np.float32) / 255

P = lambda x, y: (x * U, y * U)
HZ = 30 * U                       # horizon line

# ---- sky -------------------------------------------------------------
t = yy / HZ
img[:] = ramp(t, [(0, '#16215a'), (0.18, '#1d2b6e'), (0.45, '#3a5fbd'),
                  (0.68, '#6f90c4'), (0.84, '#aec3e6'), (0.93, '#f0c7a4'), (1, '#f7d9b8')])

# sun glow + disc
sx, sy = 56 * U, 19 * U
d = np.hypot(xx - sx, yy - sy)
comp(np.exp(-(d / (14 * U)) ** 2) * 0.6 * (yy < HZ), hexc('#aec3e6'))
comp(np.exp(-(d / (9 * U)) ** 2) * 0.7 * (yy < HZ), hexc('#dde7f7'))
comp(np.exp(-(d / (7.5 * U)) ** 2) * 0.8 * (yy < HZ), hexc('#fff1c4'))
disc = np.clip((6 * U - d) / 2, 0, 1)
comp(disc, ramp((d / (6 * U)), [(0, '#fffbe6'), (0.6, '#fff1c4'), (1, '#ffd862')]))

# clouds: union of circles, lit from the top
def cloud(cx, cy, w, h, puffs):
    cx += 0.6 * math.sin(TAU * PH + cx)
    m = pil_mask(lambda dr: [dr.ellipse([(cx + ox - r) * U, (cy + oy - r) * U,
                                         (cx + ox + r) * U, (cy + oy + r) * U], fill=255)
                             for ox, oy, r in puffs] +
                 [dr.rounded_rectangle([(cx - w / 2) * U, (cy) * U, (cx + w / 2) * U, (cy + h) * U],
                                       radius=h * U / 2, fill=255)])
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    top = cy - max(r - oy for ox, oy, r in puffs)
    comp(m, ramp((yy - top * U) / ((cy + h - top) * U), [(0, '#ffffff'), (0.55, '#f2f5fb'), (0.8, '#dde7f7'), (1, '#aec3e6')]))

cloud(15.5, 7, 22, 3, [(-4, 0, 3.2), (1, -1.5, 4), (6, 0.3, 3)])
cloud(87.5, 5.5, 19, 2.6, [(-3, 0, 2.8), (1.5, -1.6, 3.6), (5.5, 0.4, 2.4)])
cloud(138.5, 13, 13, 2, [(-1.5, 0, 2.2), (2, -0.6, 2.4)])

# birds
def bird(x, y, s=1.0):
    k = x
    x += 1.2 * math.sin(TAU * PH + k); y += 0.4 * math.sin(TAU * 2 * PH + k)
    up = math.sin(TAU * 3 * PH + k) > 0
    mid, tip = (1.4, 0.8) if up else (0.7, -0.3)
    m = pil_mask(lambda dr: dr.line([P(x - 2.5 * s, y - tip * s), P(x - 1.2 * s, y - mid * s), P(x, y),
                                     P(x + 1.2 * s, y - mid * s), P(x + 2.5 * s, y - tip * s)],
                                    fill=255, width=int(0.75 * U), joint='curve'))
    comp(m, hexc('#262a44'))
bird(72.5, 7.6); bird(90.5, 9.6); bird(82.5, 12.6, 0.9)

# distant island
isl = pil_mask(lambda dr: dr.polygon([P(136, 30.2), P(140, 28.6), P(144, 27.2), P(148, 27.4),
                                     P(152, 28.6), P(157, 29.4), P(158, 30.2)], fill=255))
comp(isl * 0.9, ramp((yy - 27 * U) / (3 * U), [(0, '#5d77a3'), (1, '#737f9e')]))

# ---- sea -------------------------------------------------------------
SEA_END = 46 * U
sea = (yy >= HZ)
ts = (yy - HZ) / (SEA_END - HZ)
sea_col = ramp(ts, [(0, '#23609e'), (0.08, '#2f6eb4'), (0.35, '#2a80c1'), (0.6, '#2f96ca'),
                    (0.8, '#47b5cd'), (1, '#80d6d0')])
comp(sea.astype(np.float32), sea_col)
# wave streaks: thin horizontal glints, denser & longer near shore
for _ in range(260):
    y = rng.uniform(31, 44)
    f = (y - 30) / 14
    x = rng.uniform(0, 160); L = rng.uniform(1, 2 + 5 * f)
    col = '#7cc3ea' if f < 0.6 else '#dff5f4'
    k = prng.uniform()
    x += 0.8 * math.sin(TAU * (PH + k))
    tw = 0.55 + 0.45 * (0.5 + 0.5 * math.sin(TAU * (2 * PH + k)))
    m = pil_mask(lambda dr: dr.rectangle([P(x, y), P(x + L, y + 0.35 + 0.25 * f)], fill=255))
    comp(m * (0.35 + 0.4 * f) * tw, hexc(col))
# horizon haze
comp(np.exp(-((yy - HZ) / (1.2 * U)) ** 2) * sea * 0.35, hexc('#98b9e8'))

# sun reflection column, broken into shimmering dashes
for _ in range(140):
    y = rng.uniform(30.6, 45)
    f = (y - 30) / 15
    half = 2 + 4 * f
    x = 57 + rng.normal(0, half * 0.5)
    L = rng.uniform(0.6, 2.5)
    k = prng.uniform()
    x += 0.6 * math.sin(TAU * (2 * PH + k))
    on = 1.0 if math.sin(TAU * (2 * PH + k)) > -0.3 else 0.35
    m = pil_mask(lambda dr: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.45)], fill=255))
    comp(m * (0.9 - 0.4 * f) * on, hexc('#fff1c4'))

# ---- ship ------------------------------------------------------------
def ship():
    dy = 0.35 * math.sin(TAU * PH)          # gentle bob
    P = lambda x, y: (x * U, (y + dy) * U)
    # reflection
    refl = pil_mask(lambda dr: dr.rectangle([P(101, 39), P(133, 41.5)], fill=255))
    comp(refl * 0.35 * (np.sin(yy / (0.5 * U) * math.pi) > -0.2), hexc('#1d3f78'))
    # masts
    for mx, top in ((110.5, 15), (123.5, 15)):
        comp(pil_mask(lambda dr: dr.rectangle([P(mx - 0.5, top), P(mx + 0.5, 34)], fill=255)), hexc('#4a2e17'))
    # sails: billowed rounded rects, lit from left (sun side)
    for mx in (110.5, 123.5):
        for (y0, y1, hw) in ((19.5, 25.5, 4.4), (26, 32, 5.6)):
            m = pil_mask(lambda dr: dr.rounded_rectangle([P(mx - hw, y0), P(mx + hw, y1)], radius=2.2 * U, fill=255))
            shade = ramp((xx - (mx - hw) * U) / (2 * hw * U), [(0, '#fff8e4'), (0.5, '#f4ecd6'), (1, '#cfc2a4')])
            comp(m, shade)
        comp(pil_mask(lambda dr: dr.rectangle([P(mx - 0.5, 18), P(mx + 0.5, 33)], fill=255)), hexc('#4a2e17'))
    # flags
    comp(pil_mask(lambda dr: dr.rectangle([P(110, 15), P(114, 18)], fill=255)), hexc('#15151f'))
    comp(pil_mask(lambda dr: dr.rectangle([P(111.3, 16), P(112.4, 17)], fill=255)), hexc('#f2f2f2'))
    comp(pil_mask(lambda dr: dr.polygon([P(124, 15), P(126.5, 16.2), P(124, 17.2)], fill=255)), hexc('#c23b30'))
    # hull
    hull = pil_mask(lambda dr: dr.polygon([P(100, 32.3), P(103, 32), P(103.5, 33.5), P(131, 33.5),
                                          P(133.5, 32.6), P(132, 36), P(130, 39), P(104, 39), P(101.5, 36)], fill=255))
    comp(hull, ramp((yy - (32 + dy) * U) / (7 * U), [(0, '#6e4424'), (0.35, '#5a3919'), (1, '#2e1c0e')]))
    comp(pil_mask(lambda dr: dr.rectangle([P(101.5, 35), P(132, 35.8)], fill=255)) * hull, hexc('#d4a84a'))
    for px in range(106, 131, 4):
        comp(pil_mask(lambda dr: dr.rectangle([P(px, 36.3), P(px + 0.9, 37.1)], fill=255)), hexc('#15151f'))
    comp(pil_mask(lambda dr: dr.line([P(132.5, 33), P(134, 32)], fill=255, width=int(0.6 * U))), hexc('#4a2e17'))
ship()

# foam bands at the shoreline (wavy)
def shoreline(x, base, amp, ph):
    return base + amp * np.sin(x / (9 * U) + ph) + 0.4 * amp * np.sin(x / (3.7 * U) + ph * 2)

sand_top = shoreline(xx, (45.5 + 0.25 * math.sin(TAU * PH + 1)) * U, 0.9 * U, 0.3)
for base, col, a in ((41.6, '#dff5f4', 0.55), (43.6, '#f4fbfb', 0.8)):
    edge = shoreline(xx, (base + 0.4 * math.sin(TAU * PH + base)) * U, 0.7 * U, base)
    band = np.clip(1 - np.abs(yy - edge) / (0.55 * U), 0, 1)
    comp(band * a, hexc(col))

# ---- sand ------------------------------------------------------------
wet = np.clip((yy - sand_top) / (0.6 * U), 0, 1)
tsd = (yy - 44 * U) / (16 * U)
comp(wet, ramp(tsd, [(0, '#c9a26a'), (0.08, '#d8b87e'), (0.3, '#ecd39c'), (1, '#f2dcab')]))
comp(np.clip(1 - np.abs(yy - sand_top) / (0.6 * U), 0, 1) * 0.9, hexc('#f4fbfb'))   # foam lip
# sand speckle
for _ in range(500):
    x, y = rng.uniform(0, 160), rng.uniform(47, 60)
    c = rng.choice(['#d2b27a', '#f7e5ba', '#dbbb80', '#f6d0d4'], p=[0.45, 0.4, 0.13, 0.02])
    m = pil_mask(lambda dr: dr.rectangle([P(x, y), P(x + 0.35, y + 0.35)], fill=255))
    comp(m * 0.8, hexc(c))

# rock
rock = pil_mask(lambda dr: dr.chord([P(141, 46.5), P(151, 54)], 180, 360, fill=255))
comp(rock, ramp((xx - 141 * U) / (10 * U) + (yy - 47 * U) / (8 * U), [(0, '#a5a9b3'), (0.6, '#737885'), (1.3, '#50545e')]))

# starfish
def star(cx, cy, r):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        pts.append(P(cx + rr * math.cos(a), cy + rr * math.sin(a)))
    comp(pil_mask(lambda dr: dr.polygon(pts, fill=255)), hexc('#e8743b'))
star(104.5, 55.5, 1.6)

# treasure chest + spilled coins
def chest():
    shadow = pil_mask(lambda dr: dr.ellipse([P(66.5, 53.8), P(79, 56)], fill=255))
    comp(shadow * 0.25, hexc('#8a5e33'))
    lid = pil_mask(lambda dr: dr.chord([P(68, 48), P(77, 53)], 180, 360, fill=255))
    body = pil_mask(lambda dr: dr.rectangle([P(68, 50.5), P(77, 55)], fill=255))
    comp(np.maximum(lid, body), ramp((yy - 48 * U) / (7 * U), [(0, '#8f6538'), (0.4, '#6e4a28'), (1, '#43281a')]))
    comp(pil_mask(lambda dr: dr.rectangle([P(68, 50.6), P(77, 51.3)], fill=255)), hexc('#d9ae42'))
    for bx in (69.2, 75.3):
        comp(pil_mask(lambda dr: dr.rectangle([P(bx, 48.6), P(bx + 0.7, 55)], fill=255)) * np.maximum(lid, body), hexc('#d9ae42'))
    comp(pil_mask(lambda dr: dr.rectangle([P(72.1, 51), P(73, 52.3)], fill=255)), hexc('#15151f'))
    comp(pil_mask(lambda dr: dr.ellipse([P(69.5, 47.6), P(75.5, 49.4)], fill=255)) * 0.95, hexc('#ffd84a'))
    for cx, cy in ((66, 54.3), (65.3, 56.3), (78.3, 53.5), (79.3, 55.4), (77.2, 57.4), (70.3, 47.8), (74, 47.7)):
        comp(pil_mask(lambda dr: dr.ellipse([P(cx - 0.55, cy - 0.45), P(cx + 0.55, cy + 0.45)], fill=255)), hexc('#ffd84a'))
chest()

# palm tree
def palm():
    shadow = pil_mask(lambda dr: dr.ellipse([P(12, 56.6), P(31, 58.6)], fill=255))
    comp(shadow * 0.3, hexc('#c9a26a'))
    # trunk: quadratic curve made of tapered segments
    p0, p1, p2 = np.array([20.5, 58.0]), np.array([22, 40]), np.array([30.5, 26.5])
    m = Image.new('L', (DW, DH), 0); dr = ImageDraw.Draw(m)
    n = 60
    for i in range(n):
        t = i / (n - 1)
        q = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
        r = 1.5 - 0.6 * t
        dr.ellipse([P(q[0] - r, q[1] - r * 0.6), P(q[0] + r, q[1] + r * 0.6)], fill=255)
    tm = np.asarray(m, np.float32) / 255
    # bark rings
    rings = 0.5 + 0.5 * np.sin(yy / (1.25 * U) * math.pi)
    bark = ramp(rings * 0.6 + (xx - 18 * U) / (14 * U) * 0.4, [(0, '#8a5a2e'), (0.5, '#6e4424'), (1, '#4e2f17')])
    comp(tm, bark)
    # fronds: drooping leaf shapes from the crown
    cx, cy = 31, 26.5
    fronds = [(-21, 9, 1), (-17, 2, 1), (-10, -3.5, 0.9), (-3, -5, 0.8), (5, -4.5, 0.85),
              (12, -1, 0.95), (19, 5, 1), (22, 11, 0.9), (-13, 11, 0.8), (10, 9, 0.8)]
    leaf = ramp((yy - (cy - 6) * U) / (18 * U), [(0, '#5cbd55'), (0.3, '#2f8c3b'), (0.65, '#1e6a2d'), (1, '#1a5526')])
    for dx, dy, w in fronds:
        sw = math.sin(TAU * PH + dx * 0.3)     # sway
        ex, ey = cx + dx + 0.4 * sw, cy + dy + 0.3 * sw
        mx, my = cx + dx * 0.45, cy + min(dy, 0) - 3.5 - abs(dx) * 0.12
        side = 1 if dx >= 0 else -1
        def run(dr):
            prev = None
            for i in range(31):
                t = i / 30
                bx = (1 - t) ** 2 * cx + 2 * (1 - t) * t * mx + t * t * ex
                by = (1 - t) ** 2 * cy + 2 * (1 - t) * t * my + t * t * ey
                if prev: dr.line([P(*prev), P(bx, by)], fill=255, width=max(1, int(0.55 * U)))
                prev = (bx, by)
                if 0.08 < t < 0.98:
                    L = 3.2 * w * math.sin(math.pi * min(t * 1.1, 1)) + 0.4
                    for ang in (0.35, 1.25):   # leaflets drooping below and forward
                        lx = bx + side * L * math.cos(ang) * 0.55
                        ly = by + L * math.sin(ang) * 0.75
                        dr.line([P(bx, by), P(lx, ly)], fill=255, width=max(1, int(0.5 * U)))
        comp(pil_mask(run), leaf)
    # coconuts
    for ox, oy in ((-0.9, 0.6), (0.9, 0.9), (0, 1.6)):
        comp(pil_mask(lambda d: d.ellipse([P(cx + ox - 0.8, cy + oy - 0.8), P(cx + ox + 0.8, cy + oy + 0.8)], fill=255)), hexc('#43281a'))
palm()

# ---- downsample + dither --------------------------------------------
smooth = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
smooth.save(sys.argv[1])

PALETTE = ['#16215a', '#1d2b6e', '#27409a', '#3a5fbd', '#5f8bd6', '#6f90c4', '#98b9e8', '#aec3e6', '#dde7f7',
           '#ffffff', '#f0c7a4', '#f7d9b8', '#fff1c4', '#ffe6a0', '#ffd862', '#ffd84a', '#d9ae42',
           '#23609e', '#2f6eb4', '#2a80c1', '#2f96ca', '#47b5cd', '#80d6d0', '#dff5f4', '#1d3f78',
           '#c9a26a', '#d8b87e', '#ecd39c', '#f7e5ba', '#d2b27a', '#8a5e33',
           '#8f6538', '#6e4424', '#4a2e17', '#2e1c0e', '#15151f', '#262a44', '#5d77a3', '#737885', '#a5a9b3', '#50545e',
           '#f4ecd6', '#cfc2a4', '#c23b30', '#e8743b', '#5cbd55', '#2f8c3b', '#1e6a2d', '#1a5526']
pal = np.stack([hexc(c) for c in PALETTE])

def bayer(n):
    m = np.array([[0, 2], [3, 1]])
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return (m + 0.5) / m.size - 0.5

src = np.asarray(smooth, np.float32)
B = bayer(8)
thr = np.tile(B, (H // 8 + 1, W // 8 + 1))[:H, :W, None]
spread = 34.0
pert = src + thr * spread
dist = ((pert[:, :, None, :] - pal[None, None]) ** 2).sum(-1)
out = pal[dist.argmin(-1)].astype(np.uint8)
Image.fromarray(out).save(sys.argv[2], optimize=True)
