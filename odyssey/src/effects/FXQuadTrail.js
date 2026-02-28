import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXQuadTrail - Textured quad trail from start to end position.
 * Multiple quads move along a path with staggered timing.
 * C++ original: Odyssey/FXQuadTrail.cpp
 */
export class FXQuadTrail extends DemoFX {
  constructor() {
    super();
    this.name = 'FXQuadTrail';
    this.numQuads = 0;
    this.numSimultaneous = 0;
    this.startPos = { x: 0, y: 0, z: 0 };
    this.endPos = { x: 0, y: 0, z: 0 };
    this.size1 = 0; this.size2 = 0;
    this.angle1 = 0; this.angle2 = 0;
    this.duration = 0;
    this.textureFile = '';
    this.texture = null;
  }

  setup(numQuads, numSimultaneous, startPos, endPos, size1, size2, angle1, angle2, duration, textureFile) {
    this.numQuads = numQuads;
    this.numSimultaneous = numSimultaneous;
    this.startPos = startPos;
    this.endPos = endPos;
    this.size1 = size1;
    this.size2 = size2;
    this.angle1 = angle1;
    this.angle2 = angle2;
    this.duration = duration;
    this.textureFile = textureFile;
  }

  async loadData(dm) {
    if (this.textureFile) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.textureFile);
      } catch (err) {
        console.warn(`FXQuadTrail: failed to load "${this.textureFile}":`, err.message);
      }
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    const factor = (this.numSimultaneous + this.numQuads - 1) / this.numSimultaneous;
    const tMovDuration = this.duration / factor;

    for (let count = 0; count < this.numQuads; count++) {
      const tMovStart = (tMovDuration / this.numSimultaneous) * count;
      const tMovEnd = tMovStart + tMovDuration;

      let alpha = 1.0;
      if (fxTime > this.duration) {
        alpha = (400.0 - (fxTime - this.duration)) / 400.0;
        if (alpha < 0) alpha = 0;
      }

      let t = (fxTime - tMovStart) / (tMovEnd - tMovStart);
      if (t < 0) t = 0;
      if (t > 1) t = 1;

      const angle = this.angle1 + (this.angle2 - this.angle1) * t;
      const size = this.size1 + (this.size2 - this.size1) * t;
      const cx = this.startPos.x + (this.endPos.x - this.startPos.x) * t;
      const cy = this.startPos.y + (this.endPos.y - this.startPos.y) * t;

      // C++ angle is in degrees, drawTexturedQuad expects radians
      dm.renderer.drawTexturedQuad(this.texture, cx, cy, size, size, angle * Math.PI / 180, alpha);
    }
  }

  close() {
    this.texture = null;
  }
}
