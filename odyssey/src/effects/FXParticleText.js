import * as THREE from 'three';
import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXParticleText - Particles tracing spline-defined text paths.
 * Particles travel from a source position to spline-evaluated destinations.
 * Additive blending (SRCALPHA + ONE), billboard quads.
 * Optional explosion particle system follows the spline drawing head.
 * C++ original: Odyssey/FXParticleText.cpp + FXParticleText.h
 *
 * C++ calls setActiveCamera(NULL) which sets a default perspective camera:
 *   FOV=60, aspect=1.33, near=1, far=1000, identity view/world matrices.
 * Destinations are unProjected from screen coords to 3D world space.
 * Source position (0,0,1) is behind the camera → invisible until particles arrive.
 * partSize is in world space units.
 */

// PTA default camera when setActiveCamera(NULL): FOV=60°, aspect=1.33
const PTA_NULL_HFOV = 60;
const PTA_NULL_ASPECT = 1.33;
const PTA_NULL_NEAR = 1.0;
const PTA_NULL_FAR = 1000.0;
const PTA_NULL_VFOV = PTA_NULL_HFOV / PTA_NULL_ASPECT;

// Explosion particle constants (from C++ m_ExplPSystem.init params)
const EXPL_NUM_PARTICLES = 600;
const EXPL_PARTICLE_SIZE = 0.015;
const EXPL_PARTICLE_LIFE = 1100;
const EXPL_SPEED = 0.7;

/**
 * Unproject a screen-space point (sx in [0,1], sy in [0,1], z_buffer in [0,1])
 * to 3D world space using the PTA NULL camera (identity view, perspective projection).
 * Matches C++ wrapper3DAPI->unProjectVertex() with setActiveCamera(NULL).
 */
function unprojectPTA(sx, sy, zBuffer) {
  const zNdc = 2 * zBuffer - 1;
  const near = PTA_NULL_NEAR;
  const far = PTA_NULL_FAR;
  // z_eye = -2nf / ((f+n) - z_ndc*(f-n))
  // Derived from inverting the OpenGL perspective Z mapping
  const zEye = -(2 * near * far) / ((far + near) - zNdc * (far - near));

  // Screen [0,1] → NDC [-1,1], Y flipped (PTA 0=top → OpenGL 0=bottom)
  const ndcX = sx * 2 - 1;
  const ndcY = -(sy * 2 - 1);

  const tanHalfVFov = Math.tan((PTA_NULL_VFOV * Math.PI / 180) / 2);
  const projX = 1 / (PTA_NULL_ASPECT * tanHalfVFov);
  const projY = 1 / tanHalfVFov;

  // With identity view matrix, world = eye space
  const wx = ndcX * (-zEye) / projX;
  const wy = ndcY * (-zEye) / projY;
  const wz = zEye;

  return { x: wx, y: wy, z: wz };
}

/**
 * Catmull-Rom (Overhauser) spline evaluation.
 * Given control points, evaluate at parameter t in [0, 1).
 */
function evaluateSpline(points, t) {
  const n = points.length;
  if (n < 4) {
    const idx = Math.min(Math.floor(t * (n - 1)), n - 2);
    const frac = t * (n - 1) - idx;
    return {
      x: points[idx].x + (points[idx + 1].x - points[idx].x) * frac,
      y: points[idx].y + (points[idx + 1].y - points[idx].y) * frac,
      z: points[idx].z + (points[idx + 1].z - points[idx].z) * frac,
    };
  }

  const numSegments = n - 3;
  const tScaled = t * numSegments;
  let seg = Math.floor(tScaled);
  if (seg >= numSegments) seg = numSegments - 1;
  const f = tScaled - seg;
  const f2 = f * f;
  const f3 = f2 * f;

  const p0 = points[seg];
  const p1 = points[seg + 1];
  const p2 = points[seg + 2];
  const p3 = points[seg + 3];

  return {
    x: 0.5 * ((-p0.x + 3*p1.x - 3*p2.x + p3.x) * f3 + (2*p0.x - 5*p1.x + 4*p2.x - p3.x) * f2 + (-p0.x + p2.x) * f + 2*p1.x),
    y: 0.5 * ((-p0.y + 3*p1.y - 3*p2.y + p3.y) * f3 + (2*p0.y - 5*p1.y + 4*p2.y - p3.y) * f2 + (-p0.y + p2.y) * f + 2*p1.y),
    z: 0.5 * ((-p0.z + 3*p1.z - 3*p2.z + p3.z) * f3 + (2*p0.z - 5*p1.z + 4*p2.z - p3.z) * f2 + (-p0.z + p2.z) * f + 2*p1.z),
  };
}

export class FXParticleText extends DemoFX {
  constructor() {
    super();
    this.name = 'FXParticleText';
    this.fX = 0; this.fY = 0;
    this.fSize = 0;
    this.splines = null;
    this.numSplines = 0;
    this.numParticlesPerSpline = 0;
    this.texturePath = '';
    this.explParticles = true;
    this.duration = 0;
    this.texture = null;
    this.particles = null; // [splineIdx][particleIdx]
    this.partSize = 0.019;
    this.partAlpha = 0.7;
    this.partSpeed = 50.0;
    this.prevTime = 0;
    // Three.js objects
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.scene = null;
    this.camera = null; // Perspective camera matching PTA NULL camera
    // Explosion particle system
    this.explData = null;
    this.explGeometry = null;
    this.explMaterial = null;
    this.explMesh = null;
    this.explTexture = null;
  }

  setup(fX, fY, fSize, splines, numSplines, numParticles, texturePath, explParticles, duration) {
    this.fX = fX; this.fY = fY;
    this.fSize = fSize;
    this.splines = splines;
    this.numSplines = numSplines;
    this.numParticlesPerSpline = Math.floor(numParticles / numSplines);
    this.texturePath = texturePath;
    this.explParticles = explParticles;
    this.duration = duration;
  }

  // Override in subclasses
  getSourcePos(splineIndex, particleIndex) {
    // C++: return pta3DVertex(0.0f, 0.0f, 1.0f)
    // In world space: (0, 0, 1) is behind the perspective camera (near=1, looking along -Z)
    // Vertices behind near plane are clipped → particles invisible until they reach destination
    return { x: 0, y: 0, z: 1 };
  }

  async loadData(dm) {
    try {
      this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
    } catch (err) {
      console.warn(`FXParticleText: failed to load "${this.texturePath}":`, err.message);
    }

    const totalParticles = this.numSplines * this.numParticlesPerSpline;

    // Initialize particles: evaluate spline destinations and unproject to world space
    this.particles = new Array(this.numSplines);
    let arrayIndex = 0;

    for (let s = 0; s < this.numSplines; s++) {
      this.particles[s] = new Array(this.numParticlesPerSpline);

      for (let p = 0; p < this.numParticlesPerSpline; p++) {
        const t = p / this.numParticlesPerSpline;
        const dest = evaluateSpline(this.splines[s], t);

        // Scale and offset to screen-normalized space (same as C++)
        dest.x = dest.x * this.fSize - 0.5 + this.fX;
        dest.y = dest.y * this.fSize - 0.5 + this.fY;

        // Unproject to 3D world space using spline z as depth buffer value
        // C++: PTA3D_ScreenNormalizedToViewport + unProjectVertex
        const worldDest = unprojectPTA(dest.x, dest.y, dest.z);

        const source = this.getSourcePos(s, p);

        // Staggered arrival offset (matches C++ integer division iArrayIndex/4)
        const initT = -(arrayIndex / 4) / totalParticles * this.partSpeed;

        this.particles[s][p] = {
          source,
          destiny: worldDest,
          fT: initT,
        };

        arrayIndex += 4;
      }
    }

    // Create Three.js geometry for billboard quads
    const numVerts = totalParticles * 4;
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const indices = new Uint16Array(totalParticles * 6);

    for (let i = 0; i < totalParticles; i++) {
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
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    // Perspective camera matching PTA setActiveCamera(NULL)
    this.camera = new THREE.PerspectiveCamera(
      PTA_NULL_VFOV, PTA_NULL_ASPECT, PTA_NULL_NEAR, PTA_NULL_FAR
    );
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.camera.updateProjectionMatrix();

    // Explosion particle system
    if (this.explParticles) {
      await this._initExplParticles(dm);
    }
  }

  async _initExplParticles(dm) {
    try {
      this.explTexture = await dm.assetManager.loadTextureByPath('data/textures/particles/particlefire.jpg');
    } catch (err) {
      console.warn('FXParticleText: failed to load explosion texture:', err.message);
      this.explParticles = false;
      return;
    }

    // Initial emitter position: first particle's destination (C++ hack to avoid particles at origin)
    const firstDest = this.particles[0][0].destiny;

    // Initialize particle pool with staggered lifetimes
    this.explData = new Array(EXPL_NUM_PARTICLES);
    for (let i = 0; i < EXPL_NUM_PARTICLES; i++) {
      const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 };
      this._emitExplParticle(p, firstDest);
      // Stagger lifetimes so particles are pre-distributed
      p.life = (i / EXPL_NUM_PARTICLES) * EXPL_PARTICLE_LIFE;
      // Pre-position along velocity
      const age = (EXPL_PARTICLE_LIFE - p.life) * 0.001;
      p.x = firstDest.x + p.vx * age;
      p.y = firstDest.y + p.vy * age;
      p.z = firstDest.z + p.vz * age;
      this.explData[i] = p;
    }

    // Create geometry
    const numVerts = EXPL_NUM_PARTICLES * 4;
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const colors = new Float32Array(numVerts * 3); // Vertex colors for per-particle fade
    const indices = new Uint16Array(EXPL_NUM_PARTICLES * 6);

    for (let i = 0; i < EXPL_NUM_PARTICLES; i++) {
      const base = i * 4;
      uvs[base * 2 + 0] = 0; uvs[base * 2 + 1] = 0;
      uvs[(base + 1) * 2 + 0] = 0; uvs[(base + 1) * 2 + 1] = 1;
      uvs[(base + 2) * 2 + 0] = 1; uvs[(base + 2) * 2 + 1] = 1;
      uvs[(base + 3) * 2 + 0] = 1; uvs[(base + 3) * 2 + 1] = 0;

      const iBase = i * 6;
      indices[iBase + 0] = base; indices[iBase + 1] = base + 1; indices[iBase + 2] = base + 2;
      indices[iBase + 3] = base; indices[iBase + 4] = base + 2; indices[iBase + 5] = base + 3;
    }

    this.explGeometry = new THREE.BufferGeometry();
    this.explGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.explGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.explGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.explGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.explMaterial = new THREE.MeshBasicMaterial({
      map: this.explTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
    });

    this.explMesh = new THREE.Mesh(this.explGeometry, this.explMaterial);
    this.explMesh.frustumCulled = false;
    this.scene.add(this.explMesh);
  }

  _emitExplParticle(p, pos) {
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    // Random direction on sphere (360° cone = full sphere) * speed
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    p.vx = Math.sin(phi) * Math.cos(theta) * EXPL_SPEED;
    p.vy = Math.sin(phi) * Math.sin(theta) * EXPL_SPEED;
    p.vz = Math.cos(phi) * EXPL_SPEED;
    p.life = EXPL_PARTICLE_LIFE;
  }

  _getExplEmitterPos(fxTime) {
    // Track spline drawing head across all splines
    let splineIdx = Math.floor((fxTime / this.duration) * this.numSplines);
    if (splineIdx < 0) splineIdx = 0;
    if (splineIdx >= this.numSplines) splineIdx = this.numSplines - 1;

    let fT = ((fxTime / this.duration) * this.numSplines) - splineIdx;
    if (fT < 0) fT = 0;
    if (fT > 1) fT = 1;

    const pos = evaluateSpline(this.splines[splineIdx], fT);
    pos.x = pos.x * this.fSize - 0.5 + this.fX;
    pos.y = pos.y * this.fSize - 0.5 + this.fY;

    const worldPos = unprojectPTA(pos.x, pos.y, pos.z);
    if (fxTime > this.duration) {
      worldPos.z = 1000; // Move far offscreen after duration
    }
    return worldPos;
  }

  _updateExplParticles(fxTime, dt) {
    if (!this.explData || !this.explGeometry) return;

    const emitterPos = this._getExplEmitterPos(fxTime);
    const dtSec = dt * 0.001;

    // Update particles
    for (let i = 0; i < EXPL_NUM_PARTICLES; i++) {
      const p = this.explData[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._emitExplParticle(p, emitterPos);
      } else {
        p.x += p.vx * dtSec;
        p.y += p.vy * dtSec;
        p.z += p.vz * dtSec;
      }
    }

    // Update geometry
    const posAttr = this.explGeometry.getAttribute('position');
    const colAttr = this.explGeometry.getAttribute('color');
    const positions = posAttr.array;
    const colors = colAttr.array;

    for (let i = 0; i < EXPL_NUM_PARTICLES; i++) {
      const p = this.explData[i];
      const base = i * 4;
      const alpha = Math.max(0, p.life / EXPL_PARTICLE_LIFE);
      const size = EXPL_PARTICLE_SIZE;

      // Set vertex colors for per-particle fade (additive: black = invisible)
      for (let v = 0; v < 4; v++) {
        colors[(base + v) * 3 + 0] = alpha;
        colors[(base + v) * 3 + 1] = alpha;
        colors[(base + v) * 3 + 2] = alpha;
      }

      // Billboard quad in world space (axis-aligned, camera looks along -Z)
      positions[base * 3 + 0] = p.x - size;
      positions[base * 3 + 1] = p.y + size;
      positions[base * 3 + 2] = p.z;

      positions[(base + 1) * 3 + 0] = p.x - size;
      positions[(base + 1) * 3 + 1] = p.y - size;
      positions[(base + 1) * 3 + 2] = p.z;

      positions[(base + 2) * 3 + 0] = p.x + size;
      positions[(base + 2) * 3 + 1] = p.y - size;
      positions[(base + 2) * 3 + 2] = p.z;

      positions[(base + 3) * 3 + 0] = p.x + size;
      positions[(base + 3) * 3 + 1] = p.y + size;
      positions[(base + 3) * 3 + 2] = p.z;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  getT(fxT, splineIndex, particleIndex) {
    // C++ base class GetT:
    // t = fT + (fxT * (partSpeed + 1.0))
    // if t < 1.0 return -1 (not visible yet)
    // return clamp to 1.0
    const part = this.particles[splineIndex][particleIndex];
    const t = part.fT + (fxT * (this.partSpeed + 1.0));
    if (t < 1.0) return -1.0;
    return t > 1.0 ? 1.0 : t;
  }

  preFrame(fxTime) {
    // Base class: fade alpha after duration
    if (fxTime > this.duration) {
      this.partAlpha = 0.7 - ((fxTime - this.duration) / 3000.0);
      if (this.partAlpha < 0.0) this.partAlpha = 0.0;
    } else {
      this.partAlpha = 0.7;
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.particles || !this.geometry) return;

    const dt = (this.prevTime === 0) ? 0 : fxTime - this.prevTime;
    if (this.prevTime === 0) this.prevTime = fxTime;

    this.preFrame(fxTime);

    // Update explosion particles (rendered first, behind text)
    if (this.explParticles && this.explGeometry) {
      this._updateExplParticles(fxTime, dt);
      this.explMaterial.opacity = this.partAlpha;
    }

    // Update text particle positions in world space
    const posAttr = this.geometry.getAttribute('position');
    const positions = posAttr.array;
    const fxT = fxTime / this.duration;
    let quadIndex = 0;

    for (let s = 0; s < this.numSplines; s++) {
      for (let p = 0; p < this.numParticlesPerSpline; p++) {
        const part = this.particles[s][p];
        const t = this.getT(fxT, s, p);
        const base = quadIndex * 4;

        if (t < 0.0 || t > 1.0) {
          // Hide particle (move behind far plane)
          for (let v = 0; v < 4; v++) {
            positions[(base + v) * 3 + 0] = 0;
            positions[(base + v) * 3 + 1] = 0;
            positions[(base + v) * 3 + 2] = 100;
          }
          quadIndex++;
          continue;
        }

        // Interpolate position in world space: source + (destiny - source) * t
        const px = part.source.x + (part.destiny.x - part.source.x) * t;
        const py = part.source.y + (part.destiny.y - part.source.y) * t;
        const pz = part.source.z + (part.destiny.z - part.source.z) * t;

        const size = this.partSize;

        // Billboard quad in world space (camera at origin, looking along -Z)
        // C++ layout: 1=top-left, 2=bottom-left, 3=bottom-right, 4=top-right
        positions[base * 3 + 0] = px - size;
        positions[base * 3 + 1] = py + size;
        positions[base * 3 + 2] = pz;

        positions[(base + 1) * 3 + 0] = px - size;
        positions[(base + 1) * 3 + 1] = py - size;
        positions[(base + 1) * 3 + 2] = pz;

        positions[(base + 2) * 3 + 0] = px + size;
        positions[(base + 2) * 3 + 1] = py - size;
        positions[(base + 2) * 3 + 2] = pz;

        positions[(base + 3) * 3 + 0] = px + size;
        positions[(base + 3) * 3 + 1] = py + size;
        positions[(base + 3) * 3 + 2] = pz;

        quadIndex++;
      }
    }

    posAttr.needsUpdate = true;
    this.material.opacity = this.partAlpha;

    // Render scene (explosion particles + text particles via single scene)
    dm.renderer.webglRenderer.render(this.scene, this.camera);

    this.prevTime = fxTime;
  }

  close() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.explGeometry) this.explGeometry.dispose();
    if (this.explMaterial) this.explMaterial.dispose();
    this.texture = null;
    this.explTexture = null;
    this.particles = null;
    this.explData = null;
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.explGeometry = null;
    this.explMaterial = null;
    this.explMesh = null;
    this.scene = null;
    this.camera = null;
  }
}

/**
 * FXPTextStravaganza - Always at final position (t=1.0).
 * No preFrame/postFrame (no alpha fade).
 */
export class FXPTextStravaganza extends FXParticleText {
  constructor() {
    super();
    this.name = 'FXPTextStravaganza';
  }

  preFrame(fxTime) {
    // No alpha fade
  }

  getT(fxT, splineIndex, particleIndex) {
    return 1.0;
  }
}

/**
 * FXPTextIthaqua - Base class GetT with size pulse.
 * C++ settled partSize = 1.0 world units (large additive glow effect).
 * When raw t is in [1.0, 1.3], partSize briefly pulses larger before settling.
 */
export class FXPTextIthaqua extends FXParticleText {
  constructor() {
    super();
    this.name = 'FXPTextIthaqua';
  }

  getT(fxT, splineIndex, particleIndex) {
    // Same as base class: particles invisible until they arrive, then snap to destination.
    // C++ code sets m_fPartSize=1.0 here but that creates screen-filling quads in
    // world space (z≈-2). Visual reference shows small particles like other credits.
    // Keep base class partSize (0.019) which matches the reference video.
    const part = this.particles[splineIndex][particleIndex];
    const t = part.fT + (fxT * (this.partSpeed + 1.0));
    if (t < 1.0) return -1.0;
    return 1.0;
  }
}

/**
 * FXPTextTekno - Snap: particles are either at source (behind camera = invisible)
 * or at final position. C++ returns t=0 when not ready (source at z=1, clipped by near plane).
 */
export class FXPTextTekno extends FXParticleText {
  constructor() {
    super();
    this.name = 'FXPTextTekno';
  }

  getT(fxT, splineIndex, particleIndex) {
    const part = this.particles[splineIndex][particleIndex];
    const t = part.fT + (fxT * (this.partSpeed + 1.0));
    // t=0: particle at source (0,0,1) = behind camera → clipped (invisible)
    // t=1: particle at destination (visible)
    return t >= 1.0 ? 1.0 : 0.0;
  }
}

/**
 * FXPTextCircuitry - Same snap behavior as Tekno.
 */
export class FXPTextCircuitry extends FXParticleText {
  constructor() {
    super();
    this.name = 'FXPTextCircuitry';
  }

  getT(fxT, splineIndex, particleIndex) {
    const part = this.particles[splineIndex][particleIndex];
    const t = part.fT + (fxT * (this.partSpeed + 1.0));
    return t >= 1.0 ? 1.0 : 0.0;
  }
}

/**
 * FXPTextWonder - Same snap behavior as Tekno/Circuitry.
 */
export class FXPTextWonder extends FXParticleText {
  constructor() {
    super();
    this.name = 'FXPTextWonder';
  }

  getT(fxT, splineIndex, particleIndex) {
    const part = this.particles[splineIndex][particleIndex];
    const t = part.fT + (fxT * (this.partSpeed + 1.0));
    return t >= 1.0 ? 1.0 : 0.0;
  }
}
