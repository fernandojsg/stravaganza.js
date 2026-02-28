import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXWideBlur - Wide blur post-processing overlay.
 * Applies sinusoidal width/height animation with in/out duration.
 * Calls sceneManager.doWideBlur() which renders captured framebuffer at multiple zoom levels.
 * C++ original: Odyssey/FXWideBlur.cpp
 *
 * NOTE: The actual doWideBlur implementation depends on the scene manager having
 * a wideblur capture system. For now, this is a stub that will need the engine
 * to support this feature.
 */
export class FXWideBlur extends DemoFX {
  constructor() {
    super();
    this.name = 'FXWideBlur';
    this.numQuads = 0;
    this.fWidth = 0;
    this.fHeight = 0;
    this.inDuration = 0;
    this.outDuration = 0;
    this.isDOF = false;
  }

  setup(numQuads, width, height, inDuration, outDuration, isDOF = false) {
    this.numQuads = numQuads;
    this.fWidth = width;
    this.fHeight = height;
    this.inDuration = inDuration;
    this.outDuration = outDuration;
    this.isDOF = isDOF;
  }

  async loadData(dm) {
    // No data to load
  }

  doFrame(fxTime, demoTime, dm) {
    let width, height;
    const HALF_PI = Math.PI * 0.5;

    if (this.isDOF) {
      width = this.fWidth;
      height = this.fHeight;
    } else {
      if (fxTime < this.inDuration) {
        width = Math.sin(fxTime / this.inDuration * HALF_PI) * this.fWidth;
        height = Math.sin(fxTime / this.inDuration * HALF_PI) * this.fHeight;
      } else {
        const remaining = this.outDuration - (fxTime - this.inDuration);
        width = Math.sin(HALF_PI * remaining / this.outDuration) * this.fWidth;
        height = Math.sin(HALF_PI * remaining / this.outDuration) * this.fHeight;
      }
    }

    // Final blur modulated by sin(fxTime/1000)
    const sinMod = Math.abs(Math.sin(fxTime / 1000.0));
    const finalWidth = sinMod * width;
    const finalHeight = sinMod * height;

    // Call scene manager's wide blur if available
    if (dm.sceneManager && dm.sceneManager.doWideBlur) {
      dm.sceneManager.doWideBlur(this.numQuads, finalWidth, finalHeight, this.isDOF);
    }
  }

  close() {}
}
