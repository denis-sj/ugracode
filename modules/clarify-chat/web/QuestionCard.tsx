import type { JSX } from 'react';
import { useState } from 'react';
import { Button } from '@ugra/ui';
import type { MissingQuestionView } from './analysis';

export interface QuestionCardProps {
  question: MissingQuestionView;
  index: number;
  total: number;
  onAnswer: (answer: string | null) => void;
}

/**
 * Карточка-вопрос заявителю: варианты, «свой ответ» и «Не знаю».
 * Логика ответа (сообщение на сервер) появится в задаче 009 — здесь компонент только собирает ответ.
 */
export function QuestionCard({ question, index, total, onAnswer }: QuestionCardProps): JSX.Element {
  const [selected, setSelected] = useState<string>('');
  const [custom, setCustom] = useState<string>('');

  const value = custom.trim() || selected;
  const isSingleChoice = question.widget === 'buttons' || question.widget === 'select';
  const options = question.options ?? [];

  return (
    <div className="question-card" role="group" aria-label={question.question}>
      <span className="question-card__progress">
        Вопрос {index + 1} из {total} · {question.label}
      </span>
      <p className="question-card__title">{question.question}</p>

      {options.length > 0 && question.widget === 'select' && (
        <select
          className="question-card__field"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          aria-label={question.question}
        >
          <option value="">Выберите вариант…</option>
          {options.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {options.length > 0 && question.widget !== 'select' && (
        <div className="question-card__options">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`question-option${selected === option.value ? ' question-option--selected' : ''}`}
              onClick={() => {
                setSelected(option.value);
                setCustom('');
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {(!isSingleChoice || question.allowFreeText) && (
        <input
          className="question-card__field"
          value={custom}
          placeholder={question.widget === 'location' ? 'Например: корпус А, кабинет 312' : 'Свой ответ'}
          onChange={(event) => {
            setCustom(event.target.value);
            if (event.target.value.trim()) setSelected('');
          }}
          aria-label="Свой ответ"
        />
      )}

      <div className="question-card__actions">
        <Button variant="primary" size="sm" onClick={() => onAnswer(value)} disabled={!value}>
          Ответить
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAnswer(null)}>
          Не знаю
        </Button>
      </div>
    </div>
  );
}
