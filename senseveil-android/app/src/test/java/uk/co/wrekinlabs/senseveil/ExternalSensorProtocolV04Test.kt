package uk.co.wrekinlabs.senseveil

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalSensorProtocolV04Test {
    @Test
    fun parsesHelloHandshake() {
        val message = ExternalSensorProtocol.parseMessage(
            "SV1|HELLO|ID=radar-01|CAP=RADAR,RANGING|FW=1.2.0|SRC=test-radar"
        ) as ExternalSensorMessage.Hello
        assertEquals("radar-01", message.id)
        assertTrue(message.capabilities.contains(ExternalSensorType.RADAR))
        assertTrue(message.capabilities.contains(ExternalSensorType.RANGING))
        assertEquals("1.2.0", message.firmware)
    }
}
