using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Muse;

static class Program
{
    public const string Home = "https://getmuse.eu/pc";
    public const string DesktopVersion = "2.0.3";
    public const string MutexName = @"Local\MuseDesktop.1";
    public static readonly int WmShow = Native.RegisterWindowMessage("MuseDesktop.Show");

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var created);
        if (!created)
        {
            Native.PostMessage(Native.HwndBroadcast, WmShow, IntPtr.Zero, IntPtr.Zero);
            return;
        }

        Native.SetCurrentProcessExplicitAppUserModelID("eu.getmuse.Muse");
        AutoUpdater.SweepOld();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}

sealed class MainForm : Form
{
    static readonly Color Bg = Color.FromArgb(10, 10, 11);
    static readonly Color Ink = Color.FromArgb(244, 244, 245);
    const int BarH = 32;
    const int Grip = 8;
    const int MinW = 1020;
    const int MinH = 680;
    const int MiniTriggerW = 700;
    const int MiniTriggerH = 280;

    readonly TitleBar _bar;
    readonly Panel _stage;
    readonly Label _boot;
    readonly UpdatePane _update;
    readonly NotifyIcon _tray;
    readonly TrayPopup _trayMenu;
    WebView2? _web;
    bool _exit;
    bool _updating;
    bool _mini;
    FormWindowState _trayState = FormWindowState.Normal;
    Rectangle _trayBounds;

    public MainForm()
    {
        Text = "Muse";
        Name = "Muse";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = true;
        ShowIcon = true;
        MinimumSize = new Size(MinW, MinH);
        Size = new Size(1280, 820);
        BackColor = Bg;
        ForeColor = Ink;
        DoubleBuffered = false;
        KeyPreview = true;
        Padding = new Padding(Grip);
        Icon = AppIcon.Full;

        _bar = new TitleBar { Dock = DockStyle.Top, Height = BarH };
        _bar.Minimize += (_, _) => WindowState = FormWindowState.Minimized;
        _bar.Maximize += (_, _) => ToggleMax();
        _bar.CloseClicked += (_, _) => Close();
        _bar.Drag += (_, e) =>
        {
            if (e.Clicks == 2)
            {
                ToggleMax();
                return;
            }
            if (WindowState == FormWindowState.Maximized) return;
            Native.ReleaseCapture();
            Native.SendMessage(Handle, Native.WmNclButtonDown, Native.HtCaption, IntPtr.Zero);
        };

        _boot = new Label
        {
            Text = "",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 12f, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = Ink,
            BackColor = Bg,
        };

        _stage = new Panel { Dock = DockStyle.Fill, BackColor = Bg };
        _update = new UpdatePane { Dock = DockStyle.Fill, Visible = false };
        _stage.Controls.Add(_boot);

        Controls.Add(_stage);
        Controls.Add(_bar);

        _trayMenu = new TrayPopup();
        _trayMenu.OpenClicked += (_, _) => Reveal();
        _trayMenu.ExitClicked += (_, _) => ExitApp();

        _tray = new NotifyIcon
        {
            Text = "Muse",
            Visible = true,
        };
        try { _tray.Icon = (Icon)Icon.FromHandle(AppIcon.SmallHandle).Clone(); }
        catch { _tray.Icon = AppIcon.Full; }
        _tray.MouseUp += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) Reveal();
            else if (e.Button == MouseButtons.Right) _trayMenu.PopupAt(Cursor.Position);
        };

        LoadBounds();
        Resize += (_, _) =>
        {
            _bar.SetMaximized(WindowState == FormWindowState.Maximized);
            Padding = WindowState == FormWindowState.Maximized ? Padding.Empty : new Padding(Grip);
            UpdateMiniMode();
        };
        Load += async (_, _) =>
        {
            await BootWeb();
            AutoUpdater.Arm(
                this,
                begin: v => BeginUpdate(v),
                progress: p => _update.SetProgress(p),
                fail: () => EndUpdate(false),
                apply: () => _ = QuitForUpdate());
        };
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (_updating && !_exit && e.CloseReason is CloseReason.UserClosing)
        {
            e.Cancel = true;
            return;
        }
        if (!_exit && e.CloseReason is CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }
        SaveBounds();
        try
        {
            _tray.Visible = false;
            _tray.Dispose();
            _trayMenu.Dispose();
        }
        catch { }
        base.OnFormClosing(e);
    }

    void HideToTray()
    {
        SaveBounds();
        _trayMenu.Hide();
        _trayState = WindowState == FormWindowState.Minimized ? FormWindowState.Normal : WindowState;
        _trayBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        Hide();
    }

    void Reveal()
    {
        _trayMenu.Hide();
        if (!Visible)
        {
            Show();
            if (_trayState == FormWindowState.Maximized)
                WindowState = FormWindowState.Maximized;
            else
            {
                WindowState = FormWindowState.Normal;
                if (_trayBounds.Width >= MinimumSize.Width && _trayBounds.Height >= MinimumSize.Height)
                    Bounds = _trayBounds;
            }
        }
        else if (WindowState == FormWindowState.Minimized)
        {
            WindowState = FormWindowState.Normal;
        }
        Activate();
        Native.SetForegroundWindow(Handle);
        Native.RoundCorners(Handle);
        Native.DarkMode(Handle);
        StampIcon();
        _bar.SetMaximized(WindowState == FormWindowState.Maximized);
    }

    void BeginUpdate(string ver)
    {
        _updating = true;
        try
        {
            if (_web != null)
            {
                _web.Visible = false;
                _web.Enabled = false;
            }
        }
        catch { }
        _boot.Visible = false;
        if (_update.Parent != _stage)
            _stage.Controls.Add(_update);
        _update.Begin(ver);
        _update.BringToFront();
    }

    void EndUpdate(bool closing)
    {
        _updating = false;
        _update.Stop();
        _stage.Controls.Remove(_update);
        if (closing || _web is null) return;
        try
        {
            _web.Enabled = true;
            _web.Visible = true;
            _web.BringToFront();
        }
        catch { }
    }

    void ExitApp()
    {
        _exit = true;
        Close();
    }

    async Task QuitForUpdate()
    {
        _exit = true;
        _update.Stop();
        _stage.Controls.Remove(_update);
        try
        {
            if (_web != null)
            {
                _web.Visible = false;
                try { _web.CoreWebView2?.Stop(); } catch { }
                _stage.Controls.Remove(_web);
                _web.Dispose();
                _web = null;
            }
        }
        catch { }
        await Task.Delay(700);
        if (!IsDisposed) Close();
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

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData is Keys.F5 or Keys.F12
            or (Keys.Control | Keys.R)
            or (Keys.Control | Keys.Shift | Keys.R)
            or (Keys.Control | Keys.F5)
            or (Keys.Control | Keys.F)
            or (Keys.Control | Keys.G)
            or (Keys.Control | Keys.P)
            or (Keys.Control | Keys.U)
            or (Keys.Control | Keys.L)
            or (Keys.Control | Keys.H)
            or (Keys.Control | Keys.J))
            return true;
        return base.ProcessCmdKey(ref msg, keyData);
    }

    async Task BootWeb()
    {
        Native.RoundCorners(Handle);
        Native.DarkMode(Handle);

        try
        {
            var ver = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrEmpty(ver)) throw new InvalidOperationException("no runtime");
        }
        catch
        {
            ShowRuntimeMissing();
            return;
        }

        var data = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Muse", "webview");
        Directory.CreateDirectory(data);

        _web = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Bg,
            Visible = false,
        };
        _stage.Controls.Add(_web);
        _boot.Visible = true;

        var opts = new CoreWebView2EnvironmentOptions(
            additionalBrowserArguments: "--disable-features=msWebOOUI,PasswordManagerOnboarding,AutofillServerCommunication");
        var env = await CoreWebView2Environment.CreateAsync(null, data, opts);
        await _web.EnsureCoreWebView2Async(env);
        StampIcon();

        var s = _web.CoreWebView2.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.AreDevToolsEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsSwipeNavigationEnabled = false;

        await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("""
            document.documentElement.classList.add('muse-app');
            window.__museDesktop = 1;
            const css = document.createElement('style');
            css.textContent = `
              .muse-app *:focus, .muse-app *:focus-visible {
                outline: none !important; outline-offset: 0 !important;
              }
              .muse-app .search input:focus, .muse-app .search input:focus-visible {
                outline: none !important; box-shadow: none !important;
              }
              .muse-app #onboard input:focus, .muse-app #onboard input:focus-visible {
                outline: 2px solid #fff !important; outline-offset: 0 !important; box-shadow: none !important;
              }
              .muse-app ::selection { background: transparent; color: inherit; }
            `;
            document.documentElement.appendChild(css);
            try {
              const w = window.chrome && window.chrome.webview;
              if (w && w.addEventListener) {
                w.addEventListener('message', (e) => {
                  let d = e && e.data;
                  try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
                  if (!d || d.type !== 'muse-chrome') return;
                  document.documentElement.classList.toggle('muse-mini', !!d.mini);
                  if (d.mini) {
                    const p = document.getElementById('player');
                    if (p) p.hidden = false;
                  }
                });
              }
            } catch {}
            """);

        _web.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri)
                {
                    UseShellExecute = true
                });
            }
            catch { }
        };
        _web.CoreWebView2.NavigationCompleted += (_, e) =>
        {
            BeginInvoke(() =>
            {
                if (_web is null || _updating) return;
                if (e.IsSuccess)
                {
                    _web.Visible = true;
                    _boot.Visible = false;
                    _boot.Cursor = Cursors.Default;
                    StampIcon();
                    PushMiniChrome(force: true);
                    return;
                }
                _web.Visible = false;
                _boot.Visible = true;
                _boot.Text = "Muse is waking up.\nClick to retry.";
                _boot.Cursor = Cursors.Hand;
            });
        };
        _boot.Click += (_, _) =>
        {
            if (_updating || _web?.CoreWebView2 is null) return;
            _boot.Text = "";
            try { _web.CoreWebView2.Navigate(Program.Home); } catch { }
        };

        _web.CoreWebView2.Navigate(Program.Home);
    }

    void ShowRuntimeMissing()
    {
        _boot.Visible = true;
        _boot.Font = new Font("Segoe UI", 12f, FontStyle.Regular, GraphicsUnit.Point);
        _boot.Text = "Muse needs the Edge WebView2 runtime.\nClick the window to download it.";
        _boot.Cursor = Cursors.Hand;
        _boot.Click += (_, _) =>
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                    "https://go.microsoft.com/fwlink/p/?LinkId=2124703")
                { UseShellExecute = true });
            }
            catch { }
        };
    }

    void ToggleMax()
    {
        WindowState = WindowState == FormWindowState.Maximized
            ? FormWindowState.Normal
            : FormWindowState.Maximized;
        _bar.SetMaximized(WindowState == FormWindowState.Maximized);
    }

    void UpdateMiniMode()
    {
        var mini = WindowState == FormWindowState.Normal
            && (ClientSize.Width <= MiniTriggerW || ClientSize.Height <= MiniTriggerH);
        if (mini == _mini)
        {
            PushMiniChrome();
            return;
        }
        _mini = mini;
        _bar.Height = mini ? 26 : BarH;
        _bar.SetMini(mini);
        PushMiniChrome(force: true);
    }

    void PushMiniChrome(bool force = false)
    {
        _ = force;
        if (_web?.CoreWebView2 is null) return;
        try
        {
            _web.CoreWebView2.PostWebMessageAsJson(
                "{\"type\":\"muse-chrome\",\"mini\":" + (_mini ? "true" : "false") + "}");
        }
        catch { }
    }

    string BoundsPath()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Muse");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "window.json");
    }

    void LoadBounds()
    {
        try
        {
            var p = BoundsPath();
            if (!File.Exists(p)) return;
            var w = JsonSerializer.Deserialize<WinBounds>(File.ReadAllText(p));
            if (w is null) return;
            var r = new Rectangle(w.X, w.Y, Math.Max(w.W, MinW), Math.Max(w.H, MinH));
            if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
            }
            if (w.Max) WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    void SaveBounds()
    {
        try
        {
            var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(BoundsPath(), JsonSerializer.Serialize(new WinBounds(
                b.X, b.Y, b.Width, b.Height, WindowState == FormWindowState.Maximized)));
        }
        catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Program.WmShow)
        {
            Reveal();
            return;
        }

        if (m.Msg == Native.WmGetMinMaxInfo)
        {
            var screen = Screen.FromHandle(Handle);
            var wa = screen.WorkingArea;
            var info = Marshal.PtrToStructure<Native.MinMaxInfo>(m.LParam);
            info.ptMaxPosition = new Native.Point(wa.X, wa.Y);
            info.ptMaxSize = new Native.Point(wa.Width, wa.Height);
            info.ptMinTrackSize = new Native.Point(
                LogicalToDeviceUnits(MinW), LogicalToDeviceUnits(MinH));
            Marshal.StructureToPtr(info, m.LParam, true);
            m.Result = IntPtr.Zero;
            return;
        }

        if (m.Msg == Native.WmNcHitTest && WindowState != FormWindowState.Maximized)
        {
            var screenPt = new Point(
                unchecked((short)(nint)m.LParam),
                unchecked((short)((nint)m.LParam >> 16)));
            var p = PointToClient(screenPt);
            var w = ClientSize.Width;
            var h = ClientSize.Height;
            var g = Math.Max(LogicalToDeviceUnits(Grip), 6);
            var c = Math.Max(LogicalToDeviceUnits(14), 10);
            var left = p.X < g;
            var right = p.X >= w - g;
            var top = p.Y < g;
            var bottom = p.Y >= h - g;
            var cornerL = p.X < c;
            var cornerR = p.X >= w - c;
            var cornerT = p.Y < c;
            var cornerB = p.Y >= h - c;
            if (cornerT && cornerL) { m.Result = (IntPtr)Native.HtTopLeft; return; }
            if (cornerT && cornerR) { m.Result = (IntPtr)Native.HtTopRight; return; }
            if (cornerB && cornerL) { m.Result = (IntPtr)Native.HtBottomLeft; return; }
            if (cornerB && cornerR) { m.Result = (IntPtr)Native.HtBottomRight; return; }
            if (left) { m.Result = (IntPtr)Native.HtLeft; return; }
            if (right) { m.Result = (IntPtr)Native.HtRight; return; }
            if (top) { m.Result = (IntPtr)Native.HtTop; return; }
            if (bottom) { m.Result = (IntPtr)Native.HtBottom; return; }
        }

        base.WndProc(ref m);
    }

    record WinBounds(int X, int Y, int W, int H, bool Max);
}

sealed class TrayPopup : Form
{
    static readonly Color Sheet = Color.FromArgb(22, 22, 24);
    static readonly Color Ink = Color.FromArgb(244, 244, 245);
    long _showTick;

    public event EventHandler? OpenClicked;
    public event EventHandler? ExitClicked;

    public TrayPopup()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        BackColor = Sheet;
        ForeColor = Ink;
        Size = new Size(208, 126);

        var head = new TrayHeader { Location = new Point(8, 8), Size = new Size(192, 30) };
        var open = new TrayRow("Open") { Location = new Point(8, 44), Size = new Size(192, 34) };
        var close = new TrayRow("Close app") { Location = new Point(8, 80), Size = new Size(192, 34) };
        open.Click += (_, _) => { Hide(); OpenClicked?.Invoke(this, EventArgs.Empty); };
        close.Click += (_, _) => { Hide(); ExitClicked?.Invoke(this, EventArgs.Empty); };
        Controls.Add(head);
        Controls.Add(open);
        Controls.Add(close);

        Deactivate += (_, _) =>
        {
            if (Environment.TickCount64 - _showTick < 280)
            {
                BeginInvoke(() =>
                {
                    Activate();
                    Native.SetForegroundWindow(Handle);
                });
                return;
            }
            Hide();
        };
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.RoundCorners(Handle);
        Native.DarkMode(Handle);
    }

    public void PopupAt(Point cursor)
    {
        if (Visible)
        {
            Hide();
            return;
        }
        var wa = Screen.FromPoint(cursor).WorkingArea;
        var x = cursor.X - Width / 2;
        var y = cursor.Y - Height - 10;
        if (x + Width > wa.Right) x = wa.Right - Width - 8;
        if (x < wa.Left) x = wa.Left + 8;
        if (y < wa.Top) y = cursor.Y + 10;
        if (y + Height > wa.Bottom) y = wa.Bottom - Height - 8;
        Location = new Point(x, y);
        _showTick = Environment.TickCount64;
        Show();
        Native.RoundCorners(Handle);
        Native.DarkMode(Handle);
        Activate();
        Native.SetForegroundWindow(Handle);
    }
}

sealed class TrayHeader : Control
{
    public TrayHeader()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.FromArgb(22, 22, 24);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(BackColor);
        var x = 6;
        if (AppIcon.Mark != null)
        {
            g.DrawImage(AppIcon.Mark, x, Math.Max(0, (Height - 16) / 2), 16, 16);
            x += 22;
        }
        using var f = new Font("Segoe UI Semibold", 10f, FontStyle.Bold, GraphicsUnit.Point);
        using var br = new SolidBrush(Color.FromArgb(244, 244, 245));
        var ty = (Height - f.Height) / 2f;
        g.DrawString("Muse", f, br, x, ty);
    }
}

sealed class TrayRow : Control
{
    readonly string _label;
    bool _hover;

    public TrayRow(string label)
    {
        _label = label;
        Cursor = Cursors.Hand;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.FromArgb(22, 22, 24);
    }

    protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(BackColor);
        if (_hover)
        {
            using var path = new GraphicsPath();
            const int r = 8;
            var b = new Rectangle(0, 0, Width - 1, Height - 1);
            path.AddArc(b.X, b.Y, r, r, 180, 90);
            path.AddArc(b.Right - r, b.Y, r, r, 270, 90);
            path.AddArc(b.Right - r, b.Bottom - r, r, r, 0, 90);
            path.AddArc(b.X, b.Bottom - r, r, r, 90, 90);
            path.CloseFigure();
            using var fill = new SolidBrush(Color.FromArgb(40, 40, 44));
            g.FillPath(fill, path);
        }
        using var f = new Font("Segoe UI Semibold", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
        using var br = new SolidBrush(Color.FromArgb(244, 244, 245));
        var ty = (Height - f.Height) / 2f;
        g.DrawString(_label, f, br, 12, ty);
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
        var p = Path.Combine(dir, "app.ico");
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
        using var s = asm.GetManifestResourceStream("Muse.icon.ico")
            ?? asm.GetManifestResourceStream("icon.ico");
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

sealed class TitleBar : Panel
{
    static readonly Color Bg = Color.FromArgb(10, 10, 11);
    readonly CaptionBtn _min;
    readonly CaptionBtn _max;
    readonly CaptionBtn _close;
    readonly Font _labelFont = new("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
    readonly SolidBrush _labelBrush = new(Color.FromArgb(244, 244, 245));
    Image? _logo;

    public event EventHandler? Minimize;
    public event EventHandler? Maximize;
    public event EventHandler? CloseClicked;
    public event MouseEventHandler? Drag;

    public TitleBar()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Bg;

        // Anchor right so buttons never sit on the title before the bar gets its real width.
        // Create buttons BEFORE Height= — setting Height triggers OnLayout/LayoutBtns.
        _min = new CaptionBtn(CaptionKind.Min) { Width = 46, Height = 32, Anchor = AnchorStyles.Top | AnchorStyles.Right };
        _max = new CaptionBtn(CaptionKind.Max) { Width = 46, Height = 32, Anchor = AnchorStyles.Top | AnchorStyles.Right };
        _close = new CaptionBtn(CaptionKind.Close) { Width = 46, Height = 32, Anchor = AnchorStyles.Top | AnchorStyles.Right };
        _min.Click += (_, _) => Minimize?.Invoke(this, EventArgs.Empty);
        _max.Click += (_, _) => Maximize?.Invoke(this, EventArgs.Empty);
        _close.Click += (_, _) => CloseClicked?.Invoke(this, EventArgs.Empty);
        Controls.Add(_min);
        Controls.Add(_max);
        Controls.Add(_close);
        Height = 32;

        LoadLogo();
        MouseDown += OnBarMouseDown;
        HandleCreated += (_, _) => LayoutBtns();
        LayoutBtns();
    }

    protected override void OnLayout(LayoutEventArgs levent)
    {
        base.OnLayout(levent);
        LayoutBtns();
    }

    public void SetMaximized(bool max)
    {
        _max.SetKind(max ? CaptionKind.Restore : CaptionKind.Max);
    }

    public void SetMini(bool mini)
    {
        _max.Visible = !mini;
        LayoutBtns();
    }

    void LoadLogo()
    {
        try { _logo = (Image)AppIcon.Mark.Clone(); } catch { }
    }

    void LayoutBtns()
    {
        // Height= in ctor fires OnLayout before caption buttons exist — bail until ready.
        if (_close is null || _max is null || _min is null) return;
        // Before dock assigns a real width, keep caption glyphs off the title text.
        var w = Width > 160 ? Width : 1600;
        _close.Location = new Point(w - 46, 0);
        if (_max.Visible)
        {
            _max.Location = new Point(w - 92, 0);
            _min.Location = new Point(w - 138, 0);
        }
        else
        {
            _min.Location = new Point(w - 92, 0);
        }
        _close.Height = Height;
        _max.Height = Height;
        _min.Height = Height;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

        var x = 12;
        if (_logo != null)
        {
            const int sz = 16;
            g.DrawImage(_logo, x, Math.Max(0, (Height - sz) / 2), sz, sz);
            x += sz + 7;
        }

        var title = "Muse Desktop " + Program.DesktopVersion;
        var maxW = Math.Max(8, Width - 146 - x);
        if (maxW < 8) return;
        using var sf = new StringFormat
        {
            Alignment = StringAlignment.Near,
            LineAlignment = StringAlignment.Center,
            FormatFlags = StringFormatFlags.NoWrap,
            Trimming = StringTrimming.EllipsisCharacter,
        };
        g.DrawString(title, _labelFont, _labelBrush, new RectangleF(x, 0, maxW, Height), sf);
    }

    void OnBarMouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        Drag?.Invoke(this, e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _logo?.Dispose();
            _labelFont.Dispose();
            _labelBrush.Dispose();
        }
        base.Dispose(disposing);
    }
}

enum CaptionKind { Min, Max, Restore, Close }

sealed class CaptionBtn : Control
{
    static readonly Color Hover = Color.FromArgb(40, 40, 44);
    static readonly Color CloseHover = Color.FromArgb(232, 17, 35);
    static readonly Color Glyph = Color.FromArgb(244, 244, 245);
    bool _hover;
    CaptionKind _kind;

    public CaptionBtn(CaptionKind kind)
    {
        _kind = kind;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.UserPaint, true);
        BackColor = Color.FromArgb(10, 10, 11);
        Size = new Size(46, 32);
        Cursor = Cursors.Hand;
    }

    public void SetKind(CaptionKind kind)
    {
        _kind = kind;
        Invalidate();
    }

    protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(_hover ? (_kind == CaptionKind.Close ? CloseHover : Hover) : Color.FromArgb(10, 10, 11));
        var ink = _hover && _kind == CaptionKind.Close ? Color.White : Glyph;
        using var pen = new Pen(ink, 1.15f);
        var cx = Width / 2f;
        var cy = Height / 2f;
        switch (_kind)
        {
            case CaptionKind.Min:
                g.DrawLine(pen, cx - 5, cy, cx + 5, cy);
                break;
            case CaptionKind.Max:
                g.DrawRectangle(pen, cx - 5, cy - 5, 10, 10);
                break;
            case CaptionKind.Restore:
                g.DrawRectangle(pen, cx - 3, cy - 6, 8, 8);
                g.DrawLine(pen, cx - 6, cy - 2, cx - 6, cy + 5);
                g.DrawLine(pen, cx - 6, cy + 5, cx + 1, cy + 5);
                g.DrawLine(pen, cx - 6, cy - 2, cx - 3, cy - 2);
                break;
            case CaptionKind.Close:
                g.DrawLine(pen, cx - 4.5f, cy - 4.5f, cx + 4.5f, cy + 4.5f);
                g.DrawLine(pen, cx + 4.5f, cy - 4.5f, cx - 4.5f, cy + 4.5f);
                break;
        }
    }
}

sealed class UpdatePane : Panel
{
    static readonly Color Bg = Color.FromArgb(10, 10, 11);
    static readonly Color Ink = Color.FromArgb(244, 244, 245);
    readonly System.Windows.Forms.Timer _anim = new() { Interval = 33 };
    readonly Font _text = new("Segoe UI Semibold", 16f, FontStyle.Regular, GraphicsUnit.Point);
    string _version = "";
    float _progress;
    float _spin;
    float _fade = 0.55f;
    int _fadeDir = 1;

    public UpdatePane()
    {
        DoubleBuffered = true;
        BackColor = Bg;
        Visible = false;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        _anim.Tick += (_, _) =>
        {
            _spin = (_spin + 7f) % 360f;
            _fade += _fadeDir * 0.02f;
            if (_fade >= 1f) { _fade = 1f; _fadeDir = -1; }
            if (_fade <= 0.45f) { _fade = 0.45f; _fadeDir = 1; }
            Invalidate(AnimRect());
        };
    }

    public void Begin(string version)
    {
        _version = version;
        _progress = 0.04f;
        _spin = 0;
        Visible = true;
        BringToFront();
        _anim.Start();
        Invalidate();
    }

    public void SetProgress(float value)
    {
        _progress = Math.Clamp(value, 0, 1);
    }

    Rectangle AnimRect()
    {
        var cx = Width / 2;
        var cy = Height / 2;
        return new Rectangle(cx - 200, cy - 160, 400, 320);
    }

    public void Stop()
    {
        _anim.Stop();
        Visible = false;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Bg);

        var cx = Width / 2f;
        var cy = Height / 2f - 18;
        const int mark = 52;
        var dest = new Rectangle((int)(cx - mark / 2f), (int)(cy - 70), mark, mark);
        using (var path = new GraphicsPath())
        {
            path.AddEllipse(dest);
            var old = g.Clip;
            g.SetClip(path);
            g.DrawImage(AppIcon.Mark, dest);
            g.Clip = old;
        }

        var ring = Rectangle.Inflate(dest, 10, 10);
        using (var dim = new Pen(Color.FromArgb(28, 255, 255, 255), 2f))
            g.DrawEllipse(dim, ring);
        using (var glow = new Pen(Color.FromArgb(230, 244, 244, 245), 2.2f)
        { StartCap = LineCap.Round, EndCap = LineCap.Round })
            g.DrawArc(glow, ring, _spin, 86);

        var label = string.IsNullOrWhiteSpace(_version)
            ? "Updating"
            : "Updating to version " + _version;
        var alpha = (int)(255 * _fade);
        using var br = new SolidBrush(Color.FromArgb(alpha, Ink));
        using var sf = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Near,
        };
        g.DrawString(label, _text, br, new RectangleF(24, dest.Bottom + 28, Width - 48, 40), sf);

        var barW = Math.Min(280, Width - 120);
        var bar = new Rectangle((int)(cx - barW / 2f), dest.Bottom + 78, barW, 4);
        using (var track = new SolidBrush(Color.FromArgb(22, 255, 255, 255)))
        using (var path = RoundBar(bar))
            g.FillPath(track, path);
        var fillW = Math.Max(6, (int)(bar.Width * _progress));
        using (var fill = new SolidBrush(Ink))
        using (var path = RoundBar(new Rectangle(bar.X, bar.Y, fillW, bar.Height)))
            g.FillPath(fill, path);
    }

    static GraphicsPath RoundBar(Rectangle r)
    {
        var p = new GraphicsPath();
        var d = Math.Max(2, r.Height);
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _anim.Stop();
            _anim.Dispose();
            _text.Dispose();
        }
        base.Dispose(disposing);
    }
}

static class Native
{
    public const int WmNclButtonDown = 0x00A1;
    public const int WmNcHitTest = 0x0084;
    public const int WmGetMinMaxInfo = 0x0024;
    public const int WmSetIcon = 0x0080;
    public const int GclpHIcon = -14;
    public const int GclpHIconSm = -34;
    public const int HtCaption = 2;
    public const int HtLeft = 10, HtRight = 11, HtTop = 12, HtTopLeft = 13, HtTopRight = 14;
    public const int HtBottom = 15, HtBottomLeft = 16, HtBottomRight = 17;
    public static readonly IntPtr HwndBroadcast = new(0xFFFF);

    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, int w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern int RegisterWindowMessage(string n);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW")]
    public static extern IntPtr SetClassLongPtr(IntPtr h, int n, IntPtr dw);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint PrivateExtractIcons(
        string file, int index, int cx, int cy,
        [Out] IntPtr[] icons, [Out] uint[] ids, uint n, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string appID);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcess(
        string? lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref StartupInfo lpStartupInfo,
        out ProcessInformation lpProcessInformation);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

    public const uint CreateNoWindow = 0x08000000;
    public const uint CreateNewProcessGroup = 0x00000200;
    public const uint CreateBreakawayFromJob = 0x01000000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StartupInfo
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    public static bool StartHiddenDetached(string exe, string args)
    {
        try
        {
            var si = new StartupInfo();
            si.cb = Marshal.SizeOf<StartupInfo>();
            si.dwFlags = 1;
            si.wShowWindow = 0;
            var cl = new StringBuilder("\"" + exe + "\" " + args);
            const uint flags = CreateNoWindow | CreateNewProcessGroup | CreateBreakawayFromJob;
            if (!CreateProcess(null, cl, IntPtr.Zero, IntPtr.Zero, false, flags,
                    IntPtr.Zero, null, ref si, out var pi))
                return false;
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            return true;
        }
        catch { return false; }
    }

    public static void RoundCorners(IntPtr hwnd)
    {
        try { int v = 2; DwmSetWindowAttribute(hwnd, 33, ref v, sizeof(int)); } catch { }
    }

    public static void DarkMode(IntPtr hwnd)
    {
        try { int v = 1; DwmSetWindowAttribute(hwnd, 20, ref v, sizeof(int)); } catch { }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X, Y; public Point(int x, int y) { X = x; Y = y; } }

    [StructLayout(LayoutKind.Sequential)]
    public struct MinMaxInfo
    {
        public Point ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize;
    }
}
