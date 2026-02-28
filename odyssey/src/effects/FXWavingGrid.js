import * as THREE from 'three';
import { DemoFX } from '../engine/DemoManager.js';
import { BlendMode } from '../engine/Renderer.js';

/**
 * FXWavingGrid - Textured grid mesh with sine-wave vertex deformation.
 * Grid (resX × resY) with per-vertex Z displacement based on distance from center.
 * Rendered with additive blending (SRCALPHA + ONE).
 *
 * C++ original: Odyssey/FXWavingGrid.cpp + FXWavingGrid.h
 *
 * C++ calls setActiveCamera(NULL) which sets a default perspective camera:
 *   FOV=60, aspect=1.33, near=1, far=1000, identity view/world matrices.
 * Grid corners are unProjected from screen coords to 3D world space at Z_buffer=0.4.
 * Z displacement in world space creates visible warping through perspective projection.
 *
 * Subclasses override getParams() to return alpha, amplitude, frequency, period,
 * numRenders, and renderDelay.
 */

// PTA default camera when setActiveCamera(NULL): FOV=60°, aspect=1.33
const PTA_NULL_HFOV = 60;
const PTA_NULL_ASPECT = 1.33;
const PTA_NULL_NEAR = 1.0;
const PTA_NULL_FAR = 1000.0;
// PTA gluPerspective(fov/aspect, aspect, near, far) → vFOV = 60/1.33 ≈ 45.11°
const PTA_NULL_VFOV = PTA_NULL_HFOV / PTA_NULL_ASPECT;
// Z_buffer=0.4 used in unProjectVertex
const UNPROJECT_Z_BUFFER = 0.4;

/**
 * Unproject a screen-space point (sx in [0,1], sy in [0,1], z_buffer in [0,1])
 * to 3D world space using the PTA NULL camera (identity view, perspective projection).
 * Matches C++ wrapper3DAPI->unProjectVertex() with setActiveCamera(NULL).
 */
function unprojectPTA(sx, sy, zBuffer) {
  // OpenGL viewport: x in [0, viewportW], y in [0, viewportH]
  // PTA screen coords: (0,0)=top-left, (1,1)=bottom-right
  // OpenGL: (0,0)=bottom-left
  // With identity view+world, unproject uses just the projection inverse.

  // Convert z_buffer [0,1] → NDC z [-1,1]
  const zNdc = 2 * zBuffer - 1;

  // Compute eye-space depth from perspective projection
  // Inverting z_ndc = (f+n)/(f-n) + 2fn/((f-n)*z_eye) gives:
  // z_eye = -2nf / ((f+n) - z_ndc*(f-n))
  const near = PTA_NULL_NEAR;
  const far = PTA_NULL_FAR;
  const zEye = -(2 * near * far) / ((far + near) - zNdc * (far - near));

  // Screen [0,1] → NDC [-1,1] for X, and inverted for Y (PTA 0=top → OpenGL 0=bottom)
  const ndcX = sx * 2 - 1;
  const ndcY = -(sy * 2 - 1); // Flip Y: PTA top=0 → OpenGL bottom=0

  // NDC to eye-space: x_eye = ndcX * (-z_eye) / proj[0][0], y_eye = ndcY * (-z_eye) / proj[1][1]
  // proj[0][0] = 1/(aspect*tan(vfov/2)), proj[1][1] = 1/tan(vfov/2)
  const tanHalfVFov = Math.tan((PTA_NULL_VFOV * Math.PI / 180) / 2);
  const projX = 1 / (PTA_NULL_ASPECT * tanHalfVFov);
  const projY = 1 / tanHalfVFov;

  // With identity view matrix, world = eye space
  const wx = ndcX * (-zEye) / projX;
  const wy = ndcY * (-zEye) / projY;
  const wz = zEye;

  return { x: wx, y: wy, z: wz };
}

export class FXWavingGrid extends DemoFX {
  constructor() {
    super();
    this.name = 'FXWavingGrid';
    this.x = 0; this.y = 0;
    this.sizeX = 0; this.sizeY = 0;
    this.resX = 0; this.resY = 0;
    this.texturePath = '';
    this.duration = 0;
    this.texture = null;
    // Grid data (in 3D world space)
    this.basePositions = null; // Float32Array: resX*resY * 3
    this.uvs = null;           // Float32Array: resX*resY * 2
    this.indices = null;        // Uint16Array
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.scene = null;
    this.camera = null;         // Perspective camera matching PTA NULL camera
  }

  setup(x, y, sizeX, sizeY, resX, resY, texturePath, duration) {
    this.x = x; this.y = y;
    this.sizeX = sizeX; this.sizeY = sizeY;
    this.resX = resX; this.resY = resY;
    this.texturePath = texturePath;
    this.duration = duration;
  }

  // Override in subclasses
  getParams(fxTime) {
    return { alpha: 1, amplitude: 0, frequency: 100, period: 8, numRenders: 1, renderDelay: 0 };
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXWavingGrid: failed to load "${this.texturePath}":`, err.message);
      }
    }

    const { resX, resY } = this;
    const numVerts = resX * resY;
    const numQuads = (resX - 1) * (resY - 1);

    // Unproject grid corners from screen space to 3D world space
    // C++ uses setActiveCamera(NULL) → perspective with FOV=60, aspect=1.33
    // Screen coords: (x,y) in [0,1], Z_buffer=0.4
    const ul = unprojectPTA(this.x - this.sizeX / 2, this.y - this.sizeY / 2, UNPROJECT_Z_BUFFER);
    const ur = unprojectPTA(this.x + this.sizeX / 2, this.y - this.sizeY / 2, UNPROJECT_Z_BUFFER);
    const ll = unprojectPTA(this.x - this.sizeX / 2, this.y + this.sizeY / 2, UNPROJECT_Z_BUFFER);

    this.basePositions = new Float32Array(numVerts * 3);
    this.uvs = new Float32Array(numVerts * 2);

    for (let iy = 0; iy < resY; iy++) {
      for (let ix = 0; ix < resX; ix++) {
        const normX = ix / (resX - 1);
        const normY = iy / (resY - 1);
        const idx = iy * resX + ix;

        // Bilinear interpolation between unprojected corners (matches C++)
        const wx = ul.x + (ur.x - ul.x) * normX;
        const wy = ul.y + (ll.y - ul.y) * normY;
        const wz = ul.z; // All vertices share the same Z depth

        this.basePositions[idx * 3 + 0] = wx;
        this.basePositions[idx * 3 + 1] = wy;
        this.basePositions[idx * 3 + 2] = wz;

        this.uvs[idx * 2 + 0] = normX;
        this.uvs[idx * 2 + 1] = 1 - normY;
      }
    }

    // Build indices (two triangles per quad)
    this.indices = new Uint16Array(numQuads * 6);
    let idx = 0;
    for (let iy = 0; iy < resY - 1; iy++) {
      for (let ix = 0; ix < resX - 1; ix++) {
        const v0 = iy * resX + ix;
        const v1 = (iy + 1) * resX + ix;
        const v2 = (iy + 1) * resX + ix + 1;
        const v3 = iy * resX + ix + 1;
        this.indices[idx++] = v0;
        this.indices[idx++] = v1;
        this.indices[idx++] = v2;
        this.indices[idx++] = v0;
        this.indices[idx++] = v2;
        this.indices[idx++] = v3;
      }
    }

    // Compute distances from center vertex for deformation (in world space)
    const centerIdx = Math.floor((resX * resY) / 2);
    const cx = this.basePositions[centerIdx * 3];
    const cy = this.basePositions[centerIdx * 3 + 1];
    const cz = this.basePositions[centerIdx * 3 + 2];
    this.distances = new Float32Array(numVerts);
    for (let i = 0; i < numVerts; i++) {
      const dx = this.basePositions[i * 3] - cx;
      const dy = this.basePositions[i * 3 + 1] - cy;
      const dz = this.basePositions[i * 3 + 2] - cz;
      this.distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // Create Three.js geometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(numVerts * 3), 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

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
    // gluPerspective(fov/aspect, aspect, near, far) → vFOV = 60/1.33
    this.camera = new THREE.PerspectiveCamera(
      PTA_NULL_VFOV,
      PTA_NULL_ASPECT,
      PTA_NULL_NEAR,
      PTA_NULL_FAR
    );
    // Identity view matrix: camera at origin looking along -Z
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.camera.updateProjectionMatrix();
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture || !this.geometry) return;
    if (fxTime > this.duration) return;

    const params = this.getParams(fxTime);
    const posAttr = this.geometry.getAttribute('position');
    const positions = posAttr.array;
    const numVerts = this.resX * this.resY;
    const recFrequency = 1.0 / params.frequency;

    this.material.opacity = params.alpha;

    for (let renderPass = 0; renderPass < params.numRenders; renderPass++) {
      // Compute deformation: Z displacement in world space (same as C++)
      for (let i = 0; i < numVerts; i++) {
        positions[i * 3 + 0] = this.basePositions[i * 3 + 0];
        positions[i * 3 + 1] = this.basePositions[i * 3 + 1];
        // Z offset from sine wave
        const zOffset = Math.sin(
          (this.distances[i] * params.period) +
          ((fxTime - (params.renderDelay * renderPass)) * recFrequency)
        ) * params.amplitude;
        positions[i * 3 + 2] = this.basePositions[i * 3 + 2] + zOffset;
      }
      posAttr.needsUpdate = true;

      // Render with perspective camera (Z displacement creates visible warping)
      dm.renderer.webglRenderer.render(this.scene, this.camera);
    }
  }

  close() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    this.texture = null;
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.scene = null;
    this.camera = null;
  }
}

/**
 * FXWavingDemoLogo - 1 render pass, freq=48, period=48.
 * Alpha fades in (0→0.7 in 300ms), holds at 0.7, fades out (0.7→0 in last 2000ms).
 * Amplitude is 0 normally, increases during fade-out.
 */
export class FXWavingDemoLogo extends FXWavingGrid {
  constructor() {
    super();
    this.name = 'FXWavingDemoLogo';
  }

  getParams(fxTime) {
    let alpha, amplitude;
    const frequency = 48;
    const period = 48;

    if (fxTime < 300) {
      alpha = (fxTime / 300) * 0.7;
      amplitude = 0;
    } else if (fxTime > (this.duration - 2000)) {
      alpha = ((this.duration - fxTime) / 2000) * 0.7;
      amplitude = (0.7 - alpha) * 0.1;
    } else {
      alpha = 0.7;
      amplitude = 0;
    }

    amplitude *= 2.0;
    alpha *= 1.0; // numRenders=1, so alpha *= 1/1 = no change

    return { alpha, amplitude, frequency, period, numRenders: 1, renderDelay: 0 };
  }
}

/**
 * FXWavingBlur - 4 render passes, delay=122ms, freq=280, period=8, amplitude=0.25.
 * Alpha = 1.0 / (4 * 0.5) = 0.5
 */
export class FXWavingBlur extends FXWavingGrid {
  constructor() {
    super();
    this.name = 'FXWavingBlur';
  }

  getParams(fxTime) {
    const frequency = 280;
    const period = 8;
    const amplitude = 0.25;
    // C++: *fAlpha = 1.0f; then *fAlpha *= 1.0f / (GetNumRenders() * 0.5f);
    // With 4 renders: alpha = 1.0 / (4 * 0.5) = 0.5
    const alpha = 1.0 / (4 * 0.5);

    return { alpha, amplitude, frequency, period, numRenders: 4, renderDelay: 122 };
  }
}
