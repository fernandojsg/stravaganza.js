import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * MSVC-compatible srand/rand for exact seed compatibility with C++ code.
 * MSVC's rand() uses: state = state * 214013 + 2531011; return (state >> 16) & 0x7FFF
 */
function msvcSrand(seed) {
  let state = seed >>> 0;
  return function rand() {
    state = ((state * 214013) + 2531011) & 0xFFFFFFFF;
    return (state >>> 16) & 0x7FFF;
  };
}

/**
 * 21 arrow sync points — absolute demo time (ms).
 * From FXEuskalArrows.cpp: pfArrowSynchs[] with 200ms offset.
 */
const SYNC_OFFSET = 200;
const ARROW_SYNC_TIMES = [
  5451 - SYNC_OFFSET,   // 0:  5251
  5893 - SYNC_OFFSET,   // 1:  5693
  6127 - SYNC_OFFSET,   // 2:  5927
  6319 - SYNC_OFFSET,   // 3:  6119
  6876 - SYNC_OFFSET,   // 4:  6676
  7131 - SYNC_OFFSET,   // 5:  6931
  7957 - SYNC_OFFSET,   // 6:  7757
  8307 - SYNC_OFFSET,   // 7:  8107
  8779 - SYNC_OFFSET,   // 8:  8579
  9126 - SYNC_OFFSET,   // 9:  8926
  9712 - SYNC_OFFSET,   // 10: 9512
  10094 - SYNC_OFFSET,  // 11: 9894
  10659 - SYNC_OFFSET,  // 12: 10459
  11399 - SYNC_OFFSET,  // 13: 11199
  11636 - SYNC_OFFSET,  // 14: 11436
  12138 - SYNC_OFFSET,  // 15: 11938
  12417 - SYNC_OFFSET,  // 16: 12217
  12910 - SYNC_OFFSET,  // 17: 12710
  13222 - SYNC_OFFSET,  // 18: 13022
  13571 - SYNC_OFFSET,  // 19: 13371
  13973,                 // 20: 13973 (no offset)
];
const NUM_SYNCHS = ARROW_SYNC_TIMES.length;
const ARROW_MOV_DURATION = 300; // ms — rotation decay duration

/**
 * FXEuskalArrows - 3D animated arrow scene with music-synced rotation.
 *
 * Loads a PTA 3D scene containing ~1000 arrow quads. Each arrow is randomly
 * assigned to one of 21 sync points. At each sync beat, arrows snap from
 * random rotations to their default orientation over 300ms.
 *
 * Dual-pass rendering matching C++ original:
 * 1. Filled pass: all objects except grid → solid rendering
 * 2. Wireframe pass: only grid → wireframe overlay with line thickness 0.7
 *
 * Original: FXEuskalArrows.cpp
 */
export class FXEuskalArrows extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEuskalArrows';

    this.sceneFile = '';
    this.textureDir = '';
    this.camera = '';
    this.sceneTime = 0;
    this.playSpeed = 1.0;
    this.indexStart = 0;
    this.arrowMovSpeed = 1.0;

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {Array<ArrowData>} */
    this.arrowData = [];

    // Grid wireframe overlay (C++ Pass 2)
    /** @type {THREE.Mesh|null} */
    this.gridMesh = null;
    /** @type {THREE.Material|null} */
    this.gridOrigMaterial = null;
    /** @type {THREE.MeshBasicMaterial|null} */
    this.wireMaterial = null;
  }

  /**
   * @param {string} sceneFile - Path to PTA scene file
   * @param {string} textureDir - Texture directory
   * @param {string} camera - Camera name
   * @param {number} fStart - Start time offset (unused in C++)
   * @param {number} fSpeed - Camera animation speed multiplier
   * @param {number} nIndexStart - Starting arrow sync index
   * @param {number} fArrowMovSpeed - Arrow movement speed (unused in C++)
   */
  setup(sceneFile, textureDir, camera, fStart, fSpeed, nIndexStart, fArrowMovSpeed) {
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
    this.camera = camera;
    this.sceneTime = fStart;
    this.playSpeed = fSpeed;
    this.indexStart = nIndexStart;
    this.arrowMovSpeed = fArrowMovSpeed;
  }

  async loadData(dm) {
    if (!this.sceneFile) return;
    try {
      this.sceneId = `arrows_${this.camera}_${Date.now()}`;
      const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      const managed = dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);

      // Arrows scene has 0 lights → MeshBasicMaterial (unlit).
      // SceneManager's unlit path applies gamma+PI correction for general scenes,
      // but the arrows need raw diffuse values to match C++ output exactly.
      // Override: set each mesh's material color to its PTA material's raw diffuse.
      for (const obj of ptaScene.objects) {
        if (obj.materialId >= 0 && obj.materialId < ptaScene.materials.length) {
          const matData = ptaScene.materials[obj.materialId];
          const entry = managed.meshes.get(obj.name);
          if (entry && entry.mesh.material && entry.mesh.material.isMeshBasicMaterial) {
            entry.mesh.material.color.setRGB(matData.diffuse.r, matData.diffuse.g, matData.diffuse.b);
          }
        }
      }

      // Initialize arrow data with MSVC-compatible random sequence (seed 3223)
      const rand = msvcSrand(3223);
      const RAND_MAX = 32767;

      // Get meshes in scene-object order (SceneManager adds them in order, skipping empties)
      const sceneMeshes = managed.threeScene.children.filter(c => c.isMesh);
      let meshIdx = 0;

      this.arrowData = [];
      for (let i = 0; i < ptaScene.objects.length; i++) {
        const obj = ptaScene.objects[i];
        const jarl = rand() % 50;

        const arrow = {
          index: 10000, // 10000 = not an arrow
          xAngle: 0, yAngle: 0, zAngle: 0,
          initXAngle: 0, initYAngle: 0, initZAngle: 0,
          mesh: null,
          initialMatrix: null,
        };

        // Objects starting with 'P' that pass the random check become arrows
        if (jarl < NUM_SYNCHS && obj.name && obj.name[0] === 'P') {
          arrow.index = jarl;
          // Random initial rotation angles [-90, +90] degrees per axis
          arrow.initXAngle = ((rand() / RAND_MAX) * 180) - 90;
          arrow.initYAngle = ((rand() / RAND_MAX) * 180) - 90;
          arrow.initZAngle = ((rand() / RAND_MAX) * 180) - 90;
          arrow.xAngle = arrow.initXAngle;
          arrow.yAngle = arrow.initYAngle;
          arrow.zAngle = arrow.initZAngle;
        }

        // Map to Three.js mesh (if object has geometry)
        if (obj.numVertices > 0 && obj.numFaces > 0 && meshIdx < sceneMeshes.length) {
          arrow.mesh = sceneMeshes[meshIdx];
          arrow.initialMatrix = obj.transformMatrix.clone();
          meshIdx++;
        }

        this.arrowData.push(arrow);
      }

      // Find grid object from managed scene's meshes map
      for (const [name, { mesh }] of managed.meshes) {
        if (name.toLowerCase() === 'grid') {
          this.gridMesh = mesh;
          this.gridOrigMaterial = mesh.material;
          mesh.visible = false; // Hidden during Pass 1 (filled)
          break;
        }
      }

      // Wireframe material for Pass 2 (C++: PTA3D_POLYMODE_WIREFRAME, lineThickness 0.7)
      // C++ renders wireframe with the scene's original material (texture + lighting)
      // We clone the grid's material and enable wireframe to match
      if (this.gridMesh && this.gridMesh.material) {
        this.wireMaterial = this.gridMesh.material.clone();
        this.wireMaterial.wireframe = true;
        this.wireMaterial.depthWrite = false;
      } else {
        this.wireMaterial = new THREE.MeshBasicMaterial({
          wireframe: true,
          depthTest: true,
          depthWrite: false,
        });
      }
    } catch (err) {
      console.warn(`FXEuskalArrows: failed to load scene "${this.sceneFile}":`, err.message);
      this.sceneId = null;
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId) return;
    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    // 1. Update arrow sync animations
    // Check each sync point and update matching arrows' rotation angles
    for (let s = 0; s < NUM_SYNCHS; s++) {
      const syncTime = ARROW_SYNC_TIMES[s];

      for (const arrow of this.arrowData) {
        if (arrow.index !== s) continue;

        if (demoTime >= syncTime && demoTime <= syncTime + ARROW_MOV_DURATION) {
          // Active sync window: decay rotation from initial to 0 over 300ms
          const fDecDegrees = ((demoTime - syncTime) / ARROW_MOV_DURATION) * 90;
          arrow.xAngle = Math.max(0, arrow.initXAngle - fDecDegrees);
          arrow.yAngle = Math.max(0, arrow.initYAngle - fDecDegrees);
          arrow.zAngle = Math.max(0, arrow.initZAngle - fDecDegrees);
        } else if (demoTime > syncTime + ARROW_MOV_DURATION) {
          // Past sync window: fully snapped to 0
          arrow.xAngle = 0;
          arrow.yAngle = 0;
          arrow.zAngle = 0;
        }
      }
    }

    // 2. Apply rotations to arrow meshes
    // C++ uses preRotateX for all 3 angles (intentional — all rotate around X axis)
    // In PTA row-major: TM = Rx * initialWorldAxes
    // In Three.js column-major: mesh.matrix = initialMatrix * Rx
    const tempMat = new THREE.Matrix4();
    for (const arrow of this.arrowData) {
      if (!arrow.mesh || arrow.index >= NUM_SYNCHS || !arrow.initialMatrix) continue;

      const totalAngleDeg = arrow.xAngle + arrow.yAngle + arrow.zAngle;
      const totalAngleRad = totalAngleDeg * (Math.PI / 180);
      arrow.mesh.matrixAutoUpdate = false;
      arrow.mesh.matrix.copy(arrow.initialMatrix);
      tempMat.makeRotationX(totalAngleRad);
      arrow.mesh.matrix.multiply(tempMat);
    }

    // 3. Update camera animation
    const camEntry = managed.cameras.get(this.camera);
    if (!camEntry) return;

    dm.sceneManager._updateCamera(camEntry.camera, camEntry.data, fxTime * this.playSpeed);

    if (camEntry.camera.isPerspectiveCamera) {
      const vp = dm.renderer.currentViewport;
      camEntry.camera.aspect = vp.w / vp.h || (800 / 600);
      camEntry.camera.updateProjectionMatrix();
    }

    // 4. Pass 1: Filled rendering (grid hidden, arrows visible)
    dm.renderer.renderScene(managed.threeScene, camEntry.camera);

    // 5. Pass 2: Wireframe rendering (grid visible, arrows hidden)
    // C++: toggle all visibility, render in PTA3D_POLYMODE_WIREFRAME, restore
    if (this.gridMesh && this.wireMaterial) {
      // Hide all arrow meshes
      for (const arrow of this.arrowData) {
        if (arrow.mesh) arrow.mesh.visible = false;
      }

      // Show grid with wireframe material
      this.gridMesh.visible = true;
      this.gridMesh.material = this.wireMaterial;

      dm.renderer.renderScene(managed.threeScene, camEntry.camera);

      // Restore: show arrows, hide grid, restore grid material
      this.gridMesh.material = this.gridOrigMaterial;
      for (const arrow of this.arrowData) {
        if (arrow.mesh) arrow.mesh.visible = true;
      }
      // Grid must stay hidden for Pass 1 (even if it was in arrowData)
      this.gridMesh.visible = false;
    }
  }

  close() {
    this.sceneId = null;
    this.arrowData = [];
    this.gridMesh = null;
    this.gridOrigMaterial = null;
    if (this.wireMaterial) { this.wireMaterial.dispose(); this.wireMaterial = null; }
  }
}
