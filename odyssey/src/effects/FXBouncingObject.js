import * as THREE from 'three';
import { DemoFX } from '../engine/DemoManager.js';

/**
 * FXBouncingObject - 3D object with beat-synced bounce.
 * Loads a .pta scene, renders a single 3D object with custom transform.
 * 16 bounce instants synchronized to music beats.
 * C++ original: Odyssey/FX3DObject.cpp + FX3DObject.h
 */

const NUM_BOUNCES = 16;
const BOUNCE_DURATION = 400.0;

const BOUNCE_INSTANTS = [
  56311, 57112, 57873, 58694,
  62500, 63301, 64102, 64853,
  68709, 69510, 70401, 71172,
  74847, 75709, 76560, 77301,
];

const DEG2RAD = Math.PI / 180;

// PTA NULL camera: FOV=60° horizontal, aspect=4/3, at origin looking -Z
const PTA_NULL_ASPECT = 4 / 3;
const PTA_NULL_VFOV = 60 / PTA_NULL_ASPECT; // ~45°

export class FXBouncingObject extends DemoFX {
  constructor() {
    super();
    this.name = 'FXBouncingObject';
    this.objectName = null;
    this.cameraName = null;
    this.sceneFile = '';
    this.textureDir = '';
    this.sceneHandle = null;
    this.targetObject = null;
    // Cumulative rotation angles (degrees)
    this.angleX = 0;
    this.angleY = 0;
    this.angleZ = 0;
    // PTA NULL camera (setActiveCamera(NULL))
    this.nullCamera = new THREE.PerspectiveCamera(PTA_NULL_VFOV, PTA_NULL_ASPECT, 1, 1000);
    this.nullCamera.position.set(0, 0, 0);
    this.nullCamera.lookAt(0, 0, -1);
    this.nullCamera.updateProjectionMatrix();
  }

  setup(objectName, cameraName, sceneFile, textureDir) {
    this.objectName = objectName;
    this.cameraName = cameraName;
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
  }

  async loadData(dm) {
    if (!this.sceneFile) return;

    try {
      const sceneId = `bouncing_${this.sceneFile}_${Math.random().toString(36).substr(2, 5)}`;
      const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      dm.sceneManager.buildScene(sceneId, ptaScene, textures);
      this.sceneHandle = sceneId;

      // Get object reference from the managed scene
      const managed = dm.sceneManager.getScene(sceneId);
      if (managed) {
        if (this.objectName && managed.meshes.has(this.objectName)) {
          this.targetObject = managed.meshes.get(this.objectName).mesh;
        } else {
          // First mesh
          const first = managed.meshes.values().next().value;
          if (first) this.targetObject = first.mesh;
        }
      }
    } catch (err) {
      console.warn(`FXBouncingObject: failed to load scene "${this.sceneFile}":`, err.message);
    }
  }

  _updateObj(demoTime) {
    // Build transform matrix matching C++ updateObj:
    //   pMatrix->loadIdentity();
    //   pMatrix->rotateX(angle);  // PTA left-multiply: M = Rx * M
    //   pMatrix->rotateY(angle);  // M = Ry * M
    //   pMatrix->rotateZ(angle);  // M = Rz * M
    //   pMatrix->translate(tx, ty, tz);  // M = T * M
    //   pMatrix->translate(0, fPos, 0);  // M = T2 * M
    //
    // PTA rotateX = left-multiply (M = Rx * M), maps to Three.js premultiply.
    // Result: M = T2 * T1 * Rz * Ry * Rx
    // In column-vector: v' = T2 * T1 * Rz * Ry * Rx * v
    //   = translate(rotZ(rotY(rotX(v))))

    const mat = new THREE.Matrix4();

    // Rotation: demoTime/20 + accumulated angles (degrees → radians)
    const rx = (demoTime / 20.0 + this.angleX) * DEG2RAD;
    const ry = (demoTime / 20.0 + this.angleY) * DEG2RAD;
    const rz = (demoTime / 20.0 + this.angleZ) * DEG2RAD;

    // PTA rotateX/Y/Z = left-multiply → Three.js premultiply
    const rotX = new THREE.Matrix4().makeRotationX(rx);
    const rotY = new THREE.Matrix4().makeRotationY(ry);
    const rotZ = new THREE.Matrix4().makeRotationZ(rz);
    mat.premultiply(rotX);
    mat.premultiply(rotY);
    mat.premultiply(rotZ);
    // mat = Rz * Ry * Rx

    // Translation based on demo time
    // setPosition sets the 4th column directly, equivalent to T * R for pure rotation matrices
    let fMult = 1.0;
    if (demoTime < 65500) {
      mat.setPosition(-190, -120, -600);
    } else {
      mat.setPosition(100, -70, -300);
      fMult = 0.0;
    }

    // Calculate bounce
    let fPos = 0;
    for (let count = 0; count < NUM_BOUNCES; count++) {
      if (BOUNCE_INSTANTS[count] > demoTime && BOUNCE_INSTANTS[count] < demoTime + BOUNCE_DURATION) {
        const amplitude = (BOUNCE_DURATION - (demoTime - BOUNCE_INSTANTS[count])) / 16.0;
        fPos = Math.sin((demoTime - BOUNCE_INSTANTS[count]) / 40.0) * amplitude * fMult;

        if (demoTime > 65500) {
          this.angleX = 174.0 * count;
          this.angleY = 132.0 * count;
          this.angleZ = 67.0 * count;
        }
      }
    }

    // Apply bounce Y offset in world space (left-multiply translation = add to Y translation)
    // PTA: pMatrix->translate(0, fPos, 0) = T(0,fPos,0) * M → adds fPos to world Y
    mat.elements[13] += fPos;

    return mat;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneHandle) return;

    const objMatrix = this._updateObj(demoTime);

    // Set the object's matrix if we have a reference
    if (this.targetObject) {
      this.targetObject.matrix.copy(objMatrix);
      this.targetObject.matrixAutoUpdate = false;
      this.targetObject.matrixWorldNeedsUpdate = true;
    }

    // Render with PTA NULL camera (C++ setActiveCamera(NULL)):
    // sceneTime=-1 skips keyframe animation, overrideCamera uses our NULL camera
    dm.sceneManager.renderScene(this.sceneHandle, -1, null, 1, this.nullCamera);
  }

  close() {
    this.targetObject = null;
    this.sceneHandle = null;
  }
}
