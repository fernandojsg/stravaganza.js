import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FX3DObjectMamut - Animated 3D mammoth object with sync-based bounce/rotation.
 *
 * Renders a PTA 3D scene with a mammoth model. The object is animated via
 * 16 music-synced action points, each triggering:
 *   - A brief Z-axis rotation (150ms before to 100ms after the sync point)
 *   - A damped bounce oscillation (400ms starting at the sync point)
 *
 * Rotations are cumulative: each completed rotation persists (whenFinished
 * applies the full -90° every frame). After all 16 syncs, the total rotation
 * is 16 × -90° = -1440° (4 full turns).
 *
 * Actions are processed in priority order: all rotations first, then bounces.
 * The camera is static (from the scene file). No keyframe animation is used.
 *
 * Original: FX3DObjectMamut.cpp (subclass of FX3DObject.cpp)
 */

// 16 absolute demo times (ms) where bounce/rotation triggers
const MAMUT_SYNCS = [
  50548, 51439, 52233, 53123,
  54023, 54888, 55794, 56654,
  57553, 58456, 59282, 60153,
  61046, 61941, 62771, 63628,
];

const ROTATION_DURATION = 250;  // ms
const ROTATION_ANGLE = -90;     // degrees
const ROTATION_PRE = 150;       // ms before sync
const ROTATION_POST = 100;      // ms after sync

const BOUNCE_DURATION = 400;    // ms
const BOUNCE_SIZE = 0.05;
const BOUNCE_DECAY = 0.17;
const BOUNCE_FREQ = 0.03;

export class FX3DObjectMamut extends DemoFX {
  constructor() {
    super();
    this.name = 'FX3DObjectMamut';

    this.objectName = '';
    this.camera = '';
    this.sceneFile = '';
    this.textureDir = '';

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.Matrix4|null} */
    this.initialMatrix = null;
    /** @type {THREE.Mesh|null} */
    this.targetMesh = null;
  }

  setup(name, camera, sceneFile, textureDir) {
    this.objectName = name;
    this.camera = camera;
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
  }

  async loadData(dm) {
    if (!this.sceneFile) return;
    try {
      this.sceneId = `mamut_${Date.now()}`;
      const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);

      // Match PTA bump register-combiner output used by this scene:
      //   diffuse term should be texture * NdotL (no material diffuse attenuation),
      //   with a tighter, softer specular than default MeshPhong.
      const managed = dm.sceneManager.getScene(this.sceneId);
      if (managed) {
        for (const [, entry] of managed.meshes) {
          const mat = entry.mesh.material;
          if (mat.normalMap) {
            mat.color.setRGB(Math.PI, Math.PI, Math.PI);
            mat.emissive.setRGB(0, 0, 0);
            mat.shininess = 16;
            mat.specular.setRGB(0.65, 0.65, 0.65);
          }
        }
      }

      // Find the target mesh and store its initial matrix
      if (managed) {
        const meshEntry = managed.meshes.get(this.objectName);
        if (meshEntry) {
          this.targetMesh = meshEntry.mesh;
          this.initialMatrix = meshEntry.mesh.matrix.clone();
        }
      }
    } catch (err) {
      console.warn(`FX3DObjectMamut: failed to load scene "${this.sceneFile}":`, err.message);
      this.sceneId = null;
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId) return;

    // Build the action matrix from sync-based actions.
    // Actions are processed in priority order matching C++:
    // all rotations (priority 1) first, then all bounces (priority 2).
    // The matrix starts as identity each frame; completed actions
    // re-apply their final state (whenFinished) every frame.
    if (this.targetMesh) {
      const actionMatrix = new THREE.Matrix4();
      const fullAngleRad = ROTATION_ANGLE * (Math.PI / 180);

      // Priority 1: Process all rotations
      for (let i = 0; i < MAMUT_SYNCS.length; i++) {
        const sync = MAMUT_SYNCS[i];
        const rotStart = sync - ROTATION_PRE;
        const rotEnd = sync + ROTATION_POST;

        if (demoTime >= rotStart && demoTime < rotEnd) {
          // Active: partial rotation (doAction)
          const actionTime = demoTime - rotStart;
          const t = actionTime / ROTATION_DURATION;
          const angle = fullAngleRad * t;
          // C++ rotate() calls addTransform = left-multiply: this = rotMatrix * this
          actionMatrix.premultiply(new THREE.Matrix4().makeRotationZ(angle));
        } else if (demoTime >= rotEnd) {
          // Finished: full rotation persists (whenFinished)
          actionMatrix.premultiply(new THREE.Matrix4().makeRotationZ(fullAngleRad));
        }
      }

      // Priority 2: Process all bounces
      for (let i = 0; i < MAMUT_SYNCS.length; i++) {
        const sync = MAMUT_SYNCS[i];
        const bounceEnd = sync + BOUNCE_DURATION;

        if (demoTime >= sync && demoTime < bounceEnd) {
          // Active: damped sine bounce (no whenFinished — decays to 0)
          const actionTime = demoTime - sync;
          const amplitude = (BOUNCE_DURATION - actionTime) * BOUNCE_DECAY;
          const pos = -Math.sin(fxTime * BOUNCE_FREQ) * amplitude * BOUNCE_SIZE;
          // C++ translate() adds to position column = equivalent to left-multiply by T
          actionMatrix.elements[14] += pos; // direct M[2][3] += fPos (same as PTA translate)
        }
      }

      // Apply: TM = actionMatrix * initialMatrix (matches C++ line 172)
      if (this.initialMatrix) {
        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(actionMatrix, this.initialMatrix);
        this.targetMesh.matrix.copy(finalMatrix);
      }
    }

    // Render scene with static camera (sceneTime = -1 skips keyframe animation)
    dm.sceneManager.renderScene(this.sceneId, -1, this.camera, 1.0);
  }

  close() {
    this.sceneId = null;
    this.targetMesh = null;
    this.initialMatrix = null;
  }
}
