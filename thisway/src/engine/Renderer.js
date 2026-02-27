import * as THREE from 'three';

/**
 * Renderer - Three.js rendering setup matching original PTA demo.
 * Original: 800x600, with 70% vertical viewport (420px centered, 90px black bars).
 */

// PTA blend mode constants (from Pta3DWrapper.h)
export const BlendMode = {
  ZERO: 0,
  ONE: 1,
  SRCCOLOR: 2,
  INVSRCCOLOR: 3,
  SRCALPHA: 4,
  INVSRCALPHA: 5,
  DSTALPHA: 6,
  INVDSTALPHA: 7,
  DSTCOLOR: 8,
  INVDSTCOLOR: 9,
};

// Map PTA blend modes to Three.js blend factors
const BLEND_FACTOR_MAP = {
  [BlendMode.ZERO]: THREE.ZeroFactor,
  [BlendMode.ONE]: THREE.OneFactor,
  [BlendMode.SRCCOLOR]: THREE.SrcColorFactor,
  [BlendMode.INVSRCCOLOR]: THREE.OneMinusSrcColorFactor,
  [BlendMode.SRCALPHA]: THREE.SrcAlphaFactor,
  [BlendMode.INVSRCALPHA]: THREE.OneMinusSrcAlphaFactor,
  [BlendMode.DSTALPHA]: THREE.DstAlphaFactor,
  [BlendMode.INVDSTALPHA]: THREE.OneMinusDstAlphaFactor,
  [BlendMode.DSTCOLOR]: THREE.DstColorFactor,
  [BlendMode.INVDSTCOLOR]: THREE.OneMinusDstColorFactor,
};

export class Renderer {
  /**
   * @param {HTMLElement} container
   * @param {number} width - Demo native width (800)
   * @param {number} height - Demo native height (600)
   */
  constructor(container, width = 800, height = 600) {
    this.container = container;
    this.demoWidth = width;
    this.demoHeight = height;

    // The demo viewport is 70% of vertical space, centered
    this.viewportRatio = 0.7;

    // Three.js WebGL renderer
    this.webglRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: true,
      depth: true,
    });
    this.webglRenderer.setPixelRatio(window.devicePixelRatio);
    this.webglRenderer.setSize(width, height);
    this.webglRenderer.autoClear = false;
    // PTA uses an uncorrected pipeline: no sRGB decode on textures, no sRGB encode on output.
    // Texture bytes go file → shader → screen (screen interprets as sRGB).
    // Linear output matches this exactly. sRGB output would lift shadows/mid-tones.
    this.webglRenderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.webglRenderer.setClearColor(0x000000, 1);
    container.appendChild(this.webglRenderer.domElement);

    // Orthographic camera for 2D rendering (0-1 normalized coords)
    // Standard Y-up: (0,0) = bottom-left, (1,1) = top-right
    // PTA uses (0,0) = top-left — we flip Y in draw methods instead of
    // flipping the camera (which would cause texture V-flip issues).
    this.orthoCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

    // Fullscreen quad scene for 2D effects
    this.quadScene = new THREE.Scene();

    // Render targets for framebuffer effects
    this.renderTargets = new Map();

    // Current viewport state
    this.currentViewport = { x: 0, y: 0, w: width, h: height };

    // Texture cache
    this.textureCache = new Map();

    this.resize();
  }

  /**
   * Resize canvas to fit window while maintaining 4:3 aspect ratio.
   */
  resize() {
    const windowW = window.innerWidth;
    const windowH = window.innerHeight;
    const aspect = this.demoWidth / this.demoHeight; // 4:3

    let canvasW, canvasH;
    if (windowW / windowH > aspect) {
      canvasH = windowH;
      canvasW = canvasH * aspect;
    } else {
      canvasW = windowW;
      canvasH = canvasW / aspect;
    }

    this.webglRenderer.domElement.style.width = `${canvasW}px`;
    this.webglRenderer.domElement.style.height = `${canvasH}px`;
  }

  /**
   * Set the rendering viewport in pixel coordinates.
   * Three.js setViewport uses bottom-left origin natively.
   * @param {number} x - Left edge in pixels
   * @param {number} y - Bottom edge in pixels (Three.js convention)
   * @param {number} w - Width in pixels
   * @param {number} h - Height in pixels
   */
  setViewport(x, y, w, h) {
    this.currentViewport = { x, y, w, h };
    this.webglRenderer.setViewport(x, y, w, h);
    this.webglRenderer.setScissor(x, y, w, h);
    this.webglRenderer.setScissorTest(true);
  }

  /**
   * Set viewport from PTA normalized coordinates (origin = top-left).
   * Converts to Three.js bottom-left origin.
   * @param {number} cx - Center X (0-1)
   * @param {number} cy - Center Y (0-1, 0=top)
   * @param {number} w - Width (0-1)
   * @param {number} h - Height (0-1)
   */
  setViewportPTA(cx, cy, w, h) {
    const px = Math.round((cx - w / 2) * this.demoWidth);
    const pw = Math.round(w * this.demoWidth);
    const ph = Math.round(h * this.demoHeight);
    // PTA Y: 0=top → Three.js: flip to bottom-left origin
    const py = this.demoHeight - Math.round((cy + h / 2) * this.demoHeight);
    this.setViewport(px, py, pw, ph);
  }

  /**
   * Reset viewport to full demo area.
   */
  resetViewport() {
    this.setViewport(0, 0, this.demoWidth, this.demoHeight);
  }

  /**
   * Set the demo viewport (70% vertical, centered).
   */
  setDemoViewport() {
    const h = Math.round(this.demoHeight * this.viewportRatio);
    const y = Math.round((this.demoHeight - h) / 2);
    this.setViewport(0, y, this.demoWidth, h);
  }

  /**
   * Clear the current viewport.
   * @param {number} color - Hex color
   * @param {boolean} clearColor
   * @param {boolean} clearDepth
   * @param {boolean} clearStencil
   */
  clear(color = 0x000000, clearColor = true, clearDepth = true, clearStencil = true) {
    this.webglRenderer.setClearColor(color, 1);
    this.webglRenderer.clear(clearColor, clearDepth, clearStencil);
  }

  clearDepth() {
    this.webglRenderer.clear(false, true, false);
  }

  /**
   * Get or create a render target.
   * @param {string} name
   * @param {number} [width]
   * @param {number} [height]
   * @returns {THREE.WebGLRenderTarget}
   */
  getRenderTarget(name, width, height) {
    const key = `${name}_${width || this.demoWidth}_${height || this.demoHeight}`;
    if (!this.renderTargets.has(key)) {
      const rt = new THREE.WebGLRenderTarget(
        width || this.demoWidth,
        height || this.demoHeight,
        {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          stencilBuffer: true,
        }
      );
      this.renderTargets.set(key, rt);
    }
    return this.renderTargets.get(key);
  }

  /**
   * Copy current framebuffer to a render target texture.
   * Equivalent to PTA's copyFBufferToTexture.
   * @param {string} name
   * @returns {THREE.WebGLRenderTarget}
   */
  captureFramebuffer(name) {
    const rt = this.getRenderTarget(name);
    // Render current scene to the render target
    // Caller should use setRenderTarget/restore pattern instead
    return rt;
  }

  setRenderTarget(rt) {
    this.webglRenderer.setRenderTarget(rt);
  }

  restoreRenderTarget() {
    this.webglRenderer.setRenderTarget(null);
  }

  /**
   * Load a texture (with caching).
   * @param {string} path - URL path to texture
   * @returns {Promise<THREE.Texture>}
   */
  async loadTexture(path) {
    if (this.textureCache.has(path)) {
      return this.textureCache.get(path);
    }

    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        path,
        (texture) => {
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          this.textureCache.set(path, texture);
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  /**
   * Draw a textured quad (2D, normalized 0-1 coordinates).
   * Equivalent to PTA's drawCenteredTexturedQuad.
   *
   * @param {THREE.Texture} texture
   * @param {number} x - Center X (0-1)
   * @param {number} y - Center Y (0-1)
   * @param {number} width - Width (0-1)
   * @param {number} height - Height (0-1)
   * @param {number} angle - Rotation in radians
   * @param {number} alpha - Opacity (0-1)
   * @param {number} srcBlend - Source blend mode
   * @param {number} dstBlend - Destination blend mode
   */
  drawTexturedQuad(texture, x, y, width, height, angle = 0, alpha = 1, srcBlend = BlendMode.SRCALPHA, dstBlend = BlendMode.INVSRCALPHA) {
    const geom = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: alpha,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: BLEND_FACTOR_MAP[srcBlend] || THREE.SrcAlphaFactor,
      blendDst: BLEND_FACTOR_MAP[dstBlend] || THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // PTA Y convention: 0=top, 1=bottom → Three.js: flip Y
    mesh.position.set(x, 1 - y, 0);
    mesh.rotation.z = -angle; // Negate angle since Y is flipped

    const scene = new THREE.Scene();
    scene.add(mesh);
    this.webglRenderer.render(scene, this.orthoCamera);

    // Cleanup
    geom.dispose();
    mat.dispose();
  }

  /**
   * Draw a colored quad (no texture).
   *
   * @param {number} x - Center X (0-1)
   * @param {number} y - Center Y (0-1)
   * @param {number} width
   * @param {number} height
   * @param {THREE.Color|number} color
   * @param {number} alpha
   * @param {number} srcBlend
   * @param {number} dstBlend
   */
  drawColoredQuad(x, y, width, height, color, alpha = 1, srcBlend = BlendMode.SRCALPHA, dstBlend = BlendMode.INVSRCALPHA) {
    const geom = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
      color: color instanceof THREE.Color ? color : new THREE.Color(color),
      transparent: true,
      opacity: alpha,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: BLEND_FACTOR_MAP[srcBlend] || THREE.SrcAlphaFactor,
      blendDst: BLEND_FACTOR_MAP[dstBlend] || THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // PTA Y convention: 0=top, 1=bottom → Three.js: flip Y
    mesh.position.set(x, 1 - y, 0);

    const scene = new THREE.Scene();
    scene.add(mesh);
    this.webglRenderer.render(scene, this.orthoCamera);

    geom.dispose();
    mat.dispose();
  }

  /**
   * Draw a fullscreen quad with given color and alpha.
   * Used for fade effects.
   */
  drawFullscreenQuad(color, alpha, srcBlend = BlendMode.SRCALPHA, dstBlend = BlendMode.INVSRCALPHA) {
    this.drawColoredQuad(0.5, 0.5, 1, 1, color, alpha, srcBlend, dstBlend);
  }

  /**
   * Draw a fullscreen textured quad.
   */
  drawFullscreenTexturedQuad(texture, alpha = 1, srcBlend = BlendMode.SRCALPHA, dstBlend = BlendMode.INVSRCALPHA) {
    this.drawTexturedQuad(texture, 0.5, 0.5, 1, 1, 0, alpha, srcBlend, dstBlend);
  }

  /**
   * Render a Three.js scene with a given camera.
   */
  renderScene(scene, camera) {
    this.webglRenderer.render(scene, camera);
    // Store last 3D camera so effects like particle steam can reuse it
    if (camera && camera.isPerspectiveCamera) {
      this.lastPerspectiveCamera = camera;
    }
  }

  /**
   * Map a PTA blend mode to Three.js blend factor.
   */
  static mapBlendFactor(ptaBlend) {
    return BLEND_FACTOR_MAP[ptaBlend] || THREE.OneFactor;
  }

  dispose() {
    for (const [, rt] of this.renderTargets) {
      rt.dispose();
    }
    for (const [, tex] of this.textureCache) {
      tex.dispose();
    }
    this.webglRenderer.dispose();
  }
}
