import './review.css';
import type { MetaResponse, TicketField } from '@ugra/contracts';
import type { JSX } from 'react';
import { useState } from 'react';
import { Button, FieldRow, Select } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { fieldDisplayValue, fieldOptions, groupTicketFields, visibleReviewGroups } from './format';

export interface ReviewFieldsProps {
  fields: readonly TicketField[];
  meta: MetaResponse;
  canEdit: boolean;
  onSave: (key: string, value: string | null) => Promise<boolean>;
  trackAction?: WebPageProps['trackAction'];
}

/** Шаг «Поля заявки»: сомнительные сверху, правка в одно действие, происхождение и цитата. */
export function ReviewFields({ fields, meta, canEdit, onSave, trackAction }: ReviewFieldsProps): JSX.Element {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const groups = visibleReviewGroups(groupTicketFields(fields, meta.fields));

  const startEdit = (key: string, value: string | null): void => {
    setEditingKey(key);
    setDraft(value ?? '');
    trackAction?.('click');
  };

  const save = async (key: string): Promise<void> => {
    setSaving(key);
    const ok = await onSave(key, draft.trim() === '' ? null : draft.trim());
    setSaving(null);
    if (ok) setEditingKey(null);
  };

  if (groups.length === 0) return <p className="ugra-muted">В реестре полей пока пусто.</p>;

  return (
    <div className="review-groups">
      {groups.map((group) => (
        <section className="review-group" key={group.group}>
          <h3 className="review-group__title">{group.label}</h3>
          {group.fields.map((entry) => {
            const field = entry.field;
            const value = fieldDisplayValue(meta, entry.key, entry.value);
            const review = Boolean(field?.needsReview);
            const editing = editingKey === entry.key && field !== null;
            const options = fieldOptions(meta, entry.key);
            const corrected =
              field?.origin === 'human' && field.aiValue !== null && String(field.aiValue) !== String(field.value ?? '');
            return (
              <div
                key={entry.key}
                className={`review-field${review ? ' review-field--review' : ''}${editing ? ' review-field--editing' : ''}`}
                tabIndex={review && field ? 0 : -1}
                data-field-key={entry.key}
                aria-label={review ? `Спорное поле ${entry.label}` : undefined}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !review || !field || editing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  startEdit(entry.key, entry.value);
                }}
              >
                <FieldRow
                  fieldKey={entry.key}
                  label={entry.label}
                  value={value}
                  confidence={field?.confidence}
                  quote={field?.quote?.text ?? null}
                  quoteSource="обращение"
                  origin={field?.origin}
                  needsReview={review}
                  emptyText="поле не заполнено — уйдёт в вопросы"
                  aside={
                    canEdit && field ? (
                      <button
                        type="button"
                        className="review-inline-link"
                        tabIndex={-1}
                        onClick={() => (editing ? setEditingKey(null) : startEdit(entry.key, entry.value))}
                      >
                        {editing ? 'отмена' : 'изменить'}
                      </button>
                    ) : null
                  }
                >
                  {editing && field && (
                    <div className="review-editor">
                      {options.length > 0 ? (
                        <Select
                          className="review-editor__control"
                          value={draft}
                          autoFocus
                          label={`Новое значение поля ${entry.label}`}
                          options={[{ value: '', label: '— не выбрано —' }, ...options.map((option) => ({ value: option.code, label: option.label }))]}
                          onChange={(value) => {
                            setDraft(value);
                            trackAction?.('select');
                          }}
                        />
                      ) : (
                        <input
                          className="review-editor__control"
                          value={draft}
                          autoFocus
                          aria-label={`Новое значение поля ${entry.label}`}
                          onChange={(event) => {
                            setDraft(event.target.value);
                            trackAction?.('input');
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.stopPropagation();
                              setEditingKey(null);
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              event.stopPropagation();
                              void save(entry.key);
                            }
                          }}
                        />
                      )}
                      <Button
                        variant="primary"
                        size="sm"
                        loading={saving === entry.key}
                        onClick={() => void save(entry.key)}
                      >
                        Сохранить
                      </Button>
                    </div>
                  )}
                </FieldRow>
                {corrected && (
                  <p className="review-field__history">
                    исправил диспетчер · ИИ предлагал «{String(field.aiValue)}»
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
