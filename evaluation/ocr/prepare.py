"""Run from project root. Export identical RGB pixels for the Android harness."""
from pathlib import Path
import json
import sys
from PIL import Image
from service.extract import ocr

def prepare(raw_dir):
    base = Path(__file__).resolve().parent
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest, results = [], {}
    for path in sorted((base / "scans").glob("*.jpg")):
        with Image.open(path) as source:
            image = source.convert("RGB")
            (raw_dir / (path.stem + ".rgb")).write_bytes(image.tobytes())
            manifest.append(dict(id=path.stem, width=image.width, height=image.height))
            results[path.stem] = ocr(image)
    (raw_dir / "images.json").write_text(json.dumps(manifest))
    (base / "results/tesseract.json").write_text(json.dumps(results, indent=2) + "\n")

if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
