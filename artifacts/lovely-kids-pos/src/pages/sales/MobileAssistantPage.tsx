import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  createPosAssistantDraft,
  getPosAssistantDrafts,
  type PosAssistantDraft,
} from "../../lib/api";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0:
    SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike
  extends Event {
  results: {
    length: number;
    [index: number]:
      SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult:
    | ((
        event:
          SpeechRecognitionEventLike,
      ) => void)
    | null;
  onerror:
    | ((
        event: Event & {
          error?: string;
        },
      ) => void)
    | null;
  onend:
    | (() => void)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructorLike =
  new () =>
    SpeechRecognitionInstanceLike;

function errorText(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function formatMinor(
  value: number | null,
) {
  if (value === null) {
    return "—";
  }

  return `${(
    value / 100
  ).toFixed(2)} ₪`;
}

function intentLabel(
  intent:
    PosAssistantDraft["intent"],
) {
  if (
    intent ===
    "employee_advance"
  ) {
    return "سحب / سلفة موظف";
  }

  if (
    intent ===
    "expense"
  ) {
    return "مصروف";
  }

  if (
    intent ===
    "owner_withdrawal"
  ) {
    return "سحب مالك";
  }

  if (
    intent ===
    "finance_transfer"
  ) {
    return "تحويل صندوق ↔ بنك";
  }

  return "بحاجة لتحديد";
}

export default function MobileAssistantPage() {
  const {
    token,
    user,
    session,
    clearAuthentication,
  } =
    usePosRuntime();

  const [text, setText] =
    useState("");

  const [source, setSource] =
    useState<
      | "text"
      | "voice"
    >("text");

  const [saving, setSaving] =
    useState(false);

  const [
    listening,
    setListening,
  ] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    recentDrafts,
    setRecentDrafts,
  ] =
    useState<
      PosAssistantDraft[]
    >([]);

  const speechRef =
    useRef<
      SpeechRecognitionInstanceLike | null
    >(null);

  const speechSupported =
    useMemo(
      () => {
        const scope =
          window as unknown as {
            SpeechRecognition?:
              SpeechRecognitionConstructorLike;
            webkitSpeechRecognition?:
              SpeechRecognitionConstructorLike;
          };

        return Boolean(
          scope.SpeechRecognition ??
            scope.webkitSpeechRecognition,
        );
      },
      [],
    );

  async function loadRecent() {
    try {
      const result =
        await getPosAssistantDrafts(
          token,
          "all",
        );

      const myId =
        Number(
          user?.id,
        );

      setRecentDrafts(
        result.results
          .filter(
            (draft) =>
              !Number.isSafeInteger(
                myId,
              ) ||
              draft.createdByUserId ===
                myId,
          )
          .slice(0, 6),
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
      ) {
        clearAuthentication();
      }
    }
  }

  useEffect(() => {
    document.title =
      "المساعد | Lovely Kids POS";

    void loadRecent();

    return () => {
      speechRef.current?.abort();
      speechRef.current =
        null;
    };
  }, []);

  async function saveDraft(
    rawText: string,
    draftSource:
      | "text"
      | "voice",
  ) {
    const normalized =
      rawText.trim();

    if (!normalized) {
      setError(
        "اكتب أو احكي الحركة أولًا.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createPosAssistantDraft(
          token,
          {
            text:
              normalized,
            source:
              draftSource,
            registerKey:
              session?.registerKey ??
              "main",
          },
        );

      setText("");
      setSource("text");

      const parsed =
        result.parsed;

      setMessage(
        `تم حفظ ${result.draft.publicId} كمسودة فقط. ${parsed.parseMessage}`,
      );

      await loadRecent();
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorText(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    void saveDraft(
      text,
      source,
    );
  }

  function startVoice() {
    setError("");
    setMessage("");

    const scope =
      window as unknown as {
        SpeechRecognition?:
          SpeechRecognitionConstructorLike;
        webkitSpeechRecognition?:
          SpeechRecognitionConstructorLike;
      };

    const Constructor =
      scope.SpeechRecognition ??
      scope.webkitSpeechRecognition;

    if (!Constructor) {
      setError(
        "التعرف الصوتي غير متاح في هذا المتصفح. استخدم الكتابة بدلًا منه.",
      );
      return;
    }

    speechRef.current?.abort();

    const recognition =
      new Constructor();

    speechRef.current =
      recognition;

    recognition.lang =
      "ar-PS";
    recognition.interimResults =
      true;
    recognition.continuous =
      false;
    recognition.maxAlternatives =
      1;

    recognition.onresult =
      (event) => {
        let transcript =
          "";

        let finalText =
          "";

        for (
          let index = 0;
          index <
          event.results.length;
          index += 1
        ) {
          const result =
            event.results[index];

          const value =
            result?.[0]?.transcript ??
            "";

          transcript +=
            value;

          if (
            result?.isFinal
          ) {
            finalText +=
              value;
          }
        }

        if (
          transcript.trim()
        ) {
          setText(
            transcript.trim(),
          );
          setSource(
            "voice",
          );
        }

        if (
          finalText.trim()
        ) {
          recognition.stop();
          void saveDraft(
            finalText.trim(),
            "voice",
          );
        }
      };

    recognition.onerror =
      (event) => {
        setListening(false);

        const code =
          event.error ??
          "";

        setError(
          code ===
            "not-allowed"
            ? "اسمح للمتصفح باستخدام الميكروفون ثم حاول مرة ثانية."
            : "تعذر التعرف على الصوت. يمكنك كتابة الحركة يدويًا.",
        );
      };

    recognition.onend =
      () => {
        setListening(false);
      };

    try {
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      setError(
        "تعذر تشغيل الميكروفون الآن.",
      );
    }
  }

  function stopVoice() {
    speechRef.current?.stop();
    setListening(false);
  }

  return (
    <main
      className="mobile-pos-page"
      dir="rtl"
    >
      <div className="mobile-pos-shell mobile-assistant-shell">
        <header className="mobile-pos-header">
          <div>
            <strong>
              Lovely Kids
            </strong>
            <span>
              المساعد الذكي
            </span>
          </div>

          <div className="mobile-pos-header-actions">
            <Link to="/sales/pos">
              رجوع
            </Link>
          </div>
        </header>

        <nav className="mobile-pos-tabs">
          <Link to="/sales/mobile">
            فاتورة مبيعات
          </Link>

          <Link to="/sales/mobile/returns">
            مردودات مبيعات
          </Link>

          <Link to="/sales/mobile/price-check">
            فحص السعر
          </Link>

          <Link
            className="is-active"
            to="/sales/mobile/assistant"
          >
            المساعد
          </Link>
        </nav>

        <div className="mobile-pos-user">
          <span>
            👤 {user?.name ?? "مستخدم"}
          </span>
          <span>
            📝 مسودات فقط
          </span>
        </div>

        {error && (
          <div className="mobile-pos-alert mobile-pos-error">
            {error}
          </div>
        )}

        {message && (
          <div className="mobile-pos-alert mobile-pos-success">
            {message}
          </div>
        )}

        <section className="mobile-assistant-card">
          <div className="mobile-assistant-heading">
            <span>
              ✨
            </span>
            <div>
              <h1>
                احكيلي الحركة
              </h1>
              <p>
                مثال: أيمن سحب 100 شيكل، دفعت كهربا 80، أو إيداع 100 من الصندوق في البنك.
              </p>
            </div>
          </div>

          <form
            onSubmit={
              submit
            }
          >
            <textarea
              rows={5}
              value={text}
              onChange={(
                event,
              ) => {
                setText(
                  event.target.value,
                );
                setSource(
                  "text",
                );
              }}
              placeholder="اكتب الحركة هنا..."
              disabled={
                saving
              }
            />

            <div className="mobile-assistant-actions">
              <button
                className={
                  listening
                    ? "mobile-assistant-mic is-listening"
                    : "mobile-assistant-mic"
                }
                type="button"
                onClick={
                  listening
                    ? stopVoice
                    : startVoice
                }
                disabled={
                  saving ||
                  !speechSupported
                }
              >
                {listening
                  ? "⏹ إيقاف"
                  : "🎙️ احكي"}
              </button>

              <button
                className="mobile-assistant-save"
                type="submit"
                disabled={
                  saving ||
                  !text.trim()
                }
              >
                {saving
                  ? "جاري الحفظ…"
                  : "حفظ كمسودة"}
              </button>
            </div>
          </form>

          <div className="mobile-assistant-safety">
            لا يتم خصم أي مبلغ ولا إنشاء قيد أو سند من هذه الشاشة. الاعتماد يتم لاحقًا من الكمبيوتر.
          </div>
        </section>

        <section className="mobile-assistant-recent">
          <div className="mobile-assistant-section-title">
            <strong>
              آخر مسوداتي
            </strong>
            <span>
              {recentDrafts.length}
            </span>
          </div>

          {recentDrafts.length ===
          0 ? (
            <div className="mobile-assistant-empty">
              لا توجد مسودات بعد.
            </div>
          ) : (
            recentDrafts.map(
              (draft) => (
                <article
                  key={
                    draft.id
                  }
                  className="mobile-assistant-draft"
                >
                  <div>
                    <strong>
                      {
                        draft.originalText
                      }
                    </strong>
                    <small>
                      {
                        draft.publicId
                      }{" "}
                      •{" "}
                      {intentLabel(
                        draft.intent,
                      )}
                    </small>
                  </div>

                  <div className="mobile-assistant-draft-meta">
                    <span>
                      {formatMinor(
                        draft.amountMinor,
                      )}
                    </span>
                    <b
                      className={
                        `is-${draft.status}`
                      }
                    >
                      {draft.status ===
                      "pending"
                        ? "بانتظار المراجعة"
                        : draft.status ===
                            "approved"
                          ? "معتمدة"
                          : "مرفوضة"}
                    </b>
                  </div>
                </article>
              ),
            )
          )}
        </section>
      </div>
    </main>
  );
}
