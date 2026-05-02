# 🥁 Web Tabla

A browser-based tabla instrument with low-latency Web Audio API playback, Keherwa taal loop, and a recording system.

---

## Project Structure

```
web-tabla/
├── index.html      ← App markup & layout
├── style.css       ← Indian-aesthetic dark theme (copper/amber tones)
├── script.js       ← Modular JS: AudioEngine, PadController, TaalEngine, Recorder, Controls
├── sounds/
│   ├── na.wav      ← Na  (high tabla stroke)
│   ├── dha.wav     ← Dha (resonant open stroke)
│   ├── dhin.wav    ← Dhin (combined resonant stroke)
│   └── ge.wav      ← Ge  (bayan/bass stroke)
└── README.md
```

---

## Getting Sound Files

You need four WAV files in the `sounds/` folder. Options:

### Option A — Free tabla samples
- **Freesound.org** — search "tabla na", "tabla dha", "tabla ge"
- **SampleFocus.com** — search "tabla"
- **Philharmonia Orchestra samples** — philharmonia.co.uk/explore/sound_samples

### Option B — Record your own
Use Audacity or any DAW to record and export as WAV.

### Option C — Synthesized fallback
If sound files are missing, the app creates a silent buffer so the UI still works — you'll see visual feedback without audio. The status indicator in the top-right shows the load state.

---

## Running the Project

Because browsers block `fetch()` on `file://` protocol, you need a local server:

```bash
# Python 3
cd web-tabla
python3 -m http.server 8080
# Open: http://localhost:8080

# Node.js (npx)
npx serve .
# Open the URL shown

# VS Code — use the "Live Server" extension
```

---

## Controls

| Action | Key / Control |
|--------|--------------|
| Na     | `A` key or click pad |
| Dha    | `S` key or click pad |
| Dhin   | `D` key or click pad |
| Ge     | `F` key or click pad |
| Taal loop | Play Taal button |
| Record | Record button |
| Playback | Play button (after recording) |
| BPM | Tempo slider (40–240 BPM) |
| Volume | Volume slider |

---

## Architecture

### AudioEngine
- Creates a single `AudioContext` on first user gesture (browser autoplay policy)
- Preloads all sounds into `AudioBuffer` objects via `fetch()` + `decodeAudioData()`
- Each hit creates a new `BufferSourceNode` — enabling simultaneous overlapping playback
- Master `GainNode` for volume control

### PadController
- Handles `pointerdown` on pads and `keydown`/`keyup` on keyboard
- Key-repeat suppression via a `Set` of held keys
- CSS class `is-hitting` triggers scale + glow animation + ripple

### TaalEngine (Keherwa Taal)
- Uses the **Web Audio API lookahead scheduling** pattern (industry standard for drift-free timing)
- A `setInterval` scheduler runs every 50ms and schedules beats up to 150ms ahead
- Visual beat updates use `setTimeout` offset from `AudioContext.currentTime` for sync
- BPM can be changed live without restarting

### Recorder
- Timestamps each hit using `performance.now()` (millisecond precision)
- Playback uses `setTimeout` chains matching relative offsets
- Timeline shows Devanagari bol chips with active highlight during playback

---

## Browser Support

All modern browsers (Chrome, Firefox, Safari, Edge). Requires Web Audio API.
