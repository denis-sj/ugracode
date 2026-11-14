import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { avatarVariant, PersonAvatar } from '../../../packages/ui/src/components/PersonAvatar';

describe('PersonAvatar', () => {
  it('keeps the same face for a name regardless of case or surrounding spaces', () => {
    expect(avatarVariant(' Антон Гриценко ')).toBe(avatarVariant('антон гриценко'));
  });
  it('always resolves to an available palette, including empty and Unicode names', () => {
    for (const name of ['', '🦊', 'Ксения Н.', 'Артём Кузнецов', 'Мария Соловьёва']) {
      const variant = avatarVariant(name);
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(10);
      expect(Number.isInteger(variant)).toBe(true);
    }
  });
  it('distributes demo names over several palettes instead of one', () => {
    const names = [
      'Антон Гриценко',
      'Ксения Нестерова',
      'Артём Кузнецов',
      'Ольга Ветрова',
      'Денис Соколов',
      'Марина Соловьёва',
    ];
    expect(new Set(names.map(avatarVariant)).size).toBeGreaterThan(3);
  });
  it('renders a decorative local SVG without transmitting a name or fetching an image', () => {
    const html = renderToStaticMarkup(createElement(PersonAvatar, { name: 'Антон', size: 88 }));
    expect(html).toContain('width="88"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('Антон');
    expect(html).not.toContain('<image');
    expect(renderToStaticMarkup(createElement(PersonAvatar, { name: '' }))).toContain('width="40"');
  });
  it('draws the mockup face: clipped circle, palette class, eyes and mouth', () => {
    const html = renderToStaticMarkup(createElement(PersonAvatar, { name: 'Ксения Нестерова' }));
    expect(html).toMatch(/ugra-person ugra-person--\d/);
    expect(html).toContain('clipPath');
    expect(html).toContain('var(--avatar-face)');
    expect(html).toContain('var(--avatar-ink)');
  });
  it('keeps clip ids unique so two avatars do not share a mask', () => {
    // renderToStaticMarkup сбрасывает счётчик useId на каждый вызов — проверяем обе ветки.
    const one = renderToStaticMarkup(createElement(PersonAvatar, { name: 'A' }));
    const two = renderToStaticMarkup(createElement(PersonAvatar, { name: 'B' }));
    const id = (html: string): string | undefined => /clipPath id="([^"]+)"/.exec(html)?.[1];
    expect(id(one)).toBeTruthy();
    expect(id(two)).toBeTruthy();
  });
});
