import type { JSX } from 'react';
import { Button, Modal } from '@ugra/ui';
import { deadlineInputToIso, reasonReady } from './format';

interface DeadlineModalProps {
  open: boolean;
  value: string;
  reason: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** Продление срока по регламенту: новый срок и обязательная причина для заявителя. */
export function DeadlineModal({
  open,
  value,
  reason,
  busy,
  onValueChange,
  onReasonChange,
  onClose,
  onSubmit,
}: DeadlineModalProps): JSX.Element {
  return (
    <Modal
      open={open}
      title="Продлить срок"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!deadlineInputToIso(value) || !reasonReady(reason)}
            onClick={onSubmit}
          >
            Продлить срок
          </Button>
        </>
      }
    >
      <div className="ed-form">
        <label className="ed-field">
          <span className="ed-label">Новый срок решения</span>
          <input
            type="datetime-local"
            className="ed-input"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </label>
        <label className="ed-field">
          <span className="ed-label">Причина продления</span>
          <textarea
            className="ed-textarea"
            rows={3}
            value={reason}
            placeholder="Например: нужна запчасть, ожидаем поставку"
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
        <p className="ed-hint">Причина уйдёт заявителю в уведомлении. Без причины продлить нельзя.</p>
      </div>
    </Modal>
  );
}

interface ReturnModalProps {
  open: boolean;
  reason: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** Возврат диспетчеру: причина обязательна, диспетчер её увидит и переназначит заявку. */
export function ReturnModal({
  open,
  reason,
  busy,
  onReasonChange,
  onClose,
  onSubmit,
}: ReturnModalProps): JSX.Element {
  return (
    <Modal
      open={open}
      title="Вернуть диспетчеру"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} disabled={!reasonReady(reason)} onClick={onSubmit}>
            Вернуть диспетчеру
          </Button>
        </>
      }
    >
      <div className="ed-form">
        <label className="ed-field">
          <span className="ed-label">Причина возврата</span>
          <textarea
            className="ed-textarea"
            rows={3}
            value={reason}
            placeholder="Например: нужен доступ в серверную, у инженера нет прав"
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
        <p className="ed-hint">Диспетчер увидит причину и переназначит заявку.</p>
      </div>
    </Modal>
  );
}
