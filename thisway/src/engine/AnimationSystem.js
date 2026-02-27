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
 * Compose a transformation matrix from initial axes + animated keys.
 * Matches PTA's pta3DAnimation::getTMatrix() composition order:
 *
 * 1. Start with initial axes scale
 * 2. Apply animated scale (if keys)
 * 3. Apply initial axes rotation
 * 4. Apply animated rotation (if keys)
 * 5. Apply initial axes translation
 * 6. Apply animated translation (if keys)
 *
 * @param {number} t - Time in ms
 * @param {{posKeys: Array, sclKeys: Array, rotKeys: Array}} animation
 * @param {THREE.Matrix4} initialAxes - The initial world transformation matrix
 * @returns {THREE.Matrix4}
 */
export function getTransformMatrix(t, animation, initialAxes) {
  const axes = initialAxes || new THREE.Matrix4();

  // Decompose initial axes
  const axesPos = new THREE.Vector3();
  const axesQuat = new THREE.Quaternion();
  const axesScale = new THREE.Vector3();
  axes.decompose(axesPos, axesQuat, axesScale);

  // Start building the result
  const result = new THREE.Matrix4();

  // 1. Initial axes scale
  const scaleMatrix = new THREE.Matrix4().makeScale(axesScale.x, axesScale.y, axesScale.z);
  result.copy(scaleMatrix);

  // 2. Animated scale
  if (animation.sclKeys && animation.sclKeys.length > 0) {
    const sclKey = interpolateScale(animation.sclKeys, t);
    const animScale = new THREE.Matrix4().makeScale(sclKey.scale.x, sclKey.scale.y, sclKey.scale.z);
    result.premultiply(animScale);
  }

  // 3. Initial axes rotation
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(axesQuat);
  result.premultiply(rotMatrix);

  // 4. Animated rotation
  if (animation.rotKeys && animation.rotKeys.length > 0) {
    const rotQuat = interpolateRotation(animation.rotKeys, t);
    const animRot = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);
    result.premultiply(animRot);
  }

  // 5. Initial axes translation
  const transMatrix = new THREE.Matrix4().makeTranslation(axesPos.x, axesPos.y, axesPos.z);
  result.premultiply(transMatrix);

  // 6. Animated translation
  if (animation.posKeys && animation.posKeys.length > 0) {
    const posKey = interpolatePosition(animation.posKeys, t);
    const animTrans = new THREE.Matrix4().makeTranslation(posKey.x, posKey.y, posKey.z);
    result.premultiply(animTrans);
  }

  return result;
}
