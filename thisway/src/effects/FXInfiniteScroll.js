import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXInfiniteScroll - Infinitely scrolling textured quad.
 *
 * Displays a textured quad that scrolls continuously in a specified direction.
 * The texture uses RepeatWrapping so it tiles seamlessly.
 *
 * C++ scroll formula: uvOffset = offset + dir * (fxTime * 0.001) * speed
 * UV coordinates: (0+offset.x, 0+offset.y) to (1+offset.x, 1+offset.y)
 *
 * Original: FXInfiniteScroll.cpp
 */
export class FXInfiniteScroll extends DemoFX {
  constructor() {
    super();
    this.name = 'FXInfiniteScroll';

    this.pos = [0.5, 0.5, 0.5];
    this.size = [1, 1, 1];
    this.dir = [1, 0, 0];
    this.offset = [0, 0, 0];
    this.speed = 1.0;
    this.alpha = 0.5;
    this.texturePath = '';
    this.additive = false;

    /** @type {THREE.Texture|null} */
    this.texture = null;
  }

  /**
   * Configure the infinite scroll effect.
   * C++ signature: setup(pos, size, dir, offset, fSpeed, fAlpha, texture, bAdditive)
   * @param {number[]} pos - Position [x, y, z]
   * @param {number[]} size - Quad size [w, h, z]
   * @param {number[]} dir - Scroll direction vector (normalized)
   * @param {number[]} offset - Initial UV offset [x, y, z]
   * @param {number} speed - Scroll speed multiplier
   * @param {number} alpha - Alpha transparency
   * @param {string} texturePath - Path to the scrolling texture
   * @param {boolean} additive - Use additive blending
   */
  setup(pos, size, dir, offset, speed, alpha, texturePath, additive) {
    this.pos = pos;
    this.size = size;
    this.dir = dir;
    this.offset = offset;
    this.speed = speed;
    this.alpha = alpha;
    this.texturePath = texturePath;
    this.additive = additive;
  }

  /**
   * Load the scrolling texture.
   * @param {import('../engine/DemoManager.js').DemoManager} dm
   */
  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
        if (this.texture) {
          this.texture.wrapS = THREE.RepeatWrapping;
          this.texture.wrapT = THREE.RepeatWrapping;
        }
      } catch (err) {
        console.warn(`FXInfiniteScroll: failed to load texture "${this.texturePath}":`, err.message);
      }
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    // C++: uvOffset = m_offset + m_dir * (fxTime * 0.001f) * m_fSpeed
    const t = fxTime * 0.001; // ms → seconds
    const uvX = this.offset[0] + this.dir[0] * t * this.speed;
    const uvY = this.offset[1] - this.dir[1] * t * this.speed; // Negate Y: PTA V-flip

    this.texture.offset.set(uvX, uvY);

    // Blending: additive (SRCALPHA/ONE) or normal (SRCALPHA/INVSRCALPHA)
    const blendSrc = 4; // SRCALPHA
    const blendDst = this.additive ? 1 : 5; // ONE or INVSRCALPHA

    dm.renderer.drawTexturedQuad(
      this.texture,
      this.pos[0], this.pos[1],
      this.size[0], this.size[1],
      0,
      this.alpha,
      blendSrc,
      blendDst
    );
  }

  close() {
    this.texture = null;
  }
}
