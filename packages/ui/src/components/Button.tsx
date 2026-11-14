import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { cx } from '../cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cx(
        'ugra-btn',
        `ugra-btn--${variant}`,
        size !== 'md' && `ugra-btn--${size}`,
        block && 'ugra-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ugra-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
