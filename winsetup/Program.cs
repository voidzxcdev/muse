using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;

namespace MuseSetup;

static class Program
{
    public const string Home = "https://getmuse.eu/";
    public const string AuthorUrl = "https://github.com/voidzxcdev";
    public const string Feed = "https://getmuse.eu/api/desktop";

    [STAThread]
    static void Main(string[] args)
    {
        Native.SetCurrentProcessExplicitAppUserModelID("eu.getmuse.MuseSetup");
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Any(a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase)))
        {
            Uninstaller.Run();
            return;
        }
        Application.Run(new SetupForm());
    }
}

static class Paths
{
    public static string InstallDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", "Muse");
    public static string Exe => Path.Combine(InstallDir, "Muse.exe");
    public static string SetupCopy => Path.Combine(InstallDir, "Muse-Setup.exe");
    public static string StartMenu => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
        "Programs", "Muse.lnk");
    public static string Desktop => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        "Muse.lnk");
}

sealed class SetupForm : Form
{
    enum Stage { Ready, Work, Done, Fail }

    static readonly Color Bg = Color.FromArgb(10, 10, 11);
    static readonly Color Ink = Color.FromArgb(244, 244, 245);
    static readonly Color Dim = Color.FromArgb(140, 244, 244, 245);
    static readonly Color Track = Color.FromArgb(18, 255, 255, 255);

    Stage _stage = Stage.Ready;
    bool _hoverInstall, _downInstall, _hoverLaunch, _hoverClose;
    float _progress;
    string _status = "Getting Muse ready…";
    string _error = "";
    readonly Image _logo;
    Rectangle _installHit, _launchHit, _closeHit;

    public SetupForm()
    {
        Text = "Muse Setup";
        Name = "Muse Setup";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(400, 440);
        BackColor = Bg;
        ForeColor = Ink;
        ShowInTaskbar = true;
        ShowIcon = true;
        DoubleBuffered = true;
        KeyPreview = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Icon = AppIcon.Full;
        _logo = Brand.Mark;

        MouseMove += (_, e) => Hit(e.Location, false, false);
        MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) Hit(e.Location, true, false); };
        MouseUp += (_, e) => { if (e.Button == MouseButtons.Left) Hit(e.Location, false, true); };
        MouseLeave += (_, _) =>
        {
            _hoverInstall = _hoverLaunch = _hoverClose = _downInstall = false;
            Cursor = Cursors.Default;
            Invalidate();
        };
        KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape && _stage != Stage.Work) Close(); };
        FormClosing += (_, e) => { if (_stage == Stage.Work) e.Cancel = true; };
        Load += (_, _) =>
        {
            Native.RoundCorners(Handle);
            Native.DarkMode(Handle);
            StampIcon();
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        StampIcon();
    }

    void StampIcon()
    {
        try
        {
            Icon = AppIcon.Full;
            if (!IsHandleCreated) return;
            Native.SendMessage(Handle, Native.WmSetIcon, 0, AppIcon.SmallHandle);
            Native.SendMessage(Handle, Native.WmSetIcon, 1, AppIcon.BigHandle);
            Native.SetClassLongPtr(Handle, Native.GclpHIcon, AppIcon.BigHandle);
            Native.SetClassLongPtr(Handle, Native.GclpHIconSm, AppIcon.SmallHandle);
        }
        catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WmNcHitTest)
        {
            base.WndProc(ref m);
            if ((int)m.Result == Native.HtClient)
            {
                var p = PointToClient(new Point(
                    unchecked((short)(long)m.LParam),
                    unchecked((short)((long)m.LParam >> 16))));
                if (!_closeHit.Contains(p) && !_installHit.Contains(p) && !_launchHit.Contains(p))
                    m.Result = (IntPtr)Native.HtCaption;
            }
            return;
        }
        base.WndProc(ref m);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Bg);

        _closeHit = new Rectangle(Width - 48, 16, 28, 28);
        using (var pen = new Pen(_hoverClose ? Color.White : Ink, 1.35f))
        {
            var c = _closeHit;
            g.DrawLine(pen, c.X + 8, c.Y + 8, c.Right - 8, c.Bottom - 8);
            g.DrawLine(pen, c.Right - 8, c.Y + 8, c.X + 8, c.Bottom - 8);
        }

        DrawBrand(g, 118);

        if (_stage == Stage.Ready)
        {
            _installHit = new Rectangle(64, 250, Width - 128, 48);
            DrawPill(g, _installHit, Ink, "Install", Bg, _hoverInstall, _downInstall);
            _launchHit = Rectangle.Empty;
        }
        else if (_stage == Stage.Work)
        {
            DrawCentered(g, _status, Face.Ui, Dim, 188);
            var bar = new Rectangle(64, 268, Width - 128, 6);
            using (var bg = new SolidBrush(Track))
            using (var path = Round(bar, 6))
                g.FillPath(bg, path);
            var w = Math.Max(6, (int)(bar.Width * Math.Clamp(_progress, 0, 1)));
            using (var fg = new SolidBrush(Ink))
            using (var path = Round(new Rectangle(bar.X, bar.Y, w, bar.Height), 6))
                g.FillPath(fg, path);
            _installHit = Rectangle.Empty;
            _launchHit = Rectangle.Empty;
        }
        else if (_stage == Stage.Done)
        {
            _launchHit = new Rectangle(64, 250, Width - 128, 48);
            DrawPill(g, _launchHit, Ink, "Open Muse", Bg, _hoverLaunch, false);
            _installHit = Rectangle.Empty;
        }
        else
        {
            DrawCentered(g, _error, Face.Tiny, Color.FromArgb(220, 140, 140), 188);
            _installHit = new Rectangle(64, 250, Width - 128, 48);
            DrawPill(g, _installHit, Ink, "Try again", Bg, _hoverInstall, _downInstall);
            _launchHit = Rectangle.Empty;
        }
    }

    void DrawBrand(Graphics g, float y)
    {
        const int mark = 40;
        const int gap = 12;
        var name = "Muse";
        var sz = g.MeasureString(name, Face.Display);
        var total = mark + gap + sz.Width;
        var x = (Width - total) / 2f;
        var my = y + (sz.Height - mark) / 2f;
        var dest = new Rectangle((int)Math.Round(x), (int)Math.Round(my), mark, mark);
        using (var path = new GraphicsPath())
        {
            path.AddEllipse(dest);
            var old = g.Clip;
            g.SetClip(path);
            g.DrawImage(_logo, dest);
            g.Clip = old;
        }
        using var br = new SolidBrush(Ink);
        g.DrawString(name, Face.Display, br, x + mark + gap, y);
    }

    void Hit(Point p, bool down, bool up)
    {
        var hand = _closeHit.Contains(p)
            || (_stage is Stage.Ready or Stage.Fail && _installHit.Contains(p))
            || (_stage == Stage.Done && _launchHit.Contains(p));
        Cursor = hand ? Cursors.Hand : Cursors.Default;

        bool ch(ref bool slot, bool now)
        {
            if (slot == now) return false;
            slot = now;
            return true;
        }

        var dirty = false;
        dirty |= ch(ref _hoverClose, _closeHit.Contains(p));
        dirty |= ch(ref _hoverInstall, _installHit.Contains(p));
        dirty |= ch(ref _hoverLaunch, _launchHit.Contains(p));
        if (down) dirty |= ch(ref _downInstall, _installHit.Contains(p));
        if (up && _downInstall) { _downInstall = false; dirty = true; }
        if (dirty) Invalidate();

        if (!up) return;
        if (_closeHit.Contains(p) && _stage != Stage.Work) { Close(); return; }
        if (_stage is Stage.Ready or Stage.Fail && _installHit.Contains(p)) { _ = Install(); return; }
        if (_stage == Stage.Done && _launchHit.Contains(p)) { Launch(); Close(); }
    }

    async Task Install()
    {
        if (_stage == Stage.Work) return;
        _stage = Stage.Work;
        _progress = 0.02f;
        _status = "Talking to Muse…";
        Invalidate();
        try
        {
            Directory.CreateDirectory(Paths.InstallDir);
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(12) };
            var feed = await http.GetStringAsync(Program.Feed);
            var meta = JsonSerializer.Deserialize<DeskMeta>(feed, new JsonSerializerOptions
            { PropertyNameCaseInsensitive = true });
            if (meta is null || string.IsNullOrWhiteSpace(meta.Url))
                throw new InvalidOperationException("Update feed is empty.");

            _status = "Downloading Muse…";
            Invalidate();
            var tmp = Path.Combine(Paths.InstallDir, "Muse.exe.part");
            using (var resp = await http.GetAsync(meta.Url, HttpCompletionOption.ResponseHeadersRead))
            {
                resp.EnsureSuccessStatusCode();
                var total = resp.Content.Headers.ContentLength ?? meta.Size ?? 0;
                await using var src = await resp.Content.ReadAsStreamAsync();
                await using var dst = File.Create(tmp);
                var buf = new byte[256 * 1024];
                long got = 0;
                int n;
                while ((n = await src.ReadAsync(buf)) > 0)
                {
                    await dst.WriteAsync(buf.AsMemory(0, n));
                    got += n;
                    _progress = total > 0 ? 0.05f + 0.8f * got / total : Math.Min(0.85f, _progress + 0.01f);
                    Invalidate();
                }
            }

            if (!string.IsNullOrWhiteSpace(meta.Sha256))
            {
                _status = "Checking the file…";
                Invalidate();
                await using var fs = File.OpenRead(tmp);
                var hash = Convert.ToHexString(await SHA256.HashDataAsync(fs)).ToLowerInvariant();
                if (!hash.Equals(meta.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Download didn't match the signed build.");
            }

            _progress = 0.9f;
            _status = "Placing Muse…";
            Invalidate();
            if (File.Exists(Paths.Exe)) File.Delete(Paths.Exe);
            File.Move(tmp, Paths.Exe);

            var self = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(self) && File.Exists(self))
            {
                try { File.Copy(self, Paths.SetupCopy, true); } catch { }
            }

            Shortcut.Write(Paths.StartMenu, Paths.Exe);
            Shortcut.Write(Paths.Desktop, Paths.Exe);
            Uninstaller.Register(meta.Version ?? "1.1.1");

            _progress = 1;
            _stage = Stage.Done;
            Invalidate();
        }
        catch (Exception ex)
        {
            _stage = Stage.Fail;
            _error = ex.Message.Length > 90 ? ex.Message[..90] + "…" : ex.Message;
            Invalidate();
        }
    }

    void Launch()
    {
        try
        {
            Process.Start(new ProcessStartInfo(Paths.Exe) { UseShellExecute = true });
        }
        catch { }
    }

    static void DrawCentered(Graphics g, string text, Font font, Color color, float y)
    {
        using var br = new SolidBrush(color);
        var sz = g.MeasureString(text, font);
        g.DrawString(text, font, br, (WidthSafe(g) - sz.Width) / 2f, y);
    }

    static float WidthSafe(Graphics g) => g.VisibleClipBounds.Width;

    static void DrawPill(Graphics g, Rectangle r, Color bg, string text, Color fg, bool hover, bool down)
    {
        var box = r;
        if (down) box.Inflate(-2, -2);
        else if (hover) box.Inflate(1, 1);
        using var path = Round(box, box.Height);
        using var br = new SolidBrush(hover && !down ? Color.FromArgb(230, 230, 232) : bg);
        g.FillPath(br, path);
        using var tb = new SolidBrush(fg);
        var sz = g.MeasureString(text, Face.Button);
        g.DrawString(text, Face.Button, tb, box.X + (box.Width - sz.Width) / 2f, box.Y + (box.Height - sz.Height) / 2f);
    }

    static GraphicsPath Round(Rectangle r, int rad)
    {
        var p = new GraphicsPath();
        var d = Math.Max(2, rad);
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !ReferenceEquals(_logo, AppIcon.Mark) && !ReferenceEquals(_logo, Brand.Mark))
            _logo.Dispose();
        base.Dispose(disposing);
    }
}

sealed class DeskMeta
{
    public string? Version { get; set; }
    public string? Url { get; set; }
    public string? Sha256 { get; set; }
    public long? Size { get; set; }
}

static class Face
{
    static readonly PrivateFontCollection Bag = new();
    static readonly List<GCHandle> Pins = [];
    public static readonly Font Display;
    public static readonly Font Button;
    public static readonly Font Ui;
    public static readonly Font Tiny;

    static Face()
    {
        Add("MuseSetup.ClashDisplay.ttf");
        Add("MuseSetup.SatoshiMedium.ttf");
        Add("MuseSetup.SatoshiBold.ttf");
        var clash = Find("Clash") ?? FontFamily.GenericSansSerif;
        var satoshi = Find("Satoshi") ?? FontFamily.GenericSansSerif;
        Display = new Font(clash, 28f, FontStyle.Regular, GraphicsUnit.Point);
        Button = new Font(satoshi, 12f, FontStyle.Bold, GraphicsUnit.Point);
        Ui = new Font(satoshi, 11f, FontStyle.Regular, GraphicsUnit.Point);
        Tiny = new Font(satoshi, 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    }

    static FontFamily? Find(string part) =>
        Bag.Families.FirstOrDefault(f => f.Name.Contains(part, StringComparison.OrdinalIgnoreCase));

    static void Add(string name)
    {
        using var s = typeof(Program).Assembly.GetManifestResourceStream(name);
        if (s is null) return;
        var data = new byte[s.Length];
        s.ReadExactly(data);
        var pin = GCHandle.Alloc(data, GCHandleType.Pinned);
        Pins.Add(pin);
        Bag.AddMemoryFont(pin.AddrOfPinnedObject(), data.Length);
    }
}

static class Brand
{
    public static readonly Image Mark = Load();

    static Image Load()
    {
        using var s = typeof(Program).Assembly.GetManifestResourceStream("MuseSetup.muselogo.png");
        if (s != null) return new Bitmap(s);
        return AppIcon.Mark;
    }
}

static class AppIcon
{
    public static readonly Icon Full;
    public static readonly IntPtr SmallHandle;
    public static readonly IntPtr BigHandle;
    public static readonly Bitmap Mark;

    static AppIcon()
    {
        var raw = ReadBytes();
        var path = Persist(raw);
        SmallHandle = NativeIcon(path, 16);
        BigHandle = NativeIcon(path, 32);
        var hFull = NativeIcon(path, 256);
        Full = hFull != IntPtr.Zero
            ? (Icon)Icon.FromHandle(hFull).Clone()
            : new Icon(new MemoryStream(raw));
        Mark = BitmapFromPngFrame(raw, 32)
            ?? new Bitmap(32, 32, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        if (SmallHandle == IntPtr.Zero) SmallHandle = Full.Handle;
        if (BigHandle == IntPtr.Zero) BigHandle = Full.Handle;
    }

    static string Persist(byte[] raw)
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Muse");
        Directory.CreateDirectory(dir);
        var p = Path.Combine(dir, "setup.ico");
        File.WriteAllBytes(p, raw);
        return p;
    }

    static IntPtr NativeIcon(string file, int size)
    {
        foreach (var src in new[] { file, Environment.ProcessPath })
        {
            if (string.IsNullOrEmpty(src) || !File.Exists(src)) continue;
            try
            {
                var hs = new IntPtr[1];
                var ids = new uint[1];
                if (Native.PrivateExtractIcons(src, 0, size, size, hs, ids, 1, 0) > 0
                    && hs[0] != IntPtr.Zero)
                    return hs[0];
            }
            catch { }
        }
        return IntPtr.Zero;
    }

    static Bitmap? BitmapFromPngFrame(byte[] ico, int want)
    {
        if (ico.Length < 22 || BitConverter.ToUInt16(ico, 2) != 1) return null;
        int count = BitConverter.ToUInt16(ico, 4);
        int bestOff = 0, bestSz = 0, bestDiff = int.MaxValue;
        for (int i = 0; i < count; i++)
        {
            int o = 6 + i * 16;
            if (o + 16 > ico.Length) break;
            int w = ico[o] == 0 ? 256 : ico[o];
            int sz = BitConverter.ToInt32(ico, o + 8);
            int off = BitConverter.ToInt32(ico, o + 12);
            int diff = Math.Abs(w - want);
            if (off >= 0 && sz >= 8 && off + sz <= ico.Length && diff < bestDiff)
            {
                bestDiff = diff;
                bestOff = off;
                bestSz = sz;
            }
        }
        if (bestSz < 8 || ico[bestOff] != 0x89) return null;
        using var ms = new MemoryStream(ico, bestOff, bestSz, writable: false);
        using var img = Image.FromStream(ms);
        return new Bitmap(img);
    }

    static byte[] ReadBytes()
    {
        var asm = typeof(AppIcon).Assembly;
        using var s = asm.GetManifestResourceStream("MuseSetup.icon.ico");
        if (s != null)
        {
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
        var p = Path.Combine(AppContext.BaseDirectory, "icon.ico");
        if (File.Exists(p)) return File.ReadAllBytes(p);
        throw new FileNotFoundException("Muse icon.ico");
    }
}

static class Shortcut
{
    public static void Write(string lnk, string target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(lnk)!);
        var ty = Type.GetTypeFromProgID("WScript.Shell");
        if (ty is null) return;
        dynamic shell = Activator.CreateInstance(ty)!;
        var sc = shell.CreateShortcut(lnk);
        sc.TargetPath = target;
        sc.WorkingDirectory = Path.GetDirectoryName(target);
        sc.IconLocation = target;
        sc.Save();
    }
}

static class Uninstaller
{
    const string Key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Muse";

    public static void Register(string version)
    {
        using var k = Registry.CurrentUser.CreateSubKey(Key);
        k.SetValue("DisplayName", "Muse");
        k.SetValue("DisplayVersion", version);
        k.SetValue("Publisher", "https://github.com/voidzxcdev");
        k.SetValue("URLInfoAbout", Program.AuthorUrl);
        k.SetValue("HelpLink", Program.Home);
        k.SetValue("InstallLocation", Paths.InstallDir);
        k.SetValue("DisplayIcon", Paths.Exe);
        k.SetValue("UninstallString", $"\"{Paths.SetupCopy}\" --uninstall");
        k.SetValue("NoModify", 1, RegistryValueKind.DWord);
        k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        k.SetValue("EstimatedSize", 51000, RegistryValueKind.DWord);
    }

    public static void Run()
    {
        try
        {
            foreach (var p in Process.GetProcessesByName("Muse"))
            {
                try { p.Kill(true); } catch { }
            }
        }
        catch { }
        try { File.Delete(Paths.StartMenu); } catch { }
        try { File.Delete(Paths.Desktop); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(Key, false); } catch { }
        try
        {
            if (Directory.Exists(Paths.InstallDir))
                Directory.Delete(Paths.InstallDir, true);
        }
        catch { }
    }
}

static class Native
{
    public const int WmNcHitTest = 0x0084;
    public const int WmSetIcon = 0x0080;
    public const int GclpHIcon = -14;
    public const int GclpHIconSm = -34;
    public const int HtClient = 1;
    public const int HtCaption = 2;

    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, int w, IntPtr l);
    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW")]
    public static extern IntPtr SetClassLongPtr(IntPtr h, int n, IntPtr dw);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint PrivateExtractIcons(
        string file, int index, int cx, int cy,
        [Out] IntPtr[] icons, [Out] uint[] ids, uint n, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string appID);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);

    public static void RoundCorners(IntPtr hwnd)
    {
        try { int v = 2; DwmSetWindowAttribute(hwnd, 33, ref v, sizeof(int)); } catch { }
    }

    public static void DarkMode(IntPtr hwnd)
    {
        try { int v = 1; DwmSetWindowAttribute(hwnd, 20, ref v, sizeof(int)); } catch { }
    }
}
