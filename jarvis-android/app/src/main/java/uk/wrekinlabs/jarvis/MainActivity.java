package uk.wrekinlabs.jarvis;

import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.graphics.Color;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Phone companion. Authenticated text chat only; no workstation executor. */
public class MainActivity extends Activity {
    private LinearLayout page;
    private EditText input;
    private TextView reply;
    private TextToSpeech speech;
    private boolean speechReady;
    private String screen = "Home";
    private String draft = "", lastReply = "";
    private PairingStore pairing;
    private final java.util.concurrent.ExecutorService worker = java.util.concurrent.Executors.newSingleThreadExecutor();
    private BridgeClient request;
    private int generation;
    private boolean busy;
    private static final int VOICE = 10, IMPORT = 11, EXPORT = 12;
    private static final int MAX_BYTES = 262144;
    private final Set<String> states = new HashSet<>(Arrays.asList("queued", "awaiting_approval", "running", "completed", "cancelled", "unknown"));

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        pairing = new PairingStore(this);
        if(saved!=null) { draft=saved.getString("draft",""); lastReply=saved.getString("reply",""); }
        speech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) speechReady = speech.setLanguage(Locale.UK) >= 0;
        });
        show(saved == null ? "Home" : saved.getString("screen", "Home"));
        if (saved != null && input != null) input.setText(saved.getString("draft", ""));
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("screen", screen);
        state.putString("draft", input != null ? input.getText().toString() : draft);
        state.putString("reply",lastReply);
        super.onSaveInstanceState(state);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void text(String value, int size, int color) {
        TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color);
        v.setPadding(0, dp(10), 0, dp(10)); page.addView(v);
    }
    private void button(String label, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setMinHeight(dp(52));
        page.addView(b, new LinearLayout.LayoutParams(-1, -2)); b.setOnClickListener(v -> action.run());
    }
    private SharedPreferences prefs() { return getSharedPreferences("jarvis", MODE_PRIVATE); }
    private void show(String tab) {
        if(input!=null) draft=input.getText().toString();
        cancelRequest();
        screen = tab; input = null; reply=null;
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(Color.rgb(9,18,29));
        page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(dp(22),dp(20),dp(22),dp(24));
        scroll.addView(page); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets;
        });
        scroll.requestApplyInsets();
        text("WREKIN LABS  /  JARVIS", 13, Color.rgb(120,229,209));
        text(tab.equals("Home") ? "Hello, Andrew." : tab, 32, Color.WHITE);
        text(pairing.configured() ? "AI connection saved • PC control disabled" : "Local mode • AI connection not configured", 14, Color.LTGRAY);
        if (tab.equals("Home")) home();
        if (tab.equals("Memory")) memory();
        if (tab.equals("Tasks")) tasks();
        if (tab.equals("Connection")) connection();
        button("Home", () -> show("Home")); button("Memory", () -> show("Memory")); button("Tasks", () -> show("Tasks")); button("Connection", () -> show("Connection"));
    }
    private void home() {
        text("Ask a question or capture a repair note. You choose whether to send it to AI or save it on your phone.", 17, Color.WHITE);
        input = new EditText(this); input.setHint("Remember to check the amplifier…"); input.setTextColor(Color.WHITE); input.setHintTextColor(Color.LTGRAY); input.setMinLines(3); input.setGravity(Gravity.TOP); input.setMaxLines(8); input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4000)}); page.addView(input); input.setText(draft);
        button("Tap to talk", () -> {
            Intent voice = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            voice.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            voice.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB");
            voice.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak, then review your words before saving");
            try { startActivityForResult(voice, VOICE); } catch (ActivityNotFoundException e) { answer("Voice input is unavailable. You can still type your note."); }
        });
        text("Voice uses your phone’s speech provider, which may process audio online. Review the text before saving.", 12, Color.LTGRAY);
        button("Ask Jarvis", () -> ask(input.getText().toString()));
        button("Save as a note", () -> saveNote(input.getText().toString()));
        reply = new TextView(this); reply.setTextColor(Color.WHITE); reply.setTextSize(17); reply.setTextIsSelectable(true); reply.setText(lastReply); page.addView(reply);
        button("Read reply aloud", () -> { if (speechReady) speech.speak(reply.getText().toString(), TextToSpeech.QUEUE_FLUSH, null, "reply"); else answer("Speech output is not ready on this phone."); });
        button("Stop reply / speaking", () -> { cancelRequest(); speech.stop(); answer("Stopped on this phone. The server may finish processing the question."); });
    }
    private void answer(String value) { lastReply=value; if (reply != null) reply.setText(value); }
    private JSONArray notes() {
        try { return new JSONArray(prefs().getString("notes", "[]")); } catch (JSONException e) { return new JSONArray(); }
    }
    private void saveNote(String raw) {
        String note = raw.trim().replaceFirst("(?i)^remember\\s+", "").trim();
        if (note.isEmpty()) { answer("Enter a note first."); return; }
        JSONArray list = notes();
        if (list.length() >= 200) { answer("Memory is full (200 notes). Remove old notes from Memory first."); return; }
        try { JSONObject entry = new JSONObject(); entry.put("text", note); entry.put("at", System.currentTimeMillis()); list.put(entry);
            if (prefs().edit().putString("notes", list.toString()).commit()) { input.setText(""); draft=""; answer("Saved on this phone. No PC task was started."); }
            else answer("Could not save your note. Please try again.");
        } catch (JSONException e) { answer("Could not save this note."); }
    }
    private void memory() {
        text("Notes stay in this app on this phone. Uninstalling removes them. They are not synced to ChatGPT or your PC.", 14, Color.LTGRAY);
        JSONArray list = notes();
        if (list.length() == 0) text("No saved notes yet.", 18, Color.WHITE);
        button("Export notes", () -> {
            Intent export = new Intent(Intent.ACTION_CREATE_DOCUMENT); export.setType("application/json"); export.addCategory(Intent.CATEGORY_OPENABLE); export.putExtra(Intent.EXTRA_TITLE,"Jarvis-notes.json");
            try { startActivityForResult(export,EXPORT); } catch(ActivityNotFoundException e) { toast("No file picker available."); }
        });
        for (int i = list.length() - 1; i >= 0; i--) {
            JSONObject n = list.optJSONObject(i); final int index=i;
            if(n != null) {
                text(n.optString("text"),18,Color.WHITE);
                button("Delete note", () -> new AlertDialog.Builder(this).setTitle("Delete this note?").setMessage(n.optString("text")).setNegativeButton("Keep",null).setPositiveButton("Delete",(d,w)->{
                    JSONArray current=notes(); current.remove(index);
                    if(prefs().edit().putString("notes",current.toString()).commit()) show("Memory"); else toast("Could not delete note.");
                }).show());
            }
        }
        if (list.length() > 0) button("Delete all notes", () -> new AlertDialog.Builder(this).setTitle("Delete all saved notes?").setMessage("This cannot be undone.").setNegativeButton("Keep notes", null).setPositiveButton("Delete", (d,w) -> { if(prefs().edit().remove("notes").commit()) show("Memory"); }).show());
    }
    private void tasks() {
        text("Import a Jarvis task snapshot from your files. This is a saved view, not a live connection. Approval and PC control are not enabled.",16,Color.LTGRAY);
        button("Import task snapshot", () -> { Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.setType("application/json"); i.addCategory(Intent.CATEGORY_OPENABLE); try { startActivityForResult(i, IMPORT); } catch(ActivityNotFoundException e) { toast("No file picker available."); } });
        try {
            JSONObject snapshot = new JSONObject(prefs().getString("snapshot", "{}"));
            JSONArray items = snapshot.optJSONArray("tasks");
            text(snapshot.optBoolean("sample",false) ? "SYNTHETIC DEMO" : "OFFLINE SNAPSHOT", 14, Color.rgb(120,229,209));
            text("Exported: " + snapshot.optString("generated_at", "No snapshot imported"), 12, Color.LTGRAY);
            if(items != null) for(int i=0;i<items.length();i++) { JSONObject task=items.getJSONObject(i); text(task.getString("state").replace('_',' ') + "\n" + task.getString("id"),16,Color.WHITE); }
        } catch(JSONException e) { text("Snapshot could not be read. Import it again.",16,Color.WHITE); }
    }
    private String validateSnapshot(String raw) throws JSONException {
        JSONObject source = new JSONObject(raw), clean = new JSONObject();
        if(source.getInt("schema_version") != 1) throw new JSONException("Version");
        JSONArray rows = source.getJSONArray("tasks"), safe = new JSONArray();
        if(rows.length()>500) throw new JSONException("Too many tasks");
        for(int i=0;i<rows.length();i++) {
            JSONObject row=rows.getJSONObject(i); String id=row.getString("id"), state=row.getString("state");
            if(id.length()>100 || id.isEmpty() || !states.contains(state)) throw new JSONException("Invalid task");
            safe.put(new JSONObject().put("id",id).put("state",state));
        }
        String stamp=source.getString("generated_at"); if(stamp.length()>64) throw new JSONException("Invalid date");
        return clean.put("schema_version",1).put("generated_at",stamp).put("sample",source.getBoolean("sample")).put("tasks",safe).toString();
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data); if(result!=RESULT_OK || data==null) return;
        if(request==EXPORT && data.getData()!=null) {
            try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")) {
                if(out==null)throw new IOException();
                out.write(new JSONObject().put("schema_version",1).put("notes",notes()).toString(2).getBytes(StandardCharsets.UTF_8));
                toast("Notes exported. Keep the file private.");
            } catch(Exception e) { toast("Could not export notes."); }
        }
        if(request==VOICE && input!=null) { ArrayList<String> words=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS); if(words!=null&&!words.isEmpty()) input.setText(words.get(0)); }
        if(request==IMPORT && data.getData()!=null) {
            try(InputStream stream=getContentResolver().openInputStream(data.getData()); ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                if(stream==null) throw new IOException(); byte[] block=new byte[4096]; int count;
                while((count=stream.read(block))!=-1) { if(bytes.size()+count>MAX_BYTES) throw new IOException(); bytes.write(block,0,count); }
                String safe=validateSnapshot(bytes.toString(StandardCharsets.UTF_8.name()));
                if(!prefs().edit().putString("snapshot",safe).commit()) throw new IOException(); show("Tasks");
            } catch(Exception e) { new AlertDialog.Builder(this).setTitle("Import failed").setMessage("Choose a Jarvis JSON snapshot under 256 KB, containing up to 500 tasks. Your previous snapshot is unchanged.").setPositiveButton("OK",null).show(); }
        }
    }

    private void toast(String message) { Toast.makeText(this,message,Toast.LENGTH_LONG).show(); }
    private void cancelRequest() { generation++; if(request!=null)request.cancel(); request=null; busy=false; }
    private void connection() {
        text("Connect to your private Jarvis chat bridge. Only questions you explicitly send leave this phone; saved notes are not sent automatically. Each question is independent in this preview.",16,Color.LTGRAY);
        EditText address=new EditText(this); address.setHint("https://your-jarvis-address"); address.setTextColor(Color.WHITE); address.setHintTextColor(Color.LTGRAY); address.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI); address.setText(pairing.endpoint()); page.addView(address);
        EditText token=new EditText(this); token.setHint("Pairing token (not an AI API key)"); token.setTextColor(Color.WHITE); token.setHintTextColor(Color.LTGRAY); token.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD); token.setSaveEnabled(false); token.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO); page.addView(token);
        button("Save connection", () -> {
            try {
                pairing.save(address.getText().toString(),token.getText().toString().trim());
                token.setText(""); lastReply="Connection saved. Test it before chatting."; show("Connection");
            } catch(Exception e) { answer("Could not save. Use an HTTPS address without a path and a 32–128 character pairing token."); }
        });
        button("Test saved connection", () -> startRequest(null));
        button("Forget connection", () -> { cancelRequest(); if(pairing.clear()) { lastReply="Connection removed. Saved notes are unchanged."; show("Connection"); } else answer("Could not remove connection."); });
        reply=new TextView(this); reply.setTextColor(Color.WHITE); reply.setText(lastReply); page.addView(reply);
        text("AI replies are text only. Jarvis cannot send messages, run commands or control your PC in this build. A reachable HTTPS bridge and a running local model are required.",14,Color.LTGRAY);
    }
    private void ask(String message) {
        String trimmed=message.trim();
        if(trimmed.isEmpty()){answer("Enter a question first.");return;}
        startRequest(trimmed);
    }
    private void startRequest(String message) {
        if(busy){answer("A reply is already in progress.");return;}
        if(!pairing.configured()){answer("Open Connection to set up your private AI bridge first.");return;}
        final String endpoint=pairing.endpoint(), token;
        try { token=pairing.token(); } catch(Exception e){answer("Saved pairing could not be unlocked. Re-enter the connection details.");return;}
        busy=true; final int ticket=++generation;
        final BridgeClient client=new BridgeClient(); request=client;
        answer(message==null?"Checking bridge…":"Waiting for AI reply…");
        worker.execute(() -> {
            String result;
            try {
                JSONObject response=client.request(endpoint,token,message);
                if(message==null) {
                    if(!"jarvis-mobile-bridge".equals(response.optString("service")) || response.optInt("version")!=1) throw new IOException("Unexpected service.");
                    result="Bridge reachable. The local model is not verified until it answers a question.";
                } else {
                    if(!response.has("actions_executed") || response.getBoolean("actions_executed")) throw new IOException("Unsupported response.");
                    String value=response.getString("reply");
                    if(value.trim().isEmpty()||value.length()>16000)throw new IOException("Invalid reply.");
                    result="AI reply (no actions performed):\n\n"+value;
                }
            } catch(Exception e) {
                result="Could not get a reply. Check your bridge address, pairing token, network and local model. No action was performed.";
            }
            final String display=result;
            runOnUiThread(() -> { if(ticket!=generation||isFinishing()||isDestroyed())return; busy=false; request=null; answer(display); });
        });
    }

    @Override protected void onStop() { if(speech!=null) speech.stop(); super.onStop(); }
    @Override protected void onDestroy() { cancelRequest(); worker.shutdownNow(); if(speech!=null) { speech.stop(); speech.shutdown(); } super.onDestroy(); }
}
