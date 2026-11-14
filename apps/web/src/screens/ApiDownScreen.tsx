import type { JSX } from 'react';
import { Button, Card } from '@ugra/ui';

export interface ApiDownScreenProps {
  message: string;
  onRetry: () => void;
}

/** Экран «API не отвечает»: страница не падает, даёт проверить соединение снова. */
export function ApiDownScreen({ message, onRetry }: ApiDownScreenProps): JSX.Element {
  return (
    <div className="api-down">
      <div className="api-down__glow" aria-hidden="true" />
      <Card className="api-down__card ugra-rise" tone="danger" hero>
        <span className="api-down__icon" aria-hidden="true">
          ⚡
        </span>
        <h1>API не отвечает</h1>
        <p className="ugra-muted">
          Веб-приложение работает, но сервер не ответил на <code>/api/meta</code>. Проверьте, что API запущен на порту
          3001.
        </p>
        <p className="api-down__details">Детали: {message}</p>
        <div className="api-down__actions">
          <Button variant="primary" onClick={onRetry}>
            Проверить снова
          </Button>
          <span className="ugra-dim">pnpm dev:api</span>
        </div>
      </Card>
    </div>
  );
}

/** Заставка на время загрузки метаданных и сессии. */
export function SplashScreen(): JSX.Element {
  return (
    <div className="splash">
      <div className="splash__mark" aria-hidden="true">
        ✳
      </div>
      <p className="splash__title">Диспетчерская с ИИ</p>
      <p className="ugra-muted">Загружаем контур разбора…</p>
    </div>
  );
}
