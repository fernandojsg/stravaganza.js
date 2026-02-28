import { DemoManager } from './engine/DemoManager.js';
import { Renderer } from './engine/Renderer.js';
import { MusicPlayer } from './engine/MusicPlayer.js';
import { AssetManager } from './engine/AssetManager.js';
import { registerAllEffects } from './timeline.js';
import { DebugOverlay } from './debug/DebugOverlay.js';

// Original demo resolution
const DEMO_WIDTH = 800;
const DEMO_HEIGHT = 600;

const container = document.getElementById('container');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const fsToggle = document.getElementById('fsToggle');
const fsButton = document.getElementById('fsButton');
const loadingEl = document.getElementById('loading');
let fullscreenEnabled = true;

let renderer, demoManager, musicPlayer, assetManager;
let running = false;
let wakeLockSentinel = null;
let fsButtonTimer = null;
const debugOverlay = new DebugOverlay();

function togglePlayPause() {
  if (running) {
    running = false;
    musicPlayer.pause();
    debugOverlay.update(musicPlayer.getTimeMs(), demoManager.effects, demoManager.getDuration(), false);
  } else {
    running = true;
    musicPlayer.play();
    requestAnimationFrame(loop);
  }
}

function seekRelative(deltaMs) {
  const current = musicPlayer.getTimeMs();
  const target = Math.max(0, Math.min(demoManager.getDuration(), current + deltaMs));
  musicPlayer.seek(target);
  if (!running) {
    demoManager.doFrame(target);
    debugOverlay.update(target, demoManager.effects, demoManager.getDuration(), false);
  }
}

debugOverlay.setCallbacks({
  onSeek: (timeMs) => {
    musicPlayer.seek(timeMs);
    if (!running) {
      demoManager.doFrame(timeMs);
      debugOverlay.update(timeMs, demoManager.effects, demoManager.getDuration(), running);
    }
  },
  onPlayPause: togglePlayPause,
  onPause: () => {
    if (running) {
      running = false;
      musicPlayer.pause();
      debugOverlay.update(musicPlayer.getTimeMs(), demoManager.effects, demoManager.getDuration(), false);
    }
  },
  onResume: () => {
    if (!running) {
      running = true;
      musicPlayer.play();
      requestAnimationFrame(loop);
    }
  },
  onToggleEffect: (entry) => {
    entry.disabled = !entry.disabled;
    if (!running) {
      const t = musicPlayer.getTimeMs();
      demoManager.doFrame(t);
      debugOverlay.update(t, demoManager.effects, demoManager.getDuration(), false);
    }
  },
});

function setLoading(msg) {
  loadingEl.textContent = msg;
}

async function init() {
  setLoading('Initializing renderer...');
  const params = new URLSearchParams(window.location.search);

  renderer = new Renderer(container, DEMO_WIDTH, DEMO_HEIGHT);
  assetManager = new AssetManager(renderer);
  musicPlayer = new MusicPlayer();
  demoManager = new DemoManager(renderer, musicPlayer, assetManager);
  // Odyssey PTA wrapper uses a fixed frustum aspect of ~4:3.
  const ptaAspect = parseFloat(params.get('ptaaspect'));
  demoManager.sceneManager.setFixedFrustumAspect(Number.isFinite(ptaAspect) ? ptaAspect : 1.3333);

  // Odyssey scene/material colors were authored as monitor-space constants.
  // Interpret PTA color floats as sRGB values to recover original contrast.
  const ptaColorMode = (params.get('ptacolor') || 'linear').toLowerCase();
  demoManager.sceneManager.setPtaColorConstantsAreSRGB(ptaColorMode !== 'linear');

  // Odyssey demo duration: ~170 seconds
  demoManager.duration = 170000;

  // Make globally accessible for effects
  window.demoManager = demoManager;
  window.renderer = renderer;
  window.assetManager = assetManager;

  setLoading('Registering effects...');
  registerAllEffects(demoManager);

  setLoading('Loading demo script...');
  await demoManager.loadScript('data/demo.scr');

  setLoading('Loading music...');
  await musicPlayer.load('wnd_fix.mp3');

  setLoading('Loading assets...');
  await demoManager.loadAllEffects((progress, name) => {
    setLoading(`Loading: ${name} (${Math.round(progress * 100)}%)`);
  });

  setLoading('Ready. Click to start.');

  // URL parameters
  if (params.has('debug')) {
    debugOverlay.show();
    debugOverlay.showVideo();
  }

  const seekTime = parseInt(params.get('t'), 10);
  if (!isNaN(seekTime) && seekTime > 0) {
    musicPlayer.seek(seekTime);
  }
  setLoading('Ready. Click to start.');
}

function start() {
  overlay.style.display = 'none';
  loadingEl.style.display = 'none';
  running = true;
  musicPlayer.play();
  acquireWakeLock();
  requestAnimationFrame(loop);
}

// --- WakeLock ---
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
  } catch { /* WakeLock denied or unavailable */ }
}

function releaseWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) {
    acquireWakeLock();
  }
});

// --- Fullscreen hover button ---
function showFsButton() {
  if (document.fullscreenElement || overlay.style.display !== 'none') return;
  fsButton.classList.add('visible');
  clearTimeout(fsButtonTimer);
  fsButtonTimer = setTimeout(() => fsButton.classList.remove('visible'), 2000);
}

document.addEventListener('mousemove', showFsButton);
document.addEventListener('touchstart', showFsButton, { passive: true });

fsButton.addEventListener('click', async () => {
  try {
    await document.documentElement.requestFullscreen();
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch { /* fullscreen denied */ }
});

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    fsButton.classList.remove('visible');
    clearTimeout(fsButtonTimer);
  }
});

function loop() {
  if (!running) return;

  const time = musicPlayer.getTimeMs();
  demoManager.doFrame(time);

  debugOverlay.update(time, demoManager.effects, demoManager.getDuration(), running);

  if (time < demoManager.getDuration()) {
    requestAnimationFrame(loop);
  } else {
    running = false;
    musicPlayer.stop();
    releaseWakeLock();
    overlay.style.display = '';
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }
}

// Fullscreen toggle
fsToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  fullscreenEnabled = !fullscreenEnabled;
  fsToggle.classList.toggle('on', fullscreenEnabled);
});

// Click to start (required for audio context)
startBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (running) return;
  if (fullscreenEnabled) {
    try {
      await document.documentElement.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch { /* fullscreen denied — start anyway */ }
  }
  start();
});

// Keyboard controls
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    togglePlayPause();
  }
  if (e.key === 'd' || e.key === 'D') {
    debugOverlay.toggle();
  }
  if (e.key === 'v' || e.key === 'V') {
    debugOverlay.toggleVideo();
  }
  if (e.key === 'ArrowLeft') {
    seekRelative(-10000);
  }
  if (e.key === 'ArrowRight') {
    seekRelative(10000);
  }
  if (e.key === 'Escape') {
    running = false;
    musicPlayer.stop();
    releaseWakeLock();
    debugOverlay.update(musicPlayer.getTimeMs(), demoManager.effects, demoManager.getDuration(), false);
  }
});

// Handle resize
window.addEventListener('resize', () => {
  if (renderer) renderer.resize();
});

init().catch(err => {
  console.error('Demo init failed:', err);
  setLoading(`Error: ${err.message}`);
});
