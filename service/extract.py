"""Local, loopback-only document reader for the Android demo."""
import codecs
import io
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import pypdfium2 as pdfium
from PIL import Image, ImageSequence

from service.imaging import prepare

MAX_BYTES = 12 * 1024 * 1024
MAX_PAGES = 12
UNSUPPORTED = "Unsupported file. Use a PDF, JPEG, PNG, TIFF, WebP or text file."
BOMS = [(codecs.BOM_UTF8, "utf-8-sig"), (codecs.BOM_UTF32_LE, "utf-32"), (codecs.BOM_UTF32_BE, "utf-32"),
        (codecs.BOM_UTF16_LE, "utf-16"), (codecs.BOM_UTF16_BE, "utf-16")]


def ocr(image):
    """Prepare one picture and read it with Tesseract."""
    output = io.BytesIO()
    prepare(image).save(output, "PNG")
    try:
        result = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "6"],
                                input=output.getvalue(), capture_output=True, check=True, timeout=25)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError("OCR could not finish. Check Tesseract or try a clearer image.") from exc
    return result.stdout.decode(errors="replace").strip()


def decode_text(data):
    """Decode Unicode with a BOM, UTF-8, or legacy Windows text; refuse binary data."""
    for bom, codec in BOMS:
        if data.startswith(bom):
            return data.decode(codec)
    if b"\x00" in data:
        raise ValueError(UNSUPPORTED)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
        if sum(c in "�" or (c < " " and c not in "\t\r\n\f") for c in text) > len(text) * 0.05:
            raise ValueError(UNSUPPORTED) from None
        return text


def pdf_start(data):
    """PDF readers accept up to 1 KiB of leading junk before the header."""
    return data.find(b"%PDF-", 0, 1024)


def read_pdf(data):
    pages = []
    try:
        pdf = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        if "password" in str(exc).lower():
            raise ValueError("This PDF is password protected. Export an unlocked copy and try again.") from exc
        raise ValueError("This PDF could not be opened. It may be damaged, so export or scan it again.") from exc
    with pdf:
        if not len(pdf):
            raise ValueError("This PDF has no pages.")
        if len(pdf) > MAX_PAGES:
            raise ValueError(f"Choose a PDF with up to {MAX_PAGES} pages.")
        for page in pdf:
            text = page.get_textpage().get_text_range().strip()
            method = "PDF text"
            sparse = sum(c.isalnum() for c in text) < 20
            has_image = any(page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]))
            if sparse or has_image:
                width, height = page.get_size()
                scale = min(2.5, 3200 / max(width, height))
                scanned = ocr(page.render(scale=scale).to_pil())
                if not text:
                    text, method = scanned, "OCR"
                elif scanned:
                    # Preserve selectable text and all differing OCR readings on this page.
                    native = text.splitlines()
                    known = {" ".join(line.split()).casefold() for line in native}
                    extra = [line for line in scanned.splitlines()
                             if line.strip() and " ".join(line.split()).casefold() not in known]
                    if extra:
                        pages.append({"text": "\n".join(native + extra), "method": "PDF text + OCR",
                                      "lineMethods": ["PDF text"] * len(native) + ["OCR"] * len(extra)})
                        continue
            pages.append({"text": text, "method": method})
    return pages


def read_image(data):
    try:
        image = Image.open(io.BytesIO(data))
    except OSError:
        return None
    with image:
        if getattr(image, "n_frames", 1) > MAX_PAGES:
            raise ValueError(f"Choose an image with up to {MAX_PAGES} pages.")
        try:
            return [{"text": ocr(frame.copy()), "method": "OCR"} for frame in ImageSequence.Iterator(image)]
        except (OSError, SyntaxError, EOFError) as exc:
            # Pillow raises these from a cut-off download or a corrupt chunk while decoding.
            raise ValueError("This image is damaged or incomplete. Take or export it again.") from exc


def read_pages(data, mime=""):
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Choose a nonempty file under 12 MB.")
    mime = (mime or "").lower()
    start = pdf_start(data)
    if start >= 0:
        pages = read_pdf(data[start:])
    elif mime.startswith("text/"):
        pages = [{"text": decode_text(data), "method": "Text"}]
    else:
        try:
            pages = read_image(data)
        except Image.DecompressionBombError as exc:
            raise ValueError("Use an image smaller than 24 megapixels.") from exc
        if pages is None:
            if data[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftypheif"):
                raise ValueError("HEIC photos are not supported. Share the photo as JPEG or PNG.")
            pages = [{"text": decode_text(data), "method": "Text"}]
    if not any(p["text"].strip() for p in pages):
        raise ValueError("No readable text. Try a sharper scan.")
    return pages


class Handler(BaseHTTPRequestHandler):
    timeout = 60

    def do_POST(self):
        if self.path != "/extract":
            return self.send_error(404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BYTES:
                raise ValueError("Choose a nonempty file under 12 MB.")
            result = {"pages": read_pages(self.rfile.read(size), self.headers.get_content_type())}
            status = 200
        except (ValueError, OSError, pdfium.PdfiumError, Image.DecompressionBombError) as exc:
            result, status = {"error": str(exc)}, 422
        except Exception as exc:  # noqa: BLE001 - never leave the client without an answer
            print("reader failure:", repr(exc), file=sys.stderr)
            result, status = {"error": "The reader failed unexpectedly. Try another copy of the file."}, 500
        body = json.dumps(result).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8791), Handler).serve_forever()
