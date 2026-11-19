"""Reader behavior for every input a phone can hand over: formats, encodings, damage and limits."""
import http.client
import io
import json
import threading
import unittest
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont

from service import extract
from service.extract import MAX_BYTES, MAX_PAGES, UNSUPPORTED, Handler, read_pages
from service.test_imaging import document

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "evaluation/corpus/files"
TOTAL = "Total: $1,250.00"


def encode(image, fmt, **options):
    buffer = io.BytesIO()
    image.save(buffer, fmt, **options)
    return buffer.getvalue()


def text_of(data, mime=""):
    return "\n".join(page["text"] for page in read_pages(data, mime))


class ImageFormatTests(unittest.TestCase):
    base = document()

    def test_common_image_formats_all_read_the_same_total(self):
        cases = {
            "png": encode(self.base, "PNG"),
            "jpeg": encode(self.base, "JPEG", quality=40),
            "webp": encode(self.base, "WEBP"),
            "gif": encode(self.base.convert("P"), "GIF"),
            "bmp": encode(self.base, "BMP"),
            "tiff": encode(self.base, "TIFF"),
            "cmyk jpeg": encode(self.base.convert("CMYK"), "JPEG"),
            "16-bit png": encode(self.base.convert("I;16"), "PNG"),
            "grayscale": encode(self.base.convert("L"), "PNG"),
            "1-bit": encode(self.base.convert("1"), "PNG"),
        }
        for name, data in cases.items():
            with self.subTest(format=name):
                self.assertIn(TOTAL, text_of(data, "image/x"))

    def test_the_mime_type_does_not_decide_the_format(self):
        png = encode(self.base, "PNG")
        for mime in ("", "application/octet-stream", "image/jpeg", "text/x-unknown-but-binary"):
            if mime.startswith("text/"):
                continue
            with self.subTest(mime=mime):
                self.assertIn(TOTAL, text_of(png, mime))

    def test_sideways_and_upside_down_photos_are_read_upright(self):
        for turn in (90, 180, 270):
            with self.subTest(turn=turn):
                rotated = self.base.rotate(turn, expand=True, fillcolor="white")
                self.assertIn(TOTAL, text_of(encode(rotated, "PNG"), "image/png"))

    def test_tilted_photos_are_straightened(self):
        for angle in (-8, -4, 4, 8):
            with self.subTest(angle=angle):
                tilted = self.base.rotate(angle, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)
                self.assertIn(TOTAL, text_of(encode(tilted, "PNG"), "image/png"))

    def test_transparent_screenshots_are_read(self):
        screenshot = Image.new("RGBA", self.base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(screenshot)
        for i, line in enumerate(["Vendor: Summit Steel", "Invoice #: 4471", "Date: 2026-11-04", TOTAL]):
            draw.text((50, 40 + i * 65), line, fill=(0, 0, 0, 255), font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34))
        self.assertIn(TOTAL, text_of(encode(screenshot, "PNG"), "image/png"))

    def test_light_text_on_dark_background(self):
        self.assertIn(TOTAL, text_of(encode(document(ink="white", paper="black"), "PNG"), "image/png"))

    def test_thumbnail_sized_images_are_enlarged_before_reading(self):
        # At this size Tesseract reads garbage unless the page is enlarged first.
        for width in (240, 260, 280, 300):
            with self.subTest(width=width):
                small = self.base.resize((width, round(width * self.base.height / self.base.width)), Image.Resampling.LANCZOS)
                text = text_of(encode(small, "PNG"), "image/png")
                self.assertIn(TOTAL, text)
                self.assertIn("4471", text)

    def test_every_frame_of_a_multipage_scan_is_read(self):
        second = document()
        ImageDraw.Draw(second).text((50, 400), "Tax: $0.00", fill="black", font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34))
        pages = read_pages(encode(self.base, "TIFF", save_all=True, append_images=[second]), "image/tiff")
        self.assertEqual(len(pages), 2)
        self.assertTrue(all(page["method"] == "OCR" for page in pages))
        self.assertIn(TOTAL, pages[0]["text"])

    def test_frame_count_is_limited(self):
        frames = [self.base.resize((300, 120))] * (MAX_PAGES + 1)
        data = encode(frames[0], "TIFF", save_all=True, append_images=frames[1:])
        with self.assertRaisesRegex(ValueError, f"up to {MAX_PAGES} pages"):
            read_pages(data, "image/tiff")

    def test_blank_pages_in_a_scan_do_not_hide_the_readable_ones(self):
        blank = Image.new("RGB", self.base.size, "white")
        pages = read_pages(encode(blank, "TIFF", save_all=True, append_images=[self.base]), "image/tiff")
        self.assertEqual(pages[0]["text"], "")
        self.assertIn(TOTAL, pages[1]["text"])

    def test_pixel_budget_applies_to_photos(self):
        with self.assertRaisesRegex(ValueError, "24 megapixels"):
            read_pages(encode(Image.new("L", (6000, 4001)), "PNG"), "image/png")

    def test_decompression_bombs_are_refused_with_a_clear_message(self):
        data = encode(Image.new("L", (3000, 3000)), "PNG")
        with patch.object(Image, "MAX_IMAGE_PIXELS", 1000):
            with self.assertRaisesRegex(ValueError, "24 megapixels"):
                read_pages(data, "image/png")

    def test_a_blank_image_says_so(self):
        with self.assertRaisesRegex(ValueError, "No readable text"):
            read_pages(encode(Image.new("RGB", (400, 300), "white"), "PNG"), "image/png")

    def test_truncated_images_are_rejected_clearly_not_crashed(self):
        data = encode(self.base, "PNG")
        with self.assertRaises(ValueError):
            read_pages(data[: len(data) // 3], "image/png")


class TextTests(unittest.TestCase):
    def test_text_encodings(self):
        sample = "Vendor: Café Muñoz\nTotal: $5.00"
        cases = {
            "utf-8": sample.encode("utf-8"),
            "utf-8 with bom": b"\xef\xbb\xbf" + sample.encode("utf-8"),
            "cp1252": sample.encode("cp1252"),
            "utf-16": sample.encode("utf-16"),
            "utf-16-le": b"\xff\xfe" + sample.encode("utf-16-le"),
            "utf-16-be": b"\xfe\xff" + sample.encode("utf-16-be"),
            "utf-32": sample.encode("utf-32"),
        }
        for name, data in cases.items():
            for mime in ("text/plain", "", "application/octet-stream"):
                with self.subTest(encoding=name, mime=mime):
                    pages = read_pages(data, mime)
                    self.assertEqual(pages[0]["method"], "Text")
                    self.assertIn("Café Muñoz", pages[0]["text"])
                    self.assertIn("Total: $5.00", pages[0]["text"])

    def test_line_endings_survive(self):
        for newline in ("\n", "\r\n", "\r"):
            with self.subTest(newline=repr(newline)):
                self.assertEqual(read_pages(f"A: 1{newline}B: 2".encode(), "text/plain")[0]["text"], f"A: 1{newline}B: 2")

    def test_binary_data_is_never_treated_as_text(self):
        for data in (bytes(range(256)) * 4, b"\x00\x01\x02" * 100, b"\x89PNG\r\n\x1a\n" + bytes(range(256))):
            for mime in ("", "application/octet-stream", "text/plain"):
                with self.subTest(mime=mime, head=data[:4]):
                    with self.assertRaisesRegex(ValueError, "Unsupported|Choose|readable|PNG|image"):
                        read_pages(data, mime)

    def test_heic_photos_get_actionable_advice(self):
        header = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64
        with self.assertRaisesRegex(ValueError, "HEIC.*JPEG or PNG"):
            read_pages(header, "image/heic")

    def test_empty_and_oversize_input(self):
        for data in (b"", None):
            with self.assertRaisesRegex(ValueError, "12 MB"):
                read_pages(data, "text/plain")
        with self.assertRaisesRegex(ValueError, "12 MB"):
            read_pages(b"x" * (MAX_BYTES + 1), "image/png")
        with self.assertRaisesRegex(ValueError, "readable"):
            read_pages(b" \n\t ", "text/plain")


class PdfTests(unittest.TestCase):
    def pdf(self, name):
        return (CORPUS / name).read_bytes()

    def test_text_layer_is_read_without_ocr(self):
        pages = read_pages(self.pdf("inv-clean.pdf"), "application/pdf")
        self.assertEqual([p["method"] for p in pages], ["PDF text"])
        self.assertIn(TOTAL, pages[0]["text"])

    def test_page_order_and_count_are_preserved(self):
        pages = read_pages(self.pdf("inv-two-page.pdf"), "application/pdf")
        self.assertEqual(len(pages), 2)
        self.assertIn("Continued", pages[1]["text"])

    def test_the_header_decides_not_the_mime_type(self):
        data = self.pdf("inv-clean.pdf")
        for mime in ("", "text/plain", "image/png", "application/octet-stream"):
            with self.subTest(mime=mime):
                self.assertIn(TOTAL, text_of(data, mime))

    def test_leading_junk_before_the_header_is_tolerated(self):
        self.assertIn(TOTAL, text_of(b"\r\n \n" + self.pdf("inv-clean.pdf"), "application/pdf"))

    def test_a_logo_on_a_digital_pdf_adds_no_competing_totals(self):
        page, = read_pages(self.pdf("inv-logo.pdf"), "application/pdf")
        totals = [(line, method) for line, method in zip(page["text"].splitlines(), page.get("lineMethods") or [page["method"]] * 99)
                  if "total" in line.lower()]
        self.assertEqual(totals, [(TOTAL, totals[0][1])])
        self.assertEqual(totals[0][1], "PDF text")

    def test_scanned_pdf_pages_are_read_by_ocr(self):
        buffer = io.BytesIO()
        document().save(buffer, "PDF", resolution=150)
        page, = read_pages(buffer.getvalue(), "application/pdf")
        self.assertEqual(page["method"], "OCR")
        self.assertIn(TOTAL, page["text"])

    def test_scanned_pdf_pages_may_be_sideways(self):
        buffer = io.BytesIO()
        document().rotate(90, expand=True, fillcolor="white").save(buffer, "PDF", resolution=150)
        self.assertIn(TOTAL, text_of(buffer.getvalue(), "application/pdf"))

    def test_text_and_scanned_content_on_one_page_are_both_kept_with_provenance(self):
        page, = read_pages(self.pdf("co-mixed-correct.pdf"), "application/pdf")
        lines = dict(zip(page["text"].splitlines(), page["lineMethods"], strict=True))
        self.assertEqual(lines["Prior contract: $42,000.00"], "PDF text")
        self.assertEqual(lines["Revised contract: $41,500.00"], "OCR")

    def test_damaged_pdfs_fail_with_a_plain_message(self):
        good = self.pdf("inv-clean.pdf")
        for name, data in {"truncated": good[: len(good) // 2], "garbage body": b"%PDF-1.4\nnot really a pdf", "header only": b"%PDF-"}.items():
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "could not be opened"):
                    read_pages(data, "application/pdf")

    def test_password_protected_pdfs_say_so(self):
        error = pdfium.PdfiumError("Failed to load document (PDFium: Incorrect password error)")
        with patch("service.extract.pdfium.PdfDocument", side_effect=error):
            with self.assertRaisesRegex(ValueError, "password protected"):
                read_pages(self.pdf("inv-clean.pdf"), "application/pdf")

    def test_pdf_without_pages(self):
        with pdfium.PdfDocument.new() as pdf:
            buffer = io.BytesIO()
            pdf.save(buffer)
        with self.assertRaises(ValueError):
            read_pages(buffer.getvalue(), "application/pdf")

    def test_page_limit_applies_before_any_ocr(self):
        with pdfium.PdfDocument.new() as pdf:
            for _ in range(MAX_PAGES + 1):
                pdf.new_page(30, 30)
            buffer = io.BytesIO()
            pdf.save(buffer)
        with patch("service.extract.ocr", side_effect=AssertionError("OCR ran")):
            with self.assertRaisesRegex(ValueError, f"up to {MAX_PAGES} pages"):
                read_pages(buffer.getvalue(), "application/pdf")

    def test_a_pdf_of_blank_pages_has_no_readable_text(self):
        with pdfium.PdfDocument.new() as pdf:
            pdf.new_page(300, 300)
            buffer = io.BytesIO()
            pdf.save(buffer)
        with self.assertRaisesRegex(ValueError, "No readable text"):
            read_pages(buffer.getvalue(), "application/pdf")


class OcrFailureTests(unittest.TestCase):
    def test_a_missing_tesseract_is_explained(self):
        with patch("service.extract.subprocess.run", side_effect=FileNotFoundError("tesseract")):
            with self.assertRaisesRegex(ValueError, "OCR could not finish"):
                read_pages(encode(document(), "PNG"), "image/png")

    def test_a_hung_tesseract_is_explained(self):
        import subprocess
        with patch("service.extract.subprocess.run", side_effect=subprocess.TimeoutExpired("tesseract", 25)):
            with self.assertRaisesRegex(ValueError, "OCR could not finish"):
                read_pages(encode(document(), "PNG"), "image/png")


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, path="/extract", body=b"", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        connection.request("POST", path, body=body, headers=headers or {"Content-Type": "text/plain"})
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, response.headers, data

    def test_a_valid_document_returns_pages_as_json(self):
        status, headers, body = self.post(body=b"Total: $5.00\n")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(json.loads(body)["pages"][0]["text"], "Total: $5.00\n")

    def test_images_and_pdfs_go_through_the_same_endpoint(self):
        status, _, body = self.post(body=(CORPUS / "inv-clean.pdf").read_bytes(), headers={"Content-Type": "application/pdf"})
        self.assertEqual(status, 200)
        self.assertIn(TOTAL, json.loads(body)["pages"][0]["text"])
        status, _, body = self.post(body=encode(document(), "PNG"), headers={"Content-Type": "image/png"})
        self.assertEqual(status, 200)
        self.assertIn(TOTAL, json.loads(body)["pages"][0]["text"])

    def test_unknown_paths_are_not_found(self):
        self.assertEqual(self.post(path="/other", body=b"x")[0], 404)

    def test_bad_requests_get_a_json_error_not_a_dropped_connection(self):
        for name, body, headers, message in [
            ("empty", b"", {"Content-Type": "text/plain"}, "12 MB"),
            ("junk length", b"x", {"Content-Type": "text/plain", "Content-Length": "abc"}, ""),
            ("binary", bytes(range(256)), {"Content-Type": "application/octet-stream"}, "Unsupported"),
            ("damaged pdf", b"%PDF-1.4\nbroken", {"Content-Type": "application/pdf"}, "could not be opened"),
        ]:
            with self.subTest(name=name):
                status, _, data = self.post(body=body, headers=headers)
                self.assertEqual(status, 422)
                self.assertIn(message, json.loads(data)["error"])

    def test_oversized_uploads_are_refused_by_declared_size(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        connection.putrequest("POST", "/extract")
        connection.putheader("Content-Length", str(MAX_BYTES + 1))
        connection.putheader("Content-Type", "text/plain")
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual(response.status, 422)
        self.assertIn("12 MB", json.loads(response.read())["error"])
        connection.close()

    def test_unexpected_failures_become_a_500_with_a_message(self):
        with patch.object(extract, "read_pages", side_effect=RuntimeError("boom")):
            with patch("sys.stderr", new_callable=io.StringIO):
                status, _, data = self.post(body=b"Total: $5")
        self.assertEqual(status, 500)
        self.assertIn("failed unexpectedly", json.loads(data)["error"])

    def test_the_server_only_listens_on_loopback(self):
        source = Path(extract.__file__).read_text()
        self.assertIn('HTTPServer(("127.0.0.1", 8791)', source)


class CorpusReadabilityTests(unittest.TestCase):
    def test_every_corpus_file_is_readable_or_cleanly_refused(self):
        for path in sorted(CORPUS.iterdir()):
            with self.subTest(file=path.name):
                try:
                    pages = read_pages(path.read_bytes(), "")
                except ValueError as error:
                    self.fail(f"{path.name}: {error}")
                self.assertTrue(any(page["text"].strip() for page in pages))


if __name__ == "__main__":
    unittest.main()
