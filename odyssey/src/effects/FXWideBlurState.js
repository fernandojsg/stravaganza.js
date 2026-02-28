import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXWideBlurState - Simple ON/OFF toggle for the wide blur capture system.
 * When active, enables/disables the scene manager's wide blur framebuffer capture.
 * C++ original: ptaDemoFX_3D_WideBlur in PtaDemoSystem
 */
export class FXWideBlurState extends DemoFX {
  constructor() {
    super();
    this.name = 'FXWideBlurState';
    this.enabled = true;
  }

  setup(enabled) {
    this.enabled = enabled;
  }

  async loadData(dm) {}

  doFrame(fxTime, demoTime, dm) {
    if (dm.sceneManager) {
      dm.sceneManager.wideBlurEnabled = this.enabled;
    }
  }

  close() {}
}
