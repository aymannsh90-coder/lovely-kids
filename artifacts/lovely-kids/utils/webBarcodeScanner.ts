export type WebBarcodeScannerControls = {
  stop: () => void;
};

export async function startWebBarcodeScanner(
  _videoElementId: string,
  _onResult: (value: string) => void
): Promise<WebBarcodeScannerControls> {
  return { stop: () => {} };
}
