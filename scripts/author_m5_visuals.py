"""Offline authored educational illustrations, NOT photographs or production output.

Uses existing Pillow, NumPy and FFmpeg. Creates an exclusive review directory and
an exclusive subdirectory in the provider's permitted local-material directory.
No provider imports, HTTP, SQLite, speech synthesis, or submission.
"""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
W, H, FPS = 720, 1280, 30
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
INK = (28, 43, 58)
BLUE = (25, 115, 231)
RED = (222, 68, 55)
PAPER = (247, 245, 238)
TITLES = [
    ("Why is the", "sky blue?"),
    ("Sunlight carries", "many colors."),
    ("Air scatters", "short blue waves."),
    ("Blue scatters", "more than red."),
    ("Scattered blue", "reaches your eyes."),
    ("One atmosphere.", "Two views."),
    ("At sunset:", "a longer path."),
    ("Scattering makes", "blue visible."),
    ("Blue sky.", "Tiny molecules."),
]


def text(draw, xy, value, size=32, fill=INK, bold=False):
    draw.text(xy, value, font=ImageFont.truetype(BOLD if bold else FONT, size), fill=fill)


def cloud_sky(sunset=False):
    """Layered cloud silhouettes with multiscale seeded texture and horizon haze."""
    rng = np.random.default_rng(37 if sunset else 19)
    width, height = 860, 1460
    y, x = np.mgrid[0:height, 0:width]
    f = np.clip(y / height, 0, 1)[..., None]
    top = np.array([59, 78, 132] if sunset else [27, 104, 193])
    bottom = np.array([251, 176, 100] if sunset else [180, 221, 246])
    sky = np.broadcast_to(top * (1-f) + bottom * f, (height, width, 3)).copy()
    glow = np.exp(-((x-660)**2 + (y-(1070 if sunset else 380))**2)/(2*190**2))
    sky += glow[..., None] * (38 if sunset else 16)
    noise = np.zeros((height, width), np.float32)
    for size, weight in [(8, .45), (22, .3), (65, .17), (150, .08)]:
        layer = Image.fromarray(np.uint8(rng.random((size, size))*255)).resize((width, height), Image.Resampling.BICUBIC)
        noise += np.array(layer, dtype=np.float32)/255 * weight
    mask = np.zeros((height, width), np.float32)
    for cx, cy, sx, sy in [(180, 480, 230, 64), (620, 680, 270, 68), (240, 950, 330, 70), (760, 1160, 250, 44)]:
        for j in range(7):
            px = cx + (j-3)*sx/5
            py = cy - rng.uniform(0, 65)
            blob = np.exp(-((x-px)/(sx*.4))**2-((y-py)/(sy*rng.uniform(.5, 1.2)))**2)
            mask = np.maximum(mask, blob)
    alpha = np.clip((mask + (noise-.5)*.6 - .18)*1.7, 0, .94)
    shade = np.clip(229 + (noise-.5)*58, 210, 255)
    cloud = np.stack([shade, shade+(0 if sunset else 5), shade+(0 if sunset else 7)], axis=-1)
    if sunset:
        cloud *= np.array([1, .75, .62])
    sky = sky*(1-alpha[..., None]) + cloud*alpha[..., None]
    image = Image.fromarray(np.uint8(np.clip(sky, 0, 255)))
    draw = ImageDraw.Draw(image)
    if sunset:
        draw.ellipse((598, 1040, 704, 1146), fill=(255, 225, 149))
    else:
        draw.ellipse((636, 344, 684, 392), fill=(255, 249, 220))
    for offset, color in [(0, (81, 131, 151)), (50, (48, 105, 124)), (100, (29, 77, 93))]:
        points = [(0, height)] + [(i, 1330+offset+int(26*math.sin(i/130)+18*math.cos(i/57))) for i in range(0, width+10, 10)] + [(width, height)]
        draw.polygon(points, fill=color)
    return image


DAY = None
DUSK = None


def sky_frame(t, sunset=False):
    image = DUSK if sunset else DAY
    dx, dy = int(20+t*3) % 120, int(40+t*1.2) % 120
    return image.crop((dx, dy, dx+W, dy+H))


def arrow(draw, points, color, width=5):
    draw.line(points, fill=color, width=width)
    (x0, y0), (x, y) = points[-2:]
    a = math.atan2(y-y0, x-x0)
    draw.polygon([(x, y), (x-19*math.cos(a-.45), y-19*math.sin(a-.45)), (x-19*math.cos(a+.45), y-19*math.sin(a+.45))], fill=color)


def wave(draw, start, end, color, wavelength, t, amplitude=10, width=4):
    x0, y0 = start
    x1, y1 = end
    length = math.hypot(x1-x0, y1-y0)
    ux, uy = (x1-x0)/length, (y1-y0)/length
    pts = []
    for s in np.linspace(0, length, int(length/3)+2):
        offset = amplitude*math.sin(2*math.pi*(s/wavelength-t*1.5))
        pts.append((x0+ux*s-uy*offset, y0+uy*s+ux*offset))
    draw.line(pts, fill=color, width=width)
    p = (t*.28) % 1
    px, py = x0+(x1-x0)*p, y0+(y1-y0)*p
    draw.ellipse((px-7, py-7, px+7, py+7), fill=color)


def frame(scene, t):
    global_t = scene*3+t
    if scene in (0, 7, 8):
        im = sky_frame(global_t)
        # Darken only the upper text area; keep recognizable sky/cloud detail.
        overlay = Image.new("RGBA", im.size)
        od = ImageDraw.Draw(overlay)
        for y in range(430):
            od.line((0, y, W, y), fill=(5, 30, 65, max(0, int(155*(1-y/430)))))
        im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    else:
        im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    light = scene in (0, 7, 8)
    color = "white" if light else INK
    text(d, (52, 90), "FIELD NOTES   /   ATMOSPHERE", 22, color)
    text(d, (52, 145), TITLES[scene][0], 48, color, True)
    text(d, (52, 202), TITLES[scene][1], 48, color, True)
    if scene in (0, 7, 8):
        text(d, (52, 1040), "Sunlight. Air. Scattering." if scene < 8 else "Scattering makes blue visible.", 30, "white", True)
        if scene >= 7:
            text(d, (52, 1085), "The atmosphere redirects the light.", 25, "white")
    elif scene == 1:
        d.ellipse((70, 420, 200, 550), fill=(246, 189, 63))
        text(d, (86, 575), "SUN", 25)
        d.ellipse((410, 660, 930, 1180), fill=(191, 219, 239))
        d.ellipse((470, 720, 870, 1120), fill=(50, 129, 174))
        d.polygon([(540, 810), (630, 770), (697, 847), (665, 937), (585, 910)], fill=(125, 167, 117))
        arrow(d, [(217, 525), (450, 740)], (123, 128, 123), 22)
        arrow(d, [(217, 525), (450, 740)], (255, 255, 255), 13)
        p = (t/2) % 1
        d.ellipse((217+233*p-8, 525+215*p-8, 217+233*p+8, 525+215*p+8), fill=(255, 223, 129))
        text(d, (215, 440), "WHITE SUNLIGHT", 25, INK, True)
        text(d, (360, 637), "ATMOSPHERE", 24)
        for i, c in enumerate([(172, 90, 200), BLUE, (89, 173, 118), (239, 202, 66), RED]):
            d.ellipse((83+i*48, 810, 115+i*48, 842), fill=c)
        text(d, (65, 876), "A mixture of colors", 27)
    elif scene in (2, 3):
        text(d, (52, 335), "RAYLEIGH SCATTERING", 26, BLUE, True)
        # Two separated molecular encounters: more outgoing blue arrows than red.
        for y, c, wl in [(555, BLUE, 29), (895, RED, 80)]:
            wave(d, (65, y), (345, y), c, wl, t)
            d.ellipse((343, y-15, 373, y+15), fill=(99, 121, 132))
            wave(d, (380, y), (647, y), c, wl, t)
        for endpoint in [(470, 420), (485, 675), (245, 680), (236, 420)]:
            wave(d, (358, 555), endpoint, BLUE, 29, t, amplitude=5, width=3)
        wave(d, (358, 895), (447, 983), (226, 155, 145), 65, t, amplitude=5, width=2)
        text(d, (55, 722), "BLUE: shorter wavelengths", 28, BLUE, True)
        text(d, (55, 1042), "RED: longer wavelengths", 28, RED, True)
        text(d, (55, 1090), "All colors scatter; blue scatters more.", 25)
    elif scene == 4:
        sky = sky_frame(global_t).resize((620, 520))
        im.paste(sky, (50, 360))
        d = ImageDraw.Draw(im)
        for i, sx in enumerate([115, 240, 400, 590]):
            sy = 442+(i%2)*70
            d.ellipse((sx-5, sy-5, sx+5, sy+5), fill=(255, 255, 255))
            wave(d, (sx, sy), (360, 920), (20, 88, 191), 32, t, amplitude=4, width=3)
        d.ellipse((335, 922, 385, 972), fill=(122, 86, 65))
        d.line((360, 976, 360, 1050), fill=INK, width=14)
        d.line((320, 1030, 360, 990, 400, 1030), fill=INK, width=10)
        text(d, (100, 1080), "Blue light arrives from across the sky.", 27)
    elif scene == 5:
        im.paste(sky_frame(global_t).resize((300, 610)), (50, 380))
        im.paste(sky_frame(global_t, True).resize((300, 610)), (370, 380))
        d = ImageDraw.Draw(im)
        text(d, (64, 326), "DAYTIME", 27, BLUE, True)
        text(d, (380, 326), "SUNSET", 27, RED, True)
        text(d, (52, 1050), "Different paths through the same air.", 28)
    elif scene == 6:
        d.ellipse((-100, 645, 820, 1565), fill=(211, 229, 238))
        d.ellipse((-35, 710, 755, 1500), fill=(70, 144, 172))
        d.ellipse((335, 744, 377, 786), fill=INK)
        d.ellipse((313, 335, 393, 415), fill=(246, 189, 63))
        d.ellipse((10, 658, 60, 708), fill=(241, 140, 66))
        arrow(d, [(353, 435), (353, 722)], (214, 174, 92), 8)
        wave(d, (66, 683), (351, 750), RED, 65, t, amplitude=4, width=8)
        for i in range(4):
            x = 95+i*60
            wave(d, (x, 690+i*14), (x+18, 594+i*8), BLUE, 27, t, amplitude=4, width=3)
        text(d, (390, 490), "Shorter", 27)
        text(d, (390, 525), "daytime path", 27)
        text(d, (55, 885), "Longer sunset path through air", 29, RED, True)
        text(d, (55, 947), "More blue scatters out of the beam.", 27)
        text(d, (55, 991), "Direct sunlight looks warmer.", 27)
    text(d, (52, 1196), "LOCALLY AUTHORED ILLUSTRATION / NOT TO SCALE", 19, color)
    return im


def main():
    global DAY, DUSK
    review = Path(tempfile.mkdtemp(prefix="m5-6f-d-visuals.", dir=ROOT))
    provider_root = ROOT / "MoneyPrinterTurbo/storage/local_videos"
    material_dir = Path(tempfile.mkdtemp(prefix="m5-6fd-", dir=provider_root))
    print(json.dumps({"reviewDirectory": str(review), "materialDirectory": str(material_dir)}), flush=True)
    DAY, DUSK = cloud_sky(), cloud_sky(True)
    entries = []
    thumbnails = []
    for scene in range(8):
        duration = 3
        filename = f"scene-{scene+1:02d}.mp4"
        path = material_dir / filename
        args = ["/opt/homebrew/bin/ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", str(path)]
        with subprocess.Popen(args, stdin=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
            try:
                for n in range(duration*FPS):
                    image = frame(scene, n/FPS)
                    proc.stdin.write(image.tobytes())
                    if n == FPS//2:
                        thumbnails.append((scene*3+.5, image.copy()))
                proc.stdin.close()
                proc.wait(timeout=120)
                if proc.returncode:
                    raise RuntimeError(proc.stderr.read().decode())
            except BaseException:
                proc.kill()
                raise
        entries.append({"relativePath": str(path.relative_to(provider_root)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "durationSec": duration, "scene": scene+1, "startSec": scene*3, "concept": " ".join(TITLES[scene])})
    # Offline review assembly only; does not invoke the provider renderer.
    concat = review / "concat.txt"
    concat.write_text("".join(f"file '{provider_root/e['relativePath']}'\n" for e in entries))
    subprocess.run(["/opt/homebrew/bin/ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "concat", "-safe", "0", "-i", str(concat), "-t", "24", "-c", "copy", "-an", str(review/"visual-preview-24s.mp4")], check=True, timeout=60)
    sheet = Image.new("RGB", (3*300, 3*578), (246, 245, 240))
    sd = ImageDraw.Draw(sheet)
    for i, (timestamp, image) in enumerate(thumbnails):
        x, y = (i%3)*300, (i//3)*578
        sheet.paste(image.resize((288, 512), Image.Resampling.LANCZOS), (x+6, y+44))
        text(sd, (x+8, y+10), f"{timestamp:05.2f}s / scene {i+1}", 21)
    sheet.save(review/"contact-sheet-timestamped.jpg", quality=94)
    script = "Why is the sky blue? Sunlight may look white, but it contains many colors. As sunlight travels through Earth's atmosphere, tiny air molecules scatter shorter blue wavelengths more strongly than longer red wavelengths. That scattered blue light reaches our eyes from across the sky. Near sunset, sunlight takes a longer path through air, leaving warmer colors more noticeable."
    config = {"version": 1, "purpose": "isolated-corrected-m5-test-not-submitted", "authoredIllustration": True, "materialRoot": str(provider_root), "expectedNarrationDurationSec": 24, "materials": entries, "input": {"topic": "Why is the sky blue?", "script": script, "videoTerms": ["sunlight", "atmosphere", "Rayleigh scattering"], "language": "en", "aspectRatio": "9:16", "targetDurationSec": 24, "videoSource": "local", "voiceName": "kokoro:af_heart", "subtitleEnabled": False, "backgroundMusic": ""}}
    (review/"isolated-test-config.json").write_text(json.dumps(config, indent=2)+"\n")
    print(json.dumps({"config": str(review/"isolated-test-config.json"), "clips": len(entries), "durationSec": 25, "previewSec": 24}), flush=True)


if __name__ == "__main__":
    main()
