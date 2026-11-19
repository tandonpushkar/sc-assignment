"""Regenerate the end-to-end corpus from first principles. Run from the project root:

    .venv/bin/python -m evaluation.corpus.build

Every document is rendered from the plain lines below, so the expected flags in labels.json can be
checked against what a person sees on the page. Output is deterministic (fixed seeds, no timestamps).
"""
import io
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "files"
FONTS = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
MONO = ["/System/Library/Fonts/Monaco.ttf", "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]


def font(size, paths=FONTS):
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------- raster documents
def page_image(lines, size=34, width=1100, mono=False, ink="black", paper="white", spacing=1.9, transparent=False):
    height = int(80 + len(lines) * size * spacing)
    img = Image.new("RGBA" if transparent else "RGB", (width, height), (0, 0, 0, 0) if transparent else paper)
    draw = ImageDraw.Draw(img)
    f = font(size, MONO if mono else FONTS)
    for i, text in enumerate(lines):
        draw.text((50, 40 + i * size * spacing), text, fill=ink, font=f)
    return img


def photo(img, rotate=0.0, blur=0.0, dim=1.0, noise=0.0, seed=1):
    """Imitate a phone photo: tilt, softness, poor lighting and sensor noise."""
    if rotate:
        img = img.rotate(rotate, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    if dim != 1.0:
        img = img.point(lambda v: int(v * dim + 30 * (1 - dim)))
    if noise:
        grain = Image.frombytes("L", img.size, random.Random(seed).randbytes(img.width * img.height))
        img = Image.blend(img, grain.convert(img.mode), noise)
    return img


def save_jpeg(img, name, quality=82):
    img.convert("RGB").save(OUT / name, "JPEG", quality=quality)


# ---------------------------------------------------------------- PDF writer (no dependencies)
def esc(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages, size=(612, 792)):
    """pages: list of {"lines": [text...], "images": [(PIL image, x, y, w, h)]}. Real text layer in Helvetica."""
    objects = [b"", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    kids = []

    def add(body):
        objects.append(body)
        return len(objects)

    for page in pages:
        refs = {}
        for n, (img, *_rest) in enumerate(page.get("images", []), 1):
            data = io.BytesIO()
            img.convert("RGB").save(data, "JPEG", quality=90)
            body = (f"<< /Type /XObject /Subtype /Image /Width {img.width} /Height {img.height} /ColorSpace /DeviceRGB "
                    f"/BitsPerComponent 8 /Filter /DCTDecode /Length {len(data.getvalue())} >>\nstream\n").encode()
            refs[f"Im{n}"] = add(body + data.getvalue() + b"\nendstream")
        ops = []
        y = size[1] - 70
        for text in page.get("lines", []):
            ops.append(f"BT /F1 12 Tf 54 {y} Td ({esc(text)}) Tj ET")
            y -= 22
        for n, (_img, x, iy, w, h) in enumerate(page.get("images", []), 1):
            ops.append(f"q {w} 0 0 {h} {x} {iy} cm /Im{n} Do Q")
        stream = "\n".join(ops).encode("cp1252")
        content = add(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
        xobjects = " ".join(f"/{k} {v} 0 R" for k, v in refs.items())
        kids.append(add((f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {size[0]} {size[1]}] /Contents {content} 0 R "
                         f"/Resources << /Font << /F1 3 0 R >> /XObject << {xobjects} >> >> >>").encode()))
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def write_pdf(name, pages):
    (OUT / name).write_bytes(make_pdf(pages))


# ---------------------------------------------------------------- document texts
def invoice(number="INV-4471", total="$1,250.00", po="PO-221", date="2026-11-04", vendor="Summit Steel Supply", extra=()):
    lines = ["SUMMIT STEEL SUPPLY - TAX INVOICE", f"Vendor: {vendor}", f"Invoice #: {number}", f"Date: {date}"]
    if po:
        lines.append(f"PO #: {po}")
    lines += list(extra) + [f"Total: {total}"]
    return lines


def purchase_order(qty="25 tons", total="$1,250.00"):
    return ["NORTH QUARRY SUPPLY - PURCHASE ORDER", "Supplier: North Quarry Supply", "PO #: PO-221",
            "Order date: 2026-11-04", "Item: Graded aggregate", f"Quantity: {qty}", f"Order total: {total}"]


def receipt(tax="Tax: $1.20", total="$16.20", merchant="Haulway Fuel", date="2026-11-09"):
    lines = [merchant.upper(), f"Merchant: {merchant}", f"Date: {date}", "Subtotal: $15.00"]
    if tax:
        lines.append(tax)
    return lines + [f"Total: {total}"]


def change_order(prior="$250,000.00", change="Net change: -$12,500.00", revised="$237,500.00", number="CO-014"):
    lines = ["WEST YARD - CHANGE ORDER", f"Change order #: {number}", f"Prior contract: {prior}"]
    if change:
        lines.append(change)
    return lines + [f"Revised contract: {revised}"]


# ---------------------------------------------------------------- corpus
def build():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        old.unlink()
    records = []

    def record(id, kind, files, flags=None, values=None, title=None, tolerant=False):
        """tolerant: hard input where success means either every value is right or the record is flagged."""
        expect = {"flags": flags or {}, "values": values or {}}
        if tolerant:
            expect["tolerant"] = True
        records.append({"id": id, "title": title or id, "kind": kind, "files": files, "expect": expect})

    # --- invoices
    write_pdf("inv-clean.pdf", [{"lines": invoice()}])
    record("inv-clean-pdf", "Invoice", ["inv-clean.pdf"],
           values={"Total (USD)": "1250.00", "Invoice number": "inv4471", "Date": "2026-11-04"})

    write_pdf("inv-two-page.pdf", [{"lines": invoice()[:4]}, {"lines": ["Continued", "PO #: PO-221", "Total: $1,250.00"]}])
    record("inv-multipage-pdf", "Invoice", ["inv-two-page.pdf"], values={"Total (USD)": "1250.00"})

    write_pdf("inv-agree.pdf", [{"lines": invoice()}])
    save_jpeg(photo(page_image(invoice()), rotate=2.5, blur=0.6, dim=0.9, seed=2), "inv-agree-photo.jpg")
    record("inv-pdf-and-photo-agree", "Invoice", ["inv-agree.pdf", "inv-agree-photo.jpg"],
           values={"Total (USD)": "1250.00"})

    write_pdf("inv-conflict.pdf", [{"lines": invoice()}])
    save_jpeg(photo(page_image(invoice(total="$1,205.00")), rotate=-1.5, seed=3), "inv-conflict-scan.jpg")
    record("inv-pdf-and-scan-disagree", "Invoice", ["inv-conflict.pdf", "inv-conflict-scan.jpg"],
           flags={"Total (USD)": "Conflict"})

    # The unpaid balance is printed after the invoice total on purpose.
    write_pdf("inv-partial.pdf", [{"lines": invoice(total="$1,500.00", extra=["Amount due: $500.00"])}])
    record("inv-partial-payment", "Invoice", ["inv-partial.pdf"], values={"Total (USD)": "1500.00"})

    write_pdf("inv-no-po.pdf", [{"lines": invoice(po=None)}])
    record("inv-missing-po", "Invoice", ["inv-no-po.pdf"], flags={"Purchase order": "Missing"})

    write_pdf("inv-slash-date.pdf", [{"lines": invoice(date="04/11/2026")}])
    record("inv-ambiguous-date", "Invoice", ["inv-slash-date.pdf"], flags={"Date": "Check format"})

    write_pdf("inv-long-date.pdf", [{"lines": invoice(date="Nov 4, 2026")}])
    record("inv-written-date", "Invoice", ["inv-long-date.pdf"], values={"Date": "2026-11-04"})

    save_jpeg(page_image(invoice(), ink="white", paper="black"), "inv-dark.jpg", quality=92)
    record("inv-dark-mode-screenshot", "Invoice", ["inv-dark.jpg"], values={"Total (USD)": "1250.00"})

    logo = Image.new("RGB", (300, 80), (230, 120, 20))
    ImageDraw.Draw(logo).text((14, 22), "SUMMIT STEEL", fill="white", font=font(32))
    write_pdf("inv-logo.pdf", [{"lines": invoice(), "images": [(logo, 300, 640, 150, 40)]}])
    record("inv-digital-with-logo", "Invoice", ["inv-logo.pdf"], values={"Total (USD)": "1250.00"})

    save_jpeg(photo(page_image(invoice()), rotate=0, seed=4).transpose(Image.Transpose.ROTATE_90), "inv-sideways.jpg")
    record("inv-sideways-photo", "Invoice", ["inv-sideways.jpg"], values={"Total (USD)": "1250.00"})

    # --- purchase orders
    write_pdf("po-clean.pdf", [{"lines": purchase_order()}])
    record("po-clean-pdf", "Purchase order", ["po-clean.pdf"],
           values={"Total (USD)": "1250.00", "Purchase order": "po221"})

    (OUT / "po-yard.txt").write_text("\n".join(purchase_order()) + "\n")
    (OUT / "po-office.txt").write_text("\n".join(purchase_order(qty="52 tons")) + "\n")
    record("po-quantity-conflict", "Purchase order", ["po-yard.txt", "po-office.txt"], flags={"Quantity": "Conflict"})

    save_jpeg(photo(page_image(purchase_order()).rotate(90, expand=True, fillcolor="white"), seed=5), "po-rotated.jpg")
    record("po-rotated-scan", "Purchase order", ["po-rotated.jpg"], values={"Total (USD)": "1250.00"})

    # --- receipts
    save_jpeg(photo(page_image(receipt(), size=36), rotate=3, blur=0.5, dim=0.85, noise=0.08, seed=6), "rcpt-photo.jpg")
    record("receipt-skewed-photo", "Receipt", ["rcpt-photo.jpg"], values={"Total (USD)": "16.20", "Tax (USD)": "1.20"})

    (OUT / "rcpt-no-tax.txt").write_text("\n".join(receipt(tax=None)) + "\n")
    record("receipt-missing-tax", "Receipt", ["rcpt-no-tax.txt"], flags={"Tax (USD)": "Missing"})

    (OUT / "rcpt-zero-tax.txt").write_text("\n".join(receipt(tax="Tax: $0.00", total="$15.00")) + "\n")
    record("receipt-zero-tax", "Receipt", ["rcpt-zero-tax.txt"], values={"Tax (USD)": "0.00"})

    page_image(receipt(), transparent=True, ink=(0, 0, 0, 255)).save(OUT / "rcpt-transparent.png")
    record("receipt-transparent-png", "Receipt", ["rcpt-transparent.png"], values={"Total (USD)": "16.20"})

    (OUT / "rcpt-cafe.txt").write_bytes("\n".join(receipt(merchant="Café Muñoz")).encode("cp1252") + b"\n")
    record("receipt-windows-text", "Receipt", ["rcpt-cafe.txt"], values={"Total (USD)": "16.20"})

    (OUT / "rcpt-unlabeled-tax.txt").write_text("\n".join(receipt(tax="Sales Tax (8.25%): $1.24")) + "\n")
    record("receipt-labelled-with-rate", "Receipt", ["rcpt-unlabeled-tax.txt"], values={"Tax (USD)": "1.24"})

    # --- change orders
    write_pdf("co-correct.pdf", [{"lines": change_order()}])
    record("co-correct-pdf", "Change order", ["co-correct.pdf"], values={"Revised contract (USD)": "237500.00"})

    save_jpeg(photo(page_image(change_order(revised="$262,500.00")), rotate=-2, seed=7), "co-wrong-sum.jpg")
    record("co-wrong-sum-scan", "Change order", ["co-wrong-sum.jpg"], flags={"Revised contract (USD)": "Amount mismatch"})

    write_pdf("co-parens.pdf", [{"lines": change_order(change="Credit: ($12,500.00)")}])
    record("co-credit-in-parentheses", "Change order", ["co-parens.pdf"], values={"Change (USD)": "-12500.00"})

    write_pdf("co-blank-change.pdf", [{"lines": change_order(change="Net change:")}])
    record("co-missing-change", "Change order", ["co-blank-change.pdf"], flags={"Change (USD)": "Missing"})

    (OUT / "co-yard.txt").write_text("\n".join(change_order()) + "\n")
    (OUT / "co-office.txt").write_text("\n".join(change_order(revised="$237,000.00", change="Net change: -$13,000.00")) + "\n")
    record("co-copies-disagree", "Change order", ["co-yard.txt", "co-office.txt"],
           flags={"Change (USD)": "Conflict", "Revised contract (USD)": "Conflict"})

    header = ["FIELD OFFICE / ELECTRICAL CHANGE ORDER", "Change order #: CO-M07", "Prior contract: $42,000.00"]
    for name, revised in (("co-mixed-correct.pdf", "$41,500.00"), ("co-mixed-wrong.pdf", "$42,500.00")):
        table = page_image(["Deduction: $500.00", f"Revised contract: {revised}"], size=40, width=800)
        write_pdf(name, [{"lines": header, "images": [(table, 54, 470, 400, int(400 * table.height / table.width))]}])
    record("co-mixed-text-and-scan-correct", "Change order", ["co-mixed-correct.pdf"],
           values={"Revised contract (USD)": "41500.00"})
    record("co-mixed-text-and-scan-wrong", "Change order", ["co-mixed-wrong.pdf"],
           flags={"Revised contract (USD)": "Amount mismatch"})

    first = page_image(["Change order #: CO-T01", "Prior contract: $80,000.00"])
    second = page_image(["Net change: +$2,500.00", "Revised contract: $82,500.00"])
    first.save(OUT / "co-two-page.tiff", save_all=True, append_images=[second])
    record("co-multipage-tiff", "Change order", ["co-two-page.tiff"], values={"Revised contract (USD)": "82500.00"})

    save_jpeg(photo(page_image(change_order(change="Deduction: $12,500.00")), rotate=3, dim=0.8, blur=0.7, noise=0.06, seed=8),
              "co-dim-photo.jpg")
    record("co-dim-skewed-photo", "Change order", ["co-dim-photo.jpg"], values={"Change (USD)": "-12500.00"})

    page_image(change_order(), size=34).resize((700, 440), Image.Resampling.LANCZOS).save(OUT / "co-low-res.png")
    # Tesseract's reading of "-$12,500.00" flips with image scale at this size, so success means safe, not exact.
    record("co-low-res-photo", "Change order", ["co-low-res.png"],
           values={"Revised contract (USD)": "237500.00"}, tolerant=True)

    # Hard inputs: an unreadable thumbnail and a slashed-zero font that OCR confuses with 2.
    page_image(change_order(), size=34).resize((330, 215), Image.Resampling.LANCZOS).save(OUT / "co-tiny.png")
    record("co-tiny-thumbnail", "Change order", ["co-tiny.png"],
           values={"Revised contract (USD)": "237500.00"}, tolerant=True)
    page_image(["Change order #: CO-Z01", "Prior contract: $42,000.00", "Net change: -$500.00",
                "Revised contract: $41,500.00"], size=40, mono=True).save(OUT / "co-slashed-zero.png")
    record("co-slashed-zero-font", "Change order", ["co-slashed-zero.png"],
           values={"Revised contract (USD)": "41500.00"}, tolerant=True)

    root = OUT.parent
    (root / "manifest.json").write_text(json.dumps(
        [{"id": r["id"], "title": r["title"], "kind": r["kind"], "files": ["files/" + f for f in r["files"]]}
         for r in records], indent=2) + "\n")
    (root / "labels.json").write_text(json.dumps({r["id"]: r["expect"] for r in records}, indent=2) + "\n")
    print(f"{len(records)} records, {len(list(OUT.iterdir()))} files")


if __name__ == "__main__":
    build()
