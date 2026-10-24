#!/usr/bin/env python3
"""make-previews.py — turn the rendered 3000x3000 posters into the TWO WebP sets
the app ships.

    python3 make-previews.py
      -> plugin-designs/my-upg-100-list/assets/previews/<zone>.webp   560px  card thumbnails
      -> data/posters/<zone>.webp                                   1500px the download

WHY TWO SIZES
The wall card shows a small thumbnail; tapping "Poster Map" must hand the user
THE SAME POSTER at a usable size. The button used to re-render a live Mapbox
canvas through useMapPoster.js — a completely different artefact from the preview
above it, carrying none of the template. Serving the pre-rendered image makes
preview and download identical BY CONSTRUCTION, and it works on Android, where a
Node generator cannot run at all.

SIZE BUDGET (measured): 1500px q80 WebP is ~217 KB per poster, 5.9 MB for all 28 —
small enough to ship in the APK, and 5in at 300dpi / 10in at 150dpi, a real print.
The 3000px PNG masters (51 MB) stay OUT of the app; export-public.mjs sends those
to a sibling folder for desktop/CDN use.

Uses PIL rather than sharp: sharp is not installed in this repo, PIL is present.
"""
import os, sys, glob
from PIL import Image

HERE  = os.path.dirname(os.path.abspath(__file__))
SRC   = os.path.join(HERE, 'out', 'posters')
# ★ THREE LEVELS, NOT TWO. HERE is <root>/library/scripts/posters, so '..','..' lands on
# <root>/library and every output went to library/plugin-designs/... and library/data/posters --
# directories nothing reads and nothing serves. The script REPORTED success and wrote real WebPs,
# so a preview run looked like it had worked while the served previews never changed. Found by
# dry-running this step on a single poster before a 174-sheet reshoot; it would otherwise have
# silently produced 174 files in the wrong tree and shipped the old thumbnails.
REPO  = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
# WHICH APP the previews belong to. The country-posters app renders from the SAME
# generator into the SAME out/posters, so the only thing that differs is where the
# WebPs land — parameterize rather than fork this script.
#   PROFILE=my-upg-100-list  (default)
#   PROFILE=country-posters  python3 make-previews.py
# ONLY filters by filename prefix so a country run does not re-emit the 28 zone
# posters sitting in the same folder (and vice versa).
PROFILE = os.environ.get('PROFILE', 'my-upg-100-list')
ONLY    = os.environ.get('ONLY_PREFIX', '')
THUMB = os.path.join(REPO, 'plugin-designs', PROFILE, 'assets', 'previews')
FULL  = os.path.join(REPO, 'data', 'posters')   # a SOURCE: the build stages it into <tree>/assets/posters on request

os.makedirs(THUMB, exist_ok=True)
os.makedirs(FULL,  exist_ok=True)

pngs = sorted(glob.glob(os.path.join(SRC, (ONLY + '*.png') if ONLY else '*.png')))
if not pngs:
    sys.exit(f'[make-previews] no PNGs in {SRC} — run `bun run posters` then `bun run posters:shoot` first.')

tkb = fkb = 0
for p in pngs:
    zone = os.path.basename(p)[:-4]
    im = Image.open(p).convert('RGB')

    t = im.copy(); t.thumbnail((560, 560), Image.LANCZOS)
    tp = os.path.join(THUMB, zone + '.webp')
    t.save(tp, 'WEBP', quality=82, method=6)
    tkb += os.path.getsize(tp) / 1024

    f = im.copy(); f.thumbnail((1500, 1500), Image.LANCZOS)
    fp = os.path.join(FULL, zone + '.webp')
    f.save(fp, 'WEBP', quality=80, method=6)
    fkb += os.path.getsize(fp) / 1024

print(f'[make-previews] {len(pngs)} posters')
print(f'  thumbnails -> plugin-designs/.../assets/previews   {tkb/1024:5.1f} MB (inlined in the bundle)')
print(f'  full size  -> data/posters                       {fkb/1024:5.1f} MB (served + shipped in the APK)')
