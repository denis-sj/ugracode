// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_SELECTOR, pickOuterBlocks, prefersReducedMotion, revealBlocks } from '../src/motion';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'app__content';
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pickOuterBlocks', () => {
  it('берёт только внешний блок, вложенная карточка едет вместе с ним', () => {
    const root = mount('<section data-reveal id="outer"><div class="ugra-card" id="inner"></div></section>');
    const picked = pickOuterBlocks(root, root.querySelectorAll('[data-reveal], .ugra-card'));
    expect(picked.map((node) => node.id)).toEqual(['outer']);
  });

  it('анимирует вложенный блок, если родитель давно на экране (данные догрузились)', () => {
    const root = mount('<section data-reveal data-revealed="1" data-revealed-at="1000"><div class="ugra-card" id="late"></div></section>');
    const late = root.querySelector('#late') as HTMLElement;
    expect(pickOuterBlocks(root, [late], 5000).map((node) => node.id)).toEqual(['late']);
  });

  it('пропускает вложенный блок, пока родитель ещё едет', () => {
    const root = mount('<section data-reveal data-revealed="1" data-revealed-at="1000"><div class="ugra-card" id="late"></div></section>');
    const late = root.querySelector('#late') as HTMLElement;
    expect(pickOuterBlocks(root, [late], 1200)).toEqual([]);
  });

  it('пропускает уже показанные, отключённые и служебные узлы', () => {
    const root = mount(
      '<div class="ugra-card" data-revealed="1" id="seen"></div>' +
        '<div class="ugra-card" data-motion="off" id="off"></div>' +
        '<div data-motion="off"><div class="ugra-card" id="inside-off"></div></div>' +
        '<div class="ugra-card" aria-hidden="true" id="hidden"></div>' +
        '<div class="ugra-modal" data-reveal id="modal"></div>',
    );
    expect(pickOuterBlocks(root, root.querySelectorAll('*'))).toEqual([]);
  });

  it('не анимирует корень страницы целиком, а показывает его секции по отдельности', () => {
    const root = mount(
      '<main class="shell-main">' +
        '<div class="page" id="page">' +
        '<header class="page-head" id="head"></header>' +
        '<div class="layout" id="layout">' +
        '<section class="ugra-card" id="card"></section>' +
        '</div>' +
        '</div>' +
        '</main>',
    );
    const picked = pickOuterBlocks(root, root.querySelectorAll(BLOCK_SELECTOR));
    expect(picked.map((node) => node.id)).toEqual(['head', 'card']);
  });

  it('анимирует обёртку целиком, если на ней явная метка data-reveal', () => {
    const root = mount(
      '<main class="shell-main">' +
        '<div class="page" id="page">' +
        '<div class="layout" id="layout" data-reveal>' +
        '<section class="ugra-card" id="card"></section>' +
        '</div>' +
        '</div>' +
        '</main>',
    );
    const picked = pickOuterBlocks(root, root.querySelectorAll(BLOCK_SELECTOR));
    expect(picked.map((node) => node.id)).toEqual(['layout']);
  });

  it('строки списков не считает блоками: ими управляет useListMotion', () => {
    const root = mount(
      '<main class="shell-main">' +
        '<div class="page">' +
        '<section class="tickets-list" id="list">' +
        '<div class="tickets-row" id="row"></div>' +
        '<div class="er-row" id="er"></div>' +
        '<div class="ed-task-row" id="task"></div>' +
        '<div class="history-item" id="history"></div>' +
        '</section>' +
        '</div>' +
        '</main>',
    );
    const picked = pickOuterBlocks(root, root.querySelectorAll(BLOCK_SELECTOR));
    expect(picked.map((node) => node.id)).toEqual(['list']);
  });
});

describe('revealBlocks', () => {
  it('ничего не делает для пустого списка', () => {
    expect(revealBlocks([])).toBeNull();
  });

  it('при reduced motion только помечает блоки и не запускает анимацию', () => {
    setReducedMotion(true);
    const root = mount('<div data-reveal id="a"></div>');
    const block = root.querySelector('#a') as HTMLElement;
    expect(revealBlocks([block])).toBeNull();
    expect(block.dataset.revealed).toBe('1');
    expect(block.style.opacity).toBe('');
  });

  it('страховка снимает прозрачность, если кадры не идут', () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const root = mount('<div data-reveal id="a"></div>');
    const block = root.querySelector('#a') as HTMLElement;
    revealBlocks([block]);
    block.style.opacity = '0';
    vi.advanceTimersByTime(3000);
    expect(block.style.opacity).toBe('');
  });
});

describe('prefersReducedMotion', () => {
  it('читает медиазапрос', () => {
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});
