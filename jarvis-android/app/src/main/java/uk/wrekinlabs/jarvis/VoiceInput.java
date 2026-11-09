package uk.wrekinlabs.jarvis;
import android.content.*;
import android.os.*;
import android.speech.*;
import java.util.*;

final class VoiceInput implements RecognitionListener {
    interface Listener { void state(String state);void partial(String text);void result(String text);void error(String text); }
    private SpeechRecognizer recognizer;private final Context context;private final Listener listener;private boolean active;
    VoiceInput(Context context,Listener listener){this.context=context;this.listener=listener;}
    boolean localAvailable(){return Build.VERSION.SDK_INT>=31&&SpeechRecognizer.isOnDeviceRecognitionAvailable(context);}
    void start(boolean localOnly){
        close();
        if(localOnly&&!localAvailable()){listener.error("On-device speech is unavailable. Choose System speech in Settings, or type instead.");return;}
        if(!localOnly&&!SpeechRecognizer.isRecognitionAvailable(context)){listener.error("No speech recognition service is installed. You can still type.");return;}
        try{
            if(localOnly&&Build.VERSION.SDK_INT>=31)recognizer=SpeechRecognizer.createOnDeviceSpeechRecognizer(context);else recognizer=SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(this);active=true;
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-GB");intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true);intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
            listener.state("LISTENING");recognizer.startListening(intent);
        }catch(Exception e){active=false;listener.error("Speech could not start. Check microphone permission and speech settings.");}
    }
    void close(){active=false;if(recognizer!=null){recognizer.cancel();recognizer.destroy();recognizer=null;}}
    public void onReadyForSpeech(Bundle b){if(active)listener.state("LISTENING");}
    public void onBeginningOfSpeech(){}
    public void onRmsChanged(float rms){}
    public void onBufferReceived(byte[] b){}
    public void onEndOfSpeech(){if(active)listener.state("TRANSCRIBING");}
    public void onError(int error){if(!active)return;active=false;String text;
        switch(error){case SpeechRecognizer.ERROR_NO_MATCH:text="I didn't catch that. Tap the microphone to try again.";break;case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:text="No speech heard. Tap to try again.";break;case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:text="Microphone permission is needed for voice input.";break;default:text="Speech recognition stopped. Check your speech service or use typing.";}
        listener.error(text);
    }
    public void onResults(Bundle b){if(!active)return;active=false;ArrayList<String> values=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);if(values==null||values.isEmpty())listener.error("No words were recognised.");else listener.result(values.get(0));}
    public void onPartialResults(Bundle b){if(!active)return;ArrayList<String> values=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);if(values!=null&&!values.isEmpty())listener.partial(values.get(0));}
    public void onEvent(int event,Bundle b){}
}
