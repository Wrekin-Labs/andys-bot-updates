package uk.wrekinlabs.jarvis;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.nio.charset.StandardCharsets;

final class PairingStore {
    private static final String ALIAS="jarvis-pairing-v1";
    private final SharedPreferences prefs;
    PairingStore(Context context) { prefs=context.getSharedPreferences("pairing",Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if(!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
    }
    String endpoint() { return prefs.getString("endpoint",""); }
    boolean configured() { return !endpoint().isEmpty() && prefs.contains("ciphertext"); }
    void save(String endpoint,String token) throws Exception {
        endpoint=EndpointPolicy.normalize(endpoint);
        if(!EndpointPolicy.validToken(token)) throw new IllegalArgumentException("Invalid pairing token");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key());
        cipher.updateAAD(endpoint.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted=cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        if(!prefs.edit().putString("endpoint",endpoint).putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
            .putString("ciphertext",Base64.encodeToString(encrypted,Base64.NO_WRAP)).commit()) throw new Exception("Storage failed");
    }
    String token() throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));
        cipher.updateAAD(endpoint().getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(prefs.getString("ciphertext",""),Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    boolean clear() { return prefs.edit().clear().commit(); }
}
