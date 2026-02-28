import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXWideBlurredText - Text with trailing/blurring quads.
 * Multiple overlapping quads with staggered timing create a blur trail.
 * C++ original: Odyssey/FXWideBlurredText.cpp
 */
export class FXWideBlurredText extends DemoFX {
  constructor() {
    super();
    this.name = 'FXWideBlurredText';
    this.numTrails = 0;
    this.x = 0; this.y = 0;
    this.initialSizeX = 0; this.finalSizeX = 0;
    this.initialSizeY = 0; this.finalSizeY = 0;
    this.initialAngle = 0; this.finalAngle = 0;
    this.duration = 0;
    this.timeTillFade = 0;
    this.trailDelay = 15;
    this.texturePath = '';
    this.texture = null;
    this.trails = null;
  }

  setup(numTrails, x, y, sizeX1, sizeY1, sizeX2, sizeY2, angle1, angle2, texturePath, packFile, duration, timeTillFade, trailDelay = 15) {
    this.numTrails = numTrails;
    this.x = x; this.y = y;
    this.initialSizeX = sizeX1; this.finalSizeX = sizeX2;
    this.initialSizeY = sizeY1; this.finalSizeY = sizeY2;
    this.initialAngle = angle1; this.finalAngle = angle2;
    this.texturePath = texturePath;
    this.duration = duration;
    this.timeTillFade = timeTillFade;
    this.trailDelay = trailDelay;
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXWideBlurredText: failed to load "${this.texturePath}":`, err.message);
      }
    }
    this.trails = new Array(this.numTrails);
    for (let i = 0; i < this.numTrails; i++) {
      this.trails[i] = { t: 0, alpha: 0, width: 0, height: 0, angle: 0 };
    }
  }

  _updateData(fxTime) {
    for (let i = 0; i < this.numTrails; i++) {
      let t = (fxTime - (i * this.trailDelay)) / this.duration;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      this.trails[i].t = t;

      let alpha;
      if (fxTime + this.timeTillFade < this.duration) {
        alpha = t * 2.0;
      } else {
        alpha = 1.0 - ((fxTime - (this.duration + this.timeTillFade)) / 1000.0);
      }
      if (alpha < 0) alpha = 0;

      // Alpha cap per trail
      const aux = (this.numTrails - 1) - i;
      const cap = (aux / this.numTrails) * 0.5;
      if (alpha > cap) alpha = cap;

      this.trails[i].alpha = alpha;
      this.trails[i].width = this.initialSizeX + (this.finalSizeX - this.initialSizeX) * t;
      this.trails[i].height = this.initialSizeY + (this.finalSizeY - this.initialSizeY) * t;
      this.trails[i].angle = this.initialAngle + (this.finalAngle - this.initialAngle) * t;
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    this._updateData(fxTime);

    for (let i = 0; i < this.numTrails; i++) {
      const trail = this.trails[i];
      if (trail.t > 0 && trail.alpha > 0) {
        dm.renderer.drawTexturedQuad(
          this.texture, this.x, this.y,
          trail.width, trail.height,
          trail.angle, trail.alpha
        );
      }
    }
  }

  close() {
    this.texture = null;
    this.trails = null;
  }
}
