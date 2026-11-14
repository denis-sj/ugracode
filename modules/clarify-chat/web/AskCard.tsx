import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ChatQuestion } from './format';
import { questionCounter } from './format';

export interface AskCardProps {
  question: ChatQuestion;
  index: number;
  total: number;
  ownText: string;
  onOwnText: (value: string) => void;
  onAnswer: (value: string, label: string) => void;
  onUnknown: () => void;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Карточка-вопрос «как в Claude» (4.1): заголовок, «1 из N», варианты с номерами 1–3,
 * «Не знаю», строка «Свой вариант», «Пропустить» и «Ответить · Enter».
 * Первый вариант подсвечен сразу, стрелки двигают выбор, Enter отвечает выбранным —
 * так клавиша работает без клика мышью, как на макете.
 */
export function AskCard({
  question,
  index,
  total,
  ownText,
  onOwnText,
  onAnswer,
  onUnknown,
  onSkip,
  onPrev,
  onNext,
}: AskCardProps): JSX.Element {
  const unknownNumber = question.options.length + 1;
  const ownNumber = question.options.length + 2;
  // По умолчанию подсвечен первый вариант из данных; если вариантов нет — ничего не выбрано,
  // чтобы Enter не отправил «Не знаю» вместо ответа.
  const [selected, setSelected] = useState<number | null>(question.options.length > 0 ? 0 : null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const submitOwn = (): void => {
    const value = ownText.trim();
    if (value !== '') onAnswer(value, value);
  };

  const answer = (row: number | null): void => {
    if (row === null) return;
    if (row >= 0 && row < question.options.length) {
      const option = question.options[row];
      if (option) onAnswer(option.value, option.label);
      return;
    }
    if (row === question.options.length) {
      onUnknown();
      return;
    }
    submitOwn();
  };

  const move = (delta: number): void => {
    const rows = question.options.length + 2;
    setSelected((previous) => ((previous ?? -delta) + delta + rows) % rows);
  };

  return (
    <section
      className="chat-ask"
      aria-label={`Вопрос: ${question.question}`}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          answer(selected);
        }
      }}
    >
      <header className="chat-ask__head">
        <b className="chat-ask__title">{question.question}</b>
        <span className="chat-ask__counter">
          {total > 1 && (
            <button
              type="button"
              className="chat-ask__arrow"
              aria-label="Предыдущий вопрос"
              onClick={onPrev}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <span className="chat-ask__position">{questionCounter(index, total)}</span>
          {total > 1 && (
            <button
              type="button"
              className="chat-ask__arrow"
              aria-label="Следующий вопрос"
              onClick={onNext}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 6l6 6-6 6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      </header>

      {question.options.map((option, optionIndex) => (
        <button
          key={option.value}
          type="button"
          className={optionIndex === selected ? 'chat-ask__option chat-ask__option--sel' : 'chat-ask__option'}
          aria-pressed={optionIndex === selected}
          onClick={() => {
            setSelected(optionIndex);
            onAnswer(option.value, option.label);
          }}
          onMouseEnter={() => setSelected(optionIndex)}
        >
          <span className="chat-ask__num">{optionIndex + 1}</span>
          <span className="chat-ask__option-text">
            {option.label}
            {option.hint && <span className="chat-ask__hint">{option.hint}</span>}
          </span>
        </button>
      ))}

      <button
        type="button"
        className={
          question.options.length === selected ? 'chat-ask__option chat-ask__option--sel' : 'chat-ask__option'
        }
        onClick={onUnknown}
        onMouseEnter={() => setSelected(question.options.length)}
      >
        <span className="chat-ask__num">{unknownNumber}</span>
        <span className="chat-ask__option-text">
          Не знаю
          <span className="chat-ask__hint">Диспетчер уточнит сам</span>
        </span>
      </button>

      <div
        className={
          question.options.length + 1 === selected ? 'chat-ask__own chat-ask__own--sel' : 'chat-ask__own'
        }
      >
        <span className="chat-ask__num">{ownNumber}</span>
        <label className="chat-visually-hidden" htmlFor={`own-${question.key}`}>
          Свой вариант
        </label>
        <input
          id={`own-${question.key}`}
          className="chat-ask__input"
          value={ownText}
          onFocus={() => setSelected(question.options.length + 1)}
          onChange={(event) => onOwnText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitOwn();
            }
          }}
          placeholder={question.placeholder}
          autoComplete="off"
        />
      </div>

      <footer className="chat-ask__footer">
        <button type="button" className="chat-ask__skip" onClick={onSkip}>
          Пропустить
        </button>
        <button
          type="button"
          className="chat-ask__send"
          onClick={() => answer(selected)}
          disabled={
            selected === null || (selected === question.options.length + 1 && ownText.trim() === '')
          }
        >
          Ответить <kbd className="chat-ask__kbd">Enter</kbd>
        </button>
      </footer>
    </section>
  );
}
