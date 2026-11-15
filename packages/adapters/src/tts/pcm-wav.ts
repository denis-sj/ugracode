/** Частота дискретизации Gemini TTS: 16 бит, моно, 24 кГц. */
export const TTS_SAMPLE_RATE = 24_000;
/** Каналов в ответе модели: моно. */
export const TTS_CHANNELS = 1;
/** Бит на сэмпл: 16. */
export const TTS_BITS = 16;
/** Размер заголовка WAV, который дописываем к сырому PCM. */
export const WAV_HEADER_BYTES = 44;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index] ?? 0);
  return text;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/**
 * Это уже контейнер RIFF/WAVE?
 * RouterAI при `response_format: 'pcm'` отдаёт готовый WAV, и второй заголовок сломал бы звук.
 */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength <= WAV_HEADER_BYTES) return false;
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
}

/**
 * PCM 16 бит, моно → WAV. Идемпотентно: готовый RIFF/WAVE возвращается как есть,
 * иначе дописывается 44-байтный заголовок (браузер сырой PCM не играет).
 */
export function pcmToWav(pcm: Uint8Array, sampleRate = TTS_SAMPLE_RATE): Uint8Array {
  if (isWav(pcm)) return pcm;
  const bytesPerSample = (TTS_BITS / 8) * TTS_CHANNELS;
  const dataSize = pcm.byteLength;
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // формат 1 — PCM без сжатия
  header.writeUInt16LE(TTS_CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(TTS_BITS, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

/** Сколько тишины по краям считаем лишней: всё, что тише 1 % шкалы. */
const SILENCE_THRESHOLD = 0.01;
/** Пауза на вдох/выдох перед первой фонемой остаётся — иначе звук начинается с щелчка. */
const SILENCE_PADDING_MS = 30;

interface WavLayout {
  channels: number;
  sampleRate: number;
  bits: number;
  dataStart: number;
}

/** Разбор заголовка WAV: где начинаются сэмплы и в каком они формате. */
function layoutOf(wav: Uint8Array): WavLayout | null {
  if (!isWav(wav)) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  let channels = TTS_CHANNELS;
  let sampleRate = TTS_SAMPLE_RATE;
  let bits = TTS_BITS;
  while (offset + 8 <= wav.byteLength) {
    const id = ascii(wav, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true) || TTS_CHANNELS;
      sampleRate = view.getUint32(offset + 12, true) || TTS_SAMPLE_RATE;
      bits = view.getUint16(offset + 22, true) || TTS_BITS;
    }
    if (id === 'data') return { channels, sampleRate, bits, dataStart: offset + 8 };
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Срезать тишину по краям WAV: Gemini TTS начинает фразу с 160–280 мс паузы,
 * и это время зритель слышит как «задумался» ещё до первого слова.
 * Длительность фразы сокращается ровно на срезанное, кэш хранит уже подрезанный звук.
 */
export function trimSilence(wav: Uint8Array): Uint8Array {
  const layout = layoutOf(wav);
  if (!layout) return wav;
  const frame = layout.channels * (layout.bits / 8);
  if (frame <= 0) return wav;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const total = Math.floor((wav.byteLength - layout.dataStart) / frame);
  if (total <= 0) return wav;
  const loud = (index: number): boolean => {
    const at = layout.dataStart + index * frame;
    return Math.abs(view.getInt16(at, true)) / 32768 >= SILENCE_THRESHOLD;
  };
  let first = 0;
  while (first < total && !loud(first)) first += 1;
  if (first >= total) return wav;
  let last = total - 1;
  while (last > first && !loud(last)) last -= 1;
  const padding = Math.round((layout.sampleRate * SILENCE_PADDING_MS) / 1000);
  const start = Math.max(0, first - padding);
  const end = Math.min(total - 1, last + padding);
  if (start === 0 && end >= total - 1) return wav;
  const data = wav.subarray(layout.dataStart + start * frame, layout.dataStart + (end + 1) * frame);
  const header = wav.subarray(0, layout.dataStart);
  const result = new Uint8Array(header.byteLength + data.byteLength);
  result.set(header, 0);
  result.set(data, header.byteLength);
  const out = new DataView(result.buffer);
  out.setUint32(4, result.byteLength - 8, true);
  out.setUint32(40, data.byteLength, true);
  return result;
}

/**
 * Длительность WAV в секундах по заголовку. Чанки читаем по порядку:
 * провайдер вправе добавить служебный блок перед `data`.
 */
export function wavSeconds(wav: Uint8Array): number {
  if (!isWav(wav)) return 0;
  let offset = 12;
  let bytesPerSecond = TTS_SAMPLE_RATE * (TTS_BITS / 8) * TTS_CHANNELS;
  while (offset + 8 <= wav.byteLength) {
    const id = ascii(wav, offset, 4);
    const size = uint32(wav, offset + 4);
    if (id === 'fmt ' && offset + 16 <= wav.byteLength) {
      const channels = uint16(wav, offset + 10) || TTS_CHANNELS;
      const sampleRate = uint32(wav, offset + 12) || TTS_SAMPLE_RATE;
      const bits = uint16(wav, offset + 22) || TTS_BITS;
      bytesPerSecond = sampleRate * channels * (bits / 8);
    }
    if (id === 'data') return size / bytesPerSecond;
    offset += 8 + size + (size % 2);
  }
  return 0;
}
