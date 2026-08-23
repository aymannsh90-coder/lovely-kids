import { useEffect, useRef } from "react";

import { usePosRuntime } from "../../app/pos-context";

const ADMIN_BASE_URL = (
  import.meta.env.VITE_ADMIN_BASE_URL || "https://lovelykids.net"
).replace(/\/+$/, "");

const ADMIN_ORIGIN = new URL(ADMIN_BASE_URL).origin;

export default function AdminPanelPage() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { token, user } = usePosRuntime();

  const canUseAdmin = user?.isAdmin === true || user?.isOwner === true;

  function sendSessionToAdmin() {
    if (!canUseAdmin) return;

    frameRef.current?.contentWindow?.postMessage(
      {
        type: "lovely-pos-session",
        token,
      },
      ADMIN_ORIGIN,
    );
  }

  useEffect(() => {
    if (!canUseAdmin) return;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== ADMIN_ORIGIN) return;
      if (event.source !== frameRef.current?.contentWindow) return;

      const message = event.data as { type?: unknown } | null;

      if (message?.type === "lovely-admin-ready") {
        sendSessionToAdmin();
      }
    }

    window.addEventListener("message", handleMessage);

    // The embedded admin can hydrate very quickly from cache.
    // Retry the session handshake briefly so iframe load/effect timing
    // can never leave the admin screen without the existing POS session.
    const retryTimers = [0, 250, 750, 1500, 3000].map((delay) =>
      window.setTimeout(sendSessionToAdmin, delay),
    );

    return () => {
      window.removeEventListener("message", handleMessage);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [token, canUseAdmin]);

  if (!canUseAdmin) {
    return (
      <section className="pos-admin-access-denied">
        <strong>غير مصرح</strong>
        <p>لوحة الإدارة متاحة للمالك والمديرين فقط.</p>
      </section>
    );
  }

  return (
    <section className="pos-admin-panel-page">
      <div className="pos-admin-panel-heading">
        <div>
          <h1>لوحة الإدارة</h1>
          <p>
            نفس لوحة إدارة المتجر مباشرة — أي تحديث عليها يظهر هنا تلقائيًا.
          </p>
        </div>

        <a
          href={`${ADMIN_BASE_URL}/admin`}
          target="_blank"
          rel="noreferrer"
          className="pos-admin-open-external"
        >
          فتح بنافذة مستقلة ↗
        </a>
      </div>

      <div className="pos-admin-frame-shell">
        <iframe
          ref={frameRef}
          className="pos-admin-frame"
          src={`${ADMIN_BASE_URL}/admin?embed=pos`}
          title="لوحة إدارة Lovely Kids"
          loading="lazy"
          onLoad={sendSessionToAdmin}
        />
      </div>
    </section>
  );
}
