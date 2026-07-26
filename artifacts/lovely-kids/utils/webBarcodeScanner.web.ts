import { BrowserMultiFormatReader } from "@zxing/browser";

export type WebBarcodeScannerControls = {
  stop: () => void;
};

export async function startWebBarcodeScanner(
  videoElementId: string,
  onResult: (value: string) => void
): Promise<WebBarcodeScannerControls> {
  const reader = new BrowserMultiFormatReader();

  return reader.decodeFromConstraints(
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
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
