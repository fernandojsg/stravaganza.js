import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXEuskal10Greets - Stencil-masked text reveal/hide.
 *
 * Displays a textured quad with a 3-phase animation:
 * 1. Appear: horizontal blocker bars shrink as count increases, revealing text
 * 2. Hold: no blockers, full text visible
 * 3. Disappear: blocker bars grow as count decreases, hiding text
 *
 * C++ original used stencil buffer; JS simulates with canvas-based alpha mask.
 * Each blocker is a FULL-WIDTH HORIZONTAL bar that oscillates vertically
 * with a random phase offset. The union of all bars blocks the text.
 *
 * Original: FXEuskal10Greets.cpp
 * - 60 quads, each full-width (m_fWidth), variable height
 * - Quad height: (m_fHeight * 5.0 / nNumQuads) * ((60 - nNumQuads) / 60)
 * - Y oscillation: m_fY + sin(fT * TWO_PI + fxTime * 0.001) * (m_fHeight * 0.5)
 * - Stencil: draw bars to stencil only, then draw texture where stencil != 1
 */

const TWO_PI = Math.PI * 2;
const MAXNUMQUADS = 60;
const MASK_W = 64;   // Full-width bars don't need horizontal resolution
const MASK_H = 256;  // Vertical resolution matters for horizontal bars

export class FXEuskal10Greets extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEuskal10Greets';

    this.x = 0.5;
    this.y = 0.5;
    this.w = 0.3;
    this.h = 0.06;
    this.fadeIn = 1500;
    this.stay = 2000;
    this.fadeOut = 1500;
    this.texturePath = '';

    /** @type {THREE.Texture|null} */
    this.texture = null;
    /** @type {Float64Array} */
    this.phases = new Float64Array(MAXNUMQUADS);
    /** @type {HTMLCanvasElement|null} */
    this.maskCanvas = null;
    /** @type {CanvasRenderingContext2D|null} */
    this.maskCtx = null;
    /** @type {THREE.CanvasTexture|null} */
    this.maskTexture = null;
  }

  /**
   * @param {number} x - Center X position (0-1)
   * @param {number} y - Center Y position (0-1)
   * @param {number} w - Width (0-1)
   * @param {number} h - Height (0-1)
   * @param {number} fadeIn - Appear duration (ms)
   * @param {number} stay - Hold duration (ms)
   * @param {number} fadeOut - Disappear duration (ms)
   * @param {string} texturePath - Path to the text texture
   */
  setup(x, y, w, h, fadeIn, stay, fadeOut, texturePath) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.fadeIn = fadeIn;
    this.stay = stay;
    this.fadeOut = fadeOut;
    this.texturePath = texturePath;
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXEuskal10Greets: failed to load texture "${this.texturePath}":`, err.message);
      }
    }

    // C++: rand() to generate 60 random phase offsets [0,1]
    // No explicit seed — uses whatever was active. Use simple LCG for consistency.
    for (let i = 0; i < MAXNUMQUADS; i++) {
      this.phases[i] = Math.random();
    }

    // Alpha mask canvas (white = visible, black = blocked)
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = MASK_W;
    this.maskCanvas.height = MASK_H;
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.maskTexture = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTexture.minFilter = THREE.LinearFilter;
    this.maskTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.colorSpace = THREE.LinearSRGBColorSpace;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    // C++ nNumQuads calculation (3 phases)
    let nNumQuads = 0;

    if (fxTime < this.fadeIn) {
      // Phase 1 - Appear: nNumQuads = MAXNUMQUADS * (fxTime / fadeIn), min 1
      nNumQuads = Math.floor(MAXNUMQUADS * (fxTime / this.fadeIn));
      if (nNumQuads < 1) nNumQuads = 1;
    } else if (fxTime < this.fadeIn + this.stay) {
      // Phase 2 - Hold: no blockers
      nNumQuads = 0;
    } else {
      // Phase 3 - Disappear: nNumQuads = MAXNUMQUADS - MAXNUMQUADS * fadeOutT, min 1
      const fadeOutElapsed = fxTime - this.fadeIn - this.stay;
      nNumQuads = Math.floor(MAXNUMQUADS - (MAXNUMQUADS * (fadeOutElapsed / this.fadeOut)));
      if (nNumQuads < 1) nNumQuads = 1;
    }

    if (nNumQuads === 0) {
      // Hold phase: draw full texture directly (alpha = 1.0, white color)
      dm.renderer.drawTexturedQuad(
        this.texture,
        this.x, this.y,
        this.w, this.h,
        0, 1.0,
        4, 5
      );
      return;
    }

    // C++ quad height: (m_fHeight * 5.0 / nNumQuads) * ((MAXNUMQUADS - nNumQuads) / MAXNUMQUADS)
    // This is in normalized screen units. Convert to mask-relative:
    // fQuadHeight_screen = (h * 5.0 / nNumQuads) * ((60 - nNumQuads) / 60)
    // fQuadHeight_mask = (fQuadHeight_screen / h) * MASK_H
    const heightRatio = (5.0 / nNumQuads) * ((MAXNUMQUADS - nNumQuads) / MAXNUMQUADS);
    const barH = heightRatio * MASK_H;

    // C++ Y oscillation amplitude: m_fHeight * 0.5 in screen coords
    // In mask coords: (m_fHeight * 0.5 / m_fHeight) * MASK_H = 0.5 * MASK_H
    const oscAmp = 0.5 * MASK_H;

    // Update mask canvas: white = visible, black = blocked
    const ctx = this.maskCtx;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, MASK_W, MASK_H);

    // Draw HORIZONTAL blocker bars (full width, variable height, oscillating Y)
    ctx.fillStyle = 'black';
    for (let i = 0; i < nNumQuads; i++) {
      // C++: fY = m_fY + sin(fT * TWO_PI + fxTime * 0.001) * (m_fHeight * 0.5)
      // In mask space: bar center = MASK_H/2 + sin(...) * oscAmp
      const yOsc = Math.sin(this.phases[i] * TWO_PI + fxTime * 0.001);
      const barCenterY = (MASK_H / 2) + yOsc * oscAmp;
      const by = barCenterY - barH / 2;

      // Full-width horizontal bar
      ctx.fillRect(0, by, MASK_W, barH);
    }

    this.maskTexture.needsUpdate = true;

    // Draw textured quad with alpha mask
    const geom = new THREE.PlaneGeometry(this.w, this.h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      alphaMap: this.maskTexture,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(this.x, 1 - this.y, 0);

    const scene = new THREE.Scene();
    scene.add(mesh);
    dm.renderer.webglRenderer.render(scene, dm.renderer.orthoCamera);

    geom.dispose();
    mat.dispose();
  }

  close() {
    this.texture = null;
    if (this.maskTexture) {
      this.maskTexture.dispose();
      this.maskTexture = null;
    }
    this.maskCanvas = null;
    this.maskCtx = null;
  }
}
