import io
from pathlib import Path
import unittest
from PIL import Image
from service.extract import read_pages

FIX = Path(__file__).resolve().parents[1] / "fixtures"


class ExtractionTests(unittest.TestCase):
    def test_pdf_text(self):
        pages = read_pages((FIX / "site-invoice.pdf").read_bytes(), "application/pdf")
        self.assertEqual(pages[0]["method"], "PDF text")
        self.assertIn("$1,250.00", pages[0]["text"])

    def test_photo_and_scan_pdf(self):
        jpeg = (FIX / "accounts-scan.jpg").read_bytes()
        with Image.open(io.BytesIO(jpeg)) as image:
            pdf = io.BytesIO()
            image.save(pdf, "PDF", resolution=150)
        for data, mime in [(jpeg, "image/jpeg"), (pdf.getvalue(), "application/pdf")]:
            with self.subTest(mime=mime):
                page = read_pages(data, mime)[0]
                self.assertEqual(page["method"], "OCR")
                self.assertIn("1,205.00", page["text"])

    def test_blank_input(self):
        with self.assertRaises(ValueError):
            read_pages(b"  ", "text/plain")

    def test_utf8_text(self):
        pages = read_pages((FIX / "fuel-receipt.txt").read_bytes(), "text/plain")
        self.assertIn("Haulway Fuel", pages[0]["text"])

    def test_unreadable_scan(self):
        blank = io.BytesIO()
        Image.new("RGB", (300, 300), "white").save(blank, "PNG")
        with self.assertRaisesRegex(ValueError, "No readable text"):
            read_pages(blank.getvalue(), "image/png")

    def test_malformed_pdf(self):
        with self.assertRaisesRegex(ValueError, "could not be opened"):
            read_pages(b"%PDF-failed", "application/pdf")

    def test_utf8_bom_and_windows_lines(self):
        self.assertEqual(read_pages(b"\xef\xbb\xbfTax: 0\r\n", "text/plain")[0]["text"], "Tax: 0\r\n")

    def test_oversize_rejected_before_decoding(self):
        from service.extract import MAX_BYTES
        with self.assertRaisesRegex(ValueError, "12 MB"):
            read_pages(b"x" * (MAX_BYTES + 1), "text/plain")

    def test_page_limit_before_ocr(self):
        import pypdfium2 as pdfium
        with pdfium.PdfDocument.new() as pdf:
            for _ in range(13):
                pdf.new_page(30, 30)
            buffer = io.BytesIO()
            pdf.save(buffer)
        with self.assertRaisesRegex(ValueError, "12 pages"):
            read_pages(buffer.getvalue(), "application/pdf")

    def test_mixed_page_keeps_digital_and_scanned_amounts(self):
        data = (FIX.parent / "evaluation/ocr/mixed-contract.pdf").read_bytes()
        page, = read_pages(data, "application/pdf")
        lines = list(zip(page["text"].splitlines(), page["lineMethods"], strict=True))
        self.assertIn(("Prior contract: $42,000.00", "PDF text"), lines)
        self.assertIn(("Revised contract: $42,500.00", "OCR"), lines)

    def test_disagreement_between_pdf_text_and_ocr_is_retained(self):
        from unittest.mock import patch
        data = (FIX.parent / "evaluation/ocr/mixed-contract.pdf").read_bytes()
        with patch("service.extract.ocr", return_value="Prior contract: $12,000.00"):
            page, = read_pages(data, "application/pdf")
        self.assertIn("Prior contract: $42,000.00", page["text"])
        self.assertIn("Prior contract: $12,000.00", page["text"])
