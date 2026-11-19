package expo.modules.fielddesk

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.contentstream.PDContentStream
import com.tom_roush.pdfbox.contentstream.operator.Operator
import com.tom_roush.pdfbox.pdfparser.PDFStreamParser
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.text.PDFTextStripper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlin.math.*
import org.beyka.tiffbitmapfactory.TiffBitmapFactory

class FielddeskReader : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private val maxSide = 2400

  override fun definition() = ModuleDefinition {
    Name("FielddeskReader")
    AsyncFunction("modelFiles") {
      val dir = File(context.noBackupFilesDir, "ocr-91bd3900").apply { mkdirs() }
      for (name in listOf("model.pte", "charset.json")) {
        val dest = File(dir, name)
        if (!dest.isFile) {
          val tmp = File.createTempFile("install-", ".tmp", dir)
          try {
            context.assets.open("fielddesk-ocr/$name").use { input ->
              tmp.outputStream().use { input.copyTo(it) }
            }
            require(tmp.renameTo(dest)) { "Could not prepare the OCR model." }
          } finally {
            tmp.delete()
          }
        }
      }
      mapOf(
        "modelPath" to File(dir, "model.pte").path,
        "charsetPath" to File(dir, "charset.json").path,
      )
    }
    AsyncFunction("readPage") { uri: String, index: Int ->
      val file = File(requireNotNull(Uri.parse(uri).path))
      require(file.isFile && file.length() in 1L..12L * 1024 * 1024) {
        "Choose a nonempty file up to 12 MB."
      }
      val header = ByteArray(1024)
      file.inputStream().use { it.read(header) }
      val prefix = header.toString(Charsets.ISO_8859_1)
      when {
        prefix.contains("%PDF-") -> pdfPage(file, index)
        prefix.startsWith("II*\u0000") || prefix.startsWith("MM\u0000*") -> tiffPage(file, index)
        else -> photo(file, index)
      }
    }
  }

  private fun checkIndex(index: Int, count: Int) {
    require(count in 1..12 && index in 0 until count) { "Choose a document with 1 to 12 pages." }
  }

  private fun sample(width: Int, height: Int): Int {
    require(width > 0 && height > 0 && width.toLong() * height <= 24_000_000) {
      "Use a readable image under 24 megapixels."
    }
    var n = 1
    while (max(width, height) / n > maxSide) n *= 2
    return n
  }

  private fun photo(file: File, index: Int): Map<String, Any> {
    checkIndex(index, 1)
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    options.inSampleSize = sample(options.outWidth, options.outHeight)
    options.inJustDecodeBounds = false
    val bitmap =
      requireNotNull(BitmapFactory.decodeFile(file.path, options)) { "Unreadable image." }
    val orientation =
      runCatching { ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }
        .getOrDefault(1)
    val matrix = Matrix()
    when (orientation) {
      2 -> matrix.setScale(-1f, 1f)
      3 -> matrix.setRotate(180f)
      4 -> matrix.setScale(1f, -1f)
      5 -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      6 -> matrix.setRotate(90f)
      7 -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      8 -> matrix.setRotate(-90f)
    }
    val upright = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (upright !== bitmap) bitmap.recycle()
    return raster(upright, 1, "")
  }

  internal fun tiffBounds(file: File, index: Int): Pair<Int, TiffBitmapFactory.Options> {
    val options = TiffBitmapFactory.Options().apply {
      inJustDecodeBounds = true
      inUseOrientationTag = true
      inDirectoryNumber = 0
    }
    // libtiff counts the remaining directories from the selected frame.
    TiffBitmapFactory.decodeFile(file, options)
    val total = options.outDirectoryCount
    checkIndex(index, total)
    if (index > 0) {
      options.inDirectoryNumber = index
      TiffBitmapFactory.decodeFile(file, options)
    }
    return total to options
  }

  private fun tiffPage(file: File, index: Int): Map<String, Any> {
    val (count, options) = tiffBounds(file, index)
    options.inSampleSize = sample(options.outWidth, options.outHeight)
    options.inJustDecodeBounds = false
    val image =
      requireNotNull(TiffBitmapFactory.decodeFile(file, options)) { "Unreadable TIFF page." }
    return raster(image, count, "")
  }

  private fun hasImage(stream: PDContentStream, seen: MutableSet<Any>): Boolean {
    val resources = stream.resources
    if (resources != null && seen.add(resources.cosObject)) {
      for (name in resources.xObjectNames) {
        when (val obj = resources.getXObject(name)) {
          is PDImageXObject -> return true
          is PDFormXObject -> if (hasImage(obj, seen)) return true
        }
      }
    }
    // An inline image is a content operator, so it is absent from XObject resources.
    val parser = PDFStreamParser(stream)
    while (true) {
      val token = parser.parseNextToken() ?: return false
      if (token is Operator && token.name == "BI") return true
    }
  }

  private fun pdfPage(file: File, index: Int): Map<String, Any> {
    PDFBoxResourceLoader.init(context)
    PDDocument.load(file).use { pdf ->
      val count = pdf.numberOfPages
      checkIndex(index, count)
      val text =
        PDFTextStripper()
          .apply {
            startPage = index + 1
            endPage = index + 1
            sortByPosition = true
          }
          .getText(pdf)
          .trim()
      if (
        text.count { it.isLetterOrDigit() } >= 20 && !hasImage(pdf.getPage(index), mutableSetOf())
      )
        return mapOf("count" to count, "text" to text)
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { renderer ->
          renderer.openPage(index).use { page ->
            val scale = min(2.5, maxSide.toDouble() / max(page.width, page.height))
            val image =
              Bitmap.createBitmap(
                max(1, (page.width * scale).roundToInt()),
                max(1, (page.height * scale).roundToInt()),
                Bitmap.Config.ARGB_8888,
              )
            image.eraseColor(Color.WHITE)
            page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            return raster(image, count, text)
          }
        }
      }
    }
  }

  private fun raster(image: Bitmap, count: Int, text: String): Map<String, Any> {
    val width = image.width
    val height = image.height
    val tmp = File.createTempFile("ocr-page-", ".rgb", context.cacheDir)
    try {
      val pixels = IntArray(width)
      val bytes = ByteArray(width * 3)
      tmp.outputStream().buffered().use { out ->
        for (y in 0 until height) {
          image.getPixels(pixels, 0, width, 0, y, width, 1)
          pixels.forEachIndexed { x, p ->
            val a = Color.alpha(p)
            bytes[x * 3] = ((Color.red(p) * a + 255 * (255 - a)) / 255).toByte()
            bytes[x * 3 + 1] = ((Color.green(p) * a + 255 * (255 - a)) / 255).toByte()
            bytes[x * 3 + 2] = ((Color.blue(p) * a + 255 * (255 - a)) / 255).toByte()
          }
          out.write(bytes)
        }
      }
      return mapOf(
        "count" to count,
        "text" to text,
        "width" to width,
        "height" to height,
        "uri" to Uri.fromFile(tmp).toString(),
      )
    } catch (e: Exception) {
      tmp.delete()
      throw e
    } finally {
      image.recycle()
    }
  }
}
