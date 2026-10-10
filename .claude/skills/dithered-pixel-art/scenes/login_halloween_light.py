"""Halloween login art panel: "Pumpkin Shore" (light theme), 360x450 dither grid.

Golden-afternoon sky with a huge pale daytime harvest moon, crooked graveyard on a cliff, a ghost ship
with glowing green sails, bats, and a jack-o'-lantern on an open treasure chest.

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
rng = np.random.default_rng(31)   # scene layout
prng = np.random.default_rng(13)  # animation phases

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
HZ = 54 * U
s = lambda k, f=1: math.sin(TAU * (f * PH + k))
SIL = '#2a1c38'      # silhouette color
SIL2 = '#54446a'

# ---- sky -------------------------------------------------------------
img[:] = ramp(yy / HZ, [(0, '#8ea6d6'), (0.22, '#a8b8e2'), (0.42, '#c8c4e6'), (0.6, '#e4cce0'),
                        (0.76, '#f4d4cc'), (0.9, '#fbe0c0'), (1, '#ffecc8')])

# huge harvest moon, low over the sea
mx, my, mr = 40 * U, 41 * U, 15 * U
dm = np.hypot(xx - mx, yy - my)
above = (yy < HZ).astype(np.float32)
comp(np.exp(-(dm / (30 * U)) ** 2) * 0.4 * above, hexc('#fbe0c0'))
comp(np.exp(-(np.maximum(dm - mr, 0) / (5 * U)) ** 2) * 0.5 * above, hexc('#fff4dc'))
disc = np.clip((mr - dm) / 2, 0, 1) * above
# lit from the upper left, a touch darker toward the lower right limb
mt = ((xx - mx) * 0.5 + (yy - my) * 0.7) / mr * 0.5 + 0.5
comp(disc, ramp(mt, [(0, '#fffaec'), (0.35, '#fff0d0'), (0.75, '#ffe0b0'), (1, '#f7cc98')]))
# craters / maria
for cx, cy, rx, ry, a in ((34, 35, 3.2, 2.4, 0.4), (44.5, 37.5, 2.4, 1.8, 0.35), (38.5, 44, 4, 2.6, 0.35),
                          (47, 45, 1.8, 1.4, 0.3), (31.5, 41.5, 1.6, 1.3, 0.3), (42, 31, 1.5, 1.1, 0.25)):
    comp(pil_mask(lambda dr: dr.ellipse([P(cx - rx, cy - ry), P(cx + rx, cy + ry)], fill=255), blur=1.2) * disc * a,
         hexc('#f2c896'))

# soft daytime clouds drifting across the moon, lit from above
def cloud(cx, cy, w, h, puffs, k):
    cx += 1.0 * s(k)
    m = pil_mask(lambda dr: [dr.ellipse([P(cx + ox - r, cy + oy - r), P(cx + ox + r, cy + oy + r)], fill=255) for ox, oy, r in puffs]
                 + [dr.rounded_rectangle([P(cx - w / 2, cy), P(cx + w / 2, cy + h)], radius=h * U / 2, fill=255)], blur=1.2)
    top = cy - max(r - oy for ox, oy, r in puffs)
    comp(m, ramp((yy / U - top) / (cy + h - top), [(0, '#ffffff'), (0.4, '#f6f0f6'), (0.8, '#e6dcee'), (1, '#d4c8e2')]))
cloud(22, 38.4, 20, 1.8, [(-5, 0.2, 1.6), (-1, -0.6, 2.2), (3.5, 0, 1.7)], 0.1)
cloud(56, 43.2, 24, 1.6, [(-6, 0.3, 1.5), (-1.5, -0.5, 2.1), (3, 0, 1.6), (7, 0.4, 1.2)], 0.4)
cloud(18, 48.6, 26, 1.4, [(-4, 0.2, 1.3), (2, -0.2, 1.7)], 0.7)
cloud(62, 26, 18, 1.3, [(-3, 0.2, 1.3), (1.5, -0.4, 1.8)], 0.55)
cloud(8, 21, 18, 1.4, [(-2, 0.1, 1.4), (2.5, -0.5, 1.9)], 0.85)

# bats, flapping across the moon
def bat(x, y, sc=1.0, k=0.0):
    x += 1.2 * s(k); y += 0.5 * s(k, 2)
    up = s(k, 3)
    tip = -1.3 * up              # wingtip height, flaps
    pts = [(0, -0.5), (0.5, -0.9), (0.7, -0.3), (1.6, -0.6 + tip * 0.4), (2.6, -0.2 + tip), (3.2, 0.6 + tip * 0.6),
           (2.4, 0.4), (1.9, 0.9), (1.2, 0.5), (0.5, 0.9), (0, 0.6)]
    full = [(x + px * sc, y + py * sc) for px, py in pts] + [(x - px * sc, y + py * sc) for px, py in reversed(pts)]
    comp(pil_mask(lambda dr: dr.polygon([P(*p) for p in full], fill=255)), hexc(SIL))
bat(33, 33, 1.0, 0.1); bat(46, 29, 0.8, 0.45); bat(52, 37, 0.65, 0.7); bat(24, 26, 0.6, 0.3); bat(60, 20, 0.55, 0.85)

# ---- sea -------------------------------------------------------------
SEA_END = 76 * U
sea = (yy >= HZ).astype(np.float32)
comp(sea, ramp((yy - HZ) / (SEA_END - HZ), [(0, '#e8d0c8'), (0.06, '#b8cce0'), (0.3, '#8cb6d0'),
                                             (0.65, '#6c9cc4'), (1, '#5a86b6')]))
comp(np.exp(-((yy - HZ) / (0.9 * U)) ** 2) * sea * 0.5, hexc('#ffecc8'))   # horizon glow

# wave streaks
streaks = []
for _ in range(200):
    y = rng.uniform(55, 75); f = (y - 54) / 21
    x = rng.uniform(-4, 72); L = rng.uniform(1, 2 + 5 * f)
    k = prng.uniform()
    streaks.append((x + 0.8 * s(k), y, L, 0.35 + 0.25 * f,
                    int(255 * (0.3 + 0.35 * f) * (0.55 + 0.45 * (0.5 + 0.5 * s(k, 2))))))
comp(batch(streaks, lambda dr, x, y, L, th, a: dr.rectangle([P(x, y), P(x + L, y + th)], fill=a)), hexc('#dcf0f4'))

# moon reflection column
refl = []
for _ in range(170):
    y = rng.uniform(54.4, 76); f = (y - 54) / 22
    x = 40 + rng.normal(0, 2.0 + 3.5 * f)
    L = rng.uniform(0.6, 3.0 - f)
    k = prng.uniform()
    on = 1.0 if s(k, 2) > -0.3 else 0.3
    refl.append((x + 0.6 * s(k, 2), y, L, int(255 * (0.95 - 0.55 * f) * on), f))
comp(batch([r for r in refl if r[4] >= 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#ffe6a0'))
comp(batch([r for r in refl if r[4] < 0.35], lambda dr, x, y, L, a, f: dr.rectangle([P(x - L / 2, y), P(x + L / 2, y + 0.4)], fill=a)), hexc('#fff4dc'))

# ghost ship with glowing green sails, in the middle distance on the right
def ghost_ship():
    dy = 0.25 * s(0.3)
    Q = lambda x, y: P(x, y + dy)
    glow = 0.8 + 0.2 * s(0.15, 2)
    # eerie green haze around the ship
    sails = pil_mask(lambda dr: [dr.rounded_rectangle([Q(mxx - hw, top + y0), Q(mxx + hw, top + y1)], radius=0.9 * U, fill=255)
                                 for mxx, top in ((55, 40.5), (61, 41.5)) for y0, y1, hw in ((1.4, 4.6, 2.0), (5, 8.8, 2.6))], blur=0.6 * U)
    comp(sails * 0.3 * glow, hexc('#fff4dc'))
    for mxx, top in ((55, 40.5), (61, 41.5)):
        comp(pil_mask(lambda dr: dr.rectangle([Q(mxx - 0.25, top), Q(mxx + 0.25, 54.2)], fill=255)), hexc(SIL))
        for y0, y1, hw in ((top + 1.4, top + 4.6, 2.0), (top + 5, top + 8.8, 2.6)):
            sail = pil_mask(lambda dr: dr.rounded_rectangle([Q(mxx - hw, y0), Q(mxx + hw, y1)], radius=0.9 * U, fill=255))
            # tattered bottom edge: cut a few notches out
            notch = pil_mask(lambda dr: [dr.polygon([Q(mxx + ox - 0.5, y1 + 0.1), Q(mxx + ox, y1 - 0.9), Q(mxx + ox + 0.5, y1 + 0.1)], fill=255)
                                         for ox in (-hw * 0.5, hw * 0.3)])
            sail *= 1 - notch
            comp(sail * glow, ramp((xx / U - (mxx - hw)) / (2 * hw), [(0, '#eefff4'), (0.45, '#b4f0cc'), (1, '#6cc89c')]))
        comp(pil_mask(lambda dr: dr.rectangle([Q(mxx - 0.25, top + 1), Q(mxx + 0.25, 54)], fill=255)) * 0.6, hexc(SIL2))
    # tattered pennant
    fl = 0.4 * s(0.2, 2)
    comp(pil_mask(lambda dr: dr.polygon([Q(55.2, 40.5), Q(57.6, 40.9 + fl), Q(56.6, 41.3 + fl * 0.5), Q(57.4, 41.8 + fl), Q(55.2, 41.6)], fill=255)),
         hexc(SIL))
    hull = pil_mask(lambda dr: dr.polygon([Q(50.5, 53.4), Q(52, 53.2), Q(52.5, 54), Q(64, 54), Q(65.8, 52.8), Q(65, 55.2),
                                           Q(63.8, 56.6), Q(53.5, 56.6), Q(52, 55.2)], fill=255))
    comp(hull, ramp((yy / U - 53 - dy) / 3.6, [(0, '#54446a'), (1, SIL)]))
    # glowing portholes
    for px in (54.5, 57, 59.5, 62):
        comp(pil_mask(lambda dr: dr.rectangle([Q(px, 54.7), Q(px + 0.6, 55.3)], fill=255)) * glow, hexc('#b4f0cc'))
    # green reflection
    comp(pil_mask(lambda dr: dr.rectangle([Q(52, 56.8), Q(64.5, 59)], fill=255)) * 0.35
         * (np.sin(yy / (0.5 * U) * math.pi) > -0.2) * glow, hexc('#b4f0cc'))
ghost_ship()

# ---- left cliff with a crooked graveyard ------------------------------
cliff_pts = [P(-1, 92), P(-1, 44), P(4, 43), P(10, 43.6), P(15, 43.2), P(19, 44.4), P(21, 47), P(22.5, 52),
             P(24, 57), P(26.5, 62), P(27, 68), P(26, 74), P(28, 80), P(26, 92)]
cliff = pil_mask(lambda dr: dr.polygon(cliff_pts, fill=255))
cliff_col = ramp((xx / U - 4) / 22 + (yy / U - 44) / 120,
                 [(0, '#54446a'), (0.5, '#6e5c84'), (0.8, '#9a84a8'), (1, '#dcaab4')])
comp(cliff, cliff_col)
ledges = [(rng.uniform(2, 22), rng.uniform(47, 76), rng.uniform(2, 5)) for _ in range(20)]
comp(batch(ledges, lambda dr, x, y, L: dr.rectangle([P(x, y), P(x + L, y + 0.4)], fill=150)) * cliff, hexc('#3e3052'))
comp(batch(ledges, lambda dr, x, y, L: dr.rectangle([P(x, y - 0.4), P(x + L, y)], fill=110)) * cliff, hexc('#c4a4c0'))
grown = np.asarray(Image.fromarray((cliff * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), np.float32) / 255
cliff_edge = np.clip(grown - cliff, 0, 1) * (yy > 56 * U) * (yy < 76 * U)
comp(cliff_edge * (0.45 + 0.15 * s(0.1)), hexc('#ffffff'))

# tombstones, tilted, silhouetted against the sky
def tomb(x, base, w, h, ang, cross=False):
    a = math.radians(ang)
    rot = lambda px, py: (x + px * math.cos(a) - py * math.sin(a), base + px * math.sin(a) + py * math.cos(a))
    if cross:
        parts = [[(-0.35, 0), (0.35, 0), (0.35, -h), (-0.35, -h)],
                 [(-w / 2, -h * 0.72), (w / 2, -h * 0.72), (w / 2, -h * 0.72 + 0.7), (-w / 2, -h * 0.72 + 0.7)]]
    else:
        n = 8
        arch = [(w / 2 * math.cos(math.pi * i / n), -h + w / 2 - w / 2 * math.sin(math.pi * i / n)) for i in range(n + 1)]
        parts = [[(-w / 2, 0), (w / 2, 0)] + arch]
    for pts in parts:
        comp(pil_mask(lambda dr: dr.polygon([P(*rot(px, py)) for px, py in pts], fill=255)), hexc(SIL2))
tomb(2.4, 43.9, 3.2, 4.4, -11)
tomb(6.9, 44.1, 2.4, 3.0, 8)
tomb(10.6, 43.9, 2.8, 5.6, -5, cross=True)
tomb(14.6, 44.0, 2.6, 3.6, 14)

# dead crooked tree at the cliff edge
def dead_tree():
    br = [((19.5, 44.5), (19.8, 39), 0.75), ((19.8, 39), (21.6, 34.6), 0.55), ((21.6, 34.6), (24.6, 32.4), 0.4),
          ((21.6, 34.6), (21, 31.2), 0.35), ((19.8, 39), (16.6, 36.4), 0.45), ((16.6, 36.4), (15.2, 33.6), 0.35),
          ((16.6, 36.4), (13.8, 36), 0.3), ((24.6, 32.4), (25.6, 33.6), 0.3), ((20.6, 37.2), (23.4, 37.6), 0.35)]
    comp(pil_mask(lambda dr: [dr.line([P(*a), P(*b)], fill=255, width=max(1, int(w * 2 * U)), joint='curve') for a, b, w in br]
                  + [dr.ellipse([P(a[0] - w, a[1] - w), P(a[0] + w, a[1] + w)], fill=255) for a, b, w in br]), hexc(SIL))
    # a lantern hanging from the right branch
    sw = 0.25 * s(0.5)
    lx, ly = 23.6 + sw, 34.6
    comp(pil_mask(lambda dr: dr.line([P(23.4, 33.1), P(lx, ly)], fill=255, width=1)), hexc(SIL))
    flick = 0.75 + 0.15 * s(0.2, 3) + 0.1 * s(0.7, 5)
    gl = np.hypot(xx - lx * U, yy - (ly + 1) * U)
    comp(np.exp(-(gl / (2.2 * U)) ** 2) * 0.35 * flick, hexc('#eefff4'))
    comp(pil_mask(lambda dr: dr.rectangle([P(lx - 0.6, ly), P(lx + 0.6, ly + 1.8)], fill=255)), hexc(SIL))
    comp(pil_mask(lambda dr: dr.rectangle([P(lx - 0.3, ly + 0.4), P(lx + 0.3, ly + 1.4)], fill=255)) * flick, hexc('#b4f0cc'))
dead_tree()

# ---- foreground: sand, chest, jack-o'-lanterns --------------------------
def shore(x, base, amp, ph):
    return base + amp * np.sin(x / (7 * U) + ph) + 0.4 * amp * np.sin(x / (2.9 * U) + 2 * ph)

for base, a in ((72.6, 0.45), (74.6, 0.7)):
    edge = shore(xx, (base + 0.4 * s(base / 10)) * U, 0.6 * U, base)
    comp(np.clip(1 - np.abs(yy - edge) / (0.5 * U), 0, 1) * a * (xx > 25 * U), hexc('#ffffff'))
sand_top = shore(xx, (76 + 0.25 * s(0.4)) * U, 0.8 * U, 1.1)
comp(np.clip((yy - sand_top) / (0.6 * U), 0, 1),
     ramp((yy - 75 * U) / (15 * U), [(0, '#d4b48e'), (0.15, '#e6c8a0'), (0.5, '#f0d8b0'), (1, '#f6e2bc')]))
comp(np.clip(1 - np.abs(yy - sand_top) / (0.6 * U), 0, 1) * 0.85, hexc('#ffffff'))
speck = [(rng.uniform(0, 72), rng.uniform(78, 90), rng.choice([0, 1])) for _ in range(240)]
comp(batch([p for p in speck if p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.3, y + 0.3)], fill=200)), hexc('#d2b07c'))
comp(batch([p for p in speck if not p[2]], lambda dr, x, y, c: dr.rectangle([P(x, y), P(x + 0.3, y + 0.3)], fill=200)), hexc('#fbf0d8'))

FLICK = 0.78 + 0.13 * s(0.2, 3) + 0.09 * s(0.7, 5)

def pumpkin(cx, cy, rx, ry, face=True, k=0.0, stem_tilt=0.4):
    """A ribbed pumpkin centered at (cx, cy). Lit warm from the moon (upper right)."""
    fl = 0.78 + 0.13 * s(k + 0.2, 3) + 0.09 * s(k + 0.7, 5)
    body = pil_mask(lambda dr: dr.ellipse([P(cx - rx, cy - ry), P(cx + rx, cy + ry)], fill=255))
    t = ((xx / U - cx) / rx * -0.45 + (yy / U - cy) / ry * 0.55) * 0.5 + 0.5
    comp(body, ramp(t, [(0, '#ffb04a'), (0.35, '#f08a2a'), (0.7, '#c45a1e'), (1, '#7a2e16')]))
    # ribs: vertical darker crescents
    for f in (-0.55, -0.18, 0.18, 0.55):
        rw = rx * 0.5 * (1 - abs(f) * 0.6)
        ox = cx + f * rx
        rib = pil_mask(lambda dr: dr.arc([P(ox - rw, cy - ry * 0.98), P(ox + rw, cy + ry * 0.98)],
                                         *((90, 270) if f < 0 else (270, 450)), fill=255,
                                         width=max(1, int(0.32 * U))))
        comp(rib * body * 0.55, hexc('#8a3418'))
    # stem
    comp(pil_mask(lambda dr: dr.polygon([P(cx - 0.45, cy - ry + 0.3), P(cx + 0.45, cy - ry + 0.3),
                                         P(cx + 0.45 + stem_tilt, cy - ry - 1.4 * ry / 4), P(cx - 0.25 + stem_tilt, cy - ry - 1.5 * ry / 4)], fill=255)),
         ramp((xx / U - cx + 0.5) / 1.4, [(0, '#2e4a1e'), (1, '#6e8a3a')]))
    if not face:
        return
    # warm glow spilling around the lantern
    gd = np.hypot(xx - cx * U, (yy - cy * U) * 1.2)
    comp(np.exp(-(gd / (rx * 2.6 * U)) ** 2) * 0.22 * fl * (1 - body), hexc('#ffd08a'))
    # carved face: triangle eyes, triangle nose, jagged grin, glowing inside
    face_m = pil_mask(lambda dr: (
        dr.polygon([P(cx - rx * 0.62, cy - ry * 0.05), P(cx - rx * 0.12, cy - ry * 0.05), P(cx - rx * 0.36, cy - ry * 0.5)], fill=255),
        dr.polygon([P(cx + rx * 0.12, cy - ry * 0.05), P(cx + rx * 0.62, cy - ry * 0.05), P(cx + rx * 0.36, cy - ry * 0.5)], fill=255),
        dr.polygon([P(cx - rx * 0.12, cy + ry * 0.2), P(cx + rx * 0.12, cy + ry * 0.2), P(cx, cy + ry * 0.0)], fill=255),
        dr.polygon([P(cx - rx * 0.7, cy + ry * 0.3), P(cx - rx * 0.45, cy + ry * 0.42), P(cx - rx * 0.3, cy + ry * 0.32),
                    P(cx - rx * 0.12, cy + ry * 0.46), P(cx + rx * 0.08, cy + ry * 0.34), P(cx + rx * 0.28, cy + ry * 0.48),
                    P(cx + rx * 0.45, cy + ry * 0.36), P(cx + rx * 0.7, cy + ry * 0.3),
                    P(cx + rx * 0.5, cy + ry * 0.66), P(cx + rx * 0.2, cy + ry * 0.76), P(cx + rx * 0.1, cy + ry * 0.62),
                    P(cx - rx * 0.1, cy + ry * 0.78), P(cx - rx * 0.3, cy + ry * 0.64), P(cx - rx * 0.5, cy + ry * 0.66)], fill=255)))
    comp(face_m, hexc('#3a1408'))
    inner = np.asarray(Image.fromarray((face_m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), np.float32) / 255
    comp(inner * fl, ramp((yy / U - (cy - ry * 0.5)) / (ry * 1.3), [(0, '#fff6d0'), (0.5, '#ffe6a0'), (1, '#ffc46a')]))

# open treasure chest with gold coins, center-right on the sand
def chest():
    x0, x1, top, bot = 35, 54, 77.2, 85
    comp(pil_mask(lambda dr: dr.ellipse([P(x0 - 2.5, bot - 1.2), P(x1 + 3, bot + 1.3)], fill=255)) * 0.4, hexc('#b8946c'))
    # open lid, tilted back
    lid = pil_mask(lambda dr: dr.polygon([P(x0 + 0.4, top), P(x1 - 0.4, top), P(x1 + 0.6, top - 3.8), P(x0 - 0.6, top - 3.8)], fill=255))
    comp(lid, ramp((yy / U - (top - 3.8)) / 3.8, [(0, '#6e4424'), (1, '#3a2014')]))
    comp(pil_mask(lambda dr: dr.polygon([P(x0 - 0.6, top - 3.8), P(x1 + 0.6, top - 3.8), P(x1 + 0.45, top - 3.2), P(x0 - 0.45, top - 3.2)], fill=255)), hexc('#d9ae42'))
    for bx in (x0 + 2.2, x1 - 2.8):
        comp(pil_mask(lambda dr: dr.rectangle([P(bx - 0.1, top - 3.8), P(bx + 0.6, top)], fill=255)) * lid, hexc('#b08a34'))
    # coin mound spilling over the rim
    pile = pil_mask(lambda dr: dr.chord([P(x0 + 0.2, top - 2.6), P(x1 - 0.2, top + 2.6)], 180, 360, fill=255))
    comp(pile, ramp((yy / U - (top - 2.6)) / 2.8, [(0, '#ffe680'), (0.5, '#ffd84a'), (1, '#c99a2e')]))
    # body
    body = pil_mask(lambda dr: dr.rectangle([P(x0, top), P(x1, bot)], fill=255))
    comp(body, ramp((yy / U - top) / (bot - top), [(0, '#8f6538'), (0.4, '#6e4a28'), (1, '#3a2014')]))
    for gy in (top + 2.3, top + 4.6):
        comp(pil_mask(lambda dr: dr.line([P(x0, gy), P(x1, gy)], fill=255, width=1)) * body * 0.7, hexc('#3a2014'))
    comp(pil_mask(lambda dr: dr.rectangle([P(x0, top), P(x1, top + 0.7)], fill=255)), hexc('#d9ae42'))
    for bx in (x0 + 1.4, x1 - 2.1):
        comp(pil_mask(lambda dr: dr.rectangle([P(bx, top), P(bx + 0.7, bot)], fill=255)), hexc('#d9ae42'))
    comp(pil_mask(lambda dr: dr.rectangle([P((x0 + x1) / 2 - 0.8, top + 0.9), P((x0 + x1) / 2 + 0.8, top + 2.6)], fill=255)), hexc('#d9ae42'))
    comp(pil_mask(lambda dr: dr.rectangle([P((x0 + x1) / 2 - 0.25, top + 1.5), P((x0 + x1) / 2 + 0.25, top + 2.2)], fill=255)), hexc('#15151f'))
    # spilled coins on the sand, a few glinting
    coins = [(32, 84.4), (33.4, 85.8), (30.6, 86.2), (55.6, 84.2), (57.3, 85.4), (56, 86.6), (59, 86.3), (34.8, 87)]
    for i, (cx, cy) in enumerate(coins):
        comp(pil_mask(lambda dr: dr.ellipse([P(cx - 0.7, cy - 0.45), P(cx + 0.7, cy + 0.45)], fill=255)), hexc('#ffd84a'))
        comp(pil_mask(lambda dr: dr.ellipse([P(cx - 0.7, cy), P(cx + 0.7, cy + 0.45)], fill=255)) * 0.6, hexc('#c99a2e'))
    for cx, cy, k in ((38.5, 75.6, 0.1), (51.5, 75.4, 0.55), (56.6, 84, 0.8)):
        g = max(0.0, s(k, 2)) ** 3
        comp(pil_mask(lambda dr: (dr.rectangle([P(cx - 0.9, cy - 0.12), P(cx + 0.9, cy + 0.12)], fill=255),
                                  dr.rectangle([P(cx - 0.12, cy - 0.9), P(cx + 0.12, cy + 0.9)], fill=255))) * g, hexc('#fff6d0'))
chest()

# the big jack-o'-lantern sitting on the coins
pumpkin(44.5, 70.6, 6.4, 5.2, face=True, k=0.0)
# smaller pumpkins on the sand
pumpkin(63, 82.6, 3.8, 3.0, face=True, k=0.37, stem_tilt=-0.3)
pumpkin(27.5, 83.2, 2.8, 2.2, face=False, stem_tilt=0.5)
pumpkin(68.4, 85.4, 2.1, 1.7, face=False, stem_tilt=-0.4)

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
