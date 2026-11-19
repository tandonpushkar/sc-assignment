"""Image preparation ahead of OCR: flatten, normalize, orient, deskew and upscale."""
import re
import subprocess

from PIL import Image, ImageOps, ImageStat

MAX_PIXELS = 24_000_000
# Tesseract reads text lines best around 20 px tall. Measured on the labeled scans, 10 px
# lines still read correctly, while 7 px lines collapse without enlargement.
MIN_TEXT_HEIGHT = 9
TARGET_TEXT_HEIGHT = 18
MAX_UPSCALE = 3.0
MAX_SKEW_DEGREES = 12.0
MIN_SKEW_DEGREES = 0.4


def flatten(image):
    """Return an 8-bit grayscale copy with transparency composited onto white."""
    image = ImageOps.exif_transpose(image)
    if image.mode in ("I;16", "I;16L", "I;16B", "I"):
        low, high = image.convert("I").getextrema()
        span = max(high - low, 1)
        image = image.convert("I").point(lambda v: (v - low) * 255 / span + 0.5).convert("L")
    elif image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        page = Image.new("RGBA", rgba.size, "white")
        page.alpha_composite(rgba)
        image = page
    return ImageOps.grayscale(image.convert("RGB") if image.mode in ("CMYK", "YCbCr", "LAB", "HSV", "P", "RGBA") else image)


def light_on_dark(gray):
    return ImageStat.Stat(gray.resize((64, 64))).mean[0] < 100


def text_height(gray):
    """Median height in pixels of the ink bands (text lines) on the page, or 0 when none."""
    mean = ImageStat.Stat(gray).mean[0]
    ink = gray.point(lambda v: 255 if v < mean * 0.75 else 0)
    rows = ink.resize((1, ink.height), Image.Resampling.BOX).tobytes()
    limit = max(rows) * 0.08
    bands, run = [], 0
    for value in rows:
        if value > limit:
            run += 1
        elif run:
            bands.append(run)
            run = 0
    if run:
        bands.append(run)
    bands = sorted(b for b in bands if b >= 3)
    return bands[len(bands) // 2] if bands else 0


def upscale(gray):
    """Enlarge only when text is too small for Tesseract; larger text reads worse when scaled up."""
    height = text_height(gray)
    if not height or height >= MIN_TEXT_HEIGHT:
        return gray
    factor = min(MAX_UPSCALE, TARGET_TEXT_HEIGHT / height)
    size = (round(gray.width * factor), round(gray.height * factor))
    return gray.resize(size, Image.Resampling.LANCZOS)


def orientation_degrees(gray):
    """Clockwise rotation Tesseract's orientation detector says would make text upright."""
    data = ImageOps.autocontrast(gray)
    scratch = data.copy()
    scratch.thumbnail((1600, 1600))
    from io import BytesIO
    png = BytesIO()
    scratch.save(png, "PNG")
    try:
        done = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "0"], input=png.getvalue(),
                              capture_output=True, timeout=25)
    except (OSError, subprocess.SubprocessError):
        return 0
    text = done.stdout.decode(errors="replace") + done.stderr.decode(errors="replace")
    rotate = re.search(r"Rotate:\s*(\d+)", text)
    confidence = re.search(r"Orientation confidence:\s*([\d.]+)", text)
    if not rotate or not confidence or float(confidence.group(1)) < 1.5:
        return 0
    return int(rotate.group(1)) % 360


def orient(gray):
    degrees = orientation_degrees(gray)
    return gray.rotate(-degrees, expand=True, fillcolor=255) if degrees else gray


def skew_degrees(gray):
    """Estimate small page tilt by maximizing the row-wise contrast of ink pixels."""
    small = gray.copy()
    small.thumbnail((640, 640))
    mean = ImageStat.Stat(small).mean[0]
    ink = small.point(lambda v: 255 if v < mean * 0.75 else 0)
    if ImageStat.Stat(ink).mean[0] < 1:
        return 0.0

    def sharpness(angle):
        tilted = ink.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=0)
        return ImageStat.Stat(tilted.resize((1, tilted.height), Image.Resampling.BOX)).var[0]

    coarse = [x / 2 for x in range(int(-2 * MAX_SKEW_DEGREES), int(2 * MAX_SKEW_DEGREES) + 1)]
    best = max(coarse, key=sharpness)
    best = max((best + x / 10 for x in range(-5, 6)), key=sharpness)
    if abs(best) < MIN_SKEW_DEGREES or sharpness(best) < sharpness(0.0) * 1.05:
        return 0.0
    return best


def prepare(image):
    """Everything needed so one PNG can go straight to Tesseract."""
    if image.width * image.height > MAX_PIXELS:
        raise ValueError("Use an image smaller than 24 megapixels.")
    gray = flatten(image)
    if light_on_dark(gray):
        gray = ImageOps.invert(gray)
    gray = upscale(orient(gray))
    angle = skew_degrees(gray)
    if angle:
        gray = gray.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=255)
    return gray
