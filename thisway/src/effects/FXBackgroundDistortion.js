import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXBackgroundDistortion - Animated grid-based background distortion.
 *
 * Captures the current framebuffer, then redraws it through a distorted
 * grid mesh. The grid vertices' UV coordinates are displaced sinusoidally
 * based on distance from center, creating a wavy, liquid distortion effect.
 *
 * The amplitude envelope follows cos(t/duration * PI/2), starting strong
 * and fading to zero.
 *
 * Original: FXBackgroundDistortion.cpp
 */
export class FXBackgroundDistortion extends DemoFX {
  constructor() {
    super();
    this.name = 'FXBackgroundDistortion';

    this.gridW = 40;
    this.gridH = 40;
    this.duration = 4000;
    this.clearColor = { r: 0, g: 0, b: 0 };

    /** @type {THREE.FramebufferTexture|null} */
    this.texCapture = null;
    /** @type {THREE.Mesh|null} */
    this.mesh = null;
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {Float32Array|null} */
    this.originalUVs = null;
  }

  /**
   * Configure the background distortion effect.
   * @param {number} gridW - Grid width (number of segments)
   * @param {number} gridH - Grid height (number of segments)
   * @param {number} duration - Effect duration (ms)
   * @param {{r:number, g:number, b:number}} clearColor - Clear color (0-1 range)
   */
  setup(gridW, gridH, duration, clearColor) {
    this.gridW = gridW;
    this.gridH = gridH;
    this.duration = duration;
    this.clearColor = clearColor || { r: 0, g: 0, b: 0 };
  }

  /**
   * Build the distortion grid mesh. Framebuffer texture is created lazily
   * in doFrame to match the current viewport size (set by ViewportInt).
   * @param {import('../engine/DemoManager.js').DemoManager} dm
   */
  async loadData(dm) {
    // Grid mesh covering 0-1 screen space
    const geometry = new THREE.PlaneGeometry(1, 1, this.gridW, this.gridH);

    // ShaderMaterial that outputs captured framebuffer pixels directly.
    // C++ disables blending and lighting. FramebufferTexture captures sRGB data;
    // raw output via ShaderMaterial avoids Three.js re-encoding it to sRGB.
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(map, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0.5, 0.5, 0);

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    // Store original UVs for distortion calculation
    this.originalUVs = geometry.attributes.uv.array.slice();

    // Track last viewport size for lazy texture creation
    this._texW = 0;
    this._texH = 0;
  }

  /**
   * Ensure the capture texture matches the current viewport dimensions.
   * @param {number} w - Viewport width
   * @param {number} h - Viewport height
   */
  _ensureTexture(w, h) {
    if (this._texW === w && this._texH === h && this.texCapture) return;

    if (this.texCapture) this.texCapture.dispose();

    const dpr = window.devicePixelRatio || 1;
    this.texCapture = new THREE.FramebufferTexture(w * dpr, h * dpr);
    this.texCapture.minFilter = THREE.LinearFilter;
    this.texCapture.magFilter = THREE.LinearFilter;
    this.mesh.material.uniforms.map.value = this.texCapture;
    this._texW = w;
    this._texH = h;
  }

  /**
   * Distort UV coordinates. Can be overridden by subclasses.
   * Base class: radial sinusoidal distortion with cosine amplitude envelope.
   *
   * @param {Float32Array} uvs - UV array to modify
   * @param {Float32Array} original - Original UV values
   * @param {number} fxTime - Time since effect start (ms)
   * @param {number} duration - Effect duration (ms)
   */
  distort(uvs, original, fxTime, duration) {
    // Amplitude envelope: starts at max, decays to 0 by end
    const t = Math.min(1, fxTime / duration);
    const amplitude = Math.cos(t * Math.PI * 0.5) * 0.02;

    for (let i = 0; i < uvs.length; i += 2) {
      const u = original[i];
      const v = original[i + 1];

      // Distance from center (0.5, 0.5)
      const dx = u - 0.5;
      const dy = v - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Sinusoidal displacement based on distance and time
      const offset = Math.sin(dist * 10 + fxTime * 0.01) * amplitude;

      uvs[i] = u + offset;
      uvs[i + 1] = v + offset;
    }
  }

  /**
   * Capture framebuffer, distort grid, and redraw.
   * @param {number} fxTime - Time since effect start (ms)
   * @param {number} demoTime - Absolute demo time (ms)
   * @param {import('../engine/DemoManager.js').DemoManager} dm
   */
  doFrame(fxTime, demoTime, dm) {
    if (!this.mesh) return;

    const renderer = dm.renderer;
    const gl = renderer.webglRenderer;

    // Step 1: Match texture to current viewport (e.g. 512x512 from ViewportInt)
    const vp = renderer.currentViewport;
    this._ensureTexture(vp.w, vp.h);

    // Step 2: Capture current framebuffer to texture
    gl.copyFramebufferToTexture(this.texCapture);

    // Step 3: Clear entire framebuffer (C++ clearImageAndZBuffer clears everything,
    // not just the viewport — must reset viewport first so scissor doesn't clip)
    renderer.resetViewport();
    renderer.clear(0x000000);

    // Step 4: Set demo viewport and fill with clear color
    renderer.setDemoViewport();
    const cc = this.clearColor;
    const clearHex = (Math.round(cc.r * 255) << 16) |
                     (Math.round(cc.g * 255) << 8) |
                     Math.round(cc.b * 255);
    if (clearHex !== 0x000000) {
      renderer.clear(clearHex);
    }

    // Step 5: Distort UVs
    const uvs = this.mesh.geometry.attributes.uv.array;
    this.distort(uvs, this.originalUVs, fxTime, this.duration);
    this.mesh.geometry.attributes.uv.needsUpdate = true;

    // Step 6: Render distorted grid with captured framebuffer
    gl.render(this.scene, renderer.orthoCamera);
  }

  close() {
    if (this.texCapture) { this.texCapture.dispose(); this.texCapture = null; }
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    this.mesh = null;
    this.scene = null;
    this.originalUVs = null;
  }
}

/**
 * FXBackgroundDistortionArrows - Variant used in the arrows section.
 * Uses a sine-wave envelope with decreasing amplitude.
 *
 * Original: FXBackgroundDistortion.cpp (Arrows variant)
 */
export class FXBackgroundDistortionArrows extends FXBackgroundDistortion {
  constructor() {
    super();
    this.name = 'FXBackgroundDistortionArrows';
  }

  distort(uvs, original, fxTime, duration) {
    const t = Math.min(1, fxTime / duration);
    const amplitude = Math.sin(t * Math.PI) * 0.003;

    for (let i = 0; i < uvs.length; i += 2) {
      const u = original[i];
      const v = original[i + 1];
      const dx = u - 0.5;
      const dy = v - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const offset = Math.sin(dist * 10 + fxTime * 0.01) * amplitude;
      uvs[i] = u + offset;
      uvs[i + 1] = v + offset;
    }
  }
}
