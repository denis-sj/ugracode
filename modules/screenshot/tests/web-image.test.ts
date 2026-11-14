// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  MAX_SCREENSHOT_BYTES,
  imageFileProblem,
  readImageFile,
  screenshotInput,
  toBase64,
} from '../web/image';

describe('screenshot: картинка из формы', () => {
  it('принимает картинку нормального размера', () => {
    expect(imageFileProblem({ name: 'screen.png', size: 1024, type: 'image/png' })).toBeNull();
  });

  it('отклоняет не картинку, пустой файл и слишком большой снимок', () => {
    expect(imageFileProblem({ name: 'doc.pdf', size: 1024, type: 'application/pdf' })).toContain(
      'не картинка',
    );
    expect(imageFileProblem({ name: 'empty.png', size: 0, type: 'image/png' })).toContain('пустой');
    expect(
      imageFileProblem({ name: 'huge.jpg', size: MAX_SCREENSHOT_BYTES + 1, type: 'image/jpeg' }),
    ).toContain('8 МБ');
  });

  it('снимает префикс data URL и подставляет тип картинки', () => {
    expect(toBase64('data:image/png;base64,AAAA')).toBe('AAAA');
    expect(toBase64('AAAA')).toBe('AAAA');
    expect(screenshotInput('data:image/jpeg;base64,BBBB', 'image/jpeg')).toEqual({
      image: 'BBBB',
      mimeType: 'image/jpeg',
    });
    expect(screenshotInput('data:image/png;base64,BBBB', 'text/plain').mimeType).toBe('image/png');
  });

  it('читает файл в base64 через FileReader', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'screen.png', { type: 'image/png' });

    const input = await readImageFile(file);

    expect(input.mimeType).toBe('image/png');
    expect(input.image.length).toBeGreaterThan(0);
    expect(input.image.startsWith('data:')).toBe(false);
  });
});
