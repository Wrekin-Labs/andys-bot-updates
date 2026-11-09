package uk.wrekinlabs.jarvis;
import android.content.*;
import org.json.*;
/** Bounded on-phone transcript. Only completed AI pairs become request history. */
final class ConversationStore {
    private final SharedPreferences prefs;
    ConversationStore(Context context){prefs=context.getSharedPreferences("conversation",Context.MODE_PRIVATE);}
    JSONArray turns(){try{return new JSONArray(prefs.getString("turns","[]"));}catch(JSONException e){return new JSONArray();}}
    boolean add(String question,String answer,String source){
        try{
            JSONArray previous=turns(),next=new JSONArray();
            for(int i=Math.max(0,previous.length()-19);i<previous.length();i++)next.put(previous.getJSONObject(i));
            next.put(new JSONObject().put("question",question).put("answer",answer).put("source",source).put("at",System.currentTimeMillis()));
            return prefs.edit().putString("turns",next.toString()).commit();
        }catch(JSONException e){return false;}
    }
    JSONArray history(){
        JSONArray turns=turns(),result=new JSONArray();int budget=12000;
        java.util.ArrayList<JSONObject> selected=new java.util.ArrayList<>();
        for(int i=turns.length()-1;i>=0&&selected.size()<5;i--){
            JSONObject t=turns.optJSONObject(i);if(t==null||!"ai".equals(t.optString("source")))continue;
            int size=t.optString("question").length()+t.optString("answer").length();
            if(size>budget)break;budget-=size;selected.add(0,t);
        }
        try{for(JSONObject t:selected){result.put(new JSONObject().put("role","user").put("content",t.getString("question")));result.put(new JSONObject().put("role","assistant").put("content",t.getString("answer")));}}catch(JSONException ignored){}
        return result;
    }
    boolean clear(){return prefs.edit().clear().commit();}
}
