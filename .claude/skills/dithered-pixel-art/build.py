"""Render a scene's animation frames in parallel and package them for the site.

Usage: python build.py SCENE.py OUT_BASENAME [--frames 32] [--ms 190] [--jobs 8]

Writes OUT_BASENAME.webp (lossless animated loop) and OUT_BASENAME.png (frame 0,
the still for reduced-motion visitors), and prints file sizes, loop length and
how much of the image changes per frame. Needs Pillow and numpy.
"""
import argparse, os, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('scene')
ap.add_argument('out')
ap.add_argument('--frames', type=int, default=32)
ap.add_argument('--ms', type=int, default=190, help='duration of each frame')
ap.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2) - 1))
args = ap.parse_args()

tmp = tempfile.mkdtemp(prefix='dither-frames-')

def render(i):
    frame = os.path.join(tmp, f'f{i}.png')
    r = subprocess.run([sys.executable, '-I', args.scene, os.path.join(tmp, f's{i}.png'), frame,
                        f'{i / args.frames:.6f}'], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'frame {i} failed:\n{r.stderr}')
    if 'Warning' in r.stderr:
        print(f'frame {i} warned (check for NaN pixels):\n{r.stderr}', file=sys.stderr)
    return frame

with ThreadPoolExecutor(args.jobs) as ex:
    paths = list(ex.map(render, range(args.frames)))

frames = [Image.open(p).convert('RGB') for p in paths]
arr = [np.asarray(f) for f in frames]
changed = [(arr[i] != arr[(i + 1) % len(arr)]).any(-1).mean() * 100 for i in range(len(arr))]

frames[0].save(args.out + '.png', optimize=True)
frames[0].save(args.out + '.webp', save_all=True, append_images=frames[1:], duration=args.ms,
               loop=0, lossless=True, method=6)

print(f'{args.out}.webp  {os.path.getsize(args.out + ".webp") // 1024} KB, '
      f'{args.frames} frames x {args.ms} ms = {args.frames * args.ms / 1000:.2f}s loop')
print(f'{args.out}.png   {os.path.getsize(args.out + ".png") // 1024} KB still')
print(f'pixels changing per frame: max {max(changed):.1f}%, avg {sum(changed) / len(changed):.1f}%')
