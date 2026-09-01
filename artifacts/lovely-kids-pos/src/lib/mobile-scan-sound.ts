type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let audioBufferPromise: Promise<AudioBuffer> | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextClass =
    window.AudioContext ||
    (window as WindowWithWebkitAudio).webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  audioContext = new AudioContextClass();

  return audioContext;
}

function loadBarcodeSound(
  context: AudioContext,
): Promise<AudioBuffer> {
  if (!audioBufferPromise) {
    audioBufferPromise = fetch(
      "/barcode-beep.wav",
      {
        cache: "force-cache",
      },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            "Barcode sound could not be loaded",
          );
        }

        return response.arrayBuffer();
      })
      .then((data) =>
        context.decodeAudioData(data),
      );
  }

  return audioBufferPromise;
}

/*
 * يتم استدعاؤها عند ضغط المستخدم على زر فتح الكاميرا.
 * هذا مهم خصوصًا على iPhone حتى يسمح Safari بالصوت لاحقًا.
 */
export function unlockMobileScanSound() {
  try {
    const context = getAudioContext();

    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      void context.resume();
    }

    void loadBarcodeSound(context).catch(
      () => undefined,
    );
  } catch {
    // الصوت تحسين إضافي ولا يجب أن يؤثر على الماسح.
  }
}

export async function playMobileScanSound() {
  try {
    const context = getAudioContext();

    if (!context) {
      const audio = new Audio(
        "/barcode-beep.wav",
      );

      await audio.play();
      return;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    const buffer =
      await loadBarcodeSound(context);

    const source =
      context.createBufferSource();

    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  } catch {
    // فشل الصوت لا يمنع عملية المسح.
  }
}
