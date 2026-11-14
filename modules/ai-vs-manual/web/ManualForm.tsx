import type { FieldDef, MetaResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { Badge, Button } from '@ugra/ui';
import { dictionaryOptions } from './format';

export interface ManualFormProps {
  fields: readonly FieldDef[];
  values: Record<string, string>;
  /** Идёт замер именно в этой колонке. */
  active: boolean;
  /** Идёт замер в другой колонке — старт заблокирован. */
  busy: boolean;
  dictionaries: MetaResponse['dictionaries'];
  onChange: (key: string, value: string) => void;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

function isRequired(field: FieldDef): boolean {
  return field.required === true || typeof field.required === 'object';
}

function controlPlaceholder(field: FieldDef): string {
  if (field.type === 'cmdbRef') return 'найдите объект в CMDB вручную';
  if (field.type === 'ip') return 'например, 10.0.12.31';
  if (field.type === 'number') return 'число';
  return 'значение';
}

/**
 * Колонка «Вручную»: пустая форма из того же реестра полей, что и у ИИ,
 * но без подсказок, уверенности и цитат. Диспетчер ищет всё сам.
 */
export function ManualForm({
  fields,
  values,
  active,
  busy,
  dictionaries,
  onChange,
  onStart,
  onFinish,
  onCancel,
}: ManualFormProps): JSX.Element {
  const filled = fields.filter((field) => (values[field.key] ?? '').trim() !== '').length;
  const done = fields.length > 0 && filled === fields.length;

  return (
    <section
      className="ugra-card ugra-card--padded measure-col measure-col--manual"
      aria-labelledby="measure-manual-title"
    >
      <header className="measure-col__head">
        <span className="measure-eyebrow">Колонка 1</span>
        <div className="measure-col__title-row">
          <h2 id="measure-manual-title">Вручную</h2>
          <Badge tone="muted">без подсказок</Badge>
        </div>
        <p className="measure-lead">Пустая форма: все поля заполняем сами, уверенности и цитат нет.</p>
      </header>

      {fields.length === 0 ? (
        <p className="ugra-muted">В реестре полей пусто — заполнять нечего.</p>
      ) : !active ? (
        <div className="measure-start">
          <Button variant="primary" onClick={onStart} disabled={busy}>
            Начать замер вручную
          </Button>
        </div>
      ) : (
        <>
          <div className="measure-progress" aria-live="polite">
            Заполнено {filled} из {fields.length}
          </div>

          <div className="measure-fields">
            {fields.map((field) => {
              const id = `measure-manual-${field.key}`;
              const options = dictionaryOptions(field, dictionaries);
              const value = values[field.key] ?? '';
              return (
                <label className="measure-field" key={field.key} htmlFor={id}>
                  <span className="measure-field__label">
                    {field.label}
                    {isRequired(field) && <span className="measure-field__required">обязательное</span>}
                  </span>
                  {options.length > 0 ? (
                    <select
                      id={id}
                      className="measure-input"
                      value={value}
                      onChange={(event) => onChange(field.key, event.target.value)}
                    >
                      <option value="">— не выбрано —</option>
                      {options.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'text' ? (
                    <textarea
                      id={id}
                      className="measure-input measure-input--area"
                      rows={2}
                      value={value}
                      placeholder={controlPlaceholder(field)}
                      onChange={(event) => onChange(field.key, event.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      className="measure-input"
                      value={value}
                      placeholder={controlPlaceholder(field)}
                      inputMode={field.type === 'number' ? 'numeric' : undefined}
                      onChange={(event) => onChange(field.key, event.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>

          <div className="measure-col__actions">
            <Button variant="primary" onClick={onFinish} disabled={!done}>
              Готово
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Отменить
            </Button>
            <span className="measure-hint">
              {done ? 'Все поля заполнены — фиксируем цифры.' : 'Заполните все поля, чтобы замер был честным.'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
