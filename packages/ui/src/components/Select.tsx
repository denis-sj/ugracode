import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

export interface SelectProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}

/** Список на кнопках: выбор не зависит от нативного всплывающего окна браузера. */
export function Select({ label, value, options, onChange, className, autoFocus }: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  return (
    <div className="ugra-select" ref={root} onKeyDown={(event) => {
      if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        event.stopPropagation();
        const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
        const current = items.findIndex((item) => item === document.activeElement);
        const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length - 1 : current - 1);
        items[next]?.focus();
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" autoFocus={autoFocus} className={`ugra-select__trigger ${className ?? ''}`}
        aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((previous) => !previous)}>
        <span>{options.find((option) => option.value === value)?.label ?? value}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && <div className="ugra-select__menu" role="menu" aria-label={label}>
        {options.map((option) => <button key={option.value} type="button" role="menuitemradio"
          aria-checked={option.value === value} className="ugra-select__option"
          onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}>
          {option.label}
        </button>)}
      </div>}
    </div>
  );
}
