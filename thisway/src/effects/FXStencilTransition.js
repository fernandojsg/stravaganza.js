import { DemoFX } from '../engine/DemoManager.js';
import * as THREE from 'three';

/**
 * FXTransitionCapture - Helper that captures framebuffer for stencil transitions.
 *
 * Registered at a LOW priority (before new scene content) to capture the
 * "old" content into the transition's texture. Also clears the full
 * framebuffer and sets the demo viewport, matching C++ behavior where
 * the transition calls clearImageAndZBuffer() + setViewport() after capture.
 *
 * The companion transition effect is registered at a HIGH priority (after
 * new scene content) to render the captured old content as tile overlays.
 * This two-phase approach replaces C++'s stencil buffer mechanism.
 */
export class FXTransitionCapture extends DemoFX {
  /**
   * @param {FXStencilTransitionScaleOut|FXStencilTransitionExplosionOut} transitionEffect
   */
  constructor(transitionEffect) {
    super();
    this.name = 'FXTransitionCapture';
    this.transition = transitionEffect;
  }

  async loadData(dm) {}

  doFrame(fxTime, demoTime, dm) {
    const renderer = dm.renderer;
    const gl = renderer.webglRenderer;

    // Ensure capture texture matches current viewport (e.g. 512x512 from ViewportInt)
    const vp = renderer.currentViewport;
    this.transition._ensureTexture(vp.w, vp.h);

    // Capture current framebuffer (old scene content).
    // Must pass viewport position — demo viewport is vertically offset (centered
    // with black bars). Without this, capture reads from (0,0) = canvas bottom,
    // causing the captured image to appear shifted up.
    const dpr = window.devicePixelRatio || 1;
    gl.copyFramebufferToTexture(this.transition.texCapture, new THREE.Vector2(
      Math.round(vp.x * dpr), Math.round(vp.y * dpr)
    ));

    // Clear entire framebuffer (C++ clearImageAndZBuffer clears everything)
    renderer.resetViewport();
    renderer.clear(0x000000);

    // Set demo viewport for subsequent new-scene effects
    renderer.setDemoViewport();
  }

  close() {}
}

/**
 * FXStencilTransitionScaleOut - Grid-based scale-out stencil transition.
 *
 * Renders captured old-scene content through a grid of tiles that
 * progressively shrink to nothing, revealing the new scene underneath.
 *
 * Must be paired with FXTransitionCapture at a lower priority to capture
 * old content before the new scene renders. This effect renders at a
 * higher priority (after new scene) as an overlay.
 *
 * Original: FXStencilTransition.cpp (ScaleOut variant)
 */
export class FXStencilTransitionScaleOut extends DemoFX {
  constructor() {
    super();
    this.name = 'FXStencilTransitionScaleOut';

    this.gridW = 20;
    this.gridH = 10;
    this.duration = 600;

    /** @type {THREE.FramebufferTexture|null} */
    this.texCapture = null;
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {THREE.Mesh[]} */
    this.tiles = [];

    this._texW = 0;
    this._texH = 0;
  }

  setup(gridW, gridH, duration) {
    this.gridW = gridW;
    this.gridH = gridH;
    this.duration = duration;
  }

  /**
   * Ensure the capture texture matches the given dimensions.
   * Called by FXTransitionCapture before capturing.
   */
  _ensureTexture(w, h) {
    if (this._texW === w && this._texH === h && this.texCapture) return;

    if (this.texCapture) this.texCapture.dispose();

    const dpr = window.devicePixelRatio || 1;
    this.texCapture = new THREE.FramebufferTexture(w * dpr, h * dpr);
    this.texCapture.minFilter = THREE.LinearFilter;
    this.texCapture.magFilter = THREE.LinearFilter;

    // Update all tile materials to reference the new texture
    for (const tile of this.tiles) {
      tile.material.map = this.texCapture;
    }

    this._texW = w;
    this._texH = h;
  }

  async loadData(dm) {
    this.scene = new THREE.Scene();
    this.tiles = [];

    const tileW = 1 / this.gridW;
    const tileH = 1 / this.gridH;

    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const geom = new THREE.PlaneGeometry(tileW, tileH);

        const u0 = gx / this.gridW;
        const u1 = (gx + 1) / this.gridW;
        const v0 = gy / this.gridH;
        const v1 = (gy + 1) / this.gridH;

        const uvs = geom.attributes.uv.array;
        uvs[0] = u0; uvs[1] = v1;
        uvs[2] = u1; uvs[3] = v1;
        uvs[4] = u0; uvs[5] = v0;
        uvs[6] = u1; uvs[7] = v0;

        const mat = new THREE.MeshBasicMaterial({
          map: null, // Set lazily by _ensureTexture
          depthTest: false,
          depthWrite: false,
        });

        const mesh = new THREE.Mesh(geom, mat);
        const cx = (gx + 0.5) * tileW;
        const cy = (gy + 0.5) * tileH;
        mesh.position.set(cx, cy, 0);

        this.tiles.push(mesh);
        this.scene.add(mesh);
      }
    }
  }

  /**
   * Animate tiles shrinking and render as overlay on top of new scene.
   * Old content (captured by FXTransitionCapture) shows through the tiles;
   * as tiles shrink, the new scene (rendered below) is revealed.
   */
  doFrame(fxTime, demoTime, dm) {
    if (!this.scene || !this.texCapture) return;

    const gl = dm.renderer.webglRenderer;

    const globalT = this.duration > 0
      ? Math.max(0, Math.min(1, fxTime / this.duration))
      : 1;

    const scale = Math.max(0, 1.0 - globalT);
    for (const tile of this.tiles) {
      tile.scale.set(scale, scale, 1);
      tile.visible = scale > 0.001;
    }

    gl.render(this.scene, dm.renderer.orthoCamera);
  }

  close() {
    for (const tile of this.tiles) {
      tile.geometry.dispose();
      tile.material.dispose();
    }
    this.tiles = [];
    if (this.texCapture) { this.texCapture.dispose(); this.texCapture = null; }
    this.scene = null;
  }
}

/**
 * FXStencilTransitionExplosionOut - Explosion-style stencil transition.
 *
 * Renders captured old-scene content through tiles that rotate and fly
 * outward from center, fading out. Must be paired with FXTransitionCapture.
 *
 * Original: FXStencilTransition.cpp (ExplosionOut variant)
 */
export class FXStencilTransitionExplosionOut extends DemoFX {
  constructor() {
    super();
    this.name = 'FXStencilTransitionExplosionOut';

    this.gridW = 20;
    this.gridH = 20;
    this.duration = 500;

    /** @type {THREE.FramebufferTexture|null} */
    this.texCapture = null;
    /** @type {THREE.Scene|null} */
    this.scene = null;
    /** @type {THREE.Mesh[]} */
    this.tiles = [];

    this._texW = 0;
    this._texH = 0;
  }

  setup(gridW, gridH, duration) {
    this.gridW = gridW;
    this.gridH = gridH;
    this.duration = duration;
  }

  _ensureTexture(w, h) {
    if (this._texW === w && this._texH === h && this.texCapture) return;

    if (this.texCapture) this.texCapture.dispose();

    const dpr = window.devicePixelRatio || 1;
    this.texCapture = new THREE.FramebufferTexture(w * dpr, h * dpr);
    this.texCapture.minFilter = THREE.LinearFilter;
    this.texCapture.magFilter = THREE.LinearFilter;

    for (const tile of this.tiles) {
      tile.material.map = this.texCapture;
    }

    this._texW = w;
    this._texH = h;
  }

  async loadData(dm) {
    this.scene = new THREE.Scene();
    this.tiles = [];

    const tileW = 1 / this.gridW;
    const tileH = 1 / this.gridH;

    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const geom = new THREE.PlaneGeometry(tileW, tileH);

        const u0 = gx / this.gridW;
        const u1 = (gx + 1) / this.gridW;
        const v0 = gy / this.gridH;
        const v1 = (gy + 1) / this.gridH;

        const uvs = geom.attributes.uv.array;
        uvs[0] = u0; uvs[1] = v1;
        uvs[2] = u1; uvs[3] = v1;
        uvs[4] = u0; uvs[5] = v0;
        uvs[6] = u1; uvs[7] = v0;

        // C++ tiles are fully opaque — no transparency or blending
        const mat = new THREE.MeshBasicMaterial({
          map: null,
          depthTest: false,
          depthWrite: false,
        });

        const mesh = new THREE.Mesh(geom, mat);
        const cx = (gx + 0.5) * tileW;
        const cy = (gy + 0.5) * tileH;
        mesh.position.set(cx, cy, 0);

        mesh.userData.startX = cx;
        mesh.userData.startY = cy;

        // Radial direction: from screen center (0.5, 0.5) outward to tile center.
        // C++ uses grid-index-based direction with m_nNumHorQuads for both axes,
        // but the result is equivalent to normalized (center → tile) direction.
        // C++ grid Y=0 is screen top; our Y=0 is screen bottom — computing from
        // actual tile positions avoids the inversion issue.
        const dx = cx - 0.5;
        const dy = cy - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        mesh.userData.dirX = dx / dist;
        mesh.userData.dirY = dy / dist;

        // C++ rotation speed: 0.1 + 0.7 * rand [0,1] degrees/ms, same for all 3 axes
        mesh.userData.normRand = Math.random();
        mesh.userData.rotSpeed = 0.1 + 0.7 * mesh.userData.normRand;

        this.tiles.push(mesh);
        this.scene.add(mesh);
      }
    }
  }

  /**
   * Animate tiles exploding outward and render as overlay.
   * C++ transform order per tile:
   *   1. Translate to origin (-center)
   *   2. RotateX/Y/Z(fxTime * rotSpeed)  — same angle for all 3 axes
   *   3. Translate back (center + z-drift)
   *   4. Translate radially outward
   */
  doFrame(fxTime, demoTime, dm) {
    if (!this.scene || !this.texCapture) return;

    const gl = dm.renderer.webglRenderer;
    const DEG_TO_RAD = Math.PI / 180;

    const fDistance = this.duration > 0
      ? (fxTime / this.duration) * 0.4
      : 0.4;

    for (const tile of this.tiles) {
      // C++ rotation: fxTime * rotSpeed degrees around X, Y, Z (same angle)
      const angleDeg = fxTime * tile.userData.rotSpeed;
      const angleRad = angleDeg * DEG_TO_RAD;
      tile.rotation.set(angleRad, angleRad, angleRad, 'XYZ');

      // C++ position: center + radial direction * distance + z-drift
      tile.position.x = tile.userData.startX + tile.userData.dirX * fDistance;
      tile.position.y = tile.userData.startY + tile.userData.dirY * fDistance;
      tile.position.z = fxTime * 0.002;
    }

    gl.render(this.scene, dm.renderer.orthoCamera);
  }

  close() {
    for (const tile of this.tiles) {
      tile.geometry.dispose();
      tile.material.dispose();
    }
    this.tiles = [];
    if (this.texCapture) { this.texCapture.dispose(); this.texCapture = null; }
    this.scene = null;
  }
}
