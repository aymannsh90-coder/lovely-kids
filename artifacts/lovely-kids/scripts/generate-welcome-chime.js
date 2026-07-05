/**
 * Synthesizes a short, pleasant "welcome back" chime as a WAV file.
 * Pure sine-wave synthesis with an ADSR-ish envelope -- no external
 * audio assets or licensed music are used, so there are no copyright
 * concerns with this generated sound.
 *
 * Run with: node scripts/generate-welcome-chime.js
 */
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;

// A gentle three-note ascending arpeggio (major triad), like a soft doorbell.
const notes = [
  { freq: 523.25, start: 0.0, duration: 0.42 }, // C5
  { freq: 659.25, start: 0.14, duration: 0.42 }, // E5
  { freq: 783.99, start: 0.28, duration: 0.55 }, // G5
];

const totalDuration =
  Math.max(...notes.map((n) => n.start + n.duration)) + 0.15;
const totalSamples = Math.ceil(totalDuration * SAMPLE_RATE);
const samples = new Float32Array(totalSamples);

function envelope(t, duration) {
  const attack = 0.02;
  const release = duration * 0.7;
  if (t < attack) return t / attack;
  if (t < duration - release) return 1;
  if (t < duration) return Math.max(0, (duration - t) / release);
  return 0;
}

for (const note of notes) {
  const startSample = Math.floor(note.start * SAMPLE_RATE);
  const noteSamples = Math.floor(note.duration * SAMPLE_RATE);
  for (let i = 0; i < noteSamples; i++) {
    const t = i / SAMPLE_RATE;
    const idx = startSample + i;
    if (idx >= samples.length) break;
    const env = envelope(t, note.duration);
    const fundamental = Math.sin(2 * Math.PI * note.freq * t);
    const overtone = 0.25 * Math.sin(2 * Math.PI * note.freq * 2 * t);
    samples[idx] += 0.28 * env * (fundamental + overtone);
  }
}

// Convert to 16-bit PCM
const pcm = new Int16Array(totalSamples);
for (let i = 0; i < totalSamples; i++) {
  const s = Math.max(-1, Math.min(1, samples[i]));
  pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
}

function writeWav(pcmData, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcmData.length; i++) {
    buffer.writeInt16LE(pcmData[i], 44 + i * 2);
  }
  return buffer;
}

const wavBuffer = writeWav(pcm, SAMPLE_RATE);
const outPath = path.join(
  __dirname,
  "..",
  "assets",
  "sounds",
  "welcome-chime.wav",
);
fs.writeFileSync(outPath, wavBuffer);
console.log(`Wrote ${outPath} (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
