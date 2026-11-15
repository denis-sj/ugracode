// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from '../../../packages/ui/src/components/Select';
import { ReviewFields } from '../../../modules/dispatcher-review/web/ReviewFields';
import type { MetaResponse, TicketField } from '@ugra/contracts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const hosts: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  hosts.splice(0).forEach((host) => host.remove());
});
async function mount(element: ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(element));
  return host;
}

describe('списки', () => {
  it('выбирает значение, закрывается и показывает новую подпись', async () => {
    function Example() {
      const [value, setValue] = useState('one');
      return createElement(Select, { label: 'Влияние', value, onChange: setValue, options: [
        { value: 'one', label: 'Один сотрудник' }, { value: 'group', label: 'Группа сотрудников' },
      ] });
    }
    const host = await mount(createElement(Example));
    const trigger = host.querySelector('button')!;
    expect(trigger.textContent).toContain('Один сотрудник');
    await act(async () => trigger.click());
    const option = [...host.querySelectorAll('[role=menuitemradio]')].find((item) => item.textContent === 'Группа сотрудников') as HTMLButtonElement;
    await act(async () => option.click());
    expect(trigger.textContent).toContain('Группа сотрудников');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('редактирует поле по коду справочника и сохраняет выбранный код', async () => {
    const fields = [{ ticketId: 't', fieldKey: 'impact', value: 'one', confidence: 0.6, quote: null, origin: 'text', needsReview: true, trace: [], aiValue: null }] as TicketField[];
    const meta = { fields: [{ key: 'impact', label: 'Влияние', group: 'classification', type: 'dictionary', dictionary: 'impact', required: true, extractHint: '', evalMode: 'none' }], dictionaries: [
      { dictionary: 'impact', code: 'one', label: 'Один сотрудник' }, { dictionary: 'impact', code: 'group', label: 'Группа сотрудников' },
    ] } as MetaResponse;
    const save = vi.fn(async () => true);
    const host = await mount(createElement(ReviewFields, { fields, meta, canEdit: true, onSave: save }));
    const edit = [...host.querySelectorAll('button')].find((button) => button.textContent === 'изменить')!;
    await act(async () => edit.click());
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Новое значение поля Влияние"]')!;
    expect(trigger.textContent).toContain('Один сотрудник');
    await act(async () => trigger.click());
    const option = [...host.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find((item) => item.textContent === 'Группа сотрудников')!;
    await act(async () => option.click());
    expect(trigger.textContent).toContain('Группа сотрудников');
    const submit = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Сохранить')!;
    await act(async () => submit.click());
    expect(save).toHaveBeenCalledWith('impact', 'group');
  });
});
