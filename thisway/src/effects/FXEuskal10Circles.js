import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';
import { getTransformMatrix } from '../engine/AnimationSystem.js';

/**
 * FXEuskal10Circles - 3D circles scene with per-object Z rotation and sync pulses.
 *
 * Loads a PTA scene with circle/ring objects (named a-f) and renders them
 * over a background texture. Each circle rotates continuously around Z.
 * Music sync points trigger rotation speed pulses with cosine envelopes.
 *
 * Two-pass rendering matching C++ original:
 * 1. Filled pass: scene textures modulated by pale blue glColor (GL_MODULATE)
 *    → setColor(0.655, 0.62, 0.7411), renderScene with URSF_COLORS disabled
 * 2. Wireframe pass: black quad edges (not triangle diagonals)
 *    → setColor(0, 0, 0), PTA3D_POLYMODE_WIREFRAME, original used GL_QUADS
 *
 * Original: FXEuskal10Circles.cpp
 */

const DEG_TO_RAD = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const TWO_OVER_PI = 2 / Math.PI;

// C++ pcCircleSpeeds[NUMCIRCLESYNCHS] — used for BOTH base rotation (indexed by
// name[0]-'a') AND sync rotation (indexed by sync number).
const CIRCLE_SPEEDS = [
  1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -3.0, -1.0,
  1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0,
];

// Sync point times (absolute demo times in ms)
const SYNC_TIMES = [
  108457, 109334, 110134, 111049, 111874, 112838, 113603, 114540,
  115343, 116270, 117120, 117999, 118888, 119704, 120701, 121599,
];
const NUM_SYNCS = SYNC_TIMES.length;
const SYNC_DURATION = 600; // ms

// Which circle letter each sync targets (C++ pcWhichCircle)
const SYNC_TARGETS = [
  'd', 'a', 'b', 'c', 'd', 'e', 'f', 'a',
  'b', 'c', 'd', 'e', 'f', 'a', 'b', 'c',
];

// Radial syncs for astomp object (C++ fRadialSynchs)
const ASTOMP_SYNCS = [109184, 110899, 112688, 114390, 116120, 117849, 119554, 121450];
const ASTOMP_DURATION = 500; // ms

// C++ glColor for filled pass — modulates textures via GL_MODULATE.
// Values are sRGB (C++ glColor goes directly to framebuffer, no gamma correction).
const FILL_TINT = new THREE.Color(0.655, 0.62, 0.7411);

export class FXEuskal10Circles extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEuskal10Circles';

    this.sceneFile = '';
    this.textureDir = '';
    this.camera = '';
    this.sceneTime = 0;
    this.playSpeed = 1.0;
    this.bgTexturePath = '';

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.Texture|null} */
    this.bgTexture = null;

    /** @type {Array<{mesh: THREE.Mesh, initialMatrix: THREE.Matrix4, speedIndex: number, letter: string}>} */
    this.meshEntries = [];
    /** @type {{mesh: THREE.Mesh, data: object, initialMatrix: THREE.Matrix4}|null} */
    this.astompEntry = null;

    // Wireframe: EdgesGeometry LineSegments per mesh (quad edges only, no triangle diagonals)
    /** @type {THREE.Scene|null} */
    this.wireScene = null;
    /** @type {Array<{wire: THREE.LineSegments, mesh: THREE.Mesh}>} */
    this.wireObjects = [];
    /** @type {THREE.LineBasicMaterial|null} */
    this.wireMaterial = null;

    // Per-material original colors (saved/restored during tint pass)
    /** @type {Map<THREE.Material, THREE.Color>} */
    this.origColors = new Map();

    this.initialized = false;
  }

  /**
   * @param {string} sceneFile
   * @param {string} textureDir
   * @param {string} camera
   * @param {number} sceneTime
   * @param {number} playSpeed
   * @param {string} bgTexturePath
   */
  setup(sceneFile, textureDir, camera, sceneTime, playSpeed, bgTexturePath) {
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
    this.camera = camera;
    this.sceneTime = sceneTime;
    this.playSpeed = playSpeed;
    this.bgTexturePath = bgTexturePath;
  }

  async loadData(dm) {
    if (this.bgTexturePath) {
      try {
        this.bgTexture = await dm.assetManager.loadTextureByPath(this.bgTexturePath);
      } catch (err) {
        console.warn(`FXEuskal10Circles: failed to load bg "${this.bgTexturePath}":`, err.message);
      }
    }

    if (this.sceneFile) {
      try {
        this.sceneId = `circles_${Date.now()}`;
        const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
        const textures = this.textureDir
          ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
          : new Map();
        dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);
      } catch (err) {
        console.warn(`FXEuskal10Circles: failed to load scene "${this.sceneFile}":`, err.message);
        this.sceneId = null;
      }
    }

    // Black wireframe material for EdgesGeometry LineSegments
    this.wireMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
    });
  }

  /** Gather mesh references, initial matrices, and build edge wireframes. */
  _initMeshes(managed) {
    this.wireScene = new THREE.Scene();

    for (const [name, { mesh, data }] of managed.meshes) {
      const letter = name.charAt(0).toLowerCase();
      const speedIndex = letter.charCodeAt(0) - 97; // 'a' = 97

      this.meshEntries.push({
        mesh,
        initialMatrix: mesh.matrix.clone(),
        speedIndex,
        letter,
      });

      if (name.toLowerCase().startsWith('astomp')) {
        this.astompEntry = { mesh, data, initialMatrix: mesh.matrix.clone() };
      }

      // Save original material color for tint/restore
      if (mesh.material && !this.origColors.has(mesh.material)) {
        this.origColors.set(mesh.material, mesh.material.color.clone());
      }

      // Build EdgesGeometry for quad-style wireframe (excludes coplanar triangle diagonals)
      // Threshold of 1° means only edges where adjacent faces form > 1° angle are drawn.
      // For flat quads split into 2 coplanar triangles, the diagonal is excluded.
      const edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 1);
      const wireObj = new THREE.LineSegments(edgesGeom, this.wireMaterial);
      wireObj.matrixAutoUpdate = false;
      wireObj.matrix.copy(mesh.matrix);
      this.wireScene.add(wireObj);
      this.wireObjects.push({ wire: wireObj, mesh });
    }
  }

  doFrame(fxTime, demoTime, dm) {
    // C++: background quad centered at (0.5, 0.5), size 1.28 x 1.21
    if (this.bgTexture) {
      dm.renderer.drawTexturedQuad(this.bgTexture, 0.5, 0.5, 1.28, 1.21, 0, 1.0);
    }

    if (!this.sceneId) return;
    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    if (!this.initialized) {
      this._initMeshes(managed);
      this.initialized = true;
    }

    // --- Update all mesh rotations ---
    for (const entry of this.meshEntries) {
      // C++: preRotateZ(pcCircleSpeeds[name[0]-'a'] * fIncMilisec * 0.01)
      // Cumulative: total angle = speed * fxTime * 0.01 degrees
      const speed = (entry.speedIndex >= 0 && entry.speedIndex < CIRCLE_SPEEDS.length)
        ? CIRCLE_SPEEDS[entry.speedIndex] : 0;
      const baseAngle = speed * fxTime * 0.01; // degrees

      // Accumulate sync pulse contributions for this mesh's letter.
      // C++ sync: preRotateZ(pcCircleSpeeds[nCount] * deltaMs * cos(progress * PI/2) * 0.3)
      // Analytical integral: speed * 0.3 * DURATION * (2/PI) * sin(progress * PI/2)
      let syncAngle = 0;
      for (let s = 0; s < NUM_SYNCS; s++) {
        if (SYNC_TARGETS[s] !== entry.letter) continue;

        const elapsed = demoTime - SYNC_TIMES[s];
        if (elapsed >= SYNC_DURATION) {
          syncAngle += CIRCLE_SPEEDS[s] * 0.3 * SYNC_DURATION * TWO_OVER_PI;
        } else if (elapsed > 0) {
          const progress = elapsed / SYNC_DURATION;
          syncAngle += CIRCLE_SPEEDS[s] * 0.3 * SYNC_DURATION * TWO_OVER_PI * Math.sin(progress * HALF_PI);
        }
      }

      const totalAngle = (baseAngle + syncAngle) * DEG_TO_RAD;

      // PTA preRotateZ (row-major pre-multiply) = Three.js matrix.multiply(Rz)
      const finalMatrix = entry.initialMatrix.clone();
      finalMatrix.multiply(new THREE.Matrix4().makeRotationZ(totalAngle));
      entry.mesh.matrix.copy(finalMatrix);
    }

    // --- Astomp: keyframe animation overrides rotation ---
    if (this.astompEntry) {
      let animTime = 0;
      for (const syncTime of ASTOMP_SYNCS) {
        const elapsed = demoTime - syncTime;
        if (elapsed >= 0 && elapsed < ASTOMP_DURATION) {
          animTime = elapsed;
          break;
        }
      }
      const matrix = getTransformMatrix(animTime, this.astompEntry.data, this.astompEntry.initialMatrix);
      this.astompEntry.mesh.matrix.copy(matrix);
    }

    // --- Animate camera at fxTime * playSpeed ---
    const camTime = fxTime * this.playSpeed;
    const camEntry = managed.cameras.get(this.camera);
    if (camEntry) {
      dm.sceneManager._updateCamera(camEntry.camera, camEntry.data, camTime);
    }

    // === PASS 1: Filled with texture modulated by pale blue tint ===
    // C++: setColor(0.655, 0.62, 0.7411), renderScene(-1, flags - URSF_COLORS)
    // In OpenGL GL_MODULATE: output = texture × glColor. Three.js equivalent: material.color tints the texture map.
    for (const [mat, origColor] of this.origColors) {
      mat.color.copy(FILL_TINT);
    }
    dm.sceneManager.renderScene(this.sceneId, -1, this.camera, 1.0);

    // Restore original material colors
    for (const [mat, origColor] of this.origColors) {
      mat.color.copy(origColor);
    }

    // === PASS 2: Black wireframe overlay (quad edges only) ===
    // C++: setColor(0, 0, 0), PTA3D_POLYMODE_WIREFRAME, renderScene(-1, ...)
    // Using EdgesGeometry to get quad edges without triangle diagonals.
    // Sync wireframe matrices with mesh matrices.
    for (const { wire, mesh } of this.wireObjects) {
      wire.matrix.copy(mesh.matrix);
    }

    // Render wireframe scene with the same camera
    // Camera aspect was already set to PTA_ASPECT (2.0) by renderScene() in pass 1.
    // Do NOT override it here — mismatched aspect causes wireframe offset.
    if (camEntry) {
      dm.renderer.renderScene(this.wireScene, camEntry.camera);
    }
  }

  close() {
    this.sceneId = null;
    this.bgTexture = null;
    this.meshEntries = [];
    this.astompEntry = null;
    this.wireObjects = [];
    this.wireScene = null;
    this.origColors.clear();
    this.initialized = false;
    if (this.wireMaterial) { this.wireMaterial.dispose(); this.wireMaterial = null; }
  }
}
