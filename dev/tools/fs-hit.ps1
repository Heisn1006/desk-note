param(
  [int]$x,
  [int]$y,
  [string]$hwnd
)

# 鼠标点击（按坐标）到底会落到哪个窗口：
# - WindowFromPoint 走的是 Windows 真实的命中测试，会跳过 WS_EX_TRANSPARENT / 完全透明的窗口
# - 同时报告便签窗口的 WS_EX_TRANSPARENT 位，确认 setIgnoreMouseEvents 有没有真的生效
$code = @'
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int n);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
public static IntPtr At(int x, int y) { POINT p; p.X = x; p.Y = y; return WindowFromPoint(p); }
public static long HitLong(int x, int y) { return At(x, y).ToInt64(); }
public static long StyleOf(long h) { return (long)GetWindowLong(new IntPtr(h), -20); }
public static long RootOf(long h) { return GetAncestor(new IntPtr(h), 2).ToInt64(); }
public static string ClsOf(long h) { var sb = new System.Text.StringBuilder(256); GetClassName(new IntPtr(h), sb, 256); return sb.ToString(); }
'@
Add-Type -MemberDefinition $code -Name Hit -Namespace Win32

$dpi = @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
Add-Type -MemberDefinition $dpi -Name Dpi -Namespace Win32
[void][Win32.Dpi]::SetProcessDPIAware()

$want = [long]$hwnd
$under = [Win32.Hit]::HitLong($x, $y)
$ex = [Win32.Hit]::StyleOf($want)
$obj = @{
  under           = $under.ToString()
  match           = ($under -eq $want)
  underClass      = [Win32.Hit]::ClsOf($under)
  root            = ([Win32.Hit]::RootOf($under)).ToString()
  rootMatch       = (([Win32.Hit]::RootOf($under)) -eq $want)
  noteTransparent = (($ex -band 0x20) -ne 0)
  noteExStyle     = $ex
}
$obj | ConvertTo-Json -Compress
