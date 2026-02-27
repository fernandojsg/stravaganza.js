/**
 * BinaryReader - DataView wrapper mirroring ptaFile interface.
 * PTA uses little-endian byte order (x86 Windows).
 */
export class BinaryReader {
  /**
   * @param {ArrayBuffer} buffer
   */
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
    this.length = buffer.byteLength;
  }

  /**
   * Create from fetch response
   * @param {string} url
   * @returns {Promise<BinaryReader>}
   */
  static async fromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return new BinaryReader(buffer);
  }

  seek(offset) {
    this.offset = offset;
  }

  skip(bytes) {
    this.offset += bytes;
  }

  tell() {
    return this.offset;
  }

  eof() {
    return this.offset >= this.length;
  }

  remaining() {
    return this.length - this.offset;
  }

  readUint8() {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readInt8() {
    const val = this.view.getInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint16() {
    const val = this.view.getUint16(this.offset, true); // little-endian
    this.offset += 2;
    return val;
  }

  readInt16() {
    const val = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readUint32() {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readInt32() {
    const val = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readFloat() {
    const val = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readDouble() {
    const val = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return val;
  }

  /**
   * Read a fixed-length string (null-terminated within buffer)
   * @param {number} length - Number of bytes to read
   * @returns {string}
   */
  readString(length) {
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    // Find null terminator
    let end = bytes.indexOf(0);
    if (end === -1) end = length;
    return new TextDecoder('ascii').decode(bytes.subarray(0, end));
  }

  /**
   * Read a null-terminated string (variable length)
   * @returns {string}
   */
  readCString() {
    const start = this.offset;
    while (this.offset < this.length && this.view.getUint8(this.offset) !== 0) {
      this.offset++;
    }
    const bytes = new Uint8Array(this.buffer, start, this.offset - start);
    this.offset++; // skip null terminator
    return new TextDecoder('ascii').decode(bytes);
  }

  /**
   * Read a 4-character chunk ID
   * @returns {string}
   */
  readChunkId() {
    return this.readString(4);
  }

  /**
   * Read N floats into an array
   * @param {number} count
   * @returns {Float32Array}
   */
  readFloatArray(count) {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readFloat();
    }
    return arr;
  }

  /**
   * Read N uint32s into an array
   * @param {number} count
   * @returns {Uint32Array}
   */
  readUint32Array(count) {
    const arr = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUint32();
    }
    return arr;
  }

  /**
   * Read raw bytes
   * @param {number} count
   * @returns {Uint8Array}
   */
  readBytes(count) {
    const bytes = new Uint8Array(this.buffer, this.offset, count);
    this.offset += count;
    return bytes.slice(); // return a copy
  }

  /**
   * Peek at bytes without advancing offset
   * @param {number} count
   * @returns {Uint8Array}
   */
  peekBytes(count) {
    return new Uint8Array(this.buffer, this.offset, count);
  }

  /**
   * Read a 3-component vector (x, y, z)
   * @returns {{x: number, y: number, z: number}}
   */
  readVector3() {
    return {
      x: this.readFloat(),
      y: this.readFloat(),
      z: this.readFloat(),
    };
  }

  /**
   * Read a 4-component vector/quaternion (x, y, z, w)
   * @returns {{x: number, y: number, z: number, w: number}}
   */
  readVector4() {
    return {
      x: this.readFloat(),
      y: this.readFloat(),
      z: this.readFloat(),
      w: this.readFloat(),
    };
  }

  /**
   * Read a 4x4 matrix (16 floats, row-major as stored by PTA/3DS Max)
   * @returns {Float32Array}
   */
  readMatrix4x4() {
    return this.readFloatArray(16);
  }
}
