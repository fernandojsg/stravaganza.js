import * as THREE from 'three';
import { getTransformMatrix, interpolatePosition, interpolateRotation, interpolateCameraSettings } from './AnimationSystem.js';
import { BlendMode } from './Renderer.js';

// PTA hardcodes the aspect ratio to 4:3 (1.3333) in WrpTransforming.cpp setActiveCamera().
// FOV stored in .pta files is horizontal; PTA converts to vertical via fov/ASPECT.
// gluPerspective(fov/aspect, aspect, near, far) — the viewport mismatch (800x510 = 1.569)
// produces the same horizontal stretching as the original C++ demo.
const DEFAULT_PTA_ASPECT = 4 / 3;

// Lens flare alpha fade speed: 1.0 / 150ms (matches C++ pta3DLensFlare)
const LENS_FLARE_FADE_SPEED = 1.0 / 150.0;

// Reusable objects for lens flare raycasting (avoid per-frame allocation)
const _flareRaycaster = new THREE.Raycaster();
const _flareRayDir = new THREE.Vector3();
const _flareCamPos = new THREE.Vector3();
// PTA fixed-function OpenGL computes specular per-vertex (Gouraud), while
// Three.js MeshPhong computes per-fragment and looks hotter on low-poly meshes.
// Odyssey city scenes: all materials have specular=0.9, shininess=0.1 (→12.8).
// Low shininess = very broad highlight; per-pixel makes this a diffuse-like wash.
// 0.35 matches the per-vertex softening effect observed in the C++ reference.
const PTA_SPECULAR_VERTEX_COMPENSATION_DEFAULT = 0.35;

// Per-fragment diffuse on low-poly geometry is brighter than Gouraud per-vertex
// because NdotL is correctly evaluated at every pixel instead of interpolated
// from vertices. This factor compensates for the lost averaging effect.
// Empirically tuned to match C++ reference at ~59s (City02/Camera03).
const PTA_DIFFUSE_VERTEX_COMPENSATION_DEFAULT = 0.80;

/**
 * SceneManager - Converts parsed PTA scene data to Three.js scene graphs
 * and handles animated rendering.
 */
export class SceneManager {
  constructor(renderer) {
    this.renderer = renderer;
    /** @type {Map<string, ManagedScene>} */
    this.scenes = new Map();
    this.fixedFrustumAspect = DEFAULT_PTA_ASPECT;
    // Some productions authored PTA color constants as monitor-space (sRGB-like) values.
    // Keep legacy default behavior unless explicitly enabled by the caller.
    this.ptaColorConstantsAreSRGB = false;

    // Wide blur capture system (C++ initWideBlurSupport)
    this.wideBlurEnabled = false;
    /** @type {THREE.FramebufferTexture|null} */
    this._wblurTex = null;
    this._wblurScene = null;
    this._wblurMesh = null;
    this._wblurMat = null;
  }

  /**
   * Enable/disable sRGB interpretation for PTA-authored color constants
   * (materials, lights, wire colors, scene bg).
   * @param {boolean} enabled
   */
  setPtaColorConstantsAreSRGB(enabled) {
    this.ptaColorConstantsAreSRGB = !!enabled;
  }

  /**
   * Set fixed frustum aspect used to convert horizontal FOV to vertical FOV.
   * @param {number} aspect
   */
  setFixedFrustumAspect(aspect) {
    if (Number.isFinite(aspect) && aspect > 0) {
      this.fixedFrustumAspect = aspect;
    }
  }

  _ptaColorFromRGB(r, g, b) {
    if (this.ptaColorConstantsAreSRGB) {
      return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    }
    return new THREE.Color(r, g, b);
  }

  _ptaColorFromObj(c) {
    if (!c) return new THREE.Color(0, 0, 0);
    return this._ptaColorFromRGB(c.r, c.g, c.b);
  }

  /**
   * Build a Three.js scene from parsed PTA data.
   * @param {string} id - Scene identifier
   * @param {import('./PtaFileLoader.js').PtaScene} ptaScene - Parsed PTA scene
   * @param {Map<string, THREE.Texture>} textures - Loaded textures by filename
   * @returns {ManagedScene}
   */
  buildScene(id, ptaScene, textures = new Map()) {
    const managed = new ManagedScene(ptaScene);
    const sourcePath = (ptaScene.sourcePath || '').toLowerCase();
    const specularCompensation = PTA_SPECULAR_VERTEX_COMPENSATION_DEFAULT;
    const diffuseCompensation = PTA_DIFFUSE_VERTEX_COMPENSATION_DEFAULT;

    // Check if scene has lights — use unlit materials if not.
    // PTA determines lighting at load time: numLights > 0 → lit, else unlit.
    // Global ambient alone does NOT enable lighting (matches C++ behavior).
    const parsedLights = ptaScene.lights || [];
    const headerLightCount = Math.max(0, ptaScene.header?.numLights || 0);
    // Some legacy files have numLights > 0 in header but miss LO__ chunks.
    // C++ still allocates default lights in that case, so emulate that behavior.
    const effectiveLightCount = Math.max(parsedLights.length, headerLightCount);
    const hasLights = effectiveLightCount > 0;
    const useLighting = hasLights;

    // Global ambient color for per-material emissive (PTA: globalAmbient * matAmbient)
    const globalAmbient = ptaScene.globalInfo
      ? this._ptaColorFromObj(ptaScene.globalInfo.ambientColor)
      : new THREE.Color(0, 0, 0);

    // C++ OpenGL: each light has hardcoded ambient = (0.1, 0.1, 0.1) (WrpLighting.cpp:144).
    // This adds numLights * 0.1 * matAmbient to every surface — bake into emissive.
    const numLights = effectiveLightCount;

    // Build materials
    const threeMaterials = ptaScene.materials.map(mat => this._buildMaterial(
      mat, textures, useLighting, globalAmbient, numLights, specularCompensation, diffuseCompensation
    ));

    // Build objects
    for (const obj of ptaScene.objects) {
      const mesh = this._buildMesh(obj, threeMaterials);
      if (mesh) {
        managed.threeScene.add(mesh);
        managed.meshes.set(obj.name, { mesh, data: obj });
      }
    }

    // Apply per-scene overrides for known exporter issues
    this._applySceneOverrides(id, managed);

    // Build cameras
    for (const cam of ptaScene.cameras) {
      const threeCamera = this._buildCamera(cam);
      managed.cameras.set(cam.name, { camera: threeCamera, data: cam });
    }

    // Build lights
    for (const light of parsedLights) {
      const threeLight = this._buildLight(light);
      if (threeLight) {
        managed.threeScene.add(threeLight);
        managed.lights.set(light.name, { light: threeLight, data: light });
      }
    }
    for (let i = parsedLights.length; i < effectiveLightCount; i++) {
      const fallbackLight = this._buildDefaultLight(i);
      managed.threeScene.add(fallbackLight);
      managed.lights.set(fallbackLight.name, { light: fallbackLight, data: null });
    }

    // PTA ambient: globalAmbient * materialAmbient (baked into emissive per material).
    // No Three.js AmbientLight needed — avoids diffuse-as-ambient brightening.
    if (ptaScene.globalInfo) {
      const gi = ptaScene.globalInfo;
      if (gi.bgColor) {
        managed.bgColor = this._ptaColorFromObj(gi.bgColor);
      }
    }

    // Parse helper userDefined properties for lens flares and particle systems.
    // C++ Pta3DSceneManager::parseUserDefinedProperties() iterates helpers,
    // looking for "lensflare" → pta3DLensFlare, "particles" → ptaParticleSystemStandard.
    if (ptaScene.helpers) {
      for (const helper of ptaScene.helpers) {
        if (!helper.userProps) continue;
        const propsLower = helper.userProps.toLowerCase();

        // Lens flares
        if (propsLower.includes('lensflare')) {
          const pos = new THREE.Vector3();
          helper.transformMatrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());

          const props = helper.userProps;
          const numMatch = props.match(/numflares\s*=\s*(\d+)/i);
          const numFlares = numMatch ? parseInt(numMatch[1]) : 0;

          const texMatches = [...props.matchAll(/texturefile\s*=\s*"([^"]+)"/gi)];
          const posMatches = [...props.matchAll(/position\s*=\s*([\d.]+)/gi)];
          const sizeMatches = [...props.matchAll(/size\s*=\s*([\d.]+)/gi)];

          const elements = [];
          for (let i = 0; i < numFlares; i++) {
            elements.push({
              texturePath: texMatches[i] ? texMatches[i][1].replace(/\\/g, '/') : null,
              position: posMatches[i] ? parseFloat(posMatches[i][1]) : 0,
              size: sizeMatches[i] ? parseFloat(sizeMatches[i][1]) : 1.0,
              texture: null,
            });
          }

          if (elements.length > 0) {
            managed.lensFlares.push({ sourcePos: pos, elements, alpha: 0 });
          }
        }

        // Particle systems
        if (propsLower.includes('particles')) {
          const pProps = helper.userProps;
          const pNum = pProps.match(/particlenum\s*=\s*(\d+)/i);
          const pLife = pProps.match(/particlelife\s*=\s*(\d+)/i);
          const pSpeed = pProps.match(/particlespeed\s*=\s*([\d.]+)/i);
          const pSize = pProps.match(/particlesize\s*=\s*([\d.]+)/i);
          const pCone = pProps.match(/coneangle\s*=\s*(\d+)/i);
          const pBlend = pProps.match(/blending\s*=\s*"(\w+)"/i);
          const pLoop = pProps.match(/loop\s*=\s*(\w+)/i);
          const pTex = pProps.match(/texturefile\s*=\s*"([^"]+)"/i);
          const pAccel = pProps.match(/acceleration\s*=\s*\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/i);

          if (pNum && pLife && pSpeed && pSize && pTex) {
            const psys = new SceneParticleSystem({
              numParticles: parseInt(pNum[1]),
              particleLife: parseInt(pLife[1]),
              speed: parseFloat(pSpeed[1]),
              particleSize: parseFloat(pSize[1]),
              coneAngle: pCone ? parseInt(pCone[1]) : 0,
              additive: !pBlend || pBlend[1].toLowerCase() === 'additive',
              loop: !pLoop || pLoop[1].toLowerCase() === 'true',
              acceleration: pAccel
                ? { x: parseFloat(pAccel[1]), y: parseFloat(pAccel[2]), z: parseFloat(pAccel[3]) }
                : null,
              texturePath: pTex[1].replace(/\\/g, '/'),
              helperMatrix: helper.transformMatrix,
            });
            managed.particleSystems.push(psys);
          }
        }
      }
    }

    this.scenes.set(id, managed);
    return managed;
  }

  /**
   * Apply per-scene overrides for known exporter issues.
   */
  _applySceneOverrides(id, managed) {
    // Normalize id: extract basename without extension for matching
    // DemoManager passes "City02", viewer passes "data/3dscenes/city/city02.pta"
    const basename = id.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase();

    // sala: Box01-04 position corrections (exporter GetNodeTM vs GetObjectTM mismatch)
    if (basename === 'sala') {
      const overrides = {
        'Box01': { x: 0, y: -10 },
        'Box02': { x: 20, y: 10 },
        'Box03': { x: 0, y: 30 },
        'Box04': { x: -20, y: 10 },
      };

      for (const [name, pos] of Object.entries(overrides)) {
        const entry = managed.meshes.get(name);
        if (!entry) continue;

        const e = entry.data.transformMatrix.elements;
        if (pos.x !== undefined) e[12] = pos.x;
        if (pos.y !== undefined) e[13] = pos.y;
        if (pos.z !== undefined) e[14] = pos.z;

        entry.mesh.matrix.copy(entry.data.transformMatrix);
        entry.mesh.matrixWorldNeedsUpdate = true;
      }
    }

    // City02: "suelo carretera" has inverted normals — flip face side
    if (basename === 'city02') {
      const entry = managed.meshes.get('suelo carretera');
      if (entry) {
        entry.mesh.material.side = THREE.BackSide;
      }
    }
  }

  /**
   * Render a scene at a given animation time.
   * @param {string} id - Scene identifier
   * @param {number} sceneTime - Time within scene animation (ms)
   * @param {string} [cameraName] - Camera to use (default: first camera)
   * @param {number} [playSpeed=1] - Playback speed multiplier
   * @param {THREE.Camera} [overrideCamera=null] - Use this camera instead of scene cameras
   */
  renderScene(id, sceneTime, cameraName, playSpeed = 1, overrideCamera = null) {
    const managed = this.scenes.get(id);
    if (!managed) {
      console.warn(`Scene "${id}" not found`);
      return;
    }

    const t = sceneTime * playSpeed;

    // Update all objects (skip if sceneTime < 0, meaning caller manages matrices)
    if (sceneTime >= 0) {
      for (const [name, { mesh, data }] of managed.meshes) {
        const matrix = getTransformMatrix(t, data, data.transformMatrix);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
      }
    }

    // Find camera
    let activeCamera = null;
    if (overrideCamera) {
      // Caller provides a pre-built camera (e.g., PTA NULL camera)
      activeCamera = overrideCamera;
    } else if (cameraName && managed.cameras.has(cameraName)) {
      const camEntry = managed.cameras.get(cameraName);
      activeCamera = camEntry.camera;
      // Only update camera animation if sceneTime >= 0
      if (sceneTime >= 0) {
        this._updateCamera(camEntry.camera, camEntry.data, t);
      }
    } else if (managed.cameras.size > 0) {
      const [firstCam] = managed.cameras.values();
      activeCamera = firstCam.camera;
      if (sceneTime >= 0) {
        this._updateCamera(firstCam.camera, firstCam.data, t);
      }
    }

    if (!activeCamera) {
      // PTA NULL camera: FOV=60° horizontal, identity view at origin looking -Z
      activeCamera = new THREE.PerspectiveCamera(
        60 / this.fixedFrustumAspect,
        this.fixedFrustumAspect,
        1,
        1000
      );
      activeCamera.position.set(0, 0, 0);
      activeCamera.lookAt(0, 0, -1);
    }

    // Compute camera aspect from the current viewport so circles stay round.
    // PTA renderScene() does the same (Pta3DSceneManager.cpp:509).
    if (activeCamera.isPerspectiveCamera) {
      const vp = this.renderer.currentViewport;
      activeCamera.aspect = (vp.w > 0 && vp.h > 0)
        ? vp.w / vp.h
        : this.renderer.demoWidth / this.renderer.demoHeight;
      activeCamera.updateProjectionMatrix();
    }

    // Update lights
    for (const [name, { light, data }] of managed.lights) {
      if (data) this._updateLight(light, data, t);
    }

    // Render
    this.renderer.renderScene(managed.threeScene, activeCamera);

    // Render scene-embedded particle systems (after main scene, before lens flares)
    this._renderSceneParticles(managed, activeCamera, t);

    // Render lens flares (after main scene so they overlay correctly)
    this._renderLensFlares(managed, activeCamera);

    // Wide blur: capture framebuffer for doWideBlur() overlay.
    // C++ copies framebuffer to wblurTexture after scene + lens flares.
    if (this.wideBlurEnabled) {
      this._captureWideBlur();
    }
  }

  getScene(id) {
    return this.scenes.get(id);
  }

  /**
   * Load lens flare textures for a scene (async).
   * Call after buildScene() during asset loading phase.
   * @param {string} id - Scene identifier
   * @param {Function} loadTextureFn - async (path) => THREE.Texture
   */
  async loadSceneLensFlares(id, loadTextureFn) {
    const managed = this.scenes.get(id);
    if (!managed || managed.lensFlares.length === 0) return;

    for (const flare of managed.lensFlares) {
      for (const el of flare.elements) {
        if (el.texturePath && !el.texture) {
          try {
            el.texture = await loadTextureFn(el.texturePath);
          } catch (err) {
            console.warn(`LensFlare: failed to load "${el.texturePath}":`, err.message);
          }
        }
      }
    }
  }

  /**
   * Load particle textures and build render objects for scene-embedded particle systems.
   * Call after buildScene() during asset loading phase.
   * @param {string} id - Scene identifier
   * @param {Function} loadTextureFn - async (path) => THREE.Texture
   */
  async loadSceneParticles(id, loadTextureFn) {
    const managed = this.scenes.get(id);
    if (!managed || managed.particleSystems.length === 0) return;

    for (const psys of managed.particleSystems) {
      try {
        const texture = await loadTextureFn(psys.texturePath);
        psys.buildRenderObjects(texture);
      } catch (err) {
        console.warn(`SceneParticle: failed to load "${psys.texturePath}":`, err.message);
      }
    }
  }

  /**
   * Update and render scene-embedded particle systems.
   * Called after the main scene render pass.
   * @param {ManagedScene} managed
   * @param {THREE.Camera} camera
   * @param {number} sceneTime - Current scene time in ms
   */
  _renderSceneParticles(managed, camera, sceneTime) {
    if (managed.particleSystems.length === 0) return;

    // Compute delta time
    let deltaMs = 0;
    if (managed._particleLastTime >= 0) {
      deltaMs = sceneTime - managed._particleLastTime;
      if (deltaMs < 0) deltaMs = 0;
      if (deltaMs > 100) deltaMs = 100; // Clamp large jumps
    }
    managed._particleLastTime = sceneTime;

    const particleScene = new THREE.Scene();

    for (const psys of managed.particleSystems) {
      if (!psys.group) continue;

      // Update particle positions
      if (deltaMs > 0) {
        psys.update(deltaMs);
      }

      // Update sprite positions/opacity
      psys.updateGeometry(camera);

      particleScene.add(psys.group);
    }

    // Render all particle sprites
    this.renderer.webglRenderer.render(particleScene, camera);

    // Remove groups from temp scene to avoid disposal
    for (const psys of managed.particleSystems) {
      if (psys.group && psys.group.parent === particleScene) {
        particleScene.remove(psys.group);
      }
    }
  }

  /**
   * Render lens flares for a scene after its main render pass.
   * Matches C++ pta3DLensFlare::update() + render():
   * - Project source to screen, fade alpha based on visibility
   * - Draw additive textured quads along source-to-center trajectory
   * @param {ManagedScene} managed
   * @param {THREE.Camera} camera
   */
  _renderLensFlares(managed, camera) {
    if (managed.lensFlares.length === 0) return;

    const now = performance.now();
    const incMs = managed._lensFlareLastTimestamp >= 0
      ? Math.min(now - managed._lensFlareLastTimestamp, 100)
      : 0;
    managed._lensFlareLastTimestamp = now;

    for (const flare of managed.lensFlares) {
      // Project flare source position to screen space (NDC [-1,1])
      const projected = flare.sourcePos.clone().project(camera);

      // NDC → PTA screen coords (0-1, y=0=top)
      const screenX = (projected.x + 1) * 0.5;
      const screenY = 1 - (projected.y + 1) * 0.5;

      const isInFront = projected.z >= -1 && projected.z <= 1;
      const isOnScreen = screenX >= 0 && screenX <= 1 && screenY >= 0 && screenY <= 1;

      // Occlusion: raycast from camera to flare source, check for mesh hits.
      // C++ uses Z-buffer readback (free on GPU); JS uses raycasting against scene meshes.
      // Flare helpers sit AT light fixture surfaces ("foco verja*"), so the ray often
      // hits the fixture itself at ~99.7% of flare distance. Use 0.95 tolerance to avoid
      // self-occlusion while still catching buildings that are clearly in front.
      let isVisible = isInFront && isOnScreen;
      if (isVisible) {
        camera.getWorldPosition(_flareCamPos);
        _flareRayDir.copy(flare.sourcePos).sub(_flareCamPos).normalize();
        _flareRaycaster.set(_flareCamPos, _flareRayDir);
        const flareDist = _flareCamPos.distanceTo(flare.sourcePos);
        const intersects = _flareRaycaster.intersectObjects(managed.threeScene.children, true);
        if (intersects.length > 0 && intersects[0].distance < flareDist * 0.95) {
          isVisible = false;
        }
      }

      if (isVisible) {
        flare.alpha = Math.min(1.0, flare.alpha + incMs * LENS_FLARE_FADE_SPEED);
      } else {
        flare.alpha = Math.max(0.0, flare.alpha - incMs * LENS_FLARE_FADE_SPEED);
      }

      if (flare.alpha <= 0.001) continue;

      // C++ size pulsing: sizeMultiplier = 0.75 + (alpha / 4.0)
      const sizeMultiplier = 0.75 + (flare.alpha / 4.0);

      // Ray from flare source position through screen center (extended 2x)
      const centerX = 0.5;
      const centerY = 0.5;
      const rayX = (centerX - screenX) * 2.0;
      const rayY = (centerY - screenY) * 2.0;

      for (const el of flare.elements) {
        if (!el.texture) continue;

        const flareX = screenX + rayX * el.position;
        const flareY = screenY + rayY * el.position;

        // C++ aspect ratio: height = width * 1.33 (4:3)
        const w = el.size * sizeMultiplier;
        const h = w * 1.33;

        // Additive blending (SRCALPHA + ONE)
        this.renderer.drawTexturedQuad(
          el.texture, flareX, flareY, w, h, 0,
          flare.alpha, BlendMode.SRCALPHA, BlendMode.ONE
        );
      }
    }
  }

  /**
   * Capture current framebuffer for wide blur overlay.
   * C++ copies framebuffer pixels to a 256x256 texture via copyFBufferToTexture.
   * We use FramebufferTexture + copyFramebufferToTexture to capture what's already
   * rendered on screen (exact pixel match, no re-rendering needed).
   */
  _captureWideBlur() {
    const webgl = this.renderer.webglRenderer;
    const vp = this.renderer.currentViewport;
    const dpr = webgl.getPixelRatio();
    const physW = Math.round(vp.w * dpr);
    const physH = Math.round(vp.h * dpr);

    // Create/recreate FramebufferTexture if viewport size changed
    if (!this._wblurTex || this._wblurTex.image.width !== physW || this._wblurTex.image.height !== physH) {
      if (this._wblurTex) this._wblurTex.dispose();
      this._wblurTex = new THREE.FramebufferTexture(physW, physH);
      this._wblurTex.minFilter = THREE.LinearFilter;
      this._wblurTex.magFilter = THREE.LinearFilter;
    }

    // Copy framebuffer from viewport's physical position (bottom-left origin)
    const physX = Math.round(vp.x * dpr);
    const physY = Math.round(vp.y * dpr);
    webgl.copyFramebufferToTexture(this._wblurTex, new THREE.Vector2(physX, physY));
  }

  /**
   * Ensure the reusable blur quad mesh/material/scene exist.
   * Uses a custom ShaderMaterial that outputs vec4(rgb, opacity) — matching
   * C++ RGB 24-bit blur textures where alpha is always controlled by glColor.
   */
  _ensureWblurQuad() {
    if (this._wblurScene) return;

    this._wblurMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        opacity: { value: 0.2 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec3 rgb = texture2D(map, vUv).rgb;
          gl_FragColor = vec4(rgb, opacity);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    const geom = new THREE.PlaneGeometry(1, 1);
    this._wblurMesh = new THREE.Mesh(geom, this._wblurMat);
    this._wblurMesh.position.set(0.5, 0.5, 0);
    this._wblurScene = new THREE.Scene();
    this._wblurScene.add(this._wblurMesh);
  }

  /**
   * Draw wide blur overlay using the captured framebuffer texture.
   * Standard mode: N quads at center with increasing size, alpha=0.2.
   * DOF mode: grid of quads at offset positions, alpha = fWidth * 12.
   * C++ original: Pta3DSceneManager::doWideBlur()
   */
  doWideBlur(numQuads, fWidth, fHeight, isDOF) {
    if (!this._wblurTex || !this.wideBlurEnabled) return;

    this._ensureWblurQuad();
    const gl = this.renderer.webglRenderer;
    const cam = this.renderer.orthoCamera;

    this._wblurMat.uniforms.map.value = this._wblurTex;

    if (isDOF) {
      const nNumH = Math.floor(Math.sqrt(numQuads));
      const nNumV = Math.floor(numQuads / nNumH);

      for (let nX = 0; nX < nNumH; nX++) {
        for (let nY = 0; nY < nNumV; nY++) {
          const fXPos = 0.5 - (fWidth * 0.5) + (nX / (nNumH - 1)) * fWidth;
          const fYPos = 0.5 - (fHeight * 0.5) + (nY / (nNumV - 1)) * fHeight;
          const fAlpha = fWidth * 12.0;

          this._wblurMat.uniforms.opacity.value = fAlpha;
          // PTA Y-flip: 0=top → Three.js 0=bottom
          this._wblurMesh.position.set(fXPos, 1 - fYPos, 0);
          this._wblurMesh.scale.set(1.0, 1.0, 1);
          gl.render(this._wblurScene, cam);
        }
      }
    } else {
      this._wblurMat.uniforms.opacity.value = 0.2;
      for (let i = 0; i < numQuads; i++) {
        const quadWidth = 1.0 + (fWidth * (i / numQuads));
        const quadHeight = 1.0 + (fHeight * (i / numQuads));

        this._wblurMesh.position.set(0.5, 0.5, 0);
        this._wblurMesh.scale.set(quadWidth, quadHeight, 1);
        gl.render(this._wblurScene, cam);
      }
    }
  }

  _buildMaterial(
    matData,
    textures,
    useLighting = true,
    globalAmbient = { r: 0, g: 0, b: 0 },
    numLights = 0,
    specularCompensation = PTA_SPECULAR_VERTEX_COMPENSATION_DEFAULT,
    diffuseCompensation = PTA_DIFFUSE_VERTEX_COMPENSATION_DEFAULT
  ) {
    // PTA fixed-function OpenGL: diffuse = lightColor * matDiffuse * NdotL (no 1/PI).
    // Three.js BRDF_Lambert divides by PI for lit (MeshPhongMaterial) materials.
    // Multiply lit diffuse by PI so the 1/PI division cancels out, matching PTA.
    // Also apply diffuseCompensation to approximate per-vertex (Gouraud) averaging.
    // Unlit (MeshBasicMaterial) has no BRDF_Lambert — use raw diffuse directly.
    const rawColor = this._ptaColorFromObj(matData.diffuse);
    const litColor = rawColor.clone().multiplyScalar(Math.PI * diffuseCompensation);
    const side = matData.isTwoSided ? THREE.DoubleSide : THREE.FrontSide;

    // Find textures by name matching
    let mapTexture = null;
    let bumpMapTexture = null;
    let lightMapTexture = null;

    if (matData.texture1) {
      const texName = matData.texture1.toLowerCase();
      for (const [key, tex] of textures) {
        if (key.toLowerCase().includes(texName) || texName.includes(key.toLowerCase())) {
          // texture1 is always the diffuse map (isBumpMap flag applies to texture2)
          mapTexture = tex;
          break;
        }
      }
    }

    if (matData.texture2) {
      const texName = matData.texture2.toLowerCase();
      for (const [key, tex] of textures) {
        if (key.toLowerCase().includes(texName) || texName.includes(key.toLowerCase())) {
          if (matData.isBumpMap) {
            // PTA DOT3 bump maps encode tangent-space normals as RGB (GL_DOT3_RGB).
            // Three.js normalMap expects the same encoding: normal = 2 * texColor - 1.
            // Normal maps contain data, not color — must use linear color space.
            // Disable mipmaps to preserve fine detail at high UV tiling rates.
            // PTA DOT3 register combiners sample at full resolution; trilinear
            // mipmapping averages out the high-frequency grain, making bumps appear coarser.
            const bumpTex = tex.clone();
            bumpTex.colorSpace = THREE.LinearSRGBColorSpace;
            bumpTex.generateMipmaps = false;
            bumpTex.minFilter = THREE.LinearFilter;
            bumpMapTexture = bumpTex;
          } else {
            lightMapTexture = tex;
          }
          break;
        }
      }
    }

    // PTA GL_SPHERE_MAP: generates texture coordinates from view-space reflection vectors.
    // Keep textures as regular maps; effects compute sphere-map UVs from normals per frame.
    // Flag sphere-mapped textures so effects know to update UVs.
    let hasSphereMap = false;
    let sphereMapTexture = null;
    if (matData.tex1Spherical && mapTexture) {
      hasSphereMap = true;
    }
    if (matData.tex2Spherical && lightMapTexture) {
      // tex2 with GL_SPHERE_MAP provides chrome/metallic reflections.
      // Keep reference for matcap rendering.
      sphereMapTexture = lightMapTexture;
      hasSphereMap = true;
      if (!mapTexture) {
        mapTexture = lightMapTexture;
      }
      lightMapTexture = null;
    }

    let mat;
    if (useLighting) {
      // PTA ambient term: globalAmbient * materialAmbient (per-material, NOT diffuse).
      // Three.js AmbientLight uses diffuse color (too bright). Bake into emissive instead.
      // C++ also adds per-light ambient: each light has hardcoded ambient = (0.1, 0.1, 0.1).
      // Total: (globalAmbient + numLights * 0.1) * materialAmbient
      const perLightAmbient = numLights * 0.1;
      const matAmbient = this._ptaColorFromObj(matData.ambient);
      const emissive = new THREE.Color(
        (globalAmbient.r + perLightAmbient) * matAmbient.r,
        (globalAmbient.g + perLightAmbient) * matAmbient.g,
        (globalAmbient.b + perLightAmbient) * matAmbient.b,
      );

      const params = {
        color: litColor, side, emissive,
        specular: this._ptaColorFromObj(matData.specular)
          .multiplyScalar(specularCompensation),
        // PTA: glMaterialf(GL_SHININESS, shininess * 128.0f)
        shininess: matData.shininess * 128.0,
      };
      if (mapTexture) params.map = mapTexture;
      if (bumpMapTexture) {
        // PTA texture2 (DOT3 bump) uses UV channel 2. Our geometry stores this
        // as the 'uv2' attribute (Three.js channel 2). Must set channel so the
        // normalMap samples from the correct UVs — UV channel 2 may have different
        // tiling than UV channel 1 (e.g., mamut: UV1 is 0-1, UV2 is -0.75 to 1.75).
        bumpMapTexture.channel = 2;
        params.normalMap = bumpMapTexture;
        // PTA DOT3 bump does full per-pixel normal replacement via NV register combiners.
        // Three.js normalMap with normalScale=1.0 matches this behavior.
        params.normalScale = new THREE.Vector2(1.0, 1.0);
      }
      // PTA's texture2 (non-bump) uses GL_MODULATE: result *= tex2.
      // Three.js lightMap is ADDITIVE (wrong). Use aoMap + onBeforeCompile
      // to make it multiplicative on ALL lighting (direct + indirect).
      if (lightMapTexture) {
        // Lightmaps use UV channel 2 (unique unwrap, 0-1 range) — NOT the
        // tiling diffuse UVs from channel 1. Three.js getChannel() maps:
        //   channel 0 → 'uv', channel 1 → 'uv1', channel 2 → 'uv2'
        // Our geometry stores the second UV set as 'uv2', so use channel=2.
        // If the PTA file lacks UV channel 2, _buildMesh copies uv→uv2.
        lightMapTexture.channel = 2;
        params.aoMap = lightMapTexture;
        params.aoMapIntensity = 1.0;
      }
      mat = new THREE.MeshPhongMaterial(params);

      // Patch shader for lightmap multiplicative blending if needed.
      if (lightMapTexture) {
        mat.onBeforeCompile = (shader) => {
          // Replace aomap_fragment: PTA GL_MODULATE multiplies ALL output by tex2.
          // In PTA, vertex lighting (ambient + diffuse) goes through texUnit0 (* tex1)
          // then texUnit1 (* tex2). Our emissive (baked ambient) must also be multiplied
          // by both tex1 and tex2 to match.
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <aomap_fragment>',
            /* glsl */ `
            #ifdef USE_AOMAP
              vec3 tex2Color = texture2D( aoMap, vAoMapUv ).rgb;
              reflectedLight.indirectDiffuse *= tex2Color;
              reflectedLight.directDiffuse *= tex2Color;
              reflectedLight.directSpecular *= tex2Color;
              totalEmissiveRadiance *= tex2Color;
              #ifdef USE_MAP
                totalEmissiveRadiance *= texture2D( map, vMapUv ).rgb;
              #endif
            #endif
            `
          );
        };
      } else if (mapTexture) {
        mat.onBeforeCompile = (shader) => {
          // PTA fixed pipeline applies GL_MODULATE to the full lit result, including
          // the ambient term. In MeshPhong, emissive is additive and not modulated by
          // map, which creates a flat haze. Multiply emissive by map to match PTA.
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `
            #include <emissivemap_fragment>
            #ifdef USE_MAP
              totalEmissiveRadiance *= texture2D( map, vMapUv ).rgb;
            #endif
            `
          );
        };
      }
    } else if (sphereMapTexture) {
      // Unlit + sphere map: PTA multi-textures with GL_SPHERE_MAP on tex2.
      // GL_SPHERE_MAP generates UVs from the eye-space reflection vector:
      //   r = reflect(-viewDir, normal)
      //   uv = r.xy / (2 * sqrt(rx^2 + ry^2 + (rz+1)^2)) + 0.5
      // PTA tex unit 0: GL_MODULATE → result0 = diffuseColor * tex1(meshUV)
      // PTA tex unit 1: GL_ADD      → result1 = result0 + tex2(sphereUV)
      // Final: diffuseColor * tex1 + sphereMap
      const hasMap = mapTexture && mapTexture !== sphereMapTexture;
      mat = new THREE.ShaderMaterial({
        uniforms: {
          diffuseColor: { value: rawColor },
          map: { value: hasMap ? mapTexture : null },
          sphereMap: { value: sphereMapTexture },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            vNormal = normalMatrix * normal;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 diffuseColor;
          uniform sampler2D map;
          uniform sampler2D sphereMap;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            vec3 color = diffuseColor;
            ${hasMap ? 'color *= texture2D(map, vUv).rgb;' : ''}
            // GL_SPHERE_MAP + GL_ADD: sphere map is ADDED to base color
            vec3 viewDir = normalize(vViewPosition);
            vec3 normal = normalize(vNormal);
            vec3 r = reflect(-viewDir, normal);
            float m = 2.0 * sqrt(r.x*r.x + r.y*r.y + (r.z+1.0)*(r.z+1.0));
            vec2 sphereUV = vec2(r.x / m + 0.5, r.y / m + 0.5);
            color += texture2D(sphereMap, sphereUV).rgb;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        side,
      });
    } else {
      // Unlit: PTA disables GL_LIGHTING, uses glColor(diffuse) with GL_MODULATE.
      // Match PTA exactly: straight diffuse multiplier, no extra gamma transform.
      const params = { color: rawColor, side };
      if (mapTexture) params.map = mapTexture;
      mat = new THREE.MeshBasicMaterial(params);
    }

    // PTA auto-enables alpha blending (SrcAlpha/InvSrcAlpha) when any texture
    // on a material is 32-bit (has alpha channel). Enable Three.js transparency.
    if ((mapTexture && mapTexture._hasAlpha) || (lightMapTexture && lightMapTexture._hasAlpha)) {
      mat.transparent = true;
    }

    // Flag for effects that need to compute sphere-map UVs from normals
    if (hasSphereMap) mat._hasSphereMap = true;

    // Handle sub-materials
    if (matData.subMaterials && matData.subMaterials.length > 0) {
      mat._subMaterials = matData.subMaterials.map(sm => this._buildMaterial(
        sm, textures, useLighting, globalAmbient, numLights, specularCompensation, diffuseCompensation
      ));
    }

    return mat;
  }

  _buildMesh(objData, materials) {
    if (objData.numVertices === 0 || objData.numFaces === 0) return null;

    const geometry = new THREE.BufferGeometry();
    const normalSource = objData.normals.length > 0
      ? objData.normals
      : this._computePtaVertexNormals(objData);

    // Positions
    const positions = new Float32Array(objData.numFaces * 3 * 3);
    // Normals
    const normals = normalSource.length > 0 ? new Float32Array(objData.numFaces * 3 * 3) : null;
    // UVs
    const uvs = objData.uvs1.length > 0 ? new Float32Array(objData.numFaces * 3 * 2) : null;
    // UV2 (lightmap channel)
    const uvs2 = objData.uvs2 && objData.uvs2.length > 0 ? new Float32Array(objData.numFaces * 3 * 2) : null;
    // Colors
    const colors = objData.colors.length > 0 ? new Float32Array(objData.numFaces * 3 * 3) : null;

    // Build per-face vertex data (unindexed for per-face normals/uvs)
    for (let f = 0; f < objData.numFaces; f++) {
      const face = objData.faces[f];
      const i0 = face.v0, i1 = face.v1, i2 = face.v2;

      for (let vi = 0; vi < 3; vi++) {
        const idx = [i0, i1, i2][vi];
        const base = (f * 3 + vi);

        if (idx < objData.vertices.length) {
          const v = objData.vertices[idx];
          positions[base * 3] = v.x;
          positions[base * 3 + 1] = v.y;
          positions[base * 3 + 2] = v.z;
        }

        if (normals && idx < normalSource.length) {
          const n = normalSource[idx];
          normals[base * 3] = n.x;
          normals[base * 3 + 1] = n.y;
          normals[base * 3 + 2] = n.z;
        }

        if (uvs && idx < objData.uvs1.length) {
          const uv = objData.uvs1[idx];
          uvs[base * 2] = uv.u;
          uvs[base * 2 + 1] = uv.v;
        }

        if (uvs2 && idx < objData.uvs2.length) {
          const uv = objData.uvs2[idx];
          uvs2[base * 2] = uv.u;
          uvs2[base * 2 + 1] = uv.v;
        }

        if (colors && idx < objData.colors.length) {
          const c = objData.colors[idx];
          colors[base * 3] = c.r;
          colors[base * 3 + 1] = c.g;
          colors[base * 3 + 2] = c.b;
        }
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (uvs2) geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs2, 2));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Select material
    let material;
    if (objData.materialId >= 0 && objData.materialId < materials.length) {
      material = materials[objData.materialId];
    } else if (objData.wireColor) {
      material = new THREE.MeshBasicMaterial({
        color: this._ptaColorFromObj(objData.wireColor),
      });
    } else {
      material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    }

    // Clone material if object-specific adjustments are needed
    let needClone = false;
    if (colors && !material.vertexColors) needClone = true;
    // If mesh has no UVs but material has a texture map, the texture can't be sampled.
    // In C++ OpenGL, missing texcoords default to (0,0) and sample a single texel.
    // In Three.js, missing 'uv' attribute makes the texture render black.
    // Remove the map for meshes without UVs to show the diffuse color instead.
    // Exception: sphere-mapped materials — UVs are generated per-frame by effect code.
    if (!uvs && material.map && !material._hasSphereMap) needClone = true;

    if (needClone) {
      material = material.clone();
      if (colors) material.vertexColors = true;
      if (!uvs && !material._hasSphereMap) material.map = null;
    }

    // If material uses aoMap or normalMap on channel 2 but geometry has no uv2,
    // copy uv to uv2 so the shader can sample the second texture.
    const needsUv2 = (material.aoMap && material.aoMap.channel === 2) ||
                     (material.normalMap && material.normalMap.channel === 2);
    if (needsUv2 && !geometry.hasAttribute('uv2')) {
      const uvAttr = geometry.getAttribute('uv');
      if (uvAttr) geometry.setAttribute('uv2', uvAttr);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = objData.name;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(objData.transformMatrix);

    return mesh;
  }

  _computePtaVertexNormals(objData) {
    // Matches pta3DObject::ComputeNormals(true):
    // average face normals by ORIGINAL vertex index (no position merging).
    const out = Array.from({ length: objData.numVertices }, () => new THREE.Vector3(0, 0, 0));
    // PTA hasNegScale() returns true when the 3x3 orientation term is positive.
    const ptaHasNegScale = objData.transformMatrix.determinant() > 0;
    const i0 = ptaHasNegScale ? 2 : 0;
    const i1 = 1;
    const i2 = ptaHasNegScale ? 0 : 2;
    const vector1 = new THREE.Vector3();
    const vector2 = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();

    for (let f = 0; f < objData.numFaces; f++) {
      const face = objData.faces[f];
      const fv = [face.v0, face.v1, face.v2];
      const a = fv[i0], b = fv[i1], c = fv[i2];
      if (a >= objData.vertices.length || b >= objData.vertices.length || c >= objData.vertices.length) continue;

      const va = objData.vertices[a];
      const vb = objData.vertices[b];
      const vc = objData.vertices[c];

      vector1.set(vb.x - va.x, vb.y - va.y, vb.z - va.z);
      vector2.set(vc.x - vb.x, vc.y - vb.y, vc.z - vb.z);
      faceNormal.copy(vector2).cross(vector1);

      if (faceNormal.lengthSq() > 0) {
        faceNormal.normalize();
        out[a].add(faceNormal);
        out[b].add(faceNormal);
        out[c].add(faceNormal);
      }
    }

    for (let i = 0; i < out.length; i++) {
      if (out[i].lengthSq() > 0) out[i].normalize();
    }

    return out;
  }

  _buildCamera(camData) {
    // PTA wrapper uses a fixed frustum aspect regardless of current viewport.
    const aspect = this.fixedFrustumAspect;
    // PTA stores horizontal FOV in degrees. The engine converts to vertical via:
    //   gluPerspective(fov / ASPECT, ASPECT, 1.0, zFar)
    // where ASPECT is fixed by the wrapper (Odyssey default: 4:3).
    // Three.js PerspectiveCamera expects vertical FOV in degrees.
    const hfov = camData.fov || 60;
    const vfov = hfov / this.fixedFrustumAspect;
    const camera = new THREE.PerspectiveCamera(
      vfov,
      aspect,
      camData.near > 0 ? camData.near : 1.0,
      camData.far > 0 ? camData.far : 10000
    );

    // PTA uses originTM.getInvTransform() as the view matrix.
    // For cameras WITH rotation keys, the orientation is baked in by 3DS Max.
    // For target cameras WITHOUT rotation keys, we compute lookAt from camera
    // to target, using the initial up vector to preserve roll.
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    camData.originMatrix.decompose(pos, quat, scale);
    camera.position.copy(pos);

    const hasRotKeys = camData.rotKeys && camData.rotKeys.length > 0;
    if (hasRotKeys) {
      // Rotation baked into animation keys — use directly (preserves roll)
      camera.quaternion.copy(quat);
    } else if (camData.type === 2 && camData.targetMatrix) {
      // Target camera without rotation keys — compute lookAt with initial up vector
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
      camera.up.copy(up);
      const targetPos = new THREE.Vector3();
      camData.targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      camera.lookAt(targetPos);
    } else {
      // Free camera without rotation keys — use initial orientation
      camera.quaternion.copy(quat);
    }

    camera.name = camData.name;
    return camera;
  }

  _updateCamera(camera, camData, t) {
    // PTA uses originTM.getInvTransform() as the view matrix.
    // Get the camera's full animated transformation matrix.
    const matrix = getTransformMatrix(t, camData, camData.originMatrix);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(pos, quat, scale);
    camera.position.copy(pos);

    const hasRotKeys = camData.rotKeys && camData.rotKeys.length > 0;
    if (hasRotKeys) {
      // Rotation keys exist — use the animated rotation directly.
      // This preserves roll and handles cameras with baked lookAt rotation.
      camera.quaternion.copy(quat);
    } else if (camData.type === 2) {
      // Target camera without rotation keys — compute lookAt from camera to target.
      // Use the initial up vector from originMatrix to preserve roll.
      let targetPos;
      if (camData.targetPosKeys && camData.targetPosKeys.length > 0) {
        const targetMatrix = getTransformMatrix(t, {
          posKeys: camData.targetPosKeys,
          sclKeys: camData.targetSclKeys,
          rotKeys: camData.targetRotKeys,
        }, camData.targetMatrix);
        targetPos = new THREE.Vector3();
        targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      } else if (camData.targetMatrix) {
        targetPos = new THREE.Vector3();
        camData.targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      }
      if (targetPos) {
        // Extract up vector from initial camera orientation (preserves roll)
        const initQuat = new THREE.Quaternion();
        camData.originMatrix.decompose(new THREE.Vector3(), initQuat, new THREE.Vector3());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(initQuat);
        camera.up.copy(up);
        camera.lookAt(targetPos);
      } else {
        camera.quaternion.copy(quat);
      }
    } else {
      // Free camera without rotation keys — use initial orientation
      camera.quaternion.copy(quat);
    }

    // Update camera settings (PTA stores horizontal FOV → convert to vertical)
    if (camData.settingsKeys && camData.settingsKeys.length > 0) {
      const settings = interpolateCameraSettings(camData.settingsKeys, t, {
        near: camData.near, far: camData.far, fov: camData.fov,
      });
      camera.near = settings.near > 0 ? settings.near : 1.0;
      camera.far = settings.far > 0 ? settings.far : 10000;
      camera.fov = (settings.fov || 60) / this.fixedFrustumAspect;
      camera.updateProjectionMatrix();
    }
  }

  _buildLight(lightData) {
    let light;
    const color = this._ptaColorFromObj(lightData.color);

    // PTA's activateLight() sends light->color directly to glLightfv(GL_DIFFUSE)
    // WITHOUT multiplying by the intensity/multiplier field. Use intensity=1 and
    // let the color carry the full value (matching PTA's OpenGL behavior).
    const intensity = 1.0;

    switch (lightData.type) {
      case 1: // Omni
        // PTA falloff is not a Three.js distance — use 0 (infinite range) with no decay
        // to match PTA's default OpenGL lighting behavior
        light = new THREE.PointLight(color, intensity, 0, 0);
        break;
      case 2: // Spot
        light = new THREE.SpotLight(color, intensity);
        break;
      case 3: // Directional
        light = new THREE.DirectionalLight(color, intensity);
        break;
      default:
        light = new THREE.PointLight(color, intensity);
    }

    // Set position from matrix
    const pos = new THREE.Vector3();
    lightData.originMatrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
    light.position.copy(pos);

    // For spot lights, set target
    if (lightData.type === 2 && lightData.targetMatrix) {
      const targetPos = new THREE.Vector3();
      lightData.targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      light.target.position.copy(targetPos);
    }

    light.name = lightData.name;
    return light;
  }

  _buildDefaultLight(index = 0) {
    // Matches pta3DLight default constructor in the legacy engine.
    const light = new THREE.PointLight(new THREE.Color(1, 1, 1), 1.0, 0, 0);
    light.position.set(0, 100, 0);
    light.name = `__pta_default_light_${index}`;
    return light;
  }

  _updateLight(light, lightData, t) {
    if (lightData.posKeys && lightData.posKeys.length > 0) {
      const pos = interpolatePosition(lightData.posKeys, t);
      light.position.copy(pos);
    }

    // Animate light color from settingsKeys (color + intensity + falloff per keyframe)
    if (lightData.settingsKeys && lightData.settingsKeys.length > 0) {
      const keys = lightData.settingsKeys;
      let c;
      if (keys.length === 1 || t <= keys[0].t) {
        c = keys[0].color;
      } else if (t >= keys[keys.length - 1].t) {
        c = keys[keys.length - 1].color;
      } else {
        const msPerTick = keys[1].t - keys[0].t;
        let idx = msPerTick > 0 ? Math.floor((t - keys[0].t) / msPerTick) : 0;
        idx = Math.max(0, Math.min(idx, keys.length - 2));
        const k0 = keys[idx];
        const k1 = keys[idx + 1];
        const ct = msPerTick > 0 ? Math.max(0, Math.min(1, (t - k0.t) / msPerTick)) : 0;
        c = {
          r: k0.color.r + (k1.color.r - k0.color.r) * ct,
          g: k0.color.g + (k1.color.g - k0.color.g) * ct,
          b: k0.color.b + (k1.color.b - k0.color.b) * ct,
        };
      }
      if (this.ptaColorConstantsAreSRGB) {
        light.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
      } else {
        light.color.setRGB(c.r, c.g, c.b);
      }
    }
  }
}

/**
 * A managed scene instance.
 */
class ManagedScene {
  constructor(ptaScene) {
    this.ptaScene = ptaScene;
    this.threeScene = new THREE.Scene();
    this.meshes = new Map();
    this.cameras = new Map();
    this.lights = new Map();
    this.bgColor = null;
    this.animStartTime = ptaScene.animStartTime;
    this.animEndTime = ptaScene.animEndTime;
    // Lens flares parsed from helper userProps (populated by buildScene)
    this.lensFlares = [];
    this._lensFlareLastTimestamp = -1;
    // Scene-embedded particle systems from helper userProps
    this.particleSystems = [];
    this._particleLastTime = -1;
  }
}

/**
 * Scene-embedded particle system (matches C++ ptaParticleSystemStandard).
 * Created from helper objects with "particles" in their userDefined properties.
 */
class SceneParticleSystem {
  constructor(config) {
    this.numParticles = config.numParticles;
    this.particleLife = config.particleLife;
    this.particleSize = config.particleSize;
    this.speed = config.speed;
    this.coneAngle = config.coneAngle;
    this.additive = config.additive;
    this.loop = config.loop;
    this.acceleration = config.acceleration;
    this.texture = null;
    this.texturePath = config.texturePath;
    // Helper transform matrix (used for position/direction)
    this.helperMatrix = config.helperMatrix;

    // Per-particle data
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), life: 0, texID: 0 });
    }

    // Three.js rendering objects
    this.geometry = null;
    this.material = null;
    this.mesh = null;

    this._initParticles();
  }

  /**
   * Extract PTA's Y axis from the helper matrix.
   * PTA's getYaxis() reads ROW 1 of the raw matrix (M[1][0..2]).
   * After ptaToThreeMatrix → Matrix4.set(), PTA row 1 elements
   * end up at Three.js elements [1], [5], [9] (NOT column 1).
   * extractBasis() gives COLUMN 1 which differs from PTA row 1.
   */
  _getPtaYaxis() {
    const e = this.helperMatrix.elements;
    const y = new THREE.Vector3(e[1], e[5], e[9]);
    y.normalize();
    return y;
  }

  _initParticles() {
    // Extract origin and direction from helper matrix
    const origin = new THREE.Vector3();
    origin.setFromMatrixPosition(this.helperMatrix);
    const yAxis = this._getPtaYaxis();

    // Direction module = |(1,1,1) * speed| = speed * sqrt(3) (matches C++ init)
    const dirModule = this.speed * Math.sqrt(3);

    for (let i = 0; i < this.numParticles; i++) {
      const p = this.particles[i];
      this._resetParticle(p, origin, yAxis, dirModule);

      // Stagger initial lives (C++ init pattern)
      if (i & 1) {
        p.life = Math.floor(Math.random() * this.particleLife);
      } else {
        p.life = Math.floor(i * (this.particleLife / this.numParticles));
      }

      // Pre-position based on remaining life
      const elapsed = (this.particleLife - p.life) / 1000;
      p.pos.addScaledVector(p.dir, elapsed);
      if (this.acceleration) {
        p.pos.x += 0.5 * this.acceleration.x * elapsed * elapsed;
        p.pos.y += 0.5 * this.acceleration.y * elapsed * elapsed;
        p.pos.z += 0.5 * this.acceleration.z * elapsed * elapsed;
      }
    }
  }

  _resetParticle(p, origin, yDir, dirModule) {
    p.pos.copy(origin);

    if (this.coneAngle > 0.01 && dirModule > 0.001) {
      // Build direction with cone spread
      const dir = yDir.clone().multiplyScalar(dirModule);

      // Perpendicular vector
      let perpDir;
      if (Math.abs(dir.x) < 1e-5 && Math.abs(dir.y) > 1e-5 && Math.abs(dir.z) < 1e-5) {
        perpDir = new THREE.Vector3(dir.y, 0, 0);
      } else {
        perpDir = new THREE.Vector3(dir.z, 0, -dir.x);
      }

      // Random rotation #1: rotate perpDir around dir axis
      const dirNorm = dir.clone().normalize();
      const rotAngle1 = Math.random() * 360 * Math.PI / 180;
      perpDir.applyAxisAngle(dirNorm, rotAngle1);
      perpDir.normalize();

      // Random rotation #2: rotate dir around perpDir by cone angle
      const modifiedAngle = (Math.random() * this.coneAngle - this.coneAngle * 0.5) * Math.PI / 180;
      dir.applyAxisAngle(perpDir, modifiedAngle);

      p.dir.copy(dir);
    } else {
      p.dir.set(0, 0, 0);
    }

    if (p.life > 0) {
      p.life = Math.floor(Math.random() * this.particleLife);
    } else {
      p.life = p.life + this.particleLife;
    }
  }

  update(deltaMs) {
    const deltaSec = deltaMs / 1000;
    const origin = new THREE.Vector3();
    origin.setFromMatrixPosition(this.helperMatrix);
    const yAxis = this._getPtaYaxis();
    const dirModule = this.speed * Math.sqrt(3);

    for (let i = 0; i < this.numParticles; i++) {
      const p = this.particles[i];
      p.life -= deltaMs;

      if (p.life < 0 && this.loop) {
        this._resetParticle(p, origin, yAxis, dirModule);
        continue;
      }

      // Move particle
      p.pos.addScaledVector(p.dir, deltaSec);
      if (this.acceleration) {
        p.pos.x += 0.5 * this.acceleration.x * deltaSec * deltaSec;
        p.pos.y += 0.5 * this.acceleration.y * deltaSec * deltaSec;
        p.pos.z += 0.5 * this.acceleration.z * deltaSec * deltaSec;
      }
    }
  }

  buildRenderObjects(texture) {
    this.texture = texture;
    // Use THREE.Sprite for each particle — handles billboarding automatically
    this.sprites = [];
    this.spriteMaterials = [];
    this.group = new THREE.Group();

    for (let i = 0; i < this.numParticles; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: this.additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
        color: 0xb3b3b3, // 0.7, 0.7, 0.7
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.sprites.push(sprite);
      this.spriteMaterials.push(mat);
      this.group.add(sprite);
    }

    // Keep mesh reference for compatibility (null since we use sprites)
    this.mesh = null;
  }

  updateGeometry(camera) {
    if (!this.sprites) return;

    const recipLife = 1 / this.particleLife;
    const size = this.particleSize;

    for (let i = 0; i < this.numParticles; i++) {
      const p = this.particles[i];
      const sprite = this.sprites[i];

      if (p.life < 0) {
        sprite.visible = false;
        continue;
      }

      sprite.visible = true;
      sprite.position.copy(p.pos);
      sprite.scale.set(size, size, 1);
      this.spriteMaterials[i].opacity = p.life * recipLife;
    }
  }

  dispose() {
    if (this.spriteMaterials) {
      for (const m of this.spriteMaterials) m.dispose();
    }
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
