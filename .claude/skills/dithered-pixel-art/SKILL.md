---
name: dithered-pixel-art
description: Paint, animate and ship the dithered pixel-art scenes Dabloons uses as page art (the home hero beach, the login sunset cove). Use when asked to make a new scene, change or re-animate an existing one, adjust its speed, or add art to another page in the same style.
---

# Dithered pixel-art scenes

Dabloons' page art is a procedurally drawn scene: a smooth painting made in Python, shrunk to a small pixel grid, then ordered-dithered (Bayer 8x8) down to a fixed palette. That gives the "high-res pixel art" look, with smooth gradients rendered as crisp checkerboard patterns and no blur. Each scene ships as a lossless animated WebP that loops on its own (no page JavaScript), plus a still PNG for visitors who prefer reduced motion.

Live examples, both in `dashboard/src/assets/`:

| Scene | Script | Grid | Where |
|---|---|---|---|
| Beach with pirate ship | `scenes/hero_beach.py` | 800x300 | home hero (`hero-beach-dither.*`) |
| Sunset cove, lighthouse, dock | `scenes/login_cove.py` | 360x450 | login art panel (`login-cove-dither.*`) |

Both loop in 32 frames x 190 ms (about 6 s). The owner tuned that speed by eye: 2 s felt frantic, 8 s too sleepy. Keep new scenes at the same pace so the site feels consistent.

## Setup

Use a throwaway venv in the scratchpad, never the repo:

```sh
python3 -m venv $SCRATCH/venv && $SCRATCH/venv/bin/pip -q install pillow numpy
```

## Workflow

1. **Copy the closest scene script** into the scratchpad and edit it there. Start from `login_cove.py` for anything new, because it builds its palette automatically (see Palette).
2. **Iterate on frame 0 only.** It takes a few seconds: `python -I scene.py smooth.png frame.png 0`. Look at the frame scaled up 2x with nearest-neighbor, and also at a 3x crop of a busy area, since dither texture only shows up close.
3. **Build the loop** with `python -I build.py scene.py OUT --frames 32 --ms 190`. It renders the frames in parallel (about 1 to 3 minutes; run it in the background) and writes `OUT.webp` and `OUT.png`, then prints the sizes, the loop length and how much of the image changes per frame.
4. **Wire it into the page** (below), screenshot the running page, then commit the scene script changes along with the assets.

## How a scene script is built

Everything is drawn at 2x supersampling (`S = 2`) in float RGB, then shrunk with LANCZOS before dithering. Coordinates are in scene *units* (the hero is 160x60 units, the cove 72x90), and `P(x, y)` converts units to drawing pixels, so shapes are written at a readable scale.

- `ramp(t, [(pos, '#hex'), ...])` makes gradients. Use them for sky, sea, sand and the shading on every object, because flat fills look dead once dithered.
- `comp(mask, color)` alpha-composites a color, or a whole ramp, through a 0..1 mask. Paint back to front: sky, glow, clouds, far objects, sea, near objects, foreground.
- `pil_mask(lambda dr: dr.polygon(...))` makes a shape mask with PIL's drawing tools. `batch(items, fn)` draws hundreds of small marks (stars, wave glints, sand specks) into a single mask, which is far faster than one mask each.
- Light every object from the sun's side, with a lighter ramp stop facing the sun and darker stops away from it.
- Use a fixed-seed `rng` for layout and a separate `prng` for animation phases. Then adding animation never reshuffles where things sit.

## Palette

The dither can only produce colors in its palette, and it fakes everything in between by mixing neighboring palette colors in a pattern. In `login_cove.py`, every hex passed to `hexc()` is collected into `USED`, and that set is the palette. Any new color you paint with is automatically available, and no stray colors appear. The hero uses a hand-picked `PALETTE` list instead; if you add colors there, also add them to the list.

Keep the bayer `spread` around 34. Lower values give banding, and higher values make noisy speckle.

## Animating

`PH` (0..1) is the position in the loop. Every motion must be a periodic function of `PH` with a **whole number of cycles per loop**, such as `math.sin(TAU * (n * PH + k))`, or the loop will visibly jump when it restarts. Give each element its own phase offset `k` so things don't move in lockstep.

Keep motion small and slow. Current values, in scene units:

- Ships and rowboats bob 0.2 to 0.35 up and down, once per loop.
- Clouds drift 0.6 to 1.2 and palms sway about 0.4, once per loop.
- Wave glints slide 0.8 and twinkle twice per loop. Sun-reflection dashes jitter 0.6 and blink twice per loop.
- Birds drift 1.0 to 1.2 and flap three times per loop. Shoreline foam laps 0.25 to 0.4.
- Lights such as the lighthouse lamp and the lantern pulse in alpha only, never position. The lantern adds a faster flicker made from two sine waves.

Because Bayer dithering is tied to fixed pixel positions, still areas render identically in every frame and don't shimmer. Only things that actually move change. Aim for under 10% of pixels changing per frame (`build.py` reports this). That is what keeps the WebP around 300 KB and cheap for the browser to play.

## Sizing

Pick the grid so that one dither pixel lands at about 2 to 2.5 screen pixels where the art is displayed. The page uses `object-cover`, so work out the crop: the hero is wide (800x300) and the login panel is a portrait half-screen (360x450). Keep important objects away from the edges that get cropped on other screen shapes, and leave calm areas (sky, open water) where page text sits on top.

## Wiring it into a page

```tsx
import scene from '@/assets/<name>-dither.png'
import sceneAnimated from '@/assets/<name>-dither.webp'

{/* Animated WebP loops on its own; reduced-motion visitors get the still frame. */}
<picture>
  <source srcSet={scene} media='(prefers-reduced-motion: reduce)' />
  <img
    src={sceneAnimated}
    alt=''
    className='absolute inset-0 size-full object-cover [image-rendering:pixelated]'
  />
</picture>
```

`[image-rendering:pixelated]` is required, or the browser blurs the dither when it scales the image up. To change only the speed, re-encode the existing frames with a different `--ms` value; there's no need to repaint.

## Pitfalls already hit

- **Glows between complementary colors turn gray.** A yellow glow composited over a blue sky dithers as yellow and blue checkers, which reads as mud. Make glows step through colors the background already has (blue to pale blue to cream), or keep them tight.
- **Thin lines read as scratches.** Shapes thinner than about 0.5 unit become broken single-pixel lines after shrinking (the first palm fronds, and a framing frond that was cut). Make leaves from many short leaflet strokes along a spine, and keep lines at least 0.5 unit wide.
- **PIL needs its corners in order.** `rectangle` and `ellipse` fail when x1 < x0 or y1 < y0. Tilted or rotated points (like the rowboat's roll) can flip them on some frames only, so the failure shows up mid-build. Keep shadows and similar shapes axis-aligned, or sort the corners first.
- **Division by zero in beam or falloff math creates NaN pixels**, which become a wrong palette color on a few frames. Guard denominators with `np.maximum(..., 1e-3)`. `build.py` prints a warning whenever a frame emits one.
- **When you change shared code, re-render every frame.** Mixing frames from before and after an edit causes a one-frame pop.
- In zsh, `$VAR:r...` is treated as a path modifier, so write `"${C}:refs/heads/main"` with braces when pushing a commit hash.

## Verify

Screenshot the real page with the art in place (headless Chrome works: `--headless=new --window-size=1440,900 --virtual-time-budget=6000 --screenshot=...`). Confirm the art is crisp, not blurred, and that text over it stays readable. Still screenshots can't show motion, so ask the owner to look at the motion in a browser.
