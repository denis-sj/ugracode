import { useEffect, useState } from 'react';

/** Тикающие «сейчас» для таймеров SLA: перерисовка раз в `intervalMs` (по умолчанию 30 с). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
