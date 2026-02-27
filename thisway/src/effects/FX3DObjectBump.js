import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FX3DObjectBump - 3D object with bump mapping, rotation actions, and lens flare.
 *
 * Loads a PTA scene and applies 3 simultaneous rotation actions (600° each
 * around X, Y, Z axes) during the effect's active window (64000-71000ms).
 * The object matrix resets to identity each frame; completed actions persist
 * via whenFinished behavior. Final transform: actionMatrix * initialMatrix.
 *
 * Lens flare: parsed from helper userProps in the PTA scene file. Rendered
 * as additive textured quads projected from the helper's world position.
 *
 * Original: FX3DObjectBump.cpp + FX3DObject.cpp (CreateActions)
 */

// Rotation action parameters from C++ CreateActions():
// addAction(new FX3DObjectActionRotation(7000, 600, axis), 64000, 71000, 1)
const ROTATION_DURATION = 7000; // ms
const ROTATION_ANGLE = 600;    // degrees total per axis
const DEG_TO_RAD = Math.PI / 180;

// Camera sync points from C++ fBumpSyncs[14] — absolute demo times.
// Even indices → Camera01, odd indices → Camera02, 600ms duration each.
const BUMP_SYNCS = [
  63754, 64354, 64954, 65435, 65854, 66294, 66737,
  67141, 67572, 68007, 68460, 68913, 69347, 69785,
];

// Lens flare fade speed (C++: alpha += incMs / 150.0)
const FLARE_FADE_SPEED = 1.0 / 150.0;

// Reusable objects for raycasting (avoid per-frame allocation)
const _raycaster = new THREE.Raycaster();
const _rayDir = new THREE.Vector3();

export class FX3DObjectBump extends DemoFX {
  constructor() {
    super();
    this.name = 'FX3DObjectBump';

    this.objectName = '';
    this.camera = '';
    this.sceneFile = '';
    this.textureDir = '';

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.Mesh|null} */
    this.targetMesh = null;
    /** @type {THREE.Matrix4|null} */
    this.initialMatrix = null;

    // Lens flare data (parsed from helper userProps)
    /** @type {Array<{position: number, size: number, texture: THREE.Texture}>} */
    this.flares = [];
    /** @type {THREE.Vector3|null} */
    this.flareSourcePos = null;
    this.flareAlpha = 1.0;
    this.lastFxTime = 0;
  }

  setup(name, camera, sceneFile, textureDir) {
    this.objectName = name;
    this.camera = camera;
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
  }

  async loadData(dm) {
    if (!this.sceneFile) return;
    let ptaScene;
    try {
      this.sceneId = `bump_${Date.now()}`;
      ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);
    } catch (err) {
      console.warn(`FX3DObjectBump: failed to load scene "${this.sceneFile}":`, err.message);
      this.sceneId = null;
      return;
    }

    // PTA bump shader uses NV Register Combiners with a custom equation:
    //   Output = texture * (L·N') + (H·N')^4 * 8 * max(0, L.z)
    // Key: NO material diffuse/specular color in the equation — just texture * NdotL.
    // Three.js MeshPhongMaterial multiplies by matDiffuse (0.588), making it too dim.
    // Override bump-mapped materials to match PTA's register combiner output.
    const managed = dm.sceneManager.getScene(this.sceneId);
    if (managed) {
      for (const [, entry] of managed.meshes) {
        const mat = entry.mesh.material;
        if (mat.normalMap) {
          // Set color to PI so after BRDF_Lambert's 1/PI division, effective diffuse = white.
          // PTA bump equation: texture * NdotL (no matDiffuse multiplication).
          mat.color.setRGB(Math.PI, Math.PI, Math.PI);
          // PTA register combiners have NO ambient term — shadows should be pure black.
          mat.emissive.setRGB(0, 0, 0);
          // PTA specular: (H·N')^4 * 8 * L.z — subtle additive highlight, not broad gloss.
          // Keep specular low to avoid burn-out; shininess higher for tighter highlights.
          mat.shininess = 16;
          mat.specular.setRGB(0.65, 0.65, 0.65);
        }
      }
    }

    // Parse lens flare from helper userProps
    if (ptaScene && ptaScene.helpers) {
      for (const helper of ptaScene.helpers) {
        if (!helper.userProps || !helper.userProps.toLowerCase().includes('lensflare')) continue;

        // Extract flare source position from helper matrix
        const pos = new THREE.Vector3();
        helper.transformMatrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
        this.flareSourcePos = pos;

        // Parse userProps text: numflares, texturefile, position, size
        const props = helper.userProps;
        const numMatch = props.match(/numflares\s*=\s*(\d+)/i);
        const numFlares = numMatch ? parseInt(numMatch[1]) : 0;

        // Extract all texture/position/size entries
        const texMatches = [...props.matchAll(/texturefile\s*=\s*"([^"]+)"/gi)];
        const posMatches = [...props.matchAll(/position\s*=\s*([\d.]+)/gi)];
        const sizeMatches = [...props.matchAll(/size\s*=\s*([\d.]+)/gi)];

        for (let i = 0; i < numFlares; i++) {
          const texPath = texMatches[i] ? texMatches[i][1].replace(/\\/g, '/') : null;
          const fPos = posMatches[i] ? parseFloat(posMatches[i][1]) : 0;
          const fSize = sizeMatches[i] ? parseFloat(sizeMatches[i][1]) : 1.0;

          if (texPath) {
            try {
              const tex = await dm.assetManager.loadTextureByPath(texPath);
              this.flares.push({ position: fPos, size: fSize, texture: tex });
            } catch (err) {
              console.warn(`FX3DObjectBump: failed to load flare texture "${texPath}":`, err.message);
            }
          }
        }
        break; // Only process the first helper with lensflare
      }
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId) return;

    // Find target mesh on first frame
    if (!this.targetMesh && this.objectName) {
      const managed = dm.sceneManager.getScene(this.sceneId);
      if (managed) {
        const entry = managed.meshes.get(this.objectName);
        if (entry) {
          this.targetMesh = entry.mesh;
          this.initialMatrix = entry.mesh.matrix.clone();
        }
      }
    }

    if (this.targetMesh) {
      // C++ FX3DObject::doFrame: m_objMatrix.loadIdentity() each frame
      const actionMatrix = new THREE.Matrix4();

      // 3 simultaneous rotations: 600° around X, Y, Z over 7000ms
      const t = Math.min(fxTime / ROTATION_DURATION, 1.0);
      const angle = ROTATION_ANGLE * t * DEG_TO_RAD;

      // C++ rotate() = left-multiply: this = rotMatrix * this
      actionMatrix.premultiply(new THREE.Matrix4().makeRotationX(angle));
      actionMatrix.premultiply(new THREE.Matrix4().makeRotationY(angle));
      actionMatrix.premultiply(new THREE.Matrix4().makeRotationZ(angle));

      // C++: m_pObject->TM = m_objMatrix * m_objInitialMatrix
      const finalMatrix = new THREE.Matrix4();
      finalMatrix.multiplyMatrices(actionMatrix, this.initialMatrix);
      this.targetMesh.matrix.copy(finalMatrix);
    }

    // C++ camera change: alternate Camera01/Camera02 at sync points
    let activeCamera = this.camera;
    for (let i = BUMP_SYNCS.length - 1; i >= 0; i--) {
      if (demoTime >= BUMP_SYNCS[i]) {
        activeCamera = (i % 2 === 0) ? 'Camera01' : 'Camera02';
        break;
      }
    }

    // Render scene (time=-1: skip keyframe animation, FX manages matrices)
    dm.sceneManager.renderScene(this.sceneId, -1, activeCamera, 1.0);

    // Render lens flares (C++: post-render, always on top, additive blend)
    this._renderFlares(fxTime, activeCamera, dm);

    this.lastFxTime = fxTime;
  }

  _renderFlares(fxTime, cameraName, dm) {
    if (this.flares.length === 0 || !this.flareSourcePos) return;

    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    const camEntry = managed.cameras.get(cameraName);
    if (!camEntry) return;

    const camera = camEntry.camera;

    // Project flare source position to screen space (0-1 normalized)
    const projected = this.flareSourcePos.clone().project(camera);

    // projected.x and projected.y are in NDC [-1, 1]
    // Convert to PTA viewport coords (0-1, y=0=top)
    const screenX = (projected.x + 1) * 0.5;
    const screenY = 1 - (projected.y + 1) * 0.5; // Flip Y for PTA convention

    // Check if flare is behind camera (projected.z > 1)
    const isInFront = projected.z >= -1 && projected.z <= 1;
    const isOnScreen = screenX >= 0 && screenX <= 1 && screenY >= 0 && screenY <= 1;

    // C++ occlusion: after scene render, read Z-buffer at projected position.
    // If mesh depth < flare depth → occluded. Three.js equivalent: raycast.
    let isOccluded = false;
    if (isInFront && isOnScreen && this.targetMesh) {
      // Ray from camera toward flare source
      const camPos = camera.getWorldPosition(new THREE.Vector3());
      _rayDir.copy(this.flareSourcePos).sub(camPos).normalize();
      _raycaster.set(camPos, _rayDir);

      // Distance from camera to flare source
      const flareDist = camPos.distanceTo(this.flareSourcePos);

      // Test intersection against the target mesh
      const intersects = _raycaster.intersectObject(this.targetMesh, false);
      if (intersects.length > 0 && intersects[0].distance < flareDist) {
        isOccluded = true;
      }
    }

    // Update flare alpha (C++: fade in/out over 150ms)
    const incMs = Math.max(0, fxTime - this.lastFxTime);
    if (isInFront && isOnScreen && !isOccluded) {
      this.flareAlpha = Math.min(1.0, this.flareAlpha + incMs * FLARE_FADE_SPEED);
    } else {
      this.flareAlpha = Math.max(0.0, this.flareAlpha - incMs * FLARE_FADE_SPEED);
    }
    this.flareAlpha = Math.max(0.0, Math.min(1.0, this.flareAlpha));

    if (this.flareAlpha <= 0.001) return;

    // C++ size pulsing: sizeMultiplier = 0.75 + (alpha / 4.0)
    const sizeMultiplier = 0.75 + (this.flareAlpha / 4.0);

    // Screen center (PTA coords)
    const centerX = 0.5;
    const centerY = 0.5;

    // Ray from flare position to screen center
    const rayX = (centerX - screenX) * 2.0;
    const rayY = (centerY - screenY) * 2.0;

    for (const flare of this.flares) {
      // Position along the ray trajectory
      const flareX = screenX + rayX * flare.position;
      const flareY = screenY + rayY * flare.position;

      // C++ size with 4:3 aspect ratio: width = size, height = size * 1.33
      const w = flare.size * sizeMultiplier;
      const h = w * 1.33;

      // Draw flare quad (additive blending, no depth test)
      dm.renderer.drawTexturedQuad(
        flare.texture,
        flareX, flareY,
        w, h,
        0,
        this.flareAlpha,
        4, // SRCALPHA
        1  // ONE (additive)
      );
    }
  }

  close() {
    this.sceneId = null;
    this.targetMesh = null;
    this.initialMatrix = null;
    this.flares = [];
    this.flareSourcePos = null;
  }
}
