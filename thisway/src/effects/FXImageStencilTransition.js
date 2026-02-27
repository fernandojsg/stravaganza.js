import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXImageStencilTransition - Image-mask based transition (two-phase).
 *
 * C++ uses per-pixel alpha decay on a mask texture + stencil buffer to block
 * subsequent effects from rendering in "decayed" areas — revealing the
 * previously rendered scene underneath.
 *
 * JS two-phase approach (same pattern as FXStencilTransitionScaleOut):
 * 1. FXTransitionCapture (lower priority, after old scene) captures framebuffer
 * 2. This effect (higher priority, after new scene) renders captured old content
 *    WHERE the mask has decayed, creating an organic dissolve.
 *
 * Mask texture: alpha channel encodes reveal timing.
 * Low-alpha pixels decay (reach threshold) first → old scene shows there first.
 * Over the duration, the threshold sweeps 0→max, progressively revealing old scene.
 *
 * Original: FXImageStencilTransition.cpp
 */
export class FXImageStencilTransition extends DemoFX {
  constructor() {
    super();
    this.name = 'FXImageStencilTransition';

    this.duration = 2000;
    this.texturePath = '';

    /** @type {THREE.Texture|null} */
    this.maskTexture = null;

    /** @type {THREE.FramebufferTexture|null} */
    this.texCapture = null;

    /** @type {THREE.ShaderMaterial|null} */
    this.material = null;

    /** @type {THREE.Mesh|null} */
    this.quad = null;

    /** @type {THREE.Scene|null} */
    this.scene = null;

    this._texW = 0;
    this._texH = 0;
  }

  /**
   * @param {number} duration - Transition duration in ms
   * @param {string} texturePath - Path to the mask texture (alpha channel)
   */
  setup(duration, texturePath) {
    this.duration = duration;
    this.texturePath = texturePath;
  }

  /**
   * Ensure the capture texture matches the given dimensions.
   * Called by FXTransitionCapture before capturing.
   */
  _ensureTexture(w, h) {
    if (this._texW === w && this._texH === h && this.texCapture) return;

    if (this.texCapture) this.texCapture.dispose();

    const dpr = window.devicePixelRatio || 1;
    this.texCapture = new THREE.FramebufferTexture(w * dpr, h * dpr);
    this.texCapture.minFilter = THREE.LinearFilter;
    this.texCapture.magFilter = THREE.LinearFilter;

    if (this.material) {
      this.material.uniforms.captureTex.value = this.texCapture;
    }

    this._texW = w;
    this._texH = h;
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.maskTexture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXImageStencilTransition: failed to load mask "${this.texturePath}":`, err.message);
      }
    }

    // Shader composites captured old scene through the mask pattern.
    // Where mask alpha < threshold (decayed): show captured content (old scene)
    // Where mask alpha >= threshold (not decayed): transparent (new scene shows)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        maskTex: { value: this.maskTexture },
        captureTex: { value: null },
        threshold: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D maskTex;
        uniform sampler2D captureTex;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
          float mask = texture2D(maskTex, vUv).a;
          // mask >= threshold → keep old scene (captured)
          // mask < threshold → transparent (new scene shows through)
          float decayed = step(threshold, mask);
          vec4 captured = texture2D(captureTex, vUv);
          gl_FragColor = vec4(captured.rgb, decayed);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const geom = new THREE.PlaneGeometry(1, 1);
    this.quad = new THREE.Mesh(geom, this.material);
    this.quad.position.set(0.5, 0.5, 0);

    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.material || !this.scene || !this.texCapture) return;

    const t = this.duration > 0
      ? Math.max(0, Math.min(1, fxTime / this.duration))
      : 1;

    this.material.uniforms.threshold.value = t;

    dm.renderer.webglRenderer.render(this.scene, dm.renderer.orthoCamera);
  }

  close() {
    if (this.material) this.material.dispose();
    if (this.quad) this.quad.geometry.dispose();
    if (this.texCapture) { this.texCapture.dispose(); this.texCapture = null; }
    this.material = null;
    this.quad = null;
    this.scene = null;
    this.maskTexture = null;
    this._texW = 0;
    this._texH = 0;
  }
}
