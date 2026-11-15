import { useEffect } from 'react';

/** Обновления между кабинетами: опрос и возврат на вкладку, без параллельных запросов. */
export function useBackgroundRefresh(refresh: () => Promise<void>, intervalMs = 5000): void {
  useEffect(() => {
    let running = false;
    let disposed = false;
    const run = (): void => {
      if (disposed || running || document.visibilityState === 'hidden') return;
      running = true;
      // Экран сам показывает ошибку; следующий опрос должен работать и после сбоя сети.
      void refresh().catch(() => undefined).finally(() => { running = false; });
    };
    const timer = window.setInterval(run, intervalMs);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [refresh, intervalMs]);
}
