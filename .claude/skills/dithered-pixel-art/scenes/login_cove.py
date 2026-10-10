"""Login page art panel: portrait sunset cove with lighthouse, 360x450 dither grid.

Usage: python login_cove.py SMOOTH_OUT.png FRAME_OUT.png PHASE
PHASE is 0..1 around the animation loop; 0 is the still frame.
The palette is every color the scene passes to hexc(), so new colors join it automatically.
"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2
W, H = 360, 450
DW, DH = W * S, H * S
U = DW / 72                       # scene is 72 x 90 units
PH = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
TAU = 2 * math.pi
rng = np.random.default_rng(3)    # scene layout
prng = np.random.default_rng(5)   # animation phases

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
    """Draw many small shapes into one mask, each with its own 0..255 strength."""
    m = Image.new('L', (DW, DH), 0)
    dr = ImageDraw.Draw(m)
    for it in items: fn(dr, *it)
    return np.asarray(m, np.float32) / 255

P = lambda x, y: (x * U, y * U)
HZ = 52 * U
s = lambda k, f=1: math.sin(TAU * (f * PH + k))

# ---- sky -------------------------------------------------------------
img[:] = ramp(yy / HZ, [(0, '#1a1238'), (0.22, '#2e2160'), (0.42, '#5c3577'), (0.6, '#a24a74'),
                        (0.76, '#e0705e'), (0.9, '#f7a35c'), (1, '#ffd08a')])

# stars, twinkling
stars = [(rng.uniform(0, 72), rng.uniform(1, 24) ** 1.0, prng.uniform()) for _ in range(70)]
items = [(x, y, int(255 * (1 - y / 26) * (0.45 + 0.55 * (0.5 + 0.5 * s(k, 2))))) for x, y, k in stars]
comp(batch(items, lambda dr, x, y, a: dr.rectangle([P(x, y), P(x + 0.28, y + 0.28)], fill=a)), hexc('#fff1c4'))
for x, y in ((9, 6), (55, 9), (31, 3)):    # a few bright four-point stars
    a = 0.75 + 0.25 * s(x / 70, 2)
    comp(pil_mask(lambda dr: (dr.rectangle([P(x - 0.9, y - 0.12), P(x + 0.9, y + 0.12)], fill=255),
                              dr.rectangle([P(x - 0.12, y - 0.9), P(x + 0.12, y + 0.9)], fill=255))) * a, hexc('#ffffff'))

# crescent moon
moon = pil_mask(lambda dr: dr.ellipse([P(58, 13), P(63, 18)], fill=255))
moon *= 1 - pil_mask(lambda dr: dr.ellipse([P(59.4, 12.4), P(64.4, 17.4)], fill=255))
comp(moon, hexc('#fff1c4'))

# sun, half set, with glow
sx, sy = 40 * U, 52 * U
d = np.hypot(xx - sx, (yy - sy) * 1.15)
above = (yy < HZ).astype(np.float32)
comp(np.exp(-(d / (22 * U)) ** 2) * 0.55 * above, hexc('#f7a35c'))
comp(np.exp(-(d / (12 * U)) ** 2) * 0.6 * above, hexc('#ffd08a'))
comp(np.clip((7 * U - np.hypot(xx - sx, yy - sy)) / 2, 0, 1) * above,
     ramp((sy - yy) / (7 * U), [(0, '#ff9a4a'), (0.5, '#ffc46a'), (1, '#ffe6a0')]))

# long sunset clouds, lit pink from below
for cy, x0, x1, th in ((29, -4, 30, 1.6), (33.5, 34, 80, 1.4), (39, 6, 46, 1.1), (44, 46, 76, 0.9), (24, 40, 66, 1.0)):
    dx = 1.2 * s(cy / 10)
    m = pil_mask(lambda dr: dr.rounded_rectangle([P(x0 + dx, cy), P(x1 + dx, cy + th)], radius=th * U / 2, fill=255), blur=1.5)
    comp(m, ramp((yy - cy * U) / (th * U), [(0, '#6e3a7a'), (0.55, '#c25a78'), (1, '#f39a6a')]))

# birds near the sun
def bird(x, y, sc=1.0):
    k = x / 13
    x += 1.0 * s(k); y += 0.4 * s(k, 2)
    mid, tip = (1.1, 0.6) if s(k, 3) > 0 else (0.55, -0.25)
    comp(pil_mask(lambda dr: dr.line([P(x - 2 * sc, y - tip * sc), P(x - 1 * sc, y - mid * sc), P(x, y),
                                      P(x + 1 * sc, y - mid * sc), P(x + 2 * sc, y - tip * sc)],
                                     fill=255, width=max(1, int(0.55 * U)), joint='curve')), hexc('#2a1b3a'))
bird(30, 36); bird(36.5, 33, 0.85); bird(48, 38.5, 0.7)

# distant headland on the right horizon
comp(pil_mask(lambda dr: dr.polygon([P(50, 52.2), P(56, 50.4), P(62, 49.2), P(67, 49.6), P(72, 50.2), P(72, 52.2)], fill=255)),
     hexc('#6a3c6e'))

# ---- sea -------------------------------------------------------------
SEA_END = 80 * U
sea = (yy >= HZ).astype(np.float32)
comp(sea, ramp((yy - HZ) / (SEA_END - HZ), [(0, '#d36e6a'), (0.05, '#9a4f7e'), (0.25, '#5c3f80'),
                                             (0.6, '#3a3572'), (1, '#262a5c')]))
comp(np.exp(-((yy - HZ) / (0.9 * U)) ** 2) * sea * 0.5, hexc('#f39a6a'))   # horizon glow

# wave streaks
streaks = []
for _ in range(220):
    y = rng.uniform(53, 79); f = (y - 52) / 27
    x = rng.uniform(-4, 72); L = rng.uniform(1, 2 + 5 * f)
    k = prng.uniform()
    streaks.append((x + 0.8 * s(k), y, L, 0.35 + 0.25 * f,
                    int(255 * (0.3 + 0.35 * f) * (0.55 + 0.45 * (0.5 + 0.5 * s(k, 2))))))
comp(batch(streaks, lambda dr, x, y, L, th, a: dr.rectangle([P(x, y), P(x + L, y + th)], fill=a)), hexc('#8a5c9a'))

# sun reflection column
refl = []
for _ in range(170):
    y = rng.uniform(52.4, 74); f = (y - 52) / 22
    x = 40 + rng.normal(0, 1.6 + 3.5 * f)
    L = rng.uniform(0.6, 2.8 - f)
    k = prng.uniform()
    on = 1.0 if s(k, 2) > -0.3 else 0.3
    refl.append((x + 0.6 * s(k, 2), y, L, int(255 * (0.95 - 0.55 * f) * on), f))
comp(batch([r for r in refl if r[4] >= 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#f7a35c'))
comp(batch([r for r in refl if r[4] < 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#ffd08a'))

# distant ship, silhouetted against the sunset
def ship():
    dy = 0.2 * s(0.3)
    Q = lambda x, y: P(x, y + dy)
    col = hexc('#2a1b3a')
    for mx in (56.5, 61):
        comp(pil_mask(lambda dr: dr.rectangle([Q(mx - 0.18, 42), Q(mx + 0.18, 50.6)], fill=255)), col)
        for y0, y1, hw in ((43.2, 46, 1.7), (46.3, 49.6, 2.2)):
            comp(pil_mask(lambda dr: dr.rounded_rectangle([Q(mx - hw, y0), Q(mx + hw, y1)], radius=0.8 * U, fill=255)), hexc('#4a2c55'))
    comp(pil_mask(lambda dr: dr.polygon([Q(56.5, 42), Q(58, 42.5), Q(56.5, 43)], fill=255)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: dr.polygon([Q(52.5, 50), Q(53.6, 50.2), Q(64, 50.2), Q(65.2, 49.6), Q(64.3, 51.4),
                                         Q(63.5, 52.3), Q(54.5, 52.3), Q(53.4, 51.2)], fill=255)), col)
    comp(pil_mask(lambda dr: dr.rectangle([Q(54, 52.4), Q(64, 53)], fill=255)) * 0.4, hexc('#5c3f80'))
ship()

# ---- left cliff + lighthouse ------------------------------------------
cliff_pts = [P(-1, 92), P(-1, 34), P(3, 33.2), P(8, 34.4), P(13, 33.8), P(16, 36), P(17.5, 41), P(19.5, 46),
             P(21, 52), P(23.5, 58), P(25, 64), P(24, 70), P(26, 76), P(24, 92)]
cliff = pil_mask(lambda dr: dr.polygon(cliff_pts, fill=255))
# lit from the sun (right), darker into the rock
cliff_col = ramp((xx / U - 4) / 22 + (yy / U - 34) / 120,
                 [(0, '#2a1b3a'), (0.55, '#3d2550'), (0.85, '#6a3c6e'), (1, '#b45c6c')])
comp(cliff, cliff_col)
# rock ledges
ledges = [(rng.uniform(2, 20), rng.uniform(38, 74), rng.uniform(2, 5)) for _ in range(22)]
comp(batch(ledges, lambda dr, x, y, L: dr.rectangle([P(x, y), P(x + L, y + 0.4)], fill=150)) * cliff, hexc('#1f1430'))
comp(batch(ledges, lambda dr, x, y, L: dr.rectangle([P(x, y - 0.4), P(x + L, y)], fill=110)) * cliff, hexc('#8a4a72'))
# foam where the cliff meets the sea
grown = np.asarray(Image.fromarray((cliff * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), np.float32) / 255
cliff_edge = np.clip(grown - cliff, 0, 1) * (yy > 54 * U) * (yy < 80 * U)
comp(cliff_edge * (0.35 + 0.15 * s(0.1)), hexc('#f6d0d4'))

def lighthouse():
    x0, x1, top, base = 6.6, 11.4, 21, 34.4
    taper = lambda y: 0.6 * (base - y) / (base - top)
    body = pil_mask(lambda dr: dr.polygon([P(x0 + 0.6, top), P(x1 - 0.6, top), P(x1, base), P(x0, base)], fill=255))
    stripes = ((np.floor((yy / U - top) / 2.7) % 2) == 0).astype(np.float32)
    shade = ramp((xx / U - x0) / (x1 - x0), [(0, '#cfc2d8'), (0.6, '#f4ecd6'), (1, '#ffffff')])
    red = ramp((xx / U - x0) / (x1 - x0), [(0, '#7a2a3a'), (0.6, '#c23b30'), (1, '#e8743b')])
    comp(body * (1 - stripes), shade)
    comp(body * stripes, red)
    # gallery + lamp room + roof
    comp(pil_mask(lambda dr: dr.rectangle([P(x0 - 0.2, top - 0.6), P(x1 + 0.2, top + 0.1)], fill=255)), hexc('#2a1b3a'))
    pulse = 0.5 + 0.5 * s(0, 2)
    lamp = pil_mask(lambda dr: dr.rectangle([P(x0 + 0.9, top - 3), P(x1 - 0.9, top - 0.6)], fill=255))
    comp(lamp, hexc('#ffd862'))
    comp(pil_mask(lambda dr: dr.rectangle([P(8.8, top - 3), P(9.2, top - 0.6)], fill=255)), hexc('#2a1b3a'))
    comp(pil_mask(lambda dr: dr.polygon([P(x0 + 0.3, top - 3), P(9, top - 5.2), P(x1 - 0.3, top - 3)], fill=255)), hexc('#7a2a3a'))
    comp(pil_mask(lambda dr: dr.rectangle([P(8.7, top - 6), P(9.3, top - 5)], fill=255)), hexc('#2a1b3a'))
    # glow + soft beam, both breathing
    cx, cy = 9 * U, (top - 1.8) * U
    dl = np.hypot(xx - cx, yy - cy)
    comp(np.exp(-(dl / (5 * U)) ** 2) * (0.35 + 0.35 * pulse), hexc('#ffe6a0'))
    ang = math.radians(-8 + 10 * s(0, 1))
    vx, vy = math.cos(ang), math.sin(ang)
    along = (xx - cx) * vx + (yy - cy) * vy
    across = np.abs(-(xx - cx) * vy + (yy - cy) * vx)
    beam = np.clip(1 - across / np.maximum(0.6 * U + along * 0.12, 1e-3), 0, 1) * (along > 3 * U) * np.exp(-along / (40 * U))
    comp(beam * (0.12 + 0.18 * pulse), hexc('#ffe6a0'))
lighthouse()

# ---- foreground: sand, dock, rowboat, lantern ---------------------------
def shore(x, base, amp, ph):
    return base + amp * np.sin(x / (7 * U) + ph) + 0.4 * amp * np.sin(x / (2.9 * U) + 2 * ph)

for base, a in ((77.6, 0.45), (79.6, 0.7)):
    edge = shore(xx, (base + 0.4 * s(base / 10)) * U, 0.6 * U, base)
    comp(np.clip(1 - np.abs(yy - edge) / (0.5 * U), 0, 1) * a * (xx > 22 * U), hexc('#f6d0d4'))
sand_top = shore(xx, (81 + 0.25 * s(0.4)) * U, 0.8 * U, 1.1)
comp(np.clip((yy - sand_top) / (0.6 * U), 0, 1),
     ramp((yy - 80 * U) / (10 * U), [(0, '#8a5a6a'), (0.15, '#b07468'), (0.5, '#c98f6a'), (1, '#d8a27a')]))
comp(np.clip(1 - np.abs(yy - sand_top) / (0.6 * U), 0, 1) * 0.85, hexc('#f6d0d4'))
speck = [(rng.uniform(0, 72), rng.uniform(83, 90), rng.choice([0, 1])) for _ in range(260)]
comp(batch([p for p in speck if p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.3, y + 0.3)], fill=200)), hexc('#e8b88a'))
comp(batch([p for p in speck if not p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.3, y + 0.3)], fill=200)), hexc('#a86a5e'))

# dock: planks on posts, coming in from the right edge
deck_y = 70.5
for px in (46, 53, 60, 67):
    comp(pil_mask(lambda dr: dr.rectangle([P(px, deck_y), P(px + 1.1, 82 if px < 50 else 84)], fill=255)),
         ramp((xx / U - px) / 1.1, [(0, '#2e1c0e'), (1, '#5a3919')]))
    comp(pil_mask(lambda dr: dr.rectangle([P(px - 0.3, 78.6 + 0.3 * s(px / 9)), P(px + 1.4, 79.1 + 0.3 * s(px / 9))], fill=255)) * 0.6,
         hexc('#f6d0d4'))
deck = pil_mask(lambda dr: dr.polygon([P(44, deck_y - 0.4), P(73, deck_y - 1.2), P(73, deck_y + 1.4), P(44, deck_y + 1.2)], fill=255))
comp(deck, ramp((yy / U - (deck_y - 1.2)) / 2.6, [(0, '#b8854f'), (0.4, '#8a5a2e'), (1, '#4a2e17')]))
for gx in range(45, 73, 2):
    comp(pil_mask(lambda dr: dr.line([P(gx, deck_y - 0.6), P(gx, deck_y + 1.3)], fill=255, width=1)) * deck * 0.7, hexc('#4a2e17'))

# lantern post with a flickering glow
lx, ly = 66.5, 62
comp(pil_mask(lambda dr: dr.rectangle([P(lx - 0.4, ly), P(lx + 0.4, deck_y)], fill=255)), hexc('#4a2e17'))
comp(pil_mask(lambda dr: dr.rectangle([P(lx - 2.4, ly), P(lx + 0.4, ly + 0.5)], fill=255)), hexc('#4a2e17'))
flick = 0.75 + 0.15 * s(0.2, 3) + 0.1 * s(0.7, 5)
gl = np.hypot(xx - (lx - 2.4) * U, yy - (ly + 2.6) * U)
comp(np.exp(-(gl / (6 * U)) ** 2) * 0.45 * flick, hexc('#f7a35c'))
comp(np.exp(-(gl / (2.6 * U)) ** 2) * 0.5 * flick, hexc('#ffd08a'))
comp(pil_mask(lambda dr: dr.line([P(lx - 2.4, ly + 0.5), P(lx - 2.4, ly + 1.2)], fill=255, width=1)), hexc('#15151f'))
comp(pil_mask(lambda dr: dr.rectangle([P(lx - 3.3, ly + 1.2), P(lx - 1.5, ly + 4)], fill=255)), hexc('#2a1b3a'))
comp(pil_mask(lambda dr: dr.rectangle([P(lx - 2.9, ly + 1.7), P(lx - 1.9, ly + 3.5)], fill=255)) * flick, hexc('#ffe6a0'))

# rowboat tied to the dock, bobbing
def rowboat():
    dy = 0.35 * s(0.6); rot = 0.12 * s(0.85)
    Q = lambda x, y: P(x, y + dy + rot * (x - 36))
    comp(pil_mask(lambda dr: dr.ellipse([P(28, 76.8 + dy), P(44.5, 78.6 + dy)], fill=255)) * 0.4, hexc('#1f1430'))
    hull = pil_mask(lambda dr: dr.polygon([Q(27.5, 73), Q(44.5, 73), Q(43, 75.6), Q(40.5, 77.2), Q(31, 77.2), Q(28.6, 75.4)], fill=255))
    comp(hull, ramp((yy / U - 73 - dy) / 4.2, [(0, '#b8854f'), (0.3, '#8a5a2e'), (1, '#43281a')]))
    comp(pil_mask(lambda dr: dr.line([Q(27.6, 73.2), Q(44.4, 73.2)], fill=255, width=max(1, int(0.5 * U)))), hexc('#c23b30'))
    comp(pil_mask(lambda dr: dr.line([Q(28.3, 74.9), Q(43.4, 74.9)], fill=255, width=1)) * hull, hexc('#4a2e17'))
    # oar resting across
    comp(pil_mask(lambda dr: dr.line([Q(30, 72), Q(41, 74.4)], fill=255, width=max(1, int(0.45 * U)))), hexc('#d8b87e'))
    # mooring rope sagging to the dock
    comp(pil_mask(lambda dr: dr.line([Q(44.3, 73.2), P(45, 72.6 + 0.4 * s(0.6)), P(46, deck_y + 0.3)], fill=255,
                                     width=max(1, int(0.3 * U)), joint='curve')), hexc('#cfc2a4'))
rowboat()

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
