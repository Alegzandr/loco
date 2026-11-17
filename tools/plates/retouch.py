"""
Repaints one corner of a shipped plate, on a local ComfyUI.

    python tools/plates/retouch.py try  orbit rover --seed 1 2 3
    python tools/plates/retouch.py ship orbit

The two passes of `paint.py` leave the odd thing no room has: a car parked on
a crate, a bench sunk into the floor where the passes meet. Painting the room
again would move everything else too, so a retouch is local: a box is cut out
of the plate, the same image-edit model is asked for that box without the
mistake, and the answer is laid back through a feathered mask, so nothing
outside `mask` moves and no edge shows.

`retouches.json` is the list, by room: `box` the context the model is shown,
`mask` the part of it that may change (both in the plate's pixels), `prompt`,
and `seed` once one has been chosen by eye. `try` writes each seed's result
beside the untouched box in `.assets-in/plates/retouch/`; `ship` lays every
retouch that has a seed over the base and writes the WebP the client ships.

The base is the plate as `paint.py` left it, kept as
`.assets-in/plates/<room>-base.png` (made from the shipped WebP the first time,
so run that first time on an unretouched plate): `ship` always starts from it,
which is what makes it safe to run twice.
"""
import argparse
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

from paint import ROOT, run

HERE = os.path.dirname(os.path.abspath(__file__))
PLATES = os.path.join(ROOT, 'client', 'src', 'assets', 'plates')
FEATHER = 14


def base_of(room, work):
    path = os.path.join(work, f'{room}-base.png')
    if not os.path.exists(path):
        os.makedirs(work, exist_ok=True)
        Image.open(os.path.join(PLATES, f'{room}.webp')).convert('RGB').save(path)
    return Image.open(path).convert('RGB')


def patch_path(work, room, name, seed):
    return os.path.join(work, 'retouch', f'{room}-{name}-{seed}.png')


def paint(base, room, name, r, seed, work):
    """The model's answer for one box, at the box's own size."""
    out = patch_path(work, room, name, seed)
    if not os.path.exists(out):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        src = os.path.join(work, 'retouch', f'{room}-{name}-src.png')
        base.crop(tuple(r['box'])).save(src)
        run(src, r['prompt'], seed, r.get('megapixels', 1.0), 6, out)
    x0, y0, x1, y1 = r['box']
    return Image.open(out).convert('RGB').resize((x1 - x0, y1 - y0), Image.LANCZOS)


def lay(img, r, patch):
    """
    Lays a patch through its mask, feathered inwards so the mask's edge is the
    plate's own pixels. A side of the mask that is the plate's own edge is not
    feathered: there is nothing past it to blend into.
    """
    x0, y0, x1, y1 = r['box']
    mx0, my0, mx1, my1 = r.get('mask', r['box'])
    pad = FEATHER * 2
    m = Image.new('L', (x1 - x0 + pad * 2, y1 - y0 + pad * 2), 0)
    ImageDraw.Draw(m).rectangle(
        (
            mx0 - x0 + (FEATHER if mx0 > 0 else -pad) + pad,
            my0 - y0 + (FEATHER if my0 > 0 else -pad) + pad,
            mx1 - x0 - (FEATHER if mx1 < img.width else -pad) + pad,
            my1 - y0 - (FEATHER if my1 < img.height else -pad) + pad,
        ),
        fill=255,
    )
    m = m.filter(ImageFilter.GaussianBlur(FEATHER / 2)).crop((pad, pad, pad + x1 - x0, pad + y1 - y0))
    img.paste(patch, (x0, y0), m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('step', choices=['try', 'ship'])
    ap.add_argument('room')
    ap.add_argument('name', nargs='?', help='try: which retouch')
    ap.add_argument('--dir', default=os.path.join(ROOT, '.assets-in', 'plates'), help='where the base is and the patches go')
    ap.add_argument('--seed', type=int, nargs='+', default=[1], help='try: one answer per seed')
    a = ap.parse_args()
    todo = json.load(io.open(os.path.join(HERE, 'retouches.json'), encoding='utf-8')).get(a.room, {})
    base = base_of(a.room, a.dir)
    if a.step == 'try':
        if a.name not in todo:
            sys.exit(f'no retouch {a.name!r} for {a.room}: {", ".join(todo) or "none"}')
        r = todo[a.name]
        x0, y0, x1, y1 = r['box']
        for seed in a.seed:
            after = base.copy()
            lay(after, r, paint(base, a.room, a.name, r, seed, a.dir))
            sheet = Image.new('RGB', (x1 - x0, (y1 - y0) * 2))
            sheet.paste(base.crop((x0, y0, x1, y1)), (0, 0))
            sheet.paste(after.crop((x0, y0, x1, y1)), (0, y1 - y0))
            out = os.path.join(a.dir, 'retouch', f'{a.room}-{a.name}-{seed}-sheet.png')
            sheet.save(out)
            print(f'ok {out}')
    else:
        for name, r in todo.items():
            if 'seed' in r:
                lay(base, r, paint(base_of(a.room, a.dir), a.room, name, r, r['seed'], a.dir))
                print(f'laid {name} ({r["seed"]})')
        out = os.path.join(PLATES, f'{a.room}.webp')
        base.save(out, quality=88, method=6)
        print(f'ok {out} ({os.path.getsize(out) // 1024} KB)')


if __name__ == '__main__':
    main()
