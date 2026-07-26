import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

export type WebBarcodeScannerControls = {
  stop: () => void;
};

type DetectedBarcode = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

const nativeFormats = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "code_93",
  "itf",
  "codabar",
  "qr_code",
];

async function startZxingScanner(
  videoElementId: string,
  onResult: (value: string) => void
): Promise<WebBarcodeScannerControls> {
  const hints = new Map<DecodeHintType, any>();

  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.QR_CODE,
  ]);

  const reader = new BrowserMultiFormatReader(hints);

  return reader.decodeFromConstraints(
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    videoElementId,
    (result, _error, controls) => {
      if (!result) return;

      const value = result.getText().trim();
      if (!value) return;

      controls.stop();
      onResult(value);
    }
  );
}

export async function startWebBarcodeScanner(
  videoElementId: string,
  onResult: (value: string) => void
): Promise<WebBarcodeScannerControls> {
  const Detector = (globalThis as any)
    .BarcodeDetector as BarcodeDetectorConstructor | undefined;

  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    return startZxingScanner(videoElementId, onResult);
  }

  const video = document.getElementById(
    videoElementId
  ) as HTMLVideoElement | null;

  if (!video) {
    throw new Error("Barcode video element not found");
  }

  let stream: MediaStream | undefined;

  try {
    const supported = Detector.getSupportedFormats
      ? await Detector.getSupportedFormats()
      : [];

    const formats =
      supported.length > 0
        ? nativeFormats.filter((format) => supported.includes(format))
        : nativeFormats;

    if (formats.length === 0) {
      return startZxingScanner(videoElementId, onResult);
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    const detector = new Detector({ formats });

    let stopped = false;
    let timer: number | undefined;

    const stop = () => {
      if (stopped) return;
      stopped = true;

      if (timer !== undefined) {
        window.clearTimeout(timer);
      }

      stream?.getTracks().forEach((track) => track.stop());

      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };

    const scan = async () => {
      if (stopped) return;

      try {
        const results = await detector.detect(video);
        const value = results
          .map((result) => result.rawValue?.trim())
          .find((result): result is string => Boolean(result));

        if (value) {
          stop();
          onResult(value);
          return;
        }
      } catch {
        // Keep scanning; ZXing remains the fallback for unsupported browsers.
      }

      if (!stopped) {
        timer = window.setTimeout(() => {
          void scan();
        }, 80);
      }
    };

    void scan();

    return { stop };
  } catch {
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;

    return startZxingScanner(videoElementId, onResult);
  }
}
