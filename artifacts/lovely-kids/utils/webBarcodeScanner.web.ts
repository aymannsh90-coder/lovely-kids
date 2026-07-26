import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

export type WebBarcodeScannerControls = {
  stop: () => void;
};

export async function startWebBarcodeScanner(
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
