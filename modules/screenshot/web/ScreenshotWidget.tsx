import { useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ScreenshotResponse } from '@ugra/contracts';
import { Button } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { imageFileProblem, readImageFile } from './image';
import './screenshot.css';

export interface ScreenshotWidgetProps {
  /** Клиент API из оболочки; без него распознавание недоступно. */
  api?: ApiClient;
  /** Куда положить распознанный текст (поле сообщения в чате). */
  onText?: (text: string) => void;
  /** Сообщение об ошибке наверх — в общую строку ошибок экрана. */
  onError?: (message: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Виджет слота `applicant.chat.footer`: кнопка «Скриншот» с фото шильдика или
 * скриншота ошибки → `POST /api/screenshot` → текст, который можно добавить в обращение.
 * Текст в поле чата кладёт `onText`; без него остаётся копирование.
 */
export function ScreenshotWidget({ api, onText, onError }: ScreenshotWidgetProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fail = (message: string): void => {
    setError(message);
    onError?.(message);
  };

  const recognize = async (file: File): Promise<void> => {
    const problem = imageFileProblem(file);
    if (problem !== null) {
      fail(problem);
      return;
    }
    if (!api) {
      fail('Распознавание картинок недоступно');
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const input = await readImageFile(file);
      const response = await api.post<ScreenshotResponse>('/api/screenshot', input);
      if (response.text.trim() === '') {
        fail('На картинке нечего распознать — попробуйте другой снимок');
        return;
      }
      setText(response.text.trim());
    } catch (caught) {
      fail(`Не удалось прочитать картинку: ${errorText(caught)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      fail('Не удалось скопировать — выделите текст и скопируйте вручную');
    }
  };

  return (
    <div className="shot">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="shot__file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void recognize(file);
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="shot__pick"
        loading={busy}
        onClick={() => fileRef.current?.click()}
        title="Приложить скриншот ошибки или фото шильдика"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <rect x="3" y="6" width="18" height="14" rx="2.5" />
          <circle cx="12" cy="13" r="3.4" />
          <path d="M8 6l1.2-2h5.6L16 6" strokeLinejoin="round" />
        </svg>
        Скриншот
      </Button>

      {text !== '' && (
        <div className="shot__panel" data-reveal>
          <p className="shot__title">Распознано с картинки</p>
          <p className="shot__text">{text}</p>
          <div className="shot__actions">
            {onText && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onText(text);
                  setText('');
                }}
              >
                Добавить в обращение
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              {copied ? 'Скопировано' : 'Скопировать текст'}
            </Button>
          </div>
          {!onText && (
            <p className="shot__hint">
              Текст некуда передать автоматически — скопируйте его и вставьте в поле сообщения.
            </p>
          )}
        </div>
      )}

      {error !== null && (
        <p className="shot__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
