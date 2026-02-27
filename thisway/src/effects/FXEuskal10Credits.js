import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXEuskal10Credits - Per-character formation/deformation credits.
 *
 * Displays a name by animating individual character textures with 3 phases:
 * 1. Formation: Characters appear staggered, each starts as a near-full-screen
 *    tall thin line and squishes down to normal size.
 * 2. Stable: All characters visible at base size, alpha 0.8
 * 3. Deformation: Characters stretch back to full-screen tall thin lines, disappearing
 *
 * Original: FXEuskal10Credits.cpp
 * - INITIALHEIGHT = 3.0 (added DIRECTLY to base height, not multiplied)
 * - Width formation: sin²(3π/2 + fT·π/2) * baseWidth
 * - Height formation: baseHeight + cos(fT·π/2) * 3.0
 * - Width deformation: cos²(fT·π/2) * baseWidth
 * - Height deformation: baseHeight + sin(fT·π/2) * 3.0
 * - buildTime = formationDuration - (numChars * quadDelay)
 * - X position: centerX - totalWidth/2 + (i/numChars * totalWidth)
 * - Alpha 0.8 when visible
 */

const PI = Math.PI;
const HALF_PI = PI / 2;
const THREE_HALF_PI = PI + HALF_PI; // 3π/2
const INITIALHEIGHT = 3.0;

export class FXEuskal10Credits extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEuskal10Credits';

    this.numChars = 0;
    this.charTextures = [];
    this.textureDir = '';
    this.x = 0.5;
    this.y = 0.5;
    this.charW = 0.04;
    this.charH = 0.04;
    this.spacing = 0.3;       // fTotalWidth
    this.totalDuration = 5000; // fDuration
    this.charDelay = 1000;     // fFormationDuration
    this.fadeTime = 200;       // fQuadDelay (per-character stagger)

    /** @type {THREE.Texture[]} */
    this.textures = [];
  }

  /**
   * @param {number} numChars - Number of characters
   * @param {string[]} charTextures - Texture filenames per character
   * @param {string} textureDir - Directory containing character textures
   * @param {number} x - Center X of text string (0-1)
   * @param {number} y - Center Y of text string (0-1)
   * @param {number} charW - Base width of each character (0-1)
   * @param {number} charH - Base height of each character (0-1)
   * @param {number} spacing - Total horizontal span (fTotalWidth, 0-1)
   * @param {number} totalDuration - Total animation duration in ms (fDuration)
   * @param {number} charDelay - Formation/deformation phase duration in ms (fFormationDuration)
   * @param {number} fadeTime - Per-character stagger in ms (fQuadDelay)
   */
  setup(numChars, charTextures, textureDir, x, y, charW, charH, spacing, totalDuration, charDelay, fadeTime) {
    this.numChars = numChars;
    this.charTextures = charTextures;
    this.textureDir = textureDir;
    this.x = x;
    this.y = y;
    this.charW = charW;
    this.charH = charH;
    this.spacing = spacing;
    this.totalDuration = totalDuration;
    this.charDelay = charDelay;
    this.fadeTime = fadeTime;
  }

  async loadData(dm) {
    this.textures = [];
    for (let i = 0; i < this.numChars; i++) {
      const filename = this.charTextures[i] || '';
      if (filename) {
        try {
          const tex = await dm.assetManager.loadTextureByPath(`${this.textureDir}/${filename}`);
          this.textures.push(tex);
        } catch (err) {
          console.warn(`FXEuskal10Credits: failed to load char texture "${filename}":`, err.message);
          this.textures.push(null);
        }
      } else {
        this.textures.push(null);
      }
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (this.numChars <= 0) return;

    // C++ phase boundaries
    const formEnd = this.charDelay;                           // fFormationDuration
    const deformStart = this.totalDuration - this.charDelay;  // fDuration - fFormationDuration

    // C++ buildTime = fFormationDuration - (nNumChars * fQuadDelay)
    const buildTime = this.charDelay - (this.numChars * this.fadeTime);

    for (let i = 0; i < this.numChars; i++) {
      const tex = this.textures[i];
      if (!tex) continue;

      // C++ character X position: m_fX - (m_fTotalWidth * 0.5) + ((nCount / nNumChars) * m_fTotalWidth)
      const cx = this.x - (this.spacing * 0.5) + ((i / this.numChars) * this.spacing);

      let drawW = this.charW;
      let drawH = this.charH;
      let alpha = 0.0;

      if (fxTime < formEnd) {
        // Phase 1: Formation
        // C++: fTime = fxTime - (m_fQuadDelay * nCount)
        const fTime = fxTime - (this.fadeTime * i);
        // C++: fT = fTime / fBuildTime
        const fT = buildTime > 0 ? fTime / buildTime : 1;

        if (fT < 0.0) {
          // Character hasn't started yet
          alpha = 0.0;
        } else if (fT < 1.0) {
          // Actively forming
          // C++: fSin = 1.0 + sinf(PI + HALFPI + (fT * HALFPI))
          const fSin = 1.0 + Math.sin(THREE_HALF_PI + fT * HALF_PI);
          drawW = (fSin * fSin) * this.charW;

          // C++: fQuadHeight = m_fQuadHeight + (cosf(fT * HALFPI) * INITIALHEIGHT)
          // INITIALHEIGHT = 3.0 added DIRECTLY, not multiplied by charH!
          drawH = this.charH + Math.cos(fT * HALF_PI) * INITIALHEIGHT;

          alpha = 0.8;
        } else {
          // fT >= 1.0: formation done, waiting for stable phase
          drawW = this.charW;
          drawH = this.charH;
          alpha = 0.8;
        }
      } else if (fxTime < deformStart) {
        // Phase 2: Stable - all chars at normal size
        drawW = this.charW;
        drawH = this.charH;
        alpha = 0.8;
      } else {
        // Phase 3: Deformation
        // C++: fTime = fxTime - (m_fDuration - m_fFormationDuration) - (m_fQuadDelay * nCount)
        const fTime = fxTime - deformStart - (this.fadeTime * i);
        // C++: fT = fTime / fQuitTime (same as buildTime)
        const fT = buildTime > 0 ? fTime / buildTime : 1;

        if (fT < 0.0) {
          // Not yet deforming, still in stable state
          drawW = this.charW;
          drawH = this.charH;
          alpha = 0.8;
        } else if (fT < 1.0) {
          // Actively deforming
          // C++: fCos = cosf(fT * HALFPI)
          const fCos = Math.cos(fT * HALF_PI);
          drawW = (fCos * fCos) * this.charW;

          // C++: fQuadHeight = m_fQuadHeight + (sinf(fT * HALFPI) * INITIALHEIGHT)
          drawH = this.charH + Math.sin(fT * HALF_PI) * INITIALHEIGHT;

          alpha = 0.8;
        } else {
          // fT >= 1.0: deformation done, character disappeared
          alpha = 0.0;
        }
      }

      if (alpha <= 0) continue;
      if (drawW < 0.001) continue;

      dm.renderer.drawTexturedQuad(
        tex,
        cx, this.y,
        drawW, drawH,
        0,
        alpha,
        4, // SRCALPHA
        5  // INVSRCALPHA
      );
    }
  }

  close() {
    this.textures = [];
  }
}
