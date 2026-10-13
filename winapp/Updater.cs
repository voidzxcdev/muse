using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;

namespace Muse;

static class AutoUpdater
{
    const string Feed = "https://getmuse.eu/api/desktop";
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(12) };
    static int _busy;

    public static void SweepOld()
    {
        try
        {
            var self = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(self))
            {
                var old = self + ".old";
                if (File.Exists(old)) File.Delete(old);
            }
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Muse", "update");
            foreach (var name in new[] { "apply.cmd", "apply.vbs", "Muse.exe.part" })
            {
                var p = Path.Combine(dir, name);
                if (File.Exists(p)) File.Delete(p);
            }
        }
        catch { }
    }

    public static void Arm(Control ui, Action<string> begin, Action<float> progress, Action fail, Action apply)
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(2500);
            while (true)
            {
                try { await Tick(ui, begin, progress, fail, apply); }
                catch { Ui(ui, fail); Interlocked.Exchange(ref _busy, 0); }
                await Task.Delay(TimeSpan.FromSeconds(90));
            }
        });
    }

    static void Ui(Control ui, Action a)
    {
        try
        {
            if (ui.IsDisposed) return;
            if (ui.InvokeRequired && ui.IsHandleCreated) ui.BeginInvoke(a);
            else a();
        }
        catch { }
    }

    static async Task Tick(Control ui, Action<string> begin, Action<float> progress, Action fail, Action apply)
    {
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;

        using var req = new HttpRequestMessage(HttpMethod.Get, Feed);
        req.Headers.TryAddWithoutValidation("Cache-Control", "no-cache");
        req.Headers.TryAddWithoutValidation("Pragma", "no-cache");
        using var resp = await Http.SendAsync(req);
        if (!resp.IsSuccessStatusCode) { Interlocked.Exchange(ref _busy, 0); return; }
        await using var stream = await resp.Content.ReadAsStreamAsync();
        var meta = await JsonSerializer.DeserializeAsync<DeskMeta>(stream, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        if (meta is null || string.IsNullOrWhiteSpace(meta.Version) || string.IsNullOrWhiteSpace(meta.Url))
        {
            Interlocked.Exchange(ref _busy, 0);
            return;
        }
        if (!Version.TryParse(meta.Version, out var remote)
            || !Version.TryParse(Program.DesktopVersion, out var local)
            || remote <= local)
        {
            Interlocked.Exchange(ref _busy, 0);
            return;
        }

        Ui(ui, () => begin(meta.Version));

        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Muse", "update");
        Directory.CreateDirectory(dir);
        var dest = Path.Combine(dir, "Muse.exe");
        var part = dest + ".part";
        if (File.Exists(part)) File.Delete(part);

        try
        {
            using (var down = await Http.GetAsync(meta.Url, HttpCompletionOption.ResponseHeadersRead))
            {
                down.EnsureSuccessStatusCode();
                var total = down.Content.Headers.ContentLength ?? meta.Size ?? 0;
                await using var src = await down.Content.ReadAsStreamAsync();
                await using var file = File.Create(part);
                var buf = new byte[256 * 1024];
                long got = 0;
                int n;
                while ((n = await src.ReadAsync(buf)) > 0)
                {
                    await file.WriteAsync(buf.AsMemory(0, n));
                    got += n;
                    var p = total > 0 ? 0.08f + 0.82f * got / total : Math.Min(0.88f, 0.1f + got / 80_000_000f);
                    Ui(ui, () => progress(p));
                }
            }

            if (!string.IsNullOrWhiteSpace(meta.Sha256))
            {
                Ui(ui, () => progress(0.93f));
                await using var fs = File.OpenRead(part);
                var hash = Convert.ToHexString(await SHA256.HashDataAsync(fs)).ToLowerInvariant();
                if (!hash.Equals(meta.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("hash");
            }

            if (File.Exists(dest)) File.Delete(dest);
            File.Move(part, dest);

            var self = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(self) || !File.Exists(self))
                throw new InvalidOperationException("self");

            Ui(ui, () => progress(0.97f));
            TryStageInPlace(dest, self);

            var bat = Path.Combine(dir, "apply.cmd");
            var pid = Environment.ProcessId;
            File.WriteAllText(bat, $"""
                @echo off
                setlocal EnableExtensions
                set "SRC={dest}"
                set "DST={self}"
                set "PID={pid}"
                :wait
                ping 127.0.0.1 -n 2 >nul
                tasklist /FI "PID eq %PID%" 2>nul | findstr /C:"%PID%" >nul
                if not errorlevel 1 goto wait
                ping 127.0.0.1 -n 5 >nul
                set N=0
                :retry
                set /a N+=1
                attrib -R -S -H "%DST%" >nul 2>nul
                copy /Y "%SRC%" "%DST%" >nul 2>nul
                if not errorlevel 1 goto ok
                if exist "%DST%.old" del /F /Q "%DST%.old" >nul 2>nul
                if exist "%DST%" ren "%DST%" "Muse.exe.old" >nul 2>nul
                copy /Y "%SRC%" "%DST%" >nul 2>nul
                if not errorlevel 1 goto ok
                if %N% LSS 50 (
                  ping 127.0.0.1 -n 2 >nul
                  goto retry
                )
                if exist "%DST%.old" if not exist "%DST%" ren "%DST%.old" "Muse.exe" >nul 2>nul
                exit
                :ok
                start "" "%DST%"
                del /F /Q "%SRC%" >nul 2>nul
                del /F /Q "%DST%.old" >nul 2>nul
                exit
                """);

            if (!Native.StartHiddenDetached("cmd.exe", "/d /s /c \"" + bat + "\""))
                throw new InvalidOperationException("spawn");

            Ui(ui, () => progress(1f));
            await Task.Delay(120);
            Ui(ui, apply);
        }
        catch
        {
            try { if (File.Exists(part)) File.Delete(part); } catch { }
            Interlocked.Exchange(ref _busy, 0);
            Ui(ui, fail);
        }
    }

    static void TryStageInPlace(string src, string self)
    {
        var old = self + ".old";
        try
        {
            if (File.Exists(old)) File.Delete(old);
            File.Move(self, old);
            try { File.Copy(src, self, true); }
            catch
            {
                try { File.Move(old, self); } catch { }
            }
        }
        catch { }
    }

    sealed class DeskMeta
    {
        public string? Version { get; set; }
        public string? Url { get; set; }
        public string? Sha256 { get; set; }
        public long? Size { get; set; }
    }
}
