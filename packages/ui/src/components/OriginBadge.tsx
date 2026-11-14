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

/**
 * Подписи происхождения поля (3.5): «из текста» (фиолетовый), «сверено с базой оборудования» (зелёный),
 * «ответ заявителя» (синий), «ИИ не уверен — выберите» (жёлтый), «исправил диспетчер» (зелёный).
 */
export const ORIGIN_META: Record<FieldOrigin, OriginMeta> = {
  text: { label: 'из текста', glyph: '¶', tone: 'accent', hint: 'Значение найдено в тексте обращения' },
  asked: { label: 'ответ заявителя', glyph: '?', tone: 'info', hint: 'Значение получено ответом на вопрос' },
  cmdb: {
    label: 'сверено с базой оборудования',
    glyph: '◈',
    tone: 'ok',
    hint: 'Значение сверено с базой оборудования',
  },
  rule: { label: 'по правилу', glyph: '§', tone: 'accent', hint: 'Значение вычислено правилом' },
  profile: { label: 'из профиля', glyph: '◍', tone: 'accent', hint: 'Значение взято из профиля заявителя' },
  human: { label: 'исправил диспетчер', glyph: '✎', tone: 'ok', hint: 'Значение исправлено диспетчером' },
  none: {
    label: 'ИИ не уверен — выберите',
    glyph: '!',
    tone: 'warn',
    hint: 'Значение не найдено — выберите вариант',
  },
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
