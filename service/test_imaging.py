import io
import unittest
from PIL import Image, ImageDraw, ImageFont, ImageOps

from service import imaging

LINES = ["Vendor: Summit Steel", "Invoice #: 4471", "Date: 2026-11-04", "Total: $1,250.00"]


def font(size):
    for path in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def document(size=34, width=1100, ink="black", paper="white"):
    image = Image.new("RGB", (width, int(80 + len(LINES) * size * 1.9)), paper)
    draw = ImageDraw.Draw(image)
    for i, line in enumerate(LINES):
        draw.text((50, 40 + i * size * 1.9), line, fill=ink, font=font(size))
    return image


class FlattenTests(unittest.TestCase):
    def test_transparent_pixels_become_white_so_black_text_stays_visible(self):
        rgba = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
        ImageDraw.Draw(rgba).text((10, 30), "Total: $5.00", fill=(0, 0, 0, 255), font=font(30))
        gray = imaging.flatten(rgba)
        self.assertEqual(gray.mode, "L")
        self.assertEqual(gray.getpixel((290, 5)), 255)
        self.assertLess(min(gray.tobytes()), 60)

    def test_palette_image_with_transparency(self):
        base = document().convert("P")
        base.info["transparency"] = 0
        self.assertEqual(imaging.flatten(base).mode, "L")

    def test_sixteen_bit_images_use_their_full_range(self):
        image = Image.new("I;16", (50, 50), 60000)
        image.paste(1000, (10, 10, 20, 20))
        gray = imaging.flatten(image)
        self.assertEqual(gray.getpixel((0, 0)), 255)
        self.assertEqual(gray.getpixel((15, 15)), 0)

    def test_every_common_mode_converts_to_gray(self):
        base = document()
        for mode in ("RGB", "RGBA", "L", "LA", "P", "CMYK", "1", "YCbCr"):
            with self.subTest(mode=mode):
                self.assertEqual(imaging.flatten(base.convert(mode)).mode, "L")

    def test_exif_orientation_is_applied(self):
        image = document()
        exif = Image.Exif()
        exif[0x0112] = 6
        rotated = Image.open(io.BytesIO(self.jpeg(image, exif)))
        self.assertEqual(imaging.flatten(rotated).size, (image.height, image.width))

    @staticmethod
    def jpeg(image, exif):
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", exif=exif)
        return buffer.getvalue()


class TextHeightTests(unittest.TestCase):
    def test_measures_line_height_of_typical_text(self):
        for size in (20, 34, 48):
            with self.subTest(size=size):
                height = imaging.text_height(imaging.flatten(document(size)))
                self.assertGreater(height, size * 0.6)
                self.assertLess(height, size * 1.4)

    def test_blank_page_has_no_text(self):
        self.assertEqual(imaging.text_height(Image.new("L", (400, 400), 255)), 0)

    def test_tiny_text_is_enlarged_and_normal_text_is_left_alone(self):
        normal = imaging.flatten(document(34))
        self.assertIs(imaging.upscale(normal), normal)
        tiny = imaging.flatten(document(34).resize((140, 90), Image.Resampling.LANCZOS))
        self.assertLess(imaging.text_height(tiny), imaging.MIN_TEXT_HEIGHT)
        bigger = imaging.upscale(tiny)
        self.assertGreater(bigger.width, tiny.width * 1.5)
        self.assertLessEqual(bigger.width, tiny.width * imaging.MAX_UPSCALE + 1)


class SkewTests(unittest.TestCase):
    def estimate(self, angle):
        tilted = document().rotate(angle, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)
        return imaging.skew_degrees(imaging.flatten(tilted))

    def test_estimate_is_the_correcting_angle(self):
        for angle in (-8, -4, -2, 2, 4, 8, 11):
            with self.subTest(angle=angle):
                self.assertAlmostEqual(self.estimate(angle), -angle, delta=1.0)

    def test_straight_and_blank_pages_are_left_alone(self):
        self.assertEqual(self.estimate(0), 0.0)
        self.assertEqual(imaging.skew_degrees(Image.new("L", (400, 400), 255)), 0.0)

    def test_tilt_beyond_the_search_range_is_not_guessed(self):
        self.assertLessEqual(abs(self.estimate(25)), imaging.MAX_SKEW_DEGREES)


class OrientationTests(unittest.TestCase):
    def test_upright_text_needs_no_rotation(self):
        self.assertEqual(imaging.orientation_degrees(imaging.flatten(document())), 0)

    def test_sideways_and_upside_down_pages_are_turned_upright(self):
        for turn in (90, 180, 270):
            with self.subTest(turn=turn):
                gray = imaging.flatten(document().rotate(turn, expand=True, fillcolor="white"))
                fixed = imaging.orient(gray)
                reference = imaging.flatten(document())
                self.assertEqual(fixed.size, reference.size)

    def test_blank_page_is_not_rotated(self):
        self.assertEqual(imaging.orientation_degrees(Image.new("L", (600, 400), 255)), 0)


class PrepareTests(unittest.TestCase):
    def test_light_text_on_dark_paper_is_inverted(self):
        prepared = imaging.prepare(document(ink="white", paper="black"))
        self.assertGreater(sum(prepared.resize((16, 16)).tobytes()) / 256, 180)

    def test_oversized_images_are_refused_before_any_work(self):
        with self.assertRaisesRegex(ValueError, "24 megapixels"):
            imaging.prepare(Image.new("L", (6000, 4001)))

    def test_prepared_image_is_grayscale(self):
        self.assertEqual(imaging.prepare(document()).mode, "L")


if __name__ == "__main__":
    unittest.main()
