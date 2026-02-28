/**
 * Coordinate System Conversion: PTA → Three.js
 *
 * PTA uses the same coordinate convention as OpenGL/Three.js:
 *   Right-handed, Y-up: X = right, Y = up, Z = out of screen
 *   (Confirmed by Pta3DMath.h header and buildClipPlanes() in Pta3DCamera.cpp)
 *
 * PTA stores matrices as M[row][col] (row-major in memory).
 * Three.js stores matrices as column-major in elements[].
 * Both use column-vector convention: v' = M * v.
 *
 * The 3DS Max exporter (ExpNodes.cpp::exportaTM) transposes the Matrix3
 * when writing to disk, converting from 3DS Max's row-vector convention
 * to PTA's column-vector convention. The file stores data row-by-row
 * in PTA's M[row][col] format.
 *
 * Three.js Matrix4.set(n11..n44) takes row-major arguments and stores
 * them column-major internally, producing the same mathematical matrix.
 * So: raw.set(m[0]..m[15]) is the exact conversion needed — no axis swap.
 *
 * UV coordinates: PTA uses V=0 at bottom (same as Three.js/OpenGL in principle),
 * but .pta files from the 3DS Max exporter may need V flipped depending on
 * how textures were authored.
 */

import * as THREE from 'three';

/**
 * Convert a position/vertex/normal from PTA to Three.js.
 * No axis conversion needed — PTA and Three.js use the same Y-up convention.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {THREE.Vector3}
 */
export function ptaToThreePos(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

/**
 * Convert in-place: no-op since PTA and Three.js share the same convention.
 * @param {THREE.Vector3} v
 * @returns {THREE.Vector3}
 */
export function ptaToThreePosInPlace(v) {
  return v;
}

/**
 * Convert a quaternion from PTA to Three.js.
 * PTA file stores: w, x, y, z. Three.js Quaternion constructor: (x, y, z, w).
 * No axis conversion needed.
 * @param {number} qx
 * @param {number} qy
 * @param {number} qz
 * @param {number} qw
 * @returns {THREE.Quaternion}
 */
export function ptaToThreeQuat(qx, qy, qz, qw) {
  return new THREE.Quaternion(qx, qy, qz, qw);
}

/**
 * Convert a PTA row-major 4x4 matrix to a Three.js Matrix4.
 *
 * PTA stores M[row][col] in row-major memory layout.
 * Three.js Matrix4.set() takes row-major arguments (n11, n12, n13, n14, ...)
 * and stores them column-major internally.
 *
 * Both PTA and Three.js use column-vector convention (v' = M * v),
 * so the mathematical matrix is identical — just a memory layout change.
 *
 * @param {Float32Array|number[]} m - 16 floats in PTA row-major order
 * @returns {THREE.Matrix4}
 */
export function ptaToThreeMatrix(m) {
  const result = new THREE.Matrix4();
  result.set(
    m[0], m[1], m[2], m[3],
    m[4], m[5], m[6], m[7],
    m[8], m[9], m[10], m[11],
    m[12], m[13], m[14], m[15]
  );
  return result;
}

/**
 * Convert UV coordinates from PTA to Three.js.
 * @param {number} u
 * @param {number} v
 * @param {boolean} flipV - Whether to flip V coordinate (default: false)
 * @returns {{u: number, v: number}}
 */
export function ptaToThreeUV(u, v, flipV = false) {
  return { u, v: flipV ? (1 - v) : v };
}

/**
 * Convert an Euler rotation from PTA to Three.js.
 * PTA uses degrees; Three.js uses radians.
 * No axis conversion needed.
 * @param {number} rx - Rotation around X axis (degrees)
 * @param {number} ry - Rotation around Y axis (degrees)
 * @param {number} rz - Rotation around Z axis (degrees)
 * @returns {THREE.Euler}
 */
export function ptaToThreeEuler(rx, ry, rz) {
  const deg2rad = Math.PI / 180;
  return new THREE.Euler(rx * deg2rad, ry * deg2rad, rz * deg2rad, 'XYZ');
}

/**
 * Convert a scale vector from PTA to Three.js.
 * No axis conversion needed.
 * @param {number} sx
 * @param {number} sy
 * @param {number} sz
 * @returns {THREE.Vector3}
 */
export function ptaToThreeScale(sx, sy, sz) {
  return new THREE.Vector3(sx, sy, sz);
}

/**
 * Convert a color from PTA (r, g, b, a) with 0-1 range to Three.js Color.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {THREE.Color}
 */
export function ptaToThreeColor(r, g, b) {
  return new THREE.Color(r, g, b);
}
