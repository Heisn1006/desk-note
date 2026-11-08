using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

// 全屏检测：每 40ms 看一次前台窗口，覆盖整块显示器就输出 1，否则 0（只在变化时输出）
// 输出格式：<0|1> <前台 exe 文件名>，例如 "1 chrome.exe"、"0 -"
// 用法：fullscreen-watch.exe <自身进程PID>（跳过自己）
//
// 为什么 40ms：主进程收到 1 之后还要等一个防抖，而「全屏已经结束」也只能靠下一次轮询发现。
// 轮询越慢，退出事件越迟，防抖定时器越容易先烧掉 → 截一张图就把便签藏起来又放回。
// 40ms 下，120ms 的浮层最多 160ms 就能确认结束，主进程用 150ms 防抖刚好留出余量。
//
// 为什么还要报 exe 名：截图 / 录屏工具的浮层也会铺满屏幕（SnippingTool、OBS 这类），
// 主进程按名字直接把这类「假全屏」跳过，真正进全屏就能立刻隐藏，不用再靠长防抖硬扛。
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

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder sb, ref int size);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    [DllImport("user32.dll")]
    static extern int GetWindowLong(IntPtr h, int index);

    static uint selfPid;

    // 前台窗口属于哪个进程（输出 exe 文件名，拿不到就给 "-"）
    // 主进程用它来认截图 / 录屏工具：那些工具的浮层也会铺满屏幕，不能当成全屏应用。
    static string ExeName(uint pid)
    {
        if (pid == 0) return "-";
        IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (h == IntPtr.Zero) return "-";
        try
        {
            var sb = new StringBuilder(1024);
            int n = sb.Capacity;
            if (!QueryFullProcessImageName(h, 0, sb, ref n)) return "-";
            return System.IO.Path.GetFileName(sb.ToString()).ToLowerInvariant();
        }
        catch { return "-"; }
        finally { CloseHandle(h); }
    }

    static bool IsFullscreen(out uint fgPid)
    {
        fgPid = 0;
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero || !IsWindowVisible(h)) return false;

        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == selfPid) return false;
        fgPid = pid;   // 即使几何判定不成立，也把前台进程带出去，日志里能看到是谁

        var cls = new StringBuilder(64);
        GetClassName(h, cls, cls.Capacity);
        string c = cls.ToString();
        // 桌面 / 任务栏 / 开始菜单不算全屏应用
        if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" ||
            c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow") return false;

        // 工具窗口（截图覆盖层 / 输入法候选框 / 悬浮面板）铺满屏幕也不算全屏应用。
        // 这条来自桌宠 dsh-pet 的 platform_win 实现，比按 exe 名单排除更通用。
        if ((GetWindowLong(h, -20 /* GWL_EXSTYLE */) & 0x80 /* WS_EX_TOOLWINDOW */) != 0) return false;

        RECT r;
        if (!GetWindowRect(h, out r)) return false;
        if (r.Right - r.Left < 200 || r.Bottom - r.Top < 150) return false;

        IntPtr mon = MonitorFromWindow(h, 2 /* MONITOR_DEFAULTTONEAREST */);
        var mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(mi);
        if (!GetMonitorInfo(mon, ref mi)) return false;

        RECT m = mi.rcMonitor;
        // 允许 2px 误差（有些全屏窗口边框会差 1px）
        if (Math.Abs(r.Left - m.Left) <= 2 && Math.Abs(r.Top - m.Top) <= 2 &&
            Math.Abs(r.Right - m.Right) <= 2 && Math.Abs(r.Bottom - m.Bottom) <= 2)
        {
            fgPid = pid;
            return true;
        }
        return false;
    }

    static void Main(string[] args)
    {
        selfPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        if (args.Length > 0) uint.TryParse(args[0], out selfPid);

        int last = -1;
        while (true)
        {
            uint pid;
            bool geo = IsFullscreen(out pid);
            bool fs = geo;
            int now = fs ? 1 : 0;
            if (now != last)
            {
                // 格式：<0|1> <前台 exe 文件名> <geo|->，例如 "1 chrome.exe geo"
                Console.WriteLine(now + " " + (fs ? ExeName(pid) : "-") + " " + (geo ? "geo" : "-"));
                Console.Out.Flush();
                last = now;
            }
            Thread.Sleep(40);
        }
    }
}
