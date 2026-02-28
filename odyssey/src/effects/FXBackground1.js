import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXBackground1 - Multi-layer parallax tiled background.
 * Renders multiple semi-transparent textured quads at randomized positions.
 * Each quad drifts with sinusoidal motion. First 4 quads pinned to corners.
 * C++ original: Odyssey/FXBackground1.cpp (identical to thisway version)
 */

const TWO_PI = Math.PI * 2;

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
    this.texture = null;
    this.positions = [];
    this.speeds = null;
  }

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

    const rng = { seed: 100 };
    this.positions = [];
    this.speeds = new Float64Array(this.numQuads);

    for (let i = 0; i < this.numQuads; i++) {
      const x = msvcRand(rng) / MSVC_RAND_MAX;
      const y = msvcRand(rng) / MSVC_RAND_MAX;
      const speed = 0.0009765625 + (msvcRand(rng) / MSVC_RAND_MAX) / 4096;
      this.positions.push({ x, y });
      this.speeds[i] = speed;
    }

    if (this.numQuads >= 4) {
      this.positions[0].x = 0; this.positions[0].y = 0;
      this.positions[1].x = 0; this.positions[1].y = 1;
      this.positions[2].x = 1; this.positions[2].y = 1;
      this.positions[3].x = 1; this.positions[3].y = 0;
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    for (let i = 0; i < this.numQuads; i++) {
      const initX = this.positions[i].x;
      const initY = this.positions[i].y;
      const speed = this.speeds[i];

      const fOffX = initY * TWO_PI;
      const fOffY = initX * TWO_PI;

      const px = initX + Math.sin(fOffX + fxTime * speed) / 16;
      const py = initY + Math.sin(fOffY + fxTime * speed) / 16;

      dm.renderer.drawTexturedQuad(this.texture, px, py, this.sizeX, this.sizeY, 0, 0.6);
    }
  }

  close() {
    this.texture = null;
    this.positions = [];
    this.speeds = null;
  }
}
