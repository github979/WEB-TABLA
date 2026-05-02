/**
 * ============================================================
 * WEB TABLA — script.js
 * ============================================================
 * Architecture:
 *   AudioEngine   — Web Audio API context, buffer loading, playback
 *   PadController — DOM pads, keyboard events, visual feedback
 *   TaalEngine    — Keherwa taal loop via AudioContext scheduling
 *   Recorder      — Record/playback of user hits with timing
 *   Controls      — Volume & BPM sliders
 *   App           — Wires everything together
 * ============================================================
 */

'use strict';

/* ──────────────────────────────────────────────
   CONFIGURATION
   ────────────────────────────────────────────── */

/** Sound file paths — put your WAV files in sounds/ folder */
const SOUND_FILES = {
  na:   'sounds/na.wav',
  dha:  'sounds/dha.wav',
  dhin: 'sounds/dhin.wav',
  ge:   'sounds/ge.wav',
};

/** Keyboard key → bol mapping */
const KEY_MAP = {
  a: 'na',
  s: 'dha',
  d: 'dhin',
  f: 'ge',
};

/**
 * Keherwa Taal — 8 beats
 * Vibhag (sections): 4+4
 * Sam = beat 1 (X), Khali = beat 5 (0)
 * Theka: Dha Ge Na Ti | Na Ka Dhin Na
 */
const KEHERWA_TAAL = {
  name: 'Keherwa',
  beats: 8,
  /**
   * Each entry: { bol, marker }
   * marker: 'X' (sam), '0' (khali), '2'/'3'... (other vibhag starts), '' (regular)
   */
  sequence: [
    { bol: 'Dha',  marker: 'X' },  // Beat 1 — Sam
    { bol: 'Ge',   marker: '' },   // Beat 2
    { bol: 'Na',   marker: '' },   // Beat 3
    { bol: 'Ti',   marker: '' },   // Beat 4
    { bol: 'Na',   marker: '0' },  // Beat 5 — Khali
    { bol: 'Ka',   marker: '' },   // Beat 6
    { bol: 'Dhin', marker: '' },   // Beat 7
    { bol: 'Na',   marker: '' },   // Beat 8
  ],

  /**
   * Which audio bol to play for each beat (null = no sound / khali)
   * We map theka bols to our 4 available sounds.
   */
  audioMap: ['dha', 'ge', 'na', null, 'na', null, 'dhin', 'na'],
};

/* ──────────────────────────────────────────────
   MODULE: AudioEngine
   Handles all Web Audio API operations.
   ────────────────────────────────────────────── */
const AudioEngine = (() => {
  let ctx = null;           // AudioContext
  let masterGain = null;    // Master volume node
  const buffers = {};       // Decoded AudioBuffers keyed by bol name
  let isReady = false;

  /**
   * Create AudioContext on first user gesture (browser autoplay policy).
   * Returns the context.
   */
  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.8;
      masterGain.connect(ctx.destination);
    }
    // Resume if suspended (Chrome requires user gesture)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * Load and decode all sound files into AudioBuffers.
   * Resolves when all are loaded; rejects if any fail critically.
   */
  async function loadSounds(onProgress) {
    ensureContext();
    const entries = Object.entries(SOUND_FILES);
    let loaded = 0;

    await Promise.all(entries.map(async ([bol, path]) => {
      try {
        const resp = await fetch(path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);
        const arrayBuf = await resp.arrayBuffer();
        buffers[bol] = await ctx.decodeAudioData(arrayBuf);
        loaded++;
        onProgress?.(loaded, entries.length, bol);
      } catch (err) {
        console.warn(`[AudioEngine] Could not load "${path}":`, err.message);
        // Create a silent 0.1s buffer as fallback so the UI still works
        buffers[bol] = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      }
    }));

    isReady = true;
  }

  /**
   * Play a bol sound immediately (low-latency fire-and-forget).
   * Each call creates a new BufferSource so overlapping is fully supported.
   * @param {string} bol   - 'na' | 'dha' | 'dhin' | 'ge'
   * @param {number} [when] - AudioContext time to start (default: now)
   */
  function play(bol, when) {
    if (!isReady || !buffers[bol]) return;
    ensureContext();

    const source = ctx.createBufferSource();
    source.buffer = buffers[bol];

    // Per-hit gain for slight velocity variation feel
    const hitGain = ctx.createGain();
    hitGain.gain.value = 1.0;
    source.connect(hitGain);
    hitGain.connect(masterGain);

    source.start(when ?? ctx.currentTime);
  }

  /** Set master volume 0–1 */
  function setVolume(v) {
    if (masterGain) masterGain.gain.linearRampToValueAtTime(v, (ctx?.currentTime ?? 0) + 0.05);
  }

  /** Expose AudioContext's currentTime for precise scheduling */
  function now() {
    return ctx?.currentTime ?? 0;
  }

  return { ensureContext, loadSounds, play, setVolume, now, get isReady() { return isReady; } };
})();


/* ──────────────────────────────────────────────
   MODULE: PadController
   Handles drum pad DOM, mouse, keyboard, and
   visual hit feedback.
   ────────────────────────────────────────────── */
const PadController = (() => {
  // Callback invoked whenever any bol is triggered
  let onHitCallback = null;

  // Track which keys are currently pressed to avoid key-repeat floods
  const pressedKeys = new Set();

  /**
   * Wire up all pads and keyboard events.
   * @param {Function} onHit - Called with (bol) on every hit
   */
  function init(onHit) {
    onHitCallback = onHit;

    // ── Mouse / touch events on all pads ──
    document.querySelectorAll('.pad').forEach(pad => {
      pad.addEventListener('pointerdown', e => {
        e.preventDefault();            // Prevent focus-ring jitter on touch
        const bol = pad.dataset.bol;
        triggerHit(bol, pad);
      });
    });

    // ── Keyboard events ──
    document.addEventListener('keydown', e => {
      const bol = KEY_MAP[e.key.toLowerCase()];
      if (!bol) return;
      if (pressedKeys.has(e.key.toLowerCase())) return; // Block key-repeat
      pressedKeys.add(e.key.toLowerCase());

      const pad = document.querySelector(`.pad[data-bol="${bol}"]`);
      triggerHit(bol, pad);

      // Highlight keyboard badge
      const badge = pad?.parentElement?.querySelector('.key-badge');
      if (badge) badge.classList.add('active');
    });

    document.addEventListener('keyup', e => {
      const key = e.key.toLowerCase();
      pressedKeys.delete(key);
      const bol = KEY_MAP[key];
      if (!bol) return;

      const pad = document.querySelector(`.pad[data-bol="${bol}"]`);
      const badge = pad?.parentElement?.querySelector('.key-badge');
      if (badge) badge.classList.remove('active');
    });
  }

  /**
   * Trigger a bol hit: play audio + visual feedback + callback.
   * @param {string} bol
   * @param {HTMLElement|null} padEl
   */
  function triggerHit(bol, padEl) {
    AudioEngine.play(bol);
    if (padEl) animatePad(padEl);
    onHitCallback?.(bol);
  }

  /**
   * Visual hit animation on a pad element.
   * Uses CSS class + ensures animation restarts cleanly.
   */
  function animatePad(padEl) {
    padEl.classList.remove('is-hitting');
    // Force reflow to restart CSS animation
    void padEl.offsetWidth;
    padEl.classList.add('is-hitting');

    // Remove after animation completes
    padEl.addEventListener('animationend', () => {
      padEl.classList.remove('is-hitting');
    }, { once: true });

    // Fallback removal after 350ms
    setTimeout(() => padEl.classList.remove('is-hitting'), 350);
  }

  /**
   * Programmatically trigger a pad hit (e.g., from taal or playback).
   * @param {string} bol
   */
  function triggerPad(bol) {
    const padEl = document.querySelector(`.pad[data-bol="${bol}"]`);
    if (padEl) animatePad(padEl);
  }

  return { init, triggerPad };
})();


/* ──────────────────────────────────────────────
   MODULE: TaalEngine
   Implements Keherwa taal loop using a
   precise Web Audio API scheduler (look-ahead
   scheduling pattern to avoid jitter).
   ────────────────────────────────────────────── */
const TaalEngine = (() => {
  const TAAL = KEHERWA_TAAL;

  let isPlaying   = false;
  let currentBeat = 0;       // 0-indexed beat position
  let bpm         = 100;
  let scheduleAheadTime = 0.15;   // Schedule this many seconds ahead
  let schedulerInterval = 50;     // How often the scheduler runs (ms)

  let nextBeatTime  = 0;     // AudioContext time of next beat
  let schedulerTimer = null; // setInterval handle

  // DOM references
  let beatCells   = [];
  let bolChips    = [];
  let playBtn     = null;

  // Visual update uses requestAnimationFrame to stay in sync with audio
  let lastHighlightedBeat = -1;

  function init() {
    playBtn   = document.getElementById('taalPlayBtn');
    buildBeatGrid();
    buildSequenceChips();
    syncVisualBeat();

    playBtn.addEventListener('click', () => {
      isPlaying ? stop() : start();
    });
  }

  /** Build 8 beat indicator cells in the DOM */
  function buildBeatGrid() {
    const grid = document.getElementById('beatGrid');
    grid.innerHTML = '';
    beatCells = [];

    TAAL.sequence.forEach((beat, i) => {
      const cell = document.createElement('div');
      cell.className = 'beat-cell';
      if (beat.marker === 'X') cell.classList.add('beat-sam');
      if (beat.marker === '0') cell.classList.add('beat-khali');

      cell.innerHTML = `
        <span class="beat-number">${i + 1}</span>
        <span class="beat-marker">${beat.marker || '·'}</span>
      `;
      grid.appendChild(cell);
      beatCells.push(cell);
    });
  }

  /** Build bol label chips below the grid */
  function buildSequenceChips() {
    const seq = document.getElementById('taalSequence');
    seq.innerHTML = '';
    bolChips = [];

    TAAL.sequence.forEach(beat => {
      const chip = document.createElement('span');
      chip.className = 'taal-bol-chip';
      chip.textContent = beat.bol;
      seq.appendChild(chip);
      bolChips.push(chip);
    });
  }

  /** Start the taal loop */
  function start() {
    AudioEngine.ensureContext();
    isPlaying   = true;
    currentBeat = 0;
    nextBeatTime = AudioEngine.now() + 0.05; // Small startup delay

    playBtn.classList.add('is-playing');
    playBtn.querySelector('.btn-icon').textContent = '⏸';
    playBtn.querySelector('.btn-text').textContent = 'Pause Taal';

    // Run scheduler immediately then on interval
    scheduler();
    schedulerTimer = setInterval(scheduler, schedulerInterval);
  }

  /** Stop the taal loop */
  function stop() {
    isPlaying = false;
    clearInterval(schedulerTimer);
    schedulerTimer = null;

    playBtn.classList.remove('is-playing');
    playBtn.querySelector('.btn-icon').textContent = '▶';
    playBtn.querySelector('.btn-text').textContent = 'Play Taal';

    // Clear visual highlights
    beatCells.forEach(c => c.classList.remove('is-active'));
    bolChips.forEach(c  => c.classList.remove('is-active'));
    lastHighlightedBeat = -1;
  }

  /**
   * Core scheduler: runs every `schedulerInterval` ms.
   * Schedules audio events for beats that fall within the look-ahead window.
   * This is the Web Audio API recommended pattern for drift-free timing.
   */
  function scheduler() {
    const now = AudioEngine.now();

    while (nextBeatTime < now + scheduleAheadTime) {
      scheduleBeat(currentBeat, nextBeatTime);
      advanceBeat();
    }
  }

  /**
   * Schedule audio for a single beat at a precise AudioContext time.
   * @param {number} beatIndex - 0-7
   * @param {number} time      - AudioContext absolute time
   */
  function scheduleBeat(beatIndex, time) {
    const bol = TAAL.audioMap[beatIndex];
    if (bol) {
      AudioEngine.play(bol, time);
    }

    // Use setTimeout offset from now to trigger visual update at the right time
    // (We can't use AudioContext events for DOM updates directly)
    const msUntilBeat = (time - AudioEngine.now()) * 1000;
    setTimeout(() => {
      if (!isPlaying) return;
      updateVisualBeat(beatIndex);
    }, Math.max(0, msUntilBeat));
  }

  /** Advance beat pointer and calculate time of next beat */
  function advanceBeat() {
    const secondsPerBeat = 60.0 / bpm;
    nextBeatTime += secondsPerBeat;
    currentBeat  = (currentBeat + 1) % TAAL.beats;
  }

  /** Highlight the current beat cell and chip in the DOM */
  function updateVisualBeat(beatIndex) {
    if (lastHighlightedBeat !== -1) {
      beatCells[lastHighlightedBeat]?.classList.remove('is-active');
      bolChips[lastHighlightedBeat]?.classList.remove('is-active');
    }
    beatCells[beatIndex]?.classList.add('is-active');
    bolChips[beatIndex]?.classList.add('is-active');
    lastHighlightedBeat = beatIndex;
  }

  /** Keep visual in sync even when nothing is playing */
  function syncVisualBeat() {
    requestAnimationFrame(syncVisualBeat);
  }

  /** Update BPM (can be called while playing) */
  function setBPM(newBpm) {
    bpm = Math.max(40, Math.min(240, newBpm));
  }

  return { init, setBPM };
})();


/* ──────────────────────────────────────────────
   MODULE: Recorder
   Records user hits with precise timestamps,
   then plays them back maintaining relative
   timing between events.
   ────────────────────────────────────────────── */
const Recorder = (() => {
  /**
   * A recorded event: { bol: string, time: number (ms from recording start) }
   */
  let events      = [];
  let isRecording = false;
  let isPlaying   = false;
  let recStartTime = 0;
  let playbackTimers = [];   // setTimeout handles for cleanup

  // DOM refs
  let recBtn, playBtn, clearBtn, timeline, recDot;

  function init() {
    recBtn   = document.getElementById('recRecordBtn');
    playBtn  = document.getElementById('recPlayBtn');
    clearBtn = document.getElementById('recClearBtn');
    timeline = document.getElementById('recTimeline');
    recDot   = document.getElementById('recDot');

    recBtn.addEventListener('click', toggleRecord);
    playBtn.addEventListener('click', playRecording);
    clearBtn.addEventListener('click', clearRecording);
  }

  /** Called by App whenever any bol is hit */
  function captureHit(bol) {
    if (!isRecording) return;
    const elapsed = performance.now() - recStartTime;
    events.push({ bol, time: elapsed });
    appendTimelineChip(bol, events.length - 1);
  }

  /** Toggle recording state */
  function toggleRecord() {
    if (isRecording) {
      stopRecord();
    } else {
      startRecord();
    }
  }

  function startRecord() {
    events      = [];
    isRecording = true;
    recStartTime = performance.now();

    recDot.classList.add('recording');
    recBtn.classList.add('is-recording');
    recBtn.querySelector('.btn-icon').textContent = '⏹';
    recBtn.querySelector('.btn-text').textContent = 'Stop';

    // Clear timeline
    timeline.innerHTML = '';
    playBtn.disabled   = true;
    clearBtn.disabled  = true;
  }

  function stopRecord() {
    isRecording = false;

    recDot.classList.remove('recording');
    recBtn.classList.remove('is-recording');
    recBtn.querySelector('.btn-icon').textContent = '⏺';
    recBtn.querySelector('.btn-text').textContent = 'Record';

    if (events.length > 0) {
      playBtn.disabled  = false;
      clearBtn.disabled = false;
    } else {
      timeline.innerHTML = '<span class="rec-empty-hint">No notes recorded.</span>';
    }
  }

  /** Play back the recorded events with accurate timing */
  function playRecording() {
    if (events.length === 0 || isPlaying) return;
    isPlaying = true;

    playBtn.classList.add('is-playing');
    playBtn.querySelector('.btn-icon').textContent = '⏹';
    playBtn.querySelector('.btn-text').textContent = 'Playing…';

    const chips = timeline.querySelectorAll('.rec-event-chip');

    events.forEach((evt, i) => {
      const timer = setTimeout(() => {
        // Play audio
        AudioEngine.play(evt.bol);
        // Visual pad flash
        PadController.triggerPad(evt.bol);
        // Highlight chip
        chips[i]?.classList.add('is-playing');
        setTimeout(() => chips[i]?.classList.remove('is-playing'), 200);
      }, evt.time);
      playbackTimers.push(timer);
    });

    // Stop playback after last event
    const totalDuration = events[events.length - 1]?.time ?? 0;
    const endTimer = setTimeout(() => stopPlayback(), totalDuration + 300);
    playbackTimers.push(endTimer);
  }

  function stopPlayback() {
    isPlaying = false;
    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];

    playBtn.classList.remove('is-playing');
    playBtn.querySelector('.btn-icon').textContent = '▶';
    playBtn.querySelector('.btn-text').textContent = 'Play';
  }

  function clearRecording() {
    stopPlayback();
    events = [];
    timeline.innerHTML = '<span class="rec-empty-hint">No recording yet — hit Record and start playing</span>';
    playBtn.disabled   = true;
    clearBtn.disabled  = true;
  }

  /** Append a chip to the timeline display */
  function appendTimelineChip(bol, idx) {
    // Clear empty hint on first event
    if (idx === 0) timeline.innerHTML = '';

    const chip = document.createElement('span');
    chip.className   = 'rec-event-chip';
    chip.dataset.bol = bol;

    // Display Devanagari label
    const devaMap = { na: 'ना', dha: 'धा', dhin: 'धिन', ge: 'गे' };
    chip.textContent = devaMap[bol] ?? bol;

    timeline.appendChild(chip);
  }

  return { init, captureHit };
})();


/* ──────────────────────────────────────────────
   MODULE: Controls
   Volume and BPM sliders.
   ────────────────────────────────────────────── */
const Controls = (() => {
  function init() {
    // Volume slider
    const volSlider = document.getElementById('volumeSlider');
    const volValue  = document.getElementById('volumeValue');

    volSlider.addEventListener('input', () => {
      const v = parseFloat(volSlider.value);
      AudioEngine.setVolume(v);
      volValue.textContent = Math.round(v * 100) + '%';
    });

    // BPM slider
    const bpmSlider = document.getElementById('bpmSlider');
    const bpmValue  = document.getElementById('bpmValue');

    bpmSlider.addEventListener('input', () => {
      const bpm = parseInt(bpmSlider.value, 10);
      TaalEngine.setBPM(bpm);
      bpmValue.textContent = bpm + ' BPM';
    });
  }

  return { init };
})();


/* ──────────────────────────────────────────────
   MODULE: App
   Entry point — wires everything together.
   ────────────────────────────────────────────── */
const App = (() => {
  const statusDot  = document.getElementById('audioStatusDot');
  const statusText = document.getElementById('audioStatusText');

  function setStatus(state, text) {
    statusDot.className  = 'status-dot ' + state;
    statusText.textContent = text;
  }

  async function init() {
    setStatus('', 'Initializing…');

    // Initialize subsystems that don't need audio context yet
    TaalEngine.init();
    Controls.init();
    Recorder.init();

    /**
     * Central hit handler — called when any bol is triggered.
     * Dispatches to Recorder.
     */
    function onHit(bol) {
      Recorder.captureHit(bol);
    }

    // Initialize pad controller — this starts listening for input
    PadController.init(onHit);

    // Load sounds on first user gesture
    // (Needed for autoplay policy compliance)
    let soundsLoaded = false;

    async function ensureAudio() {
      if (soundsLoaded) return;
      soundsLoaded = true;

      setStatus('', 'Loading sounds…');
      try {
        await AudioEngine.loadSounds((loaded, total, bol) => {
          setStatus('', `Loading… ${bol} (${loaded}/${total})`);
        });
        setStatus('ready', 'Ready');
      } catch (err) {
        console.error('[App] Sound loading error:', err);
        setStatus('error', 'Sound error — check console');
      }
    }

    // Trigger audio load on first interaction with the page
    document.addEventListener('pointerdown', ensureAudio, { once: true });
    document.addEventListener('keydown',     ensureAudio, { once: true });

    // Also attempt load immediately (works in some browsers without gesture)
    setTimeout(async () => {
      try {
        await ensureAudio();
      } catch {
        // Will be retried on first user gesture
      }
    }, 100);
  }

  return { init };
})();

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => App.init());
