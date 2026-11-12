import assert from "node:assert/strict";
import test from "node:test";
import { captureScannerKeyboardEvent, createScannerKeyboardBuffer } from "./scannerKeyboard.ts";

function scanCharacter(buffer, code, key, shiftKey, timeStamp) {
  return captureScannerKeyboardEvent(buffer, {
    code, key, shiftKey, timeStamp,
    ctrlKey: false, altKey: false, metaKey: false,
  });
}

test("scanner returns English Lovely Kids barcode with Arabic Windows keyboard active", () => {
  const buffer = createScannerKeyboardBuffer();
  const events = [
    ["KeyL", "ل", true], ["KeyK", "،", true],
    ["KeyQ", "َ", true], ["KeyR", "ٌ", true],
    ["Minus", "-", false], ["Digit4", "4", false],
    ["Digit9", "9", false], ["Digit0", "0", false],
    ["Minus", "-", false], ["Digit0", "0", false],
    ["Digit9", "9", false], ["Digit6", "6", false],
    ["KeyO", "×", true], ["KeyC", "}", true],
    ["KeyY", "إ", true], ["KeyS", "ٍ", true],
  ];
  events.forEach(([code, key, shiftKey], index) => {
    assert.equal(scanCharacter(buffer, code, key, shiftKey, index * 8 + 1), null);
  });
  const result = scanCharacter(buffer, "Enter", "Enter", false, 150);
  assert.equal(result, "LKQR-490-096OCYS");
});

test("typing slowly in Arabic is not mistaken for a scanner barcode", () => {
  const buffer = createScannerKeyboardBuffer();
  const events = [["KeyL", "ل"], ["KeyK", "ن"], ["KeyQ", "ض"], ["KeyR", "ق"]];
  events.forEach(([code, key], index) =>
    scanCharacter(buffer, code, key, false, index * 400 + 1));
  assert.equal(scanCharacter(buffer, "Enter", "Enter", false, 1800), null);
});
