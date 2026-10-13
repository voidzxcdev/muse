package eu.getmuse.muse;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.webkit.WebView;

/** Chromium pauses HTML media when the WebView is not VISIBLE. Stay VISIBLE. */
public class KeepWebView extends WebView {
    public KeepWebView(Context context) {
        super(context);
    }

    public KeepWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public KeepWebView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (visibility != View.GONE) {
            super.onWindowVisibilityChanged(View.VISIBLE);
        }
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        if (visibility != View.GONE) {
            super.onVisibilityChanged(changedView, View.VISIBLE);
        } else {
            super.onVisibilityChanged(changedView, visibility);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasWindowFocus) {
        super.onWindowFocusChanged(true);
    }
}
