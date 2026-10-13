package eu.getmuse.muse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

public class PlaybackService extends Service {
    static final String CHANNEL = "muse_playback";
    static final int NOTIF = 7;
    static final String ACTION_PLAY = "eu.getmuse.muse.PLAY";
    static final String ACTION_PAUSE = "eu.getmuse.muse.PAUSE";
    static final String ACTION_NEXT = "eu.getmuse.muse.NEXT";
    static final String ACTION_PREV = "eu.getmuse.muse.PREV";

    MediaSession session;
    String title = "Muse";
    boolean playing;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Now playing");
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);

        session = new MediaSession(this, "Muse");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.dispatch("play"); }
            @Override public void onPause() { MainActivity.dispatch("pause"); }
            @Override public void onSkipToNext() { MainActivity.dispatch("next"); }
            @Override public void onSkipToPrevious() { MainActivity.dispatch("prev"); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        if (ACTION_PLAY.equals(act)) {
            playing = true;
            MainActivity.dispatch("play");
        } else if (ACTION_PAUSE.equals(act)) {
            playing = false;
            MainActivity.dispatch("pause");
        } else if (ACTION_NEXT.equals(act)) {
            MainActivity.dispatch("next");
        } else if (ACTION_PREV.equals(act)) {
            MainActivity.dispatch("prev");
        } else if (intent != null) {
            playing = intent.getBooleanExtra("playing", true);
            String t = intent.getStringExtra("title");
            if (t != null && !t.isEmpty()) title = t;
        }
        startFg();
        return START_NOT_STICKY;
    }

    void startFg() {
        long actions = PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Muse")
                .build());
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(this, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Action prev = action(ACTION_PREV, 1, android.R.drawable.ic_media_previous, "Previous");
        Notification.Action toggle = playing
                ? action(ACTION_PAUSE, 2, android.R.drawable.ic_media_pause, "Pause")
                : action(ACTION_PLAY, 3, android.R.drawable.ic_media_play, "Play");
        Notification.Action next = action(ACTION_NEXT, 4, android.R.drawable.ic_media_next, "Next");

        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_muse)
                .setContentTitle(title)
                .setContentText("Muse")
                .setContentIntent(content)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(prev)
                .addAction(toggle)
                .addAction(next)
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF, n);
        }
    }

    Notification.Action action(String action, int code, int icon, String label) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getService(this, code, i, flags);
        return new Notification.Action.Builder(icon, label, pi).build();
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
