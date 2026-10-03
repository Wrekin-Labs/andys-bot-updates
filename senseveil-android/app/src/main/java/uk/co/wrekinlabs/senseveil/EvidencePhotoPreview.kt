package uk.co.wrekinlabs.senseveil

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File

/** A small, upright display copy. Never writes to the original signed evidence. */
object EvidencePhotoPreview {
    fun load(file: File, maxEdge: Int = 720): Bitmap? {
        require(maxEdge > 0)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val longest = maxOf(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while ((longest.toLong() + sample - 1) / sample > maxEdge) sample *= 2
        val bitmap = BitmapFactory.decodeFile(file.absolutePath,
            BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val exif = runCatching { ExifInterface(file) }.getOrNull() ?: return bitmap
        if (!exif.isFlipped && exif.rotationDegrees == 0) return bitmap
        // ExifInterface defines its rotation after a horizontal flip, if present.
        val matrix = Matrix().apply {
            if (exif.isFlipped) setScale(-1f, 1f)
            postRotate(exif.rotationDegrees.toFloat())
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            .also { if (it !== bitmap) bitmap.recycle() }
    }
}
