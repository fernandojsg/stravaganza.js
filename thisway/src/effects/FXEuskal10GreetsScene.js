import { DemoFX } from '../engine/DemoManager.js';
import { getTransformMatrix } from '../engine/AnimationSystem.js';
import * as THREE from 'three';

/**
 * FXEuskal10GreetsScene - 3D greets scene with elasticity-based vertex deformation.
 *
 * Each "spike" object's vertices are deformed with a distance-based time delay,
 * creating a wave propagation/ripple effect. Non-spike objects are hidden.
 *
 * C++ original: FXEuskal10GreetsScene.cpp
 * - Per-vertex: fTimeRot = effectTime - (distance * elasticity)
 *               fTimePos = effectTime - (distance * elasticity * 0.2)
 * - Rotation: preRotateZ(fTimeRot * 0.06 degrees) — Z-axis ONLY
 * - Position: from TM at fTimePos (different delay than rotation)
 * - Final vertex = TM * initialLocalVertex (world space, mesh matrix = identity)
 * - Only objects with "spike" in name get deformed; others hidden
 * - Global time: effectTime = fxTime * speed + start
 * - Background: fog color quad (0.1137, 0.1764, 0.2196)
 * - Fog: linear 260-620, same color
 * - Camera: animated from keyframe data at effectTime
 */

const DEG_TO_RAD = Math.PI / 180;
const FOG_COLOR = new THREE.Color(0.1137, 0.1764, 0.2196);
const FOG_START = 260.0;
const FOG_END = 620.0;

export class FXEuskal10GreetsScene extends DemoFX {
  constructor() {
    super();
    this.name = 'FXEuskal10GreetsScene';

    this.deformAmount = 40; // elasticity
    this.sceneFile = '';
    this.textureDir = '';
    this.camera = '';
    this.sceneTime = 0;
    this.playSpeed = 1.0;

    /** @type {string|null} */
    this.sceneId = null;

    /**
     * Per-spike-object deformation data.
     * @type {Array<{mesh: THREE.Mesh, data: object, originalPositions: Float32Array, distances: Float32Array, hasAnimation: boolean}>}
     */
    this.spikeObjects = [];

    /** @type {THREE.Mesh|null} - Grid object for wireframe overlay */
    this.gridMesh = null;
    /** @type {THREE.LineSegments|null} - Quad-edge wireframe (no triangle diagonals) */
    this.gridWire = null;
    /** @type {THREE.LineBasicMaterial|null} */
    this.wireMaterial = null;

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

    this.initialized = false;
  }

  /**
   * @param {number} deformAmount - Elasticity coefficient (wave propagation delay per unit distance)
   * @param {string} sceneFile - Path to the PTA scene file
   * @param {string} textureDir - Path to the texture directory
   * @param {string} camera - Camera name to use
   * @param {number} sceneTime - Time offset (ms) added to effectTime
   * @param {number} playSpeed - Speed multiplier for effectTime
   */
  setup(deformAmount, sceneFile, textureDir, camera, sceneTime, playSpeed) {
    this.deformAmount = deformAmount;
    this.sceneFile = sceneFile;
    this.textureDir = textureDir;
    this.camera = camera;
    this.sceneTime = sceneTime;
    this.playSpeed = playSpeed;
  }

  /**
   * Configure crossfade-in duration. During fade-in, the outgoing scene
   * (from lower priority) is captured and overlaid with decreasing alpha.
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
    if (!this.sceneFile) return;
    try {
      this.sceneId = `greetsScene_${this.camera}_${Date.now()}`;
      const ptaScene = await dm.assetManager.loadPtaScene(this.sceneFile);
      const textures = this.textureDir
        ? await dm.assetManager.loadSceneTextures(ptaScene, this.textureDir)
        : new Map();
      dm.sceneManager.buildScene(this.sceneId, ptaScene, textures);
    } catch (err) {
      console.warn(`FXEuskal10GreetsScene: failed to load scene "${this.sceneFile}":`, err.message);
      this.sceneId = null;
    }

    // Black line material for quad-edge grid overlay
    this.wireMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
  }

  /** Initialize spike objects: store original vertices, compute distances, hide non-spikes. */
  _initObjects(managed) {
    for (const [name, { mesh, data }] of managed.meshes) {
      if (name.toLowerCase().includes('spike')) {
        // Mark as deformable: store original local vertices, normals, and distances
        const posAttr = mesh.geometry.getAttribute('position');
        const originalPositions = new Float32Array(posAttr.array);
        const normalAttr = mesh.geometry.getAttribute('normal');
        const originalNormals = normalAttr ? new Float32Array(normalAttr.array) : null;
        const distances = new Float32Array(posAttr.count);

        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.array[i * 3];
          const y = posAttr.array[i * 3 + 1];
          const z = posAttr.array[i * 3 + 2];
          distances[i] = Math.sqrt(x * x + y * y + z * z);
        }

        const hasAnimation = (
          (data.posKeys && data.posKeys.length > 0) ||
          (data.rotKeys && data.rotKeys.length > 0) ||
          (data.sclKeys && data.sclKeys.length > 0)
        );

        // calamar.tga: mostly uniform RGB, cloud pattern in alpha.
        // Original C++ path: fogged fragment color blended over fog-colored background:
        //   out = foggedTex * alpha + fogColor * (1 - alpha)
        // Since bg == fogColor in this effect, this collapses to:
        //   out = mix(fogColor, tex.rgb, alpha * fogFactor(distance))
        // Use an opaque shader that applies this closed-form expression directly.
        // This preserves depth-dependent fading without transparent sorting artifacts.
        if (mesh.material && mesh.material.map) {
          const origMat = mesh.material;
          const fogC = FOG_COLOR;
          mesh.material = new THREE.ShaderMaterial({
            uniforms: {
              map: { value: origMat.map },
              bgColor: { value: new THREE.Color(fogC.r, fogC.g, fogC.b) },
              fogNear: { value: FOG_START },
              fogFar: { value: FOG_END },
            },
            vertexShader: /* glsl */ `
              varying vec2 vUv;
              varying float vFogDepth;
              void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vFogDepth = -mvPosition.z;
                gl_Position = projectionMatrix * mvPosition;
              }
            `,
            fragmentShader: /* glsl */ `
              uniform sampler2D map;
              uniform vec3 bgColor;
              uniform float fogNear;
              uniform float fogFar;
              varying vec2 vUv;
              varying float vFogDepth;
              void main() {
                vec4 tex = texture2D(map, vUv);
                float fogFactor = clamp((fogFar - vFogDepth) / (fogFar - fogNear), 0.0, 1.0);
                float k = tex.a * fogFactor;
                vec3 color = mix(bgColor, tex.rgb, k);
                gl_FragColor = vec4(color, 1.0);
              }
            `,
            side: origMat.side,
          });
          mesh.material._hasSphereMap = origMat._hasSphereMap;
          origMat.dispose();
        } else if (mesh.material) {
          mesh.material.transparent = false;
        }

        // Vertices are deformed to world space with identity mesh matrix each frame.
        // Bounding sphere would be stale → disable frustum culling to prevent disappearing.
        mesh.frustumCulled = false;

        this.spikeObjects.push({ mesh, data, originalPositions, originalNormals, distances, hasAnimation });
      } else if (name.toLowerCase() === 'grid') {
        // C++: grid rendered as wireframe with GL_QUADS → only quad edges, no diagonals.
        // PTA splits quads into consecutive triangle pairs in the index buffer.
        // Reconstruct quad edges by finding the non-shared edges of each triangle pair.
        this.gridMesh = mesh;
        this.gridWire = this._buildQuadWireframe(mesh, data, managed.threeScene);
        mesh.visible = false;
      } else {
        // C++: non-spike, non-grid objects are hidden (setActive(false))
        mesh.visible = false;
      }
    }
  }

  /**
   * Build quad-edge wireframe using original PTA face indices.
   * 3DS Max exporter splits quads into consecutive triangle pairs.
   * For each pair, find the shared edge (diagonal) by integer index comparison and exclude it.
   */
  _buildQuadWireframe(mesh, data, threeScene) {
    const faces = data.faces;
    const verts = data.vertices;
    if (!faces || !verts || faces.length < 2) return null;

    const lines = [];
    const pushEdge = (a, b) => {
      lines.push(verts[a].x, verts[a].y, verts[a].z, verts[b].x, verts[b].y, verts[b].z);
    };

    // Process consecutive face pairs as quads
    for (let f = 0; f + 1 < faces.length; f += 2) {
      const idx0 = [faces[f].v0, faces[f].v1, faces[f].v2];
      const idx1 = [faces[f + 1].v0, faces[f + 1].v1, faces[f + 1].v2];

      // Find shared vertex indices between the two triangles
      const shared0 = []; // positions in idx0 that match idx1
      const shared1 = []; // positions in idx1 that match idx0
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (idx0[i] === idx1[j]) {
            shared0.push(i);
            shared1.push(j);
            break;
          }
        }
      }

      if (shared0.length === 2) {
        // Quad found: skip the diagonal (edge connecting the 2 shared vertices)
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3;
          if (!(shared0.includes(i) && shared0.includes(j))) pushEdge(idx0[i], idx0[j]);
        }
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3;
          if (!(shared1.includes(i) && shared1.includes(j))) pushEdge(idx1[i], idx1[j]);
        }
      } else {
        // Not a quad pair — draw all edges
        for (let i = 0; i < 3; i++) pushEdge(idx0[i], idx0[(i + 1) % 3]);
        for (let i = 0; i < 3; i++) pushEdge(idx1[i], idx1[(i + 1) % 3]);
      }
    }

    if (lines.length === 0) return null;

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    const wire = new THREE.LineSegments(lineGeom, this.wireMaterial);
    wire.matrixAutoUpdate = false;
    wire.matrix.copy(mesh.matrix);
    wire.visible = false;
    threeScene.add(wire);
    return wire;
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.sceneId) return;

    const managed = dm.sceneManager.getScene(this.sceneId);
    if (!managed) return;

    if (!this.initialized) {
      this._initObjects(managed);
      this.initialized = true;
    }

    // C++: fxTime = (fxTime * m_fSpeed) + m_fStart
    const effectTime = (fxTime * this.playSpeed) + this.sceneTime;

    // Crossfade: capture outgoing scene (already in framebuffer from lower-priority
    // effect), then render this scene normally, then overlay captured scene on top
    // with decreasing alpha → result = A*(1-t) + B*t.
    const isFadingIn = this.fadeInMs > 0 && fxTime < this.fadeInMs;
    const gl = dm.renderer.webglRenderer;

    if (isFadingIn) {
      const vp = dm.renderer.currentViewport;
      const dpr = window.devicePixelRatio || 1;
      this._ensureFadeTex(vp.w, vp.h);
      // Capture the current framebuffer (contains outgoing scene A from lower-priority effect)
      gl.copyFramebufferToTexture(this.fadeTex, new THREE.Vector2(
        Math.round(vp.x * dpr), Math.round(vp.y * dpr)
      ));
    }

    // Background: full-screen fog-colored quad
    dm.renderer.drawColoredQuad(0.5, 0.5, 1, 1, FOG_COLOR, 1.0);

    // Set fog on the scene
    if (!managed.threeScene.fog) {
      managed.threeScene.fog = new THREE.Fog(FOG_COLOR, FOG_START, FOG_END);
    }

    // --- Deform each spike object ---
    const v = new THREE.Vector3();
    const tm = new THREE.Matrix4();
    const rz = new THREE.Matrix4();

    for (const spike of this.spikeObjects) {
      const posAttr = spike.mesh.geometry.getAttribute('position');
      const origPos = spike.originalPositions;
      const count = posAttr.count;

      for (let i = 0; i < count; i++) {
        const dist = spike.distances[i];

        // C++: fTimeRot = fEffectTime - (fDistance * m_fElasticity)
        // NO +1000 offset (unlike FXBonedSpike)
        const fTimeRot = effectTime - (dist * this.deformAmount);
        const fTimePos = effectTime - (dist * this.deformAmount * 0.2);

        // Get animation TM at rotation-delayed time
        if (spike.hasAnimation) {
          const animTM = getTransformMatrix(fTimeRot, spike.data, spike.data.transformMatrix);
          tm.copy(animTM);
        } else {
          tm.copy(spike.data.transformMatrix);
        }

        // C++: preRotateZ(fTimeRot * 0.06f) — Z-axis ONLY (unlike FXBonedSpike X+Y+Z)
        const angleRad = fTimeRot * 0.06 * DEG_TO_RAD;
        rz.makeRotationZ(angleRad);
        tm.multiply(rz);

        // Replace position with position from position-delayed TM
        if (spike.hasAnimation) {
          const posTM = getTransformMatrix(fTimePos, spike.data, spike.data.transformMatrix);
          tm.elements[12] = posTM.elements[12];
          tm.elements[13] = posTM.elements[13];
          tm.elements[14] = posTM.elements[14];
        }

        // Transform original local vertex by the composed TM → world space
        v.set(origPos[i * 3], origPos[i * 3 + 1], origPos[i * 3 + 2]);
        v.applyMatrix4(tm);

        posAttr.array[i * 3] = v.x;
        posAttr.array[i * 3 + 1] = v.y;
        posAttr.array[i * 3 + 2] = v.z;

        // C++: normals are NOT rotated after vertex deformation.
        // Original smooth normals from PTA file persist unchanged in the geometry.
        // Normals only affect sphere map UV computation (material is unlit MeshBasicMaterial).
      }

      posAttr.needsUpdate = true;

      // C++: TM.loadIdentity() — vertices are now in world space
      spike.mesh.matrix.identity();
    }

    // --- Animate camera at effectTime ---
    const camEntry = managed.cameras.get(this.camera);
    if (camEntry) {
      dm.sceneManager._updateCamera(camEntry.camera, camEntry.data, effectTime);
    }

    // --- Compute GL_SPHERE_MAP UVs from normals for sphere-mapped materials ---
    if (camEntry && this.spikeObjects.length > 0 && this.spikeObjects[0].mesh.material._hasSphereMap) {
      // Camera position/quaternion was just set by _updateCamera, but matrixWorldInverse
      // isn't updated until the renderer renders. Force update now for correct UVs.
      camEntry.camera.updateMatrixWorld(true);
      const viewMatrix = camEntry.camera.matrixWorldInverse;
      const n = new THREE.Vector3();

      for (const spike of this.spikeObjects) {
        const normalAttr = spike.mesh.geometry.getAttribute('normal');
        if (!normalAttr) continue;
        const count = normalAttr.count;

        // Ensure UV attribute exists with correct size
        let uvAttr = spike.mesh.geometry.getAttribute('uv');
        if (!uvAttr || uvAttr.count !== count) {
          uvAttr = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
          spike.mesh.geometry.setAttribute('uv', uvAttr);
        }

        // GL_SPHERE_MAP: UVs from view-space reflection vector
        // For each vertex: transform normal to view space, compute sphere map coords
        const posAttr = spike.mesh.geometry.getAttribute('position');
        for (let i = 0; i < count; i++) {
          // View-space normal (mesh matrix is identity, so world normal = geometry normal)
          n.set(normalAttr.array[i * 3], normalAttr.array[i * 3 + 1], normalAttr.array[i * 3 + 2]);
          n.transformDirection(viewMatrix);

          // GL_SPHERE_MAP formula: based on reflection of eye vector off the normal
          // Simplified: for view-space, eye direction is (0,0,-1)
          // reflection r = -eye + 2*(eye·n)*n = (2*nz*nx, 2*nz*ny, 2*nz*nz - 1)
          // But the classic GL formula uses: m = 2*sqrt(rx² + ry² + (rz+1)²)
          // s = rx/m + 0.5, t = ry/m + 0.5
          const rx = 2.0 * n.z * n.x;
          const ry = 2.0 * n.z * n.y;
          const rz2 = 2.0 * n.z * n.z - 1.0;
          const m = 2.0 * Math.sqrt(rx * rx + ry * ry + (rz2 + 1.0) * (rz2 + 1.0));
          const u = m > 0.0001 ? rx / m + 0.5 : 0.5;
          const vCoord = m > 0.0001 ? ry / m + 0.5 : 0.5;

          uvAttr.array[i * 2] = u;
          uvAttr.array[i * 2 + 1] = vCoord;
        }
        uvAttr.needsUpdate = true;
      }
    }

    // Pass 1: Filled render (time=-1: skip keyframe animation, use our vertex data)
    dm.sceneManager.renderScene(this.sceneId, -1, this.camera, 1.0);

    // Pass 2: Black quad-edge wireframe overlay on grid only.
    // C++: disables fog, texturing, lighting; sets wireframe mode + black color.
    if (this.gridWire) {
      for (const spike of this.spikeObjects) spike.mesh.visible = false;
      const origFog = managed.threeScene.fog;
      managed.threeScene.fog = null; // C++: disables fog for grid pass
      this.gridWire.visible = true;
      dm.sceneManager.renderScene(this.sceneId, -1, this.camera, 1.0);
      this.gridWire.visible = false;
      managed.threeScene.fog = origFog;
      for (const spike of this.spikeObjects) spike.mesh.visible = true;
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
    // Restore visibility of hidden objects
    if (this.sceneId) {
      // Note: scene may have been cleaned up already
    }
    this.sceneId = null;
    this.spikeObjects = [];
    this.gridMesh = null;
    if (this.gridWire) { this.gridWire.geometry.dispose(); this.gridWire = null; }
    this.initialized = false;
    if (this.wireMaterial) { this.wireMaterial.dispose(); this.wireMaterial = null; }
    if (this.fadeTex) { this.fadeTex.dispose(); this.fadeTex = null; }
    if (this.fadeCompMaterial) { this.fadeCompMaterial.dispose(); this.fadeCompMaterial = null; }
    this.fadeCompScene = null;
  }
}
