package uk.wrekinlabs.jarvis;
import java.util.Locale;
import java.util.regex.*;
/** Only explicit user text reaches this parser. Model output is never executed. */
public final class LocalCommand {
    public final String kind, value;
    private LocalCommand(String kind,String value){this.kind=kind;this.value=value;}
    public static LocalCommand parse(String raw){
        String original=raw.trim().replaceFirst("(?i)^(?:hey\\s+)?jarvis[,!]?\\s+","");
        String text=original.toLowerCase(Locale.UK).replaceAll("[?.!]$","").trim();
        if(text.equals("time")||text.equals("what time is it"))return new LocalCommand("time","");
        if(text.equals("date")||text.equals("what is today's date")||text.equals("what day is it"))return new LocalCommand("date","");
        if(text.equals("battery")||text.equals("battery level"))return new LocalCommand("battery","");
        if(text.equals("help")||text.equals("what can you do"))return new LocalCommand("help","");
        if(text.equals("show notes")||text.equals("open memory"))return new LocalCommand("notes","");
        if(text.equals("open wifi settings")||text.equals("open wi-fi settings"))return new LocalCommand("wifi","");
        if(text.equals("open bluetooth settings"))return new LocalCommand("bluetooth","");
        if(text.equals("open calculator"))return new LocalCommand("calculator","");
        if(text.equals("stop")||text.equals("stop everything"))return new LocalCommand("stop","");
        Matcher remember=Pattern.compile("(?is)^(?:remember|save note)\\s+(.+)$").matcher(original);
        if(remember.matches())return new LocalCommand("remember",remember.group(1).trim());
        Matcher timer=Pattern.compile("^(?:set (?:a )?)?timer (?:for )?(\\d{1,3}) minutes?$").matcher(text);
        if(timer.matches()){int minutes=Integer.parseInt(timer.group(1));if(minutes>0&&minutes<=180)return new LocalCommand("timer",String.valueOf(minutes*60));}
        return new LocalCommand("chat",original);
    }
}
