/* ============================================================
   BIRTHDAY ROOM — interactive experience
   Loaded after script.js. Reuses window.AMB.AudioManager so the
   "only one audio audible at a time" rule is preserved.

   Architecture:
     - Single state machine: ROOM_ENTER → LIGHTS_OFF → LIGHTS_ON →
       DECORATING → DECORATION_COMPLETE → CAKE_AVAILABLE →
       CAKE_PLACED → CANDLE_AVAILABLE → CANDLE_LIT →
       BIRTHDAY_MUSIC → CANDLE_EXTINGUISHED (blow wish) →
       CAKE_CUTTING → WISH (letter) → LIGHTS_OFF → ROOM_CLOSING → ROOM_COMPLETE
     - Built as a fixed overlay; cleans up on close so the rest
       of the scrapbook continues normally.
   ============================================================ */
(() => {
'use strict';

/* ============================================================
   0. CONFIG — EDIT THESE
   ============================================================ */
const birthdayRoomConfig = {
  /* Personal birthday wish. Replace the body text with your real message.
     Use \n for line breaks. */
  birthdayWish:
    "maichaa.\n\n" +
    "I don't really know how to start this. I kept trying to write something perfect and kept deleting it, so I'm just going to say it how I feel it.\n\n" +
    "you came into my life and everything just shifted. not in a big dramatic way, just quietly, like suddenly things made more sense.\n\n" +
    "I think about you more than you know — the random moments, the stupid things I want to tell you first, the way I reach for my phone and you're already the thought before I even unlock it.\n\n" +
    "" + (() => { const d = Math.max(0, Math.floor((new Date() - new Date(2025,4,21)) / 86400000)); return d + " days. every single one has been my favourite — even the hard ones, even the ones where we didn't talk much, because you were still there."; })() + "\n\n" +
    "I can't be there with you today and that hurts a little, but I made you this. this whole thing. because you deserve to feel special even from far away.\n\n" +
    "happy birthday maichaa. I love you. more than I know how to say. ♡",

  /* Birthday song. Place the file at this path. */
  birthdaySong: 'assets/audio/birthday-song.mp3',

  /* Decorations the user must place to complete the room.
     Each key matches a data-zone attribute on a .br-dropzone element. */
  requiredDecorations: ['balloons', 'banner', 'photo', 'flowers', 'gift', 'lights', 'confetti', 'heartwall', 'polaroids', 'candles'],

  /* Decoration tray items (in display order).
     `kind` matches a zone; `emoji` is the visual. */
  decorations: [
    { kind: 'balloons',  emoji: '🎈', label: 'Balloons'  },
    { kind: 'banner',    emoji: '🎉', label: 'Banner'    },
    { kind: 'photo',     emoji: '🖼️', label: 'Photo'     },
    { kind: 'flowers',   emoji: '🌸', label: 'Flowers'   },
    { kind: 'gift',      emoji: '🎁', label: 'Gift'      },
    { kind: 'lights',    emoji: '✨', label: 'String Lights' },
    { kind: 'confetti',  emoji: '✉️', label: 'Letters'   },
    { kind: 'heartwall', emoji: '💝', label: 'Heart Wall' },
    { kind: 'polaroids', emoji: '📸', label: 'Polaroids' },
    { kind: 'candles',   emoji: '🕯️', label: 'Candles'   },

  ],

  /* Photo to show in the frame — replace with Amisha's Cloudinary URL */
  photoUrl: 'https://res.cloudinary.com/dceqegqpr/image/upload/v1788600853/Snapchat-28097105_ptmy1g.jpg',

  /* Cake element size hint (used by drag snap math) */
  cakeWidth: 110,
  cakeHeight: 130,

  /* Timings (ms) — tuned so the experience breathes */
  timing: {
    veilShow:     1800,
    veilHide:     900,
    lightsFade:   1400,
    captionHold:  2200,
    cakeReveal:   600,
    candleLitToMusic: 1400,
    musicToKnife: 6000,
    wishFadeIn:   800,
    doorsClose:   2400,
    doorsHold:    1200,
    overlayFade:  900,
  }
};

/* ============================================================
   1. Access to the shared audio manager + helpers from script.js
   ============================================================ */
const AM    = window.AMB;
const PRM   = AM ? AM.PRM : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $     = AM ? AM.$  : (s, c=document) => c.querySelector(s);
const $$    = AM ? AM.$$ : (s, c=document) => Array.from(c.querySelectorAll(s));
const AudioManager = AM ? AM.AudioManager : null;
const scrapbook = AM ? AM.getScrapbook() : $('#scrapbook');

/* ============================================================
   2. DOM references
   ============================================================ */
const overlay     = $('#birthdayRoom');
const veil        = $('#brVeil');
const room        = $('#brRoom');
const lightSwitch = $('#brLightSwitch');
const banner      = $('#brBanner');
const bannerText  = $('.br-banner-text', banner);
const stringLights= $('#brStringLights');
const table       = $('#brTable');
const cakeEl      = $('#brCake');
const candleEl    = $('#brCandle');
const candleFlame = $('#brCandleFlame');
const candleGlow  = $('#brCandleGlow');
const knifeEl     = $('#brKnife');
const particles   = $('#brParticles');
const captionEl   = $('#brCaption');
const captionText = $('.br-caption-text', captionEl);
const tray        = $('#brTray');
const trayItems   = $('#brTrayItems');
const wish        = $('#brWish');
const wishBody    = $('#brWishBody');
const wishCue     = $('#brWishCue');
const blowBtn     = $('#brBlowBtn');
const doors       = $('#brDoors');
const doorsMsg    = $('#brDoorsMsg');
const SkipBtn     = $('#brSkipBtn');
const birthdayAudio = $('#birthdayAudio');

const enterRoomBtn = $('#enterRoomBtn');
const openRoomBtn  = $('#openRoomBtn');

/* ============================================================
   3. State machine
   ============================================================ */
const ST = {
  ROOM_ENTER: 'ROOM_ENTER',
  LIGHTS_OFF: 'LIGHTS_OFF',
  LIGHTS_ON:  'LIGHTS_ON',
  DECORATING: 'DECORATING',
  DECORATION_COMPLETE: 'DECORATION_COMPLETE',
  CAKE_AVAILABLE: 'CAKE_AVAILABLE',
  CAKE_PLACED: 'CAKE_PLACED',
  CANDLE_AVAILABLE: 'CANDLE_AVAILABLE',
  CANDLE_LIT: 'CANDLE_LIT',
  BIRTHDAY_MUSIC: 'BIRTHDAY_MUSIC',
  CAKE_CUTTING: 'CAKE_CUTTING',
  WISH: 'WISH',
  CANDLE_EXTINGUISHED: 'CANDLE_EXTINGUISHED',
  LIGHTS_OFF_AGAIN: 'LIGHTS_OFF_AGAIN',
  ROOM_CLOSING: 'ROOM_CLOSING',
  ROOM_COMPLETE: 'ROOM_COMPLETE'
};

const birthdayRoomState = {
  lightsOn: false,
  decorationsCompleted: false,
  cakePlaced: false,
  candleLit: false,
  cakeCut: false,
  wishShown: false,
  roomClosed: false,
  current: ST.ROOM_ENTER
};

/* Track which decorations are placed */
const placedDecorations = new Set();

/* Track timers we may need to clear on cleanup */
const pendingTimers = [];
function later(fn, ms) {
  const id = setTimeout(() => {
    const i = pendingTimers.indexOf(id);
    if (i >= 0) pendingTimers.splice(i, 1);
    fn();
  }, ms);
  pendingTimers.push(id);
  return id;
}
function clearAllTimers() {
  while (pendingTimers.length) clearTimeout(pendingTimers.pop());
}

/* ============================================================
   4. Entry points — open the room
   ============================================================ */
function openRoom() {
  if (overlay && !overlay.hidden) return; // already open

  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (scrapbook) scrapbook.style.overflow = 'hidden';

  // Set state
  setState(ST.ROOM_ENTER);
  setCaption("It's dark in here 😅 There's a switch somewhere");

  // The HTML already provides a <source> child for #birthdayAudio, so we
  // don't need to append one here. The src is wired at parse time.

  // Cinematic "wait..." veil → fade in → fade out → reveal dark room
  veil.classList.add('show');
  later(() => {
    veil.classList.add('hide');
    veil.classList.remove('show');
    later(() => {
      veil.classList.remove('hide');
      // Room now visible (dark)
      setState(ST.LIGHTS_OFF);
      // Focus the light switch for keyboard users
      try { lightSwitch.focus({ preventScroll: true }); } catch(_){}
    }, birthdayRoomConfig.timing.veilHide);
  }, birthdayRoomConfig.timing.veilShow);
}

function setState(next) {
  birthdayRoomState.current = next;
  onStateChange(next);
}

function onStateChange(state) {
  switch (state) {
    case ST.LIGHTS_OFF:
      room.classList.remove('lit', 'dim');
      room.classList.add('dark');
      setCaption("It's dark in here 😅 There's a switch somewhere");
      // Hint sequence — point to the switch
      later(() => {
        setCaption("Psst. The switch is on the right wall 💡 Go on");
        if (lightSwitch) {
          lightSwitch.classList.add('pulse-hint');
          later(() => lightSwitch.classList.remove('pulse-hint'), 3000);
        }
      }, 3500);
      break;

    case ST.LIGHTS_ON:
      room.classList.remove('dark');
      room.classList.add('lit');
      stringLights.classList.add('on');
      tryRestartAmbient();
      startDust();
      // Light flash
      if (brLightFlash) { brLightFlash.classList.add('flash'); setTimeout(() => brLightFlash.classList.remove('flash'), 700); }
      // Show characters from the very start — they're here to decorate with her
      later(() => {
        const c = $('#brCharacters');
        if (c) { c.hidden = false; c.removeAttribute('aria-hidden'); }
        if (window.CharacterAnimation) window.CharacterAnimation.playIdle();
      }, 600);
      // Moonbeam fades out naturally via CSS
      later(() => {
        setCaption("Let's decorate this place for you 🎈");
        showTray();
        setState(ST.DECORATING);
      }, birthdayRoomConfig.timing.captionHold);
      break;

    case ST.DECORATION_COMPLETE:
      setCaption("Wait. You actually did all of that 🥹✨");
      startFallingConfetti();
      hideTray();
      later(() => {
        setCaption("Almost there. Something's still missing");
      }, 1800);
      later(() => {
        setCaption("One last thing. I promise");
        stopFallingConfetti();
        revealCake();
      }, birthdayRoomConfig.timing.captionHold + 1800);
      break;

    case ST.CAKE_PLACED:
      if (brCakeShadow) brCakeShadow.hidden = false;
      cakeEl.classList.add('placed');
      // Hug reaction when cake placed
      later(() => {
        if (window.CharacterAnimation) {
          window.CharacterAnimation.playReaction()
            .then(() => window.CharacterAnimation.playMoveTogether())
            .then(() => window.CharacterAnimation.playHug())
            .then(() => window.CharacterAnimation.returnToIdle());
        }
      }, 400);
      setCaption("Now for the candle 🕯️");
      later(() => revealCandle(), 800);
      later(() => setCaption("Tap the candle maichaa 🕯️"), 2000);
      break;

    case ST.CANDLE_LIT:
      room.classList.remove('lit');
      room.classList.add('dim');
      setCaption("...happy birthday maichaa 🤍");
      // Start music immediately when candle is lit — plays until blow
      later(() => startBirthdayMusic(), 800);
      break;

    case ST.BIRTHDAY_MUSIC:
      room.classList.remove('dim');
      room.classList.add('lit');
      if (!banner.classList.contains('pre-visible')) {
        bannerText.textContent = 'miles apart, hearts together 🤍';
      }
      banner.classList.add('visible');
      if (brCandleWallGlow) brCandleWallGlow.classList.remove('active');
      startParticles();
      startFallingConfetti();
      // After music plays — prompt blow
      later(() => {
        stopFallingConfetti();
        setCaption("Close your eyes. Make a wish. Blow the candle cutipie 🕯️");
        // Wire candle tap to blow it
        const blowIt = () => {
          candleEl.removeEventListener('click', blowIt);
          blowCandle();
        };
        candleEl.style.cursor = 'pointer';
        candleEl.addEventListener('click', blowIt, { once: true });
      }, birthdayRoomConfig.timing.musicToKnife);
      break;

    case ST.CAKE_CUTTING:
      setCaption("Now cut the cake 🎂 Drag the knife");
      break;

    case ST.WISH:
      setCaption("");
      hideTray();
      if (brCakeShadow) brCakeShadow.hidden = true;
      later(() => showWish(), 500);
      break;

    case ST.CANDLE_EXTINGUISHED:
      if (brCandleWallGlow) brCandleWallGlow.classList.remove('active');
      candleFlame.classList.remove('lit');
      candleGlow.classList.remove('lit');
      const smoke = document.createElement('div');
      smoke.className = 'br-candle-smoke rising';
      candleEl.appendChild(smoke);
      setTimeout(() => smoke.remove(), 2200);
      // Hug + kiss after candle blown
      later(() => {
        if (window.CharacterAnimation) {
          window.CharacterAnimation.playMoveTogether()
            .then(() => window.CharacterAnimation.playHug())
            .then(() => window.CharacterAnimation.playKiss())
            .then(() => window.CharacterAnimation.returnToIdle());
        }
      }, 400);
      later(() => setCaption("I hope it comes true 🌟"), 600);
      later(() => setCaption("Now cut the cake 🎂"), 2200);
      later(() => {
        setCaption("Drag the knife across the cake 🎂");
        revealKnife();
      }, 3600);
      break;

    case ST.LIGHTS_OFF_AGAIN:
      room.classList.remove('lit', 'dim');
      room.classList.add('dark');
      stopParticles();
      // Fade birthday music out, then crossfade ambient bg back in
      if (AudioManager && birthdayAudio) {
        AudioManager.fadeTo(birthdayAudio, 0, 2000, () => {
          AudioManager.pause(birthdayAudio);
          // Fade ambient back in after bday music gone
          const bg = $('#bgAudio');
          if (bg) {
            try {
              bg.volume = 0;
              bg.loop   = true;
              AudioManager.play(bg);
              AudioManager.fadeTo(bg, 0.4, 1800);
            } catch(_) {}
          }
        });
      } else {
        // No bday music active — just restart ambient
        const bg = $('#bgAudio');
        if (bg && AudioManager) {
          try { bg.volume = 0; bg.loop = true; AudioManager.play(bg); AudioManager.fadeTo(bg, 0.4, 1800); } catch(_) {}
        }
      }
      // Let music transition settle before closing
      later(() => closeRoom(), 2800);
      break;

    case ST.ROOM_CLOSING:
      doors.classList.add('closing');
      // Music already faded in LIGHTS_OFF_AGAIN
      later(() => {
        overlay.style.transition = 'opacity 800ms ease';
        overlay.style.opacity = '0';
        later(() => closeRoomCleanup(), 800);
      }, birthdayRoomConfig.timing.doorsClose + birthdayRoomConfig.timing.doorsHold);
      break;
  }
}

/* ============================================================
   5. Light switch
   ============================================================ */
function tryRestartAmbient() {
  // After lights come on (a real user gesture happened when they clicked
  // the switch), try to start ambient audio if nothing else is playing.
  if (!AudioManager) return;
  if (!AudioManager.active) {
    const bgAudio = $('#bgAudio');
    if (bgAudio) {
      try {
        bgAudio.volume = 0.35;
        AudioManager.play(bgAudio);
      } catch(_){}
    }
  }
}

lightSwitch.addEventListener('click', () => {
  if (birthdayRoomState.lightsOn) return;
  birthdayRoomState.lightsOn = true;
  lightSwitch.setAttribute('aria-pressed', 'true');
  setState(ST.LIGHTS_ON);
});

/* ============================================================
   6. Caption helper
   ============================================================ */
function setCaption(text) {
  captionText.textContent = text;
  if (text) {
    captionEl.classList.add('show');
  } else {
    captionEl.classList.remove('show');
  }
}

/* ============================================================
   7. Build fairy lights bulbs
   ============================================================ */
(function buildStringLights() {
  const N = 12;
  const w = stringLights.offsetWidth || 800;
  for (let i = 0; i < N; i++) {
    const b = document.createElement('span');
    b.className = 'br-bulb';
    b.style.left = ((i + 0.5) * (100 / N)) + '%';
    b.style.top  = (8 + Math.sin(i * 0.7) * 4) + 'px';
    b.style.animationDelay = (i * 0.2) + 's';
    stringLights.appendChild(b);
  }



})();

/* ---- Live clock hands ---- */
(function startClock() {
  const hourHand   = $('#brClockHour');
  const minuteHand = $('#brClockMinute');
  const face       = $('#brClockFace');
  if (!hourHand || !minuteHand || !face) return;

  // Add hour markers
  [12,3,6,9].forEach((n, i) => {
    const num = document.createElement('span');
    num.className = 'br-clock-num';
    num.textContent = n;
    const ang = (i * 90 - 90) * Math.PI / 180;
    num.style.position = 'absolute';
    num.style.left = (50 + Math.cos(ang) * 36) + '%';
    num.style.top  = (50 + Math.sin(ang) * 36) + '%';
    num.style.transform = 'translate(-50%,-50%)';
    num.style.fontSize  = 'clamp(6px,1vw,11px)';
    num.style.fontWeight = '700';
    num.style.color = '#5c3a1e';
    num.style.fontFamily = 'serif';
    face.insertBefore(num, face.firstChild);
  });

  // Add tick marks
  for (let i = 0; i < 12; i++) {
    const tick = document.createElement('div');
    tick.style.cssText = `
      position:absolute; width:${i%3===0?'3':'2'}px; height:${i%3===0?'14':'8'}%
      ; background:#8b6914; border-radius:2px;
      left:50%; bottom:50%; transform-origin:bottom center;
      transform:translateX(-50%) rotate(${i*30}deg) translateY(${i%3===0?'130':'145'}%);
      opacity:${i%3===0?'0.8':'0.4'};`;
    face.insertBefore(tick, face.firstChild);
  }

  function tickClock() {
    const now = new Date();
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    hourHand.style.transform   = `rotate(${h * 30 + m * 0.5}deg)`;
    minuteHand.style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
  }
  tickClock();
  setInterval(tickClock, 10000);
})();

/* ---- Dust motes (only when lit) ---- */
let dustInterval = null;
function startDust() {
  const dustEl = $('#brDust');
  if (!dustEl || PRM) return;
  dustInterval = setInterval(() => {
    const mote = document.createElement('div');
    mote.className = 'br-dust-mote';
    const size = 1.5 + Math.random() * 2.5;
    mote.style.width  = size + 'px';
    mote.style.height = size + 'px';
    mote.style.left   = (10 + Math.random() * 80) + '%';
    mote.style.bottom = (8 + Math.random() * 40) + '%';
    mote.style.setProperty('--dx', (Math.random() * 40 - 20) + 'px');
    const dur = 6 + Math.random() * 8;
    mote.style.animationDuration = dur + 's';
    mote.style.animationDelay   = (Math.random() * 2) + 's';
    dustEl.appendChild(mote);
    setTimeout(() => mote.remove(), (dur + 2) * 1000);
  }, 800);
}
function stopDust() {
  if (dustInterval) { clearInterval(dustInterval); dustInterval = null; }
  const dustEl = $('#brDust');
  if (dustEl) dustEl.innerHTML = '';
}


function showTray() {
  tray.hidden = false;
  requestAnimationFrame(() => tray.classList.add('show'));
  overlay.classList.add('tray-open');
  startIdleHint();
}
function hideTray() {
  tray.classList.remove('show');
  overlay.classList.remove('tray-open');
  stopIdleHint();
  later(() => { tray.hidden = true; }, 500);
}

/* Progress counter */
function updateProgress() {
  const prog = $('#brTrayProgress');
  if (!prog) return;
  prog.textContent = placedDecorations.size + ' / ' + birthdayRoomConfig.requiredDecorations.length;
  prog.classList.remove('updated');
  void prog.offsetWidth;
  prog.classList.add('updated');
  setTimeout(() => prog.classList.remove('updated'), 450);
}

/* Build tray items with emoji + label */
function buildTrayItems() {
  trayItems.innerHTML = '';
  birthdayRoomConfig.decorations.forEach(d => {
    const item = document.createElement('button');
    item.className = 'br-tray-item';
    item.type = 'button';
    item.setAttribute('aria-label', 'Place ' + d.kind);
    item.dataset.kind = d.kind;
    item.innerHTML =
      '<span class="br-emoji">' + d.emoji + '</span>' +
      '<span class="br-item-label">' + d.kind + '</span>';
    trayItems.appendChild(item);
  });
}
buildTrayItems();

/* Idle hint — shows after 5s of no placement */
let hintTimer = null;
const hintEl = $('#brTrayHint');
function startIdleHint() {
  stopIdleHint();
  hintTimer = setTimeout(() => {
    if (hintEl) hintEl.hidden = false;
  }, 5000);
}
function stopIdleHint() {
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  if (hintEl) hintEl.hidden = true;
}

/* ---- SVG art for each decoration ---- */
function getDecorationHTML(kind) {
  switch (kind) {
    case 'balloons': return `
      <div class="dec-balloons">
        <svg viewBox="0 0 130 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
          <!-- Left balloon - pink -->
          <ellipse cx="38" cy="60" rx="30" ry="36" fill="#F4A0B0"/>
          <ellipse cx="38" cy="60" rx="30" ry="36" fill="url(#blL)" opacity="0.7"/>
          <ellipse cx="26" cy="44" rx="10" ry="7" fill="rgba(255,255,255,0.4)" transform="rotate(-20,26,44)"/>
          <path d="M38 96 Q35 108 32 114 Q38 110 44 114 Q41 108 38 96" fill="#F4A0B0"/>
          <path d="M38 115 Q50 145 65 192" stroke="#bbb" stroke-width="1.2" fill="none"/>
          <!-- Middle balloon - coral (biggest, front) -->
          <ellipse cx="65" cy="50" rx="36" ry="42" fill="#E8837A"/>
          <ellipse cx="65" cy="50" rx="36" ry="42" fill="url(#blM)" opacity="0.7"/>
          <ellipse cx="50" cy="32" rx="12" ry="8" fill="rgba(255,255,255,0.4)" transform="rotate(-20,50,32)"/>
          <path d="M65 92 Q62 106 59 114 Q65 110 71 114 Q68 106 65 92" fill="#E8837A"/>
          <path d="M65 115 Q65 150 65 192" stroke="#bbb" stroke-width="1.2" fill="none"/>
          <!-- Right balloon - blue -->
          <ellipse cx="96" cy="62" rx="28" ry="34" fill="#90B0F0"/>
          <ellipse cx="96" cy="62" rx="28" ry="34" fill="url(#blR)" opacity="0.7"/>
          <ellipse cx="84" cy="47" rx="9" ry="6" fill="rgba(255,255,255,0.4)" transform="rotate(-20,84,47)"/>
          <path d="M96 96 Q93 108 90 114 Q96 110 102 114 Q99 108 96 96" fill="#90B0F0"/>
          <path d="M96 115 Q85 148 65 192" stroke="#bbb" stroke-width="1.2" fill="none"/>
          <!-- String bundle knot -->
          <circle cx="65" cy="193" r="4" fill="#999"/>
          <!-- Vertical string to floor -->
          <line x1="65" y1="197" x2="65" y2="200" stroke="#bbb" stroke-width="1.5"/>
          <defs>
            <radialGradient id="blL" cx="35%" cy="35%">
              <stop offset="0%" stop-color="rgba(255,255,255,0.3)"/>
              <stop offset="100%" stop-color="rgba(0,0,0,0.15)"/>
            </radialGradient>
            <radialGradient id="blM" cx="35%" cy="35%">
              <stop offset="0%" stop-color="rgba(255,255,255,0.3)"/>
              <stop offset="100%" stop-color="rgba(0,0,0,0.15)"/>
            </radialGradient>
            <radialGradient id="blR" cx="35%" cy="35%">
              <stop offset="0%" stop-color="rgba(255,255,255,0.3)"/>
              <stop offset="100%" stop-color="rgba(0,0,0,0.15)"/>
            </radialGradient>
          </defs>
        </svg>
      </div>`;

    case 'banner': return `
      <div class="dec-banner-full">
        <svg viewBox="0 0 700 90" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">
          <!-- Left nail -->
          <circle cx="8" cy="4" r="5" fill="#c8a96e"/><circle cx="8" cy="4" r="3" fill="#f0d080"/>
          <!-- Right nail -->
          <circle cx="692" cy="4" r="5" fill="#c8a96e"/><circle cx="692" cy="4" r="3" fill="#f0d080"/>
          <!-- Main string -->
          <path d="M8 4 Q175 55 350 38 Q525 20 692 4" fill="none" stroke="#c8a96e" stroke-width="2.5"/>
          <!-- Flag pennants -->
          ${(() => {
            const colors = ['#E8837A','#7090D0','#F4C430','#C87890','#90B0F0','#E8A87A','#B0D0F0','#D4709A','#7090D0','#E8837A','#F4C430','#C87890'];
            const pts = [];
            for(let i=0;i<12;i++){
              const t = i/11;
              // catenary-like y position along the string
              const x = 30 + i*56;
              const strY = 4 + 51*4*t*(1-t); // parabola peak ~55px at center
              pts.push('<polygon points="'+(x)+','+(strY)+' '+(x+24)+','+(strY)+' '+(x+12)+','+(strY+32)+'" fill="'+colors[i]+'" opacity="0.95" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>');
            }
            return pts.join('');
          })()}
        </svg>
        <div class="dec-banner-text">🎂 happy birthday, babe 🎂</div>
      </div>`;

    case 'photo': {
      const url = birthdayRoomConfig.photoUrl;
      const hasPhoto = url && url !== 'PHOTO_URL_HERE';
      return `
        <div class="dec-photo-frame">
          <div class="dec-photo-outer">
            <div class="dec-photo-mat">
              ${hasPhoto
                ? '<img src="' + url + '" class="dec-photo-img" alt="our photo" />'
                : '<div class="dec-photo-placeholder"><svg viewBox="0 0 80 80" width="56" height="56" xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="28" r="14" fill="#C87890" opacity="0.5"/><path d="M10 70 Q40 42 70 70" fill="#C87890" opacity="0.3"/></svg></div>'
              }
            </div>
            <div class="dec-photo-corner dec-photo-corner-tl"></div>
            <div class="dec-photo-corner dec-photo-corner-tr"></div>
            <div class="dec-photo-corner dec-photo-corner-bl"></div>
            <div class="dec-photo-corner dec-photo-corner-br"></div>
          </div>
        </div>`;
    }

    case 'flowers': return `
      <div class="dec-flowers">
        <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
          <!-- Stems -->
          <path d="M40 115 Q38 90 35 70" stroke="#4a7c59" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M60 118 Q60 95 60 75" stroke="#4a7c59" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M80 115 Q82 90 85 70" stroke="#4a7c59" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M50 110 Q45 95 42 82" stroke="#4a7c59" stroke-width="2" fill="none"/>
          <path d="M70 112 Q75 95 78 84" stroke="#4a7c59" stroke-width="2" fill="none"/>
          <!-- Leaves -->
          <ellipse cx="32" cy="88" rx="9" ry="5" fill="#5a9c69" transform="rotate(-40,32,88)"/>
          <ellipse cx="88" cy="88" rx="9" ry="5" fill="#5a9c69" transform="rotate(40,88,88)"/>
          <!-- Rose left -->
          <circle cx="35" cy="58" r="14" fill="#E8837A" opacity="0.9"/>
          <circle cx="35" cy="58" r="10" fill="#d0606a" opacity="0.7"/>
          <circle cx="35" cy="58" r="6"  fill="#C84050" opacity="0.8"/>
          <ellipse cx="29" cy="52" rx="7" ry="5" fill="#E8837A" opacity="0.6" transform="rotate(-30,29,52)"/>
          <ellipse cx="41" cy="52" rx="7" ry="5" fill="#E8837A" opacity="0.6" transform="rotate(30,41,52)"/>
          <!-- Cherry blossom center -->
          <circle cx="60" cy="62" r="13" fill="#F4A7B9" opacity="0.9"/>
          ${[0,72,144,216,288].map(a => {
            const rad = a * Math.PI / 180;
            const px = 60 + Math.cos(rad) * 10;
            const py = 62 + Math.sin(rad) * 10;
            return '<ellipse cx="' + px + '" cy="' + py + '" rx="6" ry="4" fill="#F4A7B9" opacity="0.85" transform="rotate(' + a + ',' + px + ',' + py + ')"/>';
          }).join('')}
          <circle cx="60" cy="62" r="4" fill="#FFE066"/>
          <!-- Blue flower right -->
          <circle cx="85" cy="58" r="13" fill="#90B0F0" opacity="0.9"/>
          ${[0,60,120,180,240,300].map(a => {
            const rad = a * Math.PI / 180;
            const px = 85 + Math.cos(rad) * 10;
            const py = 58 + Math.sin(rad) * 10;
            return '<ellipse cx="' + px + '" cy="' + py + '" rx="6" ry="3.5" fill="#7090D0" opacity="0.8" transform="rotate(' + a + ',' + px + ',' + py + ')"/>';
          }).join('')}
          <circle cx="85" cy="58" r="4" fill="#FFE066"/>
          <!-- Small buds -->
          <circle cx="48" cy="70" r="7" fill="#F4A7B9" opacity="0.8"/>
          <circle cx="73" cy="72" r="6" fill="#E8837A" opacity="0.75"/>
          <!-- Vase -->
          <path d="M30 130 Q30 118 40 115 L80 115 Q90 118 90 130 Q88 138 60 138 Q32 138 30 130Z" fill="#D0C4F0" stroke="#B0A0E0" stroke-width="1.5"/>
          <ellipse cx="60" cy="115" rx="20" ry="5" fill="#E0D8F8"/>
          <path d="M35 122 Q60 126 85 122" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
        </svg>
      </div>`;

    case 'gift': return `
      <div class="dec-gift">
        <svg viewBox="0 0 110 130" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
          <!-- Shadow -->
          <ellipse cx="55" cy="126" rx="38" ry="5" fill="rgba(0,0,0,0.15)"/>
          <!-- Box body -->
          <rect x="12" y="58" width="86" height="62" rx="4" fill="#E8837A"/>
          <rect x="12" y="58" width="86" height="62" rx="4" fill="url(#giftGrad)"/>
          <!-- Lid -->
          <rect x="8"  y="44" width="94" height="20" rx="4" fill="#C84060"/>
          <!-- Vertical ribbon on lid -->
          <rect x="48" y="44" width="14" height="20" fill="#FFE066" opacity="0.9"/>
          <!-- Vertical ribbon on body -->
          <rect x="48" y="64" width="14" height="56" fill="#FFE066" opacity="0.9"/>
          <!-- Horizontal ribbon on body -->
          <rect x="12" y="82" width="86" height="12" fill="#FFE066" opacity="0.9"/>
          <!-- Bow left loop -->
          <ellipse cx="38" cy="38" rx="18" ry="11" fill="#FFD700" transform="rotate(-25,38,38)" opacity="0.95"/>
          <ellipse cx="38" cy="38" rx="13" ry="7" fill="#E6C200" transform="rotate(-25,38,38)" opacity="0.7"/>
          <!-- Bow right loop -->
          <ellipse cx="72" cy="38" rx="18" ry="11" fill="#FFD700" transform="rotate(25,72,38)" opacity="0.95"/>
          <ellipse cx="72" cy="38" rx="13" ry="7" fill="#E6C200" transform="rotate(25,72,38)" opacity="0.7"/>
          <!-- Bow center knot -->
          <ellipse cx="55" cy="40" rx="9" ry="7" fill="#FFC200"/>
          <!-- Shine on lid -->
          <ellipse cx="32" cy="50" rx="8" ry="3" fill="rgba(255,255,255,0.25)" transform="rotate(-15,32,50)"/>
          <!-- Gift tag — open when... -->
          <rect x="72" y="18" width="36" height="18" rx="3" fill="#fff8e0" stroke="#c8a96e" stroke-width="1"/>
          <circle cx="72" cy="27" r="2.5" fill="#c8a96e"/>
          <line x1="66" y1="27" x2="72" y2="27" stroke="#c8a96e" stroke-width="1"/>
          <text x="90" y="30" text-anchor="middle" font-size="5" fill="#8b6914" font-family="serif">open when</text>
          <text x="90" y="32" text-anchor="middle" font-size="4" fill="#8b6914" font-family="serif">you miss me</text>
          <defs>
            <linearGradient id="giftGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
              <stop offset="100%" stop-color="rgba(0,0,0,0.1)"/>
            </linearGradient>
          </defs>
        </svg>
      </div>`;


    case 'lights': return `
      <div class="dec-fairy-lights">
        <svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">
          <!-- String -->
          <path d="M5 20 Q75 50 150 35 Q225 20 295 40" fill="none" stroke="#c8a96e" stroke-width="1.8"/>
          ${(() => {
            const colors = ['#FFD700','#FF6B6B','#6BB5FF','#FF9EE5','#98FF98','#FFB347','#C8A9F0','#FFD700','#FF6B6B','#6BB5FF'];
            return colors.map((c,i) => {
              const t = i/9;
              const x = 5 + t*290;
              const y = 20 + 30*4*t*(1-t) + (i%2===0?-6:6);
              return `<ellipse cx="${x}" cy="${y+10}" rx="7" ry="10" fill="${c}" opacity="0.92" filter="url(#glow${i})"/>
                      <ellipse cx="${x}" cy="${y+4}" rx="4" ry="4" fill="${c}" opacity="0.5"/>
                      <rect x="${x-2}" y="${y}" width="4" height="4" fill="#888" rx="1"/>
                      <filter id="glow${i}"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
            }).join('');
          })()}
        </svg>
      </div>`;

    case 'confetti': return `
      <div class="dec-confetti-burst">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
          ${(() => {
            const pieces = [
              {x:40,y:30,w:12,h:8,rot:20,c:'#E8837A'},{x:80,y:15,w:8,h:12,rot:-30,c:'#7090D0'},
              {x:130,y:25,w:14,h:7,rot:45,c:'#FFD700'},{x:160,y:40,w:9,h:13,rot:-15,c:'#C87890'},
              {x:20,y:70,w:10,h:10,rot:60,c:'#90B0F0'},{x:170,y:80,w:12,h:8,rot:-45,c:'#F4A7B9'},
              {x:55,y:120,w:8,h:14,rot:30,c:'#E8837A'},{x:145,y:130,w:14,h:8,rot:-20,c:'#7090D0'},
              {x:100,y:50,w:10,h:10,rot:15,c:'#FFD700'},{x:90,y:150,w:12,h:7,rot:50,c:'#C87890'},
              {x:30,y:155,w:7,h:12,rot:-35,c:'#90B0F0'},{x:165,y:165,w:9,h:9,rot:25,c:'#F4A7B9'},
              // circles
              {x:110,y:90,r:6,c:'#E8837A'},{x:60,y:80,r:5,c:'#FFD700'},
              {x:150,y:100,r:7,c:'#7090D0'},{x:35,y:105,r:5,c:'#C87890'},
              // streamers
            ];
            return pieces.map(p => p.r
              ? `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${p.c}" opacity="0.9"/>`
              : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.c}" opacity="0.88" rx="2" transform="rotate(${p.rot} ${p.x+p.w/2} ${p.y+p.h/2})"/>`
            ).join('') +
            // streamers
            `<path d="M95 10 Q80 50 100 90 Q120 130 95 170" fill="none" stroke="#E8837A" stroke-width="3" opacity="0.6" stroke-linecap="round"/>
             <path d="M115 5 Q135 45 115 85 Q95 125 115 165" fill="none" stroke="#7090D0" stroke-width="3" opacity="0.6" stroke-linecap="round"/>`;
          })()}
        </svg>
      </div>`;

    case 'heartwall': return `
      <div class="dec-heartwall">
        <svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
          ${(() => {
            const hearts = [
              {x:20,y:20,s:1.1,c:'#E8837A',op:0.9},{x:65,y:10,s:0.7,c:'#C87890',op:0.7},
              {x:105,y:18,s:1.2,c:'#F4A7B9',op:0.85},{x:155,y:8,s:0.8,c:'#E8837A',op:0.75},
              {x:190,y:22,s:0.9,c:'#C87890',op:0.8},
              {x:5,y:65,s:0.8,c:'#F4A7B9',op:0.7},{x:48,y:58,s:1.3,c:'#E8837A',op:0.95},
              {x:100,y:55,s:0.9,c:'#C87890',op:0.8},{x:148,y:60,s:1.1,c:'#F4A7B9',op:0.85},
              {x:195,y:58,s:0.7,c:'#E8837A',op:0.7},
              {x:25,y:115,s:1.0,c:'#C87890',op:0.8},{x:75,y:108,s:0.8,c:'#E8837A',op:0.75},
              {x:120,y:112,s:1.2,c:'#F4A7B9',op:0.9},{x:168,y:105,s:0.9,c:'#C87890',op:0.8},
              {x:205,y:118,s:0.7,c:'#E8837A',op:0.7},
            ];
            const hPath = 'M0,-8 C0,-14 -10,-18 -10,-8 C-10,2 0,10 0,10 C0,10 10,2 10,-8 C10,-18 0,-14 0,-8';
            return hearts.map(h =>
              `<path d="${hPath}" fill="${h.c}" opacity="${h.op}" transform="translate(${h.x},${h.y}) scale(${h.s})"/>`
            ).join('');
          })()}
          <!-- Centre big heart — no text -->
          <path d="M0,-18 C0,-32 -22,-38 -22,-18 C-22,4 0,22 0,22 C0,22 22,4 22,-18 C22,-38 0,-32 0,-18"
            fill="#E8837A" opacity="0.95" transform="translate(110,80)"/>
          <!-- Small heart pulse -->
          <path d="M0,-6 C0,-10 -7,-12 -7,-6 C-7,0 0,6 0,6 C0,6 7,0 7,-6 C7,-12 0,-10 0,-6"
            fill="white" opacity="0.4" transform="translate(110,80)"/>
        </svg>
      </div>`;

    case 'polaroids': return `
      <div class="dec-polaroids">
        <!-- Left polaroid — sunset sky -->
        <div class="dec-pol dec-pol-l">
          <div class="dec-pol-frame">
            <div class="dec-pol-img">
              <svg viewBox="0 0 60 55" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="sky1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#2a4080"/>
                    <stop offset="50%" stop-color="#E8837A"/>
                    <stop offset="100%" stop-color="#FFD700"/>
                  </linearGradient>
                </defs>
                <rect width="60" height="55" fill="url(#sky1)"/>
                <!-- Moon -->
                <circle cx="46" cy="10" r="7" fill="#fff8e0" opacity="0.9"/>
                <circle cx="49" cy="8" r="5" fill="#2a4080" opacity="0.8"/>
                <!-- Stars -->
                <circle cx="8" cy="8" r="1" fill="white" opacity="0.8"/>
                <circle cx="20" cy="5" r="1.2" fill="white" opacity="0.9"/>
                <circle cx="30" cy="12" r="0.8" fill="white" opacity="0.7"/>
                <circle cx="14" cy="18" r="1" fill="white" opacity="0.6"/>
                <!-- Silhouette city far -->
                <rect x="0" y="38" width="60" height="17" fill="#1a2040"/>
                <rect x="4" y="30" width="6" height="8" fill="#1a2040"/>
                <rect x="14" y="28" width="5" height="10" fill="#1a2040"/>
                <rect x="22" y="33" width="8" height="5" fill="#1a2040"/>
                <rect x="40" y="29" width="5" height="9" fill="#1a2040"/>
                <rect x="50" y="32" width="7" height="6" fill="#1a2040"/>
                <!-- Window lights -->
                <rect x="5" y="32" width="2" height="2" fill="#FFD700" opacity="0.8"/>
                <rect x="15" y="30" width="2" height="2" fill="#FFD700" opacity="0.7"/>
                <rect x="42" y="31" width="2" height="2" fill="#FFD700" opacity="0.8"/>
              </svg>
            </div>
            <p class="dec-pol-caption">your city 🌙</p>
          </div>
        </div>
        <!-- Right polaroid — stars night -->
        <div class="dec-pol dec-pol-r">
          <div class="dec-pol-frame">
            <div class="dec-pol-img">
              <svg viewBox="0 0 60 55" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="sky2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0a0d18"/>
                    <stop offset="100%" stop-color="#1a2550"/>
                  </linearGradient>
                </defs>
                <rect width="60" height="55" fill="url(#sky2)"/>
                <!-- Stars -->
                ${Array.from({length:18},(_,i)=>
                  '<circle cx="'+(4+i*3.2)+'" cy="'+(3+Math.sin(i*1.3)*12)+'" r="'+(0.8+Math.sin(i)*0.5)+'" fill="white" opacity="'+(0.5+Math.cos(i)*0.4)+'"/>'
                ).join('')}
                <!-- Big star -->
                <polygon points="30,8 31.5,13 36,13 32.5,16 34,21 30,18 26,21 27.5,16 24,13 28.5,13" fill="#FFD700" opacity="0.9"/>
                <!-- Rolling hills -->
                <path d="M0 42 Q15 34 30 38 Q45 42 60 36 L60 55 L0 55 Z" fill="#1a3020"/>
                <path d="M0 48 Q20 40 40 44 Q52 46 60 42 L60 55 L0 55 Z" fill="#0d2010"/>
                <!-- Fireflies -->
                <circle cx="10" cy="44" r="1.5" fill="#90FF90" opacity="0.8"/>
                <circle cx="45" cy="40" r="1.2" fill="#90FF90" opacity="0.7"/>
                <circle cx="22" cy="47" r="1" fill="#90FF90" opacity="0.6"/>
              </svg>
            </div>
            <p class="dec-pol-caption">my city 🌟</p>
          </div>
        </div>
      </div>`;

    case 'candles': return `
      <div class="dec-table-candles">
        <svg viewBox="0 0 160 140" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
          <!-- Left tall candle -->
          <rect x="28" y="40" width="18" height="80" rx="3" fill="#F4C8D0"/>
          <rect x="28" y="40" width="18" height="80" rx="3" fill="url(#cwL)"/>
          <ellipse cx="37" cy="40" rx="9" ry="4" fill="#f8d8e0"/>
          <line x1="37" y1="36" x2="37" y2="28" stroke="#333" stroke-width="1.5"/>
          <ellipse cx="37" cy="24" rx="5" ry="8" fill="#FFD700" opacity="0.9"/>
          <ellipse cx="37" cy="20" rx="3" ry="5" fill="#FFF" opacity="0.6"/>
          <ellipse cx="34" cy="42" rx="3" ry="6" fill="rgba(255,255,255,0.2)"/>
          <!-- Middle short candle -->
          <rect x="71" y="70" width="16" height="50" rx="3" fill="#C8E0F4"/>
          <ellipse cx="79" cy="70" rx="8" ry="3.5" fill="#d8eef8"/>
          <line x1="79" y1="66" x2="79" y2="59" stroke="#333" stroke-width="1.5"/>
          <ellipse cx="79" cy="55" rx="5" ry="8" fill="#FFB347" opacity="0.9"/>
          <ellipse cx="79" cy="51" rx="3" ry="5" fill="#FFF" opacity="0.5"/>
          <!-- Right tall candle -->
          <rect x="114" y="45" width="18" height="75" rx="3" fill="#D4C8F4"/>
          <ellipse cx="123" cy="45" rx="9" ry="4" fill="#e4d8ff"/>
          <line x1="123" y1="41" x2="123" y2="33" stroke="#333" stroke-width="1.5"/>
          <ellipse cx="123" cy="29" rx="5" ry="8" fill="#FF9EE5" opacity="0.9"/>
          <ellipse cx="123" cy="25" rx="3" ry="5" fill="#FFF" opacity="0.55"/>
          <!-- Candleholders -->
          <ellipse cx="37" cy="122" rx="14" ry="5" fill="#d4af5a"/>
          <rect x="30" y="118" width="14" height="6" rx="2" fill="#c8a96e"/>
          <ellipse cx="79" cy="122" rx="12" ry="4.5" fill="#d4af5a"/>
          <rect x="72" y="118" width="14" height="6" rx="2" fill="#c8a96e"/>
          <ellipse cx="123" cy="122" rx="14" ry="5" fill="#d4af5a"/>
          <rect x="116" y="118" width="14" height="6" rx="2" fill="#c8a96e"/>
          <!-- Wax drips -->
          <path d="M30 80 Q28 90 29 95" stroke="#f8d8e0" stroke-width="4" fill="none" stroke-linecap="round"/>
          <path d="M118 85 Q120 95 119 100" stroke="#e4d8ff" stroke-width="4" fill="none" stroke-linecap="round"/>
          <defs>
            <linearGradient id="cwL" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="rgba(0,0,0,0.08)"/>
              <stop offset="40%" stop-color="rgba(255,255,255,0.15)"/>
              <stop offset="100%" stop-color="rgba(0,0,0,0.06)"/>
            </linearGradient>
          </defs>
        </svg>
      </div>`;

    case 'balloons2': return `
      <div class="dec-balloons">
        <svg viewBox="0 0 130 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
          <ellipse cx="38" cy="60" rx="30" ry="36" fill="#90B0F0"/>
          <ellipse cx="38" cy="60" rx="30" ry="36" fill="url(#bl2L)" opacity="0.7"/>
          <ellipse cx="26" cy="44" rx="10" ry="7" fill="rgba(255,255,255,0.4)" transform="rotate(-20,26,44)"/>
          <path d="M38 96 Q35 108 32 114 Q38 110 44 114 Q41 108 38 96" fill="#90B0F0"/>
          <path d="M38 115 Q50 145 65 192" stroke="#bbb" stroke-width="1.2" fill="none"/>
          <ellipse cx="65" cy="50" rx="36" ry="42" fill="#7090D0"/>
          <ellipse cx="65" cy="50" rx="36" ry="42" fill="url(#bl2M)" opacity="0.7"/>
          <ellipse cx="50" cy="32" rx="12" ry="8" fill="rgba(255,255,255,0.4)" transform="rotate(-20,50,32)"/>
          <path d="M65 92 Q62 106 59 114 Q65 110 71 114 Q68 106 65 92" fill="#7090D0"/>
          <path d="M65 115 Q65 150 65 192" stroke="#bbb" stroke-width="1.2" fill="none"/>
          <ellipse cx="96" cy="62" rx="28" ry="34" fill="#B0D0F0"/>
          <ellipse cx="96" cy="62" rx="28" ry="34" fill="url(#bl2R)" opacity="0.7"/>
          <ellipse cx="84" cy="47" rx="9" ry="6" fill="rgba(255,255,255,0.4)" transform="rotate(-20,84,47)"/>
          <path d="M96 96 Q93 108 90 114 Q96 110 102 114 Q99 108 96 96" fill="#B0D0F0"/>
          <path d="M96 115 Q85 148 65 192" stroke="#bbb" stroke-width="1.2" fill="none"/>
          <circle cx="65" cy="193" r="4" fill="#999"/>
          <defs>
            <radialGradient id="bl2L" cx="35%" cy="35%"><stop offset="0%" stop-color="rgba(255,255,255,0.3)"/><stop offset="100%" stop-color="rgba(0,0,0,0.15)"/></radialGradient>
            <radialGradient id="bl2M" cx="35%" cy="35%"><stop offset="0%" stop-color="rgba(255,255,255,0.3)"/><stop offset="100%" stop-color="rgba(0,0,0,0.15)"/></radialGradient>
            <radialGradient id="bl2R" cx="35%" cy="35%"><stop offset="0%" stop-color="rgba(255,255,255,0.3)"/><stop offset="100%" stop-color="rgba(0,0,0,0.15)"/></radialGradient>
          </defs>
        </svg>
      </div>`;

    default: return '<span style="font-size:40px">🎀</span>';
  }
}

/* Place a decoration into its zone */
function placeDecoration(kind, zone) {
  // Guard against double-placement (drag + click firing together)
  if (placedDecorations.has(kind)) return;
  if (zone.classList.contains('filled')) return;

  if (dragging && dragging.ghostEl) dragging.ghostEl.remove();
  stopIdleHint();

  // Mark tray item used
  const trayItem = trayItems.querySelector('.br-tray-item[data-kind="' + kind + '"]');
  if (trayItem) trayItem.classList.add('used');

  // Mark zone filled
  zone.classList.add('filled');
  zone.classList.remove('active');

  // Inject realistic SVG art
  const placed = document.createElement('div');
  placed.className = 'br-placed ' + kind;
  placed.innerHTML = getDecorationHTML(kind);
  zone.appendChild(placed);
  // Sparkle burst at placement zone
  later(() => sparkleAt(zone), 100);

  // Banner: also update the real banner element in the room
  if (kind === 'banner') {
    const bannerEl = $('#brBanner');
    if (bannerEl) bannerEl.classList.add('pre-visible');
  }

  placedDecorations.add(kind);
  updateProgress();

  // Restart idle hint if not all placed yet
  const remaining = birthdayRoomConfig.requiredDecorations.filter(k => !placedDecorations.has(k));
  if (remaining.length > 0) {
    startIdleHint();
    const labels = {'balloons':'balloons 🎈','banner':'banner','photo':'photo frame 🖼️','flowers':'flowers 🌸','gift':'gift box 🎁','lights':'string lights ✨','confetti':'letters ✉️','heartwall':'heart wall 💝','polaroids':'polaroids 📸','candles':'candles 🕯️'};
    if (hintEl) hintEl.innerHTML = '<span>👆</span> ' + remaining.length + ' more — try the <b>' + (labels[remaining[0]]||remaining[0]) + '</b>!';
    showZoneArrow(remaining[0]);
  }

  // Check completion
  const allPlaced = birthdayRoomConfig.requiredDecorations.every(k => placedDecorations.has(k));
  if (allPlaced && !birthdayRoomState.decorationsCompleted) {
    birthdayRoomState.decorationsCompleted = true;
    stopIdleHint();
    try { if (navigator.vibrate) navigator.vibrate([40,20,40,20,100]); } catch(_) {}
    later(() => { burstConfetti(); setState(ST.DECORATION_COMPLETE); }, 600);
  }
}

/* ---- Drag (desktop) ---- */
let dragging = null;
let suppressNextClick = false;
const DRAG_THRESHOLD = 8;

function startDrag(kind, clientX, clientY) {
  if (placedDecorations.has(kind)) return;
  const deco = birthdayRoomConfig.decorations.find(d => d.kind === kind);
  const ghost = document.createElement('div');
  ghost.className = 'br-drag-ghost';
  ghost.innerHTML = '<span class="br-emoji">' + (deco ? deco.emoji : '🎀') + '</span>';
  ghost.style.left = clientX + 'px';
  ghost.style.top  = clientY + 'px';
  document.body.appendChild(ghost);
  dragging = { kind, ghostEl: ghost, startX: clientX, startY: clientY, moved: false };
  $$('.br-dropzone').forEach(z => {
    if (z.dataset.zone === kind && !z.classList.contains('filled')) z.classList.add('active');
  });
}

function moveDrag(clientX, clientY) {
  if (!dragging) return;
  if (!dragging.moved) {
    const dx = Math.abs(clientX - dragging.startX);
    const dy = Math.abs(clientY - dragging.startY);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) dragging.moved = true;
  }
  dragging.ghostEl.style.left = clientX + 'px';
  dragging.ghostEl.style.top  = clientY + 'px';
}

function endDrag(clientX, clientY) {
  if (!dragging) return;
  const { kind, ghostEl, moved } = dragging;
  if (moved) suppressNextClick = true;
  if (!moved) {
    ghostEl.remove();
    $$('.br-dropzone').forEach(z => z.classList.remove('active'));
    dragging = null;
    return;
  }
  ghostEl.style.display = 'none';
  const target = document.elementFromPoint(clientX, clientY);
  ghostEl.style.display = '';
  let zone = target ? target.closest('.br-dropzone') : null;
  if (zone && zone.dataset.zone === kind && !zone.classList.contains('filled')) {
    placeDecoration(kind, zone);
  } else {
    ghostEl.remove();
  }
  $$('.br-dropzone').forEach(z => z.classList.remove('active'));
  dragging = null;
}

trayItems.addEventListener('pointerdown', (e) => {
  const item = e.target.closest('.br-tray-item');
  if (!item || item.classList.contains('used')) return;
  e.preventDefault();
  startDrag(item.dataset.kind, e.clientX, e.clientY);
});
document.addEventListener('pointermove', (e) => { if (dragging) moveDrag(e.clientX, e.clientY); }, { passive: true });
document.addEventListener('pointerup',   (e) => { if (dragging) endDrag(e.clientX, e.clientY); });
document.addEventListener('pointercancel', () => {
  if (dragging) { dragging.ghostEl.remove(); $$('.br-dropzone').forEach(z => z.classList.remove('active')); dragging = null; }
});

/* ---- Tap to place (primary mobile UX) ---- */
trayItems.addEventListener('click', (e) => {
  if (suppressNextClick) { suppressNextClick = false; return; }
  const item = e.target.closest('.br-tray-item');
  if (!item || item.classList.contains('used')) return;
  const kind = item.dataset.kind;
  if (placedDecorations.has(kind)) return;
  const zone = document.querySelector('.br-dropzone[data-zone="' + kind + '"]');
  if (zone && !zone.classList.contains('filled')) {
    // Flash zone to show where it lands
    zone.classList.add('active', 'tap-flash');
    setTimeout(() => {
      zone.classList.remove('tap-flash');
      placeDecoration(kind, zone);
    }, 280);
  }
});

/* Keyboard */
trayItems.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = e.target.closest('.br-tray-item');
  if (!item || item.classList.contains('used')) return;
  e.preventDefault();
  const kind = item.dataset.kind;
  const zone = document.querySelector('.br-dropzone[data-zone="' + kind + '"]');
  if (zone && !zone.classList.contains('filled')) placeDecoration(kind, zone);
});

/* ============================================================
   9. Cake — reveal + drag onto table
   ============================================================ */
function revealCake() {
  cakeEl.hidden = false;
  // Position off to the left of the table
  const roomRect = room.getBoundingClientRect();
  cakeEl.style.left = (roomRect.width * 0.08) + 'px';
  cakeEl.style.top  = (roomRect.height * 0.62) + 'px';
  setState(ST.CAKE_AVAILABLE);
  setCaption("Drag the cake onto the table maichaa 🎂");
}

function enableCakeDrag() {
  let startX, startY, origLeft, origTop;

  const onDown = (clientX, clientY) => {
    if (birthdayRoomState.cakePlaced) return;
    startX = clientX; startY = clientY;
    origLeft = parseInt(cakeEl.style.left || '0', 10);
    origTop  = parseInt(cakeEl.style.top  || '0', 10);
    cakeEl.style.transition = 'none';
    cakeEl.classList.remove('snapping'); // reset any previous snap transition
  };

  const onMove = (clientX, clientY) => {
    if (birthdayRoomState.cakePlaced) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    cakeEl.style.left = (origLeft + dx) + 'px';
    cakeEl.style.top  = (origTop  + dy) + 'px';
    // Highlight table when hovering
    const tableRect = table.getBoundingClientRect();
    if (clientX >= tableRect.left && clientX <= tableRect.right &&
        clientY >= tableRect.top  - 20 && clientY <= tableRect.bottom) {
      table.classList.add('drop-target');
    } else {
      table.classList.remove('drop-target');
    }
  };

  const onUp = (clientX, clientY) => {
    if (birthdayRoomState.cakePlaced) return;
    cakeEl.style.transition = '';
    const tableRect = table.getBoundingClientRect();
    if (clientX >= tableRect.left && clientX <= tableRect.right &&
        clientY >= tableRect.top  - 20 && clientY <= tableRect.bottom) {
      // Snap to center of table top
      const roomRect = room.getBoundingClientRect();
      const targetLeft = (tableRect.left - roomRect.left) + (tableRect.width / 2) - (cakeEl.offsetWidth / 2);
      const targetTop  = (tableRect.top  - roomRect.top)  - cakeEl.offsetHeight + 10;
      cakeEl.classList.add('snapping');
      cakeEl.style.left = targetLeft + 'px';
      cakeEl.style.top  = targetTop  + 'px';
      cakeEl.classList.add('placed');
      birthdayRoomState.cakePlaced = true;
      table.classList.remove('drop-target');
      setState(ST.CAKE_PLACED);
    } else {
      // Snap back to original position
      cakeEl.classList.add('snapping');
      cakeEl.style.left = origLeft + 'px';
      cakeEl.style.top  = origTop  + 'px';
    }
  };

  // Pointer events (covers mouse + touch on modern browsers)
  cakeEl.addEventListener('pointerdown', (e) => {
    if (birthdayRoomState.cakePlaced) return;
    e.preventDefault();
    onDown(e.clientX, e.clientY);
    const onM = (ev) => onMove(ev.clientX, ev.clientY);
    const onU = (ev) => {
      document.removeEventListener('pointermove', onM);
      document.removeEventListener('pointerup', onU);
      onUp(ev.clientX, ev.clientY);
    };
    document.addEventListener('pointermove', onM);
    document.addEventListener('pointerup', onU);
  });

  // Fallback for older browsers without PointerEvent
  if (!('PointerEvent' in window)) {
    cakeEl.addEventListener('mousedown', (e) => {
      if (birthdayRoomState.cakePlaced) return;
      e.preventDefault();
      onDown(e.clientX, e.clientY);
      const onM = (ev) => onMove(ev.clientX, ev.clientY);
      const onU = (ev) => {
        document.removeEventListener('mousemove', onM);
        document.removeEventListener('mouseup', onU);
        onUp(ev.clientX, ev.clientY);
      };
      document.addEventListener('mousemove', onM);
      document.addEventListener('mouseup', onU);
    });
    cakeEl.addEventListener('touchstart', (e) => {
      if (birthdayRoomState.cakePlaced) return;
      const t = e.touches[0];
      onDown(t.clientX, t.clientY);
      const onM = (ev) => { const t2 = ev.touches[0]; onMove(t2.clientX, t2.clientY); ev.preventDefault(); };
      const onU = (ev) => {
        document.removeEventListener('touchmove', onM);
        document.removeEventListener('touchend', onU);
        const t2 = ev.changedTouches[0];
        onUp(t2.clientX, t2.clientY);
      };
      document.addEventListener('touchmove', onM, { passive: false });
      document.addEventListener('touchend', onU);
    });
  }
}
enableCakeDrag();

/* ============================================================
   10. Candle — reveal + light
   ============================================================ */
function revealCandle() {
  setState(ST.CANDLE_AVAILABLE);
  setCaption("Light the candle now ✨");

  // Make candle clickable
  candleEl.style.cursor = 'pointer';
  candleEl.setAttribute('role', 'button');
  candleEl.setAttribute('tabindex', '0');
  candleEl.setAttribute('aria-label', 'Light the candle');

  const onKeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lightIt(); }
  };
  const lightIt = () => {
    if (birthdayRoomState.candleLit) return;
    birthdayRoomState.candleLit = true;
    candleFlame.classList.add('lit');
    candleGlow.classList.add('lit');
    candleEl.removeAttribute('role');
    candleEl.removeAttribute('tabindex');
    candleEl.style.cursor = 'default';
    // Clean up BOTH listeners so neither leaks (the un-fired one wouldn't auto-remove)
    candleEl.removeEventListener('click', lightIt);
    candleEl.removeEventListener('keydown', onKeydown);
    burstConfetti();
    setState(ST.CANDLE_LIT);
  };
  candleEl.addEventListener('click', lightIt);
  candleEl.addEventListener('keydown', onKeydown);
}

/* ============================================================
   11. Birthday music + particles
   ============================================================ */
function startBirthdayMusic() {
  setState(ST.BIRTHDAY_MUSIC);
  if (!AudioManager || !birthdayAudio) return;
  // Fade out ambient/track audio first
  if (AudioManager.active && AudioManager.active !== birthdayAudio) {
    AudioManager.fadeTo(AudioManager.active, 0, 800, () => {
      if (AudioManager.active && AudioManager.active !== birthdayAudio) {
        AudioManager.active.pause();
      }
    });
  }
  later(() => {
    try {
      birthdayAudio.volume = 0;
      birthdayAudio.loop = true;
      AudioManager.play(birthdayAudio);
      AudioManager.fadeTo(birthdayAudio, 0.88, 1200);
    } catch(_) {}
  }, 900);
}

let particlesOn = false;
let particleTimer = null;
function startParticles() {
  if (PRM) return;
  particlesOn = true;
  spawnParticles();
}
function stopParticles() {
  particlesOn = false;
  if (particleTimer) { clearTimeout(particleTimer); particleTimer = null; }
  // Clear existing
  particles.innerHTML = '';
}
function spawnParticles() {
  if (!particlesOn) return;
  const colors = ['#C87890', '#7090D0', '#B0D0F0', '#90B0F0', '#ffffff'];
  for (let i = 0; i < 3; i++) {
    const p = document.createElement('span');
    p.className = 'br-particle';
    p.style.left = (Math.random() * 100) + '%';
    p.style.bottom = '-10px';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    p.style.animationDuration = (4 + Math.random() * 4) + 's';
    p.style.animationDelay = (Math.random() * 2) + 's';
    particles.appendChild(p);
    setTimeout(() => p.remove(), 9000);
  }
  particleTimer = setTimeout(spawnParticles, 800);
}

/* Small confetti burst — used at decoration completion and candle lighting.
   Appended to the overlay (not document.body) so it sits above the room
   (overlay z-index 150; confetti z-index 250 within overlay). */
function burstConfetti() {
  if (PRM) return;
  const rect = cakeEl.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const cx = rect.left - overlayRect.left + rect.width / 2;
  const cy = rect.top  - overlayRect.top;
  const colors = ['#C87890', '#7090D0', '#304880', '#103070', '#B0D0F0'];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const c = document.createElement('span');
    c.className = 'br-confetti';
    c.setAttribute('aria-hidden', 'true');
    c.style.left = cx + 'px';
    c.style.top  = cy + 'px';
    c.style.background = colors[i % colors.length];
    const ang = (Math.PI * 2 * i) / N + (Math.random() * 0.4 - 0.2);
    const dist = 80 + Math.random() * 100;
    c.style.setProperty('--tx', (Math.cos(ang) * dist) + 'px');
    c.style.setProperty('--ty', (Math.sin(ang) * dist - 40) + 'px');
    overlay.appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }
}

/* ============================================================
   12. Knife — reveal + drag to cut cake
   ============================================================ */
function revealKnife() {
  setState(ST.CAKE_CUTTING);
  knifeEl.hidden = false;
  // Position knife above the cake
  const roomRect = room.getBoundingClientRect();
  const cakeRect = cakeEl.getBoundingClientRect();
  knifeEl.style.left = ((cakeRect.left - roomRect.left) + (cakeRect.width / 2) - 45) + 'px';
  knifeEl.style.top  = ((cakeRect.top  - roomRect.top)  - 60) + 'px';

  enableKnifeDrag();
}

function enableKnifeDrag() {
  let startX, startY, origLeft, origTop;
  let draggingKnife = false;
  let cutDone = false;
  let activeMoveListener = null;
  let activeUpListener = null;

  const onDown = (clientX, clientY) => {
    if (cutDone) return;
    draggingKnife = true;
    startX = clientX; startY = clientY;
    origLeft = parseInt(knifeEl.style.left || '0', 10);
    origTop  = parseInt(knifeEl.style.top  || '0', 10);
    knifeEl.style.transition = 'none';
  };
  const onMove = (clientX, clientY) => {
    if (!draggingKnife || cutDone) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    knifeEl.style.left = (origLeft + dx) + 'px';
    knifeEl.style.top  = (origTop  + dy) + 'px';

    // Check if the knife's pointed tip (right edge of blade) is over the cake
    // and we've moved enough horizontally to count as a slicing motion.
    const blade = knifeEl.querySelector('.br-knife-blade');
    const bladeRect = (blade || knifeEl).getBoundingClientRect();
    const knifeTipX = bladeRect.right;  // pointed tip is at the right of the blade
    const knifeTipY = bladeRect.top + bladeRect.height / 2;
    const cakeRect = cakeEl.getBoundingClientRect();
    if (knifeTipX >= cakeRect.left + 10 &&
        knifeTipX <= cakeRect.right - 10 &&
        knifeTipY >= cakeRect.top + 20 &&
        knifeTipY <= cakeRect.bottom) {
      if (Math.abs(dx) > 50 && !cutDone) {
        performCut();
      }
    }
  };
  const onUp = () => {
    draggingKnife = false;
    knifeEl.style.transition = '';
    // Remove document listeners so they don't pile up across multiple drags
    if (activeMoveListener) {
      document.removeEventListener('pointermove', activeMoveListener);
      activeMoveListener = null;
    }
    if (activeUpListener) {
      document.removeEventListener('pointerup', activeUpListener);
      activeUpListener = null;
    }
  };

  function performCut() {
    if (cutDone) return;
    cutDone = true;
    draggingKnife = false;
    // Remove document listeners
    if (activeMoveListener) {
      document.removeEventListener('pointermove', activeMoveListener);
      activeMoveListener = null;
    }
    if (activeUpListener) {
      document.removeEventListener('pointerup', activeUpListener);
      activeUpListener = null;
    }
    cakeEl.classList.add('cut');
    knifeEl.style.transition = 'opacity 600ms ease';
    knifeEl.style.opacity = '0';
    setCaption("");
    // Hug + kiss after cake cut
    later(() => {
      if (window.CharacterAnimation) {
        window.CharacterAnimation.playReaction()
          .then(() => window.CharacterAnimation.playMoveTogether())
          .then(() => window.CharacterAnimation.playHug())
          .then(() => window.CharacterAnimation.playKiss())
          .then(() => window.CharacterAnimation.returnToIdle());
      }
    }, 300);
    // Music keeps playing — only fades when lights go off
    later(() => stopParticles(), 600);
    later(() => {
      room.classList.remove('lit');
      room.classList.add('dim');
    }, 1000);
    // Short personal captions then show the letter
    later(() => setCaption("I wrote you one last thing 🤍"), 1200);
    later(() => { setCaption(""); setState(ST.WISH); }, 3200);
  }

  // Pointer events (mouse + touch on modern browsers)
  knifeEl.addEventListener('pointerdown', (e) => {
    if (cutDone) return;
    e.preventDefault();
    onDown(e.clientX, e.clientY);
    activeMoveListener = (ev) => onMove(ev.clientX, ev.clientY);
    activeUpListener = () => onUp();
    document.addEventListener('pointermove', activeMoveListener);
    document.addEventListener('pointerup', activeUpListener);
  });

  // Click fallback: a simple tap on the knife also cuts the cake.
  // (Suppressed if a real drag just happened — same pattern as tray items.)
  knifeEl.addEventListener('click', () => {
    if (cutDone) return;
    if (suppressNextClick) { suppressNextClick = false; return; }
    performCut();
  });

  // Keyboard: Enter triggers cut
  knifeEl.addEventListener('keydown', (e) => {
    if (cutDone) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      performCut();
    }
  });

  // Touch fallback for browsers without PointerEvent
  if (!('PointerEvent' in window)) {
    knifeEl.addEventListener('touchstart', (e) => {
      if (cutDone) return;
      const t = e.touches[0];
      onDown(t.clientX, t.clientY);
    }, { passive: true });
    knifeEl.addEventListener('touchmove', (e) => {
      if (!draggingKnife) return;
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    knifeEl.addEventListener('touchend', () => onUp());
  }
}

/* ============================================================
   13. Wish — typewriter
   ============================================================ */
function showWish() {
  birthdayRoomState.wishShown = true;
  wish.hidden = false;
  // Small delay so the .show transition fires
  requestAnimationFrame(() => wish.classList.add('show'));

  // Hide cue + button until typewriter finishes
  if (wishCue) wishCue.style.opacity = '0';
  if (blowBtn) blowBtn.style.opacity = '0';

  // Typewriter the wish body
  const text = birthdayRoomConfig.birthdayWish;
  wishBody.innerHTML = '<span class="cursor"></span>';
  const textHolder = document.createElement('span');
  wishBody.insertBefore(textHolder, wishBody.firstChild);
  let i = 0;
  const typeSpeed = PRM ? 0 : 32;
  function typeNext() {
    if (i >= text.length) {
      // Typing done — show cue and blow button with a gentle entrance
      later(() => {
        if (wishCue) { wishCue.style.opacity = '1'; wishCue.style.transition = 'opacity 800ms ease'; }
        if (blowBtn) { blowBtn.style.opacity = '1'; blowBtn.style.transition = 'opacity 800ms ease'; }
      }, 800);
      return;
    }
    const ch = text[i];
    textHolder.textContent += ch;
    i++;
    later(typeNext, ch === '\n' ? typeSpeed * 8 : typeSpeed);
  }
  later(typeNext, 600);

  // Close button — just exits the room after reading
  if (blowBtn) {
    blowBtn.textContent = 'okay, close this 🚪';
    blowBtn.style.animation = 'none';
    blowBtn.style.boxShadow = 'none';
    blowBtn.style.background = 'rgba(16,48,112,0.08)';
    blowBtn.style.color = 'var(--ink)';
    blowBtn.style.border = '1.5px solid rgba(16,48,112,0.2)';
    blowBtn.addEventListener('click', () => {
      wish.classList.remove('show');
      later(() => { wish.hidden = true; }, 600);
      later(() => setCaption("I love you maichaa. So much it's crazy. 🤍"), 700);
      later(() => setCaption("Okay. Time to go 🚪"), 2400);
      later(() => { setCaption(""); setState(ST.LIGHTS_OFF_AGAIN); }, 3800);
    }, { once: true });
  }
}

function blowCandle() {
  // Music keeps playing — fades only after cake is cut
  setState(ST.CANDLE_EXTINGUISHED);
}

/* ============================================================
   14. Room closing — doors close, fade out, cleanup
   ============================================================ */
function closeRoom() {
  setState(ST.ROOM_CLOSING);
}

function closeRoomCleanup() {
  // Hide overlay
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.opacity = '';
  overlay.style.transition = '';
  // Restore body scroll
  document.body.style.overflow = '';
  if (scrapbook) scrapbook.style.overflow = '';
  // Clear timers
  clearAllTimers();
  // Stop audio and clear AudioManager.active so ambient can restart
  if (AudioManager && birthdayAudio) {
    AudioManager.pause(birthdayAudio);
  }
  stopParticles();
  stopDust();
  stopFallingConfetti();
  const ch = $('#brCharacters'); if(ch) ch.hidden = true;

  // Mark complete
  birthdayRoomState.roomClosed = true;
  setState(ST.ROOM_COMPLETE);
  // Ambient already restarted in LIGHTS_OFF_AGAIN — no need to restart again

  // Collapse the room section so no empty space before puzzle
  const roomSection = $('#birthday-room-screen');
  if (roomSection) {
    roomSection.style.transition = 'min-height 600ms ease, height 600ms ease, opacity 600ms ease';
    roomSection.style.minHeight  = '0';
    roomSection.style.height     = '0';
    roomSection.style.overflow   = 'hidden';
    roomSection.style.opacity    = '0';
    roomSection.style.padding    = '0';
  }

  // Scroll to puzzle after collapse
  setTimeout(() => {
    const puzzleSection = $('#puzzle-screen');
    if (puzzleSection) puzzleSection.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
  }, 700);
}

/* Skip button — immediately close the room */
SkipBtn.addEventListener('click', () => {
  // Stop everything immediately
  clearAllTimers();
  if (AudioManager && birthdayAudio) {
    AudioManager.pause(birthdayAudio);
  }
  stopParticles();
  closeRoomCleanup();
});


/* ---- Falling confetti ---- */
let fallConfInterval = null;
const FALL_COLORS = ['#E8837A','#C87890','#7090D0','#B0D0F0','#FFD700','#F4A7B9','#90B0F0'];

function startFallingConfetti() {
  if (fallConfInterval || PRM) return;
  fallConfInterval = setInterval(() => {
    if (!brConFall) return;
    const piece = document.createElement('div');
    piece.className = 'br-conf-piece';
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.background = FALL_COLORS[Math.floor(Math.random() * FALL_COLORS.length)];
    piece.style.width  = (6 + Math.random() * 8) + 'px';
    piece.style.height = (8 + Math.random() * 10) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    const dur = 2.5 + Math.random() * 2;
    piece.style.animationDuration = dur + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    piece.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    brConFall.appendChild(piece);
    setTimeout(() => piece.remove(), (dur + 1) * 1000);
  }, 120);
}
function stopFallingConfetti() {
  if (fallConfInterval) { clearInterval(fallConfInterval); fallConfInterval = null; }
  if (brConFall) setTimeout(() => { brConFall.innerHTML = ''; }, 3000);
}

/* ---- Wax drip ---- */
function startWaxDrip() {
  const candle = document.getElementById('brCandle');
  if (!candle || PRM) return;
  setTimeout(() => {
    const drip = document.createElement('div');
    drip.className = 'br-wax-drip';
    drip.style.left = (40 + Math.random() * 20) + '%';
    candle.appendChild(drip);
  }, 2000);
  setTimeout(() => {
    const drip2 = document.createElement('div');
    drip2.className = 'br-wax-drip';
    drip2.style.left = (55 + Math.random() * 15) + '%';
    drip2.style.animationDelay = '0.5s';
    candle.appendChild(drip2);
  }, 5000);
}

/* ---- Sparkle burst on decoration place ---- */
function sparkleAt(zone) {
  if (PRM) return;
  const rect = zone.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const cx = rect.left - overlayRect.left + rect.width / 2;
  const cy = rect.top - overlayRect.top + rect.height / 2;
  const sparks = ['✨','⭐','🌟','💫','✨'];
  sparks.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'br-deco-spark';
    el.textContent = s;
    const ang = (i / sparks.length) * Math.PI * 2;
    const dist = 30 + Math.random() * 40;
    el.style.left = cx + 'px';
    el.style.top  = cy + 'px';
    el.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
    el.style.setProperty('--sy', Math.sin(ang) * dist - 20 + 'px');
    el.style.animationDelay = (i * 60) + 'ms';
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 700);
  });
}

/* ---- Zone arrow hint ---- */
function showZoneArrow(kind) {
  const zone = document.querySelector('.br-dropzone[data-zone="' + kind + '"]');
  if (!zone) return;
  // Remove existing arrow
  const existing = overlay.querySelector('.br-zone-arrow');
  if (existing) existing.remove();
  const rect = zone.getBoundingClientRect();
  const oRect = overlay.getBoundingClientRect();
  const arrow = document.createElement('div');
  arrow.className = 'br-zone-arrow visible';
  arrow.textContent = '👇';
  arrow.style.left = (rect.left - oRect.left + rect.width / 2 - 16) + 'px';
  arrow.style.top  = (rect.top - oRect.top - 36) + 'px';
  overlay.appendChild(arrow);
  setTimeout(() => { arrow.classList.remove('visible'); setTimeout(() => arrow.remove(), 500); }, 3000);
}

/* ---- Typewriter wish ---- */
function typewriterWish(el, text, speed) {
  el.innerHTML = '';
  let i = 0;
  // Split into paragraphs
  const paras = text.split('\n');
  paras.forEach((para, pi) => {
    const p = document.createElement('p');
    el.appendChild(p);
    para.split('').forEach((ch, ci) => {
      const span = document.createElement('span');
      span.className = 'typewriter-char';
      span.textContent = ch === ' ' ? '\u00a0' : ch;
      span.style.animationDelay = ((pi * para.length * 0.5 + i) * speed) + 'ms';
      p.appendChild(span);
      i++;
    });
    i += 10; // pause between paragraphs
  });
}

/* ============================================================
   15. Wire entry buttons + room entry warning
   ============================================================ */

/* Room entry warning — shown when she scrolls to the room section */
const roomEntryWarning = $('#roomEntryWarning');
const rewEnter = $('#rewEnter');
const rewSkip  = $('#rewSkip');
let roomWarningShown = false;

function showRoomWarning() {
  if (!roomEntryWarning || roomWarningShown) return;
  roomWarningShown = true;
  roomEntryWarning.hidden = false;
  requestAnimationFrame(() => roomEntryWarning.style.opacity = '1');
}
function hideRoomWarning() {
  if (!roomEntryWarning) return;
  roomEntryWarning.style.opacity = '0';
  setTimeout(() => { roomEntryWarning.hidden = true; }, 400);
}

// Watch for room section entering view
const roomSectionEl = $('#birthday-room-screen');
if (roomSectionEl) {
  const roomObs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !roomWarningShown) {
      setTimeout(showRoomWarning, 600);
    }
  }, { threshold: 0.3 });
  roomObs.observe(roomSectionEl);
}

// Enter button — hide warning then open room
if (rewEnter) {
  rewEnter.addEventListener('click', () => {
    hideRoomWarning();
    if (roomSectionEl) roomSectionEl.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
    later(() => openRoom(), PRM ? 100 : 800);
  });
}

// Skip button — hide warning and scroll past room to next section
if (rewSkip) {
  rewSkip.addEventListener('click', () => {
    hideRoomWarning();
    const puzzleSection = $('#puzzle-screen');
    if (puzzleSection) puzzleSection.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
  });
}

if (enterRoomBtn) {
  enterRoomBtn.addEventListener('click', () => {
    const roomSection = $('#birthday-room-screen');
    if (roomSection) {
      roomSection.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
      later(() => openRoom(), PRM ? 100 : 900);
    } else {
      openRoom();
    }
  });
}
if (openRoomBtn) {
  openRoomBtn.addEventListener('click', () => openRoom());
}

/* ============================================================
   16. Cleanup on unload
   ============================================================ */
window.addEventListener('beforeunload', () => {
  clearAllTimers();
  if (AudioManager && birthdayAudio) {
    AudioManager.pause(birthdayAudio);
  }
  stopParticles();
});

/* ============================================================
   17. Expose for debugging
   ============================================================ */
window.BirthdayRoom = {
  state: birthdayRoomState,
  config: birthdayRoomConfig,
  open: openRoom,
  close: closeRoomCleanup
};

})();
