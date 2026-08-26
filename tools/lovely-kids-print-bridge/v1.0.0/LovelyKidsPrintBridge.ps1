Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class LovelyRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDocName;

        [MarshalAs(UnmanagedType.LPStr)]
        public string pOutputFile;

        [MarshalAs(UnmanagedType.LPStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv",
        EntryPoint="OpenPrinterA",
        SetLastError=true,
        CharSet=CharSet.Ansi,
        ExactSpelling=true)]
    public static extern bool OpenPrinter(
        string printerName,
        out IntPtr printer,
        IntPtr defaults
    );

    [DllImport("winspool.Drv",
        EntryPoint="ClosePrinter",
        SetLastError=true,
        ExactSpelling=true)]
    public static extern bool ClosePrinter(
        IntPtr printer
    );

    [DllImport("winspool.Drv",
        EntryPoint="StartDocPrinterA",
        SetLastError=true,
        CharSet=CharSet.Ansi,
        ExactSpelling=true)]
    public static extern bool StartDocPrinter(
        IntPtr printer,
        int level,
        DOCINFOA doc
    );

    [DllImport("winspool.Drv",
        EntryPoint="EndDocPrinter",
        SetLastError=true,
        ExactSpelling=true)]
    public static extern bool EndDocPrinter(
        IntPtr printer
    );

    [DllImport("winspool.Drv",
        EntryPoint="StartPagePrinter",
        SetLastError=true,
        ExactSpelling=true)]
    public static extern bool StartPagePrinter(
        IntPtr printer
    );

    [DllImport("winspool.Drv",
        EntryPoint="EndPagePrinter",
        SetLastError=true,
        ExactSpelling=true)]
    public static extern bool EndPagePrinter(
        IntPtr printer
    );

    [DllImport("winspool.Drv",
        EntryPoint="WritePrinter",
        SetLastError=true,
        ExactSpelling=true)]
    public static extern bool WritePrinter(
        IntPtr printer,
        byte[] bytes,
        int count,
        out int written
    );

    public static bool Send(
        string printerName,
        byte[] bytes
    ) {
        IntPtr printer;

        if (!OpenPrinter(
            printerName,
            out printer,
            IntPtr.Zero
        )) {
            return false;
        }

        DOCINFOA doc = new DOCINFOA();

        doc.pDocName =
            "Lovely Kids RAW Label";

        doc.pDataType =
            "RAW";

        bool ok =
            StartDocPrinter(
                printer,
                1,
                doc
            );

        if (ok) {
            StartPagePrinter(printer);

            int written;

            ok = WritePrinter(
                printer,
                bytes,
                bytes.Length,
                out written
            );

            EndPagePrinter(printer);
            EndDocPrinter(printer);

            ok =
                ok &&
                written == bytes.Length;
        }

        ClosePrinter(printer);

        return ok;
    }
}
"@

function Convert-ImageToEscPosRaster {
    param(
        [byte[]]$ImageBytes,
        [int]$TargetWidth = 174
    )

    $stream =
        New-Object System.IO.MemoryStream(
            ,$ImageBytes
        )

    $src =
        [System.Drawing.Bitmap]::FromStream(
            $stream
        )

    $ratio =
        $src.Height /
        [double]$src.Width

    $targetHeight =
        [int][Math]::Round(
            $TargetWidth * $ratio
        )

    $bmp =
        New-Object System.Drawing.Bitmap(
            $TargetWidth,
            $targetHeight
        )

    $g =
        [System.Drawing.Graphics]::FromImage(
            $bmp
        )

    $g.Clear(
        [System.Drawing.Color]::White
    )

    $g.InterpolationMode =
        [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor

    $g.SmoothingMode =
        [System.Drawing.Drawing2D.SmoothingMode]::None

    $g.PixelOffsetMode =
        [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    $g.DrawImage(
        $src,
        [System.Drawing.Rectangle]::new(
            0,
            0,
            $TargetWidth,
            $targetHeight
        ),
        0,
        0,
        $src.Width,
        $src.Height,
        [System.Drawing.GraphicsUnit]::Pixel
    )

    $g.Dispose()
    $src.Dispose()
    $stream.Dispose()

    $bytesPerRow =
        [int][Math]::Ceiling(
            $TargetWidth / 8
        )

    $imageData =
        New-Object `
            System.Collections.Generic.List[byte]

    for (
        $y = 0;
        $y -lt $targetHeight;
        $y++
    ) {
        for (
            $xb = 0;
            $xb -lt $bytesPerRow;
            $xb++
        ) {
            $b = 0

            for (
                $bit = 0;
                $bit -lt 8;
                $bit++
            ) {
                $x =
                    ($xb * 8) +
                    $bit

                if ($x -lt $TargetWidth) {
                    $c =
                        $bmp.GetPixel(
                            $x,
                            $y
                        )

                    $lum =
                        (
                            $c.R +
                            $c.G +
                            $c.B
                        ) / 3

                    if ($lum -lt 128) {
                        $b =
                            $b -bor (
                                0x80 -shr $bit
                            )
                    }
                }
            }

            $imageData.Add(
                [byte]$b
            )
        }
    }

    $bmp.Dispose()

    $xL =
        $bytesPerRow -band 0xFF

    $xH =
        ($bytesPerRow -shr 8) -band 0xFF

    $yL =
        $targetHeight -band 0xFF

    $yH =
        ($targetHeight -shr 8) -band 0xFF

    $init =
        [byte[]](
            0x1B,
            0x40
        )

    $center =
        [byte[]](
            0x1B,
            0x61,
            0x01
        )

    $raster =
        [byte[]](
            0x1D,
            0x76,
            0x30,
            0x00,
            $xL,
            $xH,
            $yL,
            $yH
        )

    # أمر الوقوف على بداية الملصق التالي
    $nextLabel =
        [byte[]](
            0x1D,
            0x0C
        )

    return [byte[]](
        $init +
        $center +
        $raster +
        $imageData.ToArray() +
        $nextLabel
    )
}

function Send-Json {
    param(
        $Response,
        [int]$Status,
        $Object
    )

    $json =
        $Object |
        ConvertTo-Json -Compress

    $bytes =
        [System.Text.Encoding]::UTF8.GetBytes(
            $json
        )

    $Response.StatusCode =
        $Status

    $Response.ContentType =
        "application/json; charset=utf-8"

    $Response.ContentLength64 =
        $bytes.Length

    $Response.OutputStream.Write(
        $bytes,
        0,
        $bytes.Length
    )

    $Response.Close()
}

$printer =
    "POS-58(copy of 1)"

$port =
    17858

$prefix =
    "http://127.0.0.1:$port/"

$listener =
    New-Object System.Net.HttpListener

$listener.Prefixes.Add(
    $prefix
)

try {
    $listener.Start()
}
catch {
    Write-Host ""
    Write-Host "ERROR: Could not start bridge"
    Write-Host $_.Exception.Message
    Write-Host ""
    pause
    exit
}

Write-Host ""
Write-Host "========================================"
Write-Host " Lovely Kids Print Bridge"
Write-Host "========================================"
Write-Host " Status   : RUNNING"
Write-Host " Version  : 0.2.0"
Write-Host " Address  : $prefix"
Write-Host " Printer  : $printer"
Write-Host " Protocol : ESC1 RAW"
Write-Host "========================================"
Write-Host ""

while ($listener.IsListening) {

    $context =
        $listener.GetContext()

    $request =
        $context.Request

    $response =
        $context.Response

    $response.Headers.Add(
        "Access-Control-Allow-Origin",
        "*"
    )

    $response.Headers.Add(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    )

    $response.Headers.Add(
        "Access-Control-Allow-Headers",
        "Content-Type"
    )

    $response.Headers.Add(
        "Access-Control-Allow-Private-Network",
        "true"
    )

    if (
        $request.HttpMethod -eq
        "OPTIONS"
    ) {
        $response.StatusCode = 204
        $response.Close()
        continue
    }

    if (
        $request.Url.AbsolutePath -eq
        "/health"
    ) {
        Send-Json `
            $response `
            200 `
            @{
                ok       = $true
                service  = "Lovely Kids Print Bridge"
                printer  = $printer
                protocol = "ESC1-RAW"
                version  = "0.2.0"
            }

        continue
    }

    if (
        $request.Url.AbsolutePath -eq
        "/print-png" -and
        $request.HttpMethod -eq
        "POST"
    ) {
        try {

            $width = 174

            $requestedWidth =
                $request.QueryString[
                    "width"
                ]

            if ($requestedWidth) {
                $parsedWidth = 0

                if (
                    [int]::TryParse(
                        $requestedWidth,
                        [ref]$parsedWidth
                    )
                ) {
                    $width =
                        $parsedWidth
                }
            }

            if ($width -lt 64) {
                $width = 64
            }

            if ($width -gt 384) {
                $width = 384
            }

            $copies = 1

            $requestedCopies =
                $request.QueryString[
                    "copies"
                ]

            if ($requestedCopies) {
                $parsedCopies = 0

                if (
                    [int]::TryParse(
                        $requestedCopies,
                        [ref]$parsedCopies
                    )
                ) {
                    $copies =
                        $parsedCopies
                }
            }

            if ($copies -lt 1) {
                $copies = 1
            }

            if ($copies -gt 20) {
                $copies = 20
            }

            $body =
                New-Object System.IO.MemoryStream

            $request.InputStream.CopyTo(
                $body
            )

            $imageBytes =
                $body.ToArray()

            $body.Dispose()

            if (
                $imageBytes.Length -eq 0
            ) {
                Send-Json `
                    $response `
                    400 `
                    @{
                        ok = $false
                        error = "Empty image"
                    }

                continue
            }

            $raw =
                Convert-ImageToEscPosRaster `
                    -ImageBytes $imageBytes `
                    -TargetWidth $width

            $allOk =
                $true

            for (
                $i = 0;
                $i -lt $copies;
                $i++
            ) {
                $ok =
                    [LovelyRawPrinter]::Send(
                        $printer,
                        $raw
                    )

                if (!$ok) {
                    $allOk =
                        $false

                    break
                }
            }

            if ($allOk) {
                Send-Json `
                    $response `
                    200 `
                    @{
                        ok        = $true
                        printer   = $printer
                        copies    = $copies
                        widthDots = $width
                    }
            }
            else {
                Send-Json `
                    $response `
                    500 `
                    @{
                        ok = $false
                        error = "Printer write failed"
                    }
            }
        }
        catch {
            Send-Json `
                $response `
                500 `
                @{
                    ok = $false
                    error = $_.Exception.Message
                }
        }

        continue
    }

    Send-Json `
        $response `
        404 `
        @{
            ok = $false
            error = "Not found"
        }
}
