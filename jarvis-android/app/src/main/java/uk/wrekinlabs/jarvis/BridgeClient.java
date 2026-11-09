package uk.wrekinlabs.jarvis;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class BridgeClient {
    private volatile HttpsURLConnection active;
    private volatile boolean cancelled;
    void cancel() { cancelled=true; HttpsURLConnection c=active; if(c!=null)c.disconnect(); }
    JSONObject request(String endpoint,String token,String message) throws Exception {
        if(cancelled) throw new IOException("Cancelled");
        String base=EndpointPolicy.normalize(endpoint);
        if(!EndpointPolicy.validToken(token)) throw new IOException("Pairing token invalid");
        HttpsURLConnection c=(HttpsURLConnection)new URL(base+(message==null?"/v1/health":"/v1/chat")).openConnection();
        active=c;
        try {
            c.setInstanceFollowRedirects(false); c.setConnectTimeout(10000); c.setReadTimeout(70000);
            c.setRequestProperty("Authorization","Bearer "+token); c.setRequestProperty("Accept","application/json");
            if(cancelled) throw new IOException("Cancelled");
            if(message!=null) {
                byte[] data=new JSONObject().put("message",message).toString().getBytes(StandardCharsets.UTF_8);
                c.setRequestMethod("POST"); c.setDoOutput(true); c.setFixedLengthStreamingMode(data.length);
                c.setRequestProperty("Content-Type","application/json");
                try(OutputStream out=c.getOutputStream()){out.write(data);}
            }
            int status=c.getResponseCode();
            if(status!=200) {
                if(status==401)throw new IOException("Pairing token rejected. Check Connection settings.");
                if(status==429)throw new IOException("Too many requests. Please wait a minute.");
                if(status==502||status==503)throw new IOException("The local AI is unavailable or busy. Please try again later.");
                throw new IOException("Bridge request failed (HTTP "+status+"). Redirects are not followed.");
            }
            String type=c.getContentType();
            if(type==null || !type.toLowerCase(java.util.Locale.ROOT).startsWith("application/json"))throw new IOException("Invalid bridge response.");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[4096];int n;
                while((n=in.read(b))!=-1){if(cancelled)throw new IOException("Cancelled");if(out.size()+n>131072)throw new IOException("Reply too large.");out.write(b,0,n);}
                return new JSONObject(out.toString("UTF-8"));
            }
        } finally { c.disconnect(); active=null; }
    }
}
