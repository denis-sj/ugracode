import type { ScreenshotInput } from '@ugra/contracts';

/** 8 МБ: столько весит скриншот с телефона; больше — просим сжать, сервер всё равно не примет. */
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

/** Минимум того, что нужно от файла: проверяется до чтения в base64. */
export interface ImageFileLike {
  name: string;
  size: number;
  type: string;
}

/** Почему файл не подходит, или `null`, если это картинка нормального размера. */
export function imageFileProblem(file: ImageFileLike): string | null {
  if (!file.type.startsWith('image/')) return 'Это не картинка: выберите скриншот или фото';
  if (file.size === 0) return 'Файл пустой';
  if (file.size > MAX_SCREENSHOT_BYTES) return 'Картинка больше 8 МБ — сожмите её и попробуйте снова';
  return null;
}

/** `data:image/png;base64,AAAA` → `AAAA`; уже чистый base64 возвращается как есть. */
export function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return dataUrl.startsWith('data:') && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Тело запроса `POST /api/screenshot` из data URL и типа файла. */
export function screenshotInput(dataUrl: string, mimeType: string): ScreenshotInput {
  const type = mimeType.startsWith('image/') ? mimeType : 'image/png';
  return { image: toBase64(dataUrl), mimeType: type };
}

/** Файл картинки → base64 для `POST /api/screenshot`. */
export function readImageFile(file: Blob): Promise<ScreenshotInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result === '') {
        reject(new Error('Не удалось прочитать картинку'));
        return;
      }
      resolve(screenshotInput(result, file.type));
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать картинку'));
    reader.readAsDataURL(file);
  });
}
