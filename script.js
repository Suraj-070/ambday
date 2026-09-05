/* ============================================================
   FOR YOU — scrapbook interactions
   Vanilla JS, no dependencies.
   ============================================================ */
(() => {
'use strict';

const PRM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

/* Expose to other scripts (e.g. birthday-room.js) loaded after this one.
   These remain private to this IIFE for backwards compatibility but are
   also reachable via window.AMB for new modules that want to reuse them. */
window.AMB = { AudioManager: null, PRM, $, $$, getScrapbook: () => $('#scrapbook') };

/* ============================================================
   1. AudioManager — singleton so only one audio is ever audible
   ============================================================ */
const AudioManager = {
  active: null,
  muted: false,
  prevVolume: 1,
  _fadeAnims: new Map(), // el -> animationFrameId, so we can cancel overlapping fades

  play(el) {
    if (this.active && this.active !== el) {
      try { this.active.pause(); } catch(e) {}
    }
    this.active = el;
    el.muted = this.muted;
    const p = el.play();
    if (p && p.catch) p.catch(() => {/* autoplay may still be blocked */});
  },

  pause(el) {
    if (el && !el.paused) el.pause();
    if (this.active === el) this.active = null;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.active) this.active.muted = this.muted;
    return this.muted;
  },

  /* ---- New: fade helpers (used by the birthday room) ----
     These gracefully fade volume while preserving the original volume target.
     They don't break existing code because nothing else calls them. */
  _cancelFade(el) {
    if (this._fadeAnims.has(el)) {
      cancelAnimationFrame(this._fadeAnims.get(el));
      this._fadeAnims.delete(el);
    }
  },

  /* Fade `el` to `targetVol` over `ms` milliseconds. Optionally call `onDone`. */
  fadeTo(el, targetVol, ms = 600, onDone) {
    if (!el) return;
    if (PRM) {
      // Reduced motion: instant
      el.volume = targetVol;
      if (onDone) onDone();
      return;
    }
    this._cancelFade(el);
    const startVol = el.volume;
    const target = Math.max(0, Math.min(1, targetVol));
    if (startVol === target) { if (onDone) onDone(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      // easeInOutQuad
      const e = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
      el.volume = startVol + (target - startVol) * e;
      if (t < 1) {
        this._fadeAnims.set(el, requestAnimationFrame(step));
      } else {
        this._fadeAnims.delete(el);
        el.volume = target;
        if (onDone) onDone();
      }
    };
    this._fadeAnims.set(el, requestAnimationFrame(step));
  },

  /* Crossfade from `fromEl` to `toEl` over `ms`. Plays `toEl` then fades. */
  crossfade(fromEl, toEl, ms = 800) {
    if (!toEl) return;
    if (fromEl && fromEl !== toEl) {
      this.fadeTo(fromEl, 0, ms, () => {
        try { fromEl.pause(); } catch(e) {}
      });
    }
    toEl.volume = 0;
    this.play(toEl);
    this.fadeTo(toEl, this.muted ? 0 : 0.7, ms);
  }
};

/* ============================================================
   2. Lock screen
   ============================================================ */
// PIN stored as char codes to avoid plaintext in source inspection
const PASSWORD = [54,57,54,57].map(c=>String.fromCharCode(c)).join('');
/* ============================================================
   ★ CONFIG — update these before sending ★
   ============================================================ */
const CONFIG = {
  // The date you started together — shown in the "days with you" counter
  SINCE_DATE: new Date(2022, 5, 14),  // year, month (0-indexed), day
};
/* ============================================================ */

const SESSION_KEY = 'scrapbook_unlocked_v1';

const lockScreen  = $('#lock-screen');
const lockInput   = $('#lockInput');
const unlockBtn   = $('#unlockBtn');
const lockCard    = $('#lockCard');
const soundToggle = $('#soundToggle');
const daysWidget  = $('#daysWidget');
const scrapbook   = $('#scrapbook');
const bgAudio     = $('#bgAudio');

let unlocked = false;

function focusLockInput() {
  if (lockInput && !unlocked) {
    setTimeout(() => { try { lockInput.focus(); } catch(e){} }, 50);
  }
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  sessionStorage.setItem(SESSION_KEY, '1');

  // 1. Fade out lock screen
  lockScreen.classList.add('unlocked');

  // 2. Show surprise reveal overlay immediately
  const sr = $('#surpriseReveal');
  sr.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sr.classList.add('show')));

  // 3. Start preloading audio now (user gesture is active)
  bgAudio.preload = 'auto';
  bgAudio.volume = 0;
  bgAudio.load();

  // 4. Wait for audio buffered enough OR 3.5s timeout — whichever first
  //    Then fade reveal out and open scrapbook
  let revealed = false;
  function doReveal() {
    if (revealed) return;
    revealed = true;

    // play audio with fade
    try {
      AudioManager.play(bgAudio);
      AudioManager.fadeTo(bgAudio, 0.45, 1400);
    } catch(e) {}

    sr.classList.add('fade-out');
    setTimeout(() => {
      sr.hidden = true;
      sr.classList.remove('show', 'fade-out');
      scrapbook.setAttribute('aria-hidden', 'false');
      soundToggle.hidden = false;
      daysWidget.hidden = false;
      observeReveals();
      focusFirstVisible();
      if (lockScreen.parentNode) lockScreen.parentNode.removeChild(lockScreen);
    }, 900);
  }

  // Fire when enough audio is buffered
  bgAudio.addEventListener('canplaythrough', doReveal, { once: true });
  // Hard timeout fallback — don't keep her waiting forever
  setTimeout(doReveal, 3800);
}

function failUnlock() {
  lockScreen.classList.add('shake', 'wilting');
  lockInput.value = '';
  setTimeout(() => lockScreen.classList.remove('shake', 'wilting'), 750);
  focusLockInput();
}

function tryUnlock() {
  if (lockInput.value === PASSWORD) {
    unlock();
  } else {
    failUnlock();
  }
}

unlockBtn.addEventListener('click', tryUnlock);
lockInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlock();
});
lockInput.addEventListener('input', () => {
  // auto-submit when 4 digits entered
  if (lockInput.value.length === 4) {
    setTimeout(tryUnlock, 120);
  }
});

/* If already unlocked in this session, skip the lock */
if (sessionStorage.getItem(SESSION_KEY) === '1') {
  // unlock immediately without animation
  unlocked = true;
  lockScreen.style.transition = 'none';
  lockScreen.style.opacity = '0';
  lockScreen.style.visibility = 'hidden';
  scrapbook.setAttribute('aria-hidden', 'false');
  soundToggle.hidden = false;
  daysWidget.hidden = false;
  if (lockScreen.parentNode) lockScreen.parentNode.removeChild(lockScreen);
  // Note: we don't autoplay audio here — needs user gesture. Will start on first toggle/click.
} else {
  focusLockInput();
}

/* ============================================================
   3. Sound toggle (persistent)
   ============================================================ */
soundToggle.addEventListener('click', () => {
  const muted = AudioManager.toggleMute();
  soundToggle.setAttribute('aria-pressed', String(!muted));
  // If nothing was playing yet (session-restored case), try to start ambient
  if (!AudioManager.active && !muted) {
    try { bgAudio.volume = 0.45; AudioManager.play(bgAudio); } catch(e) {}
  }
});

/* ============================================================
   4. Days widget — running counter since a date
   * EDIT THIS DATE — set to the day you started dating (YYYY, M-1, D)
   ============================================================ */
const SINCE_DATE = CONFIG.SINCE_DATE;
function updateDaysWidget() {
  if (!daysWidget.hidden) {
    const now = new Date();
    const days = Math.max(0, Math.floor((now - SINCE_DATE) / 86400000));
    $('#daysNum').textContent = String(days);
  }
}
updateDaysWidget();
setInterval(updateDaysWidget, 60_000);

/* ============================================================
   5. Reveal-on-scroll (IntersectionObserver)
   ============================================================ */
let revealObserver = null;
function observeReveals() {
  if (revealObserver) return;
  if (!('IntersectionObserver' in window)) {
    $$('.reveal').forEach(el => el.classList.add('is-visible'));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const idx = Array.from(el.parentNode.children).filter(c => c.classList.contains('reveal')).indexOf(el);
        const delay = PRM ? 0 : Math.min(idx, 4) * 80;
        setTimeout(() => el.classList.add('is-visible'), delay);
        revealObserver.unobserve(el);
      }
    });
  }, { threshold: 0.18, root: scrapbook });
  $$('.reveal').forEach(el => revealObserver.observe(el));
}
// Observe immediately for any custom section already in viewport
if (unlocked) observeReveals();

/* Mark images as loaded to remove skeleton shimmer */
$$('.page-img').forEach(img => {
  if (img.complete) {
    img.classList.add('loaded');
  } else {
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  }
});

function focusFirstVisible() {
  // Move focus into the page so keyboard users aren't stuck on a removed button
  setTimeout(() => {
    const firstPage = $('.page-snap');
    if (firstPage) firstPage.setAttribute('tabindex', '-1');
    if (firstPage) try { firstPage.focus({ preventScroll: true }); } catch(e) {}
  }, 100);
}

/* ============================================================
   6. Music player module
   ============================================================ */
const playlist = [
  { title: 'I Like Me Better', artist: '— for the late drives home', src: 'assets/audio/track1.mp3' },
  // add more songs here
];

const trackAudio   = $('#trackAudio');
const playBtn      = $('#playBtn');
const iconPlay     = $('.icon-play', playBtn);
const iconPause    = $('.icon-pause', playBtn);
const prevBtn      = $('#prevBtn');
const nextBtn      = $('#nextBtn');
const repeatBtn    = $('#repeatBtn');
const trackTitle   = $('#trackTitle');
const trackArtist  = $('#trackArtist');
const curTime      = $('#curTime');
const durTime      = $('#durTime');
const scrubTrack   = $('#scrubTrack');
const scrubFill    = $('#scrubFill');
const scrubThumb   = $('#scrubThumb');
const playerCard   = $('.player-card');

let trackIndex = 0;
let repeatOne = false;

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function loadTrack(i) {
  if (!playlist.length) return;
  trackIndex = (i + playlist.length) % playlist.length;
  const t = playlist[trackIndex];
  trackAudio.src = t.src;
  trackTitle.textContent = t.title;
  trackArtist.textContent = t.artist || '';
  scrubFill.style.width = '0%';
  scrubThumb.style.left = '0%';
  curTime.textContent = '0:00';
  durTime.textContent = '0:00';
}
loadTrack(0);

function setPlayingUI(isPlaying) {
  if (isPlaying) {
    iconPlay.hidden = true;
    iconPause.hidden = false;
    playBtn.setAttribute('aria-label', 'Pause');
    playerCard.classList.add('playing');
  } else {
    iconPlay.hidden = false;
    iconPause.hidden = true;
    playBtn.setAttribute('aria-label', 'Play');
    playerCard.classList.remove('playing');
  }
}

function playTrack() {
  if (!playlist.length) return;
  // Spec: pressing play here pauses the background ambient track.
  AudioManager.play(trackAudio);
  setPlayingUI(true);
}

function pauseTrack() {
  AudioManager.pause(trackAudio);
  setPlayingUI(false);
}

playBtn.addEventListener('click', () => {
  if (trackAudio.paused) playTrack();
  else pauseTrack();
});

prevBtn.addEventListener('click', () => {
  loadTrack(trackIndex - 1);
  playTrack();
});
nextBtn.addEventListener('click', () => {
  loadTrack(trackIndex + 1);
  playTrack();
});
repeatBtn.addEventListener('click', () => {
  repeatOne = !repeatOne;
  repeatBtn.setAttribute('aria-pressed', String(repeatOne));
});

trackAudio.addEventListener('timeupdate', () => {
  if (!trackAudio.duration) return;
  const pct = (trackAudio.currentTime / trackAudio.duration) * 100;
  scrubFill.style.width = pct + '%';
  scrubThumb.style.left = pct + '%';
  curTime.textContent = fmtTime(trackAudio.currentTime);
});
trackAudio.addEventListener('loadedmetadata', () => {
  durTime.textContent = fmtTime(trackAudio.duration);
});
trackAudio.addEventListener('ended', () => {
  if (repeatOne) {
    trackAudio.currentTime = 0;
    playTrack();
  } else {
    loadTrack(trackIndex + 1);
    playTrack();
  }
});

// Scrubber click / drag
let scrubbing = false;
function seekFromEvent(e) {
  const rect = scrubTrack.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  if (trackAudio.duration) {
    trackAudio.currentTime = pct * trackAudio.duration;
    scrubFill.style.width = (pct * 100) + '%';
    scrubThumb.style.left = (pct * 100) + '%';
  }
}
scrubTrack.addEventListener('mousedown', (e) => {
  scrubbing = true;
  seekFromEvent(e);
});
window.addEventListener('mousemove', (e) => { if (scrubbing) seekFromEvent(e); });
window.addEventListener('mouseup', () => { scrubbing = false; });
scrubTrack.addEventListener('touchstart', (e) => {
  scrubbing = true;
  seekFromEvent(e);
}, { passive: true });
scrubTrack.addEventListener('touchmove', (e) => { if (scrubbing) seekFromEvent(e); }, { passive: true });
scrubTrack.addEventListener('touchend', () => { scrubbing = false; });
scrubTrack.addEventListener('keydown', (e) => {
  if (!trackAudio.duration) return;
  if (e.key === 'ArrowLeft')  { trackAudio.currentTime = Math.max(0, trackAudio.currentTime - 5); e.preventDefault(); }
  if (e.key === 'ArrowRight') { trackAudio.currentTime = Math.min(trackAudio.duration, trackAudio.currentTime + 5); e.preventDefault(); }
});

/* ============================================================
   7. Sliding puzzle
   ============================================================ */
const GRID = 3;
const SOLVED = [1,2,3,4,5,6,7,8,0];          // 0 = blank
const LETTERS = ['I','L','O','V','E','Y','O','U','♡'];  // final reveal per position

const puzzleGrid   = $('#puzzleGrid');
const shuffleBtn   = $('#shuffleBtn');
const puzzleSolve  = $('#puzzleSolve');
const keepReadingBtn = $('#keepReadingBtn');

let board = SOLVED.slice();
let solved = false;

function idxOfBlank() { return board.indexOf(0); }

function neighborsOf(i) {
  const r = Math.floor(i / GRID), c = i % GRID;
  const out = [];
  if (r > 0)         out.push(i - GRID);
  if (r < GRID - 1)   out.push(i + GRID);
  if (c > 0)          out.push(i - 1);
  if (c < GRID - 1)   out.push(i + 1);
  return out;
}

// Solvable shuffle: do N random valid slides from the solved state.
function solvableShuffle(steps = 80) {
  board = SOLVED.slice();
  let prevBlank = -1;
  for (let s = 0; s < steps; s++) {
    const b = idxOfBlank();
    let opts = neighborsOf(b).filter(n => n !== prevBlank);
    if (!opts.length) opts = neighborsOf(b);
    const pick = opts[Math.floor(Math.random() * opts.length)];
    // swap
    [board[b], board[pick]] = [board[pick], board[b]];
    prevBlank = b;
  }
  // Guard against accidental solve
  if (isSolved()) solvableShuffle(steps);
}

function isSolved() {
  for (let i = 0; i < 8; i++) if (board[i] !== i + 1) return false;
  return board[8] === 0;
}

function renderTiles() {
  puzzleGrid.innerHTML = '';
  board.forEach((val, i) => {
    const tile = document.createElement('button');
    tile.className = 'tile' + (val === 0 ? ' blank' : '');
    tile.type = 'button';
    tile.dataset.idx = String(i);
    tile.dataset.val  = String(val);
    tile.textContent = val === 0 ? '' : String(val);
    tile.setAttribute('aria-label',
      val === 0 ? 'empty' : `tile ${val}, position ${i + 1}`);
    tile.setAttribute('tabindex', isTileFocusable(i) ? '0' : '-1');
    puzzleGrid.appendChild(tile);
  });
}

function isTileFocusable(i) {
  // Focusable if it's adjacent to the blank OR not blank
  // Simpler: focusable if not blank and adjacent to blank
  if (board[i] === 0) return false;
  return neighborsOf(idxOfBlank()).includes(i);
}

function updateFocusability() {
  $$('.tile', puzzleGrid).forEach((t, i) => {
    t.setAttribute('tabindex', isTileFocusable(i) ? '0' : '-1');
  });
}

function moveTile(i) {
  if (solved) return false;
  const b = idxOfBlank();
  if (!neighborsOf(b).includes(i)) return false;
  [board[b], board[i]] = [board[i], board[b]];
  renderTiles();
  if (isSolved()) onSolved();
  return true;
}

puzzleGrid.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t || t.classList.contains('blank')) return;
  const i = Number(t.dataset.idx);
  if (moveTile(i)) updateFocusability();
});

// Keyboard: arrow keys move the tile FROM the direction into the blank
puzzleGrid.addEventListener('keydown', (e) => {
  if (solved) return;
  const b = idxOfBlank();
  const r = Math.floor(b / GRID), c = b % GRID;
  let target = -1;
  switch (e.key) {
    case 'ArrowUp':    if (r < GRID - 1) target = b + GRID; break;
    case 'ArrowDown':  if (r > 0)        target = b - GRID; break;
    case 'ArrowLeft':   if (c < GRID - 1) target = b + 1;   break;
    case 'ArrowRight':  if (c > 0)        target = b - 1;   break;
    case 'Enter':
    case ' ':
      // Activate focused tile
      if (document.activeElement && document.activeElement.classList.contains('tile')) {
        const i = Number(document.activeElement.dataset.idx);
        if (moveTile(i)) updateFocusability();
      }
      e.preventDefault();
      return;
  }
  if (target >= 0) {
    if (moveTile(target)) {
      e.preventDefault();
      updateFocusability();
      // Move focus to the newly-adjacent tile
      setTimeout(() => {
        const tile = puzzleGrid.querySelector(`.tile[data-idx="${target}"]`);
        if (tile) try { tile.focus({ preventScroll: true }); } catch(_){}
      }, 0);
    }
  }
});

// Swipe support on mobile
let touchStart = null;
puzzleGrid.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, target: e.target.closest('.tile') };
}, { passive: true });
puzzleGrid.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const TH = 24;
  if (ax < TH && ay < TH) {
    // tap
    if (touchStart.target && !touchStart.target.classList.contains('blank')) {
      const i = Number(touchStart.target.dataset.idx);
      if (moveTile(i)) updateFocusability();
    }
  } else if (ax > ay) {
    // horizontal swipe → move the tile in that direction (relative to blank)
    const b = idxOfBlank();
    const c = b % GRID;
    if (dx > 0 && c > 0)        { if (moveTile(b - 1)) updateFocusability(); }
    else if (dx < 0 && c < GRID - 1) { if (moveTile(b + 1)) updateFocusability(); }
  } else {
    const b = idxOfBlank();
    const r = Math.floor(b / GRID);
    if (dy > 0 && r > 0)         { if (moveTile(b - GRID)) updateFocusability(); }
    else if (dy < 0 && r < GRID - 1) { if (moveTile(b + GRID)) updateFocusability(); }
  }
  touchStart = null;
}, { passive: true });

shuffleBtn.addEventListener('click', () => {
  solved = false;
  puzzleGrid.classList.remove('solved');
  puzzleSolve.hidden = true;
  solvableShuffle(80);
  renderTiles();
  updateFocusability();
});

function onSolved() {
  solved = true;
  // Replace each tile's text with the corresponding letter
  $$('.tile', puzzleGrid).forEach((tile, i) => {
    tile.textContent = LETTERS[i];
    tile.dataset.letter = LETTERS[i];
    // stagger the flip
    tile.style.animationDelay = (i * 60) + 'ms';
  });
  puzzleGrid.classList.add('solved');
  // Confetti burst
  burstHearts();
  // Show message panel
  setTimeout(() => {
    puzzleSolve.hidden = false;
    const btn = puzzleSolve.querySelector('button');
    if (btn) try { btn.focus({ preventScroll: true }); } catch(_){}
  }, PRM ? 100 : 900);
}

function burstHearts() {
  if (PRM) return;
  const rect = puzzleGrid.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#E8837A', '#E3AC3D', '#A5333F', '#22406B', '#BFD8F0'];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.setAttribute('aria-hidden', 'true');
    const ang = (Math.PI * 2 * i) / N + (Math.random() * 0.4 - 0.2);
    const dist = 80 + Math.random() * 120;
    const tx = Math.cos(ang) * dist;
    const ty = Math.sin(ang) * dist - 30;  // bias upward
    piece.style.left = cx + 'px';
    piece.style.top  = cy + 'px';
    piece.style.setProperty('--tx', tx + 'px');
    piece.style.setProperty('--ty', ty + 'px');
    piece.style.setProperty('--rot', (Math.random() * 360 - 180) + 'deg');
    piece.innerHTML = heartSVG(colors[i % colors.length], 14);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1300);
  }
}

function heartSVG(color, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}"><path d="M12 21s-7-4.5-9.5-9C.8 8.7 2.5 5 6 5c2 0 3.4 1.2 4 2.5C10.6 6.2 12 5 14 5c3.5 0 5.2 3.7 3.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>`;
}

keepReadingBtn.addEventListener('click', () => {
  const target = $('#final-screen');
  if (target) target.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
});

// Initial puzzle setup
solvableShuffle(80);
renderTiles();
updateFocusability();

/* ============================================================
   8. Video modal — focus trap + Escape close
   ============================================================ */
const videoModal   = $('#videoModal');
const modalClose   = $('#modalClose');
const revealVideo  = $('#revealVideo');
const openVideoBtn = $('#openVideoBtn');

let lastFocused = null;
let musicWasPlaying = false;

function openModal() {
  lastFocused = document.activeElement;
  videoModal.hidden = false;
  videoModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  scrapbook.style.overflow = 'hidden';

  // Pause music while modal is open
  if (AudioManager.active === trackAudio && !trackAudio.paused) {
    musicWasPlaying = true;
    pauseTrack();
  } else {
    musicWasPlaying = false;
  }

  // Focus close button
  setTimeout(() => { try { modalClose.focus(); } catch(_){} }, 50);

  // Trap focus
  document.addEventListener('keydown', trapKey);
}

function closeModal() {
  videoModal.hidden = true;
  videoModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  scrapbook.style.overflow = '';
  try { revealVideo.pause(); } catch(_){}
  // Resume music if it was playing before
  if (musicWasPlaying) {
    playTrack();
    musicWasPlaying = false;
  }
  document.removeEventListener('keydown', trapKey);
  if (lastFocused && lastFocused.focus) {
    try { lastFocused.focus({ preventScroll: true }); } catch(_){}
  }
}

function trapKey(e) {
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key !== 'Tab') return;

  const focusables = $$('button, a, [tabindex]:not([tabindex="-1"]), video', videoModal)
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

openVideoBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
$$('[data-close]', videoModal).forEach(el => el.addEventListener('click', closeModal));
// Stop propagation on the card so clicks inside don't close
$('.modal-card', videoModal).addEventListener('click', (e) => e.stopPropagation());

/* ============================================================
   9. Pause ambient audio when tab is hidden (battery friendly)
   ============================================================ */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && AudioManager.active && !AudioManager.active.paused) {
    AudioManager.active.dataset.wasPlaying = '1';
    AudioManager.active.pause();
  } else if (!document.hidden && AudioManager.active && AudioManager.active.dataset.wasPlaying === '1') {
    delete AudioManager.active.dataset.wasPlaying;
    try { AudioManager.active.play(); } catch(_){}
  }
});

/* ============================================================
   10. Pause ambient on first scroll into music section
   (Optional gentle nudge — spec says playing music pauses ambient,
    which is handled in playTrack() via AudioManager.)
   ============================================================ */

/* ============================================================
   11. Initial state for scrapbook scroll
   ============================================================ */
if (!unlocked) {
  scrapbook.setAttribute('aria-hidden', 'true');
}

// Ensure custom sections reveal when they come into view (post-unlock)
const customObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      observeReveals();
    }
  });
}, { threshold: 0.01 });
$$('.page-custom').forEach(s => customObserver.observe(s));

/* Expose AudioManager so birthday-room.js (loaded after this file)
   can reuse the same singleton — keeping "only one audio audible" rule. */
window.AMB.AudioManager = AudioManager;

})();
