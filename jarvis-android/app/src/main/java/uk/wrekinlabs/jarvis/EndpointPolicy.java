package uk.wrekinlabs.jarvis;
import java.net.URI;
/** Credentials are permitted only on an explicit HTTPS origin, never a URL query. */
public final class EndpointPolicy {
    public static String normalize(String raw) {
        try {
            URI uri = new URI(raw.trim());
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getRawPath().isEmpty() || uri.getRawPath().equals("/"))
                || uri.getPort() == 0 || uri.getPort() > 65535) throw new IllegalArgumentException();
            return new URI("https", null, uri.getHost(), uri.getPort(), null, null, null).toASCIIString();
        } catch (Exception e) { throw new IllegalArgumentException("Enter an HTTPS address with no path, password or query."); }
    }
    public static boolean validToken(String token) { return token != null && token.matches("[A-Za-z0-9_-]{32,128}"); }
}
