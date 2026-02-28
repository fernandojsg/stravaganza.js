/**
 * MusicPlayer - MP3 music playback with ms-precision timing and full seek support.
 *
 * Uses Web Audio API (decodeAudioData) for playback. The entire file is decoded
 * into memory, giving full seek control regardless of whether the HTTP server
 * supports range requests. Falls back to performance.now() timer if decoding fails.
 */
export class MusicPlayer {
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;
    /** @type {AudioBuffer|null} */
    this._buffer = null;
    /** @type {AudioBufferSourceNode|null} */
    this._source = null;

    this.playing = false;
    // _startCtxTime: AudioContext.currentTime when playback started
    this._startCtxTime = 0;
    // _startOffset: offset in seconds into the buffer when playback started
    this._startOffset = 0;
    this.pausedAt = 0; // ms
    this.duration = 172000;
    this._fallbackMode = true;
    this._loaded = false;
  }

  /**
   * Load an MP3 music file via Web Audio API.
   * @param {string} url - URL to the .mp3 file
   * @returns {Promise<void>}
   */
  async load(url) {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();

      this._buffer = await this._ctx.decodeAudioData(arrayBuffer);
      this.duration = Math.round(this._buffer.duration * 1000);
      this._fallbackMode = false;
      this._loaded = true;
      console.log(`Music loaded: ${url} (${(this.duration / 1000).toFixed(1)}s) [Web Audio API]`);
    } catch (err) {
      console.warn('Music load failed:', err.message, '— using fallback timer');
      this._ctx = null;
      this._buffer = null;
      this._fallbackMode = true;
    }
  }

  /**
   * Start or resume playback.
   */
  play() {
    if (this._fallbackMode) {
      if (this.pausedAt > 0) {
        this.startTime = performance.now() - this.pausedAt;
      } else {
        this.startTime = performance.now();
      }
      this.playing = true;
      return;
    }

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }

    const offset = this.pausedAt / 1000;
    this._playFromOffset(offset);
    this.playing = true;
  }

  /**
   * Create a new source node and start playing from the given offset (seconds).
   */
  _playFromOffset(offsetSec) {
    // Stop any existing source
    if (this._source) {
      try { this._source.stop(); } catch { /* already stopped */ }
      this._source.disconnect();
      this._source = null;
    }

    this._source = this._ctx.createBufferSource();
    this._source.buffer = this._buffer;
    this._source.connect(this._ctx.destination);

    this._startOffset = offsetSec;
    this._startCtxTime = this._ctx.currentTime;
    this._source.start(0, offsetSec);
  }

  /**
   * Pause playback.
   */
  pause() {
    if (this._fallbackMode) {
      this.pausedAt = this.getTimeMs();
      this.playing = false;
      return;
    }

    this.pausedAt = this.getTimeMs();
    if (this._source) {
      try { this._source.stop(); } catch { /* already stopped */ }
      this._source.disconnect();
      this._source = null;
    }
    this.playing = false;
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop() {
    this.playing = false;
    this.pausedAt = 0;
    this._startOffset = 0;
    this._startCtxTime = 0;

    if (!this._fallbackMode && this._source) {
      try { this._source.stop(); } catch { /* already stopped */ }
      this._source.disconnect();
      this._source = null;
    }

    // Fallback mode
    this.startTime = 0;
  }

  /**
   * Get current playback position in milliseconds.
   * @returns {number}
   */
  getTimeMs() {
    if (this._fallbackMode) {
      if (!this.playing) return this.pausedAt;
      return performance.now() - this.startTime;
    }

    if (!this.playing) return this.pausedAt;

    const elapsed = this._ctx.currentTime - this._startCtxTime;
    return Math.round((this._startOffset + elapsed) * 1000);
  }

  /**
   * Seek to a specific position in milliseconds.
   * @param {number} ms
   */
  seek(ms) {
    if (this._fallbackMode) {
      this.pausedAt = ms;
      if (this.playing) {
        this.startTime = performance.now() - ms;
      }
      return;
    }

    this.pausedAt = ms;
    if (this.playing) {
      this._playFromOffset(ms / 1000);
    }
  }

  /**
   * Get total duration in milliseconds.
   * @returns {number}
   */
  getDuration() {
    return this.duration;
  }
}
