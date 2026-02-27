import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXBackground1 - Multi-layer parallax tiled background.
 *
 * Renders multiple semi-transparent textured quads at randomized positions.
 * Each quad drifts with sinusoidal motion at slightly different speeds,
 * creating a parallax depth effect. First 4 quads pinned to screen corners.
 *
 * C++ original: FXBackground1.cpp
 * - 22 quads per instance, 0.7x0.7 each
 * - Position: initial + sin(angle + fxTime * speed) / 16
 * - Alpha: 0.6 (constant)
 * - Random seed: srand(100), MSVC rand()
 */

const TWO_PI = Math.PI * 2;

// MSVC rand() implementation for reproducible positions
function msvcRand(state) {
  state.seed = (state.seed * 214013 + 2531011) & 0xFFFFFFFF;
  return ((state.seed >>> 16) & 0x7FFF);
}
const MSVC_RAND_MAX = 0x7FFF;

export class FXBackground1 extends DemoFX {
  constructor() {
    super();
    this.name = 'FXBackground1';

    this.numQuads = 22;
    this.sizeX = 0.7;
    this.sizeY = 0.7;
    this.texturePath = '';

    /** @type {THREE.Texture|null} */
    this.texture = null;
    /** @type {Array<{x: number, y: number}>} */
    this.positions = [];
    /** @type {Float64Array|null} */
    this.speeds = null;
  }

  /**
   * @param {number} numQuads - Number of background quads (22)
   * @param {number} sizeX - Quad width in normalized screen space (0.7)
   * @param {number} sizeY - Quad height in normalized screen space (0.7)
   * @param {string} texturePath - Path to the tile texture
   */
  setup(numQuads, sizeX, sizeY, texturePath) {
    this.numQuads = numQuads;
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.texturePath = texturePath;
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXBackground1: failed to load texture "${this.texturePath}":`, err.message);
      }
    }

    // C++: srand(100), generate random positions and speeds
    const rng = { seed: 100 };
    this.positions = [];
    this.speeds = new Float64Array(this.numQuads);

    for (let i = 0; i < this.numQuads; i++) {
      const x = msvcRand(rng) / MSVC_RAND_MAX;
      const y = msvcRand(rng) / MSVC_RAND_MAX;
      // C++: speed = 1/1024 + (rand()/RAND_MAX) / 4096
      const speed = 0.0009765625 + (msvcRand(rng) / MSVC_RAND_MAX) / 4096;

      this.positions.push({ x, y });
      this.speeds[i] = speed;
    }

    // C++: Pin first 4 quads to screen corners
    if (this.numQuads >= 4) {
      this.positions[0].x = 0; this.positions[0].y = 0; // Top-left
      this.positions[1].x = 0; this.positions[1].y = 1; // Bottom-left
      this.positions[2].x = 1; this.positions[2].y = 1; // Bottom-right
      this.positions[3].x = 1; this.positions[3].y = 0; // Top-right
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    for (let i = 0; i < this.numQuads; i++) {
      const initX = this.positions[i].x;
      const initY = this.positions[i].y;
      const speed = this.speeds[i];

      // C++: fOffX = posY * TWO_PI; fOffY = posX * TWO_PI (swapped!)
      const fOffX = initY * TWO_PI;
      const fOffY = initX * TWO_PI;

      // C++: pos = initial + sin(offset + fxTime * speed) / 16
      const px = initX + Math.sin(fOffX + fxTime * speed) / 16;
      const py = initY + Math.sin(fOffY + fxTime * speed) / 16;

      // C++: PTA3D_DrawCenteredTexturedQuad(x, y, sizeX, sizeY, 0, texture, 0.6f, ...)
      dm.renderer.drawTexturedQuad(
        this.texture,
        px, py,
        this.sizeX, this.sizeY,
        0,    // no rotation
        0.6,  // fixed alpha
      );
    }
  }

  close() {
    this.texture = null;
    this.positions = [];
    this.speeds = null;
  }
}
