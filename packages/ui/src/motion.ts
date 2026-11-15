/**
 * Анимация блоков контента на GSAP: каскадное появление, догрузка новых блоков,
 * наполнение шкал и раскрытие секций. Всё отключается при `prefers-reduced-motion`.
 * Цвета и размеры не трогаем — только opacity/transform, чтобы не ломать стеклянные карточки.
 */
import autoAnimate from '@formkit/auto-animate';
import confetti from 'canvas-confetti';
import { gsap } from 'gsap';
import { animate } from 'motion';
import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Секции страницы — запасной путь: прямые дети корня страницы (или экрана входа).
 * Если секция-обёртка содержит готовые блоки (карточки, `data-reveal`), она сама
 * не анимируется — блоки внутри появляются по отдельности.
 */
const SECTION_SELECTOR = ['.shell-main > * > *', '.app__content > main.login-page > *'].join(',');

/**
 * Блоки, которые появляются каскадом.
 * 1) Явная метка `data-reveal` — главный способ для новых экранов.
 * 2) Компоненты дизайн-системы (карточки, плитки, стикеры, шаги).
 * 3) Запасной путь: секции страницы (`SECTION_SELECTOR`) — так анимируется каждая
 *    страница без правок в модуле. Отключить у узла и всего внутри: `data-motion="off"`.
 *
 * Строки списков (`.tickets-row`, `.er-row`, `.ed-task-row`, `.history-item`) здесь
 * намеренно отсутствуют: ими управляет `useListMotion`, иначе появление строки
 * анимировалось бы дважды.
 */
export const BLOCK_SELECTOR = [
  '[data-reveal]',
  '.ugra-card',
  '.ugra-stat',
  '.ugra-sticker',
  '.ugra-step',
  '.ugra-insight',
  '.ugra-empty',
  '.chat-ai',
  '.chat-me',
  '.chat-ask',
  '.shell-head',
  '.shell-main > * > *',
  '.app__content > main.login-page > *',
].join(',');

const SKIP_SELECTOR = [
  '[data-motion="off"]',
  '[data-motion="off"] *',
  '[aria-hidden="true"]',
  '.ugra-rise',
  '.ugra-row-flash',
  '.ugra-modal',
  '.ugra-toast',
  '[role="dialog"]',
  'tr',
  'thead',
  'tbody',
  'script',
  'style',
].join(',');

/** Сколько длится анимация родителя: в это время вложенные блоки едут вместе с ним. */
const PARENT_BUSY_MS = 700;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isFixed(node: HTMLElement): boolean {
  return typeof getComputedStyle === 'function' && getComputedStyle(node).position === 'fixed';
}

function isAnimatable(node: Element): boolean {
  return node instanceof HTMLElement && node.dataset.revealed !== '1' && !node.matches(SKIP_SELECTOR);
}

/** Внутри секции есть блок, который должен появиться отдельно. */
function hasInnerBlock(node: Element): boolean {
  return node.querySelector(BLOCK_SELECTOR) !== null;
}

/**
 * Секция-обёртка (`section` с сеткой или списком) пропускает анимацию, если внутри
 * уже есть блоки: тогда карточки и шаги появляются по отдельности, а не въезжают
 * одной плитой. Явная метка `data-reveal` сильнее — она всегда анимирует узел целиком.
 */
function isTransparentSection(node: Element): boolean {
  if (node.getAttribute('data-reveal') !== null) return false;
  return node.matches(SECTION_SELECTOR) && hasInnerBlock(node);
}

/** Ближайший блок-предок внутри корня (или null); прозрачные секции пропускаем. */
function outerBlockOf(root: ParentNode, node: Element): Element | null {
  let current = node.parentElement;
  while (current) {
    if (
      current !== root &&
      root.contains(current) &&
      current.matches(BLOCK_SELECTOR) &&
      !isTransparentSection(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Отбирает блоки для анимации.
 * Вложенный блок пропускаем, если его родитель едет в этой же пачке или только что появился:
 * он появится вместе с родителем. Если родитель давно на экране (данные догрузились позже),
 * вложенный блок анимируется сам.
 */
export function pickOuterBlocks(root: ParentNode, nodes: Iterable<Element>, now = Date.now()): HTMLElement[] {
  const candidates = new Set<Element>();
  for (const node of nodes) {
    if (!isAnimatable(node) || isTransparentSection(node)) continue;
    candidates.add(node);
  }
  const result: HTMLElement[] = [];
  for (const node of candidates) {
    const parent = outerBlockOf(root, node);
    if (parent && candidates.has(parent)) continue;
    if (parent instanceof HTMLElement && parent.dataset.revealed !== '1') continue;
    if (parent instanceof HTMLElement && now - Number(parent.dataset.revealedAt ?? 0) < PARENT_BUSY_MS) continue;
    if (isFixed(node as HTMLElement)) continue;
    result.push(node as HTMLElement);
  }
  return result;
}

export interface RevealOptions {
  /** Пауза между соседними блоками, с. */
  stagger?: number;
  /** Смещение снизу, px. */
  distance?: number;
  duration?: number;
  delay?: number;
}

/** Каскадное появление списка блоков. Возвращает твин, чтобы его можно было прервать. */
export function revealBlocks(blocks: HTMLElement[], options: RevealOptions = {}): gsap.core.Tween | null {
  if (blocks.length === 0) return null;
  const stamp = String(Date.now());
  for (const block of blocks) {
    block.dataset.revealed = '1';
    block.dataset.revealedAt = stamp;
  }
  if (prefersReducedMotion()) return null;
  // страховка: если вкладка в фоне и кадры не идут, блоки всё равно не останутся скрытыми
  const total = (options.duration ?? 0.55) + (options.delay ?? 0) + (options.stagger ?? 0.06) * blocks.length;
  window.setTimeout(() => {
    for (const block of blocks) {
      if (block.isConnected && getComputedStyle(block).opacity === '0') {
        block.style.removeProperty('opacity');
        block.style.removeProperty('transform');
      }
    }
  }, (total + 0.6) * 1000);
  return gsap.fromTo(
    blocks,
    { opacity: 0, y: options.distance ?? 18, scale: 0.985 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: options.duration ?? 0.55,
      delay: options.delay ?? 0,
      ease: 'power3.out',
      stagger: { each: options.stagger ?? 0.06, from: 'start' },
      clearProps: 'opacity,transform',
      overwrite: 'auto',
    },
  );
}

/**
 * Хук для контейнера страницы: при монтировании блоки появляются каскадом,
 * а блоки, добавленные позже (сообщение чата, новая строка очереди), въезжают по одному.
 */
export function useBlockMotion(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root || prefersReducedMotion()) return undefined;

    const tweens: gsap.core.Tween[] = [];
    const track = (tween: gsap.core.Tween | null): void => {
      if (tween) tweens.push(tween);
    };

    // страница ещё может грузить данные: первая пачка — после кадра отрисовки
    const frame = window.requestAnimationFrame(() => {
      track(revealBlocks(pickOuterBlocks(root, root.querySelectorAll(BLOCK_SELECTOR))));
    });

    const observer = new MutationObserver((mutations) => {
      const added: Element[] = [];
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(BLOCK_SELECTOR)) added.push(node);
          node.querySelectorAll(BLOCK_SELECTOR).forEach((inner) => added.push(inner));
        });
      }
      track(revealBlocks(pickOuterBlocks(root, added), { stagger: 0.05, distance: 14, duration: 0.45 }));
    });
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      for (const tween of tweens) tween.kill();
    };
  }, [ref, enabled]);
}

/** Плавное наполнение шкалы: масштаб по X слева, ширину не трогаем (на ней висит CSS-переход). */
export function fillBar(element: HTMLElement | null | undefined, delay = 0): void {
  if (!element || prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { scaleX: 0, transformOrigin: 'left center' },
    { scaleX: 1, duration: 0.9, delay, ease: 'power3.out', clearProps: 'transform', overwrite: 'auto' },
  );
}

/** Сегменты шкалы этапов зажигаются по очереди. */
export function popSegments(segments: HTMLElement[]): void {
  if (segments.length === 0 || prefersReducedMotion()) return;
  gsap.fromTo(
    segments,
    { scaleY: 0.2, opacity: 0.4, transformOrigin: 'left center' },
    { scaleY: 1, opacity: 1, duration: 0.45, ease: 'back.out(2)', stagger: 0.12, clearProps: 'transform,opacity' },
  );
}

/** Раскрытие тела секции: высота и прозрачность. */
export function expandBody(element: HTMLElement | null | undefined): void {
  if (!element || prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { height: 0, opacity: 0 },
    { height: 'auto', opacity: 1, duration: 0.4, ease: 'power2.out', clearProps: 'height,opacity' },
  );
}

/**
 * Списки, где строки добавляются, исчезают и переставляются (очередь, уведомления):
 * FormKit AutoAnimate плавно сдвигает соседей. Сам уважает `prefers-reduced-motion`.
 */
export function useListMotion<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true): void {
  useEffect(() => {
    const parent = ref.current;
    if (!enabled || !parent) return undefined;
    const controller = autoAnimate(parent, { duration: 260, easing: 'ease-out' });
    return () => controller.disable();
  }, [ref, enabled]);
}

/** Пружинное появление окна поверх страницы (Motion): панель «вырастает» с лёгким отскоком. */
export function springIn(panel: HTMLElement | null | undefined, backdrop?: HTMLElement | null): void {
  if (!panel || prefersReducedMotion()) return;
  if (backdrop) animate(backdrop, { opacity: [0, 1] }, { duration: 0.25 });
  animate(
    panel,
    { opacity: [0, 1], transform: ['translateY(28px) scale(0.92)', 'translateY(0px) scale(1)'] },
    { type: 'spring', stiffness: 340, damping: 26 },
  );
}

/**
 * Стикер «прилипает» к стене: прилетает справа, слегка шлёпается и затухающе покачивается,
 * как бумажка на скотче. Только transform и opacity, композицию не сдвигает.
 * При `prefers-reduced-motion` элемент просто появляется в конечном положении.
 */
export function stickerSlap(target: HTMLElement | null | undefined, settle = 0.6): void {
  if (!target) return;
  const finish = (): void => {
    target.style.opacity = '';
    target.style.transform = '';
  };
  if (prefersReducedMotion()) {
    finish();
    return;
  }
  gsap.killTweensOf(target);
  const tween = gsap.fromTo(
    target,
    { opacity: 0, x: 56, scale: 0.94, rotate: settle + 6 },
    {
      opacity: 1,
      x: 0,
      scale: 1,
      rotate: settle,
      duration: 0.55,
      ease: 'back.out(1.5)',
      onComplete: () => {
        gsap.to(target, {
          rotate: settle - 1.2,
          duration: 0.14,
          yoyo: true,
          repeat: 1,
          ease: 'sine.inOut',
          onComplete: finish,
        });
      },
    },
  );
  // Страховка: если кадры стоят (фоновая вкладка), стикер не должен остаться невидимым.
  window.setTimeout(() => {
    tween.kill();
    finish();
  }, 900);
}

/** Конфетти из центра элемента: «заявка назначена». Цвета — из палитры интерфейса. */
export function celebrate(origin?: HTMLElement | null): void {
  if (prefersReducedMotion()) return;
  const rect = origin?.getBoundingClientRect();
  const x = rect ? (rect.left + rect.width / 2) / window.innerWidth : 0.5;
  const y = rect ? (rect.top + rect.height * 0.2) / window.innerHeight : 0.4;
  void confetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 32,
    ticks: 160,
    origin: { x, y },
    colors: ['#5A49E0', '#027DEA', '#0E8A5F', '#14172B', '#B6D9FC'],
    scalar: 0.9,
    disableForReducedMotion: true,
  });
}
