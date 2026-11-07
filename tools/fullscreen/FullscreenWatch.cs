using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

// 全屏检测：每 700ms 看一次前台窗口，覆盖整块显示器就输出 1，否则 0（只在变化时输出）
// 用法：fullscreen-watch.exe <自身进程PID>（跳过自己）
class FullscreenWatch
{
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);

    static uint selfPid;

    static bool IsFullscreen()
    {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero || !IsWindowVisible(h)) return false;

        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == selfPid) return false;

        var cls = new StringBuilder(64);
        GetClassName(h, cls, cls.Capacity);
        string c = cls.ToString();
        // 桌面 / 任务栏 / 开始菜单不算全屏应用
        if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" ||
            c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow") return false;

        RECT r;
        if (!GetWindowRect(h, out r)) return false;
        if (r.Right - r.Left < 200 || r.Bottom - r.Top < 150) return false;

        IntPtr mon = MonitorFromWindow(h, 2 /* MONITOR_DEFAULTTONEAREST */);
        var mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(mi);
        if (!GetMonitorInfo(mon, ref mi)) return false;

        RECT m = mi.rcMonitor;
        // 允许 2px 误差（有些全屏窗口边框会差 1px）
        return Math.Abs(r.Left - m.Left) <= 2 && Math.Abs(r.Top - m.Top) <= 2 &&
               Math.Abs(r.Right - m.Right) <= 2 && Math.Abs(r.Bottom - m.Bottom) <= 2;
    }

    static void Main(string[] args)
    {
        selfPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        if (args.Length > 0) uint.TryParse(args[0], out selfPid);

        int last = -1;
        while (true)
        {
            int now = IsFullscreen() ? 1 : 0;
            if (now != last)
            {
                Console.WriteLine(now);
                Console.Out.Flush();
                last = now;
            }
            Thread.Sleep(700);
        }
    }
}
