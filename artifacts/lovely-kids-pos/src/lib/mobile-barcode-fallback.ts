type DetectedBarcode = {
  rawValue: string;
};

type BarcodeDetectorInstance = {
  detect: (
    source: HTMLVideoElement,
  ) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = {
  new (): BarcodeDetectorInstance;
};

function isMobilePosHost() {
  const host = window.location.hostname;

  return (
    host === "mpos.lovelykids.net" ||
    host === "lovely-kids-mobile-pos.pages.dev" ||
    host.endsWith(
      ".lovely-kids-mobile-pos.pages.dev",
    )
  );
}

let readerPromise: Promise<any> | null = null;
let scanCanvas: HTMLCanvasElement | null = null;

async function getReader() {
  if (!readerPromise) {
    readerPromise = Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]).then(([browser, library]) => {
      const hints = new Map();

      hints.set(
        library.DecodeHintType.TRY_HARDER,
        true,
      );

      hints.set(
        library.DecodeHintType.POSSIBLE_FORMATS,
        [
          library.BarcodeFormat.EAN_13,
          library.BarcodeFormat.EAN_8,
          library.BarcodeFormat.UPC_A,
          library.BarcodeFormat.UPC_E,
          library.BarcodeFormat.CODE_128,
          library.BarcodeFormat.CODE_39,
          library.BarcodeFormat.CODE_93,
          library.BarcodeFormat.ITF,
          library.BarcodeFormat.CODABAR,
          library.BarcodeFormat.QR_CODE,
        ],
      );

      return new browser.BrowserMultiFormatReader(
        hints,
      );
    });
  }

  return readerPromise;
}

class ZxingBarcodeDetector
  implements BarcodeDetectorInstance
{
  async detect(
    source: HTMLVideoElement,
  ): Promise<DetectedBarcode[]> {
    if (
      !source ||
      source.readyState < 2 ||
      source.videoWidth <= 0 ||
      source.videoHeight <= 0
    ) {
      return [];
    }

    if (!scanCanvas) {
      scanCanvas =
        document.createElement("canvas");
    }

    const maxWidth = 1280;

    const scale = Math.min(
      1,
      maxWidth / source.videoWidth,
    );

    const width = Math.max(
      1,
      Math.round(source.videoWidth * scale),
    );

    const height = Math.max(
      1,
      Math.round(source.videoHeight * scale),
    );

    if (
      scanCanvas.width !== width ||
      scanCanvas.height !== height
    ) {
      scanCanvas.width = width;
      scanCanvas.height = height;
    }

    const context = scanCanvas.getContext(
      "2d",
      {
        willReadFrequently: true,
      },
    );

    if (!context) {
      return [];
    }

    context.drawImage(
      source,
      0,
      0,
      width,
      height,
    );

    try {
      const reader = await getReader();

      const result =
        await reader.decodeFromCanvas(
          scanCanvas,
        );

      const value =
        result?.getText?.()?.trim?.() ?? "";

      return value
        ? [{ rawValue: value }]
        : [];
    } catch {
      // عدم وجود باركود في هذا الإطار طبيعي.
      return [];
    }
  }
}

if (
  isMobilePosHost() &&
  !(window as any).BarcodeDetector
) {
  (window as any).BarcodeDetector =
    ZxingBarcodeDetector as BarcodeDetectorConstructor;
}
