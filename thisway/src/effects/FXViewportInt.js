import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXViewportInt - Internal viewport for post-process effects.
 *
 * Sets a sub-viewport so subsequent higher-priority effects render at a
 * specific resolution. Used as the first effect (priority 0) to set up
 * the rendering area for post-processing chains like radial blur.
 *
 * Original: FXViewportInt.cpp
 */
export class FXViewportInt extends DemoFX {
  constructor() {
    super();
    this.name = 'FXViewportInt';

    this.x = 0;
    this.y = 0;
    this.w = 512;
    this.h = 512;
  }

  /**
   * Configure the internal viewport dimensions.
   * @param {number} x - Viewport X offset
   * @param {number} y - Viewport Y offset
   * @param {number} w - Viewport width
   * @param {number} h - Viewport height
   */
  setup(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  async loadData(dm) {}

  /**
   * Set the viewport to the internal dimensions.
   * @param {number} fxTime
   * @param {number} demoTime
   * @param {import('../engine/DemoManager.js').DemoManager} dm
   */
  doFrame(fxTime, demoTime, dm) {
    // Set viewport to the specified dimensions
    // This affects all subsequent higher-priority effects in this frame
    dm.renderer.setViewport(this.x, this.y, this.w, this.h);
  }

  close() {}
}
