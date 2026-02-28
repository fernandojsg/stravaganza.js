import * as THREE from 'three';

/**
 * Animation System - Keyframe interpolation matching PTA engine.
 *
 * Implements:
 * - LERP for position/scale
 * - SLERP for quaternion rotation
 * - Key lookup with constant time delta assumption
 * - getTMatrix() composition: initial axes + animated keys
 */

const EPSILON = 0.001;

/**
 * Linear interpolation.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Interpolate a position key at time t.
 * @param {Array<{t: number, pos: THREE.Vector3}>} keys
 * @param {number} t - Time in ms
 * @returns {THREE.Vector3}
 */
export function interpolatePosition(keys, t) {
  if (!keys || keys.length === 0) return new THREE.Vector3();
  if (keys.length === 1) return keys[0].pos.clone();

  // Clamp to range
  if (t <= keys[0].t) return keys[0].pos.clone();
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].pos.clone();

  // Find key pair using constant time delta
  const msPerTick = keys[1].t - keys[0].t;
  if (msPerTick <= 0) return keys[0].pos.clone();

  let index = Math.floor((t - keys[0].t) / msPerTick);
  index = Math.max(0, Math.min(index, keys.length - 2));

  const key0 = keys[index];
  const key1 = keys[index + 1];
  const normalizedT = (t - key0.t) / msPerTick;
  const ct = Math.max(0, Math.min(1, normalizedT));

  return new THREE.Vector3(
    lerp(key0.pos.x, key1.pos.x, ct),
    lerp(key0.pos.y, key1.pos.y, ct),
    lerp(key0.pos.z, key1.pos.z, ct)
  );
}

/**
 * Interpolate a scale key at time t.
 * @param {Array<{t: number, scale: THREE.Vector3, axes: THREE.Quaternion}>} keys
 * @param {number} t
 * @returns {{scale: THREE.Vector3, axes: THREE.Quaternion}}
 */
export function interpolateScale(keys, t) {
  const defaultResult = {
    scale: new THREE.Vector3(1, 1, 1),
    axes: new THREE.Quaternion(),
  };
  if (!keys || keys.length === 0) return defaultResult;
  if (keys.length === 1) return { scale: keys[0].scale.clone(), axes: keys[0].axes.clone() };

  if (t <= keys[0].t) return { scale: keys[0].scale.clone(), axes: keys[0].axes.clone() };
  if (t >= keys[keys.length - 1].t) {
    const last = keys[keys.length - 1];
    return { scale: last.scale.clone(), axes: last.axes.clone() };
  }

  const msPerTick = keys[1].t - keys[0].t;
  if (msPerTick <= 0) return { scale: keys[0].scale.clone(), axes: keys[0].axes.clone() };

  let index = Math.floor((t - keys[0].t) / msPerTick);
  index = Math.max(0, Math.min(index, keys.length - 2));

  const key0 = keys[index];
  const key1 = keys[index + 1];
  const normalizedT = (t - key0.t) / msPerTick;
  const ct = Math.max(0, Math.min(1, normalizedT));

  // LERP scale
  const scale = new THREE.Vector3(
    lerp(key0.scale.x, key1.scale.x, ct),
    lerp(key0.scale.y, key1.scale.y, ct),
    lerp(key0.scale.z, key1.scale.z, ct)
  );

  // SLERP axes quaternion
  const axes = key0.axes.clone().slerp(key1.axes, ct);

  return { scale, axes };
}

/**
 * Interpolate a rotation key at time t using SLERP.
 * @param {Array<{t: number, quat: THREE.Quaternion}>} keys
 * @param {number} t
 * @returns {THREE.Quaternion}
 */
export function interpolateRotation(keys, t) {
  if (!keys || keys.length === 0) return new THREE.Quaternion();
  if (keys.length === 1) return keys[0].quat.clone();

  if (t <= keys[0].t) return keys[0].quat.clone();
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].quat.clone();

  const msPerTick = keys[1].t - keys[0].t;
  if (msPerTick <= 0) return keys[0].quat.clone();

  let index = Math.floor((t - keys[0].t) / msPerTick);
  index = Math.max(0, Math.min(index, keys.length - 2));

  const key0 = keys[index];
  const key1 = keys[index + 1];
  const normalizedT = (t - key0.t) / msPerTick;
  const ct = Math.max(0, Math.min(1, normalizedT));

  return key0.quat.clone().slerp(key1.quat, ct);
}

/**
 * Interpolate camera settings at time t.
 * @param {Array<{t: number, near: number, far: number, fov: number}>} keys
 * @param {number} t
 * @param {{near: number, far: number, fov: number}} defaults
 * @returns {{near: number, far: number, fov: number}}
 */
export function interpolateCameraSettings(keys, t, defaults) {
  if (!keys || keys.length === 0) return { ...defaults };
  if (keys.length === 1) return { near: keys[0].near, far: keys[0].far, fov: keys[0].fov };

  if (t <= keys[0].t) return { near: keys[0].near, far: keys[0].far, fov: keys[0].fov };
  if (t >= keys[keys.length - 1].t) {
    const last = keys[keys.length - 1];
    return { near: last.near, far: last.far, fov: last.fov };
  }

  const msPerTick = keys[1].t - keys[0].t;
  let index = Math.floor((t - keys[0].t) / msPerTick);
  index = Math.max(0, Math.min(index, keys.length - 2));

  const key0 = keys[index];
  const key1 = keys[index + 1];
  const ct = Math.max(0, Math.min(1, (t - key0.t) / msPerTick));

  return {
    near: lerp(key0.near, key1.near, ct),
    far: lerp(key0.far, key1.far, ct),
    fov: lerp(key0.fov, key1.fov, ct),
  };
}

/**
 * Decompose a PTA matrix using PTA's row-based convention.
 *
 * PTA extracts scale from ROW vector lengths and builds rotation
 * by normalizing rows. This differs from Three.js decompose() which
 * uses column vectors. For matrices with shear (non-orthogonal axes),
 * using PTA's convention is essential to match C++ behaviour.
 *
 * Three.js stores column-major: elements[0..2] = column 0.
 * PTA M[row][col] maps to Three.js as:
 *   PTA Row 0 = elements[0], elements[4], elements[8]
 *   PTA Row 1 = elements[1], elements[5], elements[9]
 *   PTA Row 2 = elements[2], elements[6], elements[10]
 *   Position  = elements[12], elements[13], elements[14]
 *
 * @param {THREE.Matrix4} axes
 * @returns {{pos: THREE.Vector3, scale: THREE.Vector3, rotMatrix: THREE.Matrix4}}
 */
function ptaDecompose(axes) {
  const e = axes.elements;

  // PTA rows (3x3 upper-left in PTA's M[row][col] layout)
  const r0x = e[0], r0y = e[4], r0z = e[8];
  const r1x = e[1], r1y = e[5], r1z = e[9];
  const r2x = e[2], r2y = e[6], r2z = e[10];

  // Scale = row vector lengths (PTA getScaleValues)
  const sx = Math.sqrt(r0x * r0x + r0y * r0y + r0z * r0z);
  const sy = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
  const sz = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);

  // Rotation = normalized rows (PTA removeScale + removePos)
  const isx = sx > 0 ? 1 / sx : 0;
  const isy = sy > 0 ? 1 / sy : 0;
  const isz = sz > 0 ? 1 / sz : 0;

  // Build rotation matrix with normalized PTA rows, zero translation
  // Three.js set() takes row-major args: set(n11,n12,n13,n14, n21,...n44)
  // PTA Row 0 normalized → Three.js row 1 of set() args
  const rotMatrix = new THREE.Matrix4();
  rotMatrix.set(
    r0x * isx, r0y * isx, r0z * isx, 0,
    r1x * isy, r1y * isy, r1z * isy, 0,
    r2x * isz, r2y * isz, r2z * isz, 0,
    0, 0, 0, 1
  );

  // Position = PTA column 3: M[0][3], M[1][3], M[2][3]
  const pos = new THREE.Vector3(e[12], e[13], e[14]);

  return {
    pos,
    scale: new THREE.Vector3(sx, sy, sz),
    rotMatrix,
  };
}

/**
 * Compose a transformation matrix from initial axes + animated keys.
 * Matches PTA's pta3DAnimation::getTMatrix() exactly:
 *
 *   retMatrix = Identity
 *   retMatrix.scale(axes.getScaleValues())          — PTA row-based scale
 *   retMatrix.scale(animScl, animSclAxes)           — oriented animated scale
 *   retMatrix = axes.getRotValues() * retMatrix     — left-multiply initial rotation
 *   retMatrix.rotate(animRot)                       — left-multiply animated rotation
 *   retMatrix.translate(axes.getPosValues())         — left-multiply initial translation
 *   retMatrix.translate(animPos)                     — left-multiply animated translation
 *
 * @param {number} t - Time in ms
 * @param {{posKeys: Array, sclKeys: Array, rotKeys: Array}} animation
 * @param {THREE.Matrix4} initialAxes - The initial world transformation matrix
 * @returns {THREE.Matrix4}
 */
export function getTransformMatrix(t, animation, initialAxes) {
  const axes = initialAxes || new THREE.Matrix4();

  // Decompose using PTA's row-based convention
  const { pos: axesPos, scale: axesScale, rotMatrix: axesRot } = ptaDecompose(axes);

  // Follow exact C++ getTMatrix() step order:
  // 1. retMatrix = Identity
  // 2. retMatrix.scale(axesScale)           → retMatrix = diag(axesScale)
  // 3. retMatrix.scale(animScl, sAxes)      → retMatrix = buildScale * diag(axesScale)
  // 4. retMatrix = axesRot * retMatrix       → left-multiply initial rotation
  // 5. retMatrix.rotate(animRot)            → left-multiply animated rotation
  // 6. retMatrix.translate(axesPos)          → left-multiply initial translation
  // 7. retMatrix.translate(animPos)          → left-multiply animated translation

  // Step 1-2: Start with initial scale (diagonal)
  const result = new THREE.Matrix4().makeScale(axesScale.x, axesScale.y, axesScale.z);

  // Step 3: Animated scale (oriented along sclKey.axes quaternion)
  if (animation.sclKeys && animation.sclKeys.length > 0) {
    const sclKey = interpolateScale(animation.sclKeys, t);
    // PTA buildScale: sAxes * diag(S) * inv(sAxes)
    // Then addTransform (left-multiply): result = scaleMatrix * result
    const sAxesMat = new THREE.Matrix4().makeRotationFromQuaternion(sclKey.axes);
    const sAxesInv = sAxesMat.clone().invert();
    const diagS = new THREE.Matrix4().makeScale(sclKey.scale.x, sclKey.scale.y, sclKey.scale.z);
    const scaleMatrix = sAxesMat.clone().multiply(diagS).multiply(sAxesInv);
    result.premultiply(scaleMatrix);
  }

  // Step 4: Initial rotation (left-multiply)
  result.premultiply(axesRot);

  // Step 5: Animated rotation
  if (animation.rotKeys && animation.rotKeys.length > 0) {
    const rotQuat = interpolateRotation(animation.rotKeys, t);
    const animRot = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);
    result.premultiply(animRot);
  }

  // Step 6: Initial axes translation
  const transMatrix = new THREE.Matrix4().makeTranslation(axesPos.x, axesPos.y, axesPos.z);
  result.premultiply(transMatrix);

  // Step 7: Animated translation
  if (animation.posKeys && animation.posKeys.length > 0) {
    const posKey = interpolatePosition(animation.posKeys, t);
    const animTrans = new THREE.Matrix4().makeTranslation(posKey.x, posKey.y, posKey.z);
    result.premultiply(animTrans);
  }

  return result;
}
