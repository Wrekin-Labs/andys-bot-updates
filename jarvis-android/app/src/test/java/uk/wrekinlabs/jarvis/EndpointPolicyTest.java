package uk.wrekinlabs.jarvis;
import org.junit.Test;
import static org.junit.Assert.*;
public class EndpointPolicyTest {
    @Test public void acceptsHttpsOrigin() { assertEquals("https://jarvis.example.com:8766",EndpointPolicy.normalize("https://jarvis.example.com:8766/")); }
    @Test public void rejectsCredentialsAndPaths() {
        for(String url:new String[]{"http://example.com","https://user:secret@example.com","https://example.com/token","https://example.com/?key=secret","https://example.com/#secret","https://example.com:0","https://example.com:65536","file:///data","https://"}) {
            try { EndpointPolicy.normalize(url); fail(url); } catch(IllegalArgumentException expected) {}
        }
    }
    @Test public void rejectsHeaderInjection() { assertFalse(EndpointPolicy.validToken("a".repeat(32)+"\r\nX: bad")); }
    @Test public void boundsTokens() { assertFalse(EndpointPolicy.validToken("short")); assertTrue(EndpointPolicy.validToken("a".repeat(43))); assertFalse(EndpointPolicy.validToken("a".repeat(129))); }
}
