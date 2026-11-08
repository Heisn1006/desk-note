param(
  [int]$x,
  [int]$y,
  [int]$w,
  [int]$h,
  [string]$out,
  [int]$stride = 3
)

# 截取屏幕上一块矩形并给出颜色统计（fs-opacity-smoke.js 用来判断便签到底有没有画在屏幕上）。
# 只用 GDI（Graphics.CopyFromScreen），不需要 WGC / 桌面捕获权限。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -Name Dpi -Namespace Win32
[void][Win32.Dpi]::SetProcessDPIAware()

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$sR = 0.0; $sG = 0.0; $sB = 0.0; $sL = 0.0; $sL2 = 0.0; $n = 0
for ($py = 0; $py -lt $h; $py += $stride) {
  for ($px = 0; $px -lt $w; $px += $stride) {
    $c = $bmp.GetPixel($px, $py)
    $sR += $c.R; $sG += $c.G; $sB += $c.B
    $l = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
    $sL += $l
    $sL2 += $l * $l
    $n++
  }
}
$bmp.Dispose()

$mR = $sR / $n; $mG = $sG / $n; $mB = $sB / $n; $mL = $sL / $n
$var = [Math]::Max(0.0, ($sL2 / $n) - ($mL * $mL))
$obj = @{
  r    = [Math]::Round($mR, 1)
  g    = [Math]::Round($mG, 1)
  b    = [Math]::Round($mB, 1)
  lum  = [Math]::Round($mL, 1)
  sd   = [Math]::Round([Math]::Sqrt($var), 2)
  n    = $n
}
$obj | ConvertTo-Json -Compress
