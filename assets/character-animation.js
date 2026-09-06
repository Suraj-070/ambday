/* =========================================================
   Character Animation — Birthday Room
   Single combined SVG (characters.svg, viewBox 0 0 1000 700)
   Boy: left half (0–500), Girl: right half (500–1000, translated)
   State machine: idle → reaction → move-together → hug → kiss → idle
   ========================================================= */
(function () {
  'use strict';

  const CONFIG = {
    svgPath: 'assets/characters.svg',
    timings: {
      reaction:     900,
      moveTogether: 1300,
      hugHold:      1500,
      hugSettle:    900,
      kissApproach: 700,
      kissHold:     800,
      kissSeparate: 700,
      returnToIdle: 1200
    }
  };

  const state = {
    loaded: false,
    current: 'idle',
    sequenceRunning: false,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  const stage   = document.getElementById('brCharStage');
  const wrapper = document.getElementById('charSvgWrap');
  const blinkTimers = {};

  const wait = ms => new Promise(r => setTimeout(r, ms));

  function setStateAttr(name) {
    state.current = name;
    if (stage) stage.setAttribute('data-state', name);
  }

  /* ---------- Load SVG ---------- */
  async function loadSvg() {
    const res = await fetch(CONFIG.svgPath);
    if (!res.ok) throw new Error('Failed to load ' + CONFIG.svgPath);
    const text = await res.text();
    wrapper.innerHTML = text;
    const svg = wrapper.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width  = '100%';
      svg.style.height = '100%';
    }
  }

  /* ---------- Blinking ---------- */
  function scheduleBlink(id, eyeLeftSel, eyeRightSel, interval) {
    if (state.reducedMotion) return;
    const leftEye  = document.querySelector(eyeLeftSel);
    const rightEye = document.querySelector(eyeRightSel);
    if (!leftEye || !rightEye) return;

    function doBlink() {
      leftEye.classList.add('blinking-eye');
      rightEye.classList.add('blinking-eye');
      void leftEye.offsetWidth;
      setTimeout(() => {
        leftEye.classList.remove('blinking-eye');
        rightEye.classList.remove('blinking-eye');
      }, 220);
      blinkTimers[id] = setTimeout(doBlink, interval + Math.random() * 3000);
    }
    blinkTimers[id] = setTimeout(doBlink, 1500 + Math.random() * 2000);
  }

  function stopAllBlinks() {
    Object.keys(blinkTimers).forEach(id => {
      clearTimeout(blinkTimers[id]);
      delete blinkTimers[id];
    });
    ['#boy-left-eye','#boy-right-eye','#girl-left-eye','#girl-right-eye'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.classList.remove('blinking-eye');
    });
  }

  function startBlinks() {
    stopAllBlinks();
    scheduleBlink('boy',  '#boy-left-eye',  '#boy-right-eye',  3500);
    scheduleBlink('girl', '#girl-left-eye', '#girl-right-eye', 4200);
  }

  /* ---------- State functions ---------- */
  function clearAllTransforms() {
    ['#boy-head','#boy-left-arm','#boy-right-arm',
     '#girl-head','#girl-left-arm','#girl-right-arm','#girl-glasses',
     '#boy-group','#girl-group'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.transform = ''; });
    });
  }

  function playIdle() {
    state.sequenceRunning = false;
    clearAllTransforms();
    setStateAttr('idle');
    startBlinks();
  }

  async function playReaction() {
    stopAllBlinks();
    setStateAttr('reaction');
    return wait(CONFIG.timings.reaction);
  }

  async function playMoveTogether() {
    stopAllBlinks();
    setStateAttr('move-together');
    return wait(CONFIG.timings.moveTogether);
  }

  async function playHug() {
    setStateAttr('hug');
    return wait(CONFIG.timings.hugSettle + CONFIG.timings.hugHold);
  }

  async function playKiss() {
    setStateAttr('kiss');
    await wait(CONFIG.timings.kissApproach + CONFIG.timings.kissHold);
    return wait(CONFIG.timings.kissSeparate);
  }

  async function returnToIdle() {
    setStateAttr('idle');
    return wait(CONFIG.timings.returnToIdle).then(() => playIdle());
  }

  async function startCelebration() {
    if (state.sequenceRunning) return;
    state.sequenceRunning = true;
    try {
      await playReaction();
      if (!state.sequenceRunning) return;
      await playMoveTogether();
      if (!state.sequenceRunning) return;
      await playHug();
      if (!state.sequenceRunning) return;
      await playKiss();
      if (!state.sequenceRunning) return;
      state.sequenceRunning = false;
      await returnToIdle();
    } finally {
      state.sequenceRunning = false;
    }
  }

  /* ---------- Init ---------- */
  async function init() {
    try {
      await loadSvg();
      state.loaded = true;
      playIdle();
    } catch (err) {
      console.error('[CharacterAnimation] init failed:', err);
    }
  }

  /* ---------- Public API ---------- */
  window.CharacterAnimation = {
    startCelebration, playIdle, playReaction,
    playMoveTogether, playHug, playKiss, returnToIdle,
    state
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
