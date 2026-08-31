import html2canvas from "html2canvas";

const PRINT_BRIDGE_BASE = "http://127.0.0.1:17858";
const RECEIPT_WIDTH_DOTS = 384;

type BridgeHealth = {
  ok?: boolean;
  printer?: string;
  version?: string;
};

async function ensureReceiptBridge() {
  const response = await fetch(`${PRINT_BRIDGE_BASE}/health`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("تعذر الاتصال ببرنامج Lovely Kids Print Bridge");
  }

  const health = (await response.json()) as BridgeHealth;

  if (!health.ok) {
    throw new Error("الطابعة غير جاهزة في Print Bridge");
  }

  return health;
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("تعذر تجهيز صورة الفاتورة للطباعة"));
      }
    }, "image/png");
  });
}

export async function printReceiptElementDirect(
  source: HTMLElement,
): Promise<void> {
  await ensureReceiptBridge();

  const captureHost = document.createElement("div");
  captureHost.dataset.directReceiptCapture = "true";

  Object.assign(captureHost.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${RECEIPT_WIDTH_DOTS}px`,
    background: "#ffffff",
    zIndex: "-9999",
    pointerEvents: "none",
  });

  const receipt = source.cloneNode(true) as HTMLElement;

  receipt.style.display = "block";
  receipt.style.width = `${RECEIPT_WIDTH_DOTS}px`;
  receipt.style.minWidth = `${RECEIPT_WIDTH_DOTS}px`;
  receipt.style.maxWidth = `${RECEIPT_WIDTH_DOTS}px`;

  captureHost.appendChild(receipt);
  document.body.appendChild(captureHost);

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve()),
      ),
    );

    const canvas = await html2canvas(receipt, {
      backgroundColor: "#ffffff",
      scale: 1,
      width: RECEIPT_WIDTH_DOTS,
      windowWidth: RECEIPT_WIDTH_DOTS,
      useCORS: true,
      logging: false,
    });

    const png = await canvasToPngBlob(canvas);

    const response = await fetch(
      `${PRINT_BRIDGE_BASE}/print-receipt-png?width=${RECEIPT_WIDTH_DOTS}&copies=1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
        },
        body: png,
      },
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(
        message || "تعذر إرسال الفاتورة إلى الطابعة",
      );
    }
  } finally {
    captureHost.remove();
  }
}
