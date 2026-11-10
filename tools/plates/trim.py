"""
Paints the two strips a room's table is dressed in, on a local ComfyUI.

    python tools/plates/trim.py velvet rail --seed 1 2 3
    python tools/plates/trim.py velvet side --seed 1 2 3
    python tools/plates/trim.py velvet rail --ship <chosen>.png --rows 96 416

A painted room (`plates.ts`) left the table the one rendered thing in the
frame, and beside a painting its plain varnish read as a computer's. The table
cannot be a painting: its shape is solved to the felt, which is another shape
in every frame. But what it is made of can be. Two strips, each a moulding
seen square on, run round the table by the render (`Kit.band`):

- `rail`: the top, from the outer edge in to the cloth: the rail, then the
  racetrack.
- `side`: the edge and the skirt under it, from the top down.

Each is painted from words alone (FLUX.2 Klein 4B, text to image), 4:1, lit
flat from above so the render's own light can still fall on it. `--ship`
cuts the moulding out of a chosen pass (a strip comes back on white, with a
margin above and below and its two ends turned: the rows are found, or given
with `--rows`, and a tenth is left at each end) and writes
`client/src/assets/plates/<room>-<part>.webp`, 1024x256. The render mirrors
the strip end to end, so it need not tile.

Prompts are `tools/plates/prompts/<room>-rail.txt` and `-side.txt`.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COMFY = os.environ.get('COMFYUI_URL', 'http://127.0.0.1:8188')
W, H = 2048, 512


def graph(prompt, seed, prefix):
    return {
        '70': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'flux-2-klein-4b.safetensors', 'weight_dtype': 'default'}},
        '71': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b.safetensors', 'type': 'flux2', 'device': 'default'}},
        '72': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'flux2-vae.safetensors'}},
        '66': {'class_type': 'EmptyFlux2LatentImage', 'inputs': {'width': W, 'height': H, 'batch_size': 1}},
        '62': {'class_type': 'Flux2Scheduler', 'inputs': {'steps': 6, 'width': W, 'height': H}},
        '74': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['71', 0], 'text': prompt}},
        '82': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['74', 0]}},
        '63': {'class_type': 'CFGGuider', 'inputs': {'model': ['70', 0], 'positive': ['74', 0], 'negative': ['82', 0], 'cfg': 1.0}},
        '61': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}},
        '73': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': seed}},
        '64': {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['73', 0], 'guider': ['63', 0], 'sampler': ['61', 0], 'sigmas': ['62', 0], 'latent_image': ['66', 0]}},
        '65': {'class_type': 'VAEDecode', 'inputs': {'samples': ['64', 0], 'vae': ['72', 0]}},
        '9': {'class_type': 'SaveImage', 'inputs': {'images': ['65', 0], 'filename_prefix': prefix}},
    }


def run(prompt, seed, out):
    req = urllib.request.Request(f'{COMFY}/prompt', data=json.dumps({'prompt': graph(prompt, seed, f'loco-trim-{seed}')}).encode(), headers={'Content-Type': 'application/json'})
    pid = json.load(urllib.request.urlopen(req))['prompt_id']
    t0 = time.time()
    while True:
        h = json.load(urllib.request.urlopen(f'{COMFY}/history/{pid}'))
        if pid in h:
            if h[pid].get('status', {}).get('status_str') == 'error':
                sys.exit(f'comfy refused the graph: {json.dumps(h[pid]["status"])[:600]}')
            files = [i for n in h[pid]['outputs'].values() for i in n.get('images', [])]
            if files:
                q = urllib.parse.urlencode({'filename': files[0]['filename'], 'subfolder': files[0].get('subfolder', ''), 'type': files[0].get('type', 'output')})
                with open(out, 'wb') as f:
                    f.write(urllib.request.urlopen(f'{COMFY}/view?{q}').read())
                print(f'ok {out} ({round(time.time() - t0)} s)')
                return
        if time.time() - t0 > 900:
            sys.exit('timed out waiting for ComfyUI')
        time.sleep(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('room')
    ap.add_argument('part', choices=['rail', 'side'])
    ap.add_argument('--dir', default=os.path.join(ROOT, '.assets-in', 'plates'))
    ap.add_argument('--seed', type=int, nargs='+', default=[1])
    ap.add_argument('--ship', help='the pass to ship')
    ap.add_argument('--rows', type=int, nargs=2, default=[0, H], help='ship: the first and the last row of the moulding in that pass')
    a = ap.parse_args()
    if a.ship:
        out = os.path.join(ROOT, 'client', 'src', 'assets', 'plates', f'{a.room}-{a.part}.webp')
        im = Image.open(a.ship).convert('RGB')
        rows = a.rows
        if rows == [0, H]:
            # The moulding is what is not the white it was painted on: the rows
            # whose middle half is dark enough to be something.
            mid = im.crop((im.width // 4, 0, 3 * im.width // 4, im.height)).convert('L')
            dark = [y for y in range(mid.height) if sum(mid.crop((0, y, mid.width, y + 1)).tobytes()) / mid.width < 236]
            rows = [dark[0], dark[-1] + 1] if dark else rows
        # Its two ends are turned or cut off: a tenth is left at each.
        im.crop((im.width // 10, rows[0], 9 * im.width // 10, rows[1])).resize((1024, 256), Image.LANCZOS).save(out, quality=90, method=6)
        print(f'rows {rows[0]}-{rows[1]}')
        print(f'ok {out} ({os.path.getsize(out) // 1024} KB)')
        return
    prompt = open(os.path.join(HERE, 'prompts', f'{a.room}-{a.part}.txt'), encoding='utf-8').read().strip()
    os.makedirs(a.dir, exist_ok=True)
    for seed in a.seed:
        run(prompt, seed, os.path.join(a.dir, f'{a.room}-{a.part}-{seed}.png'))


if __name__ == '__main__':
    main()
