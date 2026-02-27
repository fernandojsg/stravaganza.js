import { DemoFX } from '../engine/DemoManager.js';
import { getTransformMatrix } from '../engine/AnimationSystem.js';
import * as THREE from 'three';

/**
 * FXEP10ParticledSpheres - 3D scene with multi-pass rendering:
 *
 * C++ doFrame rendering passes:
 * 1. Background fog-colored quad
 * 2. Linear fog setup (start=145, end=240)
 * 3. 'a'-prefixed objects: inner rotating spheres (solid + wireframe overlay)
 * 4. 'c'-prefixed objects: vertex-based billboard particles (per-vertex quads)
 * 5. 'b'-prefixed objects: exterior deformable objects with keyframe animation
 * 6. Particle systems: linked to 'p'-prefixed helpers, trail particles
 *
 * Original: FXEP10ParticledSpheres.cpp
 */

// C++ background/fog color: ptaColor(0.1137f, 0.1764f, 0.2196f)
const BG_COLOR = new THREE.Color(0.1137, 0.1764, 0.2196);
const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

// C++ ptaParticleSystemStandard init() parameters:
// init(wrp, helperPos, (0,5,0), (0,0,0), 360, 80, 3.0, 3.2, 800, true, tex, dat, 1, true, false)
const TRAIL_COUNT = 80;       // particles per trail system
const TRAIL_LIFE = 800;       // ms lifetime (life counts down)
const TRAIL_SIZE = 3.0;       // base particle size (world units)
const TRAIL_SCALE = 3.2;      // size growth factor over lifetime
const TRAIL_SPEED = 5.0;      // direction magnitude (from direction vector (0,5,0))

export class FXEP10ParticledSpheres extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEP10ParticledSpheres';

    this.sceneFile = '';
    this.particleTexture = '';
    this.textureDir = '';
    this.camera = '';
    this.sceneTime = 0;
    this.playSpeed = 1.0;

    /** @type {string|null} */
    this.sceneId = null;
    /** @type {THREE.Texture|null} */
    this.partTexture = null;

    // Multi-pass rendering state
    this.initialized = false;

    // 'a' objects: inner rotating spheres
    /** @type {Array<{mesh: THREE.Mesh, data: object, index: number}>} */
    this.aObjects = [];
    // 'b' objects: exterior deformable
    /** @type {Array<{mesh: THREE.Mesh, data: object}>} */
    this.bObjects = [];
    // 'c' objects: vertex billboard sources
    /** @type {Array<{data: object, index: number}>} */
    this.cObjects = [];

    /** @type {THREE.Texture|null} */
    this.sphereMapTexture = null;

    // Scenes for separate passes
    /** @type {THREE.Scene|null} */
    this.aScene = null;
    /** @type {THREE.Scene|null} */
    this.wireScene = null;
    /** @type {THREE.Scene|null} */
    this.bScene = null;
    /** @type {THREE.Scene|null} */
    this.cScene = null; // billboard particles
    /** @type {THREE.Scene|null} */
    this.trailScene = null; // particle trails

    // Wireframe objects synced to 'a' meshes
    /** @type {Array<{wire: THREE.LineSegments, mesh: THREE.Mesh}>} */
    this.wireObjects = [];
    /** @type {THREE.LineBasicMaterial|null} */
    this.wireMaterial = null;

    // Billboard mesh for 'c' objects
    /** @type {THREE.Mesh|null} */
    this.billboardMesh = null;

    // Particle trail systems linked to helpers
    /** @type {Array<ParticleTrail>} */
    this.trails = [];
    /** @type {THREE.Mesh|null} */
    this.trailMesh = null;

    // C++ scene manager computes particle delta from SCENE TIME, not fx time.
    // With playSpeed=0.2, sceneTimeDelta = 0.2 * fxTimeDelta.
    // Using fxTime delta directly would age particles 5x too fast.
    this.lastSceneTime = -1;

    // Crossfade: capture outgoing scene, render incoming, overlay captured with decreasing alpha
    this.fadeInMs = 0;
    /** @type {THREE.FramebufferTexture|null} */
    this.fadeTex = null;
    this._fadeTexW = 0;
    this._fadeTexH = 0;
    /** @type {THREE.Scene|null} */
    this.fadeCompScene = null;
    /** @type {THREE.ShaderMaterial|null} */
    this.fadeCompMaterial = null;
  }

  setup(sceneFile, particleTexture, textureDir, camera, sceneTime, playSpeed) {
    this.sceneFile = sceneFile;
    this.particleTexture = particleTexture;
    this.textureDir = textureDir;
    this.camera = camera;
    this.sceneTime = sceneTime;
    this.playSpeed = playSpeed;
  }

  /**
   * Configure crossfade-in duration. During fade-in, the scene is rendered to
   * an offscreen render target and composited over the framebuffer (which
   * contains the outgoing sphere scene from lower priority) with increasing
   * alpha, creating a true crossfade.
   * @param {number} fadeInMs - Fade-in duration in ms (0 = no fade)
   */
  setFade(fadeInMs) {
    this.fadeInMs = fadeInMs;
  }

  /** Ensure capture texture and composite quad exist and match viewport size. */
  _ensureFadeTex(w, h) {
    const dpr = window.devicePixelRatio || 1;
    const texW = Math.round(w * dpr);
    const texH = Math.round(h * dpr);

    if (this._fadeTexW === texW && this._fadeTexH === texH && this.fadeTex) return;

    if (this.fadeTex) this.fadeTex.dispose();
    this.fadeTex = new THREE.FramebufferTexture(texW, texH);
    this.fadeTex.minFilter = THREE.LinearFilter;
    this.fadeTex.magFilter = THREE.LinearFilter;
    this._fadeTexW = texW;
    this._fadeTexH = texH;

    if (!this.fadeCompMaterial) {
      // ShaderMaterial: outputs captured texture with forced alpha = uniform opacity.
      // No colorspace_fragment → avoids double sRGB encoding on the captured pixels.
      this.fadeCompMaterial = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null },
          opacity: { value: 0 },
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
            vec4 tex = texture2D(map, vUv);
            gl_FragColor = vec4(tex.rgb, opacity);
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
      const quad = new THREE.Mesh(geom, this.fadeCompMaterial);
      quad.position.set(0.5, 0.5, 0);
      this.fadeCompScene = new THREE.Scene();
      this.fadeCompScene.add(quad);
    }
  }

  async loadData(dm) {
    // Load particle texture
    if (this.particleTexture) {
      try {
        this.partTexture = await dm.assetManager.loadTextureByPath(this.particleTexture);
        // No sRGB — linear pipeline matches PTA's uncorrected rendering
      } catch (err) {
        console.warn(`FXEP10ParticledSpheres: failed to load particle texture "${this.particleTexture}":`, err.message);
      }
    }

    // Load scene
    if (this.sceneFile) {
      try {
        this.sceneId = `pspheres_${this.camera}_${Date.now()}`;
        this.ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
        const textures = this.textureDir
          ? await dm.assetManager.loadSceneTextures(this.ptaScene, this.textureDir)
          : new Map();
        dm.sceneManager.buildScene(this.sceneId, this.ptaScene, textures);
      } catch (err) {
        console.warn(`FXEP10ParticledSpheres: failed to load scene "${this.sceneFile}":`, err.message);
        this.sceneId = null;
      }
    }

    // Load sphere map texture for 'b' objects (material "2 - Default" uses refmap.jpg as tex2 sphere map)
    if (this.textureDir) {
      try {
        this.sphereMapTexture = await dm.assetManager.loadTextureByPath(this.textureDir + '/refmap.jpg');
        // No sRGB — linear pipeline matches PTA's uncorrected rendering
      } catch (err) {
        // Non-fatal — 'b' objects will just render without sphere map
      }
    }

    this.wireMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
  }

  /** Initialize per-object classification and separate scenes on first frame. */
  _init(managed, dm) {
    this.aScene = new THREE.Scene();
    this.wireScene = new THREE.Scene();
    this.bScene = new THREE.Scene();
    this.cScene = new THREE.Scene();
    this.trailScene = new THREE.Scene();

    // Add fog to scenes that need it
    const fogCol = BG_COLOR.clone();
    this.aScene.fog = new THREE.Fog(fogCol, 145, 240);
    this.wireScene.fog = new THREE.Fog(fogCol, 145, 240);
    this.bScene.fog = new THREE.Fog(fogCol, 145, 240);
    this.cScene.fog = new THREE.Fog(fogCol, 145, 240);
    this.trailScene.fog = new THREE.Fog(fogCol, 145, 240);

    // Add lights from main scene to sub-scenes (store clones for sync in doFrame)
    this.aLights = [];
    this.bLights = [];
    for (const [, { light }] of managed.lights) {
      const aLight = light.clone();
      const bLight = light.clone();
      this.aScene.add(aLight);
      this.bScene.add(bLight);
      this.aLights.push(aLight);
      this.bLights.push(bLight);
    }

    let cVertexCount = 0;
    let objectIndex = 0;

    for (const [name, { mesh, data }] of managed.meshes) {
      const prefix = name.charAt(0).toLowerCase();

      if (prefix === 'a') {
        // Inner spheres: clone mesh into A scene
        const clonedMesh = mesh.clone();
        clonedMesh.material = mesh.material.clone();
        // C++: flat shading for 'a' objects
        clonedMesh.material.flatShading = true;
        clonedMesh.material.needsUpdate = true;
        clonedMesh.matrixAutoUpdate = false;
        this.aScene.add(clonedMesh);

        this.aObjects.push({ mesh: clonedMesh, data, index: objectIndex });

        // Wireframe overlay
        const edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 1);
        const wireObj = new THREE.LineSegments(edgesGeom, this.wireMaterial);
        wireObj.matrixAutoUpdate = false;
        wireObj.matrix.copy(mesh.matrix);
        this.wireScene.add(wireObj);
        this.wireObjects.push({ wire: wireObj, mesh: clonedMesh });

      } else if (prefix === 'b') {
        // Exterior deformable objects — transparent with sphere-mapped env reflection.
        // C++: material "2 - Default" has tex1=white_trans.tga (solid white, 35% alpha)
        // and tex2=refmap.jpg (GL_SPHERE_MAP). GL_MODULATE: output = white × refmap × lighting.
        // Since white_trans is pure white, visual = refmap at 35% opacity.
        const clonedMesh = mesh.clone();
        clonedMesh.material = mesh.material.clone();
        clonedMesh.matrixAutoUpdate = false;

        // Apply sphere map texture and transparency
        if (this.sphereMapTexture) {
          clonedMesh.material.map = this.sphereMapTexture;
          clonedMesh.material.transparent = true;
          clonedMesh.material.opacity = 89 / 255; // white_trans.tga alpha = 89/255 ≈ 0.349
          clonedMesh.material.depthWrite = false;
          clonedMesh.material.needsUpdate = true;
          clonedMesh.material._hasSphereMap = true;
        }

        this.bScene.add(clonedMesh);
        this.bObjects.push({ mesh: clonedMesh, data });

      } else if (prefix === 'c') {
        // Count vertices for billboard mesh
        cVertexCount += data.numVertices;
        this.cObjects.push({ data, index: objectIndex });
      }

      // Hide from main scene
      mesh.visible = false;
      objectIndex++;
    }

    // Build billboard mesh for 'c' objects (6 verts per vertex = 2 triangles per quad)
    if (cVertexCount > 0 && this.partTexture) {
      const numQuads = cVertexCount;
      const numVerts = numQuads * 6;
      const positions = new Float32Array(numVerts * 3);
      const uvs = new Float32Array(numVerts * 2);

      // Pre-fill UVs
      for (let i = 0; i < numQuads; i++) {
        const base = i * 12;
        uvs[base + 0] = 0; uvs[base + 1] = 0;   // TL
        uvs[base + 2] = 0; uvs[base + 3] = 1;   // BL
        uvs[base + 4] = 1; uvs[base + 5] = 1;   // BR
        uvs[base + 6] = 0; uvs[base + 7] = 0;   // TL
        uvs[base + 8] = 1; uvs[base + 9] = 1;   // BR
        uvs[base + 10] = 1; uvs[base + 11] = 0; // TR
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

      // C++ particle texture is an alpha mask (black RGB, alpha-only shape).
      // GL_MODULATE: output = texture * glColor(1,1,1,0.7) → (0,0,0, tex.a*0.7)
      // Particles darken the background through alpha blending.
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsLib.fog,
          map: { value: this.partTexture },
          opacity: { value: 0.7 },
        },
        vertexShader: `
          #include <fog_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: `
          #include <fog_pars_fragment>
          uniform sampler2D map;
          uniform float opacity;
          varying vec2 vUv;
          void main() {
            vec4 texColor = texture2D(map, vUv);
            gl_FragColor = vec4(texColor.rgb, texColor.a * opacity);
            #include <fog_fragment>
          }
        `,
        fog: true,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
      });

      this.billboardMesh = new THREE.Mesh(geometry, material);
      this.billboardMesh.frustumCulled = false;
      this.cScene.add(this.billboardMesh);
    }

    // Create particle trail systems for p-prefixed helpers
    // C++ init: 80 particles, size=3.0, scaleFactor=3.2, life=800ms, speed=5.0, 360° cone, loop=true
    if (this.ptaScene && this.ptaScene.helpers && this.partTexture) {
      for (const helper of this.ptaScene.helpers) {
        if (helper.name.charAt(0).toLowerCase() === 'p') {
          const trail = new ParticleTrail(helper);
          trail.initParticles();
          this.trails.push(trail);
        }
      }

      // Pre-warm: simulate from time 0 to sceneTime in 10ms steps
      // C++: for(fTime=0; fTime<m_fStart; fTime+=10) { transform(fTime); update(10); }
      if (this.trails.length > 0) {
        for (let t = 0; t < this.sceneTime; t += 10) {
          for (const trail of this.trails) {
            trail.updateHelperMatrix(t);
            trail.step(10);
          }
        }
      }

      // Build trail billboard mesh
      if (this.trails.length > 0) {
        const totalParticles = this.trails.length * TRAIL_COUNT;
        const numVerts = totalParticles * 6;
        const positions = new Float32Array(numVerts * 3);
        const uvs = new Float32Array(numVerts * 2);
        const alphas = new Float32Array(numVerts);

        for (let i = 0; i < totalParticles; i++) {
          const base = i * 12;
          uvs[base + 0] = 0; uvs[base + 1] = 0;
          uvs[base + 2] = 0; uvs[base + 3] = 1;
          uvs[base + 4] = 1; uvs[base + 5] = 1;
          uvs[base + 6] = 0; uvs[base + 7] = 0;
          uvs[base + 8] = 1; uvs[base + 9] = 1;
          uvs[base + 10] = 1; uvs[base + 11] = 0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

        // C++ trail: setColor(0.7,0.7,0.7,alpha) + GL_MODULATE on black texture → (0,0,0, tex.a*alpha)
        const material = new THREE.ShaderMaterial({
          uniforms: {
            ...THREE.UniformsLib.fog,
            map: { value: this.partTexture },
          },
          vertexShader: `
            #include <fog_pars_vertex>
            attribute float alpha;
            varying vec2 vUv;
            varying float vAlpha;
            void main() {
              vUv = uv;
              vAlpha = alpha;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mvPosition;
              #include <fog_vertex>
            }
          `,
          fragmentShader: `
            #include <fog_pars_fragment>
            uniform sampler2D map;
            varying vec2 vUv;
            varying float vAlpha;
            void main() {
              vec4 texColor = texture2D(map, vUv);
              gl_FragColor = vec4(texColor.rgb, texColor.a * vAlpha);
              #include <fog_fragment>
            }
          `,
          fog: true,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.CustomBlending,
          blendSrc: THREE.SrcAlphaFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          blendEquation: THREE.AddEquation,
        });

        this.trailMesh = new THREE.Mesh(geometry, material);
        this.trailMesh.frustumCulled = false;
        this.trailScene.add(this.trailMesh);
      }
    }

    this.initialized = true;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId) return;
    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    if (!this.initialized) {
      this._init(managed, dm);
    }

    // Crossfade: capture outgoing scene (already in framebuffer from lower-priority
    // sphere), then render this sphere normally, then overlay captured scene on top
    // with decreasing alpha → result = A*(1-t) + B*t.
    const isFadingIn = this.fadeInMs > 0 && fxTime < this.fadeInMs;
    const gl = dm.renderer.webglRenderer;

    if (isFadingIn) {
      const vp = dm.renderer.currentViewport;
      const dpr = window.devicePixelRatio || 1;
      this._ensureFadeTex(vp.w, vp.h);
      // Capture the current framebuffer (contains outgoing scene A from lower-priority sphere)
      gl.copyFramebufferToTexture(this.fadeTex, new THREE.Vector2(
        Math.round(vp.x * dpr), Math.round(vp.y * dpr)
      ));
    }

    // Pass 1: Background fog-colored quad
    dm.renderer.drawColoredQuad(0.5, 0.5, 1.0, 1.0, BG_COLOR, 1.0);

    const sceneTime = this.sceneTime + fxTime * this.playSpeed;

    // Get camera
    const camEntry = managed.cameras.get(this.camera);
    if (!camEntry) return;
    dm.sceneManager._updateCamera(camEntry.camera, camEntry.data, sceneTime);
    const camera = camEntry.camera;
    camera.aspect = 2.0; // PTA_ASPECT
    camera.updateProjectionMatrix();

    // Update lights and sync clones to sub-scenes
    let lightIdx = 0;
    for (const [, { light, data }] of managed.lights) {
      dm.sceneManager._updateLight(light, data, sceneTime);
      // Sync cloned lights in aScene/bScene with updated original
      if (this.aLights[lightIdx]) {
        this.aLights[lightIdx].position.copy(light.position);
        this.aLights[lightIdx].color.copy(light.color);
        this.aLights[lightIdx].intensity = light.intensity;
      }
      if (this.bLights[lightIdx]) {
        this.bLights[lightIdx].position.copy(light.position);
        this.bLights[lightIdx].color.copy(light.color);
        this.bLights[lightIdx].intensity = light.intensity;
      }
      lightIdx++;
    }

    // C++ scene manager: particle delta = sceneTime - lastSceneTime (scene time, not real time).
    // "Dirty" init: on first call, set lastSceneTime = sceneTime → delta = 0.
    if (this.lastSceneTime < 0) {
      this.lastSceneTime = sceneTime;
    }
    const particleDelta = sceneTime - this.lastSceneTime;
    this.lastSceneTime = sceneTime;

    // --- Pass 2: 'a' objects (inner spheres) with rotation + wireframe ---
    // 'a' objects use regular UV-mapped cell.jpg texture (no sphere map).
    for (const entry of this.aObjects) {
      const baseMatrix = getTransformMatrix(sceneTime, entry.data, entry.data.transformMatrix);
      // C++: preRotateX/Y/Z((fxTime * 0.04) + (nCount * 40)) degrees
      // PTA preRotateX/Y/Z = post-multiply in column-major: TM * Rx * Ry * Rz
      const angle = (fxTime * 0.04 + entry.index * 40) * DEG_TO_RAD;
      const finalMatrix = baseMatrix.clone()
        .multiply(new THREE.Matrix4().makeRotationX(angle))
        .multiply(new THREE.Matrix4().makeRotationY(angle))
        .multiply(new THREE.Matrix4().makeRotationZ(angle));
      entry.mesh.matrix.copy(finalMatrix);
    }

    // Render 'a' objects solid
    dm.renderer.renderScene(this.aScene, camera);

    // Sync wireframe and render
    for (const { wire, mesh } of this.wireObjects) {
      wire.matrix.copy(mesh.matrix);
    }
    dm.renderer.renderScene(this.wireScene, camera);

    // --- Pass 3: 'c' objects as vertex billboard particles ---
    if (this.billboardMesh) {
      const camRight = new THREE.Vector3();
      const camUp = new THREE.Vector3();
      camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

      // C++: deltaX = view.getXaxis(true) * 2.0, deltaY = view.getYaxis(true) * 2.0
      const dxBase = camRight.clone().multiplyScalar(2.0);
      const dyBase = camUp.clone().multiplyScalar(2.0);

      const positions = this.billboardMesh.geometry.attributes.position.array;
      const pos = new THREE.Vector3();
      const dx = new THREE.Vector3();
      const dy = new THREE.Vector3();
      const v = new THREE.Vector3();
      const tv = new THREE.Vector3();

      let quadIdx = 0;
      for (const cObj of this.cObjects) {
        // C++: TM = getTM(sceneTime), then preRotateX/Y/Z((-fxTime*0.01) + (nCount*50))
        const baseTM = getTransformMatrix(sceneTime, cObj.data, cObj.data.transformMatrix);
        const angle = (-fxTime * 0.01 + cObj.index * 50) * DEG_TO_RAD;
        const tm = baseTM.clone()
          .multiply(new THREE.Matrix4().makeRotationX(angle))
          .multiply(new THREE.Matrix4().makeRotationY(angle))
          .multiply(new THREE.Matrix4().makeRotationZ(angle));

        // C++: per-object scale oscillation: delta + delta * sin(fxTime*0.003 + nCount*30) * 0.3
        const sizeMul = 1.0 + Math.sin(fxTime * 0.003 + cObj.index * 30) * 0.3;
        dx.copy(dxBase).multiplyScalar(sizeMul);
        dy.copy(dyBase).multiplyScalar(sizeMul);

        // For each vertex of this 'c' object, draw a billboard quad
        for (let vi = 0; vi < cObj.data.numVertices; vi++) {
          const vert = cObj.data.vertices[vi];
          // Transform vertex to world space
          tv.set(vert.x, vert.y, vert.z);
          pos.copy(tv).applyMatrix4(tm);

          const base = quadIdx * 18; // 6 verts * 3 components

          // TL = pos - dx*0.5 + dy*0.5
          v.copy(pos).addScaledVector(dx, -0.5).addScaledVector(dy, 0.5);
          positions[base + 0] = v.x; positions[base + 1] = v.y; positions[base + 2] = v.z;

          // BL = TL - dy
          v.sub(dy);
          positions[base + 3] = v.x; positions[base + 4] = v.y; positions[base + 5] = v.z;

          // BR = BL + dx
          v.add(dx);
          positions[base + 6] = v.x; positions[base + 7] = v.y; positions[base + 8] = v.z;

          // Triangle 2: TL, BR, TR
          v.copy(pos).addScaledVector(dx, -0.5).addScaledVector(dy, 0.5);
          positions[base + 9] = v.x; positions[base + 10] = v.y; positions[base + 11] = v.z;

          v.copy(pos).addScaledVector(dx, 0.5).addScaledVector(dy, -0.5);
          positions[base + 12] = v.x; positions[base + 13] = v.y; positions[base + 14] = v.z;

          v.add(dy);
          positions[base + 15] = v.x; positions[base + 16] = v.y; positions[base + 17] = v.z;

          quadIdx++;
        }
      }

      this.billboardMesh.geometry.attributes.position.needsUpdate = true;
      dm.renderer.renderScene(this.cScene, camera);
    }

    // --- Pass 4: 'b' objects (exterior deformable with sphere map) ---
    for (const entry of this.bObjects) {
      const matrix = getTransformMatrix(sceneTime, entry.data, entry.data.transformMatrix);
      entry.mesh.matrix.copy(matrix);

      // Compute GL_SPHERE_MAP UVs from view-space normals
      if (entry.mesh.material._hasSphereMap) {
        const normalAttr = entry.mesh.geometry.getAttribute('normal');
        if (normalAttr) {
          const count = normalAttr.count;
          let uvAttr = entry.mesh.geometry.getAttribute('uv');
          if (!uvAttr || uvAttr.count !== count) {
            uvAttr = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
            entry.mesh.geometry.setAttribute('uv', uvAttr);
          }

          const viewMatrix = camera.matrixWorldInverse;
          // Combined model-view normal matrix for transforming normals
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(
            new THREE.Matrix4().multiplyMatrices(viewMatrix, entry.mesh.matrix)
          );
          const n = new THREE.Vector3();

          for (let i = 0; i < count; i++) {
            n.set(normalAttr.array[i * 3], normalAttr.array[i * 3 + 1], normalAttr.array[i * 3 + 2]);
            n.applyMatrix3(normalMatrix).normalize();

            // GL_SPHERE_MAP: reflection of eye vector (0,0,-1) off normal
            const rx = 2.0 * n.z * n.x;
            const ry = 2.0 * n.z * n.y;
            const rz2 = 2.0 * n.z * n.z - 1.0;
            const m = 2.0 * Math.sqrt(rx * rx + ry * ry + (rz2 + 1.0) * (rz2 + 1.0));
            uvAttr.array[i * 2] = m > 0.0001 ? rx / m + 0.5 : 0.5;
            uvAttr.array[i * 2 + 1] = m > 0.0001 ? ry / m + 0.5 : 0.5;
          }
          uvAttr.needsUpdate = true;
        }
      }
    }
    dm.renderer.renderScene(this.bScene, camera);

    // --- Pass 5: Particle trails from p-prefixed helpers ---
    if (this.trailMesh && this.trails.length > 0) {
      for (const trail of this.trails) {
        trail.updateHelperMatrix(sceneTime);
        trail.step(particleDelta);
      }

      const camRight = new THREE.Vector3();
      const camUp = new THREE.Vector3();
      camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

      const positions = this.trailMesh.geometry.attributes.position.array;
      const alphaAttr = this.trailMesh.geometry.attributes.alpha.array;

      const v = new THREE.Vector3();
      const dx = new THREE.Vector3();
      const dy = new THREE.Vector3();
      let particleIdx = 0;

      for (const trail of this.trails) {
        for (let pi = 0; pi < TRAIL_COUNT; pi++) {
          const p = trail.particles[pi];
          const base = particleIdx * 18;
          const alphaBase = particleIdx * 6;

          if (p.life <= 0) {
            for (let k = 0; k < 18; k++) positions[base + k] = 0;
            for (let k = 0; k < 6; k++) alphaAttr[alphaBase + k] = 0;
            particleIdx++;
            continue;
          }

          // C++ alpha: life / particleLife (1.0 at birth → 0.0 at death)
          const alpha = p.life / TRAIL_LIFE;

          // C++ size growth: particleSize + particleSize * elapsed * 0.001 * scaleFactor
          // elapsed = particleLife - life (ms since birth)
          const fSize = TRAIL_SIZE + TRAIL_SIZE * (TRAIL_LIFE - p.life) * 0.001 * TRAIL_SCALE;

          // C++ billboard: scaledDelta = camAxis * fSize * 0.5, offset by ±0.5
          // Effective half-extent = fSize * 0.25
          const halfSize = fSize * 0.25;
          dx.copy(camRight).multiplyScalar(halfSize);
          dy.copy(camUp).multiplyScalar(halfSize);

          // TL = pos - dx + dy
          v.set(p.x, p.y, p.z).sub(dx).add(dy);
          positions[base + 0] = v.x; positions[base + 1] = v.y; positions[base + 2] = v.z;

          // BL = pos - dx - dy
          v.set(p.x, p.y, p.z).sub(dx).sub(dy);
          positions[base + 3] = v.x; positions[base + 4] = v.y; positions[base + 5] = v.z;

          // BR = pos + dx - dy
          v.set(p.x, p.y, p.z).add(dx).sub(dy);
          positions[base + 6] = v.x; positions[base + 7] = v.y; positions[base + 8] = v.z;

          // Triangle 2: TL, BR, TR
          v.set(p.x, p.y, p.z).sub(dx).add(dy);
          positions[base + 9] = v.x; positions[base + 10] = v.y; positions[base + 11] = v.z;

          v.set(p.x, p.y, p.z).add(dx).sub(dy);
          positions[base + 12] = v.x; positions[base + 13] = v.y; positions[base + 14] = v.z;

          // TR = pos + dx + dy
          v.set(p.x, p.y, p.z).add(dx).add(dy);
          positions[base + 15] = v.x; positions[base + 16] = v.y; positions[base + 17] = v.z;

          for (let k = 0; k < 6; k++) alphaAttr[alphaBase + k] = alpha;

          particleIdx++;
        }
      }

      this.trailMesh.geometry.attributes.position.needsUpdate = true;
      this.trailMesh.geometry.attributes.alpha.needsUpdate = true;
      dm.renderer.renderScene(this.trailScene, camera);
    }

    // --- Crossfade composite ---
    // Overlay the captured outgoing scene (A) on top of the incoming scene (B)
    // with decreasing alpha. Blending: result = A * alpha + B * (1 - alpha)
    // where alpha = 1 - fadeProgress. At t=0: all A. At t=1: all B.
    if (isFadingIn) {
      const fadeProgress = Math.min(1, fxTime / this.fadeInMs);
      const overlayAlpha = 1.0 - fadeProgress;
      this.fadeCompMaterial.uniforms.map.value = this.fadeTex;
      this.fadeCompMaterial.uniforms.opacity.value = overlayAlpha;
      gl.render(this.fadeCompScene, dm.renderer.orthoCamera);
    }
  }

  close() {
    this.sceneId = null;
    this.partTexture = null;
    this.sphereMapTexture = null;
    this.ptaScene = null;
    this.aObjects = [];
    this.bObjects = [];
    this.cObjects = [];
    this.wireObjects = [];
    this.aLights = [];
    this.bLights = [];
    this.trails = [];
    if (this.wireMaterial) { this.wireMaterial.dispose(); this.wireMaterial = null; }
    if (this.billboardMesh) {
      this.billboardMesh.geometry.dispose();
      this.billboardMesh.material.dispose();
    }
    if (this.trailMesh) {
      this.trailMesh.geometry.dispose();
      this.trailMesh.material.dispose();
    }
    if (this.fadeTex) { this.fadeTex.dispose(); this.fadeTex = null; }
    if (this.fadeCompMaterial) { this.fadeCompMaterial.dispose(); this.fadeCompMaterial = null; }
    this.fadeCompScene = null;
    this.billboardMesh = null;
    this.trailMesh = null;
    this.aScene = null;
    this.wireScene = null;
    this.bScene = null;
    this.cScene = null;
    this.trailScene = null;
    this.initialized = false;
    this.lastSceneTime = -1;
  }
}

/**
 * Particle trail system matching C++ ptaParticleSystemStandard exactly.
 *
 * C++ behavior:
 * - 80 particles pre-allocated, recycled on death (loop=true)
 * - life counts DOWN from 800ms to 0; recycled when life < 0
 * - Direction: random on sphere * 5.0 units/sec (360° cone = full sphere)
 * - Position: Euler integration pos += dir * dt (no acceleration)
 * - Alpha: life / particleLife (fades 1→0)
 * - Size: grows from 3.0 to ~10.68 over lifetime
 * - Init: staggered life + pre-positioned along velocity
 */
class ParticleTrail {
  constructor(helperData) {
    this.helperData = helperData;
    this.count = TRAIL_COUNT;
    this.helperPos = new THREE.Vector3();

    // Extract initial helper position
    if (helperData.transformMatrix instanceof THREE.Matrix4) {
      this.helperPos.setFromMatrixPosition(helperData.transformMatrix);
    }

    // Pre-allocate all particles (C++: no per-frame emission, pool-based recycling)
    this.particles = [];
    for (let i = 0; i < this.count; i++) {
      this.particles.push({
        x: 0, y: 0, z: 0,    // position
        dx: 0, dy: 0, dz: 0, // velocity (constant after reset)
        life: 0,               // remaining life in ms (counts down)
      });
    }
  }

  /** Initialize particles with staggered life and pre-positioning (C++ init + linkToMatrix). */
  initParticles() {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];

      // Position at helper origin
      p.x = this.helperPos.x;
      p.y = this.helperPos.y;
      p.z = this.helperPos.z;

      // Random direction on sphere * speed
      // C++ resetParticle: at init, particle.life=0, speed multiplier = 1.0
      this._randomDirection(p, TRAIL_SPEED);

      // C++ resetParticle sets life = 0 + particleLife = 800
      // Then staggering overrides it:
      // Even indices: evenly distributed across lifetime
      // Odd indices: random
      if (i & 1) {
        p.life = Math.floor(Math.random() * TRAIL_LIFE);
      } else {
        p.life = Math.floor(i * (TRAIL_LIFE / this.count));
      }

      // Pre-position: advance particle by elapsed time since "birth"
      // C++: fSeconds = (particleLife - life) / 1000; pos += dir * fSeconds
      const elapsed = (TRAIL_LIFE - p.life) / 1000;
      p.x += p.dx * elapsed;
      p.y += p.dy * elapsed;
      p.z += p.dz * elapsed;
    }
  }

  /** Set random direction on unit sphere scaled by speed. */
  _randomDirection(p, speed) {
    const theta = Math.random() * TWO_PI;
    const cosP = 2 * Math.random() - 1;
    const sinP = Math.sqrt(1 - cosP * cosP);
    p.dx = sinP * Math.cos(theta) * speed;
    p.dy = sinP * Math.sin(theta) * speed;
    p.dz = cosP * speed;
  }

  /** Update helper position from animated scene time. */
  updateHelperMatrix(sceneTime) {
    const m = getTransformMatrix(sceneTime, this.helperData, this.helperData.transformMatrix);
    this.helperPos.setFromMatrixPosition(m);
  }

  /** Step particle physics by deltaMs. */
  step(deltaMs) {
    if (deltaMs <= 0) return;
    const dtSec = deltaMs / 1000;

    for (const p of this.particles) {
      p.life -= deltaMs;

      if (p.life < 0) {
        // Recycle dead particle (C++ loop=true)
        this._resetParticle(p);
        continue; // C++ skips position update on reset frame
      }

      // Euler integration (no acceleration for this effect)
      p.x += p.dx * dtSec;
      p.y += p.dy * dtSec;
      p.z += p.dz * dtSec;
    }
  }

  /** Reset a dead particle at the current helper position with new random direction. */
  _resetParticle(p) {
    p.x = this.helperPos.x;
    p.y = this.helperPos.y;
    p.z = this.helperPos.z;

    // C++: speed multiplier = 1 + (-life / particleLife)
    // At recycle, life is slightly negative → multiplier ≈ 1.0
    const speedMul = 1.0 + (-p.life / TRAIL_LIFE);
    this._randomDirection(p, TRAIL_SPEED * speedMul);

    // Wrap life: C++ life = oldNegativeLife + particleLife
    p.life = p.life + TRAIL_LIFE;
  }
}
