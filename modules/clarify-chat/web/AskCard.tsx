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
 * Карточка-вопрос «как в Claude» (4.1): заголовок, «1 из N» со стрелками,
 * варианты с номерами 1–3, «Не знаю», строка «Свой вариант», «Пропустить» и «Ответить Enter».
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

  const submitOwn = (): void => {
    const value = ownText.trim();
    if (value !== '') onAnswer(value, value);
  };

  return (
    <section className="chat-ask ugra-rise" aria-label={`Вопрос: ${question.question}`}>
      <header className="chat-ask__head">
        <b className="chat-ask__title">{question.question}</b>
        <span className="chat-ask__counter">
          <button
            type="button"
            className="chat-ask__arrow"
            aria-label="Предыдущий вопрос"
            onClick={onPrev}
            disabled={total < 2}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" />
            </svg>
          </button>
          <span className="chat-ask__position">{questionCounter(index, total)}</span>
          <button
            type="button"
            className="chat-ask__arrow"
            aria-label="Следующий вопрос"
            onClick={onNext}
            disabled={total < 2}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </header>

      {question.options.map((option, optionIndex) => (
        <button
          key={option.value}
          type="button"
          className="chat-ask__option"
          onClick={() => onAnswer(option.value, option.label)}
        >
          <span className="chat-ask__num">{optionIndex + 1}</span>
          <span className="chat-ask__option-text">
            {option.label}
            {option.hint && <span className="chat-ask__hint">{option.hint}</span>}
          </span>
        </button>
      ))}

      <button type="button" className="chat-ask__option" onClick={onUnknown}>
        <span className="chat-ask__num">{unknownNumber}</span>
        <span className="chat-ask__option-text">
          Не знаю
          <span className="chat-ask__hint">Диспетчер уточнит сам</span>
        </span>
      </button>

      <div className="chat-ask__own">
        <span className="chat-ask__num">{ownNumber}</span>
        <label className="chat-visually-hidden" htmlFor={`own-${question.key}`}>
          Свой вариант
        </label>
        <input
          id={`own-${question.key}`}
          className="chat-ask__input"
          value={ownText}
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
        <button type="button" className="chat-ask__send" onClick={submitOwn} disabled={ownText.trim() === ''}>
          Ответить <kbd className="chat-ask__kbd">Enter</kbd>
        </button>
      </footer>
    </section>
  );
}
