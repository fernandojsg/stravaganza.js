import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXTelevision - Procedural TV noise effect.
 *
 * Renders a fullscreen 256x128 noise DataTexture (grayscale, linear filtered),
 * overlaid with 40 random semi-transparent black horizontal bars and 2 scrolling
 * scanline bars at different speeds.
 *
 * Original: FXTelevision.cpp
 * - 256x128 RGBA texture, random grayscale noise per frame
 * - 40 bars: black, alpha 0.18, height 0.3 in -10..+10 ortho (= 0.015 normalized)
 * - Scanline 1: 220ms cycle, height 0.3 viewport (30%), alpha 0.20 (via DrawColouredQuad)
 * - Scanline 2: 6300ms cycle, height 0.6 viewport (60%), alpha 0.25 (via DrawColouredQuad)
 * - C++ draws all 40 bars in a single glBegin/glEnd block (1 draw call)
 *
 * Optimized: pre-created reusable meshes, batched bars = 4 draw calls total.
 */

const TEX_WIDTH = 256;
const TEX_HEIGHT = 128;

const NUM_BARS = 40;
// 0.3 units in -10..+10 ortho space = 0.3/20 = 0.015 normalized
const BAR_HEIGHT = 0.3 / 20;
const BAR_ALPHA = 0.18;

// Scanline parameters (heights in 0-1 normalized viewport space)
// C++ uses PTA3D_DrawColouredQuad which takes 0-1 viewport coords
const SCAN1_HEIGHT = 0.3;  // 30% of viewport height
const SCAN1_SPEED = 220;   // ms cycle
const SCAN1_ALPHA = 0.20;

const SCAN2_HEIGHT = 0.6;  // 60% of viewport height
const SCAN2_SPEED = 6300;  // ms cycle
const SCAN2_ALPHA = 0.25;

export class FXTelevision extends DemoFX {
  constructor() {
    super();
    this.name = 'FXTelevision';

    /** @type {THREE.DataTexture|null} */
    this.noiseTexture = null;
    /** @type {Uint8Array|null} */
    this.noiseData = null;

    // Pre-created reusable objects (avoid per-frame allocation)
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {THREE.Mesh|null} */
    this.noiseMesh = null;
    /** @type {THREE.Mesh|null} */
    this.barsMesh = null;
    /** @type {THREE.Mesh|null} */
    this.scan1Mesh = null;
    /** @type {THREE.Mesh|null} */
    this.scan2Mesh = null;
  }

  setup() {}

  async loadData(dm) {
    // Create 256x128 RGBA noise texture
    this.noiseData = new Uint8Array(TEX_WIDTH * TEX_HEIGHT * 4);
    this.noiseTexture = new THREE.DataTexture(
      this.noiseData, TEX_WIDTH, TEX_HEIGHT, THREE.RGBAFormat
    );
    this.noiseTexture.minFilter = THREE.LinearFilter;
    this.noiseTexture.magFilter = THREE.LinearFilter;
    this.noiseTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.noiseTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.noiseTexture.colorSpace = THREE.LinearSRGBColorSpace;

    // Shared scene for all passes
    this.scene = new THREE.Scene();

    // --- Noise fullscreen quad (reused every frame) ---
    const noiseGeom = new THREE.PlaneGeometry(1, 1);
    const noiseMat = new THREE.MeshBasicMaterial({
      map: this.noiseTexture,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.noiseMesh = new THREE.Mesh(noiseGeom, noiseMat);
    this.noiseMesh.position.set(0.5, 0.5, 0);

    // --- 40 horizontal bars batched into single geometry ---
    // Each bar: 2 triangles (6 vertices), 40 bars = 240 vertices
    const barPositions = new Float32Array(NUM_BARS * 6 * 3); // x,y,z per vertex
    const barsGeom = new THREE.BufferGeometry();
    barsGeom.setAttribute('position', new THREE.BufferAttribute(barPositions, 3));
    const barsMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: BAR_ALPHA,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.barsMesh = new THREE.Mesh(barsGeom, barsMat);

    // --- Scanline 1 ---
    const scan1Geom = new THREE.PlaneGeometry(1, SCAN1_HEIGHT);
    const scan1Mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: SCAN1_ALPHA,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.scan1Mesh = new THREE.Mesh(scan1Geom, scan1Mat);
    this.scan1Mesh.position.x = 0.5;

    // --- Scanline 2 ---
    const scan2Geom = new THREE.PlaneGeometry(1, SCAN2_HEIGHT);
    const scan2Mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: SCAN2_ALPHA,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.scan2Mesh = new THREE.Mesh(scan2Geom, scan2Mat);
    this.scan2Mesh.position.x = 0.5;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.noiseData || !this.scene) return;

    const data = this.noiseData;
    const total = TEX_WIDTH * TEX_HEIGHT;

    // --- Generate grayscale noise (C++: srand(demoMs), rand() per pixel) ---
    for (let i = 0; i < total; i++) {
      const val = (Math.random() * 256) | 0;
      const idx = i * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
    this.noiseTexture.needsUpdate = true;

    // --- Render noise fullscreen quad ---
    this.scene.children.length = 0;
    this.scene.add(this.noiseMesh);
    dm.renderer.renderScene(this.scene, dm.renderer.orthoCamera);

    // --- Update 40 bar positions ---
    // C++: srand(demoMs) then rand() for each bar Y in -10..+10
    // After noise generation consumed 32768 rand() calls, bars get their own
    // We use a simple LCG seeded from demoTime for deterministic bars
    const posAttr = this.barsMesh.geometry.getAttribute('position');
    const pos = posAttr.array;
    let seed = (demoTime | 0) * 16807;

    for (let i = 0; i < NUM_BARS; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // C++: fRand in -10..+10 → normalized: (fRand + 10) / 20
      // But PTA Y is top=0, bottom=1, so flip: 1 - normalized
      const yNorm = 1 - (seed / 0x7fffffff);
      const yTop = yNorm;
      const yBot = yNorm - BAR_HEIGHT;
      const base = i * 18; // 6 vertices × 3 components

      // Triangle 1: top-left, top-right, bottom-right
      pos[base]     = 0; pos[base + 1]  = yTop; pos[base + 2]  = 0;
      pos[base + 3] = 1; pos[base + 4]  = yTop; pos[base + 5]  = 0;
      pos[base + 6] = 1; pos[base + 7]  = yBot;  pos[base + 8]  = 0;
      // Triangle 2: top-left, bottom-right, bottom-left
      pos[base + 9]  = 0; pos[base + 10] = yTop; pos[base + 11] = 0;
      pos[base + 12] = 1; pos[base + 13] = yBot;  pos[base + 14] = 0;
      pos[base + 15] = 0; pos[base + 16] = yBot;  pos[base + 17] = 0;
    }
    posAttr.needsUpdate = true;

    this.scene.children.length = 0;
    this.scene.add(this.barsMesh);
    dm.renderer.renderScene(this.scene, dm.renderer.orthoCamera);

    // --- Scanline 1: fast (220ms cycle) ---
    // C++: PTA3D_DrawColouredQuad(0, t*(h+1)-h, 1, t*(h+1), black, 0.20)
    // PTA viewport: y=0=top → Three.js: flip with 1 - center
    const scan1T = ((demoTime | 0) % SCAN1_SPEED) / SCAN1_SPEED;
    const scan1Center = scan1T * (SCAN1_HEIGHT + 1.0) - SCAN1_HEIGHT / 2;
    this.scan1Mesh.position.y = 1 - scan1Center;

    this.scene.children.length = 0;
    this.scene.add(this.scan1Mesh);
    dm.renderer.renderScene(this.scene, dm.renderer.orthoCamera);

    // --- Scanline 2: slow (6300ms cycle) ---
    const scan2T = ((demoTime | 0) % SCAN2_SPEED) / SCAN2_SPEED;
    const scan2Center = scan2T * (SCAN2_HEIGHT + 1.0) - SCAN2_HEIGHT / 2;
    this.scan2Mesh.position.y = 1 - scan2Center;

    this.scene.children.length = 0;
    this.scene.add(this.scan2Mesh);
    dm.renderer.renderScene(this.scene, dm.renderer.orthoCamera);
  }

  close() {
    if (this.noiseMesh) {
      this.noiseMesh.geometry.dispose();
      this.noiseMesh.material.dispose();
    }
    if (this.barsMesh) {
      this.barsMesh.geometry.dispose();
      this.barsMesh.material.dispose();
    }
    if (this.scan1Mesh) {
      this.scan1Mesh.geometry.dispose();
      this.scan1Mesh.material.dispose();
    }
    if (this.scan2Mesh) {
      this.scan2Mesh.geometry.dispose();
      this.scan2Mesh.material.dispose();
    }
    if (this.noiseTexture) this.noiseTexture.dispose();
    this.noiseTexture = null;
    this.noiseData = null;
    this.scene = null;
    this.noiseMesh = null;
    this.barsMesh = null;
    this.scan1Mesh = null;
    this.scan2Mesh = null;
  }
}
