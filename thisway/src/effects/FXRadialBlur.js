import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';
import { BlendMode } from '../engine/Renderer.js';

// Map PTA blend modes to Three.js blend factors (duplicated from Renderer for local use)
const BLEND_MAP = {
  [BlendMode.ZERO]: THREE.ZeroFactor,
  [BlendMode.ONE]: THREE.OneFactor,
  [BlendMode.SRCCOLOR]: THREE.SrcColorFactor,
  [BlendMode.INVSRCCOLOR]: THREE.OneMinusSrcColorFactor,
  [BlendMode.SRCALPHA]: THREE.SrcAlphaFactor,
  [BlendMode.INVSRCALPHA]: THREE.OneMinusSrcAlphaFactor,
  [BlendMode.DSTALPHA]: THREE.DstAlphaFactor,
  [BlendMode.INVDSTALPHA]: THREE.OneMinusDstAlphaFactor,
  [BlendMode.DSTCOLOR]: THREE.DstColorFactor,
  [BlendMode.INVDSTCOLOR]: THREE.OneMinusDstColorFactor,
};

/**
 * ShaderMaterial that reads RGB from texture but outputs a fixed alpha.
 * Matches C++ behavior where blur textures are RGB (24-bit, alpha always 1.0).
 * In the C++ code, GL_MODULATE with glColor4f(1,1,1,intensity) produces:
 *   fragment.rgb = texture.rgb, fragment.a = intensity * 1.0
 */
function createBlurMaterial(texture, alpha, srcBlend, dstBlend) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: { value: alpha },
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
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec3 rgb = texture2D(map, vUv).rgb;
        gl_FragColor = vec4(rgb, opacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: BLEND_MAP[srcBlend] || THREE.SrcAlphaFactor,
    blendDst: BLEND_MAP[dstBlend] || THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  });
}

/**
 * FXRadialBlur - Radial/zoom blur post-process effect.
 *
 * Ping-pong framebuffer approach matching the C++ original:
 * 1. Draw previous blur (scaled up = zoom) with intensity alpha
 * 2. Capture framebuffer to accumulation texture
 * 3. Clear entire screen
 * 4. Set demo viewport and draw captured result (opaque, no blend)
 * 5. Swap textures
 *
 * Key C++ detail: blur textures are RGB (24-bit), so texture alpha = 1.0.
 * We use a custom shader to match this — output alpha = opacity uniform,
 * ignoring the RGBA framebuffer alpha captured by FramebufferTexture.
 *
 * Original: FXRadialBlur.cpp
 */
export class FXRadialBlur extends DemoFX {
  constructor() {
    super();
    this.name = 'FXRadialBlur';

    this.w = 512;
    this.h = 512;
    this.duration = 4000;
    this.scale1 = 1.02;
    this.scale2 = 1.02;
    this.intensity1 = 0.5;
    this.intensity2 = 0.5;
    this.addBlend = false;

    /** @type {THREE.FramebufferTexture|null} */
    this.texAccum = null;
    /** @type {THREE.FramebufferTexture|null} */
    this.texRender = null;
    this._firstFrame = true;

    // Reusable geometry/scene for blur quad drawing
    this._blurScene = null;
    this._blurMesh = null;
    this._blurMat = null;
    this._copyScene = null;
    this._copyMesh = null;
    this._copyMat = null;
  }

  setup(w, h, duration, scale1, scale2, intensity1, intensity2, addBlend = false) {
    this.w = w;
    this.h = h;
    this.duration = duration;
    this.scale1 = scale1;
    this.scale2 = scale2;
    this.intensity1 = intensity1;
    this.intensity2 = intensity2;
    this.addBlend = addBlend;
  }

  /**
   * Compute scale and intensity for this frame.
   * FXRadialBlur uses LINEAR interpolation.
   */
  getParams(fxTime) {
    const t = this.duration > 0 ? Math.min(1, fxTime / this.duration) : 1;
    return {
      scale: this.scale1 + (this.scale2 - this.scale1) * t,
      intensity: this.intensity1 + (this.intensity2 - this.intensity1) * t,
    };
  }

  async loadData(dm) {
    // FramebufferTexture dimensions are in physical pixels, but the viewport
    // is set in CSS pixels and scaled by devicePixelRatio internally.
    // We must match physical pixel dimensions to capture the full rendered area.
    const dpr = dm.renderer.webglRenderer.getPixelRatio();
    this.texAccum = new THREE.FramebufferTexture(this.w * dpr, this.h * dpr);
    this.texAccum.minFilter = THREE.LinearFilter;
    this.texAccum.magFilter = THREE.LinearFilter;

    this.texRender = new THREE.FramebufferTexture(this.w * dpr, this.h * dpr);
    this.texRender.minFilter = THREE.LinearFilter;
    this.texRender.magFilter = THREE.LinearFilter;

    // Create reusable blur overlay quad (scaled up each frame)
    const srcBlend = BlendMode.SRCALPHA;
    const dstBlend = this.addBlend ? BlendMode.ONE : BlendMode.INVSRCALPHA;
    this._blurMat = createBlurMaterial(this.texRender, 0.5, srcBlend, dstBlend);
    const blurGeom = new THREE.PlaneGeometry(1, 1);
    this._blurMesh = new THREE.Mesh(blurGeom, this._blurMat);
    this._blurMesh.position.set(0.5, 0.5, 0);
    this._blurScene = new THREE.Scene();
    this._blurScene.add(this._blurMesh);

    // Create reusable copy quad (fullscreen, opaque)
    this._copyMat = createBlurMaterial(this.texAccum, 1.0, BlendMode.ONE, BlendMode.ZERO);
    const copyGeom = new THREE.PlaneGeometry(1, 1);
    this._copyMesh = new THREE.Mesh(copyGeom, this._copyMat);
    this._copyMesh.position.set(0.5, 0.5, 0);
    this._copyScene = new THREE.Scene();
    this._copyScene.add(this._copyMesh);

    this._firstFrame = true;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texAccum || !this.texRender) return;

    const renderer = dm.renderer;
    const gl = renderer.webglRenderer;
    const { scale, intensity } = this.getParams(fxTime);

    // Step 1: Draw previous blur scaled up (zoom effect)
    // C++: glColor4f(1,1,1,intensity) + GL_MODULATE on RGB texture → alpha = intensity
    if (!this._firstFrame && intensity > 0.01) {
      this._blurMat.uniforms.map.value = this.texRender;
      this._blurMat.uniforms.opacity.value = intensity;
      this._blurMesh.scale.set(scale, scale, 1);
      gl.render(this._blurScene, renderer.orthoCamera);
    }

    // Step 2: Capture framebuffer (scene + blur overlay)
    gl.copyFramebufferToTexture(this.texAccum);

    // Step 3: Clear ENTIRE framebuffer (C++ clearImageAndZBuffer)
    renderer.resetViewport();
    renderer.clear(0x000000);

    // Step 4: Set demo viewport and draw captured result (opaque copy)
    // C++: alpha=1.0, non-32-bit texture → blending disabled
    renderer.setDemoViewport();
    this._copyMat.uniforms.map.value = this.texAccum;
    gl.render(this._copyScene, renderer.orthoCamera);

    // Step 5: Swap textures
    const temp = this.texAccum;
    this.texAccum = this.texRender;
    this.texRender = temp;

    this._firstFrame = false;
  }

  close() {
    if (this.texAccum) { this.texAccum.dispose(); this.texAccum = null; }
    if (this.texRender) { this.texRender.dispose(); this.texRender = null; }
    if (this._blurMat) this._blurMat.dispose();
    if (this._blurMesh) this._blurMesh.geometry.dispose();
    if (this._copyMat) this._copyMat.dispose();
    if (this._copyMesh) this._copyMesh.geometry.dispose();
    this._blurScene = null;
    this._copyScene = null;
  }
}

/**
 * FXRadialBlurInOut - Variant with sinusoidal in/out breathing effect.
 * Uses sin(t * PI) → 0→1→0 interpolation over the duration.
 *
 * Original: FXRadialBlur.cpp (InOut variant)
 */
export class FXRadialBlurInOut extends FXRadialBlur {
  constructor() {
    super();
    this.name = 'FXRadialBlurInOut';
  }

  getParams(fxTime) {
    const t = this.duration > 0 ? Math.min(1, fxTime / this.duration) : 1;
    const s = Math.sin(t * Math.PI);
    return {
      scale: this.scale1 + (this.scale2 - this.scale1) * s,
      intensity: this.intensity1 + (this.intensity2 - this.intensity1) * s,
    };
  }
}

/**
 * FXRadialBlurCircles - Multi-pass variant with interpolated scale vectors.
 *
 * Original: Not a direct C++ class — uses FXRadialBlur with multi-pass overlays.
 */
export class FXRadialBlurCircles extends DemoFX {
  constructor() {
    super();
    this.name = 'FXRadialBlurCircles';
    this.w = 512;
    this.h = 512;
    this.period = 4000;
    this.numPasses = 4;
    this.scaleVec1 = [1.02, 1.02];
    this.scaleVec2 = [1.05, 1.05];
    this.alpha = 0.5;
    this.flag = 0;
  }

  setup(w, h, period, numPasses, scaleVec1, scaleVec2, alpha, flag) {
    this.w = w;
    this.h = h;
    this.period = period;
    this.numPasses = numPasses;
    this.scaleVec1 = scaleVec1;
    this.scaleVec2 = scaleVec2;
    this.alpha = alpha;
    this.flag = flag;
  }

  async loadData(dm) {}

  doFrame(fxTime, demoTime, dm) {
    const phase = (fxTime / this.period) * Math.PI * 2;
    const t = (Math.sin(phase) + 1) * 0.5;

    for (let i = 0; i < this.numPasses; i++) {
      const passFrac = (i + 1) / this.numPasses;
      const sx = this.scaleVec1[0] + (this.scaleVec2[0] - this.scaleVec1[0]) * passFrac;
      const sy = this.scaleVec1[1] + (this.scaleVec2[1] - this.scaleVec1[1]) * passFrac;
      const passAlpha = this.alpha * (1 - passFrac * 0.5) * t;
      if (passAlpha <= 0) continue;

      dm.renderer.drawColoredQuad(
        0.5, 0.5, sx, sy,
        0x000000, passAlpha * 0.1,
        BlendMode.SRCALPHA, BlendMode.INVSRCALPHA
      );
    }
  }

  close() {}
}
