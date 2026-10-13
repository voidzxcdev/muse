package eu.getmuse.muse;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.Manifest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.lang.ref.WeakReference;
import java.util.Collections;

public class MainActivity extends AppCompatActivity {
    static final String HOME = "https://getmuse.eu/mobile/android";
    static final String INJECT =
            "window.__museAndroid=1;"
                    + "document.documentElement.classList.add('muse-android');"
                    + "try{var n=window.MuseAndroid&&MuseAndroid.navBottom&&MuseAndroid.navBottom();"
                    + "if(n)document.documentElement.style.setProperty('--android-nav',n+'px');}catch(e){}";
    static WeakReference<MainActivity> live = new WeakReference<>(null);

    WebView web;
    View upd;
    TextView updText;
    ProgressBar updBar;
    int navCssPx = 32;
    ValueCallback<Uri[]> fileCallback;
    final ActivityResultLauncher<Intent> files = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                Uri[] uris = WebChromeClient.FileChooserParams.parseResult(
                        result.getResultCode(), result.getData());
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(uris);
                    fileCallback = null;
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        live = new WeakReference<>(this);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(0xFF0A0A0B);
        getWindow().setNavigationBarColor(0xFF0A0A0B);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        WindowInsetsControllerCompat bars =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);
        setContentView(R.layout.activity_main);
        View root = findViewById(R.id.root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets nav = insets.getInsets(
                    WindowInsetsCompat.Type.navigationBars()
                            | WindowInsetsCompat.Type.mandatorySystemGestures());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(sys.left, sys.top, sys.right, ime.bottom);
            float d = getResources().getDisplayMetrics().density;
            int css = Math.max(32, Math.round(Math.max(nav.bottom, sys.bottom) / d));
            if (css != navCssPx) {
                navCssPx = css;
                pushNav();
            }
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(root);
        web = findViewById(R.id.web);
        upd = findViewById(R.id.upd);
        updText = findViewById(R.id.updText);
        updBar = findViewById(R.id.updBar);
        setupWeb();
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(HOME);
        }
        Updater.arm(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    void setupWeb() {
        web.setBackgroundColor(Color.parseColor("#0A0A0B"));
        web.setHapticFeedbackEnabled(true);
        boolean emu = android.os.Build.FINGERPRINT.contains("generic")
                || android.os.Build.FINGERPRINT.contains("emulator")
                || "google_sdk".equals(android.os.Build.PRODUCT);
        if (!emu) web.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        String ver = "1.0";
        try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        s.setUserAgentString(s.getUserAgentString() + " MuseAndroid/" + ver);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "MuseAndroid");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, INJECT, Collections.singleton("*"));
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(INJECT, null);
                pushNav();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme();
                if ("mailto".equals(scheme) || "tel".equals(scheme) || "market".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    files.launch(params.createIntent());
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setMimeType(mime);
                req.addRequestHeader("cookie", CookieManager.getInstance().getCookie(url));
                req.addRequestHeader("User-Agent", userAgent);
                req.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        URLUtil.guessFileName(url, disposition, mime));
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                dm.enqueue(req);
                Toast.makeText(this, "Downloading…", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {}
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        Updater.onResume(this);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        if (web != null) web.resumeTimers();
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (web != null) web.resumeTimers();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        try { stopService(new Intent(this, PlaybackService.class)); } catch (Exception ignored) {}
        if (live.get() == this) live = new WeakReference<>(null);
        if (web != null && !isChangingConfigurations()) {
            web.loadUrl("about:blank");
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    static void dispatch(String cmd) {
        MainActivity a = live.get();
        if (a == null) return;
        a.runOnUiThread(() -> a.remoteCmd(cmd));
    }

    void remoteCmd(String cmd) {
        if (web == null || cmd == null) return;
        String js;
        switch (cmd) {
            case "play":
                js = "(function(){try{userPaused=false;lastPauseAt=0;doPlay();}catch(e){}})()";
                break;
            case "pause":
                js = "(function(){try{userPaused=true;doPause();}catch(e){}})()";
                break;
            case "next":
                js = "(function(){try{step(1)();}catch(e){}})()";
                break;
            case "prev":
                js = "(function(){try{step(-1)();}catch(e){}})()";
                break;
            default:
                return;
        }
        web.evaluateJavascript(js, null);
    }

    void ensureNotifPerm() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 91);
    }

    void setPlayback(boolean playing, String title) {
        if (playing) ensureNotifPerm();
        Intent i = new Intent(this, PlaybackService.class);
        i.putExtra("playing", playing);
        i.putExtra("title", title == null || title.isEmpty() ? "Muse" : title);
        try {
            ContextCompat.startForegroundService(this, i);
        } catch (Exception ignored) {}
    }

    void showUpdate(boolean on, String ver, int progress) {
        if (upd == null) return;
        upd.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on && ver != null && !ver.isEmpty() && updText != null) {
            updText.setText("Updating to " + ver);
        }
        if (updBar != null) updBar.setProgress(Math.max(0, Math.min(1000, progress)));
    }

    void pushNav() {
        if (web == null) return;
        String js = "document.documentElement.style.setProperty('--android-nav','" + navCssPx + "px')";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    public class Bridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public int navBottom() {
            return navCssPx;
        }

        @JavascriptInterface
        public void playback(boolean playing, String title) {
            runOnUiThread(() -> setPlayback(playing, title));
        }

        @JavascriptInterface
        public void haptic(String kind) {
            runOnUiThread(() -> {
                if (web == null) return;
                String k = kind == null ? "select" : kind;
                int code;
                switch (k) {
                    case "confirm":
                        code = Build.VERSION.SDK_INT >= 30
                                ? HapticFeedbackConstants.CONFIRM
                                : HapticFeedbackConstants.CONTEXT_CLICK;
                        break;
                    case "reject":
                        code = Build.VERSION.SDK_INT >= 30
                                ? HapticFeedbackConstants.REJECT
                                : HapticFeedbackConstants.LONG_PRESS;
                        break;
                    case "long":
                        code = HapticFeedbackConstants.LONG_PRESS;
                        break;
                    case "press":
                    case "impact":
                        code = HapticFeedbackConstants.VIRTUAL_KEY;
                        break;
                    case "select":
                    case "tick":
                        code = HapticFeedbackConstants.CLOCK_TICK;
                        break;
                    default:
                        code = HapticFeedbackConstants.KEYBOARD_TAP;
                        break;
                }
                web.performHapticFeedback(code);
            });
        }
    }
}
