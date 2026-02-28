import { DemoFX } from '../engine/DemoManager.js';
import { BlendMode } from '../engine/Renderer.js';

/**
 * FXSpiral - Rotating spiral of textured quads.
 * Quads placed along spiral path with angular torsion. Additive blending.
 * C++ original: Odyssey/FXSpiral.cpp + FXSpiral.h
 *
 * FXSpiral1 subclass: GetParams override is empty (all commented out),
 * so torsion stays at setup value (280) and rotation is 0.
 */
export class FXSpiral extends DemoFX {
  constructor() {
    super();
    this.name = 'FXSpiral';
    this.numQuads = 0;
    this.center = { x: 0, y: 0, z: 0 };
    this.minRadius = 0;
    this.maxRadius = 0;
    this.angleTorsion = 0;
    this.texturePath = '';
    this.texture = null;
  }

  setup(numQuads, center, minRadius, maxRadius, angleTorsion, texturePath) {
    this.numQuads = numQuads;
    this.center = center;
    this.minRadius = minRadius;
    this.maxRadius = maxRadius;
    this.angleTorsion = angleTorsion;
    this.texturePath = texturePath;
  }

  async loadData(dm) {
    if (this.texturePath) {
      try {
        this.texture = await dm.assetManager.loadTextureByPath(this.texturePath);
      } catch (err) {
        console.warn(`FXSpiral: failed to load "${this.texturePath}":`, err.message);
      }
    }
  }

  /**
   * Override in subclasses to modify parameters per frame.
   * C++ base: torsion = -10 + sin(t/760)*80, rotation = t/10
   */
  getParams(fxTime) {
    return {
      center: { ...this.center },
      minRadius: this.minRadius,
      maxRadius: this.maxRadius,
      angleTorsion: -10 + Math.sin(fxTime / 760.0) * 80.0,
      angleRotation: fxTime / 10.0,
    };
  }

  doFrame(fxTime, demoTime, dm) {
    if (!this.texture) return;

    const params = this.getParams(fxTime);
    const DEG2RAD = Math.PI / 180;

    for (let i = 0; i < this.numQuads; i++) {
      const t = i / (this.numQuads - 1);

      const radius = params.minRadius + (params.maxRadius - params.minRadius) * t;
      const torsion = params.angleTorsion * t;
      const size = radius * 2.0;

      // C++: mat.buildTranslation(radius, 0, 0) → rotateZ(torsion + rotation) → translate(center)
      // In 2D: position = rotateZ(torsion+rotation) applied to (radius, 0), then + center
      const totalAngle = (torsion + params.angleRotation) * DEG2RAD;
      const px = Math.cos(totalAngle) * radius + params.center.x;
      const py = Math.sin(totalAngle) * radius + params.center.y;

      // Quad rotation = fxTime/30 degrees
      const quadRotation = (fxTime / 30.0) * DEG2RAD;

      // Additive blending (ONE+ONE), alpha=0.2
      dm.renderer.drawTexturedQuad(
        this.texture, px, py, size, size, quadRotation, 0.2,
        BlendMode.ONE, BlendMode.ONE
      );
    }
  }

  close() {
    this.texture = null;
  }
}

/**
 * FXSpiral1 - Override with empty GetParams (all lines commented out).
 * Torsion stays at setup value (280), rotation is effectively 0.
 */
export class FXSpiral1 extends FXSpiral {
  constructor() {
    super();
    this.name = 'FXSpiral1';
  }

  getParams(fxTime) {
    // C++ FXSpiral1::GetParams is empty (all commented out)
    // torsion stays at setup value, rotation is uninitialized (0)
    return {
      center: { ...this.center },
      minRadius: this.minRadius,
      maxRadius: this.maxRadius,
      angleTorsion: this.angleTorsion,
      angleRotation: 0,
    };
  }
}
