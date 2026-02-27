import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXGlow2 - Animated glow effect with radiating rays from a ray map.
 *
 * Reads a ray map bitmap (same as the glow texture) where each non-black pixel
 * becomes a line segment radiating from the letter center outward. Rays have:
 *   - Per-ray blinking alpha (oscillating between min/max)
 *   - Sinusoidal rotation of endpoints
 *   - Opacity texture with cylindrical UV mapping and scrolling V
 *   - Additive blending (SRCALPHA/ONE)
 *
 * C++ original: GL_MODULATE with opacity texture applied via glTexCoordPointer.
 * Cylindrical UVs: u = atan2(dx,dy)/(2π), v = acos(z)/π, scaled ×0.7.
 * Texture matrix scrolls V at fxTime * 0.0001.
 *
 * Used for the T-H-I-S-W-A-Y letter glow reveals.
 *
 * Original: FXGlow2.cpp
 */

const GLOW2_ALPHA = 0.4;
const GLOW2_MAX_BLINK_ALPHA = 0.6;
const GLOW2_MIN_BLINK_ALPHA = 0.05;
const Y_ROT_AMPLITUDE = 5.0; // degrees
const Y_ROT_SPEED = 0.0010;
const X_ROT_AMPLITUDE = 0.0;
const X_ROT_SPEED = 0.0004;
const TWO_PI = Math.PI * 2;

export class FXGlow2 extends DemoFX {
  constructor() {
    super();
    this.name = 'FXGlow2';

    this.x = 0.5;
    this.y = 0.5;
    this.w = 0.15;
    this.h = 0.2;
    this.depth = 0.89;
    this.scaleX = 3.0;
    this.scaleY = 3.0;
    this.delay = 3000;
    this.blink = true;
    this.glowTexPath = '';
    this.rayMapPath = '';
    this.opacityTexPath = '';

    this.glowTexture = null;
    this.opacityTexture = null;
    this.numRays = 0;
    this.blinks = null;
    this.lineSegments = null;
    this.lineScene = null;
    this.initialStartPositions = null;
    this.initialEndOffsets = null;
    this.lastTime = 0;
  }

  setup(x, y, w, h, depth, scaleX, scaleY, delay, blink, glowTex, rayMap, opacityTex) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.depth = depth;
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.delay = delay;
    this.blink = blink;
    this.glowTexPath = glowTex;
    this.rayMapPath = rayMap;
    this.opacityTexPath = opacityTex;
  }

  async loadData(dm) {
    const loadTex = async (path) => {
      if (!path) return null;
      try {
        return await dm.assetManager.loadTextureByPath(path);
      } catch (err) {
        console.warn(`FXGlow2: failed to load texture "${path}":`, err.message);
        return null;
      }
    };

    this.glowTexture = await loadTex(this.glowTexPath);
    this.opacityTexture = await loadTex(this.opacityTexPath);
    if (this.opacityTexture) {
      this.opacityTexture.wrapS = THREE.RepeatWrapping;
      this.opacityTexture.wrapT = THREE.RepeatWrapping;
    }

    // Load ray map as pixel data
    const rayMapTex = await loadTex(this.rayMapPath);
    if (!rayMapTex || !rayMapTex.image) return;

    const img = rayMapTex.image;
    let pixels, width, height;

    if (img.data) {
      // ImageData format (TGA loader returns this)
      pixels = img.data;
      width = img.width;
      height = img.height;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      pixels = imgData.data;
      width = canvas.width;
      height = canvas.height;
    }

    // Collect non-black pixels as ray origins
    const rayPixels = [];
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = (py * width + px) * 4;
        if ((pixels[idx] | pixels[idx + 1] | pixels[idx + 2]) !== 0) {
          rayPixels.push({ px, py });
        }
      }
    }

    this.numRays = rayPixels.length;
    if (this.numRays === 0) return;

    // Build ray geometry
    // Each ray = 2 vertices (start at letter pixel, end scaled outward)
    const positions = new Float32Array(this.numRays * 2 * 3);
    const colors = new Float32Array(this.numRays * 2 * 4);
    const uvs = new Float32Array(this.numRays * 2 * 2);
    this.initialStartPositions = new Float32Array(this.numRays * 3);
    this.initialEndOffsets = new Float32Array(this.numRays * 3);
    this.blinks = new Array(this.numRays);

    // Center point for scaling (PTA viewport coords: y=0=top)
    const midX = (0.5 + this.x) / 2.0;
    const midYPta = (0.5 + this.y) / 2.0;
    // Flip to Three.js ortho coords (y=0=bottom)
    const midY = 1 - midYPta;

    // Glow center in Three.js coords (for cylindrical UV mapping)
    const cx = this.x;
    const cy = 1 - this.y;

    for (let i = 0; i < this.numRays; i++) {
      const rp = rayPixels[i];

      // Map pixel position to screen space within the glow area (PTA coords)
      const tx = rp.px / (width - 1);
      const ty = rp.py / (height - 1);
      const screenX = (this.x - this.w * 0.5) + this.w * tx;
      const screenYPta = (this.y - this.h * 0.5) + this.h * ty;
      // Flip to Three.js ortho coords (PTA y=0=top → Three.js y=0=bottom)
      const screenY = 1 - screenYPta;

      // Start vertex: at the letter position in ortho coords (0-1 range)
      this.initialStartPositions[i * 3 + 0] = screenX;
      this.initialStartPositions[i * 3 + 1] = screenY;
      this.initialStartPositions[i * 3 + 2] = 0;

      // End vertex: scaled outward from center
      const endX = (screenX - midX) * this.scaleX;
      const endY = (screenY - midY) * this.scaleY;

      // Store as offset from start position
      this.initialEndOffsets[i * 3 + 0] = endX - (screenX - midX);
      this.initialEndOffsets[i * 3 + 1] = endY - (screenY - midY);
      this.initialEndOffsets[i * 3 + 2] = 0;

      // Compute absolute end position for UV mapping
      const absEndX = screenX + this.initialEndOffsets[i * 3 + 0];
      const absEndY = screenY + this.initialEndOffsets[i * 3 + 1];

      // Cylindrical UV mapping (C++: atan2(vec.x,vec.y)/(2π), acos(vec.z)/π)
      // In 2D: U = angular direction from center, V = distance from center
      const dx1 = screenX - cx;
      const dy1 = screenY - cy;
      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

      const dx2 = absEndX - cx;
      const dy2 = absEndY - cy;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      // U: angular position (atan2 matching C++ atan2(x,y))
      const u1 = Math.atan2(dx1, dy1) / TWO_PI;
      const u2 = Math.atan2(dx2, dy2) / TWO_PI;

      // V: radial distance (approximates acos(z)/π for our 2D case)
      const v1 = dist1;
      const v2 = dist2;

      // Scale by 0.7 (matching C++)
      const ui = i * 4;
      uvs[ui + 0] = u1 * 0.7;
      uvs[ui + 1] = v1 * 0.7;
      uvs[ui + 2] = u2 * 0.7;
      uvs[ui + 3] = v2 * 0.7;

      // Colors: white, start vertex has alpha, end vertex has alpha=0
      const ci = i * 8;
      colors[ci + 0] = 1.0;
      colors[ci + 1] = 1.0;
      colors[ci + 2] = 1.0;
      colors[ci + 3] = GLOW2_ALPHA;
      colors[ci + 4] = 1.0;
      colors[ci + 5] = 1.0;
      colors[ci + 6] = 1.0;
      colors[ci + 7] = 0.0;

      // Initialize blink state
      this.blinks[i] = {
        alpha: GLOW2_MIN_BLINK_ALPHA + Math.random() * (GLOW2_MAX_BLINK_ALPHA - GLOW2_MIN_BLINK_ALPHA),
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 1.0 + Math.random() * 3.0,
      };
    }

    // Set initial positions
    for (let i = 0; i < this.numRays; i++) {
      const pi = i * 6;
      positions[pi + 0] = this.initialStartPositions[i * 3 + 0];
      positions[pi + 1] = this.initialStartPositions[i * 3 + 1];
      positions[pi + 2] = 0;
      positions[pi + 3] = this.initialStartPositions[i * 3 + 0] + this.initialEndOffsets[i * 3 + 0];
      positions[pi + 4] = this.initialStartPositions[i * 3 + 1] + this.initialEndOffsets[i * 3 + 1];
      positions[pi + 5] = 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

    // Shader with opacity texture sampling (GL_MODULATE: output = vertexColor × texture)
    // C++: texture matrix scrolls V at fxTime * 0.0001
    const hasOpacity = !!this.opacityTexture;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        opacityMap: { value: this.opacityTexture },
        uvScroll: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 color;
        attribute vec2 aUv;
        varying vec4 vColor;
        varying vec2 vUv;
        void main() {
          vColor = color;
          vUv = aUv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: hasOpacity ? /* glsl */ `
        uniform sampler2D opacityMap;
        uniform float uvScroll;
        varying vec4 vColor;
        varying vec2 vUv;
        void main() {
          // C++: GL_MODULATE with scrolling texture matrix (V only)
          vec2 scrolledUv = vec2(vUv.x, vUv.y + uvScroll);
          vec4 texColor = texture2D(opacityMap, scrolledUv);
          // GL_MODULATE: output = vertex_color × texture_color
          gl_FragColor = vColor * texColor;
        }
      ` : /* glsl */ `
        varying vec4 vColor;
        void main() {
          gl_FragColor = vColor;
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
    });

    this.lineSegments = new THREE.LineSegments(geometry, material);
    this.lineScene = new THREE.Scene();
    this.lineScene.add(this.lineSegments);
  }

  doFrame(fxTime, demoTime, dm) {
    // Layer 1: In C++, the glow texture has alpha=0 everywhere (letter shape is RGB-only),
    // so drawing it with SRC_ALPHA/INV_SRC_ALPHA produces an invisible quad.
    // PNG conversion strips alpha (grayscale), making A=255 in the browser.
    // Skip the quad draw to match C++ visual output — only the glow rays are visible.

    // Layer 2: Radiating rays with opacity texture
    if (!this.lineSegments || this.numRays === 0) return;

    const incTime = fxTime - this.lastTime;
    const growAlpha = incTime * 0.0004;

    // Update opacity texture scroll (C++: texture matrix V = fxTime * 0.0001)
    if (this.lineSegments.material.uniforms.uvScroll) {
      this.lineSegments.material.uniforms.uvScroll.value = fxTime * 0.0001;
    }

    // Compute rotation angles (sinusoidal wobble of ray endpoints)
    const angleX = Math.sin((demoTime - this.delay) * X_ROT_SPEED) * X_ROT_AMPLITUDE;
    const angleY = Math.sin((demoTime - this.delay) * Y_ROT_SPEED) * Y_ROT_AMPLITUDE;
    const radX = angleX * Math.PI / 180;
    const radY = angleY * Math.PI / 180;
    const sinX = Math.sin(radX);
    const cosX = Math.cos(radX);
    const sinY = Math.sin(radY);
    const cosY = Math.cos(radY);

    const posAttr = this.lineSegments.geometry.getAttribute('position');
    const colAttr = this.lineSegments.geometry.getAttribute('color');
    const positions = posAttr.array;
    const colors = colAttr.array;

    for (let i = 0; i < this.numRays; i++) {
      const si = i * 3;
      const startX = this.initialStartPositions[si + 0];
      const startY = this.initialStartPositions[si + 1];

      // Update blink alpha
      if (this.blink) {
        const b = this.blinks[i];
        if (b.dir > 0) {
          b.alpha += growAlpha * b.speed;
          if (b.alpha > GLOW2_MAX_BLINK_ALPHA) {
            b.alpha = GLOW2_MAX_BLINK_ALPHA;
            b.dir = -1;
          }
        } else {
          b.alpha -= growAlpha * b.speed;
          if (b.alpha < GLOW2_MIN_BLINK_ALPHA) {
            b.alpha = GLOW2_MIN_BLINK_ALPHA;
            b.dir = 1;
          }
        }
        colors[i * 8 + 3] = b.alpha;
      }

      // Start vertex position (stays fixed)
      const pi = i * 6;
      positions[pi + 0] = startX;
      positions[pi + 1] = startY;
      positions[pi + 2] = 0;

      // End vertex: offset from start, rotated
      let ox = this.initialEndOffsets[si + 0];
      let oy = this.initialEndOffsets[si + 1];
      let oz = 0;

      // Rotate around Y axis
      let rx = ox * cosY - oz * sinY;
      let ry = oy;
      let rz = ox * sinY + oz * cosY;

      // Rotate around X axis
      const ry2 = ry * cosX - rz * sinX;
      const rz2 = ry * sinX + rz * cosX;

      positions[pi + 3] = startX + rx;
      positions[pi + 4] = startY + ry2;
      positions[pi + 5] = 0;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    dm.renderer.webglRenderer.render(this.lineScene, dm.renderer.orthoCamera);

    this.lastTime = fxTime;
  }

  close() {
    this.glowTexture = null;
    this.opacityTexture = null;
    if (this.lineSegments) {
      this.lineSegments.geometry.dispose();
      this.lineSegments.material.dispose();
      this.lineSegments = null;
    }
    this.lineScene = null;
  }
}
