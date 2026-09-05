/* ============================================================
   BIRTHDAY ROOM — interactive experience
   Loaded after script.js. Reuses window.AMB.AudioManager so the
   "only one audio audible at a time" rule is preserved.

   Architecture:
     - Single state machine: ROOM_ENTER → LIGHTS_OFF → LIGHTS_ON →
       DECORATING → DECORATION_COMPLETE → CAKE_AVAILABLE →
       CAKE_PLACED → CANDLE_AVAILABLE → CANDLE_LIT →
       BIRTHDAY_MUSIC → CAKE_CUTTING → WISH →
       CANDLE_EXTINGUISHED → LIGHTS_OFF → ROOM_CLOSING → ROOM_COMPLETE
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
    "i don't know how to fit a year of you into a paragraph, so i won't try.\n" +
    "just — thank you for staying. for the small days, not just the loud ones.\n" +
    "i hope this year is softer to you than you let yourself hope for.",

  /* Birthday song. Place the file at this path. */
  birthdaySong: 'assets/audio/birthday-song.mp3',

  /* Decorations the user must place to complete the room.
     Each key matches a data-zone attribute on a .br-dropzone element. */
  requiredDecorations: ['balloons', 'banner', 'photo', 'flowers', 'gift'],

  /* Decoration tray items (in display order).
     `kind` matches a zone; `emoji` is the visual. */
  decorations: [
    { kind: 'balloons', emoji: '🎈', label: 'Balloons' },
    { kind: 'banner',   emoji: '🎉', label: 'Banner'   },
    { kind: 'photo',    emoji: '🖼️', label: 'Photo'    },
    { kind: 'flowers',  emoji: '🌸', label: 'Flowers'  },
    { kind: 'gift',     emoji: '🎁', label: 'Gift'     },
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
const skipBtn     = $('#brSkipBtn');
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
  setCaption("it's dark in here... maybe there's a light?");

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
      setCaption("it's dark in here... maybe there's a light?");
      // Hint sequence — point to the switch
      later(() => {
        setCaption("psst — there's a light switch on the right wall 💡");
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
      later(() => {
        setCaption("let's get this place ready for your birthday...");
        showTray();
        setState(ST.DECORATING);
      }, birthdayRoomConfig.timing.captionHold);
      break;

    case ST.DECORATION_COMPLETE:
      setCaption("perfect... but something's missing.");
      later(() => {
        setCaption("one last thing...");
        revealCake();
      }, birthdayRoomConfig.timing.captionHold);
      break;

    case ST.CAKE_PLACED:
      setCaption("now for the candle...");
      later(() => revealCandle(), 800);
      later(() => setCaption("tap the candle to light it 🕯️"), 2000);
      break;

    case ST.CANDLE_LIT:
      room.classList.remove('lit');
      room.classList.add('dim');
      setCaption("...happy birthday.");
      // Start music immediately when candle is lit — plays until blow
      later(() => startBirthdayMusic(), 800);
      break;

    case ST.BIRTHDAY_MUSIC:
      // Room brightens back up
      room.classList.remove('dim');
      room.classList.add('lit');
      bannerText.textContent = 'HAPPY BIRTHDAY ♡';
      banner.classList.add('visible');
      startParticles();
      later(() => revealKnife(), birthdayRoomConfig.timing.musicToKnife);
      break;

    case ST.CAKE_CUTTING:
      setCaption("drag the knife across the cake...");
      break;

    case ST.WISH:
      setCaption("");
      hideTray();
      showWish();
      break;

    case ST.CANDLE_EXTINGUISHED:
      // Flame fades out, smoke rises
      candleFlame.classList.remove('lit');
      candleGlow.classList.remove('lit');
      const smoke = document.createElement('div');
      smoke.className = 'br-candle-smoke rising';
      candleEl.appendChild(smoke);
      setTimeout(() => smoke.remove(), 2200);
      // Hide wish overlay
      wish.classList.remove('show');
      later(() => { wish.hidden = true; }, 1000);
      // Then dim lights
      later(() => setState(ST.LIGHTS_OFF_AGAIN), 1200);
      break;

    case ST.LIGHTS_OFF_AGAIN:
      room.classList.remove('lit', 'dim');
      room.classList.add('dark');
      stopParticles();
      // Fade out birthday music and clear AudioManager.active so ambient can restart
      if (AudioManager && birthdayAudio) {
        AudioManager.fadeTo(birthdayAudio, 0, 1500, () => {
          AudioManager.pause(birthdayAudio);  // pauses AND clears active
        });
      }
      later(() => closeRoom(), 1500);
      break;

    case ST.ROOM_CLOSING:
      doors.classList.add('closing');
      // Stop music and clear AudioManager.active
      if (AudioManager && birthdayAudio) {
        AudioManager.pause(birthdayAudio);
      }
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
  startIdleHint();
}
function hideTray() {
  tray.classList.remove('show');
  stopIdleHint();
  later(() => { tray.hidden = true; }, 500);
}

/* Progress counter */
function updateProgress() {
  const prog = $('#brTrayProgress');
  if (prog) prog.textContent = placedDecorations.size + ' / ' + birthdayRoomConfig.requiredDecorations.length;
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
        <div class="dec-banner-text">🎂 Happy Birthday Amisha 🎂</div>
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
                : '<div class="dec-photo-placeholder"><svg viewBox="0 0 80 80" width="56" height="56" xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="30" r="14" fill="#C87890" opacity="0.6"/><path d="M10 70 Q40 45 70 70" fill="#C87890" opacity="0.4"/><path d="M0 80 L80 80 L80 60 Q40 35 0 60 Z" fill="#C87890" opacity="0.25"/></svg><span>us ♡</span></div>'
              }
            </div>
            <div class="dec-photo-corner dec-photo-corner-tl"></div>
            <div class="dec-photo-corner dec-photo-corner-tr"></div>
            <div class="dec-photo-corner dec-photo-corner-bl"></div>
            <div class="dec-photo-corner dec-photo-corner-br"></div>
          </div>
          <div class="dec-photo-caption">us ♡</div>
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
          <!-- Small stars -->
          <text x="20" y="98" font-size="14" opacity="0.6">★</text>
          <text x="78" y="88" font-size="10" opacity="0.5">★</text>
          <defs>
            <linearGradient id="giftGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
              <stop offset="100%" stop-color="rgba(0,0,0,0.1)"/>
            </linearGradient>
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
    if (hintEl) hintEl.innerHTML = '<span>👆</span> ' + remaining.length + ' more — tap <b>' + remaining[0] + '</b> next!';
  }

  // Check completion
  const allPlaced = birthdayRoomConfig.requiredDecorations.every(k => placedDecorations.has(k));
  if (allPlaced && !birthdayRoomState.decorationsCompleted) {
    birthdayRoomState.decorationsCompleted = true;
    stopIdleHint();
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
    zone.classList.add('active');
    setTimeout(() => placeDecoration(kind, zone), 250);
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
  setCaption("drag the cake onto the table...");
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
  setCaption("light the candle...");

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
    setCaption("make a wish...");
    // Music fades out and clears AudioManager.active so ambient can return later
    if (AudioManager && birthdayAudio) {
      AudioManager.fadeTo(birthdayAudio, 0, 2500, () => {
        AudioManager.pause(birthdayAudio);
      });
    }
    // Particles calm down
    later(() => stopParticles(), 1000);
    // Room calms
    later(() => {
      room.classList.remove('lit');
      room.classList.add('dim');
    }, 1500);
    later(() => setState(ST.WISH), 3500);
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

  // Typewriter the wish body
  const text = birthdayRoomConfig.birthdayWish;
  wishBody.innerHTML = '<span class="cursor"></span>';
  const textHolder = document.createElement('span');
  wishBody.insertBefore(textHolder, wishBody.firstChild);
  let i = 0;
  const typeSpeed = PRM ? 0 : 32;
  function typeNext() {
    if (i >= text.length) {
      // Done
      later(() => {
        wishCue.style.opacity = '';
        blowBtn.style.opacity = '';
      }, 400);
      return;
    }
    const ch = text[i];
    textHolder.textContent += ch;
    i++;
    later(typeNext, ch === '\n' ? typeSpeed * 8 : typeSpeed);
  }
  later(typeNext, 600);

  // Blow button handler
  blowBtn.addEventListener('click', blowCandle, { once: true });
}

function blowCandle() {
  // Extinguish candle
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
  // Mark complete
  birthdayRoomState.roomClosed = true;
  setState(ST.ROOM_COMPLETE);
  // Restart ambient audio (now that birthday song is done and active is null)
  tryRestartAmbient();
  // Scroll to the next section (the puzzle)
  const roomSection = $('#birthday-room-screen');
  if (roomSection) {
    let next = roomSection.nextElementSibling;
    while (next && !next.classList.contains('page-snap')) next = next.nextElementSibling;
    if (next) next.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
  }
}

/* Skip button — immediately close the room */
skipBtn.addEventListener('click', () => {
  // Stop everything immediately
  clearAllTimers();
  if (AudioManager && birthdayAudio) {
    AudioManager.pause(birthdayAudio);
  }
  stopParticles();
  closeRoomCleanup();
});

/* ============================================================
   15. Wire entry buttons
   ============================================================ */
if (enterRoomBtn) {
  enterRoomBtn.addEventListener('click', () => {
    // First, scroll to the room-intro section
    const roomSection = $('#birthday-room-screen');
    if (roomSection) {
      roomSection.scrollIntoView({ behavior: PRM ? 'auto' : 'smooth', block: 'start' });
      // Then open the room after the scroll settles
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
