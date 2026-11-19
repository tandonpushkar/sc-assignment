package expo.modules.fielddesk

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TiffPagesTest {
  @Test
  fun eachFrameReportsWholeDocumentCountAndItsOwnDimensions() {
    val context = InstrumentationRegistry.getInstrumentation().context
    val fixture = File.createTempFile("two-pages-", ".tiff", context.cacheDir)
    try {
      context.assets.open("two-pages.tiff").use { input ->
        fixture.outputStream().use { input.copyTo(it) }
      }
      val reader = FielddeskReader()
      val (firstCount, first) = reader.tiffBounds(fixture, 0)
      val (secondCount, second) = reader.tiffBounds(fixture, 1)
      assertEquals(2, firstCount)
      assertEquals(2, secondCount)
      assertEquals(40, first.outWidth)
      assertEquals(48, second.outHeight)
    } finally {
      fixture.delete()
    }
  }
}
