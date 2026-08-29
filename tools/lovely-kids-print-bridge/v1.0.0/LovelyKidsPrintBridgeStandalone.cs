using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LovelyKidsPrintBridge
{
    internal static class AppInfo
    {
        public const string Name = "Lovely Kids Print Bridge";
        public const string Version = "1.0.0";
        public const string Protocol = "ESC1-RAW";
        public const int Port = 17858;
    }

    internal static class Config
    {
        private const string KeyPath = @"Software\LovelyKids\PrintBridge";
        private const string PrinterValue = "PrinterName";

        public static string GetPrinter()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(KeyPath))
                {
                    if (key == null) return "";
                    object v = key.GetValue(PrinterValue);
                    return v == null ? "" : Convert.ToString(v);
                }
            }
            catch { return ""; }
        }

        public static void SetPrinter(string printer)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(KeyPath))
                key.SetValue(PrinterValue, printer ?? "", RegistryValueKind.String);
        }

        public static bool Exists(string printer)
        {
            if (String.IsNullOrWhiteSpace(printer)) return false;
            foreach (string p in PrinterSettings.InstalledPrinters)
                if (String.Equals(p, printer, StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }

        public static string PickPrinter()
        {
            string saved = GetPrinter();
            if (Exists(saved)) return saved;

            string exact = "";
            string pos58 = "";

            foreach (string p in PrinterSettings.InstalledPrinters)
            {
                if (String.Equals(p, "POS-58(copy of 1)", StringComparison.OrdinalIgnoreCase))
                    exact = p;

                if (String.IsNullOrEmpty(pos58) &&
                    p.IndexOf("POS-58", StringComparison.OrdinalIgnoreCase) >= 0)
                    pos58 = p;
            }

            string chosen = !String.IsNullOrEmpty(exact) ? exact : pos58;
            if (!String.IsNullOrEmpty(chosen)) SetPrinter(chosen);
            return chosen;
        }
    }

    internal static class RawPrinter
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private sealed class DOC_INFO_1
        {
            [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
            [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
        }

        [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
        private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

        [DllImport("winspool.drv", SetLastError=true)]
        private static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
        private static extern int StartDocPrinter(IntPtr hPrinter, int level,
            [In, MarshalAs(UnmanagedType.LPStruct)] DOC_INFO_1 di);

        [DllImport("winspool.drv", SetLastError=true)]
        private static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError=true)]
        private static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError=true)]
        private static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError=true)]
        private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

        public static bool Send(string printerName, byte[] bytes)
        {
            IntPtr h;
            if (!OpenPrinter(printerName, out h, IntPtr.Zero)) return false;

            try
            {
                DOC_INFO_1 doc = new DOC_INFO_1();
                doc.pDocName = "Lovely Kids RAW Label";
                doc.pDataType = "RAW";

                if (StartDocPrinter(h, 1, doc) == 0) return false;

                try
                {
                    if (!StartPagePrinter(h)) return false;
                    try
                    {
                        int written;
                        bool ok = WritePrinter(h, bytes, bytes.Length, out written);
                        return ok && written == bytes.Length;
                    }
                    finally { EndPagePrinter(h); }
                }
                finally { EndDocPrinter(h); }
            }
            finally { ClosePrinter(h); }
        }
    }

    internal static class Raster
    {
        public static byte[] FromPng(byte[] imageBytes, int targetWidth)
        {
            using (MemoryStream input = new MemoryStream(imageBytes))
            using (Image src = Image.FromStream(input))
            {
                double ratio = src.Height / (double)src.Width;
                int targetHeight = Math.Max(1, (int)Math.Round(targetWidth * ratio));

                using (Bitmap bmp = new Bitmap(targetWidth, targetHeight, PixelFormat.Format24bppRgb))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.White);
                        g.InterpolationMode = InterpolationMode.NearestNeighbor;
                        g.SmoothingMode = SmoothingMode.None;
                        g.PixelOffsetMode = PixelOffsetMode.Half;
                        g.DrawImage(src, new Rectangle(0, 0, targetWidth, targetHeight),
                            0, 0, src.Width, src.Height, GraphicsUnit.Pixel);
                    }

                    int rowBytes = (targetWidth + 7) / 8;
                    byte[] pixels = new byte[rowBytes * targetHeight];

                    for (int y = 0; y < targetHeight; y++)
                    {
                        for (int xb = 0; xb < rowBytes; xb++)
                        {
                            byte value = 0;
                            for (int bit = 0; bit < 8; bit++)
                            {
                                int x = xb * 8 + bit;
                                if (x >= targetWidth) continue;

                                Color c = bmp.GetPixel(x, y);
                                int lum = (c.R + c.G + c.B) / 3;
                                if (lum < 128) value = (byte)(value | (0x80 >> bit));
                            }
                            pixels[y * rowBytes + xb] = value;
                        }
                    }

                    using (MemoryStream output = new MemoryStream())
                    {
                        output.WriteByte(0x1B); output.WriteByte(0x40);
                        output.WriteByte(0x1B); output.WriteByte(0x61); output.WriteByte(0x01);

                        output.WriteByte(0x1D); output.WriteByte(0x76);
                        output.WriteByte(0x30); output.WriteByte(0x00);
                        output.WriteByte((byte)(rowBytes & 0xFF));
                        output.WriteByte((byte)((rowBytes >> 8) & 0xFF));
                        output.WriteByte((byte)(targetHeight & 0xFF));
                        output.WriteByte((byte)((targetHeight >> 8) & 0xFF));
                        output.Write(pixels, 0, pixels.Length);

                        // Same next-label command used by the working PowerShell bridge.
                        output.WriteByte(0x1D); output.WriteByte(0x0C);

                        return output.ToArray();
                    }
                }
            }
        }
    }

    internal sealed class RequestData
    {
        public string Method;
        public string Target;
        public Dictionary<string,string> Headers;
        public byte[] Body;

        public static RequestData Read(NetworkStream stream)
        {
            const int MaxHeader = 65536;
            const int MaxBody = 12 * 1024 * 1024;

            MemoryStream hs = new MemoryStream();
            int matched = 0;

            while (hs.Length < MaxHeader)
            {
                int b = stream.ReadByte();
                if (b < 0) return null;
                hs.WriteByte((byte)b);

                if ((matched == 0 && b == '\r') ||
                    (matched == 1 && b == '\n') ||
                    (matched == 2 && b == '\r') ||
                    (matched == 3 && b == '\n'))
                {
                    matched++;
                    if (matched == 4) break;
                }
                else matched = (b == '\r') ? 1 : 0;
            }

            if (matched != 4) throw new InvalidDataException("Header too large");

            string text = Encoding.ASCII.GetString(hs.ToArray());
            string[] lines = text.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            string[] first = lines[0].Split(' ');
            if (first.Length < 2) return null;

            RequestData r = new RequestData();
            r.Method = first[0].Trim().ToUpperInvariant();
            r.Target = first[1].Trim();
            r.Headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);

            for (int i = 1; i < lines.Length; i++)
            {
                int c = lines[i].IndexOf(':');
                if (c <= 0) continue;
                r.Headers[lines[i].Substring(0, c).Trim()] =
                    lines[i].Substring(c + 1).Trim();
            }

            int len = 0;
            string lenText;
            if (r.Headers.TryGetValue("Content-Length", out lenText))
            {
                if (!Int32.TryParse(lenText, out len) || len < 0)
                    throw new InvalidDataException("Invalid Content-Length");
            }

            if (len > MaxBody) throw new InvalidDataException("Body too large");

            r.Body = new byte[len];
            int offset = 0;
            while (offset < len)
            {
                int n = stream.Read(r.Body, offset, len - offset);
                if (n <= 0) throw new EndOfStreamException();
                offset += n;
            }

            return r;
        }
    }

    internal sealed class BridgeServer : IDisposable
    {
        private TcpListener listener;
        private Thread thread;
        private volatile bool running;

        public bool Running { get { return running; } }

        public void Start()
        {
            listener = new TcpListener(IPAddress.Loopback, AppInfo.Port);
            listener.Start(20);
            running = true;
            thread = new Thread(AcceptLoop);
            thread.IsBackground = true;
            thread.Start();
        }

        private void AcceptLoop()
        {
            while (running)
            {
                try
                {
                    TcpClient c = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(delegate { Handle(c); });
                }
                catch
                {
                    if (!running) return;
                    Thread.Sleep(100);
                }
            }
        }

        private static Dictionary<string,string> Query(string q)
        {
            Dictionary<string,string> d =
                new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);

            if (String.IsNullOrEmpty(q)) return d;
            if (q.StartsWith("?")) q = q.Substring(1);

            foreach (string pair in q.Split('&'))
            {
                if (String.IsNullOrEmpty(pair)) continue;
                string[] p = pair.Split(new char[] {'='}, 2);
                string k = Uri.UnescapeDataString(p[0].Replace("+"," "));
                string v = p.Length > 1 ? Uri.UnescapeDataString(p[1].Replace("+"," ")) : "";
                d[k] = v;
            }
            return d;
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\","\\\\").Replace("\"","\\\"")
                    .Replace("\r","\\r").Replace("\n","\\n");
        }

        private static void Reply(NetworkStream s, int status, string json)
        {
            byte[] body = Encoding.UTF8.GetBytes(json);
            string statusText = status == 200 ? "OK" :
                                status == 204 ? "No Content" :
                                status == 400 ? "Bad Request" :
                                status == 404 ? "Not Found" :
                                "Internal Server Error";

            string headers =
                "HTTP/1.1 " + status + " " + statusText + "\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Connection: close\r\n" +
                "Cache-Control: no-store\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: Content-Type\r\n" +
                "Access-Control-Allow-Private-Network: true\r\n\r\n";

            byte[] hb = Encoding.ASCII.GetBytes(headers);
            s.Write(hb, 0, hb.Length);
            if (body.Length > 0) s.Write(body, 0, body.Length);
            s.Flush();
        }

        private static void Handle(TcpClient client)
        {
            using (client)
            {
                NetworkStream s = client.GetStream();

                try
                {
                    RequestData r = RequestData.Read(s);
                    if (r == null) { Reply(s, 400, "{\"ok\":false}"); return; }

                    if (r.Method == "OPTIONS")
                    {
                        Reply(s, 204, "");
                        return;
                    }

                    Uri uri = new Uri("http://127.0.0.1" + r.Target);

                    if (r.Method == "GET" && uri.AbsolutePath == "/health")
                    {
                        string printer = Config.GetPrinter();
                        bool ok = Config.Exists(printer);

                        Reply(s, 200,
                            "{\"protocol\":\"" + AppInfo.Protocol +
                            "\",\"ok\":" + (ok ? "true" : "false") +
                            ",\"printer\":\"" + Esc(printer) +
                            "\",\"service\":\"" + AppInfo.Name +
                            "\",\"version\":\"" + AppInfo.Version + "\"}");
                        return;
                    }

                    if (r.Method == "POST" && uri.AbsolutePath == "/print-png")
                    {
                        string printer = Config.GetPrinter();
                        if (!Config.Exists(printer))
                        {
                            Reply(s, 500, "{\"ok\":false,\"error\":\"No valid printer selected\"}");
                            return;
                        }

                        if (r.Body == null || r.Body.Length == 0)
                        {
                            Reply(s, 400, "{\"ok\":false,\"error\":\"Empty image\"}");
                            return;
                        }

                        Dictionary<string,string> q = Query(uri.Query);

                        int width = 384;
                        int copies = 1;
                        int tmp;
                        string value;

                        if (q.TryGetValue("width", out value) && Int32.TryParse(value, out tmp))
                            width = tmp;

                        if (q.TryGetValue("copies", out value) && Int32.TryParse(value, out tmp))
                            copies = tmp;

                        width = Math.Max(64, Math.Min(384, width));
                        copies = Math.Max(1, Math.Min(20, copies));

                        byte[] raw = Raster.FromPng(r.Body, width);
                        bool allOk = true;

                        for (int i = 0; i < copies; i++)
                        {
                            if (!RawPrinter.Send(printer, raw))
                            {
                                allOk = false;
                                break;
                            }
                        }

                        if (!allOk)
                        {
                            Reply(s, 500, "{\"ok\":false,\"error\":\"Printer write failed\"}");
                            return;
                        }

                        Reply(s, 200,
                            "{\"ok\":true,\"printer\":\"" + Esc(printer) +
                            "\",\"copies\":" + copies +
                            ",\"widthDots\":" + width + "}");
                        return;
                    }

                    Reply(s, 404, "{\"ok\":false,\"error\":\"Not found\"}");
                }
                catch (Exception ex)
                {
                    try { Reply(s, 500, "{\"ok\":false,\"error\":\"" + Esc(ex.Message) + "\"}"); }
                    catch { }
                }
            }
        }

        public void Dispose()
        {
            running = false;
            try { if (listener != null) listener.Stop(); } catch { }
        }
    }

    internal sealed class AppContextBridge : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly BridgeServer server;
        private readonly ToolStripMenuItem status;
        private readonly ToolStripMenuItem printer;

        public AppContextBridge()
        {
            string chosen = Config.PickPrinter();

            server = new BridgeServer();
            try
            {
                server.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Port 17858 is already in use.\r\n\r\nClose the old bridge first, then start this EXE again.\r\n\r\n" +
                    ex.Message,
                    AppInfo.Name,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                ExitThread();
                return;
            }

            ContextMenuStrip menu = new ContextMenuStrip();

            status = new ToolStripMenuItem();
            status.Enabled = false;
            menu.Items.Add(status);

            printer = new ToolStripMenuItem();
            printer.Enabled = false;
            menu.Items.Add(printer);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem health = new ToolStripMenuItem("Open health page");
            health.Click += delegate {
                try { System.Diagnostics.Process.Start("http://127.0.0.1:17858/health"); } catch { }
            };
            menu.Items.Add(health);

            ToolStripMenuItem exit = new ToolStripMenuItem("Exit");
            exit.Click += delegate { ExitBridge(); };
            menu.Items.Add(exit);

            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Application;
            tray.Text = AppInfo.Name;
            tray.ContextMenuStrip = menu;
            tray.Visible = true;

            menu.Opening += delegate { RefreshText(); };
            RefreshText();

            if (String.IsNullOrEmpty(chosen))
            {
                MessageBox.Show(
                    "No POS-58 printer was detected.\r\n\r\nThe next version will include printer selection.",
                    AppInfo.Name,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        private void RefreshText()
        {
            status.Text = server.Running ? "Bridge: Running" : "Bridge: Stopped";
            string p = Config.GetPrinter();
            printer.Text = Config.Exists(p) ? "Printer: " + p : "Printer: Not configured";
        }

        private void ExitBridge()
        {
            try { server.Dispose(); } catch { }
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }

        protected override void ExitThreadCore()
        {
            try { if (server != null) server.Dispose(); } catch { }
            try { if (tray != null) { tray.Visible = false; tray.Dispose(); } } catch { }
            base.ExitThreadCore();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Local\LovelyKidsPrintBridgeStandalone", out createdNew))
            {
                if (!createdNew) return;

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new AppContextBridge());
            }
        }
    }
}
