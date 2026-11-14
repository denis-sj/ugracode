/* Презентация кейса 9: навигация под кликер, шаги, анимации GSAP.
   Спецификация: docs/specs/case9-presentation.md. */

/* =====================================================================
   DATA — ВСЕ цифры слайдов. Обновить цифру = поправить ТОЛЬКО здесь.
   value: число или null. null → на слайде «❓ замер».
   Значения — строго из реестра цифр (раздел 8 спецификации).
   Демо-цифры страницы /measure?demo=1 сюда НЕ брать.
   ===================================================================== */
const DATA = {
  // Слайд 5 — reports/quality.md (последний прогон pnpm eval)
  missedEmergencies: { value: 0, source: 'reports/quality.md · 10 тестовых обращений' },
  emergencyCases: { value: 10, source: 'reports/quality.md · 10 тестовых обращений' },
  assigneeTop3: { value: 100, unit: '%', source: 'reports/quality.md' },
  fieldsByAi: { value: 84, unit: '%', source: 'reports/quality.md' },
  inventedFields: { value: 9, source: 'reports/quality.md' },
  model: { value: 'deepseek-v4.1-flash', source: 'модель deepseek-v4.1-flash' },

  // Слайд 6, блок 1 — reports/measure.md, раздел 4, случай 1 (медиана из 3)
  actionsManual: { value: null, source: 'reports/measure.md · замер на одном человеке, медиана из 3' },
  actionsAi: { value: null, source: 'reports/measure.md, раздел 4' },
  timeManual: { value: null, source: 'reports/measure.md, раздел 4' }, // секунды
  timeAi: { value: null, source: 'reports/measure.md, раздел 4' }, // секунды

  // Слайд 6, блок 2 — reports/measure.md, раздел 5 (случай 3, авария), секунды
  emergencyDetected: { value: null, source: 'reports/measure.md, раздел 5' },
  emergencyNotified: { value: null, source: 'reports/measure.md, раздел 5' },
  emergencyManual: { value: null, source: 'reports/measure.md, раздел 5' },

  // Слайд 6, блок 3 — reports/measure.md, раздел 6 (расчёт)
  hours30: { value: null, source: 'reports/measure.md, раздел 6' },
  shifts30: { value: null, source: 'reports/measure.md, раздел 6' },
  hours50: { value: null, source: 'reports/measure.md, раздел 6' },
  shifts50: { value: null, source: 'reports/measure.md, раздел 6' },
  hours100: { value: null, source: 'reports/measure.md, раздел 6' },
  shifts100: { value: null, source: 'reports/measure.md, раздел 6' },

  // Слайд 7 — reports/sonarqube-summary.md
  sonarBugs: { value: 0, source: 'reports/sonarqube-summary.md' },
  sonarVulns: { value: 0, source: 'reports/sonarqube-summary.md' },
  sonarIssues: { value: 0, source: 'reports/sonarqube-summary.md' },
  coverage: { value: 83, unit: '%', source: 'reports/sonarqube-summary.md' },
  // Число тестов — только из вывода свежего `pnpm check`. Пока null — плашка на слайде скрыта.
  tests: { value: null, source: 'вывод pnpm check' },
};

/* Настройки показа (не цифры). */
const SHOW = {
  demoUrl: 'http://localhost:5173', // «›» на слайде 10
  demoVideo: 'media/demo.mp4', // V на слайде 10
  // Видео ручного режима для слайда 6. Пока файла нет — null (иначе ошибка 404 в консоли).
  // Записали presentation/media/manual.mp4 → поставить 'media/manual.mp4'.
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
    let s = nf.format(v);
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
      const keys = el.dataset.src.split(',').map((k) => k.trim());
      const srcs = [];
      keys.forEach((k) => {
        const it = DATA[k];
        if (!it) return;
        if (k === 'tests' && it.value === null) return;
        if (!srcs.includes(it.source)) srcs.push(it.source);
      });
      el.textContent = srcs.join(' · ');
    });
    document.querySelectorAll('[data-if]').forEach((el) => {
      const it = DATA[el.dataset.if];
      if (!it || it.value === null) el.remove();
    });
    document.querySelectorAll('[data-demo-host]').forEach((el) => {
      el.textContent = SHOW.demoUrl.replace(/^https?:\/\//, '');
    });
  }

  const countTweens = new Map();

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
      const decimals = Number.isInteger(target) ? 0 : 1;
      el.textContent = fmt(item, 0, el.dataset.suffix);
      countTweens.set(el, gsap.to(o, {
        v: target,
        duration: 0.9,
        ease: 'power2.out',
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
    stage.style.transform = `scale(${s}) translate(-50%, -50%)`;
  }

  /* ---------- состояние ---------- */

  const state = { i: 0, step: 0 };
  const stepsOf = (i) => Number(slides[i].dataset.steps || 0);
  const stepEls = (slide, k) => Array.from(slide.querySelectorAll(`[data-step="${k}"]`));
  const allStepEls = (slide) => Array.from(slide.querySelectorAll('[data-step]'));
  const casc = (n) => (n > 1 ? Math.min(0.08, 0.6 / (n - 1)) : 0);

  function killSlide(slide) {
    if (!hasGsap) return;
    gsap.killTweensOf(slide.querySelectorAll('*'));
    gsap.killTweensOf(slide);
  }

  /* Финальное состояние «блоков» слайда без анимации. */
  function settle(slide, step) {
    if (!hasGsap) return;
    killSlide(slide);
    gsap.set(slide.querySelectorAll('[data-a]'), { autoAlpha: 1, y: 0, clearProps: 'transform' });
    allStepEls(slide).forEach((el) => {
      const k = Number(el.dataset.step);
      gsap.set(el, k <= step ? { autoAlpha: 1, y: 0 } : { autoAlpha: 0, y: 24 });
    });
    slideFx(slide, step, false);
    finishCounts(slide);
  }

  /* Особые эффекты слайдов (линии, точки, загорание шагов). */
  function slideFx(slide, step, animate) {
    if (slide.classList.contains('s-how')) {
      const fill = slide.querySelector('.chain-fill');
      const dot = slide.querySelector('.chain-dot');
      const track = slide.querySelector('.chain-track');
      const lits = slide.querySelectorAll('.lit');
      const w = track.offsetWidth;
      if (!animate || reduced) {
        gsap.set(fill, { scaleX: 1 });
        gsap.set(dot, { x: w });
        gsap.set(lits, { autoAlpha: 1 });
        return;
      }
      const tl = gsap.timeline({ delay: 0.15 });
      tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'none' }, 0)
        .fromTo(dot, { x: 0 }, { x: w, duration: 0.9, ease: 'none' }, 0)
        .fromTo(lits, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.3, stagger: 0.12, ease: 'back.out(2)' }, 0);
    }
    if (slide.classList.contains('s-k')) {
      // галочки — внутри шага, показываются вместе со строкой
      slide.querySelectorAll('.k-row').forEach((row) => {
        const k = Number(row.dataset.step);
        if (!animate) gsap.set(row.querySelector('.k-check'), { autoAlpha: k <= step ? 1 : 0, scale: 1 });
      });
    }
    if (slide.classList.contains('s-gain')) {
      const fill = slide.querySelector('.tl-fill');
      const pts = slide.querySelectorAll('.tl-pt');
      if (!animate) {
        gsap.set(fill, { scaleX: step >= 2 ? 1 : 0 });
        gsap.set(pts, { autoAlpha: step >= 2 ? 1 : 0 });
      }
      manualVideo(slide, step >= 1);
    }
  }

  /* Анимация появления шага k (вперёд). */
  function playStep(slide, k) {
    const els = stepEls(slide, k);
    if (reduced) {
      gsap.set(els, { autoAlpha: 1, y: 0 });
      slideFx(slide, k, false);
      els.forEach(finishCounts);
      return;
    }
    gsap.killTweensOf(els);
    gsap.fromTo(els, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: casc(els.length) });
    if (slide.classList.contains('s-k')) {
      const check = els[0] && els[0].querySelector('.k-check');
      if (check) gsap.fromTo(check, { autoAlpha: 0, scale: 0.3 }, { autoAlpha: 1, scale: 1, duration: 0.4, delay: 0.25, ease: 'back.out(2.5)' });
    }
    if (slide.classList.contains('s-gain')) {
      if (k === 1) manualVideo(slide, true);
      if (k === 2) {
        const fill = slide.querySelector('.tl-fill');
        const pts = slide.querySelectorAll('.tl-pt');
        gsap.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'power1.inOut', delay: 0.1 });
        gsap.fromTo(pts, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.3, delay: 0.1 });
      }
    }
    els.forEach((el) => countUp(el));
  }

  /* Откат шага k (назад) — без рывка, коротко. */
  function rewindStep(slide, k) {
    const els = stepEls(slide, k);
    els.forEach(finishCounts);
    if (slide.classList.contains('s-gain') && k === 1) manualVideo(slide, false);
    if (reduced) {
      gsap.set(els, { autoAlpha: 0 });
      slideFx(slide, k - 1, false);
      return;
    }
    gsap.killTweensOf(els);
    gsap.to(els, { autoAlpha: 0, y: 20, duration: 0.25, ease: 'power2.in' });
    if (slide.classList.contains('s-gain') && k === 2) {
      gsap.to(slide.querySelector('.tl-fill'), { scaleX: 0, duration: 0.25 });
      gsap.to(slide.querySelectorAll('.tl-pt'), { autoAlpha: 0, duration: 0.2 });
    }
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
      if (prev.classList.contains('s-gain')) manualVideo(prev, false);
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
        gsap.to(prev, { autoAlpha: 0, duration: 0.3, ease: 'power1.out' });
      } else {
        gsap.set(prev, { autoAlpha: 0 });
      }
      slides.forEach((s) => { if (s !== next && s !== prev) gsap.set(s, { autoAlpha: 0 }); });
    }

    settle(next, step);
    gsap.set(next, { zIndex: 2 });
    if (changed) gsap.set(prev, { zIndex: 1 });

    if (!animate) {
      gsap.set(next, { autoAlpha: 1 });
      return;
    }

    gsap.fromTo(next, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: 'power1.out' });

    // Каскад блоков слайда (без шагов)
    const blocks = Array.from(next.querySelectorAll('[data-a]'));
    gsap.fromTo(blocks, { autoAlpha: 0, y: 32 }, {
      autoAlpha: 1, y: 0, duration: 0.55, ease: 'power3.out', stagger: casc(blocks.length), delay: 0.05,
      clearProps: 'transform',
    });
    blocks.forEach((b) => countUp(b));
    slideFx(next, step, true);

    // Шаги, уже открытые при входе (возврат назад) — показать сразу
    for (let k = 1; k <= step; k += 1) gsap.set(stepEls(next, k), { autoAlpha: 1, y: 0 });

    if (i === 0) driftBlobs();
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
    if (state.i === slides.length - 1) {
      goDemo();
      return;
    }
    show(state.i + 1, 0);
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

  function goDemo() {
    window.location.href = SHOW.demoUrl;
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

  function manualVideo(slide, on) {
    const box = slide.querySelector('.gain-video');
    const v = slide.querySelector('.manual-video');
    const timer = slide.querySelector('[data-timer]');
    if (!box || !v) return;
    if (!SHOW.manualVideo) {
      if (timer) timer.textContent = '0:00';
      return;
    }
    if (on) {
      if (!v.getAttribute('src')) {
        v.addEventListener('error', () => {
          box.classList.remove('has-video');
          const note = slide.querySelector('[data-video-note]');
          if (note) note.textContent = 'видео не найдено: ' + SHOW.manualVideo;
        }, { once: true });
        v.addEventListener('loadeddata', () => box.classList.add('has-video'), { once: true });
        v.addEventListener('timeupdate', () => {
          // таймер — реальное время ручного режима (видео ускорено)
          const t = Math.floor(v.currentTime);
          timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        });
        v.src = SHOW.manualVideo;
      }
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

  /* ---------- фон титула: пятна смещаются один раз ---------- */

  let drifted = false;
  function driftBlobs() {
    if (drifted || reduced || !hasGsap) return;
    drifted = true;
    gsap.fromTo('.blob-violet', { x: -80, y: -40 }, { x: 0, y: 0, duration: 7, ease: 'sine.out' });
    gsap.fromTo('.blob-blue', { x: 90, y: -30 }, { x: 0, y: 0, duration: 7, ease: 'sine.out' });
    gsap.fromTo('.blob-sky', { x: -60, y: 60 }, { x: 0, y: 0, duration: 7, ease: 'sine.out' });
  }

  /* ---------- клавиши (кликер Logitech R400 = клавиатура) ---------- */

  const NEXT = new Set(['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'Enter']);
  const PREV = new Set(['PageUp', 'ArrowLeft', 'ArrowUp', 'Backspace']);

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const code = e.code;

    // «старт показа»: F5 / Shift+F5 → полный экран, перезагрузку перехватываем
    if (k === 'F5') {
      e.preventDefault();
      if (isFull()) exitFull(); else enterFull();
      return;
    }

    // «чёрный экран»: «.» или B (в любой раскладке)
    if (k === '.' || code === 'Period' || code === 'KeyB' || k === 'b' || k === 'B') {
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
      if (k === 'Escape' || code === 'KeyV' || PREV.has(k)) {
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
    if (code === 'KeyF') {
      e.preventDefault();
      if (isFull()) exitFull(); else enterFull();
      return;
    }
    if (code === 'KeyV' && state.i === slides.length - 1) {
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

  if (PRINT) {
    root.classList.add('is-print');
    body.classList.add('is-print');
    slides.forEach((s) => {
      s.querySelectorAll('[data-a], [data-step], .lit, .k-check, .tl-pt').forEach((el) => {
        el.style.opacity = '1';
        el.style.visibility = 'visible';
      });
    });
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
