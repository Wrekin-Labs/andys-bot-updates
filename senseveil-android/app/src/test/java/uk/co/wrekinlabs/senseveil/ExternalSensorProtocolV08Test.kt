package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalSensorProtocolV08Test {
    @Test
    fun parsesSequenceAndTimestamp() {
        val r = ExternalSensorProtocol.parse("SV1|RADAR|P=1|C=0.88|D=3.2|SEQ=42|TS=1760000000000|SRC=lab")!!
        assertEquals(42L, r.sensorSequence)
        assertEquals(1760000000000L, r.sensorEpochMs)
    }
}
