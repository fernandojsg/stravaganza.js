import * as THREE from 'three';
import { getTransformMatrix, interpolatePosition, interpolateRotation, interpolateCameraSettings } from './AnimationSystem.js';

// PTA hardcodes the aspect ratio to 2.0 (≈800/420 demo viewport).
// FOV stored in .pta files is horizontal; PTA converts to vertical via fov/ASPECT.
const PTA_ASPECT = 2.0;
// PTA fixed-function OpenGL computes specular per-vertex (Gouraud), while
// Three.js MeshPhong computes per-fragment and looks hotter on low-poly meshes.
const PTA_SPECULAR_VERTEX_COMPENSATION_DEFAULT = 1.0;
const PTA_SPECULAR_VERTEX_COMPENSATION_CUBOS = 0.35;

/**
 * SceneManager - Converts parsed PTA scene data to Three.js scene graphs
 * and handles animated rendering.
 */
export class SceneManager {
  constructor(renderer) {
    this.renderer = renderer;
    /** @type {Map<string, ManagedScene>} */
    this.scenes = new Map();
  }

  /**
   * Build a Three.js scene from parsed PTA data.
   * @param {string} id - Scene identifier
   * @param {import('./PtaFileLoader.js').PtaScene} ptaScene - Parsed PTA scene
   * @param {Map<string, THREE.Texture>} textures - Loaded textures by filename
   * @returns {ManagedScene}
   */
  buildScene(id, ptaScene, textures = new Map()) {
    const managed = new ManagedScene(ptaScene);
    const sourcePath = (ptaScene.sourcePath || '').toLowerCase();
    const specularCompensation = PTA_SPECULAR_VERTEX_COMPENSATION_DEFAULT;

    // Check if scene has lights — use unlit materials if not.
    // PTA determines lighting at load time: numLights > 0 → lit, else unlit.
    // Global ambient alone does NOT enable lighting (matches C++ behavior).
    const parsedLights = ptaScene.lights || [];
    const headerLightCount = Math.max(0, ptaScene.header?.numLights || 0);
    // Some legacy files have numLights > 0 in header but miss LO__ chunks.
    // C++ still allocates default lights in that case, so emulate that behavior.
    const effectiveLightCount = Math.max(parsedLights.length, headerLightCount);
    const hasLights = effectiveLightCount > 0;
    const useLighting = hasLights;

    // Global ambient color for per-material emissive (PTA: globalAmbient * matAmbient)
    const globalAmbient = ptaScene.globalInfo
      ? { r: ptaScene.globalInfo.ambientColor.r, g: ptaScene.globalInfo.ambientColor.g, b: ptaScene.globalInfo.ambientColor.b }
      : { r: 0, g: 0, b: 0 };

    // C++ OpenGL: each light has hardcoded ambient = (0.1, 0.1, 0.1) (WrpLighting.cpp:144).
    // This adds numLights * 0.1 * matAmbient to every surface — bake into emissive.
    const numLights = effectiveLightCount;

    // Build materials
    const threeMaterials = ptaScene.materials.map(mat => this._buildMaterial(
      mat, textures, useLighting, globalAmbient, numLights, specularCompensation
    ));

    // Build objects
    for (const obj of ptaScene.objects) {
      const mesh = this._buildMesh(obj, threeMaterials);
      if (mesh) {
        managed.threeScene.add(mesh);
        managed.meshes.set(obj.name, { mesh, data: obj });
      }
    }

    // Build cameras
    for (const cam of ptaScene.cameras) {
      const threeCamera = this._buildCamera(cam);
      managed.cameras.set(cam.name, { camera: threeCamera, data: cam });
    }

    // Build lights
    for (const light of parsedLights) {
      const threeLight = this._buildLight(light);
      if (threeLight) {
        managed.threeScene.add(threeLight);
        managed.lights.set(light.name, { light: threeLight, data: light });
      }
    }
    for (let i = parsedLights.length; i < effectiveLightCount; i++) {
      const fallbackLight = this._buildDefaultLight(i);
      managed.threeScene.add(fallbackLight);
      managed.lights.set(fallbackLight.name, { light: fallbackLight, data: null });
    }

    // PTA ambient: globalAmbient * materialAmbient (baked into emissive per material).
    // No Three.js AmbientLight needed — avoids diffuse-as-ambient brightening.
    if (ptaScene.globalInfo) {
      const gi = ptaScene.globalInfo;
      if (gi.bgColor) {
        managed.bgColor = new THREE.Color(gi.bgColor.r, gi.bgColor.g, gi.bgColor.b);
      }
    }

    this.scenes.set(id, managed);
    return managed;
  }

  /**
   * Render a scene at a given animation time.
   * @param {string} id - Scene identifier
   * @param {number} sceneTime - Time within scene animation (ms)
   * @param {string} [cameraName] - Camera to use (default: first camera)
   * @param {number} [playSpeed=1] - Playback speed multiplier
   */
  renderScene(id, sceneTime, cameraName, playSpeed = 1) {
    const managed = this.scenes.get(id);
    if (!managed) {
      console.warn(`Scene "${id}" not found`);
      return;
    }

    const t = sceneTime * playSpeed;

    // Update all objects (skip if sceneTime < 0, meaning caller manages matrices)
    if (sceneTime >= 0) {
      for (const [name, { mesh, data }] of managed.meshes) {
        const matrix = getTransformMatrix(t, data, data.transformMatrix);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
      }
    }

    // Find camera
    let activeCamera = null;
    if (cameraName && managed.cameras.has(cameraName)) {
      const camEntry = managed.cameras.get(cameraName);
      activeCamera = camEntry.camera;
      // Only update camera animation if sceneTime >= 0
      if (sceneTime >= 0) {
        this._updateCamera(camEntry.camera, camEntry.data, t);
      }
    } else if (managed.cameras.size > 0) {
      const [firstCam] = managed.cameras.values();
      activeCamera = firstCam.camera;
      if (sceneTime >= 0) {
        this._updateCamera(firstCam.camera, firstCam.data, t);
      }
    }

    if (!activeCamera) {
      // Fallback perspective camera
      activeCamera = new THREE.PerspectiveCamera(60 / PTA_ASPECT, PTA_ASPECT, 0.1, 10000);
      activeCamera.position.set(0, 5, 10);
      activeCamera.lookAt(0, 0, 0);
    }

    // PTA hardcodes aspect = 2.0 in setFrustum(), regardless of viewport.
    // Even inside a 512x512 ViewportInt, the frustum uses ASPECT=2.0.
    if (activeCamera.isPerspectiveCamera) {
      activeCamera.aspect = PTA_ASPECT;
      activeCamera.updateProjectionMatrix();
    }

    // Update lights
    for (const [name, { light, data }] of managed.lights) {
      if (data) this._updateLight(light, data, t);
    }

    // Render
    this.renderer.renderScene(managed.threeScene, activeCamera);
  }

  getScene(id) {
    return this.scenes.get(id);
  }

  _buildMaterial(
    matData,
    textures,
    useLighting = true,
    globalAmbient = { r: 0, g: 0, b: 0 },
    numLights = 0,
    specularCompensation = PTA_SPECULAR_VERTEX_COMPENSATION_DEFAULT
  ) {
    // PTA fixed-function OpenGL: diffuse = lightColor * matDiffuse * NdotL (no 1/PI).
    // Three.js BRDF_Lambert divides by PI for lit (MeshPhongMaterial) materials.
    // Multiply lit diffuse by PI so the 1/PI division cancels out, matching PTA.
    // Unlit (MeshBasicMaterial) has no BRDF_Lambert — use raw diffuse directly.
    const rawColor = new THREE.Color(matData.diffuse.r, matData.diffuse.g, matData.diffuse.b);
    const litColor = new THREE.Color(
      matData.diffuse.r * Math.PI,
      matData.diffuse.g * Math.PI,
      matData.diffuse.b * Math.PI,
    );
    const side = matData.isTwoSided ? THREE.DoubleSide : THREE.FrontSide;

    // Find textures by name matching
    let mapTexture = null;
    let bumpMapTexture = null;
    let lightMapTexture = null;

    if (matData.texture1) {
      const texName = matData.texture1.toLowerCase();
      for (const [key, tex] of textures) {
        if (key.toLowerCase().includes(texName) || texName.includes(key.toLowerCase())) {
          // texture1 is always the diffuse map (isBumpMap flag applies to texture2)
          mapTexture = tex;
          break;
        }
      }
    }

    if (matData.texture2) {
      const texName = matData.texture2.toLowerCase();
      for (const [key, tex] of textures) {
        if (key.toLowerCase().includes(texName) || texName.includes(key.toLowerCase())) {
          if (matData.isBumpMap) {
            // PTA DOT3 bump maps encode tangent-space normals as RGB (GL_DOT3_RGB).
            // Three.js normalMap expects the same encoding: normal = 2 * texColor - 1.
            // Normal maps contain data, not color — must use linear color space.
            // Disable mipmaps to preserve fine detail at high UV tiling rates.
            // PTA DOT3 register combiners sample at full resolution; trilinear
            // mipmapping averages out the high-frequency grain, making bumps appear coarser.
            const bumpTex = tex.clone();
            bumpTex.colorSpace = THREE.LinearSRGBColorSpace;
            bumpTex.generateMipmaps = false;
            bumpTex.minFilter = THREE.LinearFilter;
            bumpMapTexture = bumpTex;
          } else {
            lightMapTexture = tex;
          }
          break;
        }
      }
    }

    // PTA GL_SPHERE_MAP: generates texture coordinates from view-space reflection vectors.
    // Keep textures as regular maps; effects compute sphere-map UVs from normals per frame.
    // Flag sphere-mapped textures so effects know to update UVs.
    let hasSphereMap = false;
    if (matData.tex1Spherical && mapTexture) {
      hasSphereMap = true;
    }
    if (matData.tex2Spherical && lightMapTexture) {
      // Second sphere texture used as additional layer — use as map if no tex1
      if (!mapTexture) {
        mapTexture = lightMapTexture;
        hasSphereMap = true;
      }
      lightMapTexture = null;
    }

    let mat;
    if (useLighting) {
      // PTA ambient term: globalAmbient * materialAmbient (per-material, NOT diffuse).
      // Three.js AmbientLight uses diffuse color (too bright). Bake into emissive instead.
      // C++ also adds per-light ambient: each light has hardcoded ambient = (0.1, 0.1, 0.1).
      // Total: (globalAmbient + numLights * 0.1) * materialAmbient
      const perLightAmbient = numLights * 0.1;
      const emissive = new THREE.Color(
        (globalAmbient.r + perLightAmbient) * matData.ambient.r,
        (globalAmbient.g + perLightAmbient) * matData.ambient.g,
        (globalAmbient.b + perLightAmbient) * matData.ambient.b,
      );

      const params = {
        color: litColor, side, emissive,
        specular: new THREE.Color(matData.specular.r, matData.specular.g, matData.specular.b)
          .multiplyScalar(specularCompensation),
        // PTA: glMaterialf(GL_SHININESS, shininess * 128.0f)
        shininess: matData.shininess * 128.0,
      };
      if (mapTexture) params.map = mapTexture;
      if (bumpMapTexture) {
        // PTA texture2 (DOT3 bump) uses UV channel 2. Our geometry stores this
        // as the 'uv2' attribute (Three.js channel 2). Must set channel so the
        // normalMap samples from the correct UVs — UV channel 2 may have different
        // tiling than UV channel 1 (e.g., mamut: UV1 is 0-1, UV2 is -0.75 to 1.75).
        bumpMapTexture.channel = 2;
        params.normalMap = bumpMapTexture;
        // PTA DOT3 bump does full per-pixel normal replacement via NV register combiners.
        // Three.js normalMap with normalScale=1.0 matches this behavior.
        params.normalScale = new THREE.Vector2(1.0, 1.0);
      }
      // PTA's texture2 (non-bump) uses GL_MODULATE: result *= tex2.
      // Three.js lightMap is ADDITIVE (wrong). Use aoMap + onBeforeCompile
      // to make it multiplicative on ALL lighting (direct + indirect).
      if (lightMapTexture) {
        // Lightmaps use UV channel 2 (unique unwrap, 0-1 range) — NOT the
        // tiling diffuse UVs from channel 1. Three.js getChannel() maps:
        //   channel 0 → 'uv', channel 1 → 'uv1', channel 2 → 'uv2'
        // Our geometry stores the second UV set as 'uv2', so use channel=2.
        // If the PTA file lacks UV channel 2, _buildMesh copies uv→uv2.
        lightMapTexture.channel = 2;
        params.aoMap = lightMapTexture;
        params.aoMapIntensity = 1.0;
      }
      mat = new THREE.MeshPhongMaterial(params);

      // Patch shader for lightmap multiplicative blending if needed.
      if (lightMapTexture) {
        mat.onBeforeCompile = (shader) => {
          // Replace aomap_fragment: PTA GL_MODULATE multiplies ALL output by tex2.
          // In PTA, vertex lighting (ambient + diffuse) goes through texUnit0 (* tex1)
          // then texUnit1 (* tex2). Our emissive (baked ambient) must also be multiplied
          // by both tex1 and tex2 to match.
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <aomap_fragment>',
            /* glsl */ `
            #ifdef USE_AOMAP
              vec3 tex2Color = texture2D( aoMap, vAoMapUv ).rgb;
              reflectedLight.indirectDiffuse *= tex2Color;
              reflectedLight.directDiffuse *= tex2Color;
              reflectedLight.directSpecular *= tex2Color;
              totalEmissiveRadiance *= tex2Color;
              #ifdef USE_MAP
                totalEmissiveRadiance *= texture2D( map, vMapUv ).rgb;
              #endif
            #endif
            `
          );
        };
      }
    } else {
      // Unlit: PTA disables GL_LIGHTING, uses glColor(diffuse) with GL_MODULATE.
      // Match PTA exactly: straight diffuse multiplier, no extra gamma transform.
      const params = { color: rawColor, side };
      if (mapTexture) params.map = mapTexture;
      mat = new THREE.MeshBasicMaterial(params);
    }

    // PTA auto-enables alpha blending (SrcAlpha/InvSrcAlpha) when any texture
    // on a material is 32-bit (has alpha channel). Enable Three.js transparency.
    if ((mapTexture && mapTexture._hasAlpha) || (lightMapTexture && lightMapTexture._hasAlpha)) {
      mat.transparent = true;
    }

    // Flag for effects that need to compute sphere-map UVs from normals
    if (hasSphereMap) mat._hasSphereMap = true;

    // Handle sub-materials
    if (matData.subMaterials && matData.subMaterials.length > 0) {
      mat._subMaterials = matData.subMaterials.map(sm => this._buildMaterial(
        sm, textures, useLighting, globalAmbient, numLights, specularCompensation
      ));
    }

    return mat;
  }

  _buildMesh(objData, materials) {
    if (objData.numVertices === 0 || objData.numFaces === 0) return null;

    const geometry = new THREE.BufferGeometry();
    const normalSource = objData.normals.length > 0
      ? objData.normals
      : this._computePtaVertexNormals(objData);

    // Positions
    const positions = new Float32Array(objData.numFaces * 3 * 3);
    // Normals
    const normals = normalSource.length > 0 ? new Float32Array(objData.numFaces * 3 * 3) : null;
    // UVs
    const uvs = objData.uvs1.length > 0 ? new Float32Array(objData.numFaces * 3 * 2) : null;
    // UV2 (lightmap channel)
    const uvs2 = objData.uvs2 && objData.uvs2.length > 0 ? new Float32Array(objData.numFaces * 3 * 2) : null;
    // Colors
    const colors = objData.colors.length > 0 ? new Float32Array(objData.numFaces * 3 * 3) : null;

    // Build per-face vertex data (unindexed for per-face normals/uvs)
    for (let f = 0; f < objData.numFaces; f++) {
      const face = objData.faces[f];
      const i0 = face.v0, i1 = face.v1, i2 = face.v2;

      for (let vi = 0; vi < 3; vi++) {
        const idx = [i0, i1, i2][vi];
        const base = (f * 3 + vi);

        if (idx < objData.vertices.length) {
          const v = objData.vertices[idx];
          positions[base * 3] = v.x;
          positions[base * 3 + 1] = v.y;
          positions[base * 3 + 2] = v.z;
        }

        if (normals && idx < normalSource.length) {
          const n = normalSource[idx];
          normals[base * 3] = n.x;
          normals[base * 3 + 1] = n.y;
          normals[base * 3 + 2] = n.z;
        }

        if (uvs && idx < objData.uvs1.length) {
          const uv = objData.uvs1[idx];
          uvs[base * 2] = uv.u;
          uvs[base * 2 + 1] = uv.v;
        }

        if (uvs2 && idx < objData.uvs2.length) {
          const uv = objData.uvs2[idx];
          uvs2[base * 2] = uv.u;
          uvs2[base * 2 + 1] = uv.v;
        }

        if (colors && idx < objData.colors.length) {
          const c = objData.colors[idx];
          colors[base * 3] = c.r;
          colors[base * 3 + 1] = c.g;
          colors[base * 3 + 2] = c.b;
        }
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (uvs2) geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs2, 2));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Select material
    let material;
    if (objData.materialId >= 0 && objData.materialId < materials.length) {
      material = materials[objData.materialId];
    } else if (objData.wireColor) {
      material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(objData.wireColor.r, objData.wireColor.g, objData.wireColor.b),
      });
    } else {
      material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    }

    // Clone material if object-specific adjustments are needed
    let needClone = false;
    if (colors && !material.vertexColors) needClone = true;
    // If mesh has no UVs but material has a texture map, the texture can't be sampled.
    // In C++ OpenGL, missing texcoords default to (0,0) and sample a single texel.
    // In Three.js, missing 'uv' attribute makes the texture render black.
    // Remove the map for meshes without UVs to show the diffuse color instead.
    // Exception: sphere-mapped materials — UVs are generated per-frame by effect code.
    if (!uvs && material.map && !material._hasSphereMap) needClone = true;

    if (needClone) {
      material = material.clone();
      if (colors) material.vertexColors = true;
      if (!uvs && !material._hasSphereMap) material.map = null;
    }

    // If material uses aoMap or normalMap on channel 2 but geometry has no uv2,
    // copy uv to uv2 so the shader can sample the second texture.
    const needsUv2 = (material.aoMap && material.aoMap.channel === 2) ||
                     (material.normalMap && material.normalMap.channel === 2);
    if (needsUv2 && !geometry.hasAttribute('uv2')) {
      const uvAttr = geometry.getAttribute('uv');
      if (uvAttr) geometry.setAttribute('uv2', uvAttr);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = objData.name;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(objData.transformMatrix);

    return mesh;
  }

  _computePtaVertexNormals(objData) {
    // Matches pta3DObject::ComputeNormals(true):
    // average face normals by ORIGINAL vertex index (no position merging).
    const out = Array.from({ length: objData.numVertices }, () => new THREE.Vector3(0, 0, 0));
    // PTA hasNegScale() returns true when the 3x3 orientation term is positive.
    const ptaHasNegScale = objData.transformMatrix.determinant() > 0;
    const i0 = ptaHasNegScale ? 2 : 0;
    const i1 = 1;
    const i2 = ptaHasNegScale ? 0 : 2;
    const vector1 = new THREE.Vector3();
    const vector2 = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();

    for (let f = 0; f < objData.numFaces; f++) {
      const face = objData.faces[f];
      const fv = [face.v0, face.v1, face.v2];
      const a = fv[i0], b = fv[i1], c = fv[i2];
      if (a >= objData.vertices.length || b >= objData.vertices.length || c >= objData.vertices.length) continue;

      const va = objData.vertices[a];
      const vb = objData.vertices[b];
      const vc = objData.vertices[c];

      vector1.set(vb.x - va.x, vb.y - va.y, vb.z - va.z);
      vector2.set(vc.x - vb.x, vc.y - vb.y, vc.z - vb.z);
      faceNormal.copy(vector2).cross(vector1);

      if (faceNormal.lengthSq() > 0) {
        faceNormal.normalize();
        out[a].add(faceNormal);
        out[b].add(faceNormal);
        out[c].add(faceNormal);
      }
    }

    for (let i = 0; i < out.length; i++) {
      if (out[i].lengthSq() > 0) out[i].normalize();
    }

    return out;
  }

  _buildCamera(camData) {
    // PTA hardcodes aspect = 2.0 in setFrustum(), regardless of viewport.
    const aspect = PTA_ASPECT;
    // PTA stores horizontal FOV in degrees. The engine converts to vertical via:
    //   gluPerspective(fov / ASPECT, ASPECT, 1.0, zFar)
    // where ASPECT is hardcoded to 2.0 (≈800/420 viewport).
    // Three.js PerspectiveCamera expects vertical FOV in degrees.
    const hfov = camData.fov || 60;
    const vfov = hfov / PTA_ASPECT;
    const camera = new THREE.PerspectiveCamera(
      vfov,
      aspect,
      camData.near > 0 ? camData.near : 1.0,
      camData.far > 0 ? camData.far : 10000
    );

    // PTA uses originTM.getInvTransform() as the view matrix.
    // For cameras WITH rotation keys, the orientation is baked in by 3DS Max.
    // For target cameras WITHOUT rotation keys, we compute lookAt from camera
    // to target, using the initial up vector to preserve roll.
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    camData.originMatrix.decompose(pos, quat, scale);
    camera.position.copy(pos);

    const hasRotKeys = camData.rotKeys && camData.rotKeys.length > 0;
    if (hasRotKeys) {
      // Rotation baked into animation keys — use directly (preserves roll)
      camera.quaternion.copy(quat);
    } else if (camData.type === 2 && camData.targetMatrix) {
      // Target camera without rotation keys — compute lookAt with initial up vector
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
      camera.up.copy(up);
      const targetPos = new THREE.Vector3();
      camData.targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      camera.lookAt(targetPos);
    } else {
      // Free camera without rotation keys — use initial orientation
      camera.quaternion.copy(quat);
    }

    camera.name = camData.name;
    return camera;
  }

  _updateCamera(camera, camData, t) {
    // PTA uses originTM.getInvTransform() as the view matrix.
    // Get the camera's full animated transformation matrix.
    const matrix = getTransformMatrix(t, camData, camData.originMatrix);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(pos, quat, scale);
    camera.position.copy(pos);

    const hasRotKeys = camData.rotKeys && camData.rotKeys.length > 0;
    if (hasRotKeys) {
      // Rotation keys exist — use the animated rotation directly.
      // This preserves roll and handles cameras with baked lookAt rotation.
      camera.quaternion.copy(quat);
    } else if (camData.type === 2) {
      // Target camera without rotation keys — compute lookAt from camera to target.
      // Use the initial up vector from originMatrix to preserve roll.
      let targetPos;
      if (camData.targetPosKeys && camData.targetPosKeys.length > 0) {
        const targetMatrix = getTransformMatrix(t, {
          posKeys: camData.targetPosKeys,
          sclKeys: camData.targetSclKeys,
          rotKeys: camData.targetRotKeys,
        }, camData.targetMatrix);
        targetPos = new THREE.Vector3();
        targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      } else if (camData.targetMatrix) {
        targetPos = new THREE.Vector3();
        camData.targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      }
      if (targetPos) {
        // Extract up vector from initial camera orientation (preserves roll)
        const initQuat = new THREE.Quaternion();
        camData.originMatrix.decompose(new THREE.Vector3(), initQuat, new THREE.Vector3());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(initQuat);
        camera.up.copy(up);
        camera.lookAt(targetPos);
      } else {
        camera.quaternion.copy(quat);
      }
    } else {
      // Free camera without rotation keys — use initial orientation
      camera.quaternion.copy(quat);
    }

    // Update camera settings (PTA stores horizontal FOV → convert to vertical)
    if (camData.settingsKeys && camData.settingsKeys.length > 0) {
      const settings = interpolateCameraSettings(camData.settingsKeys, t, {
        near: camData.near, far: camData.far, fov: camData.fov,
      });
      camera.near = settings.near > 0 ? settings.near : 1.0;
      camera.far = settings.far > 0 ? settings.far : 10000;
      camera.fov = (settings.fov || 60) / PTA_ASPECT;
      camera.updateProjectionMatrix();
    }
  }

  _buildLight(lightData) {
    let light;
    const color = new THREE.Color(lightData.color.r, lightData.color.g, lightData.color.b);

    // PTA's activateLight() sends light->color directly to glLightfv(GL_DIFFUSE)
    // WITHOUT multiplying by the intensity/multiplier field. Use intensity=1 and
    // let the color carry the full value (matching PTA's OpenGL behavior).
    const intensity = 1.0;

    switch (lightData.type) {
      case 1: // Omni
        // PTA falloff is not a Three.js distance — use 0 (infinite range) with no decay
        // to match PTA's default OpenGL lighting behavior
        light = new THREE.PointLight(color, intensity, 0, 0);
        break;
      case 2: // Spot
        light = new THREE.SpotLight(color, intensity);
        break;
      case 3: // Directional
        light = new THREE.DirectionalLight(color, intensity);
        break;
      default:
        light = new THREE.PointLight(color, intensity);
    }

    // Set position from matrix
    const pos = new THREE.Vector3();
    lightData.originMatrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
    light.position.copy(pos);

    // For spot lights, set target
    if (lightData.type === 2 && lightData.targetMatrix) {
      const targetPos = new THREE.Vector3();
      lightData.targetMatrix.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
      light.target.position.copy(targetPos);
    }

    light.name = lightData.name;
    return light;
  }

  _buildDefaultLight(index = 0) {
    // Matches pta3DLight default constructor in the legacy engine.
    const light = new THREE.PointLight(new THREE.Color(1, 1, 1), 1.0, 0, 0);
    light.position.set(0, 100, 0);
    light.name = `__pta_default_light_${index}`;
    return light;
  }

  _updateLight(light, lightData, t) {
    if (lightData.posKeys && lightData.posKeys.length > 0) {
      const pos = interpolatePosition(lightData.posKeys, t);
      light.position.copy(pos);
    }

    // Animate light color from settingsKeys (color + intensity + falloff per keyframe)
    if (lightData.settingsKeys && lightData.settingsKeys.length > 0) {
      const keys = lightData.settingsKeys;
      let c;
      if (keys.length === 1 || t <= keys[0].t) {
        c = keys[0].color;
      } else if (t >= keys[keys.length - 1].t) {
        c = keys[keys.length - 1].color;
      } else {
        const msPerTick = keys[1].t - keys[0].t;
        let idx = msPerTick > 0 ? Math.floor((t - keys[0].t) / msPerTick) : 0;
        idx = Math.max(0, Math.min(idx, keys.length - 2));
        const k0 = keys[idx];
        const k1 = keys[idx + 1];
        const ct = msPerTick > 0 ? Math.max(0, Math.min(1, (t - k0.t) / msPerTick)) : 0;
        c = {
          r: k0.color.r + (k1.color.r - k0.color.r) * ct,
          g: k0.color.g + (k1.color.g - k0.color.g) * ct,
          b: k0.color.b + (k1.color.b - k0.color.b) * ct,
        };
      }
      light.color.setRGB(c.r, c.g, c.b);
    }
  }
}

/**
 * A managed scene instance.
 */
class ManagedScene {
  constructor(ptaScene) {
    this.ptaScene = ptaScene;
    this.threeScene = new THREE.Scene();
    this.meshes = new Map();
    this.cameras = new Map();
    this.lights = new Map();
    this.bgColor = null;
    this.animStartTime = ptaScene.animStartTime;
    this.animEndTime = ptaScene.animEndTime;
  }
}
