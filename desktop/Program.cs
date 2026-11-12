using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;

namespace Own.Desktop;

internal record DesktopOptions(string AppRoot, string DataDir, string ProfileDir, string StateDir, int Port, bool Development, string? NodePath)
{
    public static DesktopOptions Parse(string[] args)
    {
        var stateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Own");
        var appRoot = Path.Combine(AppContext.BaseDirectory, "app");
        var dataDir = Environment.GetEnvironmentVariable("FIELDNOTES_DATA_DIR") ?? Path.Combine(stateDir, "workspace");
        string? profileDir = null, nodePath = null;
        var port = 5173;
        var development = false;
        for (var index = 0; index < args.Length; index++)
        {
            string Value() => ++index < args.Length ? args[index] : throw new ArgumentException("启动参数缺少值。");
            switch (args[index])
            {
                case "--app-root": appRoot = Value(); break;
                case "--data-dir": dataDir = Value(); break;
                case "--profile-dir": profileDir = Value(); break;
                case "--state-dir": stateDir = Value(); break;
                case "--node": nodePath = Value(); break;
                case "--port": port = int.Parse(Value()); break;
                case "--dev": development = true; break;
                default: throw new ArgumentException($"未知启动参数：{args[index]}");
            }
        }
        if (port is < 0 or > 65535) throw new ArgumentException("端口无效。");
        return new(Path.GetFullPath(appRoot), Path.GetFullPath(dataDir), Path.GetFullPath(profileDir ?? Path.Combine(stateDir, "WebView2")), Path.GetFullPath(stateDir), port, development, nodePath);
    }
}

internal static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            _ = SetCurrentProcessExplicitAppUserModelID("Own.Notes");
            // Installers detect this named object and wait for all Own windows
            // to close before replacing or removing application files.
            using var installerMutex = new Mutex(false, @"Local\Own.Notes.Running");
            var options = DesktopOptions.Parse(args);
            var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(options.DataDir.ToLowerInvariant())))[..24];
            using var mutex = new Mutex(true, $@"Local\OwnDesktop-{identity}", out var first);
            if (!first)
            {
                try
                {
                    using var pipe = new NamedPipeClientStream(".", $"OwnDesktop-{identity}", PipeDirection.Out);
                    pipe.Connect(2000);
                    using var writer = new StreamWriter(pipe);
                    writer.WriteLine("focus");
                }
                catch (IOException) { }
                catch (TimeoutException) { }
                return;
            }
            using var form = new MainWindow(options, identity);
            Application.Run(form);
            mutex.ReleaseMutex();
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Own 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
