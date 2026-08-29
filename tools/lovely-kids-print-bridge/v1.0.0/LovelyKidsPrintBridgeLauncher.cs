using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace LovelyKidsPrintBridgeLauncher
{
    internal static class Program
    {
        private const string HealthUrl =
            "http://127.0.0.1:17858/health";

        private static bool BridgeIsRunning()
        {
            try
            {
                HttpWebRequest request =
                    (HttpWebRequest)WebRequest.Create(HealthUrl);

                request.Method = "GET";
                request.Timeout = 1200;
                request.ReadWriteTimeout = 1200;

                using (HttpWebResponse response =
                    (HttpWebResponse)request.GetResponse())
                {
                    int status = (int)response.StatusCode;
                    return status >= 200 && status < 300;
                }
            }
            catch
            {
                return false;
            }
        }

        [STAThread]
        private static void Main()
        {
            try
            {
                if (BridgeIsRunning())
                {
                    return;
                }

                string home =
                    Environment.GetFolderPath(
                        Environment.SpecialFolder.UserProfile
                    );

                string script =
                    Path.Combine(
                        home,
                        "LovelyKidsPrintBridge",
                        "LovelyKidsPrintBridge.ps1"
                    );

                if (!File.Exists(script))
                {
                    return;
                }

                ProcessStartInfo info =
                    new ProcessStartInfo();

                info.FileName = "powershell.exe";

                info.Arguments =
                    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" +
                    script +
                    "\"";

                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.WindowStyle =
                    ProcessWindowStyle.Hidden;

                Process.Start(info);

                for (int i = 0; i < 15; i++)
                {
                    Thread.Sleep(300);

                    if (BridgeIsRunning())
                    {
                        return;
                    }
                }
            }
            catch
            {
                // Silent launcher: printing UI will report
                // bridge availability if startup fails.
            }
        }
    }
}
