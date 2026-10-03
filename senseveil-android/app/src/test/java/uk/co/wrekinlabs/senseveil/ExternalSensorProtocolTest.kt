package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalSensorProtocolTest {
    @Test
    fun parsesRadarFrame() {
        val r = ExternalSensorProtocol.parse("SV1|RADAR|P=1|C=0.88|D=3.20|X=-0.15|V=0.12|SRC=mmwave")
        assertNotNull(r)
        assertTrue(r!!.detected)
        assertEquals(ExternalSensorType.RADAR, r.sensorType)
        assertEquals(0.88f, r.confidence, 0.001f)
        assertEquals(3.20f, r.distanceMetres!!, 0.001f)
        assertEquals("mmwave", r.source)
    }

    @Test
    fun rejectsUnknownProtocol() {
        assertNull(ExternalSensorProtocol.parse("BOGUS|RADAR|P=1|C=1"))
    }
}
