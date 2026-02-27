import { parseScript, parseBlendMode } from './ScriptParser.js';
import { SceneManager } from './SceneManager.js';
import { BlendMode } from './Renderer.js';

/**
 * DemoManager - Timeline orchestrator for the demo.
 *
 * Ports the behavior of PTA's ptaDemoManager:
 * - Manages a list of effects with start/end times and priorities
 * - Per frame: builds active effect list sorted by priority, calls doFrame()
 * - Handles script-based effects (fade, viewport, alphafunc, etc.)
 * - Handles manually registered effects (FXManagement.cpp)
 */
export class DemoManager {
  /**
   * @param {import('./Renderer.js').Renderer} renderer
   * @param {import('./MusicPlayer.js').MusicPlayer} musicPlayer
   * @param {import('./AssetManager.js').AssetManager} assetManager
   */
  constructor(renderer, musicPlayer, assetManager) {
    this.renderer = renderer;
    this.musicPlayer = musicPlayer;
    this.assetManager = assetManager;
    this.sceneManager = new SceneManager(renderer);

    /** @type {Array<DemoFXEntry>} */
    this.effects = [];

    /** @type {Array<ScriptCommand>} */
    this.scriptCommands = [];

    /** @type {Map<string, Object>} loaded scenes by id */
    this.loadedScenes = new Map();

    /** @type {Map<string, Object>} loaded images by id */
    this.loadedImages = new Map();

    this.startTime = 0;
    this.duration = 172000; // ~172 seconds

    // Current render state
    this.currentBlendSrc = BlendMode.SRCALPHA;
    this.currentBlendDst = BlendMode.INVSRCALPHA;
    this.currentAlpha = 1.0;

    // Viewport state
    this.viewportStack = [];
  }

  /**
   * Load and parse the demo script.
   * @param {string} url
   */
  async loadScript(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Script not found: ${url}`);
        return;
      }
      const text = await response.text();
      this.scriptCommands = parseScript(text);
      this._processScriptCommands();
    } catch (err) {
      console.warn('Failed to load script:', err.message);
    }
  }

  /**
   * Process script commands into effect entries.
   */
  _processScriptCommands() {
    for (const cmd of this.scriptCommands) {
      switch (cmd.type) {
        case 'DEMO_START':
          this.startTime = cmd.params.start || 0;
          break;

        case '3D_LOADSCENE':
          this.loadedScenes.set(cmd.params.id, {
            file: (cmd.params.file || '').replace(/\\/g, '/'),
            packfile: cmd.params.packfile,
            texturedir: (cmd.params.texturedir || '').replace(/\\/g, '/'),
          });
          break;

        case '3D_LOADIMAGE':
          this.loadedImages.set(cmd.params.id, {
            file: (cmd.params.file || '').replace(/\\/g, '/'),
            packfile: cmd.params.packfile,
          });
          break;

        case '3D_FADE':
          this._addScriptEffect(cmd.params, new FadeFX(cmd.params));
          break;

        case '3D_FLASH':
          this._addScriptEffect(cmd.params, new FlashFX(cmd.params));
          break;

        case '3D_VIEWPORT':
          this._addScriptEffect(cmd.params, new ViewportFX(cmd.params, this.renderer));
          break;

        case '3D_CLEAR_ZBUFF':
          this._addScriptEffect(cmd.params, new ClearZBuffFX());
          break;

        case '3D_CLEAR_FRAMEBUFF':
          this._addScriptEffect(cmd.params, new ClearFrameBuffFX());
          break;

        case '3D_ALPHAFUNC':
          this._addScriptEffect(cmd.params, new AlphaFuncFX(cmd.params, this));
          break;

        case '3D_FOG':
          this._addScriptEffect(cmd.params, new FogFX(cmd.params));
          break;

        case '3D_IMAGE':
          this._addScriptEffect(cmd.params, new ImageFX(cmd.params, this));
          break;

        case '3D_SCENE':
          this._addScriptEffect(cmd.params, new SceneFX(cmd.params, this));
          break;

        case 'FX':
          // Update timing of a manually registered effect
          this._updateFXTiming(cmd.params.name, cmd.params);
          break;
      }
    }
  }

  _addScriptEffect(params, fx) {
    this.addFX(fx, params.start || 0, params.end || 0, params.priority || 0, fx.constructor.name);
  }

  _updateFXTiming(name, params) {
    const entry = this.effects.find(e => e.name === name);
    if (entry) {
      entry.startTime = params.start || entry.startTime;
      entry.endTime = params.end || entry.endTime;
      entry.priority = params.priority ?? entry.priority;
    }
  }

  /**
   * Register an effect.
   * @param {DemoFX} fx - Effect instance
   * @param {number} startTime - Start time in ms
   * @param {number} endTime - End time in ms
   * @param {number} priority - Draw priority (lower = rendered first / behind)
   * @param {string} [name] - Optional name for script FX referencing
   */
  addFX(fx, startTime, endTime, priority, name = '') {
    const order = this.effects.length;
    this.effects.push(new DemoFXEntry(fx, startTime, endTime, priority, name, order));
  }

  /**
   * Load all effect resources.
   * @param {Function} [onProgress] - Progress callback (progress: 0-1, name: string)
   */
  async loadAllEffects(onProgress) {
    // Load scene files
    for (const [id, info] of this.loadedScenes) {
      try {
        if (onProgress) onProgress(0, `Scene: ${id}`);
        const ptaScene = await this.assetManager.loadPtaScene(info.file);
        const textures = info.texturedir
          ? await this.assetManager.loadSceneTextures(ptaScene, info.texturedir)
          : new Map();
        this.sceneManager.buildScene(id, ptaScene, textures);
      } catch (err) {
        console.warn(`Failed to load scene "${id}":`, err.message);
      }
    }

    // Load images
    for (const [id, info] of this.loadedImages) {
      try {
        if (onProgress) onProgress(0.5, `Image: ${id}`);
        await this.assetManager.loadImage(id, info.file);
      } catch (err) {
        console.warn(`Failed to load image "${id}":`, err.message);
      }
    }

    // Load each manual effect
    const total = this.effects.length;
    for (let i = 0; i < total; i++) {
      const entry = this.effects[i];
      try {
        if (onProgress) onProgress(i / total, entry.name || entry.fx.constructor.name);
        if (entry.fx.loadData) {
          await entry.fx.loadData(this);
        }
      } catch (err) {
        console.warn(`Failed to load effect "${entry.name}":`, err.message);
      }
    }
  }

  /**
   * Get total demo duration in ms.
   */
  getDuration() {
    return this.duration;
  }

  /**
   * Execute one frame of the demo.
   * @param {number} demoTime - Current demo time in ms
   */
  doFrame(demoTime) {
    // Clear screen
    this.renderer.resetViewport();
    this.renderer.clear(0x000000);

    // Build active effect list sorted by priority (lower priority = drawn first)
    const activeEffects = [];
    for (const entry of this.effects) {
      if (!entry.disabled && demoTime >= entry.startTime && demoTime <= entry.endTime) {
        activeEffects.push(entry);
      }
    }
    // C++ sorts by priority; at equal priority, script effects (fades, flashes)
    // render AFTER manual effects (they were registered later in C++).
    // Use insertion order as tiebreaker to match C++ behavior.
    activeEffects.sort((a, b) => a.priority - b.priority || a.order - b.order);

    // Set demo viewport (70% vertical, centered)
    this.renderer.setDemoViewport();

    // Execute each active effect
    for (const entry of activeEffects) {
      const fxTime = demoTime - entry.startTime;
      try {
        entry.fx.doFrame(fxTime, demoTime, this);
      } catch (err) {
        console.warn(`Effect "${entry.name}" error:`, err.message);
      }
    }
  }
}

/**
 * A registered demo effect entry.
 */
class DemoFXEntry {
  constructor(fx, startTime, endTime, priority, name, order = 0) {
    this.fx = fx;
    this.startTime = startTime;
    this.endTime = endTime;
    this.priority = priority;
    this.name = name;
    this.order = order;
    this.force = false;
    this.disabled = false;
  }
}

// ---- Base class for demo effects ----

/**
 * Base class for all demo effects.
 * Override loadData() and doFrame().
 */
export class DemoFX {
  constructor() {
    this.name = '';
  }

  /**
   * Load resources for this effect.
   * @param {DemoManager} demoManager
   */
  async loadData(demoManager) {}

  /**
   * Render one frame.
   * @param {number} fxTime - Time since effect start (ms)
   * @param {number} demoTime - Absolute demo time (ms)
   * @param {DemoManager} demoManager
   */
  doFrame(fxTime, demoTime, demoManager) {}

  /**
   * Cleanup resources.
   */
  close() {}
}

// ---- Script-based effect implementations ----

/** 3D_FADE: Fullscreen fade in/out */
class FadeFX extends DemoFX {
  constructor(params) {
    super();
    this.fadeType = params.type; // 'IN' or 'OUT'
    this.color = params.color || [0, 0, 0];
    this.startMs = params.start || 0;
    this.endMs = params.end || 0;
  }

  doFrame(fxTime, demoTime, dm) {
    const duration = this.endMs - this.startMs;
    const t = duration > 0 ? Math.max(0, Math.min(1, fxTime / duration)) : 1;
    const alpha = this.fadeType === 'IN' ? (1 - t) : t;

    const color = (Math.round(this.color[0] * 255) << 16) |
                  (Math.round(this.color[1] * 255) << 8) |
                  Math.round(this.color[2] * 255);

    dm.renderer.drawFullscreenQuad(color, alpha);
  }
}

/** 3D_FLASH: Instant flash */
class FlashFX extends DemoFX {
  constructor(params) {
    super();
    this.color = params.color || [1, 1, 1];
    this.startMs = params.start || 0;
    this.endMs = params.end || 0;
  }

  doFrame(fxTime, demoTime, dm) {
    const duration = this.endMs - this.startMs;
    const t = duration > 0 ? Math.max(0, Math.min(1, fxTime / duration)) : 0;
    const alpha = 1 - t;

    const color = (Math.round(this.color[0] * 255) << 16) |
                  (Math.round(this.color[1] * 255) << 8) |
                  Math.round(this.color[2] * 255);

    dm.renderer.drawFullscreenQuad(color, alpha, BlendMode.SRCALPHA, BlendMode.ONE);
  }
}

/** 3D_VIEWPORT: Animated viewport change */
class ViewportFX extends DemoFX {
  constructor(params, renderer) {
    super();
    this.viewport1 = params.viewport1 || [0, 0, 1, 1];
    this.viewport2 = params.viewport2 || [0, 0, 1, 1];
    this.startMs = params.start || 0;
    this.endMs = params.end || 0;
    this.renderer = renderer;
  }

  doFrame(fxTime, demoTime, dm) {
    const duration = this.endMs - this.startMs;
    const t = duration > 0 ? Math.max(0, Math.min(1, fxTime / duration)) : 1;

    const cx = this.viewport1[0] + (this.viewport2[0] - this.viewport1[0]) * t;
    const cy = this.viewport1[1] + (this.viewport2[1] - this.viewport1[1]) * t;
    const w = this.viewport1[2] + (this.viewport2[2] - this.viewport1[2]) * t;
    const h = this.viewport1[3] + (this.viewport2[3] - this.viewport1[3]) * t;

    // Use PTA viewport convention (cx, cy = center, 0,0 = top-left)
    dm.renderer.setViewportPTA(cx, cy, w, h);
  }
}

/** 3D_CLEAR_ZBUFF: Clear depth buffer */
class ClearZBuffFX extends DemoFX {
  doFrame(fxTime, demoTime, dm) {
    dm.renderer.clearDepth();
  }
}

/** 3D_CLEAR_FRAMEBUFF: Clear color + depth */
class ClearFrameBuffFX extends DemoFX {
  doFrame(fxTime, demoTime, dm) {
    dm.renderer.clear(0x000000);
  }
}

/** 3D_ALPHAFUNC: Set blend function */
class AlphaFuncFX extends DemoFX {
  constructor(params, demoManager) {
    super();
    this.func = params.func || [4, 5]; // SRCALPHA, INVSRCALPHA
    this.alpha1 = params.alpha1 ?? 1.0;
    this.alpha2 = params.alpha2 ?? 1.0;
    this.startMs = params.start || 0;
    this.endMs = params.end || 0;
  }

  doFrame(fxTime, demoTime, dm) {
    const duration = this.endMs - this.startMs;
    const t = duration > 0 ? Math.max(0, Math.min(1, fxTime / duration)) : 1;

    dm.currentBlendSrc = this.func[0];
    dm.currentBlendDst = this.func[1];
    dm.currentAlpha = this.alpha1 + (this.alpha2 - this.alpha1) * t;
  }
}

/** 3D_FOG: Set fog parameters */
class FogFX extends DemoFX {
  constructor(params) {
    super();
    this.fogType = params.type || 'OFF';
    this.near = params.near || 0;
    this.far = params.far || 1000;
    this.density = params.density || 1;
    this.color = params.color || [0, 0, 0];
  }

  doFrame(fxTime, demoTime, dm) {
    // Fog would be applied to the Three.js scene
    // For now, this is a placeholder
  }
}

/** 3D_IMAGE: Display a 2D image */
class ImageFX extends DemoFX {
  constructor(params, demoManager) {
    super();
    this.imageId = params.id;
    this.alpha1 = params.alpha1 ?? 1.0;
    this.alpha2 = params.alpha2 ?? 1.0;
    this.angle1 = (params.angle1 || 0) * Math.PI / 180;
    this.angle2 = (params.angle2 || 0) * Math.PI / 180;
    this.pos1 = params.pos1 || [0.5, 0.5];
    this.pos2 = params.pos2 || [0.5, 0.5];
    this.size1 = params.size1 || [0.5, 0.5];
    this.size2 = params.size2 || [0.5, 0.5];
    this.startMs = params.start || 0;
    this.endMs = params.end || 0;
  }

  doFrame(fxTime, demoTime, dm) {
    const texture = dm.assetManager.getImage(this.imageId);
    if (!texture) return;

    const duration = this.endMs - this.startMs;
    const t = duration > 0 ? Math.max(0, Math.min(1, fxTime / duration)) : 1;

    const alpha = this.alpha1 + (this.alpha2 - this.alpha1) * t;
    const angle = this.angle1 + (this.angle2 - this.angle1) * t;
    const x = this.pos1[0] + (this.pos2[0] - this.pos1[0]) * t;
    const y = this.pos1[1] + (this.pos2[1] - this.pos1[1]) * t;
    const w = this.size1[0] + (this.size2[0] - this.size1[0]) * t;
    const h = this.size1[1] + (this.size2[1] - this.size1[1]) * t;

    dm.renderer.drawTexturedQuad(texture, x, y, w, h, angle, alpha);
  }
}

/** 3D_SCENE: Play a 3D scene */
class SceneFX extends DemoFX {
  constructor(params, demoManager) {
    super();
    this.sceneId = params.id;
    this.sceneTime = params.scenetime || 0;
    this.cameraName = params.camera;
    this.playSpeed = params.playspeed ?? 1.0;
    this.startMs = params.start || 0;
    this.endMs = params.end || 0;
  }

  doFrame(fxTime, demoTime, dm) {
    const sceneTime = this.sceneTime + fxTime * this.playSpeed;
    dm.sceneManager.renderScene(this.sceneId, sceneTime, this.cameraName, 1);
  }
}
