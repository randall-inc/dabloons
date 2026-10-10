"""Halloween login art option A: haunted lighthouse under a full moon, 360x450 dither grid.

Usage: python scene.py SMOOTH_OUT.png FRAME_OUT.png PHASE
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
MX, MY, MR = 45, 17, 7.5          # moon

# ---- sky -------------------------------------------------------------
img[:] = ramp(yy / HZ, [(0, '#060818'), (0.25, '#0b1128'), (0.5, '#111c38'), (0.75, '#172b45'),
                        (0.92, '#1e3a4e'), (1, '#27495a')])

# moon glow, stepping through colors the sky already has
d = np.hypot(xx - MX * U, yy - MY * U)
comp(np.exp(-(d / (24 * U)) ** 2) * 0.55, hexc('#1e3a4e'))
comp(np.exp(-(d / (14 * U)) ** 2) * 0.55, hexc('#3a5a68'))
comp(np.exp(-(d / (10 * U)) ** 2) * 0.45, hexc('#7d9294'))

# stars, twinkling, kept out of the moon's glow
stars = []
while len(stars) < 80:
    x, y = rng.uniform(0, 72), rng.uniform(1, 40)
    if math.hypot(x - MX, y - MY) > 14: stars.append((x, y, prng.uniform()))
items = [(x, y, int(255 * (1 - y / 44) * (0.45 + 0.55 * (0.5 + 0.5 * s(k, 2))))) for x, y, k in stars]
comp(batch(items, lambda dr, x, y, a: dr.rectangle([P(x, y), P(x + 0.28, y + 0.28)], fill=a)), hexc('#dfe6e0'))
for x, y in ((8, 5), (64, 34), (27, 9)):    # a few bright four-point stars
    a = 0.75 + 0.25 * s(x / 70, 2)
    comp(pil_mask(lambda dr: (dr.rectangle([P(x - 0.9, y - 0.12), P(x + 0.9, y + 0.12)], fill=255),
                              dr.rectangle([P(x - 0.12, y - 0.9), P(x + 0.12, y + 0.9)], fill=255))) * a, hexc('#ffffff'))

# full moon with soft craters, lit a touch brighter on its upper right
moon = np.clip((MR * U - d) / 2, 0, 1)
comp(moon, ramp(((xx / U - MX) - (yy / U - MY)) / (2.8 * MR) + 0.5,
                [(0, '#c9c6ad'), (0.5, '#e9e4c8'), (1, '#fbf6e0')]))
for cx, cy, r in ((-2.6, -1.5, 1.8), (2.2, 1.8, 2.3), (-1.2, 3.6, 1.1), (3.4, -3.0, 0.9), (-4.2, 1.6, 0.8)):
    comp(pil_mask(lambda dr: dr.ellipse([P(MX + cx - r, MY + cy - r), P(MX + cx + r, MY + cy + r)], fill=255), blur=2) * moon * 0.5,
         hexc('#bdb9a0'))

# wispy clouds drifting past the moon, their tops silvered by moonlight
def cloud(cx, cy, w, h, puffs, k, a=0.9):
    cx += 1.0 * s(k)
    m = pil_mask(lambda dr: [dr.ellipse([P(cx + ox - r, cy + oy - r), P(cx + ox + r, cy + oy + r)], fill=255) for ox, oy, r in puffs] +
                 [dr.rounded_rectangle([P(cx - w / 2, cy), P(cx + w / 2, cy + h)], radius=h * U / 2, fill=255)], blur=1.5)
    top = cy - max(r - oy for ox, oy, r in puffs)
    comp(m * a, ramp((yy / U - top) / (cy + h - top), [(0, '#7d9294'), (0.35, '#3a5a68'), (0.75, '#1e3a4e'), (1, '#172b45')]))
cloud(40, 21.5, 20, 1.6, [(-5, 0.2, 1.4), (-1, -0.6, 2.0), (3.5, 0.1, 1.5)], 0.1)
cloud(60, 26, 18, 1.4, [(-3, 0.1, 1.3), (1.5, -0.5, 1.8), (5, 0.3, 1.1)], 0.45)
cloud(8, 31, 20, 1.6, [(-4, 0.2, 1.5), (1, -0.6, 2.1), (5, 0.2, 1.3)], 0.25)
cloud(64, 12.5, 14, 1.2, [(-2, 0.1, 1.2), (2, -0.4, 1.5)], 0.7, 0.75)

# bats, flapping across the moon
def bat(x, y, sc, k):
    x += 1.4 * s(k); y += 0.6 * s(k, 2)
    up = s(k, 3) > 0
    wy = -1.3 if up else 0.7      # wingtip height relative to body
    pts = [(-2.6, wy), (-1.9, wy * 0.4 + 0.3), (-1.3, wy * 0.2 + 0.7), (-0.6, 0.2), (0, 0.6),
           (0.6, 0.2), (1.3, wy * 0.2 + 0.7), (1.9, wy * 0.4 + 0.3), (2.6, wy), (1.4, wy * 0.5 - 0.1),
           (0.5, -0.5), (0.3, -0.9), (0.1, -0.6), (-0.1, -0.6), (-0.3, -0.9), (-0.5, -0.5), (-1.4, wy * 0.5 - 0.1)]
    comp(pil_mask(lambda dr: dr.polygon([P(x + px * sc, y + py * sc) for px, py in pts], fill=255)), hexc('#04050c'))
bat(40, 14, 1.0, 0.0); bat(49.5, 20.5, 0.8, 0.37); bat(55, 11, 0.65, 0.71); bat(30, 22, 0.6, 0.55); bat(61, 27, 0.5, 0.2)

# ---- sea -------------------------------------------------------------
SEA_END = 80 * U
sea = (yy >= HZ).astype(np.float32)
comp(sea, ramp((yy - HZ) / (SEA_END - HZ), [(0, '#2c4f5c'), (0.06, '#1b3446'), (0.3, '#12233a'),
                                             (0.65, '#0d1a2e'), (1, '#0a1424')]))
comp(np.exp(-((yy - HZ) / (0.9 * U)) ** 2) * sea * 0.5, hexc('#3a5a68'))   # horizon glow

# wave streaks
streaks = []
for _ in range(220):
    y = rng.uniform(53, 79); f = (y - 52) / 27
    x = rng.uniform(-4, 72); L = rng.uniform(1, 2 + 5 * f)
    k = prng.uniform()
    streaks.append((x + 0.8 * s(k), y, L, 0.35 + 0.25 * f,
                    int(255 * (0.25 + 0.3 * f) * (0.55 + 0.45 * (0.5 + 0.5 * s(k, 2))))))
comp(batch(streaks, lambda dr, x, y, L, th, a: dr.rectangle([P(x, y), P(x + L, y + th)], fill=a)), hexc('#25415a'))

# moon reflection column
refl = []
for _ in range(170):
    y = rng.uniform(52.4, 76); f = (y - 52) / 24
    x = MX + rng.normal(0, 1.4 + 3.2 * f)
    L = rng.uniform(0.6, 2.8 - f)
    k = prng.uniform()
    on = 1.0 if s(k, 2) > -0.3 else 0.3
    refl.append((x + 0.6 * s(k, 2), y, L, int(255 * (0.9 - 0.5 * f) * on), f))
comp(batch([r for r in refl if r[4] >= 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#7d9294'))
comp(batch([r for r in refl if r[4] < 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#e9e4c8'))

# ghost ship far out: translucent, tattered sails, a faint green glow
def ghost_ship():
    dy = 0.25 * s(0.3)
    Q = lambda x, y: P(x, y + dy)
    flick = 0.8 + 0.2 * s(0.15, 2)
    gd = np.hypot(xx - 59 * U, (yy - (47 + dy) * U) * 1.4)
    comp(np.exp(-(gd / (8 * U)) ** 2) * 0.3, hexc('#2f6a66'))
    ghost = hexc('#8fe3c4')
    for mx in (56, 62):
        comp(pil_mask(lambda dr: dr.rectangle([Q(mx - 0.2, 40.5), Q(mx + 0.2, 50.6)], fill=255)) * 0.45, hexc('#5fb89c'))
        for y0, y1, hw in ((42, 45.2, 1.9), (45.6, 49.4, 2.5)):
            sail = pil_mask(lambda dr: dr.rounded_rectangle([Q(mx - hw, y0), Q(mx + hw, y1)], radius=0.7 * U, fill=255))
            # torn bottom edges
            rips = pil_mask(lambda dr: [dr.polygon([Q(mx + ox - 0.45, y1 + 0.1), Q(mx + ox, y1 - dpt), Q(mx + ox + 0.45, y1 + 0.1)], fill=255)
                                        for ox, dpt in ((-hw * 0.55, 1.1), (hw * 0.15, 0.7), (hw * 0.7, 1.3))])
            hx = mx + (0.9 if y0 < 45 else -1.3) * (1 if mx < 60 else -1)
            hole = pil_mask(lambda dr: dr.polygon([Q(hx - 0.35, y0 + 1.0), Q(hx + 0.3, y0 + 1.3), Q(hx + 0.1, y0 + 2.2), Q(hx - 0.3, y0 + 1.9)], fill=255))
            comp(sail * (1 - rips) * (1 - hole) * 0.68 * flick, ramp((yy / U - y0 - dy) / (y1 - y0), [(0, '#a8f0d4'), (0.5, '#5fb89c'), (1, '#3f7f74')]))
    comp(pil_mask(lambda dr: dr.polygon([Q(62, 40.5), Q(64, 41.1), Q(62.4, 41.4), Q(63.3, 41.9), Q(62, 42)], fill=255)) * 0.6, ghost)
    hull = pil_mask(lambda dr: dr.polygon([Q(51.5, 49.8), Q(52.8, 50.1), Q(65, 50.1), Q(66.4, 49.3), Q(65.4, 51.4),
                                           Q(64.4, 52.4), Q(53.8, 52.4), Q(52.6, 51.2)], fill=255))
    comp(hull * 0.6 * flick, ramp((yy / U - 49.5 - dy) / 3, [(0, '#8fe3c4'), (1, '#2f6a66')]))
    for px in range(55, 65, 2):   # portholes, glowing a little brighter
        comp(pil_mask(lambda dr: dr.rectangle([Q(px, 50.6), Q(px + 0.6, 51.1)], fill=255)) * flick, hexc('#d2ffe8'))
    comp(pil_mask(lambda dr: dr.rectangle([Q(53, 52.5), Q(65, 53.2)], fill=255)) * 0.25 * flick, hexc('#5fb89c'))
ghost_ship()

# fog bank along the horizon, drifting
def fog(cy, x0, x1, th, a, k, amp=1.2):
    dx = amp * s(k)
    m = pil_mask(lambda dr: [dr.rounded_rectangle([P(x0 + dx + ox, cy + oy), P(x1 + dx + ox, cy + oy + th)], radius=th * U / 2, fill=255)
                             for ox, oy in ((0, 0), ((x1 - x0) * 0.3, -th * 0.35), (-(x1 - x0) * 0.2, th * 0.3))], blur=4)
    comp(m * a, ramp((yy - (cy - th * 0.4) * U) / (th * 1.7 * U), [(0, '#7d9294'), (0.5, '#4f6c74'), (1, '#2c4f5c')]))
fog(50.6, 20, 46, 2.2, 0.45, 0.0)
fog(51.5, 52, 80, 2.0, 0.35, 0.5)

# ---- left cliff + lighthouse ------------------------------------------
cliff_pts = [P(-1, 92), P(-1, 34), P(3, 33.2), P(8, 34.4), P(13, 33.8), P(16, 36), P(17.5, 41), P(19.5, 46),
             P(21, 52), P(23.5, 58), P(25, 64), P(24, 70), P(26, 76), P(24, 92)]
cliff = pil_mask(lambda dr: dr.polygon(cliff_pts, fill=255))
# moonlight from the right, dark into the rock
comp(cliff, ramp((xx / U - 4) / 22 + (yy / U - 34) / 120,
                 [(0, '#05070f'), (0.55, '#0c1222'), (0.85, '#1a2a3c'), (1, '#3a5a68')]))
ledges = [(rng.uniform(2, 20), rng.uniform(38, 74), rng.uniform(2, 5)) for _ in range(22)]
comp(batch(ledges, lambda dr, x, y, L: dr.rectangle([P(x, y), P(x + L, y + 0.4)], fill=150)) * cliff, hexc('#04050c'))
comp(batch(ledges, lambda dr, x, y, L: dr.rectangle([P(x, y - 0.4), P(x + L, y)], fill=110)) * cliff, hexc('#25415a'))
grown = np.asarray(Image.fromarray((cliff * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), np.float32) / 255
cliff_edge = np.clip(grown - cliff, 0, 1) * (yy > 54 * U) * (yy < 80 * U)
comp(cliff_edge * (0.35 + 0.15 * s(0.1)), hexc('#9fb4b4'))

# a crooked dead tree on the cliff top
def dead_tree():
    col = hexc('#04050c')
    branches = [((15, 36), (14.4, 31), 0.55), ((14.4, 31), (13, 27.4), 0.4), ((14.4, 31), (17.6, 28.4), 0.35),
                ((13, 27.4), (11.6, 26.4), 0.28), ((13, 27.4), (13.6, 25.2), 0.28), ((17.6, 28.4), (19.2, 28.6), 0.26),
                ((17.6, 28.4), (18, 26.4), 0.26), ((14.6, 33), (12.4, 31.8), 0.3)]
    for (x0, y0), (x1, y1), w in branches:
        comp(pil_mask(lambda dr: dr.line([P(x0, y0), P(x1, y1)], fill=255, width=max(1, int(2 * w * U)))), col)
dead_tree()

def lighthouse():
    x0, x1, top, base = 6.6, 11.4, 21, 34.4
    body = pil_mask(lambda dr: dr.polygon([P(x0 + 0.6, top), P(x1 - 0.6, top), P(x1, base), P(x0, base)], fill=255))
    stripes = ((np.floor((yy / U - top) / 2.7) % 2) == 0).astype(np.float32)
    shade = ramp((xx / U - x0) / (x1 - x0), [(0, '#1a2a3c'), (0.6, '#7d9294'), (1, '#c9c6ad')])
    red = ramp((xx / U - x0) / (x1 - x0), [(0, '#1a0f1c'), (0.6, '#4a1a26'), (1, '#7a2a3a')])
    comp(body * (1 - stripes), shade)
    comp(body * stripes, red)
    comp(pil_mask(lambda dr: dr.rectangle([P(x0 - 0.2, top - 0.6), P(x1 + 0.2, top + 0.1)], fill=255)), hexc('#04050c'))
    pulse = 0.5 + 0.5 * s(0, 2)
    lamp = pil_mask(lambda dr: dr.rectangle([P(x0 + 0.9, top - 3), P(x1 - 0.9, top - 0.6)], fill=255))
    comp(lamp, hexc('#b8ffc8'))
    comp(pil_mask(lambda dr: dr.rectangle([P(8.8, top - 3), P(9.2, top - 0.6)], fill=255)), hexc('#04050c'))
    comp(pil_mask(lambda dr: dr.polygon([P(x0 + 0.3, top - 3), P(9, top - 5.2), P(x1 - 0.3, top - 3)], fill=255)), hexc('#1a0f1c'))
    comp(pil_mask(lambda dr: dr.rectangle([P(8.7, top - 6), P(9.3, top - 5)], fill=255)), hexc('#04050c'))
    # eerie green glow + slow sweeping beam
    cx, cy = 9 * U, (top - 1.8) * U
    dl = np.hypot(xx - cx, yy - cy)
    comp(np.exp(-(dl / (6 * U)) ** 2) * (0.4 + 0.1 * pulse), hexc('#2f8a5e'))
    comp(np.exp(-(dl / (3 * U)) ** 2) * (0.35 + 0.35 * pulse), hexc('#6fe39a'))
    ang = math.radians(-6 + 12 * s(0, 1))
    vx, vy = math.cos(ang), math.sin(ang)
    along = (xx - cx) * vx + (yy - cy) * vy
    across = np.abs(-(xx - cx) * vy + (yy - cy) * vx)
    beam = np.clip(1 - across / np.maximum(0.9 * U + along * 0.16, 1e-3), 0, 1) * np.clip((along - 2 * U) / (2 * U), 0, 1) * np.exp(-along / (45 * U))
    comp(np.sqrt(beam) * 0.34, hexc('#2f8a5e'))
    comp(beam * 0.4, hexc('#4fc486'))
    comp(beam ** 3 * (0.3 + 0.2 * pulse), hexc('#b8ffc8'))
lighthouse()

# ---- foreground: sand, dock, rowboat, jack-o'-lanterns -----------------
def shore(x, base, amp, ph):
    return base + amp * np.sin(x / (7 * U) + ph) + 0.4 * amp * np.sin(x / (2.9 * U) + 2 * ph)

for base, a in ((77.6, 0.4), (79.6, 0.6)):
    edge = shore(xx, (base + 0.4 * s(base / 10)) * U, 0.6 * U, base)
    comp(np.clip(1 - np.abs(yy - edge) / (0.5 * U), 0, 1) * a * (xx > 22 * U), hexc('#9fb4b4'))
sand_top = shore(xx, (81 + 0.25 * s(0.4)) * U, 0.8 * U, 1.1)
comp(np.clip((yy - sand_top) / (0.6 * U), 0, 1),
     ramp((yy - 80 * U) / (10 * U), [(0, '#1c2230'), (0.15, '#262c3a'), (0.5, '#343846'), (1, '#3f4250')]))
comp(np.clip(1 - np.abs(yy - sand_top) / (0.6 * U), 0, 1) * 0.7, hexc('#9fb4b4'))
speck = [(rng.uniform(0, 72), rng.uniform(83, 90), rng.choice([0, 1])) for _ in range(260)]
comp(batch([p for p in speck if p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.3, y + 0.3)], fill=200)), hexc('#565a66'))
comp(batch([p for p in speck if not p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.3, y + 0.3)], fill=200)), hexc('#1c2230'))

# low fog rolling along the water, in front of the cliff foot
fog(64, -6, 30, 3.0, 0.3, 0.2, 1.0)
fog(70, 28, 64, 2.6, 0.25, 0.75, 1.0)

# dock: planks on posts, coming in from the right edge
deck_y = 70.5
for px in (46, 53, 60, 67):
    comp(pil_mask(lambda dr: dr.rectangle([P(px, deck_y), P(px + 1.1, 82 if px < 50 else 84)], fill=255)),
         ramp((xx / U - px) / 1.1, [(0, '#120c0a'), (1, '#2e2018')]))
    comp(pil_mask(lambda dr: dr.rectangle([P(px - 0.3, 78.6 + 0.3 * s(px / 9)), P(px + 1.4, 79.1 + 0.3 * s(px / 9))], fill=255)) * 0.5,
         hexc('#9fb4b4'))
deck = pil_mask(lambda dr: dr.polygon([P(44, deck_y - 0.4), P(73, deck_y - 1.2), P(73, deck_y + 1.4), P(44, deck_y + 1.2)], fill=255))
comp(deck, ramp((yy / U - (deck_y - 1.2)) / 2.6, [(0, '#5a4a44'), (0.4, '#3a2a22'), (1, '#1a120e')]))
for gx in range(45, 73, 2):
    comp(pil_mask(lambda dr: dr.line([P(gx, deck_y - 0.6), P(gx, deck_y + 1.3)], fill=255, width=1)) * deck * 0.7, hexc('#1a120e'))

# jack-o'-lanterns lined up on the dock, each flickering on its own
def jack(x, y, r, k, face):
    flick = 0.72 + 0.16 * s(k, 3) + 0.12 * s(k + 0.4, 5)
    gl = np.hypot(xx - x * U, yy - (y - r * 0.5) * U)
    comp(np.exp(-(gl / (3.4 * r * U)) ** 2) * 0.3 * flick, hexc('#4a2418'))
    comp(np.exp(-(gl / (1.9 * r * U)) ** 2) * 0.3 * flick, hexc('#a8461a'))
    comp(pil_mask(lambda dr: dr.ellipse([P(x - r * 1.2, y - 0.4), P(x + r * 1.2, y + 0.4)], fill=255)) * 0.5, hexc('#1a120e'))
    body = pil_mask(lambda dr: [dr.ellipse([P(x + ox - r * 0.62, y - r * 1.7), P(x + ox + r * 0.62, y)], fill=255) for ox in (-r * 0.45, r * 0.45)] +
                    [dr.ellipse([P(x - r * 0.7, y - r * 1.75), P(x + r * 0.7, y)], fill=255)])
    comp(body, ramp((xx / U - (x - r)) / (2 * r), [(0, '#6e2a12'), (0.45, '#c2541a'), (1, '#e88a3a')]))
    for ox in (-r * 0.45, r * 0.45):   # ribs
        comp(pil_mask(lambda dr: dr.line([P(x + ox, y - r * 1.55), P(x + ox, y - r * 0.15)], fill=255, width=1)) * body * 0.6, hexc('#6e2a12'))
    comp(pil_mask(lambda dr: dr.rectangle([P(x - 0.2, y - r * 2.1), P(x + 0.25, y - r * 1.6)], fill=255)), hexc('#2f4a22'))
    fc = ramp(np.full(img.shape[:2], flick, np.float32), [(0.5, '#e07a1e'), (0.8, '#ffb030'), (1, '#ffe08a')])
    cy = y - r * 0.85
    if face == 0:
        feat = pil_mask(lambda dr: (dr.polygon([P(x - r * 0.6, cy - r * 0.15), P(x - r * 0.2, cy - r * 0.15), P(x - r * 0.4, cy - r * 0.5)], fill=255),
                                    dr.polygon([P(x + r * 0.2, cy - r * 0.15), P(x + r * 0.6, cy - r * 0.15), P(x + r * 0.4, cy - r * 0.5)], fill=255),
                                    dr.polygon([P(x - r * 0.65, cy + r * 0.15), P(x + r * 0.65, cy + r * 0.15), P(x + r * 0.35, cy + r * 0.55),
                                                P(x + r * 0.1, cy + r * 0.35), P(x - r * 0.15, cy + r * 0.55), P(x - r * 0.4, cy + r * 0.35)], fill=255)))
    else:
        feat = pil_mask(lambda dr: (dr.rectangle([P(x - r * 0.6, cy - r * 0.45), P(x - r * 0.2, cy - r * 0.1)], fill=255),
                                    dr.rectangle([P(x + r * 0.2, cy - r * 0.45), P(x + r * 0.6, cy - r * 0.1)], fill=255),
                                    dr.chord([P(x - r * 0.6, cy - r * 0.2), P(x + r * 0.6, cy + r * 0.6)], 0, 180, fill=255)))
    comp(feat, fc)
jack(50, deck_y - 0.6, 1.5, 0.0, 0)
jack(55.5, deck_y - 0.75, 1.15, 0.33, 1)
jack(64.5, deck_y - 0.95, 1.7, 0.66, 0)
jack(69.6, deck_y - 1.1, 1.05, 0.12, 1)

# rowboat tied to the dock, bobbing, with a skeleton at the oar
def rowboat():
    dy = 0.35 * s(0.6); rot = 0.12 * s(0.85)
    Q = lambda x, y: P(x, y + dy + rot * (x - 36))
    comp(pil_mask(lambda dr: dr.ellipse([P(28, 76.8 + dy), P(44.5, 78.6 + dy)], fill=255)) * 0.4, hexc('#04050c'))
    # skeleton sitting in the stern, drawn before the hull so the gunwale hides its legs
    bone = hexc('#d8d4bc')
    sx, sy = 33.5, 73
    comp(pil_mask(lambda dr: dr.line([Q(sx, sy), Q(sx + 0.3, sy - 3.4)], fill=255, width=max(1, int(0.5 * U)))), bone)   # spine
    for i in range(3):   # ribs
        ry = sy - 2.8 + i * 0.75
        comp(pil_mask(lambda dr: dr.line([Q(sx - 0.9 + 0.1 * i, ry), Q(sx + 1.3 - 0.1 * i, ry + 0.2)], fill=255, width=max(1, int(0.45 * U)))), bone)
    comp(pil_mask(lambda dr: dr.ellipse([Q(sx - 1.0, sy - 5.6), Q(sx + 1.6, sy - 3.2)], fill=255)), bone)   # skull
    comp(pil_mask(lambda dr: dr.rectangle([Q(sx - 0.3, sy - 3.6), Q(sx + 1.1, sy - 2.9)], fill=255)), bone)   # jaw
    for ex in (sx - 0.3, sx + 0.6):
        comp(pil_mask(lambda dr: dr.ellipse([Q(ex - 0.32, sy - 4.8), Q(ex + 0.32, sy - 4.1)], fill=255)), hexc('#04050c'))
    comp(pil_mask(lambda dr: dr.line([Q(sx + 0.2, sy - 2.6), Q(sx + 2.2, sy - 1.6), Q(sx + 3.4, sy - 1.2)], fill=255,
                                     width=max(1, int(0.45 * U)), joint='curve')), bone)   # arm to the oar
    hull = pil_mask(lambda dr: dr.polygon([Q(27.5, 73), Q(44.5, 73), Q(43, 75.6), Q(40.5, 77.2), Q(31, 77.2), Q(28.6, 75.4)], fill=255))
    comp(hull, ramp((yy / U - 73 - dy) / 4.2, [(0, '#5a4a44'), (0.3, '#3a2a22'), (1, '#1a120e')]))
    comp(pil_mask(lambda dr: dr.line([Q(27.6, 73.2), Q(44.4, 73.2)], fill=255, width=max(1, int(0.5 * U)))), hexc('#4a1a26'))
    comp(pil_mask(lambda dr: dr.line([Q(28.3, 74.9), Q(43.4, 74.9)], fill=255, width=1)) * hull, hexc('#1a120e'))
    comp(pil_mask(lambda dr: dr.line([Q(36.4, 71.4), Q(41, 76.6)], fill=255, width=max(1, int(0.45 * U)))), hexc('#7d6a52'))   # oar
    # mooring rope sagging to the dock
    comp(pil_mask(lambda dr: dr.line([Q(44.3, 73.2), P(45, 72.6 + 0.4 * s(0.6)), P(46, deck_y + 0.3)], fill=255,
                                     width=max(1, int(0.3 * U)), joint='curve')), hexc('#7d9294'))
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
