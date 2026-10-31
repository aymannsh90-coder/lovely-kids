import "./InventoryVisualRefresh.css";
import { useEffect, useMemo, useRef } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";

const ADMIN_BASE_URL = (
  import.meta.env.VITE_ADMIN_BASE_URL || "https://lovelykids.net"
).replace(/\/+$/, "");

const ADMIN_ORIGIN = new URL(ADMIN_BASE_URL).origin;

export default function ProductEditorPage() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const navigate = useNavigate();
  const { productId } = useParams<{ productId?: string }>();
  const [searchParams] = useSearchParams();
  const { token, user } = usePosRuntime();

  const canManage = user?.isAdmin === true || user?.isOwner === true;
  const copyFrom = searchParams.get("copyFrom")?.trim() || "";

  const editorUrl = useMemo(() => {
    const url = new URL("/admin/add-product", ADMIN_BASE_URL);
    url.searchParams.set("embed", "pos");

    if (productId) {
      url.searchParams.set("productId", productId);
    } else if (copyFrom) {
      url.searchParams.set("copyFrom", copyFrom);
    }

    return url.toString();
  }, [productId, copyFrom]);

  function sendSessionToEditor() {
    if (!canManage) return;

    frameRef.current?.contentWindow?.postMessage(
      {
        type: "lovely-pos-session",
        token,
      },
      ADMIN_ORIGIN,
    );
  }

  useEffect(() => {
    document.title = productId
      ? "تعديل الصنف | Lovely Kids POS"
      : copyFrom
        ? "نسخ الصنف | Lovely Kids POS"
        : "إضافة صنف | Lovely Kids POS";
  }, [productId, copyFrom]);

  useEffect(() => {
    if (!canManage) return;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== ADMIN_ORIGIN) return;
      if (event.source !== frameRef.current?.contentWindow) return;

      const message = event.data as { type?: unknown } | null;

      if (message?.type === "lovely-admin-ready") {
        sendSessionToEditor();
        return;
      }

      if (
        message?.type === "lovely-product-saved" ||
        message?.type === "lovely-product-editor-close"
      ) {
        navigate("/inventory/products", { replace: true });
      }
    }

    window.addEventListener("message", handleMessage);

    const retryTimers = [0, 250, 750, 1500, 3000].map((delay) =>
      window.setTimeout(sendSessionToEditor, delay),
    );

    return () => {
      window.removeEventListener("message", handleMessage);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [token, canManage, navigate]);

  if (!canManage) {
    return (
      <section className="pos-product-editor-page lk-inventory-refresh lk-inventory-editor">
        <div className="pos-products-denied">
          <strong>غير مصرح</strong>
          <p>إدارة الأصناف متاحة للمالك والمديرين فقط.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="pos-product-editor-page lk-inventory-refresh lk-inventory-editor">
      <div className="pos-product-editor-heading">
        <div>
          <span className="pos-products-eyebrow">الأصناف والمخزون</span>
          <h1>
            {productId
              ? "تعديل الصنف"
              : copyFrom
                ? "نسخ الصنف"
                : "إضافة صنف جديد"}
          </h1>
          <p>
            نفس نموذج المتجر الإلكتروني ونفس قواعد الباركود والمخزون والتكلفة.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={() => navigate("/inventory/products")}
        >
          رجوع للأصناف
        </button>
      </div>

      <div className="pos-product-editor-frame-shell">
        <iframe
          ref={frameRef}
          className="pos-product-editor-frame"
          src={editorUrl}
          title={
            productId
              ? "تعديل الصنف"
              : copyFrom
                ? "نسخ الصنف"
                : "إضافة صنف"
          }
          onLoad={sendSessionToEditor}
        />
      </div>
    </section>
  );
}
