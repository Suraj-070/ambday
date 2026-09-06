/* =========================================================
   Character Animation — Birthday Room
   Side-by-side characters with emoji burst reactions
   ========================================================= */
(function () {
  'use strict';

  const CONFIG = {
    svgPath: 'assets/characters.svg',
    timings: {
      reaction:     800,
      moveTogether: 600,
      hugHold:      1800,
      hugSettle:    600,
      kissApproach: 600,
      kissHold:     1000,
      kissSeparate: 600,
      returnToIdle: 1000
    }
  };

  const EMOJIS = {
    reaction:    ['👀','💓','✨','💫'],
    hug:         ['🤗','💞','🥰','💕','🫂','💗','✨'],
    kiss:        ['💋','😘','💝','💖','💓','🌸','✨','💏']
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
    if (!res.ok) throw new Error('Failed: ' + CONFIG.svgPath);
    wrapper.innerHTML = await res.text();
    const svg = wrapper.querySelector('svg');
    if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.cssText = 'width:100%;height:100%'; }
  }

  /* ---------- Emoji burst ---------- */
  function burstEmojis(emojis, count) {
    if (state.reducedMotion || !stage) return;

    // Remove any existing burst
    const old = stage.querySelector('.br-emoji-burst');
    if (old) old.remove();

    const burst = document.createElement('div');
    burst.className = 'br-emoji-burst';
    stage.appendChild(burst);

    const cx = stage.offsetWidth  / 2;
    const cy = stage.offsetHeight / 2;

    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'br-burst-emoji';
      el.textContent = emojis[i % emojis.length];

      // Random spread from center
      const angle = (Math.random() * 360) * (Math.PI / 180);
      const r1 = 30  + Math.random() * 60;
      const r2 = 80  + Math.random() * 120;
      const r3 = 130 + Math.random() * 180;
      const rot1 = (Math.random() - 0.5) * 40;
      const rot2 = (Math.random() - 0.5) * 80;
      const rot3 = (Math.random() - 0.5) * 120;

      const startX = cx - 20 + (Math.random() - 0.5) * 60;
      const startY = cy - 20 + (Math.random() - 0.5) * 40;

      el.style.cssText = `
        left: ${startX}px;
        top:  ${startY}px;
        animation-delay: ${Math.random() * 400}ms;
        --tx1: ${Math.cos(angle) * r1}px;
        --ty1: ${Math.sin(angle) * r1 - 20}px;
        --tx2: ${Math.cos(angle) * r2}px;
        --ty2: ${Math.sin(angle) * r2 - 60}px;
        --tx3: ${Math.cos(angle) * r3}px;
        --ty3: ${Math.sin(angle) * r3 - 120}px;
        --rot1: ${rot1}deg;
        --rot2: ${rot2}deg;
        --rot3: ${rot3}deg;
      `;
      burst.appendChild(el);
    }

    // Remove after animation
    setTimeout(() => burst.remove(), 2200);
  }

  /* ---------- Blinking ---------- */
  function scheduleBlink(id, leftSel, rightSel, interval) {
    if (state.reducedMotion) return;
    const L = document.querySelector(leftSel);
    const R = document.querySelector(rightSel);
    if (!L || !R) return;
    function doBlink() {
      L.classList.add('blinking-eye'); R.classList.add('blinking-eye');
      void L.offsetWidth;
      setTimeout(() => { L.classList.remove('blinking-eye'); R.classList.remove('blinking-eye'); }, 220);
      blinkTimers[id] = setTimeout(doBlink, interval + Math.random() * 3000);
    }
    blinkTimers[id] = setTimeout(doBlink, 1500 + Math.random() * 2000);
  }

  function stopAllBlinks() {
    Object.keys(blinkTimers).forEach(id => { clearTimeout(blinkTimers[id]); delete blinkTimers[id]; });
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
  function playIdle() {
    state.sequenceRunning = false;
    setStateAttr('idle');
    startBlinks();
  }

  async function playReaction() {
    stopAllBlinks();
    setStateAttr('reaction');
    burstEmojis(EMOJIS.reaction, 6);
    return wait(CONFIG.timings.reaction);
  }

  async function playMoveTogether() {
    setStateAttr('move-together');
    return wait(CONFIG.timings.moveTogether);
  }

  async function playHug() {
    setStateAttr('hug');
    burstEmojis(EMOJIS.hug, 10);
    return wait(CONFIG.timings.hugSettle + CONFIG.timings.hugHold);
  }

  async function playKiss() {
    setStateAttr('kiss');
    burstEmojis(EMOJIS.kiss, 12);
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
