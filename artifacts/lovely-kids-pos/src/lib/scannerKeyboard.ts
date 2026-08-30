export interface ScannerKeyboardBuffer {
  chars: string[];
  startedAt: number;
  lastAt: number;
  maxGap: number;
}

interface ScannerKeyboardEvent {
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timeStamp: number;
}

const MAX_INTER_KEY_GAP_MS = 60;
const MIN_SCANNER_CHARS = 4;
const MAX_BUFFER_LENGTH = 256;

export function createScannerKeyboardBuffer(): ScannerKeyboardBuffer {
  return {
    chars: [],
    startedAt: 0,
    lastAt: 0,
    maxGap: 0,
  };
}

export function resetScannerKeyboardBuffer(
  buffer: ScannerKeyboardBuffer,
) {
  buffer.chars = [];
  buffer.startedAt = 0;
  buffer.lastAt = 0;
  buffer.maxGap = 0;
}

function codeToUsCharacter(
  code: string,
  shift: boolean,
): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3);

    return shift
      ? letter
      : letter.toLowerCase();
  }

  if (/^Digit[0-9]$/.test(code)) {
    const digit = code.slice(5);

    if (!shift) {
      return digit;
    }

    const shifted: Record<string, string> = {
      "0": ")",
      "1": "!",
      "2": "@",
      "3": "#",
      "4": "$",
      "5": "%",
      "6": "^",
      "7": "&",
      "8": "*",
      "9": "(",
    };

    return shifted[digit] ?? digit;
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return code.slice(6);
  }

  const normal: Record<string, string> = {
    Space: " ",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
    NumpadDecimal: ".",
    NumpadAdd: "+",
    NumpadSubtract: "-",
    NumpadMultiply: "*",
    NumpadDivide: "/",
  };

  const shifted: Record<string, string> = {
    Minus: "_",
    Equal: "+",
    BracketLeft: "{",
    BracketRight: "}",
    Backslash: "|",
    Semicolon: ":",
    Quote: '"',
    Comma: "<",
    Period: ">",
    Slash: "?",
    Backquote: "~",
  };

  if (shift && shifted[code]) {
    return shifted[code];
  }

  return normal[code] ?? null;
}

export function captureScannerKeyboardEvent(
  buffer: ScannerKeyboardBuffer,
  event: ScannerKeyboardEvent,
): string | null {
  const now =
    Number.isFinite(event.timeStamp) && event.timeStamp > 0
      ? event.timeStamp
      : Date.now();

  if (event.key === "Enter" || event.code === "Enter") {
    const value = buffer.chars.join("");

    const duration =
      buffer.startedAt > 0
        ? Math.max(0, now - buffer.startedAt)
        : Number.POSITIVE_INFINITY;

    const maxAllowedDuration =
      Math.max(400, buffer.chars.length * 80);

    const looksLikeScanner =
      buffer.chars.length >= MIN_SCANNER_CHARS &&
      buffer.maxGap <= MAX_INTER_KEY_GAP_MS &&
      duration <= maxAllowedDuration;

    resetScannerKeyboardBuffer(buffer);

    return looksLikeScanner
      ? value
      : null;
  }

  if (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    resetScannerKeyboardBuffer(buffer);
    return null;
  }

  const char = codeToUsCharacter(
    event.code,
    event.shiftKey,
  );

  if (char === null) {
    if (
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "Escape"
    ) {
      resetScannerKeyboardBuffer(buffer);
    }

    return null;
  }

  if (
    buffer.lastAt > 0 &&
    now - buffer.lastAt > MAX_INTER_KEY_GAP_MS
  ) {
    resetScannerKeyboardBuffer(buffer);
  }

  if (buffer.chars.length === 0) {
    buffer.startedAt = now;
    buffer.maxGap = 0;
  } else {
    const gap = Math.max(0, now - buffer.lastAt);
    buffer.maxGap = Math.max(buffer.maxGap, gap);
  }

  buffer.chars.push(char);
  buffer.lastAt = now;

  if (buffer.chars.length > MAX_BUFFER_LENGTH) {
    resetScannerKeyboardBuffer(buffer);
  }

  return null;
}
