import { DemoFX } from '../engine/DemoManager.js';
import { BlendMode } from '../engine/Renderer.js';
import * as THREE from 'three';

/**
 * FXMapScreenToObject - Maps the current framebuffer onto a 3D object.
 *
 * Captures the current rendered framebuffer as a texture and applies it
 * to a specific mesh in a 3D scene. This creates the effect of the demo
 * content being displayed on a 3D surface (e.g., a TV screen).
 *
 * C++ flow:
 * 1. copyFBufferToTexture → captures current screen to m_pTexture
 * 2. clearImageAndZBuffer
 * 3. Set demo viewport
 * 4. Render scene (m_pTexture is already bound to the target object)
 *
 * Original: FXMapScreenToObject.cpp
 */
export class FXMapScreenToObject extends DemoFX {
  constructor() {
    super();
    this.name = 'FXMapScreenToObject';

    this.sceneFile = '';
    this.objectName = '';
    this.camera = '';
    this.textureDir = '';
    this.playSpeed = 1.0;

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.FramebufferTexture|null} */
    this.screenTexture = null;
    /** @type {Array<{mesh: THREE.Mesh, originalMaterial: THREE.Material}>} */
    this.targetMeshes = [];
  }

  /**
   * @param {string} sceneFile - Path to the PTA scene file
   * @param {string} objectName - Name of the mesh to map the screen onto
   * @param {string} camera - Camera name
   * @param {string} textureDir - Texture directory
   * @param {number} playSpeed - Camera animation speed
   */
  setup(sceneFile, objectName, camera, textureDir, playSpeed) {
    this.sceneFile = sceneFile;
    this.objectName = objectName;
    this.camera = camera;
    this.textureDir = textureDir;
    this.playSpeed = playSpeed;
  }

  async loadData(dm) {
    if (!this.sceneFile) return;
    try {
      this.sceneId = `mapScreen_${Date.now()}`;
      const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      const managed = dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);

      // C++ PTA renders this scene with lighting DISABLED.
      // Output = tex1 * tex2 (GL_MODULATE multitexture). Use MeshBasicMaterial
      // with white color so textures display at full brightness.
      // Lightmaps (tex2) use onBeforeCompile for multiplicative RGB blending.
      managed.threeScene.traverse((child) => {
        if (child.isMesh && child.material) {
          const oldMat = child.material;
          const basicParams = {
            color: 0xffffff,
            side: THREE.DoubleSide,
          };
          if (oldMat.map) basicParams.map = oldMat.map;
          if (oldMat.transparent) {
            basicParams.transparent = true;
            basicParams.opacity = oldMat.opacity;
          }
          // Carry lightmap (stored as aoMap) for multiplicative blending
          if (oldMat.aoMap) {
            basicParams.aoMap = oldMat.aoMap;
            basicParams.aoMapIntensity = 1.0;
          }
          const newMat = new THREE.MeshBasicMaterial(basicParams);
          // Override aoMap to do full RGB multiply (default only uses red channel)
          if (oldMat.aoMap) {
            newMat.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <aomap_fragment>',
                /* glsl */ `
                #ifdef USE_AOMAP
                  vec3 aoTex = texture2D( aoMap, vAoMapUv ).rgb;
                  reflectedLight.indirectDiffuse *= aoTex;
                #endif
                `
              );
            };
          }
          child.material = newMat;
        }
      });

      // Remove lights from the scene
      const lightsToRemove = [];
      managed.threeScene.traverse((child) => {
        if (child.isLight) lightsToRemove.push(child);
      });
      for (const light of lightsToRemove) {
        light.parent.remove(light);
      }

      // Create framebuffer capture texture (512x512 to match ViewportInt, scaled by dpr)
      const dpr = window.devicePixelRatio || 1;
      this.screenTexture = new THREE.FramebufferTexture(512 * dpr, 512 * dpr);
      this.screenTexture.minFilter = THREE.LinearFilter;
      this.screenTexture.magFilter = THREE.LinearFilter;
      // Framebuffer origin is bottom-left but mesh UVs expect top-down.
      // FramebufferTexture ignores flipY, so flip V via repeat/offset.
      this.screenTexture.repeat.set(1, -1);
      this.screenTexture.offset.set(0, 1);
      this.screenTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.screenTexture.wrapT = THREE.ClampToEdgeWrapping;

      // Find the target mesh by name and get its original texture.
      // In C++, copyFBufferToTexture writes to the texture IN PLACE — all objects
      // sharing that texture see the update (e.g., mirrored geometry for reflections).
      // Replicate by finding ALL meshes that share the same texture as the target.
      let targetTexture = null;
      managed.threeScene.traverse((child) => {
        if (child.isMesh && child.name === this.objectName) {
          targetTexture = child.material && child.material.map;
        }
      });

      managed.threeScene.traverse((child) => {
        if (!child.isMesh) return;
        const mat = child.material;
        // Match by name OR by sharing the same texture as the target object
        if (child.name === this.objectName ||
            (targetTexture && mat && mat.map === targetTexture)) {
          // Create per-mesh screen material preserving the original's side setting.
          // The reflection mesh is mirrored geometry with reversed winding,
          // so it needs the original side (FrontSide/BackSide/DoubleSide).
          const screenMat = new THREE.MeshBasicMaterial({
            map: this.screenTexture,
            side: mat.side,
          });
          this.targetMeshes.push({ mesh: child, originalMaterial: mat });
          child.material = screenMat;
        }
      });

      if (this.targetMeshes.length === 0) {
        console.warn(`FXMapScreenToObject: object "${this.objectName}" not found in scene`);
      }
    } catch (err) {
      console.warn(`FXMapScreenToObject: failed to load scene "${this.sceneFile}":`, err.message);
      this.sceneId = null;
    }
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId) return;

    const renderer = dm.renderer;
    const gl = renderer.webglRenderer;

    // Step 1: Capture current framebuffer to screen texture
    // This captures whatever previous effects have rendered (TV static, credits, etc.)
    gl.copyFramebufferToTexture(this.screenTexture);

    // Step 2: Clear entire framebuffer (C++ clearImageAndZBuffer)
    renderer.resetViewport();
    renderer.clear(0x000000);

    // Step 3: Set demo viewport and render 3D scene
    renderer.setDemoViewport();

    const sceneTime = fxTime * this.playSpeed;
    dm.sceneManager.renderScene(this.sceneId, sceneTime, this.camera, 1.0);
  }

  close() {
    // Restore original materials; dispose per-mesh screen materials
    for (const { mesh, originalMaterial } of this.targetMeshes) {
      if (mesh.material !== originalMaterial) mesh.material.dispose();
      mesh.material = originalMaterial;
    }
    if (this.screenTexture) {
      this.screenTexture.dispose();
      this.screenTexture = null;
    }
    this.targetMeshes = [];
    this.sceneId = null;
  }
}
