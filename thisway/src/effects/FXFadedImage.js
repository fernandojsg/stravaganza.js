import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXFadedImage - Textured quad with 3-phase fade animation.
 *
 * Displays a textured quad that fades in, stays visible, then fades out.
 * Position, size, and angle are interpolated between start and end values
 * over the full effect duration. Alpha is controlled by the 3-phase envelope:
 *   Phase 1 (fadeIn):  alpha ramps from 0 to alpha1
 *   Phase 2 (stay):    alpha holds at interpolated value between alpha1 and alpha2
 *   Phase 3 (fadeOut): alpha ramps from alpha2 to 0
 *
 * This effect is used 17 times in the Stravaganza demo for backgrounds, lyrics,
 * UI elements, and credit labels.
 *
 * Original: FXFadedImage.cpp
 */
export class FXFadedImage extends DemoFX {
  constructor() {
    super();
    this.name = 'FXFadedImage';

    // Positions [x, y, z]
    this.pos1 = [0.5, 0.5, 0];
    this.pos2 = [0.5, 0.5, 0];
    // Sizes [w, h, z]
    this.size1 = [1, 1, 0];
    this.size2 = [1, 1, 0];
    // Angles in degrees
    this.angle1 = 0;
    this.angle2 = 0;
    // Timing in ms
    this.fadeIn = 0;
    this.stay = 0;
    this.fadeOut = 0;
    // Texture
    this.texturePath = '';
    // Alpha range
    this.alpha1 = 1.0;
    this.alpha2 = 1.0;

    /** @type {THREE.Texture|null} */
    this.texture = null;
  }

  /**
   * Configure the faded image effect.
   * @param {number[]} pos1 - Start position [x, y, z] in normalized coords
   * @param {number[]} pos2 - End position [x, y, z]
   * @param {number[]} size1 - Start size [w, h, z]
   * @param {number[]} size2 - End size [w, h, z]
   * @param {number} angle1 - Start rotation angle (degrees)
   * @param {number} angle2 - End rotation angle (degrees)
   * @param {number} fadeIn - Fade-in duration (ms)
   * @param {number} stay - Stay duration (ms)
   * @param {number} fadeOut - Fade-out duration (ms)
   * @param {string} texturePath - Path to texture asset
   * @param {number} alpha1 - Alpha at start of stay phase
   * @param {number} alpha2 - Alpha at end of stay phase
   */
  setup(pos1, pos2, size1, size2, angle1, angle2, fadeIn, stay, fadeOut, texturePath, alpha1, alpha2) {
    this.pos1 = pos1;
    this.pos2 = pos2;
    this.size1 = size1;
    this.size2 = size2;
    this.angle1 = angle1;
    this.angle2 = angle2;
    this.fadeIn = fadeIn;
    this.stay = stay;
    this.fadeOut = fadeOut;
    this.texturePath = texturePath;
    this.alpha1 = alpha1 ?? 1.0;
    this.alpha2 = alpha2 ?? 1.0;
  }

  /**
   * Load the texture asset.
   * @param {import('../engine/DemoManager.js').DemoManager} dm
   */
  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXFadedImage: failed to load texture "${this.texturePath}":`, err.message);
      }
    }
  }

  /**
   * Render the faded image quad.
   *
   * The total effect duration is fadeIn + stay + fadeOut.
   * A global interpolation t (0..1) drives position/size/angle changes.
   * Alpha uses the 3-phase envelope.
   *
   * @param {number} fxTime - Time since effect start (ms)
   * @param {number} demoTime - Absolute demo time (ms)
   * @param {import('../engine/DemoManager.js').DemoManager} dm
   */
  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    const totalDuration = this.fadeIn + this.stay + this.fadeOut;
    if (totalDuration <= 0) return;

    // Global interpolation factor for position/size/angle
    const t = Math.max(0, Math.min(1, fxTime / totalDuration));

    // Compute alpha based on 3-phase envelope
    let alpha;
    if (fxTime < this.fadeIn) {
      // Phase 1: Fade in (0 -> alpha1)
      const fadeT = this.fadeIn > 0 ? fxTime / this.fadeIn : 1;
      alpha = fadeT * this.alpha1;
    } else if (fxTime < this.fadeIn + this.stay) {
      // Phase 2: Stay (interpolate alpha1 -> alpha2)
      const stayT = this.stay > 0 ? (fxTime - this.fadeIn) / this.stay : 1;
      alpha = this.alpha1 + (this.alpha2 - this.alpha1) * stayT;
    } else {
      // Phase 3: Fade out (alpha2 -> 0)
      const fadeOutT = this.fadeOut > 0
        ? (fxTime - this.fadeIn - this.stay) / this.fadeOut
        : 1;
      alpha = this.alpha2 * (1 - Math.min(1, fadeOutT));
    }

    alpha = Math.max(0, Math.min(1, alpha));
    if (alpha <= 0) return;

    // Interpolate position, size, angle
    const x = this.pos1[0] + (this.pos2[0] - this.pos1[0]) * t;
    const y = this.pos1[1] + (this.pos2[1] - this.pos1[1]) * t;
    const w = this.size1[0] + (this.size2[0] - this.size1[0]) * t;
    const h = this.size1[1] + (this.size2[1] - this.size1[1]) * t;
    const angle = (this.angle1 + (this.angle2 - this.angle1) * t) * Math.PI / 180;

    dm.renderer.drawTexturedQuad(this.texture, x, y, w, h, angle, alpha);
  }

  close() {
    // Textures are managed by AssetManager
    this.texture = null;
  }
}
