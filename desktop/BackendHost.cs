using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Own.Desktop;

internal sealed class BackendHost : IAsyncDisposable
{
    private readonly DesktopOptions options;
    private Process? process;
    private readonly StringBuilder errors = new();
    public Uri? BaseUri { get; private set; }
    public event Action? UnexpectedExit;
    private bool stopping;

    public BackendHost(DesktopOptions options) => this.options = options;

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        var script = Path.Combine(options.AppRoot, "desktop", "host.mjs");
        if (!File.Exists(script) || !File.Exists(Path.Combine(options.AppRoot, "dist", "index.html")))
            throw new FileNotFoundException("客户端文件不完整。请重新解压完整安装包，开发时先运行 npm run build。");
        var bundled = Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
        var node = options.NodePath ?? (File.Exists(bundled) ? bundled : "node.exe");
        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = options.AppRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        start.ArgumentList.Add(script);
        if (options.Development) start.ArgumentList.Add("--dev");
        start.Environment["FIELDNOTES_DATA_DIR"] = options.DataDir;
        start.Environment["OWN_DESKTOP_PORT"] = options.Port.ToString();
        process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.Exited += (_, _) => { if (!stopping) UnexpectedExit?.Invoke(); };
        process.ErrorDataReceived += (_, args) => { if (args.Data is { } line) lock (errors) { if (errors.Length < 16000) errors.AppendLine(line); } };
        if (!process.Start()) throw new InvalidOperationException("无法启动本地保存服务。");
        process.BeginErrorReadLine();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        try
        {
            while (await process.StandardOutput.ReadLineAsync(timeout.Token) is { } line)
            {
                if (!line.StartsWith('{')) continue;
                using var message = JsonDocument.Parse(line);
                if (message.RootElement.GetProperty("event").GetString() != "ready") continue;
                var uri = new Uri(message.RootElement.GetProperty("url").GetString()!);
                if (uri.Scheme != "http" || uri.Host != "127.0.0.1") throw new InvalidOperationException("客户端服务地址无效。");
                BaseUri = uri;
                _ = DrainOutputAsync();
                return;
            }
            throw new InvalidOperationException($"本地服务未能启动。\n{errors}");
        }
        catch (OperationCanceledException)
        {
            cancellationToken.ThrowIfCancellationRequested();
            throw new TimeoutException($"打开工作空间超时。\n{errors}");
        }
    }

    private async Task DrainOutputAsync()
    {
        try { while (await process!.StandardOutput.ReadLineAsync() is not null) { } }
        catch (ObjectDisposedException) { }
        catch (IOException) { }
    }

    public async ValueTask DisposeAsync()
    {
        stopping = true;
        if (process is null) return;
        try
        {
            if (!process.HasExited)
            {
                await process.StandardInput.WriteLineAsync("shutdown");
                process.StandardInput.Close();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                try { await process.WaitForExitAsync(timeout.Token); }
                catch (OperationCanceledException) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
            }
        }
        catch (InvalidOperationException) { }
        catch (IOException) { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        finally { process.Dispose(); process = null; }
    }
}
