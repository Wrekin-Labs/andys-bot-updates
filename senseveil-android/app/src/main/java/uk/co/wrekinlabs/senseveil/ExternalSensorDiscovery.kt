package uk.co.wrekinlabs.senseveil

import android.content.Context
import android.hardware.usb.UsbManager
import android.os.Build

data class UsbSensorCandidate(
    val vendorId: Int,
    val productId: Int,
    val deviceName: String,
    val manufacturer: String?,
    val product: String?
)

object ExternalSensorDiscovery {
    fun usbCandidates(context: Context): List<UsbSensorCandidate> {
        val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return emptyList()
        return manager.deviceList.values.map { device ->
            UsbSensorCandidate(
                vendorId = device.vendorId,
                productId = device.productId,
                deviceName = device.deviceName,
                manufacturer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) runCatching { device.manufacturerName }.getOrNull() else null,
                product = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) runCatching { device.productName }.getOrNull() else null
            )
        }.sortedWith(compareBy({ it.vendorId }, { it.productId }))
    }

    fun report(context: Context, activeHub: ExternalSensorHub, activeReading: ExternalPresenceReading?): String {
        val usb = usbCandidates(context)
        return buildString {
            append("Active hub: ").append(activeHub.label).append('\n')
            append("Declared capabilities: ")
                .append(activeHub.capabilities.joinToString().ifBlank { "none" }).append('\n')
            activeReading?.let {
                append("Latest reading: ").append(it.sensorType.name).append(' ')
                    .append((it.confidence * 100).toInt()).append("% from ").append(it.source).append('\n')
            }
            append("USB devices visible: ").append(usb.size).append('\n')
            usb.take(8).forEach { item ->
                append("• VID:%04X PID:%04X".format(item.vendorId, item.productId))
                val name = listOfNotNull(item.manufacturer, item.product).joinToString(" ").trim()
                if (name.isNotBlank()) append("  ").append(name)
                append('\n')
            }
            append('\n')
            append("SenseVeil bridge protocol: SV1 over a future BLE UART or USB serial adapter. ")
            append("Camera-only mode does not provide through-wall sensing.")
        }
    }
}
