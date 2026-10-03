package uk.co.wrekinlabs.senseveil

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.exifinterface.media.ExifInterface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

internal object PhotoFixture {
    fun write(file: File, orientation: Int = ExifInterface.ORIENTATION_ROTATE_90) {
        val bitmap = Bitmap.createBitmap(128, 64, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint()
        listOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW).forEachIndexed { i, color ->
            paint.color = color
            val x = (i % 2) * 64f
            val y = (i / 2) * 32f
            canvas.drawRect(x, y, x + 64, y + 32, paint)
        }
        file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, 100, it)) }
        bitmap.recycle()
        ExifInterface(file).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
            saveAttributes()
        }
    }
}

@RunWith(AndroidJUnit4::class)
class EvidencePhotoPreviewTest {
    private val cache get() = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir

    @Test fun allExifOrientationsDisplayCorrectlyWithoutChangingEvidence() {
        val file = File(cache, "preview-orientation-${System.nanoTime()}.jpg")
        val colors = listOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW)
        // Expected visible TL, TR, BL, BR colors for the eight EXIF orientations.
        val expected = listOf(listOf(0,1,2,3), listOf(1,0,3,2), listOf(3,2,1,0), listOf(2,3,0,1),
            listOf(0,2,1,3), listOf(2,0,3,1), listOf(3,1,2,0), listOf(1,3,0,2))
        try {
            expected.forEachIndexed { index, quadrants ->
                val orientation = index + 1
                PhotoFixture.write(file, orientation)
                val original = file.readBytes()
                val preview = EvidencePhotoPreview.load(file)!!
                try {
                    assertEquals("Width for EXIF $orientation", if (orientation >= 5) 64 else 128, preview.width)
                    assertEquals("Height for EXIF $orientation", if (orientation >= 5) 128 else 64, preview.height)
                    quadrants.forEachIndexed { corner, colorIndex ->
                        val actual = preview.getPixel(preview.width * (if (corner % 2 == 0) 1 else 3) / 4,
                            preview.height * (if (corner < 2) 1 else 3) / 4)
                        val color = colors[colorIndex]
                        assertEquals("Red EXIF $orientation corner $corner", Color.red(color).toDouble(), Color.red(actual).toDouble(), 8.0)
                        assertEquals("Green EXIF $orientation corner $corner", Color.green(color).toDouble(), Color.green(actual).toDouble(), 8.0)
                        assertEquals("Blue EXIF $orientation corner $corner", Color.blue(color).toDouble(), Color.blue(actual).toDouble(), 8.0)
                    }
                    assertArrayEquals("Preview cannot rewrite signed evidence", original, file.readBytes())
                } finally { preview.recycle() }
            }
        } finally { file.delete() }
    }

    @Test fun previewBoundsMemoryAndHandlesUnreadableImages() {
        val file = File(cache, "preview-size-${System.nanoTime()}.png")
        try {
            val source = Bitmap.createBitmap(2048, 1024, Bitmap.Config.ARGB_8888)
            source.eraseColor(Color.RED)
            file.outputStream().use { source.compress(Bitmap.CompressFormat.PNG, 100, it) }
            source.recycle()
            val preview = EvidencePhotoPreview.load(file, 720)!!
            assertTrue(maxOf(preview.width, preview.height) <= 720)
            assertEquals(preview.width, preview.height * 2)
            preview.recycle()
            file.writeText("not an image")
            assertNull(EvidencePhotoPreview.load(file))
            file.delete()
            assertNull(EvidencePhotoPreview.load(file))
        } finally { file.delete() }
    }
}
