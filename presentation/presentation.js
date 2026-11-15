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
    const paths = Array.from(el.querySelectorAll('.sketch:not(.wipe):not(.fx) path'));
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


  /* Анимация появления шага k (вперёд). */
  function playStep(slide, k) {
    const els = stepEls(slide, k);
    const f = fxOf(slide);
    if (f) f.step(slide, k, !reduced);
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
    const f = fxOf(slide);
    if (f) f.step(slide, k - 1, false);
    if (reduced) {
      gsap.set(els, { autoAlpha: 0 });
      return;
    }
    gsap.killTweensOf(els);
    gsap.to(els, { autoAlpha: 0, y: 20, duration: 0.25, ease: 'power2.in' });
  }

  /* ---------- 4. Стек: одно обращение проходит весь путь, по клику облако → локальная модель ---------- */

  const stackRuns = new WeakMap();

  function stackSwap(slide, on, animate) {
    const cloud = slide.querySelector('.ai-cloud');
    const local = slide.querySelector('.ai-local');
    if (!cloud || !local) return;
    gsap.killTweensOf([cloud, local]);
    if (!animate || reduced) {
      gsap.set(cloud, { autoAlpha: on ? 0 : 1, scaleY: 1, transformOrigin: '50% 50%' });
      gsap.set(local, { autoAlpha: on ? 1 : 0, scaleY: 1, transformOrigin: '50% 50%' });
      return;
    }
    if (!on) return;
    const portGlow = slide.querySelector('[data-node="ports"] .glow');
    const aiGlow = slide.querySelector('[data-node="ai"] .glow');
    gsap.timeline()
      .fromTo(portGlow, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' }, 0)
      .to(cloud, { scaleY: 0, autoAlpha: 0, duration: 0.3, ease: 'power2.in', transformOrigin: '50% 50%' }, 0.1)
      .fromTo(local, { scaleY: 0, autoAlpha: 0 }, {
        scaleY: 1, autoAlpha: 1, duration: 0.55, ease: 'back.out(2.2)', transformOrigin: '50% 50%',
      }, 0.4)
      .fromTo(aiGlow, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.6)
      .to([portGlow, aiGlow], { opacity: 0, duration: 0.7, ease: 'power1.in' }, 1.2);
  }

  function stackReset(slide, step) {
    const run = stackRuns.get(slide);
    if (run) run.kill();
    stackRuns.delete(slide);
    slide.querySelectorAll('.hot').forEach((path) => {
      const len = path.getTotalLength();
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len, opacity: 0 });
    });
    gsap.set(slide.querySelectorAll('.glow, .pill-hot, .packet'), { opacity: 0 });
    stackSwap(slide, step >= 1, false);
  }

  function stackPlay(slide) {
    const glow = (key) => slide.querySelector(`[data-node="${key}"] .glow`);
    const route = (name) => Array.from(slide.querySelectorAll(`.hot[data-route="${name}"]`));
    const packets = Array.from(slide.querySelectorAll('.packet'));
    const main = packets[0];
    const tl = gsap.timeline({ delay: 1.4 });

    // точка-пакет едет по проводу, провод за ней загорается
    function travel(pkt, path, dur, at) {
      const len = path.getTotalLength();
      const p0 = path.getPointAtLength(0);
      const o = { t: 0 };
      tl.set(pkt, { opacity: 1, x: p0.x, y: p0.y }, at);
      tl.set(path, { opacity: 1 }, at);
      tl.to(path, { strokeDashoffset: 0, duration: dur, ease: 'power1.inOut' }, at);
      tl.to(o, {
        t: 1,
        duration: dur,
        ease: 'power1.inOut',
        onUpdate: () => {
          const pt = path.getPointAtLength(o.t * len);
          gsap.set(pkt, { x: pt.x, y: pt.y });
        },
      }, at);
      tl.set(pkt, { opacity: 0 }, at + dur);
    }
    // рамка узла вспыхивает, когда до него дошёл пакет
    function pulse(el, at, hold) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power1.out' }, at);
      tl.to(el, { opacity: 0, duration: 0.6, ease: 'power1.in' }, at + (hold || 0.35));
    }

    pulse(glow('phone'), 0);
    travel(main, route('in')[0], 0.55, 0.1);
    pulse(glow('api'), 0.65);
    travel(main, route('api')[0], 0.35, 0.85);
    // ядро: модули загораются по очереди — разбор, приоритет, исполнитель, авария, база знаний, отчёты
    pulse(glow('core'), 1.2, 1.3);
    tl.fromTo(slide.querySelectorAll('.pill-hot'), { opacity: 0 }, {
      opacity: 1, duration: 0.16, ease: 'power1.out', stagger: 0.14,
    }, 1.3);
    tl.set(route('db')[0], { opacity: 1 }, 2.1);
    tl.to(route('db')[0], { strokeDashoffset: 0, duration: 0.3, ease: 'power1.inOut' }, 2.1);
    pulse(glow('db'), 2.4);
    travel(main, route('out')[0], 0.35, 2.25);
    pulse(glow('ports'), 2.6);
    route('ext').forEach((path, n) => travel(packets[n + 1], path, 0.6, 2.8));
    ['ai', 'voice', 'cmdb', 'notify'].forEach((key) => pulse(glow(key), 3.4, 0.5));
    // после прохода остаётся тихий след: путь виден, модули гаснут
    tl.to(slide.querySelectorAll('.hot'), { opacity: 0.35, duration: 0.8, ease: 'power1.inOut' }, 4.1);
    tl.to(slide.querySelectorAll('.pill-hot'), { opacity: 0, duration: 0.8, ease: 'power1.inOut' }, 4.1);
    stackRuns.set(slide, tl);
  }

  const FX = {
    stack: {
      enter(slide, step, animate) {
        stackReset(slide, step);
        if (animate && step === 0) stackPlay(slide);
      },
      step(slide, k, animate) { stackSwap(slide, k >= 1, animate); },
      leave(slide) {
        const run = stackRuns.get(slide);
        if (run) run.kill();
      },
    },
  };
  const fxOf = (slide) => FX[slide.dataset.fx];

  /* ---------- режиссура слайдов: свой сценарий у каждого слайда (data-fx) ----------
     CSS хранит финальное состояние. enter(slide, step, animate): animate=false → финал сразу
     (печать, «уменьшить движение», Home/End); иначе таймлайн из начального состояния. */

  const fxRuns = new WeakMap();
  const $1 = (slide, sel) => slide.querySelector(sel);
  const $all = (slide, sel) => Array.from(slide.querySelectorAll(sel));

  function fxStop(slide) {
    const run = fxRuns.get(slide);
    if (run) run.kill();
    fxRuns.delete(slide);
  }

  // финальное состояние: снять всё, что выставил GSAP, — дальше решает CSS
  function fxFinal(slide) {
    fxStop(slide);
    const els = $all(slide, '.fxa');
    if (els.length) gsap.set(els, { clearProps: 'transform,opacity,visibility,strokeDashoffset' });
    $all(slide, '[data-count]').forEach((el) => { el.textContent = countText(el, Number(el.dataset.count)); });
  }

  function countText(el, v) {
    const dec = Number(el.dataset.dec || 0);
    const num = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    return (el.dataset.pre || '').replace(' ', NBSP) + num + (el.dataset.post || '').replace(' ', NBSP);
  }

  // цифра досчитывается от нуля внутри таймлайна
  function countIn(tl, el, at, dur) {
    const to = Number(el.dataset.count);
    const o = { v: 0 };
    tl.call(() => { el.textContent = countText(el, 0); }, null, Math.max(0, at - 0.01));
    tl.to(o, {
      v: to,
      duration: dur,
      ease: 'power3.out',
      onUpdate: () => { el.textContent = countText(el, o.v); },
      onComplete: () => { el.textContent = countText(el, to); },
    }, at);
  }

  // рукописная линия дорисовывается
  function drawIn(tl, paths, at, dur) {
    tl.fromTo(paths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: 'power1.inOut' }, at);
  }

  // три волны расходятся от точки (один раз)
  function rippleIn(tl, host, at) {
    const rings = host ? host.querySelectorAll('.rip i') : [];
    if (!rings.length) return;
    tl.fromTo(rings, { scale: 1, opacity: 0.6 }, {
      scale: 3.4, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.28,
    }, at);
  }

  // буквы взлетают из маски
  function lettersIn(tl, chars, at) {
    tl.fromTo(chars, { yPercent: 115, rotate: 7, opacity: 0 }, {
      yPercent: 0, rotate: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.03,
    }, at);
  }

  // буквы печатаются
  function typeIn(tl, chars, at, step) {
    tl.fromTo(chars, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.08, ease: 'none', stagger: step }, at);
  }

  // пружинка: точка, клавиша, иконка
  function popIn(tl, els, at, stagger) {
    tl.fromTo(els, { scale: 0, opacity: 0 }, {
      scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(2.4)', stagger: stagger || 0, transformOrigin: '50% 50%',
    }, at);
  }

  function shake(tl, el, at, amp) {
    tl.fromTo(el, { x: 0 }, { x: amp, duration: 0.05, ease: 'none', yoyo: true, repeat: 5 }, at);
  }

  const DIRECTOR = {
    // 1. Титул: буквы взлетают, точка пружинит со всплеском, прорисовывается «∞»
    title(slide, tl) {
      lettersIn(tl, $all(slide, '.hero .ch'), 0.05);
      drawIn(tl, $all(slide, '.inf path'), 0.2, 2.2);
      popIn(tl, $1(slide, '.hero .dot-pop'), 0.62);
      tl.fromTo($1(slide, '.splash'), { scale: 0.3, opacity: 0.7 }, { scale: 4, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.7);
      tl.fromTo($1(slide, '.arrow-fly'), { x: -46, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, 1.0);
    },

    // 2. Боль: часы щёлкают 03:11 → 03:12, цитата печатается, облачко вздрагивает, авария пульсирует
    pain(slide, tl) {
      tl.fromTo($1(slide, '.roll-in'), { y: 0, yPercent: 0 }, { y: 0, yPercent: -50, duration: 0.45, ease: 'back.out(2)' }, 0.8);
      typeIn(tl, $all(slide, '.bubble-text .ch'), 0.9, 0.022);
      shake(tl, $1(slide, '.bubble'), 1.75, 7);
      drawIn(tl, $all(slide, '.tasks-alarm .sketch path'), 1.55, 0.55);
      rippleIn(tl, $1(slide, '.tasks .adot'), 1.7);
    },

    // 3. Решение: обращение бежит по цепочке, ИИ раскладывает поля, человек жмёт Enter
    solution(slide, tl) {
      const flow = $1(slide, '.flow');
      const nodes = $all(slide, '.flow-node');
      const token = $1(slide, '.token');
      const midY = (n) => n.offsetTop + n.offsetHeight / 2;
      const hop = (from, to, at) => {
        tl.set(token, { opacity: 1, x: from.offsetLeft + from.offsetWidth, y: midY(from) }, at);
        tl.to(token, { x: to.offsetLeft, duration: 0.42, ease: 'power2.inOut' }, at);
        tl.set(token, { opacity: 0 }, at + 0.42);
      };
      if (!flow || nodes.length < 3) return;
      popIn(tl, $1(slide, '.mini-msg'), 0.55);
      hop(nodes[0], nodes[1], 0.95);
      tl.fromTo(nodes[1].querySelector('.nglow'), { opacity: 0 }, { opacity: 1, duration: 0.2 }, 1.35);
      popIn(tl, $all(slide, '.mini-f i'), 1.4, 0.13);
      tl.to(nodes[1].querySelector('.nglow'), { opacity: 0, duration: 0.5 }, 2.0);
      hop(nodes[1], nodes[2], 1.9);
      tl.fromTo(nodes[2].querySelector('.nglow'), { opacity: 0 }, { opacity: 1, duration: 0.2 }, 2.3);
      popIn(tl, $1(slide, '.kbd-big'), 2.3);
      tl.to($1(slide, '.kbd-big'), { y: 4, scale: 0.92, duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 2.75);
      drawIn(tl, $all(slide, '.chk path'), 2.85, 0.35);
      tl.to(nodes[2].querySelector('.nglow'), { opacity: 0, duration: 0.6 }, 3.3);
      rippleIn(tl, $1(slide, '.alarm-line .alarm-dot'), 1.0);
    },

    // 5. Авария: таймлайн добегает, экран вспыхивает, цифра вздрагивает, дежурные появляются по одному
    alarm(slide, tl) {
      popIn(tl, $all(slide, '.duty i'), 0.7, 0.2);
      rippleIn(tl, $1(slide, '.tl-dot'), 1.25);
      tl.fromTo($1(slide, '.tl-tag'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'back.out(2)' }, 1.3);
      tl.fromTo($1(slide, '.flash'), { opacity: 0 }, { opacity: 1, duration: 0.14, ease: 'power1.out' }, 1.2);
      tl.to($1(slide, '.flash'), { opacity: 0, duration: 0.9, ease: 'power1.in' }, 1.36);
      shake(tl, $1(slide, '.alarm-big'), 1.25, 8);
    },

    // 6. Разбор: полторы минуты набегают и зачёркиваются, «≈ 0» падает с отскоком и обводится
    act(slide, tl) {
      const old = $1(slide, '.act-old .big');
      tl.set(old, { opacity: 1 }, 0);
      countIn(tl, old, 0.3, 0.9);
      drawIn(tl, $all(slide, '.strike path'), 1.3, 0.45);
      tl.to(old, { opacity: 0.4, duration: 0.4 }, 1.6);
      tl.fromTo($1(slide, '.act-arrow'), { x: -70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 1.6);
      tl.fromTo($1(slide, '.act-new .big'), { y: -180, opacity: 0 }, { y: 0, opacity: 1, duration: 0.75, ease: 'bounce.out' }, 1.85);
      drawIn(tl, $all(slide, '.oval-act path'), 2.55, 0.7);
    },

    // 7. Экономия: часы набегают и обводятся, колонка 50 подсвечивается, таблица досчитывается
    save(slide, tl) {
      countIn(tl, $1(slide, '.save-main .big'), 0.3, 1.0);
      drawIn(tl, $all(slide, '.oval-save path'), 1.15, 0.7);
      tl.fromTo($1(slide, '.col-hl'), { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.5, ease: 'power3.out' }, 0.9);
      $all(slide, '.save-table [data-count]').forEach((el, n) => countIn(tl, el, 0.75 + (n % 3) * 0.08, 0.8));
    },

    // 8. Команда: шторка открывает фото, дорожная карта прорисовывается по точкам
    team(slide, tl) {
      tl.fromTo($1(slide, '.curtain'), { scaleX: 1 }, { scaleX: 0, duration: 0.8, ease: 'power3.inOut' }, 0.25);
      tl.fromTo($1(slide, '.photo-img'), { scale: 1.18 }, { scale: 1, duration: 1.3, ease: 'power2.out' }, 0.25);
      tl.fromTo($1(slide, '.rail-fill'), { scaleY: 0 }, { scaleY: 1, duration: 1.0, ease: 'power1.inOut' }, 0.5);
      popIn(tl, $all(slide, '.sdot'), 0.5, 0.42);
      tl.fromTo($1(slide, '.inf-note'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.9);
    },

    // 9. Смотрим вживую: свечение, буквы каскадом, адрес печатается с курсором
    bridge(slide, tl) {
      tl.fromTo($1(slide, '.glow-bg'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, ease: 'power2.out' }, 0);
      lettersIn(tl, $all(slide, '.bridge-h .ch'), 0.1);
      popIn(tl, $1(slide, '.bridge-h .dot-pop'), 0.75);
      typeIn(tl, $all(slide, '[data-demo-host] .ch'), 1.0, 0.035);
      tl.fromTo($1(slide, '.caret'), { opacity: 1 }, { opacity: 0, duration: 0.3, ease: 'steps(1)', yoyo: true, repeat: 5 }, 1.5);
    },
  };

  Object.keys(DIRECTOR).forEach((name) => {
    FX[name] = {
      enter(slide, step, animate) {
        if (!animate) {
          fxFinal(slide);
          return;
        }
        fxStop(slide);
        const tl = gsap.timeline();
        DIRECTOR[name](slide, tl);
        fxRuns.set(slide, tl);
      },
      step() {},
      leave(slide) { fxStop(slide); },
    };
  });

  // текст → буквы (.ch): заголовки, цитата, адрес демо. Вложенные элементы и SVG не трогаем.
  function splitChars(el) {
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        // слово — неразрывный блок, иначе буквы-блоки переносятся посреди слова
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
            return;
          }
          const word = document.createElement('span');
          word.className = 'w';
          Array.from(part).forEach((c) => {
            const span = document.createElement('span');
            span.className = 'ch fxa';
            span.textContent = c;
            word.appendChild(span);
          });
          frag.appendChild(word);
        });
        node.replaceWith(frag);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.namespaceURI === 'http://www.w3.org/1999/xhtml'
        && !node.classList.contains('dot-pop')) {
        splitChars(node);
      }
    });
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
      const prevFx = fxOf(prev);
      if (prevFx) prevFx.leave(prev);
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
    const nextFx = fxOf(next);
    if (nextFx) nextFx.enter(next, step, animate);

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
    // демо-слайд: «›» открывает вкладку демо. Если браузер заблокировал окно — подсказка на слайде.
    // Проверка идёт до «последнего слайда»: демо стоит в конце показа.
    if (slides[state.i].dataset.demo !== undefined) {
      const opened = openDemoTab();
      if (!opened || state.i === slides.length - 1) return;
    }
    if (state.i === slides.length - 1) return;
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
    // вернуть фокус презентации: браузер мог переключиться на новую вкладку
    if (opened) setTimeout(() => window.focus(), 300);
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
  document.querySelectorAll('.split, .type, [data-demo-host]').forEach(splitChars);

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
  // capture на window: клавиша доходит до нас раньше, чем её перехватит видео или элемент страницы,
  // и preventDefault срабатывает до умолчаний браузера (F5 не перезагружает, Space не скроллит)
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', () => window.focus());
  document.addEventListener('mousemove', wakeCursor);
  window.addEventListener('hashchange', () => {
    const i = slideFromHash();
    if (i !== state.i) show(i, 0, { animate: true });
  });
  wakeCursor();
  window.focus();

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
