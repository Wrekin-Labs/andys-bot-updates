package uk.wrekinlabs.jarvis;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import android.animation.ValueAnimator;
import android.provider.Settings;

/** Original vector HUD, drawn natively. Animation indicates state, not audio amplitude. */
final class OrbView extends View {
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF arc=new RectF();
    private final Typeface face=Typeface.create("sans-serif-medium",Typeface.NORMAL);
    private RadialGradient glow;
    private float phase;
    private String state="READY";
    private ValueAnimator animator;
    private boolean motion=true;
    OrbView(Context context){super(context);setContentDescription("Jarvis ready. Tap to speak");setFocusable(true);setClickable(true);}
    void setState(String value){state=value;setContentDescription("Jarvis "+value.toLowerCase(java.util.Locale.UK)+". Tap to speak");animateIfNeeded();invalidate();}
    void setMotion(boolean enabled){motion=enabled;animateIfNeeded();}
    private void animateIfNeeded(){
        if(animator!=null){animator.cancel();animator=null;}
        boolean active=state!=null&&!state.equals("READY")&&!state.equals("OFFLINE")&&!state.equals("ERROR");
        if(motion&&active&&isAttachedToWindow()&&getWindowVisibility()==VISIBLE&&Settings.Global.getFloat(getContext().getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)!=0){
            animator=ValueAnimator.ofFloat(0,360);animator.setDuration(5000);animator.setRepeatCount(ValueAnimator.INFINITE);animator.setInterpolator(new android.view.animation.LinearInterpolator());
            animator.addUpdateListener(a->{phase=(float)a.getAnimatedValue();invalidate();});animator.start();
        }
    }
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();animateIfNeeded();}
    @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);animateIfNeeded();}
    @Override protected void onDetachedFromWindow(){if(animator!=null)animator.cancel();super.onDetachedFromWindow();}
    @Override public boolean performClick(){super.performClick();return true;}
    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){
        super.onSizeChanged(w,h,oldw,oldh);
        float r=Math.min(w,h)*.42f;
        if(r>0)glow=new RadialGradient(w/2f,h/2f,r,new int[]{Color.rgb(16,61,72),Color.TRANSPARENT},null,Shader.TileMode.CLAMP);
    }
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);float x=getWidth()/2f,y=getHeight()/2f,r=Math.min(getWidth(),getHeight())*.42f;
        int accent=state.equals("ERROR")?Color.rgb(255,155,137):Color.rgb(99,233,224);
        paint.setStyle(Paint.Style.FILL);paint.setShader(glow);c.drawCircle(x,y,r,paint);paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.5f);paint.setColor(Color.rgb(28,66,79));c.drawCircle(x,y,r,paint);c.drawCircle(x,y,r*.72f,paint);
        for(int i=0;i<60;i++){double a=Math.toRadians(i*6);float inner=r*(i%5==0?.88f:.94f);c.drawLine(x+(float)Math.cos(a)*inner,y+(float)Math.sin(a)*inner,x+(float)Math.cos(a)*r,y+(float)Math.sin(a)*r,paint);}
        paint.setStrokeWidth(4);paint.setColor(accent);arc.set(x-r*.82f,y-r*.82f,x+r*.82f,y+r*.82f);
        for(int i=0;i<3;i++)c.drawArc(arc,phase+i*120,60,false,paint);
        paint.setStrokeWidth(2);c.drawCircle(x,y,r*.55f,paint);paint.setStyle(Paint.Style.FILL);paint.setTextAlign(Paint.Align.CENTER);paint.setTypeface(face);paint.setTextSize(r*.39f);c.drawText("J",x,y+r*.08f,paint);
        paint.setTextSize(r*.105f);paint.setColor(Color.rgb(179,215,224));c.drawText(state,x,y+r*.31f,paint);
    }
}
