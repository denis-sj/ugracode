/* Презентация кейса 9: навигация под кликер, шаги, анимации GSAP.
   Спецификация: docs/specs/case9-presentation.md. */

/* =====================================================================
   DATA — ВСЕ цифры слайдов. Обновить цифру = поправить ТОЛЬКО здесь.
   value: число или null. null → на слайде «❓ замер».
   Значения — строго из отчётов. Демо-цифры страницы /measure?demo=1 сюда НЕ брать.
   ===================================================================== */
const DATA = {
  // Слайд 5 — reports/quality.md (последний прогон pnpm eval) и testset/cases
  testCases: { value: 10, source: 'testset/cases' },
  missedEmergencies: { value: 0, source: 'reports/quality.md' },
  emergencyCases: { value: 2, source: 'testset/cases (аварии: 04, 05)' },
  falseAlarms: { value: 1, source: 'reports/quality.md' },
  assigneeTop3: { value: 100, unit: '%', source: 'reports/quality.md' },
  fieldsByAi: { value: 84, unit: '%', source: 'reports/quality.md' },
  inventedFields: { value: 9, source: 'reports/quality.md' },
  model: { value: 'deepseek-v4.1-flash', source: 'reports/quality.md · deepseek/deepseek-v4.1-flash-1017' },

  // Слайд 6 — reports/measure.md, раздел 5 (случай 3, авария), секунды, медиана 3 прогонов
  // С ИИ авария распознана и дежурные уведомлены в один момент.
  emergencyNotified: { value: 16.1, digits: 1, source: 'reports/measure.md, раздел 5 (медиана 3)' },
  dutyNotified: { value: 3, source: 'reports/measure.md, раздел 5 (медиана 3)' },
  emergencyManual: { value: null, source: 'reports/measure.md, раздел 5' },

  // Слайд 7 «Действия» (ещё не на слайде) — reports/measure.md, раздел 4
  actionsManual: { value: null, source: 'reports/measure.md, раздел 4 (медиана 3)' },
  actionsAi: { value: null, source: 'reports/measure.md, раздел 4 (медиана 3)' },
  timeManual: { value: null, source: 'reports/measure.md, раздел 4 (медиана 3)' }, // секунды
  timeAi: { value: null, source: 'reports/measure.md, раздел 4 (медиана 3)' }, // секунды
  aiParseTypical: { value: 24.7, digits: 1, source: 'reports/measure.md, раздел 4а (медиана 3)' },
  aiParseMissing: { value: 6.6, digits: 1, source: 'reports/measure.md, раздел 4а' },
  aiParseEmergency: { value: 18.0, digits: 1, source: 'reports/measure.md, раздел 4а' },

  // Слайд 8 «Экономия» (ещё не на слайде) — reports/measure.md, раздел 6
  hours30: { value: null, source: 'reports/measure.md, раздел 6' },
  shifts30: { value: null, source: 'reports/measure.md, раздел 6' },
  hours50: { value: null, source: 'reports/measure.md, раздел 6' },
  shifts50: { value: null, source: 'reports/measure.md, раздел 6' },
  hours100: { value: null, source: 'reports/measure.md, раздел 6' },
  shifts100: { value: null, source: 'reports/measure.md, раздел 6' },

  // Слайд 9 «Надёжность» (ещё не на слайде) — reports/sonarqube-summary.md
  sonarBugs: { value: 0, source: 'reports/sonarqube-summary.md' },
  sonarVulns: { value: 0, source: 'reports/sonarqube-summary.md' },
  sonarIssues: { value: 0, source: 'reports/sonarqube-summary.md' },
  coverage: { value: 83, unit: '%', source: 'reports/sonarqube-summary.md' },
  // Число тестов — только из вывода свежего `pnpm check`. Пока null — на слайд не ставим.
  tests: { value: null, source: 'вывод pnpm check' },
};

/* Настройки показа (не цифры). */
const SHOW = {
  demoUrl: 'http://localhost:5173', // «›» на последнем слайде
  demoVideo: 'media/demo.mp4', // V на последнем слайде
  // Видео ручного режима (слайд «Действия»). Пока файла нет — null (иначе ошибка 404 в консоли).
  manualVideo: null,
  manualVideoRate: 4, // ускорение видео ручного режима
  cursorHideMs: 2000,
};

/* ===================================================================== */

(function main() {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const stage = document.getElementById('stage');
  const slides = Array.from(document.querySelectorAll('.slide'));
  const pager = document.querySelector('.pager');
  const progressFill = document.querySelector('.progress-fill');
  const params = new URLSearchParams(window.location.search);
  const PRINT = params.has('print');
  const hasGsap = typeof window.gsap !== 'undefined';
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceQuery.matches || !hasGsap;
  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', (e) => { reduced = e.matches || !hasGsap; });
  }

  const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const NBSP = ' ';

  /* ---------- цифры ---------- */

  function fmt(item, v, suffix) {
    let s = item.digits
      ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: item.digits, maximumFractionDigits: item.digits }).format(v)
      : nf.format(v);
    if (item.unit === '%') s += NBSP + '%';
    if (suffix) s += suffix.replace(' ', NBSP);
    return s;
  }

  function renderData() {
    document.querySelectorAll('[data-num]').forEach((el) => {
      const key = el.dataset.num;
      const item = DATA[key];
      if (!item) {
        console.warn('Нет цифры в DATA:', key);
        return;
      }
      if (item.value === null || item.value === undefined) {
        el.textContent = '❓ замер';
        el.classList.add('is-q');
        el.removeAttribute('data-target');
      } else {
        el.classList.remove('is-q');
        el.dataset.target = String(item.value);
        el.textContent = fmt(item, item.value, el.dataset.suffix);
      }
    });
    document.querySelectorAll('[data-src]').forEach((el) => {
      const srcs = [];
      el.dataset.src.split(',').map((k) => k.trim()).forEach((k) => {
        const it = DATA[k];
        if (it && !srcs.includes(it.source)) srcs.push(it.source);
      });
      el.textContent = srcs.join(' · ');
    });
    document.querySelectorAll('[data-if]').forEach((el) => {
      const it = DATA[el.dataset.if];
      if (!it || it.value === null) el.remove();
    });
    // блок ручного режима без видео не выводим вовсе (SHOW.manualVideo = null)
    document.querySelectorAll('[data-video]').forEach((el) => {
      if (!SHOW.manualVideo) el.remove();
    });
    document.querySelectorAll('[data-rate]').forEach((el) => {
      el.textContent = String(SHOW.manualVideoRate);
    });
    document.querySelectorAll('[data-demo-host]').forEach((el) => {
      el.textContent = SHOW.demoUrl.replace(/^https?:\/\//, '');
    });
  }

  const countTweens = new Map();

  // Цифра набегает от нуля (power3.out, ~1 с).
  function countUp(scope) {
    scope.querySelectorAll('[data-target]').forEach((el) => {
      const item = DATA[el.dataset.num];
      const target = Number(el.dataset.target);
      const prev = countTweens.get(el);
      if (prev) prev.kill();
      if (reduced || !Number.isFinite(target) || target === 0) {
        el.textContent = fmt(item, target, el.dataset.suffix);
        return;
      }
      const o = { v: 0 };
      const decimals = item.digits || (Number.isInteger(target) ? 0 : 1);
      el.textContent = fmt(item, 0, el.dataset.suffix);
      countTweens.set(el, gsap.to(o, {
        v: target,
        duration: 1.1,
        ease: 'power3.out',
        onUpdate: () => {
          const v = decimals ? Math.round(o.v * 10) / 10 : Math.round(o.v);
          el.textContent = fmt(item, v, el.dataset.suffix);
        },
        onComplete: () => { el.textContent = fmt(item, target, el.dataset.suffix); },
      }));
    });
  }

  function finishCounts(scope) {
    scope.querySelectorAll('[data-target]').forEach((el) => {
      const prev = countTweens.get(el);
      if (prev) prev.kill();
      el.textContent = fmt(DATA[el.dataset.num], Number(el.dataset.target), el.dataset.suffix);
    });
  }

  /* ---------- масштаб сцены ---------- */

  function fit() {
    if (PRINT) return;
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const x = (window.innerWidth - 1920 * s) / 2;
    const y = (window.innerHeight - 1080 * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }

  /* ---------- состояние и выборки ---------- */

  const state = { i: 0, step: 0 };
  const stepsOf = (i) => Number(slides[i].dataset.steps || 0);
  const stepEls = (slide, k) => Array.from(slide.querySelectorAll(`[data-step="${k}"]`));
  const allStepEls = (slide) => Array.from(slide.querySelectorAll('[data-step]'));
  const blocksOf = (slide) => Array.from(slide.querySelectorAll('[data-a]'));
  const masksOf = (slide) => Array.from(slide.querySelectorAll('.mask-in'));
  const casc = (n) => (n > 1 ? Math.min(0.08, 0.6 / (n - 1)) : 0);

  function killSlide(slide) {
    if (!hasGsap) return;
    gsap.killTweensOf(slide.querySelectorAll('*'));
    gsap.killTweensOf(slide);
  }

  /* Появление блока/шага: рукописные линии дорисовываются, полоска таймлайна растёт,
     цифры досчитываются. animate=false — сразу финальное состояние. */
  function enter(el, delay, animate) {
    const paths = Array.from(el.querySelectorAll('.sketch:not(.wipe) path'));
    const wipes = Array.from(el.querySelectorAll('.sketch.wipe'));
    const fills = Array.from(el.querySelectorAll('.tl-fill'));
    const pts = Array.from(el.querySelectorAll('.pt'));
    const edges = Array.from(el.querySelectorAll('.edge'));
    const pops = Array.from(el.querySelectorAll('.pop'));
    const sides = Array.from(el.querySelectorAll('.from-right'));
    if (!animate || reduced) {
      if (paths.length) gsap.set(paths, { strokeDashoffset: 0 });
      if (wipes.length) gsap.set(wipes, { scaleX: 1 });
      if (fills.length) gsap.set(fills, { scaleX: 1 });
      if (pts.length) gsap.set(pts, { autoAlpha: 1, y: 0 });
      if (edges.length) gsap.set(edges, { strokeDashoffset: 0 });
      if (pops.length) gsap.set(pops, { autoAlpha: 1, scale: 1 });
      if (sides.length) gsap.set(sides, { autoAlpha: 1, x: 0 });
      finishCounts(el);
      return;
    }
    if (paths.length) {
      gsap.fromTo(paths, { strokeDashoffset: 1 }, {
        strokeDashoffset: 0, duration: 0.8, ease: 'power1.inOut', delay: delay + 0.25, stagger: 0.12,
      });
    }
    if (wipes.length) {
      // подчёркивание «пишется» слева направо
      gsap.fromTo(wipes, { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.out', delay: delay + 0.35 });
    }
    if (fills.length) {
      gsap.fromTo(fills, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'power2.inOut', delay: delay + 0.25 });
    }
    if (pts.length) {
      gsap.fromTo(pts, { autoAlpha: 0, y: 10 }, {
        autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out', stagger: 0.22, delay: delay + 0.5,
      });
    }
    if (edges.length) {
      // связи графа дорисовываются по очереди
      gsap.fromTo(edges, { strokeDashoffset: 1 }, {
        strokeDashoffset: 0, duration: 0.7, ease: 'power1.inOut', stagger: 0.1, delay: delay + 0.4,
      });
    }
    if (pops.length) {
      // узлы и карточки всплывают с пружинкой
      gsap.fromTo(pops, { autoAlpha: 0, scale: 0.55 }, {
        autoAlpha: 1, scale: 1, duration: 0.6, ease: 'back.out(1.7)', stagger: 0.12, delay: delay + 0.2,
      });
    }
    if (sides.length) {
      // строки и люди влетают справа
      gsap.fromTo(sides, { autoAlpha: 0, x: 70 }, {
        autoAlpha: 1, x: 0, duration: 0.7, ease: 'power3.out', stagger: 0.12, delay: delay + 0.2,
      });
    }
    countUp(el);
  }

  /* Заголовок выезжает из маски снизу вверх. */
  function maskIn(slide, animate) {
    const ms = masksOf(slide);
    if (!ms.length) return;
    if (!animate || reduced) {
      gsap.set(ms, { yPercent: 0 });
      return;
    }
    gsap.fromTo(ms, { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: 'power3.out' });
  }

  /* Особые эффекты, которые зависят от шага: ничего лишнего, всё через enter(). */

  /* Анимация появления шага k (вперёд). */
  function playStep(slide, k) {
    const els = stepEls(slide, k);
    if (reduced) {
      gsap.set(els, { autoAlpha: 1, y: 0 });
      els.forEach((el) => enter(el, 0, false));
      return;
    }
    gsap.killTweensOf(els);
    gsap.fromTo(els, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: casc(els.length) });
    els.forEach((el, n) => enter(el, n * 0.08, true));
  }

  /* Откат шага k (назад) — коротко, без рывка. */
  function rewindStep(slide, k) {
    const els = stepEls(slide, k);
    if (reduced) {
      gsap.set(els, { autoAlpha: 0 });
      return;
    }
    gsap.killTweensOf(els);
    gsap.to(els, { autoAlpha: 0, y: 20, duration: 0.25, ease: 'power2.in' });
  }

  /* Показ слайда i на шаге step. animate=false — мгновенно (перезагрузка, Home/End). */
  function show(i, step, opts) {
    const o = Object.assign({ animate: true }, opts);
    const prev = slides[state.i];
    const next = slides[i];
    const changed = prev !== next;
    state.i = i;
    state.step = step;

    if (changed) {
      closeDemoVideo();
      manualVideo(prev, false);
      manualVideo(next, true);
    }
    body.classList.toggle('is-dark', next.classList.contains('s-bridge'));
    updateChrome();

    if (!hasGsap) {
      slides.forEach((s) => { s.style.visibility = s === next ? 'visible' : 'hidden'; s.style.opacity = s === next ? '1' : '0'; });
      return;
    }

    const animate = o.animate && !reduced;

    if (changed) {
      killSlide(prev);
      if (animate) {
        gsap.to(prev, { autoAlpha: 0, duration: 0.35, ease: 'power1.out' });
      } else {
        gsap.set(prev, { autoAlpha: 0 });
      }
      gsap.set(prev, { zIndex: 1 });
      slides.forEach((s) => { if (s !== next && s !== prev) gsap.set(s, { autoAlpha: 0 }); });
    }
    gsap.set(next, { zIndex: 2 });
    killSlide(next);

    const blocks = blocksOf(next);
    const steps = allStepEls(next);
    const shown = steps.filter((el) => Number(el.dataset.step) <= step);
    const hidden = steps.filter((el) => Number(el.dataset.step) > step);
    if (hidden.length) gsap.set(hidden, { autoAlpha: 0, y: 0 });

    if (!animate) {
      gsap.set(next, { autoAlpha: 1 });
      if (blocks.length) gsap.set(blocks, { autoAlpha: 1, y: 0 });
      if (shown.length) gsap.set(shown, { autoAlpha: 1, y: 0 });
      maskIn(next, false);
      blocks.forEach((b) => enter(b, 0, false));
      shown.forEach((el) => enter(el, 0, false));
      return;
    }

    gsap.fromTo(next, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: 'power1.out' });
    maskIn(next, true);
    if (blocks.length) {
      gsap.fromTo(blocks, { autoAlpha: 0, y: 28 }, {
        autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: casc(blocks.length), delay: 0.12,
      });
    }
    blocks.forEach((b, n) => enter(b, 0.12 + n * casc(blocks.length), true));
    if (shown.length) gsap.set(shown, { autoAlpha: 1, y: 0 });
    shown.forEach((el) => enter(el, 0, false));
  }

  function updateChrome() {
    pager.textContent = `${state.i + 1} / ${slides.length}`;
    if (hasGsap) {
      gsap.to(progressFill, { scaleX: (state.i + 1) / slides.length, duration: reduced ? 0 : 0.4, ease: 'power2.out' });
    }
    const h = `#${state.i + 1}`;
    if (window.location.hash !== h) history.replaceState(null, '', h);
    document.title = `${state.i + 1}. ${slides[state.i].dataset.title} — Диспетчерская с ИИ`;
  }

  /* ---------- навигация ---------- */

  function next() {
    const max = stepsOf(state.i);
    if (state.step < max) {
      state.step += 1;
      playStep(slides[state.i], state.step);
      return;
    }
    if (state.i === slides.length - 1) return;
    // браузер заблокировал окно — остаёмся на демо-слайде и показываем подсказку
    if (slides[state.i].dataset.demo !== undefined && !openDemoTab()) return;
    show(state.i + 1, 0);
  }

  /* Демо открывается отдельной вкладкой один раз: имя окна фиксирует вкладку,
     повторные нажатия её не плодят. Если браузер заблокировал всплывающее окно —
     показываем подсказку на слайде. */
  const DEMO_WINDOW = 'ugra-demo';
  function openDemoTab() {
    let opened = null;
    try { opened = window.open(SHOW.demoUrl, DEMO_WINDOW); } catch (e) { opened = null; }
    const hint = document.querySelector('.demo-hint');
    if (hint) hint.hidden = Boolean(opened);
    return Boolean(opened);
  }

  function prev() {
    if (state.step > 0) {
      rewindStep(slides[state.i], state.step);
      state.step -= 1;
      return;
    }
    if (state.i === 0) return;
    const j = state.i - 1;
    show(j, stepsOf(j));
  }

  function goTo(i, animate) {
    const j = Math.max(0, Math.min(slides.length - 1, i));
    show(j, 0, { animate });
  }

  /* ---------- полный экран, чёрный экран, курсор ---------- */

  const isFull = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

  function enterFull() {
    if (isFull()) return;
    const fn = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(root);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* браузер не дал — F11 вручную */ }
  }

  function exitFull() {
    if (!isFull()) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(document);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function toggleBlack() {
    body.classList.toggle('is-black');
  }

  let cursorTimer = 0;
  function wakeCursor() {
    body.classList.remove('cursor-off');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => body.classList.add('cursor-off'), SHOW.cursorHideMs);
  }

  /* ---------- видео ---------- */

  // Видео ручного режима (слайд «Действия»). Без файла (SHOW.manualVideo = null) — ничего не делает.
  function manualVideo(slide, on) {
    const v = slide && slide.querySelector('.manual-video');
    if (!v || !SHOW.manualVideo) return;
    if (on) {
      if (!v.getAttribute('src')) v.src = SHOW.manualVideo;
      v.currentTime = 0;
      v.playbackRate = SHOW.manualVideoRate;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  }

  const demoLayer = document.querySelector('.video-layer');
  const demoVideo = document.querySelector('.demo-video');
  const demoMissing = document.querySelector('.video-missing');

  function openDemoVideo() {
    demoLayer.hidden = false;
    demoMissing.hidden = true;
    if (!demoVideo.getAttribute('src')) {
      demoVideo.addEventListener('error', () => {
        demoMissing.hidden = false;
        demoVideo.style.visibility = 'hidden';
      });
      demoVideo.src = SHOW.demoVideo;
    }
    const p = demoVideo.play();
    if (p && p.catch) p.catch(() => {});
  }

  function closeDemoVideo() {
    if (!demoLayer || demoLayer.hidden) return;
    demoVideo.pause();
    demoLayer.hidden = true;
  }

  const demoOpen = () => demoLayer && !demoLayer.hidden;

  /* ---------- клавиши (кликер Logitech R400 = клавиатура) ---------- */

  const NEXT = new Set(['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'Enter']);
  const PREV = new Set(['PageUp', 'ArrowLeft', 'ArrowUp', 'Backspace']);

  // Кликер и разные браузеры присылают клавиши по-разному: name → канон, иначе keyCode.
  const KEY_ALIAS = { Next: 'PageDown', Prior: 'PageUp', Esc: 'Escape', Spacebar: ' ',
    Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };
  const KEY_CODE = { 8: 'Backspace', 13: 'Enter', 27: 'Escape', 32: ' ', 33: 'PageUp', 34: 'PageDown',
    35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 116: 'F5' };
  function keyName(e) {
    if (e.key && e.key !== 'Unidentified') return KEY_ALIAS[e.key] !== undefined ? KEY_ALIAS[e.key] : e.key;
    return KEY_CODE[e.keyCode] !== undefined ? KEY_CODE[e.keyCode] : '';
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = keyName(e);
    const code = e.code || '';
    const letter = k.length === 1 ? k.toLowerCase() : '';

    // «старт показа»: F5 / Shift+F5 → полный экран, перезагрузку перехватываем
    if (k === 'F5') {
      e.preventDefault();
      if (isFull()) exitFull(); else enterFull();
      return;
    }

    // «чёрный экран»: «.» или B (в любой раскладке)
    if (k === '.' || letter === 'b' || code === 'Period' || code === 'KeyB' || e.keyCode === 190 || e.keyCode === 66) {
      e.preventDefault();
      toggleBlack();
      return;
    }

    // Экран затемнён — любая навигация сначала возвращает картинку
    if (body.classList.contains('is-black') && (NEXT.has(k) || PREV.has(k))) {
      e.preventDefault();
      toggleBlack();
      return;
    }

    if (demoOpen()) {
      if (k === 'Escape' || letter === 'v' || code === 'KeyV' || PREV.has(k)) {
        e.preventDefault();
        closeDemoVideo();
      }
      return;
    }

    if (NEXT.has(k)) {
      e.preventDefault();
      if (!e.repeat) next();
      return;
    }
    if (PREV.has(k)) {
      e.preventDefault();
      if (!e.repeat) prev();
      return;
    }
    if (k === 'Home') { e.preventDefault(); goTo(0, true); return; }
    if (k === 'End') { e.preventDefault(); goTo(slides.length - 1, true); return; }
    if (letter === 'f' || code === 'KeyF' || e.keyCode === 70) {
      e.preventDefault();
      if (isFull()) exitFull(); else enterFull();
      return;
    }
    if ((letter === 'v' || code === 'KeyV' || e.keyCode === 86) && slides[state.i].dataset.demo !== undefined) {
      e.preventDefault();
      openDemoVideo();
    }
  }

  function slideFromHash() {
    const n = parseInt(window.location.hash.replace('#', ''), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(slides.length - 1, n - 1)) : 0;
  }

  /* ---------- старт ---------- */

  renderData();

  const teamImg = new Image();
  teamImg.onload = () => { const note = document.querySelector('.photo-note'); if (note) note.remove(); };
  teamImg.src = 'media/team.jpg';

  if (PRINT) {
    // ?print: все слайды стоят по одному на страницу, шаги и цифры в финальном виде (CSS).
    root.classList.add('is-print');
    body.classList.add('is-print');
    return;
  }

  fit();
  window.addEventListener('resize', fit);
  document.addEventListener('keydown', onKey);
  document.addEventListener('mousemove', wakeCursor);
  window.addEventListener('hashchange', () => {
    const i = slideFromHash();
    if (i !== state.i) show(i, 0, { animate: true });
  });
  wakeCursor();

  if (hasGsap) gsap.set(slides, { autoAlpha: 0 });
  const start = slideFromHash();
  state.i = start;
  const go = () => show(start, 0, { animate: true });
  // Дождаться шрифта, чтобы первая анимация не прыгала
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(go, go);
  } else {
    go();
  }
}());
