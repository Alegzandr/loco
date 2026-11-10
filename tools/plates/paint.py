"""
Paints a room's plate from its guide, on a local ComfyUI.

    python tools/plates/paint.py top   velvet --seed 4402
    python tools/plates/paint.py floor velvet --seed 6601 --top <painted top>.png
    python tools/plates/paint.py plate velvet --from <painted floor pass>.png

Two passes, and the order is the finding. Asked to repaint the whole guide at
once, the model (FLUX.2 Klein 4B, its image-edit graph) either left it as it
was or moved the camera: a frame that is three quarters empty floor is not a
picture it believes in, so it lifted the horizon to the middle and painted a
handsome view the game's table does not stand in. So:

1. `top`: the strip above the floor, cut off the guide, is a panorama in its
   own right, and painted alone it keeps every object where the guide has it.
2. `floor`: the painted strip is pasted back over the guide and the whole is
   given back with the top declared finished. Now the floor is the only thing
   left to paint, and it is painted under the strip, in its perspective,
   mirroring it.

`plate` resizes the result to the guide's size and writes the WebP the client
ships (`client/src/assets/plates/<room>.webp`).

Needs: a ComfyUI on 127.0.0.1:8188 with `flux-2-klein-4b.safetensors`,
`qwen_3_4b.safetensors` and `flux2-vae.safetensors`, and Pillow. The guide is
`tools/plates/guide.mjs`'s. Prompts are `tools/plates/prompts/<room>-top.txt`
and `-floor.txt`. Every run is seeded; the seeds a shipped plate came from are
in `client/src/components/scene/plates.ts` beside its entry.
"""
import argparse
import io
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


def graph(image, prompt, seed, megapixels, steps, prefix):
    """The template's own wiring for a Klein 4B distilled edit: the image is a reference latent on both sides of the guider."""
    return {
        '70': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'flux-2-klein-4b.safetensors', 'weight_dtype': 'default'}},
        '71': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b.safetensors', 'type': 'flux2', 'device': 'default'}},
        '72': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'flux2-vae.safetensors'}},
        '76': {'class_type': 'LoadImage', 'inputs': {'image': image}},
        '80': {'class_type': 'ImageScaleToTotalPixels', 'inputs': {'image': ['76', 0], 'upscale_method': 'lanczos', 'megapixels': megapixels, 'resolution_steps': 16}},
        '99': {'class_type': 'GetImageSize', 'inputs': {'image': ['80', 0]}},
        '66': {'class_type': 'EmptyFlux2LatentImage', 'inputs': {'width': ['99', 0], 'height': ['99', 1], 'batch_size': 1}},
        '62': {'class_type': 'Flux2Scheduler', 'inputs': {'steps': steps, 'width': ['99', 0], 'height': ['99', 1]}},
        '74': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['71', 0], 'text': prompt}},
        '82': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['74', 0]}},
        '122': {'class_type': 'VAEEncode', 'inputs': {'pixels': ['80', 0], 'vae': ['72', 0]}},
        '123': {'class_type': 'ReferenceLatent', 'inputs': {'conditioning': ['74', 0], 'latent': ['122', 0]}},
        '121': {'class_type': 'ReferenceLatent', 'inputs': {'conditioning': ['82', 0], 'latent': ['122', 0]}},
        '63': {'class_type': 'CFGGuider', 'inputs': {'model': ['70', 0], 'positive': ['123', 0], 'negative': ['121', 0], 'cfg': 1.0}},
        '61': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}},
        '73': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': seed}},
        '64': {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['73', 0], 'guider': ['63', 0], 'sampler': ['61', 0], 'sigmas': ['62', 0], 'latent_image': ['66', 0]}},
        '65': {'class_type': 'VAEDecode', 'inputs': {'samples': ['64', 0], 'vae': ['72', 0]}},
        '9': {'class_type': 'SaveImage', 'inputs': {'images': ['65', 0], 'filename_prefix': prefix}},
    }


def upload(path, name):
    """Puts a file in ComfyUI's input folder through its own API, so this needs no path into its install."""
    boundary = '----locoplate'
    body = io.BytesIO()
    crlf = chr(13) + chr(10)
    head = [f'--{boundary}', f'Content-Disposition: form-data; name="image"; filename="{name}"', 'Content-Type: image/png', '', '']
    tail = ['', f'--{boundary}', 'Content-Disposition: form-data; name="overwrite"', '', 'true', f'--{boundary}--', '']
    body.write(crlf.join(head).encode())
    body.write(open(path, 'rb').read())
    body.write(crlf.join(tail).encode())
    req = urllib.request.Request(f'{COMFY}/upload/image', data=body.getvalue(), headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    return json.load(urllib.request.urlopen(req))['name']


def run(src, prompt, seed, megapixels, steps, out):
    name = upload(src, f'loco-plate-{os.path.basename(src)}')
    prefix = f'loco-plate-{seed}'
    req = urllib.request.Request(f'{COMFY}/prompt', data=json.dumps({'prompt': graph(name, prompt, seed, megapixels, steps, prefix)}).encode(), headers={'Content-Type': 'application/json'})
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


def prompt_of(room, part):
    return io.open(os.path.join(HERE, 'prompts', f'{room}-{part}.txt'), encoding='utf-8').read().strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('step', choices=['top', 'floor', 'plate'])
    ap.add_argument('room')
    ap.add_argument('--dir', default=os.path.join(ROOT, '.assets-in', 'plates'), help='where the guide is and the passes go')
    ap.add_argument('--seed', type=int, nargs='+', default=[1], help='one pass per seed')
    ap.add_argument('--strip', type=int, default=416, help='rows of the guide above the floor: down to the foot of what stands at its edge')
    ap.add_argument('--top', help='floor: the painted strip to finish under')
    ap.add_argument('--dim', type=float, default=1.0, help="floor: the guide's floor taken down by this before it is given back (a floor the block room lit too brightly is repainted as bright)")
    ap.add_argument('--from', dest='src', help='plate: the floor pass to ship')
    a = ap.parse_args()
    guide = os.path.join(a.dir, f'guide-{a.room}.png')
    g = Image.open(guide).convert('RGB')
    if a.step == 'top':
        strip = os.path.join(a.dir, f'guide-{a.room}-top.png')
        g.crop((0, 0, g.width, a.strip)).save(strip)
        for seed in a.seed:
            run(strip, prompt_of(a.room, 'top'), seed, 1.5, 6, os.path.join(a.dir, f'{a.room}-top-{seed}.png'))
    elif a.step == 'floor':
        if not a.top:
            sys.exit('floor needs --top <painted strip>')
        t = Image.open(a.top).convert('RGB').resize((g.width, a.strip), Image.LANCZOS)
        if a.dim != 1.0:
            floor = g.crop((0, a.strip, g.width, g.height)).point(lambda v: int(v * a.dim))
            g.paste(floor, (0, a.strip))
        g.paste(t, (0, 0))
        mix = os.path.join(a.dir, f'guide-{a.room}-mix.png')
        g.save(mix)
        for seed in a.seed:
            run(mix, prompt_of(a.room, 'floor'), seed, 3.0, 6, os.path.join(a.dir, f'{a.room}-floor-{seed}.png'))
    else:
        if not a.src:
            sys.exit('plate needs --from <floor pass>')
        out = os.path.join(ROOT, 'client', 'src', 'assets', 'plates', f'{a.room}.webp')
        Image.open(a.src).convert('RGB').resize(g.size, Image.LANCZOS).save(out, quality=88, method=6)
        print(f'ok {out} ({g.width}x{g.height}, {os.path.getsize(out) // 1024} KB)')


if __name__ == '__main__':
    main()
