/**
 * Дизайн-система «Диспетчерской с ИИ».
 * Компоненты без внешних зависимостей, кроме React. Стили — `tokens.css` + `styles.css`.
 */

export * from './types';
export * from './format';
export * from './animations';
export * from './useActionCounter';
export { cx } from './cx';
export { Card } from './components/Card';
export type { CardProps, CardTone } from './components/Card';
export { Badge } from './components/Badge';
export type { BadgeProps } from './components/Badge';
export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button';
export { ConfidenceBar } from './components/ConfidenceBar';
export type { ConfidenceBarProps } from './components/ConfidenceBar';
export { QuoteChip } from './components/QuoteChip';
export type { QuoteChipProps } from './components/QuoteChip';
export { FieldRow } from './components/FieldRow';
export type { FieldRowProps } from './components/FieldRow';
export { StatTile } from './components/StatTile';
export type { StatTone, StatTileProps } from './components/StatTile';
export { Timeline } from './components/Timeline';
export type { TimelineItem, TimelineProps } from './components/Timeline';
export { OriginBadge, ORIGIN_META } from './components/OriginBadge';
export type { OriginBadgeProps } from './components/OriginBadge';
export { MicButton } from './components/MicButton';
export type { MicButtonProps } from './components/MicButton';
export { Slot } from './components/Slot';
export type { SlotProps } from './components/Slot';
