using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

// DeskNote 安装器 / 卸载器（同一个程序，按 exe 名字决定跑哪个 .ps1）
// install.exe   -> install.ps1
// uninstall.exe -> uninstall.ps1
// 支持 --silent（无界面，供自动化测试）和 --check（只检查脚本是否存在）
static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string dir = Path.GetDirectoryName(Application.ExecutablePath);
        string exe = Path.GetFileNameWithoutExtension(Application.ExecutablePath).ToLowerInvariant();
        bool uninstall = exe.Contains("uninstall");
        string action = uninstall ? "卸载" : "安装";
        string script = Path.Combine(dir, uninstall ? "uninstall.ps1" : "install.ps1");
        bool silent = Array.IndexOf(args, "--silent") >= 0;
        bool checkOnly = Array.IndexOf(args, "--check") >= 0;

        if (!File.Exists(script))
        {
            if (!silent) MessageBox.Show("找不到 " + Path.GetFileName(script) + "，请先完整解压压缩包。", "DeskNote", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
        if (checkOnly) return 0;

        if (silent) return RunScript(script);

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var form = new Form();
        form.Text = "DeskNote " + action + "程序";
        form.ClientSize = new System.Drawing.Size(380, 132);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.ControlBox = false;
        form.BackColor = System.Drawing.Color.FromArgb(250, 245, 238);

        var label = new Label();
        label.Text = "正在" + action + " DeskNote…";
        label.AutoSize = false;
        label.TextAlign = System.Drawing.ContentAlignment.MiddleCenter;
        label.SetBounds(16, 22, 348, 34);
        label.Font = new System.Drawing.Font("Microsoft YaHei UI", 10F);

        var bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 30;
        bar.SetBounds(16, 70, 348, 14);

        form.Controls.Add(label);
        form.Controls.Add(bar);

        int code = -1;
        var th = new Thread(() =>
        {
            code = RunScript(script);
            try { form.BeginInvoke((Action)(() => form.Close())); } catch { }
        });
        th.IsBackground = true;
        th.Start();
        Application.Run(form);

        if (code == 0)
        {
            MessageBox.Show("DeskNote 已" + action + "完成。", "DeskNote", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        MessageBox.Show("DeskNote " + action + "失败（退出码 " + code + "）。\n可右键 " + Path.GetFileName(script) + " →「使用 PowerShell 运行」查看详细原因。",
            "DeskNote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return code;
    }

    static int RunScript(string script)
    {
        try
        {
            var psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.WorkingDirectory = Path.GetDirectoryName(script);
            using (var p = Process.Start(psi))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                try
                {
                    File.WriteAllText(Path.Combine(Path.GetDirectoryName(script), "install-log.txt"),
                        stdout + "\n--- stderr ---\n" + stderr + "\nexit=" + p.ExitCode);
                }
                catch { }
                return p.ExitCode;
            }
        }
        catch
        {
            return -1;
        }
    }
}
