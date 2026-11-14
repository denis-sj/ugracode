/**
 * Готовые анимации дизайн-системы без Framer Motion: Web Animations API и CSS-классы.
 * Длительности и кривые берутся из токенов `tokens.css`, «сырых» значений здесь нет.
 */

export type DurationToken = 'fast' | 'base' | 'slow';

const FALLBACK_DURATION: Record<DurationToken, number> = { fast: 140, base: 240, slow: 520 };

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Длительность из CSS-переменной `--dur-*` (мс). */
export function tokenDuration(name: DurationToken): number {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK_DURATION[name];
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--dur-${name}`).trim();
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return FALLBACK_DURATION[name];
  return raw.endsWith('ms') ? parsed : parsed * 1000;
}

/** Кривая `--ease-out` из токенов; на случай отсутствия — стандартная. */
function easingToken(): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim();
  return raw || 'cubic-bezier(0.22, 0.61, 0.36, 1)';
}

function flashTarget(target: Element): void {
  target.classList.remove('ugra-field--new');
  // перезапуск CSS-анимации на одном и том же узле
  void (target as HTMLElement).offsetWidth;
  target.classList.add('ugra-field--new');
  window.setTimeout(() => target.classList.remove('ugra-field--new'), tokenDuration('slow') + 80);
}

export interface FlyToFieldOptions {
  /** Текст «призрака»; по умолчанию — текст источника. */
  text?: string;
  duration?: number;
}

/**
 * «Перелёт» фрагмента текста из чата в поле заявки: клон текста летит по экрану
 * и растворяется над целевым полем, поле подсвечивается.
 */
export function flyToField(
  source: Element | null | undefined,
  target: Element | null | undefined,
  options: FlyToFieldOptions = {},
): Promise<void> {
  if (typeof document === 'undefined' || !source || !target) return Promise.resolve();
  if (prefersReducedMotion()) {
    flashTarget(target);
    return Promise.resolve();
  }

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'ugra-ghost';
  ghost.textContent = (options.text ?? source.textContent ?? '').trim().slice(0, 48) || 'поле';
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  document.body.appendChild(ghost);

  const deltaX = to.left + to.width / 2 - (from.left + from.width / 2);
  const deltaY = to.top + to.height / 2 - (from.top + from.height / 2);
  const duration = options.duration ?? tokenDuration('slow');

  const cleanup = (): void => {
    ghost.remove();
    flashTarget(target);
  };

  let animation: Animation;
  try {
    animation = ghost.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.82)`,
          opacity: 0.92,
          offset: 0.7,
        },
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.45)`, opacity: 0 },
      ],
      { duration, easing: easingToken(), fill: 'forwards' },
    );
  } catch {
    cleanup();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
    window.setTimeout(finish, duration + 80);
  });
}

/** Пульс элемента: короткое свечение акцентом (например, «заявка принята»). */
export function pulse(element: Element | null | undefined, options: { duration?: number; className?: string } = {}): void {
  if (typeof window === 'undefined' || !element) return;
  const className = options.className ?? 'ugra-pulse';
  element.classList.remove(className);
  void (element as HTMLElement).offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), options.duration ?? tokenDuration('slow') + 60);
}

export interface CountUpOptions {
  from?: number;
  duration?: number;
  format?: (value: number) => string;
}

/**
 * Анимированный счётчик: плавно меняет текст элемента от `from` до `to`.
 * Возвращает функцию отмены.
 */
export function countUp(element: HTMLElement | null | undefined, to: number, options: CountUpOptions = {}): () => void {
  const format = options.format ?? ((value: number): string => String(Math.round(value)));
  if (typeof window === 'undefined' || !element || !Number.isFinite(to)) {
    if (element) element.textContent = format(Number.isFinite(to) ? to : 0);
    return () => undefined;
  }
  if (prefersReducedMotion()) {
    element.textContent = format(to);
    return () => undefined;
  }

  const from = Number.isFinite(options.from) ? (options.from as number) : 0;
  const duration = options.duration ?? tokenDuration('slow');
  const startedAt = performance.now();
  let frame = 0;
  let cancelled = false;

  const tick = (now: number): void => {
    if (cancelled) return;
    const progress = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format(from + (to - from) * eased);
    if (progress < 1) frame = window.requestAnimationFrame(tick);
    else element.textContent = format(to);
  };

  frame = window.requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}
