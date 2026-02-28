import * as THREE from 'three';
import { DemoFX } from '../engine/DemoManager.js';
import { BlendMode } from '../engine/Renderer.js';

/**
 * FXSplineForm - Rotating 3D spline curve with billboard quads.
 * 20 random control points (seed=250880), 800 evaluated Catmull-Rom points.
 * Beat-synced speed changes with 29 beat timestamps.
 * Two rendering passes: blur texture + point texture.
 * C++ original: Odyssey/FXSplineForm.cpp
 */

// PTA NULL camera: setActiveCamera(NULL) → FOV=60 horizontal, aspect=1.33
const PTA_NULL_HFOV = 60;
const PTA_NULL_ASPECT = 1.33;
const PTA_NULL_VFOV = PTA_NULL_HFOV / PTA_NULL_ASPECT; // ~45.11°

const NUM_SINCRO_BEATS = 29;
const SINCRO_BEATS = [
  92513, 92853, 93194, 93494, 93825,
  95818, 96028, 96288, 96589, 96899,
  99062, 99373, 99713, 100024, 100645,
  100975, 101276, 101586, 101906, 102197,
  102537, 102828, 103148, 103819, 104070,
  104350, 104731, 105011, 105301,
];

// MSVC rand() for reproducible control points (matches C++ srand/rand)
function msvcRand(state) {
  state.seed = ((state.seed * 214013 + 2531011) & 0xFFFFFFFF) >>> 0;
  return (state.seed >>> 16) & 0x7FFF;
}

/**
 * Catmull-Rom (Overhauser) spline evaluation.
 * Given control points, evaluate at parameter t ∈ [0, 1).
 */
function evaluateCatmullRom(points, t) {
  const n = points.length;
  if (n < 4) return { x: 0, y: 0, z: 0 };

  const numSegments = n - 3;
  const tScaled = t * numSegments;
  let seg = Math.floor(tScaled);
  if (seg >= numSegments) seg = numSegments - 1;
  const frac = tScaled - seg;

  const p0 = points[seg];
  const p1 = points[seg + 1];
  const p2 = points[seg + 2];
  const p3 = points[seg + 3];

  const f = frac;
  const f2 = f * f;
  const f3 = f2 * f;

  return {
    x: 0.5 * ((-p0.x + 3*p1.x - 3*p2.x + p3.x) * f3 +
              (2*p0.x - 5*p1.x + 4*p2.x - p3.x) * f2 +
              (-p0.x + p2.x) * f +
              2*p1.x),
    y: 0.5 * ((-p0.y + 3*p1.y - 3*p2.y + p3.y) * f3 +
              (2*p0.y - 5*p1.y + 4*p2.y - p3.y) * f2 +
              (-p0.y + p2.y) * f +
              2*p1.y),
    z: 0.5 * ((-p0.z + 3*p1.z - 3*p2.z + p3.z) * f3 +
              (2*p0.z - 5*p1.z + 4*p2.z - p3.z) * f2 +
              (-p0.z + p2.z) * f +
              2*p1.z),
  };
}

export class FXSplineForm extends DemoFX {
  constructor() {
    super();
    this.name = 'FXSplineForm';
    this.center = { x: 0, y: 0, z: 0 };
    this.fSize = 0;
    this.numCtrlPoints = 0;
    this.numEvalPoints = 0;
    this.pointTexturePath = '';
    this.blurTexturePath = '';
    this.pointTexture = null;
    this.blurTexture = null;
    this.evaluatedPoints = null;
    this.lastTime = 0;
    this.angle = 0;
    // Three.js objects
    this.geometry = null;
    this.blurMaterial = null;
    this.pointMaterial = null;
    this.mesh = null;
    this.scene = null;
    this.camera = null;
  }

  setup(center, size, numCtrlPoints, numEvalPoints, pointTexturePath, blurTexturePath) {
    this.center = center;
    this.fSize = size;
    this.numCtrlPoints = numCtrlPoints;
    this.numEvalPoints = numEvalPoints;
    this.pointTexturePath = pointTexturePath;
    this.blurTexturePath = blurTexturePath;
  }

  async loadData(dm) {
    // Load textures
    try {
      this.pointTexture = await dm.assetManager.loadTextureByPath(this.pointTexturePath);
    } catch (err) {
      console.warn(`FXSplineForm: failed to load point texture:`, err.message);
    }
    if (this.blurTexturePath) {
      try {
        this.blurTexture = await dm.assetManager.loadTextureByPath(this.blurTexturePath);
      } catch (err) {
        console.warn(`FXSplineForm: failed to load blur texture:`, err.message);
      }
    }

    // Generate random control points with MSVC srand(250880)
    const rng = { seed: 250880 };
    const controlPoints = [];
    const sz = this.fSize;
    const sz2 = Math.floor(sz) * 2;

    for (let i = 0; i < this.numCtrlPoints - 1; i++) {
      const x = ((msvcRand(rng) % sz2) - sz) / sz;
      const y = ((msvcRand(rng) % sz2) - sz) / sz;
      const z = ((msvcRand(rng) % sz2) - sz) / sz;
      controlPoints.push({ x, y, z });
    }

    // Close the spline: last 3 points = first 3 points (reversed)
    controlPoints.push({ ...controlPoints[2] });
    controlPoints[this.numCtrlPoints - 2] = { ...controlPoints[1] };
    controlPoints[this.numCtrlPoints - 3] = { ...controlPoints[0] };

    // Evaluate spline
    this.evaluatedPoints = new Array(this.numEvalPoints);
    for (let i = 0; i < this.numEvalPoints; i++) {
      const t = i / this.numEvalPoints;
      this.evaluatedPoints[i] = evaluateCatmullRom(controlPoints, t);
    }

    // Create geometry for billboard quads (4 verts per point = numEvalPoints * 4)
    const numVerts = this.numEvalPoints * 4;
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const indices = new Uint16Array(this.numEvalPoints * 6);

    for (let i = 0; i < this.numEvalPoints; i++) {
      const base = i * 4;
      // UVs for quad (matches C++: 0,0 → 0,1 → 1,1 → 1,0)
      uvs[base * 2 + 0] = 0; uvs[base * 2 + 1] = 0;
      uvs[(base + 1) * 2 + 0] = 0; uvs[(base + 1) * 2 + 1] = 1;
      uvs[(base + 2) * 2 + 0] = 1; uvs[(base + 2) * 2 + 1] = 1;
      uvs[(base + 3) * 2 + 0] = 1; uvs[(base + 3) * 2 + 1] = 0;

      // Indices: two triangles per quad (CCW winding for camera looking -Z)
      const iBase = i * 6;
      indices[iBase + 0] = base;
      indices[iBase + 1] = base + 2;
      indices[iBase + 2] = base + 1;
      indices[iBase + 3] = base;
      indices[iBase + 4] = base + 3;
      indices[iBase + 5] = base + 2;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Materials
    this.blurMaterial = new THREE.MeshBasicMaterial({
      map: this.blurTexture || this.pointTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    this.pointMaterial = new THREE.MeshBasicMaterial({
      map: this.pointTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.blurMaterial);
    this.mesh.frustumCulled = false; // Positions update every frame from zeros
    this.mesh.matrixAutoUpdate = false; // We set the world matrix manually
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    // PTA NULL camera: identity view, gluPerspective(60/1.33, 1.33, 1, 1000)
    this.camera = new THREE.PerspectiveCamera(
      PTA_NULL_VFOV, PTA_NULL_ASPECT, 1, 1000
    );
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.camera.updateProjectionMatrix();
  }

  _drawSpline(dm, texture, material, interpValue, structSizeX, structSizeY, pointSize, angle, alpha) {
    if (!this.evaluatedPoints || !this.geometry) return;

    const posAttr = this.geometry.getAttribute('position');
    const positions = posAttr.array;

    // Build world matrix: scale → rotateY → translate
    // C++: mat.buildScale(sX,sY,sZ); mat.rotateY(angle); mat.translate(cx,cy,cz);
    const mat = new THREE.Matrix4();
    const scaleMat = new THREE.Matrix4().makeScale(structSizeX, structSizeY, this.fSize);
    const rotMat = new THREE.Matrix4().makeRotationY(angle * Math.PI / 180);
    const transMat = new THREE.Matrix4().makeTranslation(this.center.x, this.center.y, this.center.z);
    mat.copy(scaleMat).premultiply(rotMat).premultiply(transMat);

    // C++ billboard deltas are added in LOCAL space, then amplified by the world
    // matrix scale on the GPU. We transform points to world space first, so we must
    // scale billboard offsets by the world matrix axis lengths manually.
    //
    // C++: deltaX = normalize(Xaxis) * pointSize  →  effective world size = pointSize * |Xaxis|
    //      deltaY = normalize(Yaxis) * pointSize * (|Xaxis|/|Yaxis|)  →  effective = pointSize * |Xaxis|
    // Both axes end up with the same effective world-space size: pointSize * |Xaxis|.
    const xAxis = new THREE.Vector3();
    mat.extractBasis(xAxis, new THREE.Vector3(), new THREE.Vector3());
    const worldScale = xAxis.length();

    // Camera-aligned billboard: right=(1,0,0), up=(0,1,0) for identity view
    const halfSize = pointSize * worldScale * 0.5;

    // Reset mesh to identity — vertices are in world space
    this.mesh.matrix.identity();
    this.mesh.matrixWorldNeedsUpdate = true;

    const tempVec = new THREE.Vector3();

    for (let i = 0; i < this.numEvalPoints; i++) {
      const p1 = this.evaluatedPoints[i];
      const p2 = this.evaluatedPoints[(i + 1) % this.numEvalPoints];

      // Interpolate between consecutive points (local space [-1, 1])
      const vx = p1.x + (p2.x - p1.x) * interpValue;
      const vy = p1.y + (p2.y - p1.y) * interpValue;
      const vz = p1.z + (p2.z - p1.z) * interpValue;

      // Transform evaluated point to world space
      tempVec.set(vx, vy, vz).applyMatrix4(mat);

      // Camera-aligned billboard quad (always faces -Z camera)
      const base = i * 4;
      // Vertex 0: top-left (-X, +Y)
      positions[base * 3 + 0] = tempVec.x - halfSize;
      positions[base * 3 + 1] = tempVec.y + halfSize;
      positions[base * 3 + 2] = tempVec.z;
      // Vertex 1: bottom-left (-X, -Y)
      positions[(base + 1) * 3 + 0] = tempVec.x - halfSize;
      positions[(base + 1) * 3 + 1] = tempVec.y - halfSize;
      positions[(base + 1) * 3 + 2] = tempVec.z;
      // Vertex 2: bottom-right (+X, -Y)
      positions[(base + 2) * 3 + 0] = tempVec.x + halfSize;
      positions[(base + 2) * 3 + 1] = tempVec.y - halfSize;
      positions[(base + 2) * 3 + 2] = tempVec.z;
      // Vertex 3: top-right (+X, +Y)
      positions[(base + 3) * 3 + 0] = tempVec.x + halfSize;
      positions[(base + 3) * 3 + 1] = tempVec.y + halfSize;
      positions[(base + 3) * 3 + 2] = tempVec.z;
    }

    posAttr.needsUpdate = true;
    this.mesh.material = material;
    material.opacity = alpha;

    dm.renderer.webglRenderer.render(this.scene, this.camera);
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.evaluatedPoints) return;

    // C++: (float)((int)fxTime % 200) / 200.0f
    const interpValue = (Math.floor(fxTime) % 200) / 200.0;
    let sizeX = 1000.0 - (fxTime * 1.4);
    if (sizeX < this.fSize) sizeX = this.fSize;
    const sizeY = this.fSize;
    const pointSize2 = 0.07 + Math.abs(Math.sin(fxTime / 254.0)) / 24.0;

    // Beat sync — uses absolute demo time (not fxTime)
    let speed = 2.0;
    for (let i = 0; i < NUM_SINCRO_BEATS; i++) {
      let beatDuration = 130.0;
      if (i === 19) beatDuration = 260.0;

      if (demoTime > SINCRO_BEATS[i] && demoTime < SINCRO_BEATS[i] + beatDuration) {
        speed = 30.0;
      }
    }

    this.angle += (fxTime - this.lastTime) / 100.0 * speed;

    // Pass 1: blur texture (SRCALPHA/INVSRCALPHA)
    if (this.blurTexture) {
      this._drawSpline(dm, this.blurTexture, this.blurMaterial, interpValue, sizeX, sizeY, pointSize2, this.angle, 1.0);
    }

    // Pass 2: point texture (SRCALPHA/ONE - additive)
    if (this.pointTexture) {
      this._drawSpline(dm, this.pointTexture, this.pointMaterial, interpValue, sizeX, sizeY, 0.03, this.angle, 1.0);
    }

    this.lastTime = fxTime;
  }

  close() {
    if (this.geometry) this.geometry.dispose();
    if (this.blurMaterial) this.blurMaterial.dispose();
    if (this.pointMaterial) this.pointMaterial.dispose();
    this.pointTexture = null;
    this.blurTexture = null;
    this.evaluatedPoints = null;
  }
}
