import { useCallback, useEffect, useState } from 'react';

export type ActionKind = 'click' | 'input' | 'select' | 'navigate' | 'system';

export type ActionCounts = Record<ActionKind, number>;

export interface ActionCounter {
  /** Всего действий — цифра для К4. */
  count: number;
  byKind: ActionCounts;
  track: (kind?: ActionKind) => void;
  reset: () => void;
}

const EMPTY: ActionCounts = { click: 0, input: 0, select: 0, navigate: 0, system: 0 };

export interface UseActionCounterOptions {
  /** Выключить автоподсчёт (например, до входа). */
  enabled?: boolean;
}

/**
 * Счётчик действий пользователя для замера К4: клики, ввод, выбор в списке, переходы.
 * Клики/ввод/выбор ловятся на документе; переходы и системные действия — через `track`.
 */
export function useActionCounter(options: UseActionCounterOptions = {}): ActionCounter {
  const { enabled = true } = options;
  const [byKind, setByKind] = useState<ActionCounts>(EMPTY);

  const track = useCallback((kind: ActionKind = 'click'): void => {
    setByKind((previous) => ({ ...previous, [kind]: previous[kind] + 1 }));
  }, []);

  const reset = useCallback((): void => setByKind(EMPTY), []);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const onClick = (): void => track('click');
    const onInput = (): void => track('input');
    const onSelect = (): void => track('select');
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onSelect);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('input', onInput);
      document.removeEventListener('change', onSelect);
    };
  }, [enabled, track]);

  const count = Object.values(byKind).reduce((total, value) => total + value, 0);
  return { count, byKind, track, reset };
}
