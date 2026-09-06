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

  play(el, onError) {
    if (this.active && this.active !== el) {
      try { this.active.pause(); } catch(e) {}
    }
    this.active = el;
    el.muted = this.muted;
    const p = el.play();
    if (p && p.catch) p.catch((err) => { if (onError) onError(err); });
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
  // The date you started together — shown in the "Days With You" counter
  SINCE_DATE: new Date(2025, 4, 21),  // year, month (0-indexed), day
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
  vibrate([60, 40, 60]); // unlock feel
  // sessionStorage removed — PIN required every visit

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
      updateDaysWidget();
      daysWidget.hidden = false;
      observeReveals();
      updatePageDots();
      focusFirstVisible();
      if (lockScreen.parentNode) lockScreen.parentNode.removeChild(lockScreen);
    }, 900);
  }

  // Show a warm loading hint in the reveal while audio buffers
  const loadHint = document.createElement('p');
  loadHint.className = 'sr-load-hint';
  loadHint.textContent = '♫ Getting the music ready...';
  const srInner = sr.querySelector('.sr-inner');
  if (srInner) srInner.appendChild(loadHint);

  // Fire when enough audio is buffered
  bgAudio.addEventListener('canplaythrough', () => {
    if (loadHint.parentNode) loadHint.remove();
    doReveal();
  }, { once: true });
  // Hard timeout fallback — 5s max wait
  setTimeout(doReveal, 5000);
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

/* Lock eye toggle — show/hide digits */
const lockEye = $('#lockEye');
if (lockEye) {
  lockEye.addEventListener('click', () => {
    const showing = lockInput.getAttribute('data-show') === '1';
    lockInput.setAttribute('data-show', showing ? '0' : '1');
    // Show digits as text, hide as dots via placeholder trick
    if (!showing) {
      lockInput.style.letterSpacing = '0.3em';
      lockInput.setAttribute('placeholder', '');
      // Show actual typed chars — type=tel already shows them
    } else {
      lockInput.setAttribute('placeholder', '••••');
      lockInput.value = lockInput.value; // force re-render
    }
    const eyeShow = lockEye.querySelector('.eye-show');
    const eyeHide = lockEye.querySelector('.eye-hide');
    if (eyeShow) eyeShow.hidden = !showing;
    if (eyeHide) eyeHide.hidden = showing;
  });
}
lockInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlock();
});
lockInput.addEventListener('input', () => {
  // auto-submit when 4 digits entered
  if (lockInput.value.length === 4) {
    setTimeout(tryUnlock, 120);
  }
});

/* PIN always required — session skip removed */
focusLockInput();

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
/* ---- Page dots ---- */
const pageDots = $('#pageDots');
const dotEls = pageDots ? $$('.page-dot', pageDots) : [];

function updatePageDots() {
  if (!pageDots || dotEls.length === 0) return;
  const pages = $$('.page-snap[data-page]', scrapbook);
  // Only show dots on PNG pages (1-6)
  let activeDot = -1;
  pages.forEach((page, i) => {
    const pNum = parseInt(page.dataset.page);
    if (pNum >= 1 && pNum <= 6) {
      const rect = page.getBoundingClientRect();
      if (rect.top <= window.innerHeight / 2 && rect.bottom >= window.innerHeight / 2) {
        activeDot = pNum - 1;
      }
    }
  });
  // Show dots only on PNG pages
  const anyPngVisible = $$('.page-snap[data-page]', scrapbook).some(p => {
    const n = parseInt(p.dataset.page);
    if (n < 1 || n > 6) return false;
    const r = p.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  pageDots.classList.toggle('visible', anyPngVisible);
  dotEls.forEach((dot, i) => dot.classList.toggle('active', i === activeDot));
}

scrapbook.addEventListener('scroll', updatePageDots, { passive: true });

// Dot click — scroll to that page
dotEls.forEach((dot, i) => {
  dot.addEventListener('click', () => {
    const pages = $$('.page-snap[data-page]', scrapbook);
    const target = pages[i];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

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
  {
    title: "Can't Stop Thinking About You",
    artist: "Yabesh Thapa, Bizen, Vek Dong",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597846/Yabesh_Thapa_Bizen_Vek_Dong_-_Can_t_Stop_Thinking_About_You_ClassX_Connects_6uRXg5EDv00_p6kwpi.mp3",
    caption: "this song lives in my head rent free. I'm not even joking. you're just always there maichaa. all day every day and I don't even want it to stop."
  },
  {
    title: "Ishq Wala Love",
    artist: "Neeti Mohan · Salim Merchant",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597847/Ishq_Wala_Love_4K_Alia_Bhatt_Sidharth_Malhotra_Varun_Dhawan_Neeti_Mohan_Salim_Merchant_mjizs6.mp3",
    caption: "this is exactly the kind of love I mean when I say I love you. not the loud kind. the quiet kind that just stays. even when it's hard. especially when it's hard."
  },
  {
    title: "Laakhau Hajarau",
    artist: "Yabesh Thapa",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597848/Yabesh_Thapa_-_Laakhau_Hajarau_EQJxzSZM_mI_jfycfi.mp3",
    caption: "laakhau hajarau. that's how many times you cross my mind in a day without warning. it's actually your fault maichaa 😌"
  },
  {
    title: "Treat You Better",
    artist: "Shawn Mendes",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597846/Shawn_Mendes_-_Treat_You_Better_Lyrics_mzeeff.mp3",
    caption: "i'm gonna be honest I don't always get it right. but I'm always trying. you deserve every good thing and I mean that every time I say it."
  },
  {
    title: "You Belong With Me",
    artist: "Taylor Swift",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597840/Taylor_Swift_-_You_Belong_With_Me_mu4qen.mp3",
    caption: "okay this one's embarrassing to admit. but you just belong with me. I felt it pretty early and that feeling hasn't gone anywhere. that's just it."
  },
  {
    title: "Timi Sangai",
    artist: "Apurva Tamang",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597839/Timi_Sangai_-_Apurva_Tamang_Official_MV_hoqlte.mp3",
    caption: "timi sangai. with you. that's genuinely all I want. the boring days the random evenings the small stupid moments. all of it with you maichaa."
  },
  {
    title: "Lover (Remix)",
    artist: "Taylor Swift ft. Shawn Mendes",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597824/Taylor_Swift_-_Lover_Remix_Feat._Shawn_Mendes_Lyric_Video_tk2ich.mp3",
    caption: "can I just be yours? fully? that's the whole thing cutipie. yours to keep. yours to bother. yours to call at 2am. just yours."
  },
  {
    title: "Thamana Haat",
    artist: "Samir Shrestha",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597820/Samir_Shrestha_-_Thamana_Haat_Official_Music_Video___Prod._Foeseal_qyRrUEInzAs_tdngru.mp3",
    caption: "thamana haat. hold my hand maichaa. that's genuinely all I'm asking. just don't let go. especially when it gets hard."
  },
  {
    title: "There's Nothing Holdin' Me Back",
    artist: "Shawn Mendes",
    src: "https://res.cloudinary.com/dceqegqpr/video/upload/v1788597816/Shawn_Mendes_-_There_s_Nothing_Holdin_Me_Back_Official_Music_Video_mlh8ii.mp3",
    caption: "nothing could hold me back from you. no distance no bad day nothing. I'd go through all of it just to get back to you. every single time."
  },
];

/* ============================================================
   6. Music player — rebuilt
   ============================================================ */
const trackAudio      = $('#trackAudio');
const playBtn         = $('#playBtn');
const prevBtn         = $('#prevBtn');
const nextBtn         = $('#nextBtn');
const repeatBtn       = $('#repeatBtn');
const shuffleTrackBtn = $('#shuffleTrackBtn');
const trackTitle      = $('#trackTitle');
const trackArtist     = $('#trackArtist');
const trackNum        = $('#trackNum');
const curTime         = $('#curTime');
const durTime         = $('#durTime');
const miniBar         = $('#miniBar');
const miniTitle       = $('#miniTitle');
const miniPlayBtn     = $('#miniPlayBtn');
const scrubTrack      = $('#scrubTrack');
const scrubFill       = $('#scrubFill');
const scrubThumb      = $('#scrubThumb');
const playerCard      = $('#playerCard');
const playerLoading   = $('#playerLoading');
const trackCaptionBox = $('#trackCaption');
const trackCaptionTxt = $('#trackCaptionText');
const trackListEl     = $('#trackList');

let trackIndex  = 0;
let repeatOne   = false;
let shuffleOn   = false;
let isLoading   = false;
let scrubbing   = false;

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/* ---- Build track list ---- */
function buildTrackList() {
  if (!trackListEl) return;
  trackListEl.innerHTML = '';
  playlist.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'tracklist-item' + (i === trackIndex ? ' active' : '');
    btn.type = 'button';
    btn.innerHTML = `
      <span class="tl-num">${i + 1}</span>
      <span class="tl-info">
        <span class="tl-title">${t.title}</span>
        <span class="tl-artist">${t.artist}</span>
      </span>
      <span class="tl-playing" aria-hidden="true"><span></span><span></span><span></span></span>`;
    btn.addEventListener('click', () => {
      loadTrack(i);
      playTrack();
    });
    trackListEl.appendChild(btn);
  });
}
buildTrackList();

function updateTrackListActive() {
  if (!trackListEl) return;
  $$('.tracklist-item', trackListEl).forEach((el, i) => {
    el.classList.toggle('active', i === trackIndex);
  });
}

/* ---- Load track ---- */
function loadTrack(i) {
  if (!playlist.length) return;
  trackIndex = ((i % playlist.length) + playlist.length) % playlist.length;
  const t = playlist[trackIndex];

  trackAudio.src = t.src;
  trackAudio.preload = 'auto';
  // Slide out old title, slide in new
  if (trackTitle) {
    trackTitle.classList.add('title-out');
    setTimeout(() => {
      trackTitle.textContent = t.title || '—';
      trackTitle.classList.remove('title-out');
      trackTitle.classList.add('title-in');
      setTimeout(() => trackTitle.classList.remove('title-in'), 350);
    }, 150);
  }
  if (trackArtist) {
    setTimeout(() => { trackArtist.textContent = t.artist || ''; }, 150);
  }
  if (trackNum)    trackNum.textContent    = `${trackIndex + 1} / ${playlist.length}`;
  if (scrubFill)   scrubFill.style.width   = '0%';
  if (scrubThumb)  scrubThumb.style.left   = '0%';
  if (curTime)     curTime.textContent     = '0:00';
  if (durTime)     durTime.textContent     = '—:——';

  // caption — only show after play starts
  if (trackCaptionBox) trackCaptionBox.hidden = true;
  if (trackCaptionTxt && t.caption) trackCaptionTxt.textContent = t.caption;

  updateTrackListActive();
  updateMiniBar();
}
// Set initial title immediately to avoid — flash
if (playlist.length && trackTitle) trackTitle.textContent = playlist[0].title;
if (playlist.length && trackArtist) trackArtist.textContent = playlist[0].artist || '';
if (playlist.length && trackNum) trackNum.textContent = '1 / ' + playlist.length;
loadTrack(0);

/* ---- Playing UI ---- */
function setPlayingUI(isPlaying) {
  const iPlay  = playBtn && playBtn.querySelector('.icon-play');
  const iPause = playBtn && playBtn.querySelector('.icon-pause');
  const iLoad  = playBtn && playBtn.querySelector('.icon-loading');
  if (iPlay && iPause && iLoad) {
    iPlay.hidden  = isLoading || isPlaying;
    iPause.hidden = isLoading || !isPlaying;
    iLoad.hidden  = !isLoading;
  }
  if (playBtn) playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  if (playBtn) playBtn.classList.toggle('loading', isLoading);
  if (playerCard) playerCard.classList.toggle('playing', isPlaying && !isLoading);
  updateMiniBar();
  checkMiniBar();
}

/* ---- Loading state ---- */
function setLoadingUI(loading) {
  isLoading = loading;
  if (playerLoading) playerLoading.hidden = !loading;
  const playerScrub = $('#playerScrub');
  if (playerScrub) playerScrub.style.opacity = loading ? '0.5' : '1';
  // show loading icon in play button, don't change playing state
  const iPlay  = playBtn && playBtn.querySelector('.icon-play');
  const iPause = playBtn && playBtn.querySelector('.icon-pause');
  const iLoad  = playBtn && playBtn.querySelector('.icon-loading');
  if (iPlay && iPause && iLoad) {
    iPlay.hidden  = loading;
    iPause.hidden = loading;
    iLoad.hidden  = !loading;
  }
  if (playBtn) playBtn.classList.toggle('loading', loading);
}

/* ---- Play / Pause ---- */
function playTrack() {
  if (!playlist.length) return;
  setLoadingUI(true);
  AudioManager.play(trackAudio, (err) => {
    console.warn('Audio play error:', err);
    setLoadingUI(false);
    setPlayingUI(false);
  });
}
function pauseTrack() {
  AudioManager.pause(trackAudio);
  setLoadingUI(false);
  setPlayingUI(false);
  checkMiniBar();
}

trackAudio.addEventListener('error', () => {
  setLoadingUI(false);
  setPlayingUI(false);
  const errEl = $('#playerError');
  if (errEl) errEl.hidden = false;
});

trackAudio.addEventListener('playing', () => {
  const errEl = $('#playerError');
  if (errEl) errEl.hidden = true;
  setLoadingUI(false);
  setPlayingUI(true);
  // show caption once actually playing
  if (trackCaptionBox && trackCaptionTxt && trackCaptionTxt.textContent) {
    trackCaptionBox.hidden = false;
    // restart animation
    trackCaptionBox.style.animation = 'none';
    void trackCaptionBox.offsetWidth;
    trackCaptionBox.style.animation = '';
  }
});
trackAudio.addEventListener('waiting', () => setLoadingUI(true));
trackAudio.addEventListener('canplay',  () => { if (!trackAudio.paused) setLoadingUI(false); });
trackAudio.addEventListener('loadedmetadata', () => {
  if (durTime) durTime.textContent = fmtTime(trackAudio.duration);
});
trackAudio.addEventListener('ended', () => {
  if (repeatOne) {
    trackAudio.currentTime = 0;
    playTrack();
  } else if (shuffleOn) {
    const next = Math.floor(Math.random() * playlist.length);
    loadTrack(next);
    playTrack();
  } else {
    loadTrack(trackIndex + 1);
    playTrack();
  }
});

/* ---- Controls ---- */
playBtn && playBtn.addEventListener('click', () => {
  if (trackAudio.paused) playTrack();
  else pauseTrack();
});
prevBtn && prevBtn.addEventListener('click', () => {
  // if >3s in, restart; else go prev
  if (trackAudio.currentTime > 3) {
    trackAudio.currentTime = 0;
  } else {
    loadTrack(trackIndex - 1);
    if (!trackAudio.paused) playTrack();
  }
});
nextBtn && nextBtn.addEventListener('click', () => {
  loadTrack(shuffleOn ? Math.floor(Math.random() * playlist.length) : trackIndex + 1);
  playTrack();
});
repeatBtn && repeatBtn.addEventListener('click', () => {
  repeatOne = !repeatOne;
  repeatBtn.setAttribute('aria-pressed', String(repeatOne));
});
shuffleTrackBtn && shuffleTrackBtn.addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  shuffleTrackBtn.setAttribute('aria-pressed', String(shuffleOn));
});

/* ---- Scrubber ---- */
trackAudio.addEventListener('timeupdate', () => {
  if (!trackAudio.duration || scrubbing) return;
  const pct = (trackAudio.currentTime / trackAudio.duration) * 100;
  if (scrubFill)  scrubFill.style.width = pct + '%';
  if (scrubThumb) scrubThumb.style.left = pct + '%';
  if (curTime)    curTime.textContent   = fmtTime(trackAudio.currentTime);
  if (scrubTrack) scrubTrack.setAttribute('aria-valuenow', Math.round(pct));
});

function seekFromEvent(e) {
  if (!scrubTrack) return;
  const rect = scrubTrack.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const pct = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  if (trackAudio.duration) {
    trackAudio.currentTime = pct * trackAudio.duration;
    if (scrubFill)  scrubFill.style.width = (pct * 100) + '%';
    if (scrubThumb) scrubThumb.style.left  = (pct * 100) + '%';
    if (curTime)    curTime.textContent    = fmtTime(trackAudio.currentTime);
  }
}
if (scrubTrack) {
  scrubTrack.addEventListener('mousedown',  (e) => { scrubbing = true; seekFromEvent(e); });
  scrubTrack.addEventListener('touchstart', (e) => { scrubbing = true; seekFromEvent(e); }, { passive: true });
  scrubTrack.addEventListener('touchmove',  (e) => { if (scrubbing) seekFromEvent(e); }, { passive: true });
  scrubTrack.addEventListener('touchend',   () => { scrubbing = false; });
  scrubTrack.addEventListener('keydown', (e) => {
    if (!trackAudio.duration) return;
    if (e.key === 'ArrowLeft')  { trackAudio.currentTime = Math.max(0, trackAudio.currentTime - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { trackAudio.currentTime = Math.min(trackAudio.duration, trackAudio.currentTime + 5); e.preventDefault(); }
  });
}
window.addEventListener('mousemove', (e) => { if (scrubbing) seekFromEvent(e); });
window.addEventListener('mouseup',   () => { scrubbing = false; });

/* ---- Mini floating bar ---- */

function updateMiniBar() {
  if (!miniBar) return;
  const t = playlist[trackIndex];
  if (miniTitle) miniTitle.textContent = t ? t.title : '';
  const mp  = miniBar.querySelector('.mini-icon-play');
  const mpa = miniBar.querySelector('.mini-icon-pause');
  if (mp && mpa) { mp.hidden = !trackAudio.paused; mpa.hidden = trackAudio.paused; }
  // waveform: animate only when playing
  const wf = miniBar.querySelector('.mini-waveform');
  if (wf) wf.classList.toggle('paused', trackAudio.paused);
}

function checkMiniBar() {
  if (!miniBar) return;
  const ms = $('#music-screen');
  if (!ms) return;
  const r = ms.getBoundingClientRect();
  const visible = r.top < window.innerHeight && r.bottom > 0;
  miniBar.classList.toggle('mini-visible', !trackAudio.paused && !visible);
}

scrapbook.addEventListener('scroll', checkMiniBar, { passive: true });
miniPlayBtn && miniPlayBtn.addEventListener('click', () => {
  if (trackAudio.paused) playTrack(); else pauseTrack();
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

function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch(_) {}
}

function onSolved() {
  solved = true;
  vibrate([40, 30, 40, 30, 100]); // celebration pattern
  if (puzzleWarning) puzzleWarning.classList.remove('show');
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
  const colors = ['var(--coral)', 'var(--mustard)', 'var(--brick)', 'var(--ink)', '#BFD8F0'];
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

/* ---- Scroll lock until puzzle solved ---- */
function lockScrollAtPuzzle() {
  const puzzleScreen = $('#puzzle-screen');
  if (!puzzleScreen) return;

  scrapbook.addEventListener('wheel', (e) => {
    if (solved) return;
    const rect = puzzleScreen.getBoundingClientRect();
    const fullyVisible = rect.top <= 10 && rect.bottom >= window.innerHeight - 10;
    // Only block if puzzle is the current snapped page AND scrolling forward (down)
    if (fullyVisible && e.deltaY > 0) {
      e.preventDefault();
      showPuzzleWarning();
    }
  }, { passive: false });

  scrapbook.addEventListener('touchstart', (e) => {
    if (solved) return;
    scrapbook._touchStartY = e.touches[0].clientY;
  }, { passive: true });

  scrapbook.addEventListener('touchmove', (e) => {
    if (solved) return;
    const rect = puzzleScreen.getBoundingClientRect();
    const fullyVisible = rect.top <= 10 && rect.bottom >= window.innerHeight - 10;
    const swipingDown = scrapbook._touchStartY > e.touches[0].clientY;
    if (fullyVisible && swipingDown) {
      e.preventDefault();
      showPuzzleWarning();
    }
  }, { passive: false });
}
lockScrollAtPuzzle();

const puzzleWarning = $('#puzzleWarning');
let warningTimeout = null;
function showPuzzleWarning() {
  if (!puzzleWarning || solved) return;
  puzzleWarning.classList.add('show');
  clearTimeout(warningTimeout);
  warningTimeout = setTimeout(() => puzzleWarning.classList.remove('show'), 2500);
}

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

/* ---- PS + Kiss sequence ---- */
const modalPs          = $('#modalPs');
const modalKissSection = $('#modalKissSection');
const kissBtn          = $('#kissBtn');
const kissOverlay      = $('#kissOverlay');
const endingOverlay    = $('#endingOverlay');
let psShown = false;

// Show PS after 4s of video playing
revealVideo.addEventListener('timeupdate', () => {
  if (!psShown && revealVideo.currentTime > 4) {
    psShown = true;
    if (modalPs) modalPs.hidden = false;
    setTimeout(() => { if (modalKissSection) modalKissSection.hidden = false; }, 1500);
  }
});

// Kiss button
if (kissBtn) {
  kissBtn.addEventListener('click', () => {
    kissBtn.disabled = true;
    kissBtn.style.opacity = '0.5';
    launchKisses();
  });
}

function launchKisses() {
  if (!kissOverlay) return;
  kissOverlay.hidden = false;

  const txt = document.createElement('div');
  txt.className = 'kiss-text';
  txt.innerHTML = 'Kisses on the way to Australia 😝💋';
  document.body.appendChild(txt);

  const kisses = ['💋','💋','💕','💞','💗','💋','❤️','💋','💕','💋','💗','💋','💞','💋','💋','💋','💕','💗'];
  kisses.forEach((k, i) => {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'flying-kiss';
      el.textContent = k;
      const startX = Math.random() * window.innerWidth * 0.6;
      const startY = window.innerHeight * 0.3 + Math.random() * window.innerHeight * 0.4;
      el.style.left = startX + 'px';
      el.style.top  = startY + 'px';
      const tx = (window.innerWidth  * 0.9 - startX) + Math.random() * 120;
      const ty = -(startY + 150 + Math.random() * 400);
      const dur = 1.6 + Math.random() * 1.4;
      el.style.setProperty('--tx', tx + 'px');
      el.style.setProperty('--ty', ty + 'px');
      el.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
      el.style.animationDuration = dur + 's';
      el.style.animationDelay   = (Math.random() * 0.2) + 's';
      kissOverlay.appendChild(el);
      setTimeout(() => el.remove(), (dur + 0.5) * 1000);
    }, i * 100);
  });

  setTimeout(() => {
    txt.remove();
    kissOverlay.hidden = true;
    kissOverlay.innerHTML = '';
    closeModal();
    setTimeout(showEnding, 500);
  }, 3800);
}

function showEnding() {
  if (!endingOverlay) return;
  endingOverlay.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    endingOverlay.style.opacity = '1';
  }));
  // Spawn floating hearts
  const heartsEl = endingOverlay.querySelector('.ending-hearts');
  if (heartsEl) {
    ['💗','💕','💞','🧿','💋','💗','💞','💕','🤍','💗','💋','💕'].forEach((h, i) => {
      const el = document.createElement('div');
      el.className = 'ending-heart-piece';
      el.textContent = h;
      el.style.left   = (3 + Math.random() * 94) + '%';
      el.style.bottom = (Math.random() * 15) + '%';
      const dur = 3 + Math.random() * 4;
      el.style.animationDuration = dur + 's';
      el.style.animationDelay   = (i * 0.25) + 's';
      heartsEl.appendChild(el);
    });
  }
  // Tap to dismiss
  endingOverlay.addEventListener('click', () => {
    endingOverlay.style.opacity = '0';
    setTimeout(() => { endingOverlay.hidden = true; }, 1200);
  }, { once: true });
}

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

/* ============================================================
   Page 5 — photo blur patch with JSONBin persistence
   ============================================================ */
(function p5PhotoBlur() {
  const patch   = document.getElementById('p5PhotoBlur');
  const doneBtn = document.getElementById('p5DoneBtn');
  const resizeH = document.getElementById('p5ResizeHandle');
  if (!patch) return;

  const MASTER_KEY = '$2a$10$yg.uDbnr8TKlXDrvSMEDjuy9ZnZhkgYCT.2YkIw4z/RSkkrbbYKte';
  const BIN_KEY    = 'p5blur_bin_id';
  const DEFAULTS   = {
    mobile:  { left:'8%',  top:'20%', width:'52%', height:'48%' },
    desktop: { left:'10%', top:'18%', width:'38%', height:'52%' }
  };
  const ADMIN_KEY  = 'ambday2025';
  const isAdmin    = new URLSearchParams(location.search).get('admin') === ADMIN_KEY;
  const screen     = () => window.innerWidth <= 768 ? 'mobile' : 'desktop';

  let binId        = localStorage.getItem(BIN_KEY) || null;
  let cachedRecord = null;
  let revealed     = false;

  /* ---- JSONBin helpers ---- */
  async function fetchAllPos() {
    if (!binId) return null;
    try {
      const r = await fetch('https://api.jsonbin.io/v3/b/' + binId + '/latest', {
        headers: { 'X-Master-Key': MASTER_KEY }
      });
      const j = await r.json();
      return j.record || null;
    } catch(e) { return null; }
  }

  async function savePos(pos) {
    try {
      const key = screen();
      // Use the already-cached record so we don't lose the other screen's position
      const record = Object.assign({}, cachedRecord || {});
      record[key] = pos;
      cachedRecord = record; // update cache immediately

      if (!binId) {
        // First time — create the bin
        const r = await fetch('https://api.jsonbin.io/v3/b', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': MASTER_KEY,
            'X-Bin-Name': 'ambday-photo-blur',
            'X-Bin-Private': 'true'
          },
          body: JSON.stringify(record)
        });
        const j = await r.json();
        binId = j.metadata.id;
        localStorage.setItem(BIN_KEY, binId);
      } else {
        // Update existing bin with merged record
        await fetch('https://api.jsonbin.io/v3/b/' + binId, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': MASTER_KEY
          },
          body: JSON.stringify(record)
        });
      }
    } catch(e) { console.warn('JSONBin save failed', e); }
  }

  /* ---- Apply position ---- */
  function applyPos(record) {
    const key = screen();
    const pos = (record && record[key]) || DEFAULTS[key];
    patch.style.left   = pos.left;
    patch.style.top    = pos.top;
    patch.style.width  = pos.width;
    patch.style.height = pos.height;
  }

  function getPercent() {
    const parent = patch.parentElement;
    const pw = parent.offsetWidth;
    const ph = parent.offsetHeight;
    return {
      left:   (patch.offsetLeft / pw * 100).toFixed(2) + '%',
      top:    (patch.offsetTop  / ph * 100).toFixed(2) + '%',
      width:  (patch.offsetWidth  / pw * 100).toFixed(2) + '%',
      height: (patch.offsetHeight / ph * 100).toFixed(2) + '%'
    };
  }

  /* ---- Lock/unlock ---- */
  function lockPatch() {
    patch.classList.add('locked');
    if (!isAdmin) patch.style.pointerEvents = 'none';
  }

  /* ---- Done button ---- */
  doneBtn && doneBtn.addEventListener('click', async () => {
    const pos = getPercent();
    lockPatch();
    await savePos(pos);
    const key = screen();
    alert('Saved for ' + key + '! ✓\nNow set it on the other screen size too if needed.');
  });

  /* ---- Drag ---- */
  let dragSX, dragSY, origL, origT;

  function startDrag(e) {
    if (!isAdmin) return;
    if (e.target === resizeH || e.target === doneBtn) return;
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    dragSX = cx; dragSY = cy;
    origL  = patch.offsetLeft;
    origT  = patch.offsetTop;
    patch.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup',   endDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend',  endDrag);
  }

  function onDrag(e) {
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const parent = patch.parentElement;
    const newL = Math.max(0, Math.min(origL + cx - dragSX, parent.offsetWidth  - patch.offsetWidth));
    const newT = Math.max(0, Math.min(origT + cy - dragSY, parent.offsetHeight - patch.offsetHeight));
    patch.style.left = newL + 'px';
    patch.style.top  = newT + 'px';
  }

  function endDrag() {
    patch.style.cursor = 'grab';
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup',   endDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend',  endDrag);
  }

  patch.addEventListener('mousedown', startDrag);
  patch.addEventListener('touchstart', startDrag, { passive: false });

  /* ---- Resize — corner handle (desktop) + pinch (mobile) ---- */
  let resSX, resSY, resOW, resOH;

  resizeH && resizeH.addEventListener('mousedown', startResize);
  resizeH && resizeH.addEventListener('touchstart', startResize, { passive: false });

  function startResize(e) {
    if (!isAdmin) return;
    e.preventDefault(); e.stopPropagation();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    resSX = cx; resSY = cy;
    resOW = patch.offsetWidth; resOH = patch.offsetHeight;
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup',   endResize);
    document.addEventListener('touchmove', onResize, { passive: false });
    document.addEventListener('touchend',  endResize);
  }

  function onResize(e) {
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    patch.style.width  = Math.max(80,  resOW + cx - resSX) + 'px';
    patch.style.height = Math.max(60, resOH + cy - resSY) + 'px';
  }

  function endResize() {
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup',   endResize);
    document.removeEventListener('touchmove', onResize);
    document.removeEventListener('touchend',  endResize);
  }

  /* ---- Pinch to resize (mobile) ---- */
  let pinchStartDist = null;
  let pinchStartW    = null;
  let pinchStartH    = null;

  function getDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  patch.addEventListener('touchstart', (e) => {
    if (!isAdmin) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchStartDist = getDist(e.touches);
      pinchStartW    = patch.offsetWidth;
      pinchStartH    = patch.offsetHeight;
    }
  }, { passive: false });

  patch.addEventListener('touchmove', (e) => {
    if (!isAdmin) return;
    if (e.touches.length === 2 && pinchStartDist !== null) {
      e.preventDefault();
      const dist  = getDist(e.touches);
      const scale = dist / pinchStartDist;
      patch.style.width  = Math.max(80,  Math.round(pinchStartW * scale)) + 'px';
      patch.style.height = Math.max(60, Math.round(pinchStartH * scale)) + 'px';
    }
  }, { passive: false });

  patch.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      pinchStartDist = null;
      pinchStartW    = null;
      pinchStartH    = null;
    }
  });

  /* ---- Reveal: password prompt (triggered by Ctrl+Shift+K or shake) ---- */
  const REVEAL_PASSWORD = 'maichaa';
  let promptOpen = false;

  function askAndReveal() {
    if (revealed || promptOpen) return;
    promptOpen = true;

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'p5RevealModal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);
    `;
    modal.innerHTML = `
      <div style="background:#1a1025;border-radius:20px;padding:32px 28px;
                  width:min(340px,88vw);text-align:center;
                  box-shadow:0 24px 60px rgba(0,0,0,0.6);
                  border:1px solid rgba(255,255,255,0.1);">
        <div style="font-size:32px;margin-bottom:12px;">🔒</div>
        <p style="font-family:-apple-system,sans-serif;font-size:15px;
                  color:rgba(255,255,255,0.85);margin:0 0 20px;line-height:1.5;">
          what do I always call you?
        </p>
        <input id="p5PwInput" type="text" placeholder="type here..."
               style="width:100%;box-sizing:border-box;
                      padding:12px 16px;border-radius:10px;border:none;
                      background:rgba(255,255,255,0.1);color:#fff;
                      font-size:16px;text-align:center;outline:none;
                      border:1px solid rgba(255,255,255,0.2);"
               autocomplete="off" autocorrect="off" spellcheck="false"/>
        <div id="p5PwError" style="color:#e8837a;font-size:12px;
                                    margin-top:8px;min-height:16px;
                                    font-family:-apple-system,sans-serif;"></div>
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button id="p5PwCancel" style="flex:1;padding:12px;border-radius:10px;
                  background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);
                  font-size:14px;cursor:pointer;border:none;font-family:-apple-system,sans-serif;">
            Cancel
          </button>
          <button id="p5PwSubmit" style="flex:1;padding:12px;border-radius:10px;
                  background:linear-gradient(135deg,#e8837a,#c05870);color:#fff;
                  font-size:14px;font-weight:700;cursor:pointer;border:none;
                  font-family:-apple-system,sans-serif;">
            Show ♡
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input  = modal.querySelector('#p5PwInput');
    const error  = modal.querySelector('#p5PwError');
    const submit = modal.querySelector('#p5PwSubmit');
    const cancel = modal.querySelector('#p5PwCancel');

    setTimeout(() => input.focus(), 100);

    function closeModal() {
      modal.remove();
      promptOpen = false;
    }

    function tryReveal() {
      if (input.value.trim().toLowerCase() === REVEAL_PASSWORD) {
        closeModal();
        revealed = true;
        patch.classList.add('revealed');
        setTimeout(() => { patch.style.display = 'none'; }, 700);
      } else {
        error.textContent = 'nope, try again 🙈';
        input.value = '';
        input.focus();
      }
    }

    submit.addEventListener('click', tryReveal);
    cancel.addEventListener('click', closeModal);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryReveal();
      if (e.key === 'Escape') closeModal();
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'K') { e.preventDefault(); askAndReveal(); }
  });

  let lX = null, lY = null, lZ = null;
  let lastShake = 0;
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    if (lX === null) { lX = a.x; lY = a.y; lZ = a.z; return; }
    const now = Date.now();
    if (Math.abs(a.x-lX)+Math.abs(a.y-lY)+Math.abs(a.z-lZ) > 18 && now - lastShake > 2000) {
      lastShake = now;
      askAndReveal();
    }
    lX = a.x; lY = a.y; lZ = a.z;
  }, { passive: true });

  window.addEventListener('touchend', function req() {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().catch(() => {});
    }
    window.removeEventListener('touchend', req);
  }, { once: true });

  /* ---- Init ---- */
  async function init() {
    const pos = await fetchPos();
    if (pos) {
      applyPos(pos);
    } else {
      applyPos(DEFAULT);
    }
    // Non-admin always sees it locked
    if (!isAdmin) lockPatch();
  }


  async function init() {
    cachedRecord = await fetchAllPos();
    applyPos(cachedRecord);
    if (isAdmin) {
      // Show admin hint
      const bar = document.getElementById('p5EditBar');
      if (bar) bar.style.display = 'flex';
      patch.classList.remove('locked');
    } else {
      lockPatch();
    }
  }

  // Re-apply correct position on resize (mobile ↔ desktop)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => applyPos(cachedRecord), 200);
  });

  init();
})();
