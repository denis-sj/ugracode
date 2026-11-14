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
  it('renders a decorative local SVG without transmitting a name or fetching an image', () => {
    const html = renderToStaticMarkup(createElement(PersonAvatar, { name: 'Антон', size: 88 }));
    expect(html).toContain('width="88"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('Антон');
    expect(html).not.toContain('<image');
    expect(renderToStaticMarkup(createElement(PersonAvatar, { name: '' }))).toContain('width="40"');
  });
});
