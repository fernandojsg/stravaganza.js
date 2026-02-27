import { DemoFX } from '../engine/DemoManager.js';
import { getTransformMatrix } from '../engine/AnimationSystem.js';
import * as THREE from 'three';

/**
 * FXHairyObject - 3D object with procedural hair strands.
 *
 * Creates hair strands from each vertex of a mesh, with control points
 * along vertex normals. Each strand is rendered as billboard quads along
 * a Catmull-Rom spline. Animation uses time-delayed transforms per
 * control point, creating a wave-like trailing effect.
 *
 * C++ original: FXHairyObject.cpp
 * - 6 control points per strand (vertex + 5 along normal)
 * - Position delay: 800ms, Rotation delay: 1000ms
 * - Additional continuous rotation: 0.04 deg/ms around X, Y, Z
 * - Billboard quads with additive blending (ONE+ONE)
 * - Size tapers from basePartSize to extremePartSize
 */

const HAIR_CPOINTS = 5;
const HAIR_POS_DELAY = 800;  // ms
const HAIR_ROT_DELAY = 1000; // ms
const DEG_TO_RAD = Math.PI / 180;

/**
 * Evaluate Overhouser (Catmull-Rom) spline matching PTA's pta3DSplineOverhouser.
 *
 * PTA convention: first and last control points are "phantom" tangent points.
 * For N points, the spline passes through points[1] to points[N-2],
 * using points[0] and points[N-1] only for tangent computation.
 * Number of segments = N - 3.
 *
 * @param {THREE.Vector3[]} points - Control points (minimum 4)
 * @param {number} t - Parameter (0 to 1)
 * @param {THREE.Vector3} out - Output vector
 */
function overhouserSpline(points, t, out) {
  const n = points.length;
  const numSegments = n - 3;

  if (numSegments < 1) { out.copy(points[0]); return; }
  if (t <= 0) { out.copy(points[1]); return; }
  if (t >= 1) { out.copy(points[n - 2]); return; }

  const segFloat = t * numSegments;
  let seg = Math.min(Math.floor(segFloat), numSegments - 1);
  const u = segFloat - seg;

  const p0 = points[seg];
  const p1 = points[seg + 1];
  const p2 = points[seg + 2];
  const p3 = points[seg + 3];

  const u2 = u * u;
  const u3 = u2 * u;

  // Standard Catmull-Rom basis (tension 0.5) — matches PTA exactly
  const a = -0.5 * u3 + u2 - 0.5 * u;
  const b = 1.5 * u3 - 2.5 * u2 + 1;
  const c = -1.5 * u3 + 2 * u2 + 0.5 * u;
  const d = 0.5 * u3 - 0.5 * u2;

  out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
  out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
  out.z = a * p0.z + b * p1.z + c * p2.z + d * p3.z;
}

export class FXHairyObject extends DemoFX {
  constructor() {
    super();
    this.name = 'FXHairyObject';

    this.numHairParticles = 30; // quads per strand
    this.hairLength = 190;
    this.basePartSize = 8.0;
    this.extremePartSize = 3.0;
    this.texturePath = '';
    this.sceneFile = '';
    this.objectName = '';
    this.camera = '';

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.Texture|null} */
    this.hairTexture = null;
    /** @type {object|null} - PTA object data with animation keys */
    this.objectData = null;

    // Hair data: array of control point arrays (6 points each)
    // Each hair[i] = Vector3[HAIR_CPOINTS + 1]
    /** @type {THREE.Vector3[][]} */
    this.hairs = [];

    // Rendering
    /** @type {THREE.BufferGeometry|null} */
    this.quadGeometry = null;
    /** @type {THREE.MeshBasicMaterial|null} */
    this.quadMaterial = null;
    /** @type {THREE.Mesh|null} */
    this.quadMesh = null;
    /** @type {THREE.Scene|null} */
    this.hairScene = null;
  }

  /**
   * @param {number} numHairParticles - Quads per strand (30)
   * @param {number} hairLength - Length of hair strands (190)
   * @param {number} basePartSize - Quad size at root (8.0)
   * @param {number} extremePartSize - Quad size at tip (3.0)
   * @param {string} texturePath - Glow texture path
   * @param {string} sceneFile - PTA scene file
   * @param {string} objectName - Object name in scene
   * @param {string} camera - Camera name
   */
  setup(numHairParticles, hairLength, basePartSize, extremePartSize, texturePath, sceneFile, objectName, camera) {
    this.numHairParticles = numHairParticles;
    this.hairLength = hairLength;
    this.basePartSize = basePartSize;
    this.extremePartSize = extremePartSize;
    this.texturePath = texturePath;
    this.sceneFile = sceneFile;
    this.objectName = objectName;
    this.camera = camera;
  }

  async loadData(dm) {
    // Load glow texture
    if (this.texturePath) {
      try {
        this.hairTexture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXHairyObject: failed to load texture "${this.texturePath}":`, err.message);
      }
    }

    // Load scene
    if (this.sceneFile) {
      try {
        this.sceneId = `hairy_${Date.now()}`;
        const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
        const textures = await dm.assetManager.loadSceneTextures(ptaScene, '');
        dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);
      } catch (err) {
        console.warn(`FXHairyObject: failed to load scene "${this.sceneFile}":`, err.message);
        this.sceneId = null;
        return;
      }
    }

    // Get the hairy object's PTA data (unique vertices + normals + animation keys)
    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;



    let entry = managed.meshes.get(this.objectName);
    if (!entry) {
      // Try case-insensitive search
      for (const [name, e] of managed.meshes) {
        if (name.toLowerCase() === this.objectName.toLowerCase()) {
          entry = e;
          break;
        }
      }
    }
    if (!entry) {
      // Fallback: use first mesh in scene
      const [first] = managed.meshes.values();
      entry = first;
      if (entry) {
        console.warn(`FXHairyObject: "${this.objectName}" not found, using first mesh`);
      }
    }
    if (!entry) {
      console.warn(`FXHairyObject: no meshes found in scene`);
      return;
    }

    this.objectData = entry.data;
    const verts = entry.data.vertices;
    const norms = entry.data.normals;

    // C++: For each unique vertex, create HAIRCPOINTS+1 = 6 control points.
    // C++ line 79: pHairArray[0] + pObject->verts[nCount] is a no-op (operator+, not =),
    // so pHairArray[0] remains default-constructed at (0,0,0).
    // point[0] = (0,0,0) — used as phantom tangent point by Overhouser spline
    // point[1..5] = vertex + normal * hairLength * (j / (HAIRCPOINTS-1))
    this.hairs = [];
    for (let i = 0; i < verts.length; i++) {
      const pos = verts[i];
      let norm;
      if (norms && i < norms.length) {
        norm = new THREE.Vector3(norms[i].x, norms[i].y, norms[i].z).normalize();
      } else {
        norm = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
      }

      const controlPoints = new Array(HAIR_CPOINTS + 1);
      // C++ bug: pHairArray[0] stays at (0,0,0) — acts as phantom tangent anchor
      controlPoints[0] = new THREE.Vector3(0, 0, 0);
      for (let j = 0; j < HAIR_CPOINTS; j++) {
        const fT = j / (HAIR_CPOINTS - 1);
        controlPoints[j + 1] = new THREE.Vector3(
          pos.x + norm.x * this.hairLength * fT,
          pos.y + norm.y * this.hairLength * fT,
          pos.z + norm.z * this.hairLength * fT,
        );
      }
      this.hairs.push(controlPoints);
    }

    // Build quad geometry for all hair strands
    this._buildQuadGeometry();
  }

  _buildQuadGeometry() {
    const totalQuads = this.hairs.length * this.numHairParticles;

    // Each quad = 2 triangles = 6 vertices
    const positions = new Float32Array(totalQuads * 6 * 3);
    const uvs = new Float32Array(totalQuads * 6 * 2);

    // Initialize UVs (static)
    for (let q = 0; q < totalQuads; q++) {
      const base = q * 12;
      // Triangle 1: TL, BL, BR
      uvs[base]     = 0; uvs[base + 1]  = 0;
      uvs[base + 2] = 0; uvs[base + 3]  = 1;
      uvs[base + 4] = 1; uvs[base + 5]  = 1;
      // Triangle 2: TL, BR, TR
      uvs[base + 6] = 0; uvs[base + 7]  = 0;
      uvs[base + 8] = 1; uvs[base + 9]  = 1;
      uvs[base + 10] = 1; uvs[base + 11] = 0;
    }

    this.quadGeometry = new THREE.BufferGeometry();
    this.quadGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.quadGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    this.quadMaterial = new THREE.MeshBasicMaterial({
      map: this.hairTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    this.quadMesh = new THREE.Mesh(this.quadGeometry, this.quadMaterial);
    this.quadMesh.frustumCulled = false; // Positions update every frame

    this.hairScene = new THREE.Scene();
    this.hairScene.add(this.quadMesh);
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId || !this.objectData || this.hairs.length === 0) return;

    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    // Get and update the scene camera
    const camEntry = managed.cameras.get(this.camera);
    if (!camEntry) return;
    const camera = camEntry.camera;
    dm.sceneManager._updateCamera(camera, camEntry.data, fxTime);
    const vp = dm.renderer.currentViewport;
    camera.aspect = vp.w / vp.h || (800 / 600);
    camera.updateProjectionMatrix();



    // Get camera basis vectors for billboarding
    camera.updateMatrixWorld();
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

    // Reusable temp objects
    const posArr = this.quadGeometry.getAttribute('position').array;
    const animatedCP = new Array(HAIR_CPOINTS);
    for (let i = 0; i < HAIR_CPOINTS; i++) animatedCP[i] = new THREE.Vector3();
    const posMat = new THREE.Matrix4();
    const rotMat = new THREE.Matrix4();
    const rx = new THREE.Matrix4();
    const ry = new THREE.Matrix4();
    const rz = new THREE.Matrix4();
    const combined = new THREE.Matrix4();
    const posOnly = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const splinePoint = new THREE.Vector3();
    const dx = new THREE.Vector3();
    const dy = new THREE.Vector3();

    let quadIdx = 0;

    for (let h = 0; h < this.hairs.length; h++) {
      const hair = this.hairs[h];

      // Animate 5 control points (indices 0-4, matching C++ pHair[nCount] = ... (*it)[nCount])
      for (let cp = 0; cp < HAIR_CPOINTS; cp++) {
        const fT = cp / (HAIR_CPOINTS - 1); // 0 to 1 along hair

        // C++: pos = pObject->getTM(fxTime - fT * HAIRPOSDELAY); pos.removeRot(); pos.removeScale(false)
        const posTime = fxTime - (fT * HAIR_POS_DELAY);
        posMat.copy(getTransformMatrix(posTime, this.objectData, this.objectData.transformMatrix));
        const px = posMat.elements[12];
        const py = posMat.elements[13];
        const pz = posMat.elements[14];

        // C++: rot = pObject->getTM(fxTime - fT * HAIRROTDELAY); rot.removePos()
        const rotTime = fxTime - (fT * HAIR_ROT_DELAY);
        rotMat.copy(getTransformMatrix(rotTime, this.objectData, this.objectData.transformMatrix));
        rotMat.elements[12] = 0;
        rotMat.elements[13] = 0;
        rotMat.elements[14] = 0;

        // C++: preRotateX/Y/Z((fxTime * 0.04) - (fT * HAIRROTDELAY * 0.1))
        const angle = ((fxTime * 0.04) - (fT * HAIR_ROT_DELAY * 0.1)) * DEG_TO_RAD;
        rx.makeRotationX(angle);
        ry.makeRotationY(angle);
        rz.makeRotationZ(angle);
        rotMat.multiply(rx);
        rotMat.multiply(ry);
        rotMat.multiply(rz);

        // Build position-only matrix
        posOnly.identity();
        posOnly.elements[12] = px;
        posOnly.elements[13] = py;
        posOnly.elements[14] = pz;

        // C++: pHair[cp] = (pos * rot) * (*it)[cp]  — uses indices 0..4
        combined.multiplyMatrices(posOnly, rotMat);
        v.copy(hair[cp]);
        v.applyMatrix4(combined);

        animatedCP[cp].copy(v);
      }

      // Sample spline and emit billboard quads
      for (let q = 0; q < this.numHairParticles; q++) {
        const fT = q / (this.numHairParticles - 1);

        // Overhouser spline evaluation (matches PTA pta3DSplineOverhouser)
        overhouserSpline(animatedCP, fT, splinePoint);

        // Size interpolation: base → extreme
        const size = this.basePartSize + (this.extremePartSize - this.basePartSize) * fT;

        // Billboard quad corners — C++ uses deltaX*0.5 as half-extent:
        //   deltaX = camDeltaX * fSize; vertex = center - (deltaX * 0.5) + (deltaY * 0.5)
        // So half-extent = fSize * 0.5
        const halfSize = size * 0.5;
        dx.copy(camRight).multiplyScalar(halfSize);
        dy.copy(camUp).multiplyScalar(halfSize);

        const cx = splinePoint.x, cy = splinePoint.y, cz = splinePoint.z;
        const dxx = dx.x, dxy = dx.y, dxz = dx.z;
        const dyx = dy.x, dyy = dy.y, dyz = dy.z;

        // TL = center - dx + dy
        const tlx = cx - dxx + dyx, tly = cy - dxy + dyy, tlz = cz - dxz + dyz;
        // BL = center - dx - dy
        const blx = cx - dxx - dyx, bly = cy - dxy - dyy, blz = cz - dxz - dyz;
        // BR = center + dx - dy
        const brx = cx + dxx - dyx, bry = cy + dxy - dyy, brz = cz + dxz - dyz;
        // TR = center + dx + dy
        const trx = cx + dxx + dyx, try_ = cy + dxy + dyy, trz = cz + dxz + dyz;

        const base = quadIdx * 18;
        // Triangle 1: TL, BL, BR
        posArr[base]      = tlx; posArr[base + 1]  = tly; posArr[base + 2]  = tlz;
        posArr[base + 3]  = blx; posArr[base + 4]  = bly; posArr[base + 5]  = blz;
        posArr[base + 6]  = brx; posArr[base + 7]  = bry; posArr[base + 8]  = brz;
        // Triangle 2: TL, BR, TR
        posArr[base + 9]  = tlx; posArr[base + 10] = tly; posArr[base + 11] = tlz;
        posArr[base + 12] = brx; posArr[base + 13] = bry; posArr[base + 14] = brz;
        posArr[base + 15] = trx; posArr[base + 16] = try_; posArr[base + 17] = trz;

        quadIdx++;
      }
    }

    this.quadGeometry.getAttribute('position').needsUpdate = true;

    // Render hair billboard quads with the scene camera
    dm.renderer.renderScene(this.hairScene, camera);
  }

  close() {
    if (this.quadGeometry) this.quadGeometry.dispose();
    if (this.quadMaterial) this.quadMaterial.dispose();
    this.quadMesh = null;
    this.quadGeometry = null;
    this.quadMaterial = null;
    this.hairScene = null;
    this.sceneId = null;
    this.hairTexture = null;
    this.objectData = null;
    this.hairs = [];
  }
}
