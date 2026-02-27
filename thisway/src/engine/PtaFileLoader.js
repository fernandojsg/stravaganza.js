import { BinaryReader } from '../utils/BinaryReader.js';
import { ptaToThreePos, ptaToThreeQuat, ptaToThreeMatrix, ptaToThreeScale } from '../utils/CoordinateSystem.js';
import * as THREE from 'three';

/**
 * PTA Binary File Format Loader
 *
 * Parses the PTA 3D scene format:
 * - 1024-byte header
 * - Chunk-based sections: GI__, ML__, GO__, CO__, LO__, HO__, _PTA
 *
 * PTA uses Y-up right-handed, same as Three.js — no coordinate conversion needed.
 */

// Header flags
const FILE_GLOBALINFO    = 1 << 0;
const FILE_MATERIALS     = 1 << 1;
const FILE_GEOMOBJECTS   = 1 << 2;
const FILE_CAMERAS       = 1 << 3;
const FILE_LIGHTS        = 1 << 4;
const FILE_HELPERS       = 1 << 5;
const FILE_ANIM_KEYS     = 1 << 6;
const FILE_CAM_SETTINGS  = 1 << 7;
const FILE_LIGHT_SETTINGS = 1 << 8;
const FILE_MESH_NORMALS  = 1 << 9;
const FILE_MESH_COLORS   = 1 << 10;
const FILE_MESH_UV       = 1 << 11;

// Object property flags
const OBJ_MATERIAL    = 1 << 0;
const OBJ_POSKEYS     = 1 << 1;
const OBJ_SCLKEYS     = 1 << 2;
const OBJ_ROTKEYS     = 1 << 3;
const OBJ_DEFORMABLE  = 1 << 4;
const OBJ_EDGEVISINFO = 1 << 5;

// Camera property flags
const CAM_ANIMSETTINGS  = 1 << 0;
const CAM_POSKEYS        = 1 << 1;
const CAM_SCLKEYS        = 1 << 2;
const CAM_ROTKEYS        = 1 << 3;
const TCAM_POSKEYS       = 1 << 4;
const TCAM_SCLKEYS       = 1 << 5;
const TCAM_ROTKEYS       = 1 << 6;

// Light property flags
const LIGHT_ANIMSETTINGS = 1 << 0;
const LIGHT_POSKEYS      = 1 << 1;
const LIGHT_SCLKEYS      = 1 << 2;
const LIGHT_ROTKEYS      = 1 << 3;
const TLIGHT_POSKEYS     = 1 << 4;
const TLIGHT_SCLKEYS     = 1 << 5;
const TLIGHT_ROTKEYS     = 1 << 6;

// Material property flags (from Pta3DMaterial.h)
const MAT_HASTEX1  = 1 << 0;
const MAT_TEX1SPH  = 1 << 1;
const MAT_HASTEX2  = 1 << 8;
const MAT_TEX2SPH  = 1 << 9;
const MAT_BUMP     = 1 << 30;
const MAT_2SIDES   = 1 << 31;

// UV channel flags
const UVCHANNEL_1 = 1 << 0;
const UVCHANNEL_2 = 1 << 1;

/**
 * Parsed PTA scene data.
 */
export class PtaScene {
  constructor() {
    this.header = null;
    this.globalInfo = null;
    this.materials = [];
    this.objects = [];
    this.cameras = [];
    this.lights = [];
    this.helpers = [];
    this.animStartTime = 0;
    this.animEndTime = 0;
  }
}

/**
 * Read animation position keys from binary reader.
 * Each key: time(float), x(float), y(float), z(float) = 16 bytes
 * Applies coordinate conversion.
 */
function readPosKeys(reader, count) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const t = reader.readFloat();
    const x = reader.readFloat();
    const y = reader.readFloat();
    const z = reader.readFloat();
    keys.push({ t, pos: ptaToThreePos(x, y, z) });
  }
  return keys;
}

/**
 * Read animation scale keys from binary reader.
 * Each key: time(float), sx, sy, sz(floats), qw, qx, qy, qz(floats) = 32 bytes
 */
function readSclKeys(reader, count) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const t = reader.readFloat();
    const sx = reader.readFloat();
    const sy = reader.readFloat();
    const sz = reader.readFloat();
    const qw = reader.readFloat();
    const qx = reader.readFloat();
    const qy = reader.readFloat();
    const qz = reader.readFloat();
    keys.push({
      t,
      scale: ptaToThreeScale(sx, sy, sz),
      axes: ptaToThreeQuat(qx, qy, qz, qw),
    });
  }
  return keys;
}

/**
 * Read animation rotation keys from binary reader.
 * Each key: time(float), qw, qx, qy, qz(floats) = 20 bytes
 */
function readRotKeys(reader, count) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const t = reader.readFloat();
    const qw = reader.readFloat();
    const qx = reader.readFloat();
    const qy = reader.readFloat();
    const qz = reader.readFloat();
    keys.push({ t, quat: ptaToThreeQuat(qx, qy, qz, qw) });
  }
  return keys;
}

/**
 * Read a material (recursive for sub-materials).
 */
function readMaterial(reader) {
  const mat = {};
  mat.name = reader.readCString();
  mat.flags = reader.readInt32();
  mat.ambient = { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() };
  mat.diffuse = { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() };
  mat.specular = { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() };
  mat.shininess = reader.readFloat();

  mat.texture1 = null;
  mat.texture2 = null;
  mat.isTwoSided = !!(mat.flags & MAT_2SIDES);
  mat.isBumpMap = !!(mat.flags & MAT_BUMP);
  mat.tex1Spherical = !!(mat.flags & MAT_TEX1SPH);
  mat.tex2Spherical = !!(mat.flags & MAT_TEX2SPH);

  if (mat.flags & MAT_HASTEX1) {
    mat.texture1 = reader.readCString();
  }
  if (mat.flags & MAT_HASTEX2) {
    mat.texture2 = reader.readCString();
  }

  // Sub-materials
  const numSubMaterials = reader.readInt32();
  mat.subMaterials = [];
  for (let i = 0; i < numSubMaterials; i++) {
    mat.subMaterials.push(readMaterial(reader));
  }

  return mat;
}

/**
 * Load and parse a .pta file.
 * @param {string} url - URL to the .pta file
 * @returns {Promise<PtaScene>}
 */
export async function loadPtaFile(url) {
  const reader = await BinaryReader.fromUrl(url);
  const scene = new PtaScene();

  // --- Read 1024-byte header ---
  const header = {};
  header.signature = reader.readString(4);
  header.flags = reader.readInt32();
  header.tInit = reader.readFloat();
  header.tEnd = reader.readFloat();
  header.numPosKeys = reader.readInt32();
  header.numSclKeys = reader.readInt32();
  header.numRotKeys = reader.readInt32();
  header.numCamKeys = reader.readInt32();
  header.numLightKeys = reader.readInt32();
  header.numObjects = reader.readInt32();
  header.numCameras = reader.readInt32();
  header.numLights = reader.readInt32();
  header.numHelpers = reader.readInt32();
  reader.seek(1024); // Skip reserved bytes
  scene.header = header;
  scene.animStartTime = header.tInit;
  scene.animEndTime = header.tEnd;

  // --- Global Info chunk (GI__ ... __GI) ---
  if (header.flags & FILE_GLOBALINFO) {
    const chunkId = reader.readChunkId();
    if (chunkId !== 'GI__') {
      console.warn(`Expected GI__ chunk, got: ${chunkId}`);
    }
    scene.globalInfo = {
      bgColor: { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() },
      ambientColor: { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() },
    };
    // Skip to end of GI block — the __GI marker is at absolute file position 2044
    // (C++ code: file->setFilePos(2048 - 4, PTA_FILE_START))
    reader.seek(2048 - 4);
    const endMarker = reader.readChunkId();
    if (endMarker !== '__GI') {
      console.warn(`Expected __GI end marker, got: ${endMarker}`);
    }
  }

  // --- Material List chunk (ML__ ... __ML) ---
  if (header.flags & FILE_MATERIALS) {
    const chunkId = reader.readChunkId();
    if (chunkId !== 'ML__') {
      console.warn(`Expected ML__ chunk, got: ${chunkId}`);
    }
    const numMaterials = reader.readInt32();
    for (let i = 0; i < numMaterials; i++) {
      scene.materials.push(readMaterial(reader));
    }
    const endMarker = reader.readChunkId();
    if (endMarker !== '__ML') {
      console.warn(`Expected __ML end marker, got: ${endMarker}`);
    }
  }

  // --- Read remaining chunks until _PTA end marker ---
  while (!reader.eof()) {
    const chunkId = reader.readChunkId();

    if (chunkId === '_PTA') {
      break; // End of file
    }

    switch (chunkId) {
      case 'GO__':
        scene.objects.push(readGeomObject(reader, header));
        break;
      case 'CO__':
        scene.cameras.push(readCamera(reader, header));
        break;
      case 'LO__':
        scene.lights.push(readLight(reader, header));
        break;
      case 'HO__':
        scene.helpers.push(readHelper(reader, header));
        break;
      default:
        console.warn(`Unknown chunk type: ${chunkId} at offset ${reader.tell() - 4}`);
        // Try to skip to next chunk — this is a fallback
        break;
    }
  }

  return scene;
}

/**
 * Read a geometric object chunk (after GO__ marker).
 */
function readGeomObject(reader, header) {
  const obj = {};
  obj.name = reader.readCString();
  obj.userProps = reader.readCString();
  obj.flags = reader.readInt32();

  // Material or wireframe color
  if (obj.flags & OBJ_MATERIAL) {
    obj.materialId = reader.readInt32();
    reader.readInt32(); // reserved
    reader.readInt32(); // reserved
  } else {
    obj.wireColor = {
      r: reader.readFloat(),
      g: reader.readFloat(),
      b: reader.readFloat(),
    };
    obj.materialId = -1;
  }

  // Transformation matrix (64 bytes = 16 floats, row-major)
  const rawMatrix = reader.readMatrix4x4();
  obj.transformMatrix = ptaToThreeMatrix(rawMatrix);

  // Mesh data counts
  obj.numVertices = reader.readInt32();
  obj.numVertexNormals = reader.readInt32();
  obj.numColorVertices = reader.readInt32();
  obj.numTextureVertices = reader.readInt32();
  obj.uvChannelFlags = reader.readInt32();
  obj.numEdgeFlags = reader.readInt32();
  obj.numFaces = reader.readInt32();

  // Vertices (convert coordinate system)
  obj.vertices = [];
  for (let i = 0; i < obj.numVertices; i++) {
    const x = reader.readFloat();
    const y = reader.readFloat();
    const z = reader.readFloat();
    obj.vertices.push(ptaToThreePos(x, y, z));
  }

  // Vertex normals (convert coordinate system)
  obj.normals = [];
  for (let i = 0; i < obj.numVertexNormals; i++) {
    const x = reader.readFloat();
    const y = reader.readFloat();
    const z = reader.readFloat();
    obj.normals.push(ptaToThreePos(x, y, z)); // normals transform same as positions
  }

  // Vertex colors
  obj.colors = [];
  for (let i = 0; i < obj.numColorVertices; i++) {
    obj.colors.push({
      r: reader.readFloat(),
      g: reader.readFloat(),
      b: reader.readFloat(),
    });
  }

  // UV channel 1
  obj.uvs1 = [];
  if (obj.uvChannelFlags & UVCHANNEL_1) {
    for (let i = 0; i < obj.numTextureVertices; i++) {
      const u = reader.readFloat();
      const v = reader.readFloat();
      obj.uvs1.push({ u, v });
    }
  }

  // UV channel 2
  obj.uvs2 = [];
  if (obj.uvChannelFlags & UVCHANNEL_2) {
    for (let i = 0; i < obj.numTextureVertices; i++) {
      const u = reader.readFloat();
      const v = reader.readFloat();
      obj.uvs2.push({ u, v });
    }
  }

  // Edge flags
  obj.edgeFlags = [];
  for (let i = 0; i < obj.numEdgeFlags; i++) {
    obj.edgeFlags.push(reader.readUint8());
  }

  // Faces (triangle indices)
  // Winding order is preserved because the PTA→Three.js coordinate conversion
  // has determinant +1 (pure rotation), so no winding reversal needed.
  obj.faces = [];
  for (let i = 0; i < obj.numFaces; i++) {
    const v0 = reader.readInt32();
    const v1 = reader.readInt32();
    const v2 = reader.readInt32();
    obj.faces.push({ v0, v1, v2 });
  }

  // Animation keys
  obj.posKeys = [];
  obj.sclKeys = [];
  obj.rotKeys = [];
  if (obj.flags & OBJ_POSKEYS) {
    obj.posKeys = readPosKeys(reader, header.numPosKeys);
  }
  if (obj.flags & OBJ_SCLKEYS) {
    obj.sclKeys = readSclKeys(reader, header.numSclKeys);
  }
  if (obj.flags & OBJ_ROTKEYS) {
    obj.rotKeys = readRotKeys(reader, header.numRotKeys);
  }

  // Bone data — numBones is ALWAYS read (even if OBJ_DEFORMABLE not set)
  obj.bones = [];
  obj.vertexBoneData = null;
  const numBones = reader.readInt32();
  if (numBones > 0) {
    for (let b = 0; b < numBones; b++) {
      const bone = {};
      bone.flags = reader.readInt32();
      const boneMatrix = reader.readMatrix4x4();
      bone.transformMatrix = ptaToThreeMatrix(boneMatrix);
      bone.posKeys = [];
      bone.sclKeys = [];
      bone.rotKeys = [];
      if (bone.flags & OBJ_POSKEYS) {
        bone.posKeys = readPosKeys(reader, header.numPosKeys);
      }
      if (bone.flags & OBJ_SCLKEYS) {
        bone.sclKeys = readSclKeys(reader, header.numSclKeys);
      }
      if (bone.flags & OBJ_ROTKEYS) {
        bone.rotKeys = readRotKeys(reader, header.numRotKeys);
      }
      obj.bones.push(bone);
    }

    // Vertex-bone linkage
    obj.vertexBoneData = [];
    for (let v = 0; v < obj.numVertices; v++) {
      const numLinkedBones = reader.readInt32();
      const localPositions = [];
      for (let b = 0; b < numLinkedBones; b++) {
        const lx = reader.readFloat();
        const ly = reader.readFloat();
        const lz = reader.readFloat();
        localPositions.push(ptaToThreePos(lx, ly, lz));
      }
      const boneIndices = [];
      for (let b = 0; b < numLinkedBones; b++) {
        boneIndices.push(reader.readInt32());
      }
      const weights = [];
      for (let b = 0; b < numLinkedBones; b++) {
        weights.push(reader.readFloat());
      }
      obj.vertexBoneData.push({ localPositions, boneIndices, weights });
    }
  }

  // Read end marker
  const endMarker = reader.readChunkId();
  if (endMarker !== '__GO') {
    console.warn(`Expected __GO end marker for object "${obj.name}", got: ${endMarker}`);
  }

  return obj;
}

/**
 * Read a camera chunk (after CO__ marker).
 */
function readCamera(reader, header) {
  const cam = {};
  cam.name = reader.readCString();
  cam.userProps = reader.readCString();
  cam.type = reader.readInt32(); // 1=Free, 2=Target
  cam.flags = reader.readInt32();

  // Origin transformation matrix
  const rawOrigin = reader.readMatrix4x4();
  cam.originMatrix = ptaToThreeMatrix(rawOrigin);

  // Target matrix (only for target cameras)
  if (cam.type === 2) {
    const rawTarget = reader.readMatrix4x4();
    cam.targetMatrix = ptaToThreeMatrix(rawTarget);
  }

  cam.near = reader.readFloat();
  cam.far = reader.readFloat();
  cam.fov = reader.readFloat();

  // Animated camera settings
  cam.settingsKeys = [];
  if (cam.flags & CAM_ANIMSETTINGS) {
    for (let i = 0; i < header.numCamKeys; i++) {
      cam.settingsKeys.push({
        t: reader.readFloat(),
        near: reader.readFloat(),
        far: reader.readFloat(),
        fov: reader.readFloat(),
      });
    }
  }

  // Origin animation keys
  cam.posKeys = [];
  cam.sclKeys = [];
  cam.rotKeys = [];
  if (cam.flags & CAM_POSKEYS) {
    cam.posKeys = readPosKeys(reader, header.numPosKeys);
  }
  if (cam.flags & CAM_SCLKEYS) {
    cam.sclKeys = readSclKeys(reader, header.numSclKeys);
  }
  if (cam.flags & CAM_ROTKEYS) {
    cam.rotKeys = readRotKeys(reader, header.numRotKeys);
  }

  // Target animation keys
  cam.targetPosKeys = [];
  cam.targetSclKeys = [];
  cam.targetRotKeys = [];
  if (cam.flags & TCAM_POSKEYS) {
    cam.targetPosKeys = readPosKeys(reader, header.numPosKeys);
  }
  if (cam.flags & TCAM_SCLKEYS) {
    cam.targetSclKeys = readSclKeys(reader, header.numSclKeys);
  }
  if (cam.flags & TCAM_ROTKEYS) {
    cam.targetRotKeys = readRotKeys(reader, header.numRotKeys);
  }

  const endMarker = reader.readChunkId();
  if (endMarker !== '__CO') {
    console.warn(`Expected __CO end marker for camera "${cam.name}", got: ${endMarker}`);
  }

  return cam;
}

/**
 * Read a light chunk (after LO__ marker).
 */
function readLight(reader, header) {
  const light = {};
  light.name = reader.readCString();
  light.userProps = reader.readCString();
  light.type = reader.readInt32(); // 1=Omni, 2=Spot, 3=Directional
  light.flags = reader.readInt32();

  // Origin transformation matrix
  const rawOrigin = reader.readMatrix4x4();
  light.originMatrix = ptaToThreeMatrix(rawOrigin);

  // Target matrix (only for spot lights)
  if (light.type === 2) {
    const rawTarget = reader.readMatrix4x4();
    light.targetMatrix = ptaToThreeMatrix(rawTarget);
  }

  light.color = { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() };
  light.intensity = reader.readFloat();
  light.falloff = reader.readFloat();

  // Animated light settings
  light.settingsKeys = [];
  if (light.flags & LIGHT_ANIMSETTINGS) {
    for (let i = 0; i < header.numLightKeys; i++) {
      light.settingsKeys.push({
        t: reader.readFloat(),
        color: { r: reader.readFloat(), g: reader.readFloat(), b: reader.readFloat() },
        intensity: reader.readFloat(),
        falloff: reader.readFloat(),
      });
    }
  }

  // Origin animation keys
  light.posKeys = [];
  light.sclKeys = [];
  light.rotKeys = [];
  if (light.flags & LIGHT_POSKEYS) {
    light.posKeys = readPosKeys(reader, header.numPosKeys);
  }
  if (light.flags & LIGHT_SCLKEYS) {
    light.sclKeys = readSclKeys(reader, header.numSclKeys);
  }
  if (light.flags & LIGHT_ROTKEYS) {
    light.rotKeys = readRotKeys(reader, header.numRotKeys);
  }

  // Target animation keys
  light.targetPosKeys = [];
  light.targetSclKeys = [];
  light.targetRotKeys = [];
  if (light.flags & TLIGHT_POSKEYS) {
    light.targetPosKeys = readPosKeys(reader, header.numPosKeys);
  }
  if (light.flags & TLIGHT_SCLKEYS) {
    light.targetSclKeys = readSclKeys(reader, header.numSclKeys);
  }
  if (light.flags & TLIGHT_ROTKEYS) {
    light.targetRotKeys = readRotKeys(reader, header.numRotKeys);
  }

  const endMarker = reader.readChunkId();
  if (endMarker !== '__LO') {
    console.warn(`Expected __LO end marker for light "${light.name}", got: ${endMarker}`);
  }

  return light;
}

/**
 * Read a helper chunk (after HO__ marker).
 */
function readHelper(reader, header) {
  const helper = {};
  helper.name = reader.readCString();
  helper.userProps = reader.readCString();
  helper.flags = reader.readInt32();

  const rawMatrix = reader.readMatrix4x4();
  helper.transformMatrix = ptaToThreeMatrix(rawMatrix);

  // Bounding box (min/max)
  const minX = reader.readFloat(), minY = reader.readFloat(), minZ = reader.readFloat();
  const maxX = reader.readFloat(), maxY = reader.readFloat(), maxZ = reader.readFloat();
  helper.boundingBox = {
    min: ptaToThreePos(minX, minY, minZ),
    max: ptaToThreePos(maxX, maxY, maxZ),
  };

  // Animation keys
  helper.posKeys = [];
  helper.sclKeys = [];
  helper.rotKeys = [];
  if (helper.flags & OBJ_POSKEYS) {
    helper.posKeys = readPosKeys(reader, header.numPosKeys);
  }
  if (helper.flags & OBJ_SCLKEYS) {
    helper.sclKeys = readSclKeys(reader, header.numSclKeys);
  }
  if (helper.flags & OBJ_ROTKEYS) {
    helper.rotKeys = readRotKeys(reader, header.numRotKeys);
  }

  const endMarker = reader.readChunkId();
  if (endMarker !== '__HO') {
    console.warn(`Expected __HO end marker for helper "${helper.name}", got: ${endMarker}`);
  }

  return helper;
}
