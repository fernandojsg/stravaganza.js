import * as THREE from 'three';
import { loadPtaFile } from './PtaFileLoader.js';

/**
 * AssetManager - Manages loading and caching of textures, scenes, and images.
 */
export class AssetManager {
  constructor(renderer) {
    this.renderer = renderer;
    /** @type {Map<string, THREE.Texture>} */
    this.textures = new Map();
    /** @type {Map<string, import('./PtaFileLoader.js').PtaScene>} */
    this.ptaScenes = new Map();
    /** @type {Map<string, THREE.Texture>} */
    this.images = new Map();

    this.textureLoader = new THREE.TextureLoader();
    this.basePath = '';
  }

  /**
   * Set the base path for asset loading.
   * @param {string} path
   */
  setBasePath(path) {
    this.basePath = path.endsWith('/') ? path : path + '/';
  }

  /**
   * Load a texture from the data directory.
   * Tries .png first, then .jpg, then .tga.
   * @param {string} filename - Original filename (may be .tga)
   * @param {string} [subdir] - Subdirectory under data/textures/
   * @returns {Promise<THREE.Texture>}
   */
  async loadTexture(filename, subdir = '') {
    const key = `${subdir}/${filename}`.toLowerCase();
    if (this.textures.has(key)) return this.textures.get(key);

    // Try multiple extensions
    const baseName = filename.replace(/\.\w+$/, '');
    const extensions = ['.png', '.jpg', '.tga'];
    const dirPath = subdir
      ? `${this.basePath}data/textures/${subdir}/`
      : `${this.basePath}data/textures/`;

    for (const ext of extensions) {
      const url = `${dirPath}${baseName}${ext}`;
      try {
        const texture = await this._loadTextureUrl(url);
        this.textures.set(key, texture);
        return texture;
      } catch {
        // Try next extension
      }
    }

    // Try original filename as-is
    try {
      const url = `${dirPath}${filename}`;
      const texture = await this._loadTextureUrl(url);
      this.textures.set(key, texture);
      return texture;
    } catch {
      console.warn(`Failed to load texture: ${key}`);
      return this._createPlaceholderTexture();
    }
  }

  /**
   * Load all textures from a scene's material list.
   * @param {import('./PtaFileLoader.js').PtaScene} ptaScene
   * @param {string} textureDir - Base texture directory
   * @returns {Promise<Map<string, THREE.Texture>>}
   */
  async loadSceneTextures(ptaScene, textureDir) {
    const texMap = new Map();
    const allTextureNames = new Set();

    for (const mat of ptaScene.materials) {
      this._collectTextureNames(mat, allTextureNames);
    }

    // Normalize backslashes from Windows-style PTA paths
    const normalizedDir = textureDir.replace(/\\/g, '/');

    const promises = Array.from(allTextureNames).map(async (name) => {
      const path = `${normalizedDir}/${name}`;
      const tex = await this.loadTextureByPath(path);
      texMap.set(name, tex);
    });

    await Promise.all(promises);
    return texMap;
  }

  _collectTextureNames(mat, set) {
    if (mat.texture1) set.add(mat.texture1);
    if (mat.texture2) set.add(mat.texture2);
    if (mat.subMaterials) {
      for (const sub of mat.subMaterials) {
        this._collectTextureNames(sub, set);
      }
    }
  }

  /**
   * Load a PTA scene file.
   * @param {string} path - Path relative to basePath
   * @returns {Promise<import('./PtaFileLoader.js').PtaScene>}
   */
  async loadPtaScene(path) {
    const normalizedPath = path.replace(/\\/g, '/');
    if (this.ptaScenes.has(normalizedPath)) return this.ptaScenes.get(normalizedPath);

    const url = `${this.basePath}${normalizedPath}`;
    const scene = await loadPtaFile(url);
    // Keep source path so SceneManager can apply per-scene compatibility tuning.
    scene.sourcePath = normalizedPath;
    this.ptaScenes.set(normalizedPath, scene);
    return scene;
  }

  /**
   * Load a 2D image as a texture (for 3D_LOADIMAGE / FXFadedImage etc).
   * @param {string} id - Image identifier
   * @param {string} file - File path
   * @returns {Promise<THREE.Texture>}
   */
  async loadImage(id, file) {
    if (this.images.has(id)) return this.images.get(id);

    const url = `${this.basePath}${file}`;
    try {
      const texture = await this._loadTextureUrl(url);
      this.images.set(id, texture);
      return texture;
    } catch {
      // Try with different extensions
      const baseName = file.replace(/\.\w+$/, '');
      for (const ext of ['.png', '.jpg', '.tga']) {
        try {
          const texture = await this._loadTextureUrl(`${this.basePath}${baseName}${ext}`);
          this.images.set(id, texture);
          return texture;
        } catch { /* continue */ }
      }
      console.warn(`Failed to load image: ${id} (${file})`);
      const placeholder = this._createPlaceholderTexture();
      this.images.set(id, placeholder);
      return placeholder;
    }
  }

  getImage(id) {
    return this.images.get(id);
  }

  getTexture(key) {
    return this.textures.get(key.toLowerCase());
  }

  /**
   * Load a texture by its full path (relative to basePath).
   * Used by effects that specify complete paths like 'data/textures/spike/background.jpg'.
   * @param {string} path - Full relative path
   * @returns {Promise<THREE.Texture>}
   */
  async loadTextureByPath(path) {
    const key = path.toLowerCase();
    if (this.textures.has(key)) return this.textures.get(key);

    const url = `${this.basePath}${path}`;
    try {
      const texture = await this._loadTextureUrl(url);
      this.textures.set(key, texture);
      return texture;
    } catch {
      // Try alternate extensions
      const baseName = path.replace(/\.\w+$/, '');
      for (const ext of ['.png', '.jpg', '.tga']) {
        try {
          const texture = await this._loadTextureUrl(`${this.basePath}${baseName}${ext}`);
          this.textures.set(key, texture);
          return texture;
        } catch { /* continue */ }
      }
      console.warn(`Failed to load texture by path: ${path}`);
      return this._createPlaceholderTexture();
    }
  }

  _loadTextureUrl(url) {
    // TGA files have been converted to PNG — redirect automatically
    const loadUrl = url.replace(/\.tga$/i, '.png');
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        loadUrl,
        (texture) => {
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // No sRGB decode — PTA uses raw texture bytes (uncorrected pipeline).
          // Output is also linear, so file → screen roundtrip matches PTA exactly.

          // Tag textures with alpha channel so materials can enable transparency.
          // PTA auto-enables GL_BLEND(SRC_ALPHA, INV_SRC_ALPHA) when any texture
          // on a material is 32-bit. For PNG textures we detect alpha by sampling.
          if (loadUrl.toLowerCase().endsWith('.png')) {
            texture._hasAlpha = this._imageHasAlpha(texture.image);
          }
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  /**
   * Check if an image has any non-opaque pixels (alpha channel with transparency).
   * @param {HTMLImageElement} image
   * @returns {boolean}
   */
  _imageHasAlpha(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Sample every 4th pixel for performance on large textures
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 255) return true;
    }
    return false;
  }

  _createPlaceholderTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 2, 2);
    return new THREE.CanvasTexture(canvas);
  }

  dispose() {
    for (const [, tex] of this.textures) tex.dispose();
    for (const [, tex] of this.images) tex.dispose();
    this.textures.clear();
    this.images.clear();
    this.ptaScenes.clear();
  }
}
