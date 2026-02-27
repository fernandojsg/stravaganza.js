import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXEuskal10ParticleSteam - Particle steam/smoke using camera-facing billboard quads.
 *
 * C++ behavior:
 * - Particles spawn on a rectangle in XZ plane, at Y=minY
 * - Movement: Z += speed * deltaTime, wrap when Z >= maxY
 * - Sinusoidal perturbation: pos += normaldir * sin(t*0.001 + phase) * 2.0
 * - Size pulsation: size * (1 + sin(t*0.002 + phase) * 0.5)
 * - Billboard quads aligned to camera view matrix axes
 * - Alpha blending (SRCALPHA/INVSRCALPHA), white color, 40% opacity
 * - Uses the demo's active camera (NOT its own camera)
 * - No lifetime — particles recycle via Z-position wrapping
 * - Optional linear fog
 *
 * Original: FXEuskal10ParticleSteam.cpp
 */

const TWO_PI = Math.PI * 2;

export class FXEuskal10ParticleSteam extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEuskal10ParticleSteam';

    this.numParticles = 500;
    this.minSize = 1.0;
    this.maxSize = 2.0;
    this.minY = -200;
    this.maxY = 200;
    this.minSpeed = 0.008;
    this.maxSpeed = 0.015;
    this.radius = 200;
    this.texturePath = '';
    this.useFog = false;
    this.fogColor = { r: 0, g: 0, b: 0 };

    /** @type {THREE.Texture|null} */
    this.particleTexture = null;
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {THREE.Mesh|null} */
    this.mesh = null;

    // Per-particle state arrays
    this.particles = [];
    this.lastTime = 0;
  }

  /**
   * @param {number} numParticles
   * @param {number} minSize
   * @param {number} maxSize
   * @param {number} minY - Min Z spawn position (C++ Y maps to movement axis)
   * @param {number} maxY - Max Z spawn position
   * @param {number} minSpeed
   * @param {number} maxSpeed
   * @param {number} radius
   * @param {string} texturePath
   * @param {boolean} useFog
   * @param {{r:number, g:number, b:number}} fogColor
   */
  setup(numParticles, minSize, maxSize, minY, maxY, minSpeed, maxSpeed, radius, texturePath, useFog, fogColor) {
    this.numParticles = numParticles;
    this.minSize = minSize;
    this.maxSize = maxSize;
    this.minY = minY;
    this.maxY = maxY;
    this.minSpeed = minSpeed;
    this.maxSpeed = maxSpeed;
    this.radius = radius;
    this.texturePath = texturePath;
    this.useFog = useFog;
    this.fogColor = fogColor || { r: 0, g: 0, b: 0 };
  }

  _resetParticle() {
    // C++: random XZ within rectangle (rand-0.5)*radius, Y at minY
    const x = (Math.random() - 0.5) * this.radius;
    const z = (Math.random() - 0.5) * this.radius;
    // C++: normaldir is random perturbation direction
    const xd = (Math.random() - 0.5) * 10.0;
    const yd = (Math.random() - 0.5) * 10.0;
    return {
      x, y: this.minY, z,
      ndx: xd, ndy: yd,
      fNormRand: Math.random(),
    };
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.particleTexture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXEuskal10ParticleSteam: failed to load "${this.texturePath}":`, err.message);
      }
    }

    const height = this.maxY - this.minY;

    // C++: resetParticle sets x=random, y=minY, z=random
    // Then loadData overrides y to random in [minY, maxY]
    // Z is also staggered initially (from resetParticle's random z)
    // Movement is along Z axis; Y is fixed vertical spread per particle
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      const p = this._resetParticle();
      // Randomize Y spread (C++ loadData: particle.pos.y = minY + rand * height)
      p.y = this.minY + Math.random() * height;
      // Stagger initial Z within range (particles start distributed, not all at minY)
      p.z = this.minY + Math.random() * height;
      this.particles[i] = p;
    }

    // Build instanced billboard geometry: one quad per particle
    // Each quad = 2 triangles = 6 vertices, with positions updated per frame
    const numVerts = this.numParticles * 6;
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);

    // Pre-fill UVs (same for every quad)
    for (let i = 0; i < this.numParticles; i++) {
      const base = i * 12; // 6 verts * 2 components
      // Triangle 1: TL, BL, BR
      uvs[base + 0] = 0; uvs[base + 1] = 0;   // TL
      uvs[base + 2] = 0; uvs[base + 3] = 1;   // BL
      uvs[base + 4] = 1; uvs[base + 5] = 1;   // BR
      // Triangle 2: TL, BR, TR
      uvs[base + 6] = 0; uvs[base + 7] = 0;   // TL
      uvs[base + 8] = 1; uvs[base + 9] = 1;   // BR
      uvs[base + 10] = 1; uvs[base + 11] = 0; // TR
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const material = new THREE.MeshBasicMaterial({
      map: this.particleTexture,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;

    this.scene = new THREE.Scene();

    // Optional fog
    if (this.useFog) {
      const fogCol = new THREE.Color(this.fogColor.r, this.fogColor.g, this.fogColor.b);
      this.scene.fog = new THREE.Fog(fogCol, 145, 240);
    }

    this.scene.add(this.mesh);
    this.lastTime = 0;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.mesh || !this.scene) return;

    // Use demo's active camera (set by the previous scene render)
    const camera = dm.renderer.lastPerspectiveCamera;
    if (!camera) return;

    // Update fog distances based on demo time (C++ switches at 100s)
    if (this.useFog && this.scene.fog) {
      if (demoTime < 100000) {
        this.scene.fog.near = 145;
        this.scene.fog.far = 240;
      } else {
        this.scene.fog.near = 200;
        this.scene.fog.far = 400;
      }
    }

    // Delta time in ms
    const deltaMs = fxTime - this.lastTime;
    this.lastTime = fxTime;

    // Get camera view matrix axes for billboard orientation
    // C++: deltaX = view.getXaxis(true) * avgSize, deltaY = view.getYaxis(true) * avgSize
    const viewMatrix = camera.matrixWorldInverse;
    const avgSize = (this.maxSize + this.minSize) / 2.0;

    // Extract camera right (X) and up (Y) vectors from view matrix
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const dxBase = camRight.clone().multiplyScalar(avgSize);
    const dyBase = camUp.clone().multiplyScalar(avgSize);

    const positions = this.mesh.geometry.attributes.position.array;

    // Temp vectors
    const pos = new THREE.Vector3();
    const dx = new THREE.Vector3();
    const dy = new THREE.Vector3();
    const v = new THREE.Vector3();

    for (let i = 0; i < this.numParticles; i++) {
      const p = this.particles[i];

      // C++: pos.z += speed * deltaMs (movement along Z axis)
      const speed = this.minSpeed + (this.maxSpeed - this.minSpeed) * p.fNormRand;
      p.z += speed * deltaMs;

      // C++: wrapping when z >= maxY
      if (p.z >= this.maxY) {
        p.z = this.minY + (p.z - this.maxY);
      }

      // C++: sinusoidal perturbation
      // pos = pos + normaldir * sin(fxTime * 0.001 + fNormRand * TWO_PI) * 2.0
      const sinVal = Math.sin(fxTime * 0.001 + p.fNormRand * TWO_PI) * 2.0;
      pos.set(
        p.x + p.ndx * sinVal,
        p.y + p.ndy * sinVal,
        p.z,
      );

      // C++: size pulsation
      // scaledDelta = delta + delta * sin(fxTime * 0.002 + fNormRand * TWO_PI) * 0.5
      const sizeMul = 1.0 + Math.sin(fxTime * 0.002 + p.fNormRand * TWO_PI) * 0.5;
      dx.copy(dxBase).multiplyScalar(sizeMul);
      dy.copy(dyBase).multiplyScalar(sizeMul);

      // C++ billboard quad corners:
      // Start at pos - dx*0.5 + dy*0.5 (top-left)
      // Then: TL, BL (TL-dy), BR (BL+dx), TR (BR+dy)
      const base = i * 18; // 6 verts * 3 components

      // TL = pos - dx*0.5 + dy*0.5
      v.copy(pos).addScaledVector(dx, -0.5).addScaledVector(dy, 0.5);
      positions[base + 0] = v.x; positions[base + 1] = v.y; positions[base + 2] = v.z;

      // BL = TL - dy
      v.sub(dy);
      positions[base + 3] = v.x; positions[base + 4] = v.y; positions[base + 5] = v.z;

      // BR = BL + dx
      v.add(dx);
      positions[base + 6] = v.x; positions[base + 7] = v.y; positions[base + 8] = v.z;

      // Triangle 2: TL, BR, TR
      // TL again
      v.copy(pos).addScaledVector(dx, -0.5).addScaledVector(dy, 0.5);
      positions[base + 9] = v.x; positions[base + 10] = v.y; positions[base + 11] = v.z;

      // BR = pos + dx*0.5 - dy*0.5
      v.copy(pos).addScaledVector(dx, 0.5).addScaledVector(dy, -0.5);
      positions[base + 12] = v.x; positions[base + 13] = v.y; positions[base + 14] = v.z;

      // TR = BR + dy
      v.add(dy);
      positions[base + 15] = v.x; positions[base + 16] = v.y; positions[base + 17] = v.z;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    dm.renderer.renderScene(this.scene, camera);
  }

  close() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    this.mesh = null;
    this.scene = null;
    this.particleTexture = null;
    this.particles = [];
    this.lastTime = 0;
  }
}
