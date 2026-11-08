' DeskNote 静默启动器：直接拉起 electron，不经过 cmd，不弹任何窗口
Option Explicit
Dim sh, fso, base, exePath
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName) & "\.."
exePath = base & "\node_modules\electron\dist\electron.exe"

sh.CurrentDirectory = base
' 0 = 隐藏；False = 不等待退出
sh.Run """" & exePath & """ . --no-sandbox --disable-gpu", 0, False
