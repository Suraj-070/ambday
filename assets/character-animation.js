/* =========================================================
   Character Animation — Two separate SVGs, emoji bursts
   ========================================================= */
(function () {
  'use strict';

  const CONFIG = {
    svgPaths: { boy: 'assets/boy.svg', girl: 'assets/girl.svg' },
    timings: {
      reaction: 900, moveTogether: 600,
      hugHold: 1800, hugSettle: 600,
      kissApproach: 600, kissHold: 1000,
      kissSeparate: 600, returnToIdle: 1000
    }
  };

  const EMOJIS = {
    reaction: ['👀','💓','✨','💫'],
    hug:      ['🤗','💞','🥰','💕','🫂','💗','✨'],
    kiss:     ['💋','😘','💝','💖','💓','🌸','✨','💏']
  };

  const state = {
    loaded: false, current: 'idle',
    sequenceRunning: false,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  const stage   = document.getElementById('brCharStage');
  const boyEl   = document.getElementById('boyCharacter');
  const girlEl  = document.getElementById('girlCharacter');
  const blinkTimers = {};
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function setStateAttr(name) {
    state.current = name;
    if (stage) stage.setAttribute('data-state', name);
  }

  /* ---------- Load SVGs ---------- */
  async function loadSvg(el, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed: ' + url);
    const inner = el.querySelector('.character__inner');
    inner.innerHTML = await res.text();
    const svg = inner.querySelector('svg');
    if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.cssText = 'width:100%;height:100%;display:block;overflow:visible'; }
  }

  /* ---------- Emoji burst ---------- */
  function burstEmojis(emojis, count) {
    if (state.reducedMotion || !stage) return;
    const old = stage.querySelector('.br-emoji-burst');
    if (old) old.remove();
    const burst = document.createElement('div');
    burst.className = 'br-emoji-burst';
    stage.appendChild(burst);
    const cx = stage.offsetWidth / 2;
    const cy = stage.offsetHeight / 2;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'br-burst-emoji';
      el.textContent = emojis[i % emojis.length];
      const angle = (Math.random() * 360) * (Math.PI / 180);
      const r1 = 30  + Math.random() * 50;
      const r2 = 80  + Math.random() * 100;
      const r3 = 130 + Math.random() * 150;
      const rot = () => (Math.random() - 0.5) * 120;
      el.style.cssText = `
        left:${cx - 16 + (Math.random()-0.5)*40}px;
        top:${cy - 16 + (Math.random()-0.5)*30}px;
        animation-delay:${Math.random()*350}ms;
        --tx1:${Math.cos(angle)*r1}px; --ty1:${Math.sin(angle)*r1-20}px;
        --tx2:${Math.cos(angle)*r2}px; --ty2:${Math.sin(angle)*r2-60}px;
        --tx3:${Math.cos(angle)*r3}px; --ty3:${Math.sin(angle)*r3-110}px;
        --rot1:${rot()}deg; --rot2:${rot()}deg; --rot3:${rot()}deg;
      `;
      burst.appendChild(el);
    }
    setTimeout(() => burst.remove(), 2200);
  }

  /* ---------- Blinking ---------- */
  function scheduleBlink(id, leftSel, rightSel, ms) {
    if (state.reducedMotion) return;
    const L = document.querySelector(leftSel);
    const R = document.querySelector(rightSel);
    if (!L || !R) return;
    function doBlink() {
      L.classList.add('blinking-eye'); R.classList.add('blinking-eye');
      void L.offsetWidth;
      setTimeout(() => { L.classList.remove('blinking-eye'); R.classList.remove('blinking-eye'); }, 220);
      blinkTimers[id] = setTimeout(doBlink, ms + Math.random() * 3000);
    }
    blinkTimers[id] = setTimeout(doBlink, 1500 + Math.random() * 2000);
  }

  function stopAllBlinks() {
    Object.keys(blinkTimers).forEach(id => { clearTimeout(blinkTimers[id]); delete blinkTimers[id]; });
    ['#boy-left-eye','#boy-right-eye','#girl-left-eye','#girl-right-eye'].forEach(sel => {
      document.querySelector(sel)?.classList.remove('blinking-eye');
    });
  }

  function startBlinks() {
    stopAllBlinks();
    scheduleBlink('boy',  '#boy-left-eye',  '#boy-right-eye',  3500);
    scheduleBlink('girl', '#girl-left-eye', '#girl-right-eye', 4200);
  }

  /* ---------- States ---------- */
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
      await playReaction(); if (!state.sequenceRunning) return;
      await playMoveTogether(); if (!state.sequenceRunning) return;
      await playHug(); if (!state.sequenceRunning) return;
      await playKiss(); if (!state.sequenceRunning) return;
      state.sequenceRunning = false;
      await returnToIdle();
    } finally { state.sequenceRunning = false; }
  }

  /* ---------- Init ---------- */
  async function init() {
    try {
      await Promise.all([
        loadSvg(boyEl,  CONFIG.svgPaths.boy),
        loadSvg(girlEl, CONFIG.svgPaths.girl)
      ]);
      state.loaded = true;
      playIdle();
    } catch(err) { console.error('[CharacterAnimation]', err); }
  }

  window.CharacterAnimation = { startCelebration, playIdle, playReaction, playMoveTogether, playHug, playKiss, returnToIdle, state };

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
