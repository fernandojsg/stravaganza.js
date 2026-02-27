import { DemoFX } from '../engine/DemoManager.js';
import { getTransformMatrix } from '../engine/AnimationSystem.js';
import * as THREE from 'three';

/**
 * FXBonedSpike - Per-vertex time-delayed deformation spike.
 *
 * Deforms a spike mesh by applying time-delayed rotations per vertex.
 * Each vertex's rotation time is delayed based on its distance from the origin,
 * creating a wave-like deformation that propagates along the spike's length.
 * The elasticity parameter controls propagation speed (higher = slower).
 *
 * C++ original: FXBonedSpike.cpp
 * - For each vertex: fTimeRot = fxTime - (distance * elasticity) + 1000
 * - Apply animation TM at delayed time + additional rotations (0.06 deg/ms)
 * - Position comes from separately-delayed time (elasticity * 0.2)
 */

const DEG_TO_RAD = Math.PI / 180;

export class FXBonedSpike extends DemoFX {
  constructor() {
    super();
    this.name = 'FXBonedSpike';

    this.elasticity = 4.0;
    this.sceneFile = '';
    this.textureDir = '';

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.Mesh|null} */
    this.spikeMesh = null;
    /** @type {object|null} - PTA object data with animation keys */
    this.spikeData = null;
    /** @type {Float32Array|null} - Original undeformed vertex positions */
    this.originalPositions = null;
    /** @type {Float32Array|null} - Pre-computed distance from origin per vertex */
    this.distances = null;
    /** @type {boolean} */
    this.hasAnimation = false;
    /** @type {THREE.LineBasicMaterial|null} - Wireframe overlay material (unlit, no texture) */
    this.wireMaterial = null;
    /** @type {THREE.LineSegments|null} - Edge wireframe (quad edges, no triangle diagonals) */
    this.wireSegments = null;
    /** @type {THREE.Scene|null} */
    this.wireScene = null;
    /** @type {Uint32Array|null} - Edge index pairs into the position buffer */
    this.edgeIndices = null;
  }

  /**
   * @param {number} p1-p6 - Spike generation params (unused in this demo, all 0)
   * @param {number} elasticity - Wave propagation delay coefficient
   * @param {string} sceneFile - Path to the PTA scene file
   * @param {string} textureDir - Path to the texture directory
   */
  setup(p1, p2, p3, p4, p5, p6, elasticity, sceneFile, textureDir) {
    this.elasticity = elasticity;
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
  }

  async loadData(dm) {
    if (!this.sceneFile) return;

    try {
      this.sceneId = `spike_${Date.now()}`;
      const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);
    } catch (err) {
      console.warn(`FXBonedSpike: failed to load scene "${this.sceneFile}":`, err.message);
      this.sceneId = null;
      return;
    }

    // Find the spike object and prepare for per-vertex deformation
    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    // C++ looks for object named "spike"
    let entry = managed.meshes.get('spike');
    if (!entry) {
      // Fallback: use first mesh in scene
      const [first] = managed.meshes.values();
      entry = first;
    }
    if (!entry) return;

    this.spikeMesh = entry.mesh;
    this.spikeData = entry.data;

    // Check if the object has animation keys
    this.hasAnimation = (
      (this.spikeData.posKeys && this.spikeData.posKeys.length > 0) ||
      (this.spikeData.rotKeys && this.spikeData.rotKeys.length > 0) ||
      (this.spikeData.sclKeys && this.spikeData.sclKeys.length > 0)
    );

    // Store original (undeformed) vertex positions and smooth normals
    const posAttr = this.spikeMesh.geometry.getAttribute('position');
    this.originalPositions = new Float32Array(posAttr.array);

    // Store original smooth normals for per-vertex rotation in doFrame.
    // C++ ComputeNormals(true) = smooth normals. Non-indexed Three.js geometry
    // gives flat normals from computeVertexNormals(), so we transform original
    // smooth normals per-vertex instead (matching C++ Gouraud shading).
    const normalAttr = this.spikeMesh.geometry.getAttribute('normal');
    this.originalNormals = normalAttr ? new Float32Array(normalAttr.array) : null;

    // C++ wireframe overlay: no textures, no lighting, glPolygonMode(GL_LINE).
    // C++ uses object->wireframeColor (default 0.5, 0.5, 0.5) — NOT material diffuse.
    // Use EdgesGeometry to get quad-style wireframe (no coplanar triangle diagonals).
    const wireColor = new THREE.Color(0.5, 0.5, 0.5);
    this.wireMaterial = new THREE.LineBasicMaterial({
      color: wireColor,
      linewidth: 2,
      depthTest: true,
      depthWrite: false,
      // C++ renders wireframe with glPolygonMode(GL_LINE) on the same geometry,
      // so depth matches exactly. Our LineSegments are separate, so use
      // LessEqualDepth to ensure lines at the same depth as the solid pass through.
      depthFunc: THREE.LessEqualDepth,
    });

    // Pre-compute quad edge indices from undeformed geometry.
    // EdgesGeometry identifies edges where adjacent face normals differ by > threshold.
    // For flat quads split into 2 coplanar triangles, the diagonal is excluded.
    const edgesGeom = new THREE.EdgesGeometry(this.spikeMesh.geometry, 1);
    const edgePositions = edgesGeom.getAttribute('position').array;
    const meshPositions = posAttr.array;

    // Map edge endpoints back to vertex indices in the original mesh
    const edgeCount = edgePositions.length / 6; // 2 vertices per edge, 3 components each
    this.edgeIndices = new Uint32Array(edgeCount * 2);
    for (let e = 0; e < edgeCount; e++) {
      // Find closest vertex in mesh for each edge endpoint
      for (let ep = 0; ep < 2; ep++) {
        const ex = edgePositions[e * 6 + ep * 3];
        const ey = edgePositions[e * 6 + ep * 3 + 1];
        const ez = edgePositions[e * 6 + ep * 3 + 2];
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let vi = 0; vi < posAttr.count; vi++) {
          const dx = meshPositions[vi * 3] - ex;
          const dy = meshPositions[vi * 3 + 1] - ey;
          const dz = meshPositions[vi * 3 + 2] - ez;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestDist) { bestDist = d; bestIdx = vi; }
          if (d < 1e-10) break;
        }
        this.edgeIndices[e * 2 + ep] = bestIdx;
      }
    }

    // Create LineSegments geometry for the wireframe (positions updated per-frame)
    const wirePositions = new Float32Array(edgeCount * 6);
    const wireGeom = new THREE.BufferGeometry();
    wireGeom.setAttribute('position', new THREE.BufferAttribute(wirePositions, 3));
    this.wireSegments = new THREE.LineSegments(wireGeom, this.wireMaterial);
    this.wireSegments.frustumCulled = false;
    this.wireScene = new THREE.Scene();
    this.wireScene.add(this.wireSegments);
    edgesGeom.dispose();

    // Pre-compute distance from origin for each vertex
    this.distances = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.array[i * 3];
      const y = posAttr.array[i * 3 + 1];
      const z = posAttr.array[i * 3 + 2];
      this.distances[i] = Math.sqrt(x * x + y * y + z * z);
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId || !this.spikeMesh || !this.originalPositions) return;

    const posAttr = this.spikeMesh.geometry.getAttribute('position');
    const normalAttr = this.spikeMesh.geometry.getAttribute('normal');
    const origPos = this.originalPositions;
    const origNormals = this.originalNormals;
    const count = posAttr.count;

    // Pre-allocate temp objects for the vertex loop
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const tm = new THREE.Matrix4();
    const normalMat = new THREE.Matrix3();
    const rx = new THREE.Matrix4();
    const ry = new THREE.Matrix4();
    const rz = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
      const dist = this.distances[i];

      // C++: fTimeRot = fEffectTime - (fDistance * m_fElasticity) + 1000
      const fTimeRot = fxTime - (dist * this.elasticity) + 1000;
      const fTimePos = fxTime - (dist * this.elasticity * 0.2) + 1000;

      // Get animation TM at rotation-delayed time
      // C++: m_pObject->transform(fTimeRot, PTA3D_TF_TM)
      if (this.hasAnimation) {
        const animTM = getTransformMatrix(fTimeRot, this.spikeData, this.spikeData.transformMatrix);
        tm.copy(animTM);
      } else {
        tm.copy(this.spikeData.transformMatrix);
      }

      // C++: preRotateX/Y/Z(fTimeRot * 0.06f)
      // PTA preRotate = pre-multiply in row-vector → post-multiply in Three.js
      const angleRad = fTimeRot * 0.06 * DEG_TO_RAD;
      rx.makeRotationX(angleRad);
      ry.makeRotationY(angleRad);
      rz.makeRotationZ(angleRad);
      tm.multiply(rx);
      tm.multiply(ry);
      tm.multiply(rz);

      // Replace position with position from position-delayed TM
      // C++: posTM = getTM(fTimePos); TM.M[0][3] = posTM.M[0][3]; etc.
      if (this.hasAnimation) {
        const posTM = getTransformMatrix(fTimePos, this.spikeData, this.spikeData.transformMatrix);
        tm.elements[12] = posTM.elements[12];
        tm.elements[13] = posTM.elements[13];
        tm.elements[14] = posTM.elements[14];
      }

      // Transform original vertex by the composed TM
      // C++: m_pObject->verts[i] = TM * m_pLocalInitialVerts[i]
      v.set(origPos[i * 3], origPos[i * 3 + 1], origPos[i * 3 + 2]);
      v.applyMatrix4(tm);

      posAttr.array[i * 3] = v.x;
      posAttr.array[i * 3 + 1] = v.y;
      posAttr.array[i * 3 + 2] = v.z;

      // Transform original smooth normals by the rotation part of TM.
      // C++ ComputeNormals(true) = smooth normals (Gouraud). Transforming the
      // original smooth normals by the normal matrix preserves smooth shading.
      if (origNormals && normalAttr) {
        normalMat.getNormalMatrix(tm);
        n.set(origNormals[i * 3], origNormals[i * 3 + 1], origNormals[i * 3 + 2]);
        n.applyMatrix3(normalMat).normalize();
        normalAttr.array[i * 3] = n.x;
        normalAttr.array[i * 3 + 1] = n.y;
        normalAttr.array[i * 3 + 2] = n.z;
      }
    }

    posAttr.needsUpdate = true;
    if (normalAttr) normalAttr.needsUpdate = true;

    // C++: m_pObject->TM.loadIdentity() before render
    // Deformation is baked into vertex positions (world space), so mesh matrix = identity
    this.spikeMesh.matrix.identity();

    // Pass 1: Filled render with sceneTime = -1 (don't update matrices from animation keys)
    dm.sceneManager.renderScene(this.sceneId, -1, 'Camera01', 1.0);

    // Pass 2: Wireframe overlay (quad edges from deformed positions)
    if (this.wireScene && this.edgeIndices) {
      const wirePos = this.wireSegments.geometry.getAttribute('position').array;
      const edgeCount = this.edgeIndices.length / 2;
      for (let e = 0; e < edgeCount; e++) {
        const i0 = this.edgeIndices[e * 2];
        const i1 = this.edgeIndices[e * 2 + 1];
        wirePos[e * 6] = posAttr.array[i0 * 3];
        wirePos[e * 6 + 1] = posAttr.array[i0 * 3 + 1];
        wirePos[e * 6 + 2] = posAttr.array[i0 * 3 + 2];
        wirePos[e * 6 + 3] = posAttr.array[i1 * 3];
        wirePos[e * 6 + 4] = posAttr.array[i1 * 3 + 1];
        wirePos[e * 6 + 5] = posAttr.array[i1 * 3 + 2];
      }
      this.wireSegments.geometry.getAttribute('position').needsUpdate = true;

      // Render with same camera (aspect already set by Pass 1 renderScene)
      const managed = dm.sceneManager.getScene(this.sceneId);
      const camEntry = managed && managed.cameras.get('Camera01');
      if (camEntry) {
        dm.renderer.renderScene(this.wireScene, camEntry.camera);
      }
    }
  }

  close() {
    if (this.wireMaterial) { this.wireMaterial.dispose(); this.wireMaterial = null; }
    if (this.wireSegments) { this.wireSegments.geometry.dispose(); this.wireSegments = null; }
    this.wireScene = null;
    this.edgeIndices = null;
    this.sceneId = null;
    this.spikeMesh = null;
    this.spikeData = null;
    this.originalPositions = null;
    this.distances = null;
  }
}
