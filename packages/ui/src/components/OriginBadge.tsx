import type { FieldOrigin } from '@ugra/contracts';
import type { JSX } from 'react';
import { cx } from '../cx';
import type { BadgeTone } from '../types';

interface OriginMeta {
  label: string;
  glyph: string;
  tone: BadgeTone;
  hint: string;
}

/** Значки происхождения поля: 📄 текст · 💬 спросили · 👤 профиль · ✅ база · ✍️ человек · ⚠️ не нашли. */
export const ORIGIN_META: Record<FieldOrigin, OriginMeta> = {
  text: { label: 'из текста', glyph: '¶', tone: 'accent', hint: 'Значение найдено в тексте обращения' },
  asked: { label: 'спросили', glyph: '?', tone: 'info', hint: 'Значение получено ответом на вопрос' },
  cmdb: { label: 'из базы', glyph: '◈', tone: 'accent', hint: 'Значение найдено в CMDB' },
  rule: { label: 'по правилу', glyph: '§', tone: 'accent', hint: 'Значение вычислено правилом' },
  profile: { label: 'из профиля', glyph: '◍', tone: 'accent', hint: 'Значение взято из профиля заявителя' },
  human: { label: 'исправил человек', glyph: '✎', tone: 'ok', hint: 'Значение исправлено диспетчером' },
  none: { label: 'не нашли', glyph: '!', tone: 'warn', hint: 'Значение не найдено — нужен диспетчер' },
};

export interface OriginBadgeProps {
  origin: FieldOrigin;
  className?: string;
}

export function OriginBadge({ origin, className }: OriginBadgeProps): JSX.Element {
  const meta = ORIGIN_META[origin];
  return (
    <span className={cx('ugra-origin', `ugra-origin--${origin}`, className)} title={meta.hint}>
      <span className="ugra-origin__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}
