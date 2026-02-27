import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXPulsatingImage - Pulse-triggered alpha flash quad.
 *
 * Displays a textured quad that flashes at specific absolute demo times.
 * Each pulse starts at maxAlpha and decays linearly to minAlpha over its duration.
 * Between pulses, alpha stays at minAlpha (invisible).
 *
 * C++ GetAlpha() logic:
 *   fAlpha = minAlpha
 *   for each pulse:
 *     if demoTime in [pulse.time, pulse.time + pulse.duration]:
 *       progress = (demoTime - pulse.time) / pulse.duration  (0→1)
 *       fAlpha = maxAlpha - (maxAlpha - minAlpha) * progress  (max→min)
 *
 * Original: FXPulsatingImage.cpp
 */
export class FXPulsatingImage extends DemoFX {
  constructor() {
    super();
    this.name = 'FXPulsatingImage';

    this.x = 0.5;
    this.y = 0.5;
    this.w = 1.0;
    this.h = 1.0;
    this.minAlpha = 0.0;
    this.maxAlpha = 1.0;
    this.texturePath = '';

    /** @type {THREE.Texture|null} */
    this.texture = null;

    /** @type {Array<{time: number, duration: number}>} */
    this.pulses = [];
  }

  /**
   * @param {number} x - Center X (0-1)
   * @param {number} y - Center Y (0-1)
   * @param {number} w - Width (0-1)
   * @param {number} h - Height (0-1)
   * @param {number} minAlpha
   * @param {number} maxAlpha
   * @param {string} texturePath
   */
  setup(x, y, w, h, minAlpha, maxAlpha, texturePath) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.minAlpha = minAlpha;
    this.maxAlpha = maxAlpha;
    this.texturePath = texturePath;
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXPulsatingImage: failed to load texture "${this.texturePath}":`, err.message);
      }
    }
  }

  /**
   * Compute alpha from pulse list. Uses absolute demo time.
   * @param {number} demoTime - Absolute demo time (ms)
   * @returns {number}
   */
  getAlpha(demoTime) {
    let alpha = this.minAlpha;

    for (const pulse of this.pulses) {
      if (demoTime > pulse.time && demoTime < pulse.time + pulse.duration) {
        const progress = (demoTime - pulse.time) / pulse.duration;
        alpha = this.maxAlpha - (this.maxAlpha - this.minAlpha) * progress;
      }
    }

    return alpha;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    const alpha = this.getAlpha(demoTime);
    if (alpha <= 0.001) return;

    dm.renderer.drawTexturedQuad(this.texture, this.x, this.y, this.w, this.h, 0, alpha);
  }

  close() {
    this.texture = null;
  }
}

/**
 * FXPulsatingImageTest - Flash effect for the spike section.
 * 17 pulses at music-synced times, 500ms linear fade-out each.
 *
 * Original: FXPulsatingImage.cpp (Test variant)
 */
export class FXPulsatingImageTest extends FXPulsatingImage {
  constructor() {
    super();
    this.name = 'FXPulsatingImageTest';
    this.pulses = [
      { time: 36055, duration: 500 },
      { time: 37089, duration: 500 },
      { time: 37923, duration: 500 },
      { time: 38361, duration: 500 },
      { time: 38923, duration: 500 },
      { time: 39709, duration: 500 },
      { time: 40600, duration: 500 },
      { time: 41478, duration: 500 },
      { time: 41867, duration: 500 },
      { time: 42345, duration: 500 },
      { time: 43191, duration: 500 },
      { time: 44057, duration: 500 },
      { time: 45030, duration: 500 },
      { time: 45366, duration: 500 },
      { time: 45866, duration: 500 },
      { time: 46732, duration: 500 },
      { time: 47390, duration: 500 },
    ];
  }
}

/**
 * FXPulsatingImageGlow1 - Glow overlay variant.
 * 22 pulses at 350ms each.
 *
 * Original: FXPulsatingImage.cpp (Glow1 variant)
 */
export class FXPulsatingImageGlow1 extends FXPulsatingImage {
  constructor() {
    super();
    this.name = 'FXPulsatingImageGlow1';
    this.pulses = [
      { time: 37392, duration: 350 },
      { time: 37616, duration: 350 },
      { time: 37991, duration: 350 },
      { time: 38306, duration: 350 },
      { time: 39202, duration: 350 },
      { time: 39406, duration: 350 },
      { time: 40040, duration: 350 },
      { time: 40286, duration: 350 },
      { time: 40946, duration: 350 },
      { time: 41176, duration: 350 },
      { time: 41499, duration: 350 },
      { time: 41847, duration: 350 },
      { time: 42741, duration: 350 },
      { time: 42960, duration: 350 },
      { time: 43599, duration: 350 },
      { time: 43818, duration: 350 },
      { time: 44490, duration: 350 },
      { time: 44711, duration: 350 },
      { time: 45000, duration: 350 },
      { time: 45330, duration: 350 },
      { time: 46281, duration: 350 },
      { time: 46471, duration: 350 },
    ];
  }
}

/**
 * FXPulsatingThisWay - Pulsating "this way" title during lyrics section.
 * 9 pulses with varying durations (100-400ms).
 *
 * Original: FXPulsatingImage.cpp (ThisWay variant)
 */
export class FXPulsatingThisWay extends FXPulsatingImage {
  constructor() {
    super();
    this.name = 'FXPulsatingThisWay';
    this.pulses = [
      { time: 106228, duration: 100 },
      { time: 106367, duration: 100 },
      { time: 106505, duration: 100 },
      { time: 106644, duration: 100 },
      { time: 106777, duration: 100 },
      { time: 106911, duration: 100 },
      { time: 107039, duration: 100 },
      { time: 107185, duration: 400 },
      { time: 107573, duration: 400 },
    ];
  }
}
