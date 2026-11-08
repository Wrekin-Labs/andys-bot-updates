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

/** Offline companion. No model credentials, network or workstation executor. */
public class MainActivity extends Activity {
    private LinearLayout page;
    private EditText input;
    private TextView reply;
    private TextToSpeech speech;
    private boolean speechReady;
    private String screen = "Home";
    private static final int VOICE = 10, IMPORT = 11;
    private static final int MAX_BYTES = 262144;
    private final Set<String> states = new HashSet<>(Arrays.asList("queued", "awaiting_approval", "running", "completed", "cancelled", "unknown"));

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        speech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) speechReady = speech.setLanguage(Locale.UK) >= 0;
        });
        show(saved == null ? "Home" : saved.getString("screen", "Home"));
        if (saved != null && input != null) input.setText(saved.getString("draft", ""));
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("screen", screen);
        if (input != null) state.putString("draft", input.getText().toString());
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
        screen = tab; input = null;
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(Color.rgb(9,18,29));
        page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(dp(22),dp(20),dp(22),dp(24));
        scroll.addView(page); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets;
        });
        scroll.requestApplyInsets();
        text("WREKIN LABS  /  JARVIS", 13, Color.rgb(120,229,209));
        text(tab.equals("Home") ? "Hello, Andrew." : tab, 32, Color.WHITE);
        text("Local preview • PC and AI not connected", 14, Color.LTGRAY);
        if (tab.equals("Home")) home();
        if (tab.equals("Memory")) memory();
        if (tab.equals("Tasks")) tasks();
        button("Home", () -> show("Home")); button("Memory", () -> show("Memory")); button("Tasks", () -> show("Tasks"));
    }
    private void home() {
        text("Capture an idea or repair note. Say ‘remember’ followed by your note, or type it below.", 17, Color.WHITE);
        input = new EditText(this); input.setHint("Remember to check the amplifier…"); input.setTextColor(Color.WHITE); input.setHintTextColor(Color.LTGRAY); input.setMinLines(3); input.setGravity(Gravity.TOP); input.setMaxLines(8); input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4000)}); page.addView(input);
        button("Tap to talk", () -> {
            Intent voice = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            voice.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            voice.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB");
            voice.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak, then review your words before saving");
            try { startActivityForResult(voice, VOICE); } catch (ActivityNotFoundException e) { answer("Voice input is unavailable. You can still type your note."); }
        });
        text("Voice uses your phone’s speech provider, which may process audio online. Review the text before saving.", 12, Color.LTGRAY);
        button("Save as a note", () -> saveNote(input.getText().toString()));
        reply = new TextView(this); reply.setTextColor(Color.WHITE); reply.setTextSize(17); page.addView(reply);
        button("Read reply aloud", () -> { if (speechReady) speech.speak(reply.getText().toString(), TextToSpeech.QUEUE_FLUSH, null, "reply"); else answer("Speech output is not ready on this phone."); });
        button("Stop speaking", () -> speech.stop());
    }
    private void answer(String value) { if (reply != null) reply.setText(value); }
    private JSONArray notes() {
        try { return new JSONArray(prefs().getString("notes", "[]")); } catch (JSONException e) { return new JSONArray(); }
    }
    private void saveNote(String raw) {
        String note = raw.trim().replaceFirst("(?i)^remember\\s+", "").trim();
        if (note.isEmpty()) { answer("Enter a note first."); return; }
        JSONArray list = notes();
        if (list.length() >= 200) { answer("Memory is full (200 notes). Remove old notes from Memory first."); return; }
        try { JSONObject entry = new JSONObject(); entry.put("text", note); entry.put("at", System.currentTimeMillis()); list.put(entry);
            if (prefs().edit().putString("notes", list.toString()).commit()) { input.setText(""); answer("Saved on this phone. No PC task was started."); }
            else answer("Could not save your note. Please try again.");
        } catch (JSONException e) { answer("Could not save this note."); }
    }
    private void memory() {
        text("Notes stay in this app on this phone. Uninstalling removes them. They are not synced to ChatGPT or your PC.", 14, Color.LTGRAY);
        JSONArray list = notes();
        if (list.length() == 0) text("No saved notes yet.", 18, Color.WHITE);
        for (int i = list.length() - 1; i >= 0; i--) { JSONObject n = list.optJSONObject(i); if(n != null) text(n.optString("text"),18,Color.WHITE); }
        if (list.length() > 0) button("Delete all notes", () -> new AlertDialog.Builder(this).setTitle("Delete all saved notes?").setMessage("This cannot be undone.").setNegativeButton("Keep notes", null).setPositiveButton("Delete", (d,w) -> { if(prefs().edit().remove("notes").commit()) show("Memory"); }).show());
    }
    private void tasks() {
        text("Import a Jarvis task snapshot from your files. This is a saved view, not a live connection. Approval and PC control are not enabled.",16,Color.LTGRAY);
        button("Import task snapshot", () -> { Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.setType("application/json"); i.addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(i, IMPORT); });
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
    @Override protected void onStop() { if(speech!=null) speech.stop(); super.onStop(); }
    @Override protected void onDestroy() { if(speech!=null) { speech.stop(); speech.shutdown(); } super.onDestroy(); }
}
