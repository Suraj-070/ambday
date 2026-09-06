/* =========================================================
   Character Animation Demo — script.js
   Vanilla JS state machine that drives the two SVG characters
   through: idle → reaction → move-together → hug → kiss → idle
   ========================================================= */

(function () {
  'use strict';

  /* ---------- Configuration ---------- */
  const CONFIG = {
    svgPaths: { boy: 'assets/boy.svg', girl: 'assets/girl.svg' },
    // Sequence timings (ms). Tuned to feel natural but not slow.
    timings: {
      reaction:     900,
      moveTogether: 1300,
      hugHold:      1500,
      hugSettle:    900,
      kissApproach: 700,
      kissHold:     600,
      kissSeparate: 700,
      returnToIdle: 1200
    }
  };

  /* ---------- State ---------- */
  const state = {
    loaded: { boy: false, girl: false },
    current: 'idle',          // current animation state
    sequenceRunning: false,   // is FULL SEQUENCE playing?
    sequenceTimers: [],       // pending setTimeout ids, for cancellation
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  /* ---------- DOM refs ---------- */
  const stage    = document.getElementById('brCharStage');
  const boyEl    = document.getElementById('boyCharacter');
  const girlEl   = document.getElementById('girlCharacter');
  const statusEl = null;
  const buttons  = [];

  /* ---------- Utility ---------- */
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setStateAttr(name) {
    state.current = name;
    if (stage) stage.setAttribute('data-state', name);
  }

  function highlightButton(action) {
    buttons.forEach(b => b.classList.toggle('is-active', b.dataset.action === action));
  }

  function clearPendingTimers() {
    state.sequenceTimers.forEach(id => clearTimeout(id));
    state.sequenceTimers = [];
  }

  function trackTimer(p) {
    state.sequenceTimers.push(p);
  }

  /* ---------- SVG loading ---------- */
  // We fetch the SVG as text and inline it so we have full DOM access
  // to the inner #boy-left-arm etc. groups for transforms.
  async function loadSvg(characterEl, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load ' + url);
    const text = await res.text();
    const inner = characterEl.querySelector('.character__inner');
    inner.innerHTML = text;
    // Make sure the inlined svg fills the wrapper
    const svg = inner.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = '100%';
    }
  }

  /* ---------- Blinking (independent of state) ---------- */
  // Blinking is implemented via a CSS class on each eye group.
  // To make blinks happen at slightly different intervals per character,
  // we use JS to randomly schedule them rather than relying purely on CSS.
  const blinkTimers = { boy: null, girl: null };

  function scheduleBlink(character) {
    if (state.reducedMotion) return;
    const eyeLeft  = document.querySelector(`#boy-${character === 'boy' ? 'left' : 'left'}-eye, #girl-left-eye`);
    // The above querySelector is messy; simpler approach below.
    const root = character === 'boy' ? boyEl : girlEl;
    const leftEye  = root.querySelector('#boy-left-eye,  #girl-left-eye');
    const rightEye = root.querySelector('#boy-right-eye, #girl-right-eye');
    if (!leftEye || !rightEye) return;

    function doBlink() {
      leftEye.classList.add('blinking-eye');
      rightEye.classList.add('blinking-eye');
      // Force a reflow so the animation restarts.
      void leftEye.offsetWidth;
      // Remove the class after the blink completes so it can be re-triggered.
      const removeMs = 220;
      setTimeout(() => {
        leftEye.classList.remove('blinking-eye');
        rightEye.classList.remove('blinking-eye');
      }, removeMs);

      // Schedule the next blink with a random interval (3.5–7s)
      const next = 3500 + Math.random() * 3500;
      blinkTimers[character] = setTimeout(doBlink, next);
    }
    // First blink happens after a short random delay
    blinkTimers[character] = setTimeout(doBlink, 1500 + Math.random() * 2000);
  }

  function stopBlinking(character) {
    if (blinkTimers[character]) {
      clearTimeout(blinkTimers[character]);
      blinkTimers[character] = null;
    }
    const root = character === 'boy' ? boyEl : girlEl;
    const leftEye  = root.querySelector('#boy-left-eye,  #girl-left-eye');
    const rightEye = root.querySelector('#boy-right-eye, #girl-right-eye');
    if (leftEye)  leftEye.classList.remove('blinking-eye');
    if (rightEye) rightEye.classList.remove('blinking-eye');
  }

  /* ---------- Public API: state functions ---------- */

  /** Reset characters to their starting positions with no animations. */
  function resetCharacters() {
    clearPendingTimers();
    state.sequenceRunning = false;
    stopBlinking('boy');
    stopBlinking('girl');

    // Clear all inline transforms on animated groups
    clearAllTransforms();

    // Snap to idle visual state but no breathing/blink
    setStateAttr('idle');
    setStatus('RESET');
    highlightButton('');
    // Note: we do NOT schedule blinks here — call playIdle() for that.
  }

  /** Start idle: breathing, blinking, subtle sway. */
  function playIdle() {
    clearPendingTimers();
    state.sequenceRunning = false;

    clearAllTransforms();
    setStateAttr('idle');
    setStatus('IDLE');
    highlightButton('idle');

    // Restart blinks
    stopBlinking('boy');
    stopBlinking('girl');
    scheduleBlink('boy');
    scheduleBlink('girl');
  }

  /** Reaction: both turn toward each other briefly. */
  function playReaction() {
    clearPendingTimers();
    // Note: do NOT reset state.sequenceRunning here — this function is called
    // both standalone and as part of the full sequence.
    stopBlinking('boy');
    stopBlinking('girl');

    setStateAttr('reaction');
    setStatus('REACTION');
    highlightButton('reaction');

    // Reaction is brief — auto-return to idle after the timing window
    // unless a sequence is running (sequence calls handle their own flow).
    return wait(CONFIG.timings.reaction);
  }

  /** Move both characters toward center. */
  function playMoveTogether() {
    stopBlinking('boy');
    stopBlinking('girl');

    setStateAttr('move-together');
    setStatus('MOVE TOGETHER');
    highlightButton('moveTogether');

    return wait(CONFIG.timings.moveTogether);
  }

  /** Hug: characters lean in, arms wrap, hold. */
  function playHug() {
    // playHug assumes characters are already close (after playMoveTogether)
    // If called standalone, we set the state directly.
    setStateAttr('hug');
    setStatus('HUG');
    highlightButton('hug');

    return wait(CONFIG.timings.hugSettle + CONFIG.timings.hugHold);
  }

  /** Kiss: subtle lean, brief contact, separate. */
  async function playKiss() {
    setStateAttr('kiss');
    setStatus('KISS');
    highlightButton('kiss');

    await wait(CONFIG.timings.kissApproach);
    // hold the kiss briefly
    await wait(CONFIG.timings.kissHold);
    // separate (visual handled by transition back to idle in returnToIdle)
    return wait(CONFIG.timings.kissSeparate);
  }

  /** Return to idle positions. */
  function returnToIdle() {
    setStateAttr('idle');
    setStatus('RETURN TO IDLE');
    highlightButton('');

    return wait(CONFIG.timings.returnToIdle).then(() => {
      // Re-enable blinking & breathing
      playIdle();
    });
  }

  /** Full celebration sequence: reaction → move → hug → kiss → idle. */
  async function startCelebration() {
    if (state.sequenceRunning) return;
    state.sequenceRunning = true;
    clearPendingTimers();

    try {
      setStatus('FULL SEQUENCE');

      // 1. Reaction
      await playReaction();
      if (!state.sequenceRunning) return;

      // 2. Move together
      await playMoveTogether();
      if (!state.sequenceRunning) return;

      // 3. Hug
      await playHug();
      if (!state.sequenceRunning) return;

      // 4. Kiss
      await playKiss();
      if (!state.sequenceRunning) return;

      // 5. Return to idle
      state.sequenceRunning = false;
      await returnToIdle();
    } finally {
      state.sequenceRunning = false;
    }
  }

  /* ---------- Internal helpers ---------- */

  function clearAllTransforms() {
    // Remove any inline transform set by JS (CSS state attrs will drive the visual)
    const groups = [
      '#boy-head', '#girl-head',
      '#boy-left-arm', '#boy-right-arm',
      '#girl-left-arm', '#girl-right-arm',
      '#boy-left-hand', '#boy-right-hand',
      '#girl-left-hand', '#girl-right-hand',
      '#girl-hair-back', '#girl-hair-front',
      '#girl-glasses'
    ];
    groups.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.transform = '';
      });
    });
    // Reset character__inner inline transform
    [boyEl, girlEl].forEach(el => {
      const inner = el.querySelector('.character__inner');
      if (inner) inner.style.transform = '';
    });
  }

  /* ---------- Button wiring ---------- */
  function wireControls() {
    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        // Don't start a new action if a sequence is running (except RESET which cancels)
        if (state.sequenceRunning && action !== 'reset') return;

        // For individual (non-sequence) actions, don't disable buttons — just run the action.
        // The state machine handles transitions cleanly.
        try {
          switch (action) {
            case 'reset':         resetCharacters(); break;
            case 'idle':          playIdle(); break;
            case 'reaction':      await playReaction(); break;
            case 'moveTogether':  await playMoveTogether(); break;
            case 'hug':           await playHug(); break;
            case 'kiss':          await playKiss(); break;
            case 'fullSequence':  await startCelebration(); break;
          }
        } catch (err) {
          console.error('[CharacterAnimation] action error:', err);
        }
      });
    });
  }

  /* ---------- Init ---------- */
  async function init() {
    try {
      await Promise.all([
        loadSvg(boyEl,  CONFIG.svgPaths.boy),
        loadSvg(girlEl, CONFIG.svgPaths.girl)
      ]);
      state.loaded.boy = true;
      state.loaded.girl = true;

      wireControls();

      // Start in idle
      playIdle();
    } catch (err) {
      console.error('[CharacterAnimation] init failed:', err);
      setStatus('LOAD ERROR');
    }
  }

  /* ---------- Public API on window ---------- */
  // The host website can call these directly.
  window.CharacterAnimation = {
    startCelebration,
    resetCharacters,
    playReaction,
    playMoveTogether,
    playHug,
    playKiss,
    returnToIdle,
    playIdle,
    // Expose for debugging
    state: state
  };

  // Also expose top-level functions for the simplest possible integration:
  window.startCelebration  = startCelebration;
  window.resetCharacters    = resetCharacters;
  window.playReaction       = playReaction;
  window.playMoveTogether   = playMoveTogether;
  window.playHug            = playHug;
  window.playKiss           = playKiss;
  window.returnToIdle       = returnToIdle;
  window.playIdle           = playIdle;

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
