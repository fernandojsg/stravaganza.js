import * as THREE from 'three';
import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXParticleColumn - Vertical particle stream with perpendicular noise.
 * 250 particles cycling along a direction vector with cylindrical distribution.
 * Dynamic noise at specific demo timestamps.
 * C++ original: Odyssey/FXParticleColumn.cpp
 */

const TWO_PI = Math.PI * 2;
const DEG2RAD = Math.PI / 180;

// C stdlib rand() for reproducible particle init
function cRand(state) {
  state.seed = (state.seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return state.seed;
}
const C_RAND_MAX = 0x7FFFFFFF;

export class FXParticleColumn extends DemoFX {
  constructor() {
    super();
    this.name = 'FXParticleColumn';
    this.numParticles = 0;
    this.radius = 0;
    this.size = 0;
    this.speed = 0;
    this.noise = 0;
    this.source = { x: 0, y: 0, z: 0 };
    this.destiny = { x: 0, y: 0, z: 0 };
    this.texturePath = '';
    this.texture = null;
    this.particles = null;
    this.lastTime = 0;
    // Three.js rendering
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.scene = null;
    this.camera = null;
  }

  setup(numParticles, radius, size, speed, noise, source, destiny, texturePath) {
    this.numParticles = numParticles;
    this.radius = radius;
    this.size = size;
    this.speed = speed;
    this.noise = noise;
    this.source = source;
    this.destiny = destiny;
    this.texturePath = texturePath;
  }

  async loadData(dm) {
    try {
      this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
    } catch (err) {
      console.warn(`FXParticleColumn: failed to load "${this.texturePath}":`, err.message);
    }

    const rng = { seed: 1000 };

    // Direction vector
    const dirX = this.destiny.x - this.source.x;
    const dirY = this.destiny.y - this.source.y;
    const dirZ = this.destiny.z - this.source.z;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    const ndx = dirX / dirLen, ndy = dirY / dirLen, ndz = dirZ / dirLen;

    this.particles = new Array(this.numParticles);

    for (let i = 0; i < this.numParticles; i++) {
      const t = (cRand(rng) % C_RAND_MAX) / C_RAND_MAX;

      // Perpendicular axis (swap x/y of direction)
      let nax = -ndy, nay = ndx, naz = 0;

      // Random rotation around direction
      const randAngle1 = ((cRand(rng) % C_RAND_MAX) / C_RAND_MAX) * 360;
      const rotated1 = this._rotateAroundAxis(nax, nay, naz, ndx, ndy, ndz, randAngle1 * DEG2RAD);
      const len1 = Math.sqrt(rotated1.x * rotated1.x + rotated1.y * rotated1.y + rotated1.z * rotated1.z);
      const radiusMult = ((cRand(rng) % C_RAND_MAX) / C_RAND_MAX) * this.radius;
      const centerDist = {
        x: (rotated1.x / len1) * radiusMult,
        y: (rotated1.y / len1) * radiusMult,
        z: (rotated1.z / len1) * radiusMult,
      };

      // Noise direction (another perpendicular rotated randomly)
      let nax2 = -ndy, nay2 = ndx, naz2 = 0;
      const randAngle2 = ((cRand(rng) % C_RAND_MAX) / C_RAND_MAX) * 360;
      const rotated2 = this._rotateAroundAxis(nax2, nay2, naz2, ndx, ndy, ndz, randAngle2 * DEG2RAD);
      const len2 = Math.sqrt(rotated2.x * rotated2.x + rotated2.y * rotated2.y + rotated2.z * rotated2.z);

      this.particles[i] = {
        t,
        randTwoPi: t * TWO_PI,
        centerDist,
        noiseDir: { x: rotated2.x / len2, y: rotated2.y / len2, z: rotated2.z / len2 },
      };
    }

    // Create Three.js geometry for billboard quads
    const numVerts = this.numParticles * 4;
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const colors = new Float32Array(numVerts * 4);
    const indices = new Uint16Array(this.numParticles * 6);

    for (let i = 0; i < this.numParticles; i++) {
      const base = i * 4;
      uvs[base * 2 + 0] = 0; uvs[base * 2 + 1] = 0;
      uvs[(base + 1) * 2 + 0] = 0; uvs[(base + 1) * 2 + 1] = 1;
      uvs[(base + 2) * 2 + 0] = 1; uvs[(base + 2) * 2 + 1] = 1;
      uvs[(base + 3) * 2 + 0] = 1; uvs[(base + 3) * 2 + 1] = 0;

      const iBase = i * 6;
      indices[iBase + 0] = base;
      indices[iBase + 1] = base + 1;
      indices[iBase + 2] = base + 2;
      indices[iBase + 3] = base;
      indices[iBase + 4] = base + 2;
      indices[iBase + 5] = base + 3;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      vertexColors: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    // Camera matching PTA defaults
    this.camera = new THREE.PerspectiveCamera(45, 800 / 420, 1, 10000);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
  }

  _rotateAroundAxis(vx, vy, vz, ax, ay, az, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dot = vx * ax + vy * ay + vz * az;
    return {
      x: vx * cos + (ay * vz - az * vy) * sin + ax * dot * (1 - cos),
      y: vy * cos + (az * vx - ax * vz) * sin + ay * dot * (1 - cos),
      z: vz * cos + (ax * vy - ay * vx) * sin + az * dot * (1 - cos),
    };
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.particles || !this.geometry) return;

    const dirX = this.destiny.x - this.source.x;
    const dirY = this.destiny.y - this.source.y;
    const dirZ = this.destiny.z - this.source.z;

    // Dynamic noise at specific demo times
    let fNoise = this.noise;
    if (demoTime > 92513 && demoTime < 93113) {
      fNoise = this.noise + (93113 - demoTime) / 40;
    }
    if (demoTime > 107000 && demoTime < 108400) {
      fNoise = this.noise + (demoTime - 107000) / 150;
    }

    const posAttr = this.geometry.getAttribute('position');
    const positions = posAttr.array;
    const colorAttr = this.geometry.getAttribute('color');
    const colors = colorAttr.array;
    const halfSize = this.size * 0.5;

    for (let i = 0; i < this.numParticles; i++) {
      const p = this.particles[i];

      // Update t (looping movement)
      p.t += (fxTime - this.lastTime) * 0.001 * this.speed;
      if (p.t > 1.0) p.t = 0.0;

      // Noise displacement
      let noiseX = 0, noiseY = 0, noiseZ = 0;
      if (fNoise !== 0) {
        const noiseMult = (Math.sin(p.randTwoPi + fxTime * 0.00178125) - 0.5) * fNoise;
        noiseX = p.noiseDir.x * noiseMult;
        noiseY = p.noiseDir.y * noiseMult;
        noiseZ = p.noiseDir.z * noiseMult;
      }

      // Alpha with fade in/out at edges
      let alpha = 0.7;
      if (p.t < 0.05) alpha = (p.t / 0.05) * alpha;
      if (p.t > 0.95) alpha = ((0.05 - (p.t - 0.95)) / 0.05) * alpha;

      // Position: source + centerDist + dir*t + noise
      const px = this.source.x + p.centerDist.x + dirX * p.t + noiseX;
      const py = this.source.y + p.centerDist.y + dirY * p.t + noiseY;
      const pz = this.source.z + p.centerDist.z + dirZ * p.t + noiseZ;

      // Billboard quad (axis-aligned for simplicity)
      const base = i * 4;
      // Vertex 1: top-left
      positions[base * 3 + 0] = px - halfSize;
      positions[base * 3 + 1] = py + halfSize;
      positions[base * 3 + 2] = pz;
      // Vertex 2: bottom-left
      positions[(base + 1) * 3 + 0] = px - halfSize;
      positions[(base + 1) * 3 + 1] = py - halfSize;
      positions[(base + 1) * 3 + 2] = pz;
      // Vertex 3: bottom-right
      positions[(base + 2) * 3 + 0] = px + halfSize;
      positions[(base + 2) * 3 + 1] = py - halfSize;
      positions[(base + 2) * 3 + 2] = pz;
      // Vertex 4: top-right
      positions[(base + 3) * 3 + 0] = px + halfSize;
      positions[(base + 3) * 3 + 1] = py + halfSize;
      positions[(base + 3) * 3 + 2] = pz;

      // Set vertex colors (white with per-particle alpha)
      for (let v = 0; v < 4; v++) {
        colors[(base + v) * 4 + 0] = 1;
        colors[(base + v) * 4 + 1] = 1;
        colors[(base + v) * 4 + 2] = 1;
        colors[(base + v) * 4 + 3] = alpha;
      }
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    dm.renderer.webglRenderer.render(this.scene, this.camera);

    this.lastTime = fxTime;
  }

  close() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    this.texture = null;
    this.particles = null;
  }
}
