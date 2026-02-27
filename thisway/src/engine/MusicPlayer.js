/**
 * MusicPlayer - MP3 music playback with ms-precision timing.
 *
 * Uses HTML5 Audio element for .mp3 playback. Provides millisecond-precision
 * time position for demo synchronization. Falls back to performance.now()
 * timer if the audio file fails to load.
 */
export class MusicPlayer {
  constructor() {
    /** @type {HTMLAudioElement|null} */
    this.audio = null;
    this.playing = false;
    this.startTime = 0;
    this.pausedAt = 0;
    this.duration = 172000; // ~172 seconds default demo length
    this._fallbackMode = true;
    this._loaded = false;
  }

  /**
   * Load an MP3 music file.
   * @param {string} url - URL to the .mp3 file
   * @returns {Promise<void>}
   */
  async load(url) {
    try {
      this.audio = new Audio(url);
      this.audio.preload = 'auto';

      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error(`Failed to load audio: ${url}`));
        };
        const cleanup = () => {
          this.audio.removeEventListener('canplaythrough', onCanPlay);
          this.audio.removeEventListener('error', onError);
        };
        this.audio.addEventListener('canplaythrough', onCanPlay);
        this.audio.addEventListener('error', onError);
        this.audio.load();
      });

      this.duration = Math.round(this.audio.duration * 1000);
      this._fallbackMode = false;
      this._loaded = true;
      console.log(`Music loaded: ${url} (${(this.duration / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.warn('Music load failed:', err.message, '— using fallback timer');
      this.audio = null;
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

    this.audio.play().catch(err => {
      console.warn('Audio play failed:', err.message);
    });
    this.playing = true;
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

    this.audio.pause();
    this.playing = false;
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop() {
    this.playing = false;
    this.pausedAt = 0;
    this.startTime = 0;

    if (!this._fallbackMode && this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
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

    return Math.round(this.audio.currentTime * 1000);
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

    this.audio.currentTime = ms / 1000;
  }

  /**
   * Get total duration in milliseconds.
   * @returns {number}
   */
  getDuration() {
    return this.duration;
  }
}
