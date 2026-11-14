import type { SourceFragment } from '@ugra/contracts';

/** Тип картинки по умолчанию: скриншоты приходят PNG. */
export const DEFAULT_IMAGE_MIME = 'image/png';

/** Источник-картинка черновика: сама картинка в base64 и её mimeType. */
export interface ImageSourceData {
  source: SourceFragment;
  /** Base64 без префикса `data:…`. */
  data: string;
  mimeType: string;
}

/** `data:image/png;base64,AAAA` → `AAAA`; обычная строка остаётся как есть. */
export function stripDataUrl(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

/**
 * Соглашение о картинке в черновике (пока ядро не умеет вложения):
 * `kind: 'image'`, `text` — картинка в base64 (можно data URL), `label` — mimeType (`image/png`).
 * Нет такой картинки или она пустая — шагу нечего распознавать.
 */
export function findImageSource(sources: readonly SourceFragment[]): ImageSourceData | null {
  const source = sources.find((item) => item.kind === 'image');
  if (!source) return null;
  const data = stripDataUrl(source.text).replace(/\s+/g, '');
  if (data === '') return null;
  const mimeType =
    source.label !== undefined && /^image\//.test(source.label) ? source.label : DEFAULT_IMAGE_MIME;
  return { source, data, mimeType };
}
