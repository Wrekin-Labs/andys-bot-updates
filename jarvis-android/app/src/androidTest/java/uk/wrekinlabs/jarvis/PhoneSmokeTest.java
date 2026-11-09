package uk.wrekinlabs.jarvis;
import android.content.Context;
import android.widget.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PhoneSmokeTest {
 @Before public void resetSyntheticData(){Context c=ApplicationProvider.getApplicationContext();c.getSharedPreferences("jarvis",0).edit().clear().putBoolean("speak_replies",false).commit();c.getSharedPreferences("conversation",0).edit().clear().commit();c.getSharedPreferences("pairing",0).edit().clear().commit();}
 @Test public void localNotePersistsThroughRecreation(){
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   scenario.onActivity(a->{EditText input=a.findViewById(R.id.message_input);input.setText("Remember emulator test note");a.findViewById(R.id.send_message).performClick();assertTrue(((TextView)a.findViewById(R.id.reply_text)).getText().toString().contains("saved"));});
   scenario.recreate();
   scenario.onActivity(a->{assertTrue(a.getSharedPreferences("jarvis",0).getString("notes","").contains("emulator test note"));assertTrue(new ConversationStore(a).turns().length()>0);a.findViewById(R.id.nav_memory).performClick();a.findViewById(R.id.nav_settings).performClick();a.findViewById(R.id.nav_home).performClick();assertNotNull(a.findViewById(R.id.message_input));});
  }
 }
 @Test public void disconnectedChatDoesNotInventReply(){try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){scenario.onActivity(a->{((EditText)a.findViewById(R.id.message_input)).setText("Explain a transistor");a.findViewById(R.id.send_message).performClick();assertTrue(((TextView)a.findViewById(R.id.reply_text)).getText().toString().contains("connect your AI bridge"));assertEquals(0,new ConversationStore(a).turns().length());});}}
 @Test public void pairingEncryptionAndOriginBinding()throws Exception{
  Context context=ApplicationProvider.getApplicationContext();PairingStore store=new PairingStore(context);String token="a".repeat(43);store.save("https://example.com",token);assertEquals(token,store.token());assertFalse(context.getSharedPreferences("pairing",0).getAll().toString().contains(token));
  context.getSharedPreferences("pairing",0).edit().putString("endpoint","https://changed.example.com").commit();try{store.token();fail("Tampered origin must not decrypt");}catch(Exception expected){}assertTrue(store.clear());
 }
 @Test public void historyOnlyIncludesCompletedAiTurns(){Context context=ApplicationProvider.getApplicationContext();ConversationStore s=new ConversationStore(context);s.add("remember secret","saved","local");s.add("question","answer","ai");assertEquals(2,s.history().length());assertFalse(s.history().toString().contains("secret"));s.clear();assertEquals(0,s.history().length());}
}
