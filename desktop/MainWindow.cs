using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Own.Desktop;

internal sealed class MainWindow : Form
{
    private readonly DesktopOptions options;
    private readonly BackendHost backend;
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(246, 247, 249) };
    private readonly Label loading = new() { Dock = DockStyle.Fill, Text = "正在打开 Own…", TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Microsoft YaHei UI", 12), BackColor = Color.FromArgb(246, 247, 249) };
    private readonly CancellationTokenSource lifetime = new();
    private readonly string instanceId;
    private Task? startup;
    private TaskCompletionSource<JsonElement>? closeReply;
    private string? closeRequestId;
    private bool ready, closing, allowClose;
    private bool presenting;
    private Rectangle presentationBounds;
    private FormWindowState presentationWindowState;

    public MainWindow(DesktopOptions options, string instanceId)
    {
        this.options = options;
        this.instanceId = instanceId;
        backend = new BackendHost(options);
        Text = "Own";
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(1380, 860);
        MinimumSize = new Size(800, 580);
        StartPosition = FormStartPosition.CenterScreen;
        using (var stream = typeof(MainWindow).Assembly.GetManifestResourceStream("Own.Desktop.own.ico"))
            if (stream is not null) Icon = new Icon(stream);
        RestoreWindow();
        var menu = BuildMenu();
        Controls.Add(webView);
        Controls.Add(loading);
        Controls.Add(menu);
        MainMenuStrip = menu;
        loading.BringToFront();
        Shown += (_, _) => { startup = InitializeAsync(); _ = ListenForActivationAsync(); };
        FormClosing += OnClosing;
        backend.UnexpectedExit += () => {
            if (ready && !closing && !IsDisposed)
                BeginInvoke(() => { loading.Text = "本地保存服务已停止。请重新打开 Own；未完成的编辑仍保留在恢复缓存中。"; loading.Visible = true; loading.BringToFront(); });
        };
    }

    private MenuStrip BuildMenu()
    {
        var menu = new MenuStrip { BackColor = Color.White, Font = new Font("Microsoft YaHei UI", 9) };
        var file = new ToolStripMenuItem("文件");
        file.DropDownItems.Add("打开数据文件夹", null, (_, _) => OpenFolder(options.DataDir));
        file.DropDownItems.Add(new ToolStripSeparator());
        file.DropDownItems.Add("退出", null, (_, _) => Close());
        var view = new ToolStripMenuItem("视图");
        view.DropDownItems.Add("重新加载", null, async (_, _) => {
            try { if (!ready || await SaveBeforeLeavingAsync("重新加载 Own")) { ready = false; webView.CoreWebView2?.Reload(); } }
            catch (Exception error) { MessageBox.Show(this, error.Message, "暂未重新加载", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        });
        var help = new ToolStripMenuItem("帮助");
        help.DropDownItems.Add("关于 Own", null, (_, _) => MessageBox.Show(this, $"Own {typeof(MainWindow).Assembly.GetName().Version?.ToString(3)}\n\n文字、任务、文件夹、公式与图，自由放在同一块画布上。\n笔记与附件保存在本机。", "关于 Own", MessageBoxButtons.OK, MessageBoxIcon.Information));
        menu.Items.AddRange([file, view, help]);
        return menu;
    }

    private async Task InitializeAsync()
    {
        try
        {
            _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            await backend.StartAsync(lifetime.Token);
            if (closing) return;
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: options.ProfileDir);
            if (closing) return;
            await webView.EnsureCoreWebView2Async(environment);
            var core = webView.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDevToolsEnabled = options.Development;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            webView.ZoomFactor = 1;
            await core.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window, 'ownDesktop', {value: Object.freeze({platform:'windows', version:1}), writable:false});");
            core.NavigationStarting += (_, args) => {
                if (IsWorkspaceUri(args.Uri)) SetPresentation(false);
                if (args.Uri == "about:blank" || IsWorkspaceUri(args.Uri)) return;
                // Embedded interactive link cards use a sandboxed iframe. WebView2
                // reports those frame loads as non-user-initiated navigation; let
                // them load in the frame while still sending explicit top-level
                // clicks to the system browser.
                if (args.IsUserInitiated) { args.Cancel = true; OpenExternal(args.Uri); }
            };
            core.NewWindowRequested += (_, args) => {
                args.Handled = true;
                if (!args.IsUserInitiated) return;
                if (IsWorkspaceUri(args.Uri)) core.Navigate(args.Uri);
                else OpenExternal(args.Uri);
            };
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += OnDownloadStarting;
            core.WebMessageReceived += OnWebMessage;
            core.DocumentTitleChanged += (_, _) => Text = core.DocumentTitle;
            core.NavigationCompleted += (_, args) => {
                if (args.IsSuccess) { loading.Visible = false; webView.Focus(); }
                else { loading.Text = "工作空间未能打开。请从「视图」重新加载，或重新启动 Own。"; loading.Visible = true; }
            };
            core.ProcessFailed += (_, _) => { SetPresentation(false); ready = false; loading.Text = "显示进程已停止，请重新启动 Own。笔记仍保存在本机。"; loading.Visible = true; };
            core.Navigate(backend.BaseUri!.AbsoluteUri);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            loading.Text = "需要 Microsoft Edge WebView2 Runtime。\n请安装微软提供的 WebView2 运行时后，重新打开 Own。";
            var link = new LinkLabel { Text = "获取 WebView2 运行时", AutoSize = true, Left = 30, Top = 40 };
            link.LinkClicked += (_, _) => OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
            loading.Controls.Add(link);
        }
        catch (Exception error)
        {
            if (!closing) { loading.Text = $"无法打开 Own\n\n{error.Message}"; await backend.DisposeAsync(); }
        }
    }

    private bool IsWorkspaceUri(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        backend.BaseUri is { } root && uri.Scheme == root.Scheme && uri.Host == root.Host && uri.Port == root.Port;

    private static void OpenExternal(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception error) { MessageBox.Show($"无法打开链接：{error.Message}", "Own"); }
    }

    private static void OpenFolder(string folder)
    {
        Directory.CreateDirectory(folder);
        var start = new ProcessStartInfo("explorer.exe") { UseShellExecute = false };
        start.ArgumentList.Add(folder);
        Process.Start(start);
    }

    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs args)
    {
        args.Handled = true;
        using var dialog = new SaveFileDialog
        {
            Title = "保存文件",
            FileName = Path.GetFileName(args.ResultFilePath),
            OverwritePrompt = true,
            RestoreDirectory = true,
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) { args.Cancel = true; return; }
        args.ResultFilePath = dialog.FileName;
    }

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!IsWorkspaceUri(args.Source)) return;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            var root = message.RootElement;
            if (root.GetProperty("type").GetString() == "own:frontend-ready") { ready = true; return; }
            if (root.GetProperty("type").GetString() == "own:presentation")
            {
                SetPresentation(root.GetProperty("enabled").GetBoolean());
                webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "own:presentation-result", requestId = root.GetProperty("requestId").GetString(), status = "ok" }));
                return;
            }
            if (root.GetProperty("type").GetString() == "own:open-asset")
            {
                await OpenAssetAsync(root.Clone());
                return;
            }
            if (closeReply is null) return;
            if (root.GetProperty("type").GetString() == "own:close-result" && root.GetProperty("requestId").GetString() == closeRequestId)
                closeReply.TrySetResult(root.Clone());
        }
        catch (JsonException) { }
        catch (KeyNotFoundException) { }
    }

    private void SetPresentation(bool enabled)
    {
        if (presenting == enabled) return;
        if (enabled)
        {
            presentationWindowState = WindowState;
            presentationBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var screen = Screen.FromControl(this);
            presenting = true;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            if (MainMenuStrip is not null) MainMenuStrip.Visible = false;
            Bounds = screen.Bounds;
        }
        else
        {
            presenting = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            if (MainMenuStrip is not null) MainMenuStrip.Visible = true;
            WindowState = FormWindowState.Normal;
            Bounds = presentationBounds;
            WindowState = presentationWindowState;
        }
        webView.Focus();
    }

    private async Task OpenAssetAsync(JsonElement request)
    {
        var requestId = request.GetProperty("requestId").GetString();
        try
        {
            var id = request.GetProperty("assetId").GetString() ?? "";
            var name = Path.GetFileName(request.GetProperty("filename").GetString() ?? "附件");
            if (!Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,128}$") || string.IsNullOrWhiteSpace(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new IOException("文件信息无效，请另存为后打开。");
            var supported = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".tex",
                ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".svg", ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".mp4", ".webm", ".mov", ".zip", ".7z", ".rar"
            };
            if (!supported.Contains(Path.GetExtension(name))) throw new IOException("此类型请另存为后自行打开。");
            var asset = Path.Combine(options.DataDir, "assets", id);
            using var metadata = JsonDocument.Parse(await File.ReadAllTextAsync(asset + ".json"));
            var hash = metadata.RootElement.GetProperty("contentHash").GetString() ?? "";
            if (!Regex.IsMatch(hash, "^[a-f0-9]{64}$")) throw new IOException("附件记录无效。");
            var directory = Path.Combine(options.StateDir, "OpenedFiles", id);
            Directory.CreateDirectory(directory);
            var destination = Path.Combine(directory, name);
            await using (var source = File.OpenRead(asset + "." + hash + ".blob"))
            await using (var output = File.Create(destination)) await source.CopyToAsync(output);
            Process.Start(new ProcessStartInfo(destination) { UseShellExecute = true });
            webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "own:asset-open-result", requestId, status = "opened" }));
        }
        catch (Exception error)
        {
            webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "own:asset-open-result", requestId, status = "error", error = error.Message }));
        }
    }

    private async Task<JsonElement> PrepareCloseAsync(bool discardDraft)
    {
        closeRequestId = Guid.NewGuid().ToString("N");
        closeReply = new(TaskCreationOptions.RunContinuationsAsynchronously);
        webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "own:prepare-close", requestId = closeRequestId, discardDraft }));
        try { return await closeReply.Task.WaitAsync(TimeSpan.FromSeconds(25)); }
        finally { closeReply = null; closeRequestId = null; }
    }

    private async void OnClosing(object? sender, FormClosingEventArgs args)
    {
        if (allowClose) return;
        args.Cancel = true;
        if (closing) return;
        closing = true;
        try
        {
            if (ready && !await SaveBeforeLeavingAsync("退出 Own")) { closing = false; return; }
            if (!ready) lifetime.Cancel();
            if (startup is not null) await startup;
            SaveWindow();
            lifetime.Cancel();
            webView.Dispose();
            await backend.DisposeAsync();
            allowClose = true;
            Close();
        }
        catch (Exception error)
        {
            closing = false;
            MessageBox.Show(this, $"Own 已保持打开，以便保留当前编辑。\n\n{error.Message}", "暂未退出", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private async Task<bool> SaveBeforeLeavingAsync(string action)
    {
        var response = await PrepareCloseAsync(false);
        if (response.GetProperty("status").GetString() == "draft")
        {
            if (MessageBox.Show(this, $"当前编辑窗口还有未保存的内容。要放弃这次编辑并{action}吗？", action, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return false;
            response = await PrepareCloseAsync(true);
        }
        if (response.GetProperty("status").GetString() != "saved")
            throw new IOException("笔记未能保存。请重试保存，或导出完整备份后再继续。");
        return true;
    }

    private async Task ListenForActivationAsync()
    {
        while (!lifetime.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream($"OwnDesktop-{instanceId}", PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(lifetime.Token);
                using var reader = new StreamReader(pipe);
                if (await reader.ReadLineAsync(lifetime.Token) == "focus" && !closing)
                {
                    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                    Show(); Activate();
                }
            }
            catch (OperationCanceledException) { return; }
            catch (IOException) { }
        }
    }

    private sealed record WindowSettings(int X, int Y, int Width, int Height, bool Maximized);
    private void RestoreWindow()
    {
        try
        {
            var saved = JsonSerializer.Deserialize<WindowSettings>(File.ReadAllText(Path.Combine(options.StateDir, "window.json")));
            if (saved is null) return;
            var bounds = new Rectangle(saved.X, saved.Y, Math.Max(800, saved.Width), Math.Max(580, saved.Height));
            if (Screen.AllScreens.Any(screen => Rectangle.Intersect(screen.WorkingArea, bounds) is { Width: >= 200, Height: >= 150 }))
            { StartPosition = FormStartPosition.Manual; Bounds = bounds; }
            if (saved.Maximized) WindowState = FormWindowState.Maximized;
        }
        catch (IOException) { }
        catch (JsonException) { }
    }
    private void SaveWindow()
    {
        try
        {
            Directory.CreateDirectory(options.StateDir);
            var bounds = presenting ? presentationBounds : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var maximized = (presenting ? presentationWindowState : WindowState) == FormWindowState.Maximized;
            File.WriteAllText(Path.Combine(options.StateDir, "window.json"), JsonSerializer.Serialize(new WindowSettings(bounds.X, bounds.Y, bounds.Width, bounds.Height, maximized)));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
