package eu.getmuse.muse;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicInteger;

final class Updater {
    static final String FEED = "https://getmuse.eu/api/android";
    static final AtomicInteger busy = new AtomicInteger(0);
    static File pending;
    static String prompted;

    static void arm(MainActivity a) {
        Thread t = new Thread(() -> {
            try { Thread.sleep(2800); } catch (InterruptedException e) { return; }
            while (!a.isFinishing()) {
                try { tick(a); } catch (Exception ignored) {
                    busy.set(0);
                    ui(a, () -> a.showUpdate(false, null, 0));
                }
                try { Thread.sleep(90_000); } catch (InterruptedException e) { return; }
            }
        }, "muse-upd");
        t.setDaemon(true);
        t.start();
    }

    static void onResume(MainActivity a) {
        if (pending != null && pending.isFile() && canInstall(a)) {
            File apk = pending;
            pending = null;
            install(a, apk);
        }
    }

    static long localCode(MainActivity a) {
        try {
            PackageInfo p = a.getPackageManager().getPackageInfo(a.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return p.getLongVersionCode();
            return p.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    static boolean canInstall(MainActivity a) {
        if (Build.VERSION.SDK_INT < 26) return true;
        return a.getPackageManager().canRequestPackageInstalls();
    }

    static void tick(MainActivity a) throws Exception {
        if (!busy.compareAndSet(0, 1)) return;
        HttpURLConnection c = (HttpURLConnection) new URL(FEED).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.connect();
        if (c.getResponseCode() != 200) { busy.set(0); c.disconnect(); return; }
        String body;
        try (InputStream in = c.getInputStream();
             java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            body = bos.toString("UTF-8");
        } finally {
            c.disconnect();
        }
        JSONObject j = new JSONObject(body);
        int remote = j.optInt("versionCode", 0);
        String ver = j.optString("version", "");
        String url = j.optString("url", "");
        String sha = j.optString("sha256", "");
        long size = j.optLong("size", 0);
        if (remote <= localCode(a) || url.isEmpty()) { busy.set(0); return; }
        if (ver.equals(prompted)) { busy.set(0); return; }

        ui(a, () -> a.showUpdate(true, ver, 40));
        File dir = new File(a.getCacheDir(), "update");
        if (!dir.exists() && !dir.mkdirs()) { busy.set(0); return; }
        File dest = new File(dir, "Muse.apk");
        File part = new File(dir, "Muse.apk.part");
        if (part.exists()) //noinspection ResultOfMethodCallIgnored
            part.delete();

        HttpURLConnection d = (HttpURLConnection) new URL(url).openConnection();
        d.setConnectTimeout(15000);
        d.setReadTimeout(180000);
        d.connect();
        if (d.getResponseCode() != 200) { d.disconnect(); busy.set(0); ui(a, () -> a.showUpdate(false, null, 0)); return; }
        long total = d.getContentLengthLong() > 0 ? d.getContentLengthLong() : size;
        try (InputStream in = d.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[256 * 1024];
            long got = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                got += n;
                int p = total > 0 ? (int) (80 + 820.0 * got / total) : Math.min(880, 100 + (int) (got / 40000));
                int prog = p;
                ui(a, () -> a.showUpdate(true, ver, prog));
            }
        } finally {
            d.disconnect();
        }

        if (!sha.isEmpty()) {
            ui(a, () -> a.showUpdate(true, ver, 930));
            String got = sha256(part);
            if (!sha.equalsIgnoreCase(got)) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                busy.set(0);
                ui(a, () -> a.showUpdate(false, null, 0));
                return;
            }
        }
        if (dest.exists()) //noinspection ResultOfMethodCallIgnored
            dest.delete();
        if (!part.renameTo(dest)) {
            busy.set(0);
            ui(a, () -> a.showUpdate(false, null, 0));
            return;
        }
        ui(a, () -> a.showUpdate(true, ver, 1000));
        prompted = ver;
        busy.set(0);
        ui(a, () -> install(a, dest));
    }

    static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    static void install(MainActivity a, File apk) {
        if (!apk.isFile()) return;
        if (!canInstall(a)) {
            pending = apk;
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                i.setData(Uri.parse("package:" + a.getPackageName()));
                a.startActivity(i);
                Toast.makeText(a, "Allow Muse to install updates", Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {}
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".update", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(i);
        } catch (Exception e) {
            pending = apk;
        }
    }

    static void ui(MainActivity a, Runnable r) {
        if (a.isFinishing()) return;
        a.runOnUiThread(r);
    }
}
