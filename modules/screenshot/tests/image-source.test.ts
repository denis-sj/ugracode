import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_MIME, findImageSource, stripDataUrl } from '../server/image-source';

describe('screenshot: картинка в источниках черновика', () => {
  it('находит источник image и снимает префикс data URL', () => {
    const found = findImageSource([
      { id: 'text', kind: 'text', text: 'не печатает' },
      { id: 'photo', kind: 'image', text: 'data:image/jpeg;base64,AAAA', label: 'image/jpeg' },
    ]);

    expect(found).toMatchObject({ data: 'AAAA', mimeType: 'image/jpeg' });
    expect(found?.source.id).toBe('photo');
  });

  it('base64 с переводами строк чистится, тип по умолчанию — png', () => {
    const found = findImageSource([{ id: 'photo', kind: 'image', text: 'AA\nAA\n' }]);

    expect(found).toMatchObject({ data: 'AAAA', mimeType: DEFAULT_IMAGE_MIME });
  });

  it('подпись не image/* не считается типом картинки', () => {
    const found = findImageSource([{ id: 'photo', kind: 'image', text: 'AAAA', label: 'Скриншот' }]);

    expect(found?.mimeType).toBe(DEFAULT_IMAGE_MIME);
  });

  it('картинки нет или она пустая — null', () => {
    expect(findImageSource([])).toBeNull();
    expect(findImageSource([{ id: 'text', kind: 'text', text: 'AAAA' }])).toBeNull();
    expect(findImageSource([{ id: 'photo', kind: 'image', text: '   ' }])).toBeNull();
  });

  it('stripDataUrl не трогает обычный base64', () => {
    expect(stripDataUrl('AAAA')).toBe('AAAA');
  });
});
