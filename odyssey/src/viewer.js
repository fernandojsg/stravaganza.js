import * as THREE from 'three';
import { Renderer } from './engine/Renderer.js';
import { AssetManager } from './engine/AssetManager.js';
import { SceneManager } from './engine/SceneManager.js';
import { getTransformMatrix } from './engine/AnimationSystem.js';

// ─── Scene Registry ─────────────────────────────────────────────────────────
const SCENES = [
  { path: 'data/3dscenes/city/city01.pta', textureDir: 'data/textures/3dscenes/city', label: 'city/city01' },
  { path: 'data/3dscenes/city/city02.pta', textureDir: 'data/textures/3dscenes/city', label: 'city/city02' },
  { path: 'data/3dscenes/city/sala.pta',   textureDir: 'data/textures/3dscenes/city', label: 'city/sala' },
  { path: 'data/3dscenes/compos1/bola.pta', textureDir: 'data/textures/3dscenes/compos1', label: 'compos1/bola' },
  { path: 'data/3dscenes/compos1/lens01.pta', textureDir: 'data/textures/3dscenes/compos1', label: 'compos1/lens01' },
  { path: 'data/3dscenes/compos1/lens02.pta', textureDir: 'data/textures/3dscenes/compos1', label: 'compos1/lens02' },
  { path: 'data/3dscenes/credits/credits.pta', textureDir: 'data/textures/credits', label: 'credits/credits' },
];

// ─── Texture Directory Registry ──────────────────────────────────────────────
const TEXTURE_DIRS = {
  '3dscenes/city': [
    'aracnido.jpg','aracnidopata.jpg','autopista.jpg','autopista2.jpg','barril.jpg',
    'bloques-interior.jpg','bot.jpg','bot02.jpg','cajas.jpg','carretera.jpg',
    'entorno-a.jpg','entorno-b.jpg','fire.jpg','focos.jpg','ind.jpg','metal.jpg',
    'pared-interior1.jpg','paredsala.jpg','particlefire.jpg','particlefirebig.jpg',
    'persiana.jpg','persianassala.jpg','pipe1.jpg','puertapeq.jpg','Rays1.jpg',
    'rejilla.png','rejillas.jpg','sky.jpg','smoke.jpg','spaceshp1.jpg','spaceshp2.jpg',
    'suelo.jpg','suelosala.jpg','tejado.jpg','tuborayo.jpg','turbina.jpg','ventanas.jpg',
  ],
  '3dscenes/compos1': ['BouncingObjColumnLens.png'],
  '3dscenes/lensflares': [
    'circle1.jpg','circle2.jpg','pentagon1.jpg','point1.jpg','point2.jpg','point3.jpg',
    'rays2_512.jpg','rays2.jpg','rays3_512.jpg','rays3.jpg','rays4_512.jpg','rays4.jpg',
    'ring1.jpg','ring2.jpg',
  ],
  'backgrounds': [
    'BouncingObjBackground.png','BouncingObjColumn.png','BouncingObjColumnBgText.png',
    'BouncingObjColumnClaim01.png','BouncingObjColumnLens.png','BouncingObjColumnThickLine.png',
    'BouncingObjWBlur.jpg','Elguitar1.png','Elguitar2.png','ElguitarInfBar.png',
    'ElGuitarSpiral.jpg','ElguitarSupBar.png','greetsalphalayer.png',
    'SplineColumn.png','SplineColumnArcs.png','SplineColumnIcons.png',
    'SplineColumnPolar.png','SplineColumnText.png',
  ],
  'compos1': ['psycho1.jpg','psycho2.jpg','punksphere.jpg'],
  'credits': ['code.png','gfx.png','logo.png','music.png','stravaganza.png','title.jpg'],
  'greets': [
    'futile.png','greet01.png','greet02.png','greet03.png','greet04.png','greet05.png',
    'greet06.png','greet07.png','greet08.png','greet09.png','greet10.png','greet11.png',
    'greet12.png','greetings.png','odyssey.png','respect01.png','respect02.png',
    'respect03.png','respect04.png','respect05.png','respect06.png','respect07.png',
    'respects.png','stravaganza2001.png','surrender.png',
  ],
  'lensflare': [
    'circle1.jpg','circle2.jpg','pentagon1.jpg','point1.jpg','point2.jpg','point3.jpg',
    'rays2_512.jpg','rays2.jpg','rays3_512.jpg','rays3.jpg','rays4_512.jpg','rays4.jpg',
    'ring1.jpg','ring2.jpg',
  ],
  'loading': ['loadbar.jpg','loading.jpg'],
  'lyrics': [
    'es.jpg','esta.jpg','frase.png','interior.jpg','is.png','no.png',
    'remorse.png','stravaganza.jpg','there.png','title.jpg','una.jpg',
  ],
  'particles': [
    'fire.jpg','glowblack.png','gloworange.jpg','glowwhite.jpg',
    'particlefire.jpg','particlefirebig.jpg','smoke.jpg',
  ],
  'splines': [
    'circuitry.jpg','circuitry.spl','ithaqua.jpg','ithaqua.spl',
    'stravaganza.spl','tekno.jpg','tekno.spl','wonder.jpg','wonder.spl',
  ],
  'viewports': ['ViewportQuad.png'],
};

// ─── Simple Orbit Controls ───────────────────────────────────────────────────
class SimpleOrbitControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.spherical = new THREE.Spherical(10, Math.PI / 3, 0);
    this.panOffset = new THREE.Vector3();
    this.onChange = null; // callback invoked after camera updates

    this._rotateStart = new THREE.Vector2();
    this._panStart = new THREE.Vector2();
    this._pointerDownPos = new THREE.Vector2();
    this._isRotating = false;
    this._isPanning = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    domElement.addEventListener('pointerdown', this._onPointerDown);
    domElement.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('pointerup', this._onPointerUp);
    domElement.addEventListener('pointerleave', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  fitToBox(box) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    this.target.copy(center);
    this.spherical.radius = maxDim * 1.5 || 10;
    this.spherical.phi = Math.PI / 3;
    this.spherical.theta = Math.PI / 4;
    this.update();
  }

  update() {
    this.spherical.makeSafe();
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    if (this.onChange) this.onChange();
  }

  _onPointerDown(e) {
    this._pointerDownPos.set(e.clientX, e.clientY);
    if (e.button === 0) {
      this._isRotating = true;
      this._rotateStart.set(e.clientX, e.clientY);
      this.domElement.setPointerCapture(e.pointerId);
    } else if (e.button === 2) {
      this._isPanning = true;
      this._panStart.set(e.clientX, e.clientY);
      this.domElement.setPointerCapture(e.pointerId);
    }
  }

  _onPointerMove(e) {
    if (this._isRotating) {
      const dx = e.clientX - this._rotateStart.x;
      const dy = e.clientY - this._rotateStart.y;
      this.spherical.theta -= dx * 0.005;
      this.spherical.phi -= dy * 0.005;
      this.spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.spherical.phi));
      this._rotateStart.set(e.clientX, e.clientY);
      this.update();
    }
    if (this._isPanning) {
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      const panSpeed = this.spherical.radius * 0.002;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      right.setFromMatrixColumn(this.camera.matrix, 0);
      up.setFromMatrixColumn(this.camera.matrix, 1);
      this.target.addScaledVector(right, -dx * panSpeed);
      this.target.addScaledVector(up, dy * panSpeed);
      this._panStart.set(e.clientX, e.clientY);
      this.update();
    }
  }

  _onPointerUp(e) {
    if ((this._isRotating || this._isPanning) && e.type === 'pointerup') {
      const dx = e.clientX - this._pointerDownPos.x;
      const dy = e.clientY - this._pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 3) {
        this.domElement.dispatchEvent(new CustomEvent('select-click', {
          detail: { clientX: this._pointerDownPos.x, clientY: this._pointerDownPos.y }
        }));
      }
    }
    this._isRotating = false;
    this._isPanning = false;
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    this.spherical.radius *= factor;
    this.spherical.radius = Math.max(0.1, Math.min(10000, this.spherical.radius));
    this.update();
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('pointerleave', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
  }
}

// ─── Viewer Application ──────────────────────────────────────────────────────
class PtaViewer {
  constructor() {
    // Engine
    this.renderer = null;
    this.assetManager = null;
    this.sceneManager = null;

    // State
    this.currentSceneId = null;
    this.currentPtaScene = null;
    this.orbitCamera = null;
    this.orbitControls = null;
    this.isPlaying = false;

    // Selection
    this.selectedObjectName = null;
    this._boxHelper = null;
    this._axesOverlayScene = null;
    this._transformOverride = null; // { mesh, deltaQuat, deltaPos } — transform delta applied after renderScene
    this.looping = true;
    this.animTime = 0;
    this.animStart = 0;
    this.animEnd = 0;
    this.playSpeed = 1;
    this.lastFrameTime = 0;
    this.animFrameId = null;

    // DOM
    this.viewport = document.getElementById('viewport');
    this.sceneSelect = document.getElementById('scene-select');
    this.cameraSelect = document.getElementById('camera-select');
    this.playBtn = document.getElementById('play-btn');
    this.timeline = document.getElementById('timeline');
    this.timeDisplay = document.getElementById('time-display');
    this.speedSelect = document.getElementById('speed-select');
    this.loopBtn = document.getElementById('loop-btn');
    this.statusEl = document.getElementById('status');
    this.scenesList = document.getElementById('scenes-list');
    this.texturesList = document.getElementById('textures-list');
    this.infoPanels = document.getElementById('info-panels');
    this.noSceneMsg = document.getElementById('no-scene-msg');
    this.texturePreview = document.getElementById('texture-preview');
    this.previewImg = document.getElementById('preview-img');
    this.previewInfo = document.getElementById('preview-info');
    this.closePreviewBtn = document.getElementById('close-preview');
  }

  init() {
    this._initEngine();
    this._buildLeftPanel();
    this._bindEvents();
    this._resizeCanvas();
    this._renderLoop();
    this._setStatus('Ready. Select a scene from the left panel.');
    this.loopBtn.classList.add('active');
  }

  _initEngine() {
    // Create renderer inside viewport container
    const container = document.createElement('div');
    container.id = 'canvas-container';
    this.viewport.insertBefore(container, this.texturePreview);

    this.renderer = new Renderer(container, 800, 600);
    this.assetManager = new AssetManager(this.renderer);
    this.sceneManager = new SceneManager(this.renderer);
    this.sceneManager.setFixedFrustumAspect(1.3333);
    this.sceneManager.setPtaColorConstantsAreSRGB(false);

    // Orbit camera
    this.orbitCamera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 50000);
    this.orbitControls = new SimpleOrbitControls(this.orbitCamera, this.renderer.webglRenderer.domElement);
    this.orbitControls.onChange = () => this._renderCurrentScene();
    this.orbitControls.update();
  }

  _resizeCanvas() {
    const rect = this.viewport.getBoundingClientRect();
    const aspect = 800 / 600;
    let w, h;
    if (rect.width / rect.height > aspect) {
      h = rect.height;
      w = h * aspect;
    } else {
      w = rect.width;
      h = w / aspect;
    }
    const canvas = this.renderer.webglRenderer.domElement;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  // ─── Left Panel ────────────────────────────────────────────────────────────

  _buildLeftPanel() {
    // Scenes
    for (const scene of SCENES) {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.textContent = scene.label;
      item.addEventListener('click', () => this._loadScene(scene));
      this.scenesList.appendChild(item);
    }

    // Scene select dropdown
    for (const scene of SCENES) {
      const opt = document.createElement('option');
      opt.value = scene.path;
      opt.textContent = scene.label;
      this.sceneSelect.appendChild(opt);
    }

    // Textures
    for (const [dir, files] of Object.entries(TEXTURE_DIRS)) {
      const dirHeader = document.createElement('div');
      dirHeader.className = 'dir-header';
      dirHeader.innerHTML = `<span class="arrow">&#9660;</span> ${dir}/`;
      dirHeader.addEventListener('click', () => {
        dirHeader.classList.toggle('collapsed');
      });
      // Start collapsed
      dirHeader.classList.add('collapsed');

      const dirContents = document.createElement('div');
      dirContents.className = 'dir-contents';

      for (const file of files) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.textContent = file;
        const fullPath = `data/textures/${dir}/${file}`;
        item.addEventListener('click', () => this._showTexturePreview(fullPath, file));
        dirContents.appendChild(item);
      }

      this.texturesList.appendChild(dirHeader);
      this.texturesList.appendChild(dirContents);
    }

    // Collapsible section headers
    for (const header of document.querySelectorAll('.panel-section-header')) {
      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
      });
    }
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    this.sceneSelect.addEventListener('change', () => {
      const path = this.sceneSelect.value;
      if (!path) return;
      const scene = SCENES.find(s => s.path === path);
      if (scene) this._loadScene(scene);
    });

    this.cameraSelect.addEventListener('change', () => this._renderCurrentScene());

    this.playBtn.addEventListener('click', () => this._togglePlay());

    this.timeline.addEventListener('input', () => {
      const frac = this.timeline.value / 1000;
      this.animTime = this.animStart + frac * (this.animEnd - this.animStart);
      this._updateTimeDisplay();
      this._renderCurrentScene();
    });

    this.speedSelect.addEventListener('change', () => {
      this.playSpeed = parseFloat(this.speedSelect.value);
    });

    this.loopBtn.addEventListener('click', () => {
      this.looping = !this.looping;
      this.loopBtn.classList.toggle('active', this.looping);
    });

    this.closePreviewBtn.addEventListener('click', () => {
      this.texturePreview.classList.remove('visible');
    });

    window.addEventListener('resize', () => this._resizeCanvas());

    // Click-to-select via raycasting
    this.renderer.webglRenderer.domElement.addEventListener('select-click', (e) => {
      this._onViewportClick(e.detail);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); this._togglePlay(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this._seek(-1000); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this._seek(1000); }
      if (e.key === 'r' || e.key === 'R') { this._resetCamera(); }
    });
  }

  // ─── Selection ─────────────────────────────────────────────────────────────

  _onViewportClick(detail) {
    if (!this.currentSceneId) return;
    const managed = this.sceneManager.getScene(this.currentSceneId);
    if (!managed) return;

    const canvas = this.renderer.webglRenderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((detail.clientX - rect.left) / rect.width) * 2 - 1,
      -((detail.clientY - rect.top) / rect.height) * 2 + 1
    );

    const selectedCamera = this.cameraSelect.value;
    let camera;
    if (selectedCamera === 'orbit') {
      camera = this.orbitCamera;
    } else {
      const camEntry = managed.cameras.get(selectedCamera);
      camera = camEntry?.camera || this.orbitCamera;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    // Collect all visible meshes
    const meshes = [];
    for (const [, { mesh }] of managed.meshes) {
      if (mesh.visible) meshes.push(mesh);
    }

    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      // Find the name for this mesh
      for (const [name, { mesh }] of managed.meshes) {
        if (mesh === hitMesh) {
          this._selectObject(name);
          return;
        }
      }
    }
    // No hit - deselect
    this._deselectObject();
  }

  _selectObject(name) {
    if (this.selectedObjectName === name) return;
    this._deselectObject();

    const managed = this.sceneManager.getScene(this.currentSceneId);
    if (!managed) return;
    const entry = managed.meshes.get(name);
    if (!entry) return;

    this.selectedObjectName = name;

    // BoxHelper
    this._boxHelper = new THREE.BoxHelper(entry.mesh, 0x5599ff);
    managed.threeScene.add(this._boxHelper);

    // Axes overlay
    this._createAxesOverlay(entry.mesh);

    // Highlight in info panel
    this._highlightInfoPanelObject(name);

    // Show transform info
    this._showTransformPanel(entry.mesh, name);

    this._renderCurrentScene();
  }

  _deselectObject() {
    if (!this.selectedObjectName) return;

    const managed = this.currentSceneId ? this.sceneManager.getScene(this.currentSceneId) : null;

    // Remove BoxHelper
    if (this._boxHelper) {
      if (managed) managed.threeScene.remove(this._boxHelper);
      this._boxHelper.dispose();
      this._boxHelper = null;
    }

    // Remove axes overlay
    this._axesOverlayScene = null;

    // Clear transform override
    this._transformOverride = null;

    // Unhighlight in info panel
    this._highlightInfoPanelObject(null);

    // Remove transform panel
    const existing = this.infoPanels.querySelector('.selection-panel');
    if (existing) existing.remove();

    this.selectedObjectName = null;
    this._renderCurrentScene();
  }

  _createAxesOverlay(mesh) {
    this._axesOverlayScene = new THREE.Scene();

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    mesh.matrixWorld.decompose(pos, quat, scl);

    // Determine axis length from bounding box
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const axisLen = Math.max(size.x, size.y, size.z) * 0.8 || 5;

    const axes = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xff4444 },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x44cc44 },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x4488ff },
    ];

    for (const { dir, color } of axes) {
      const d = dir.clone().applyQuaternion(quat).multiplyScalar(axisLen);
      const points = [
        pos.clone().sub(d.clone().multiplyScalar(0.2)),
        pos.clone().add(d),
      ];
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, linewidth: 2 });
      const line = new THREE.Line(geom, mat);
      line.renderOrder = 999;
      this._axesOverlayScene.add(line);
    }
  }

  _highlightInfoPanelObject(name) {
    const items = this.infoPanels.querySelectorAll('.info-item');
    items.forEach(item => {
      const nameEl = item.querySelector('.name');
      if (!nameEl) return;
      // The name text follows the visibility toggle span
      const toggle = nameEl.querySelector('.visibility-toggle');
      const objName = toggle ? nameEl.textContent.replace(toggle.textContent, '').trim() : nameEl.textContent.trim();
      item.classList.toggle('selected', objName === name);
    });
  }

  _showTransformPanel(mesh, name) {
    // Remove existing
    const existing = this.infoPanels.querySelector('.selection-panel');
    if (existing) existing.remove();

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    mesh.matrixWorld.decompose(pos, quat, scl);
    const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const toDeg = 180 / Math.PI;

    const panel = document.createElement('div');
    panel.className = 'info-section selection-panel';
    panel.innerHTML = `
      <div class="info-section-header"><span class="arrow">&#9660;</span> Selected: ${name}</div>
      <div class="info-section-content">
        <div class="transform-info">
          <div class="tf-row"><span class="tf-label">Pos</span><span class="tf-value" id="sel-pos">(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})</span></div>
          <div class="tf-row"><span class="tf-label">Rot</span><span class="tf-value" id="sel-rot">X: ${(euler.x * toDeg).toFixed(1)}°  Y: ${(euler.y * toDeg).toFixed(1)}°  Z: ${(euler.z * toDeg).toFixed(1)}°</span></div>
          <div class="tf-row"><span class="tf-label">Scale</span><span class="tf-value">(${scl.x.toFixed(2)}, ${scl.y.toFixed(2)}, ${scl.z.toFixed(2)})</span></div>
        </div>
        <div class="transform-sliders">
          <div class="slider-group-label">Translation</div>
          <div class="slider-row"><label class="axis-x">X</label><input type="range" min="-200" max="200" step="0.5" value="${pos.x.toFixed(1)}" data-pos-axis="x"><span class="slider-val" data-pos-val="x">${pos.x.toFixed(1)}</span></div>
          <div class="slider-row"><label class="axis-y">Y</label><input type="range" min="-200" max="200" step="0.5" value="${pos.y.toFixed(1)}" data-pos-axis="y"><span class="slider-val" data-pos-val="y">${pos.y.toFixed(1)}</span></div>
          <div class="slider-row"><label class="axis-z">Z</label><input type="range" min="-200" max="200" step="0.5" value="${pos.z.toFixed(1)}" data-pos-axis="z"><span class="slider-val" data-pos-val="z">${pos.z.toFixed(1)}</span></div>
          <div class="slider-group-label">Rotation</div>
          <div class="slider-row"><label class="axis-x">X</label><input type="range" min="-180" max="180" step="0.5" value="${(euler.x * toDeg).toFixed(1)}" data-rot-axis="x"><span class="slider-val" data-rot-val="x">${(euler.x * toDeg).toFixed(1)}°</span></div>
          <div class="slider-row"><label class="axis-y">Y</label><input type="range" min="-180" max="180" step="0.5" value="${(euler.y * toDeg).toFixed(1)}" data-rot-axis="y"><span class="slider-val" data-rot-val="y">${(euler.y * toDeg).toFixed(1)}°</span></div>
          <div class="slider-row"><label class="axis-z">Z</label><input type="range" min="-180" max="180" step="0.5" value="${(euler.z * toDeg).toFixed(1)}" data-rot-axis="z"><span class="slider-val" data-rot-val="z">${(euler.z * toDeg).toFixed(1)}°</span></div>
        </div>
      </div>
    `;

    // Insert at top of info panels
    this.infoPanels.insertBefore(panel, this.infoPanels.firstChild);

    // Collapsible header
    const header = panel.querySelector('.info-section-header');
    header.addEventListener('click', () => header.classList.toggle('collapsed'));

    const toRad = Math.PI / 180;

    // Store original values for computing deltas
    const origQuat = quat.clone();
    const origPos = pos.clone();

    // Shared handler for both translation and rotation sliders
    const onSliderChange = () => {
      // Read rotation values
      const rxDeg = parseFloat(panel.querySelector('[data-rot-axis="x"]').value);
      const ryDeg = parseFloat(panel.querySelector('[data-rot-axis="y"]').value);
      const rzDeg = parseFloat(panel.querySelector('[data-rot-axis="z"]').value);

      // Update rotation display values
      panel.querySelector('[data-rot-val="x"]').textContent = `${rxDeg.toFixed(1)}°`;
      panel.querySelector('[data-rot-val="y"]').textContent = `${ryDeg.toFixed(1)}°`;
      panel.querySelector('[data-rot-val="z"]').textContent = `${rzDeg.toFixed(1)}°`;

      const rotDisplay = panel.querySelector('#sel-rot');
      if (rotDisplay) {
        rotDisplay.textContent = `X: ${rxDeg.toFixed(1)}°  Y: ${ryDeg.toFixed(1)}°  Z: ${rzDeg.toFixed(1)}°`;
      }

      // Read translation values
      const tx = parseFloat(panel.querySelector('[data-pos-axis="x"]').value);
      const ty = parseFloat(panel.querySelector('[data-pos-axis="y"]').value);
      const tz = parseFloat(panel.querySelector('[data-pos-axis="z"]').value);

      // Update translation display values
      panel.querySelector('[data-pos-val="x"]').textContent = tx.toFixed(1);
      panel.querySelector('[data-pos-val="y"]').textContent = ty.toFixed(1);
      panel.querySelector('[data-pos-val="z"]').textContent = tz.toFixed(1);

      const posDisplay = panel.querySelector('#sel-pos');
      if (posDisplay) {
        posDisplay.textContent = `(${tx.toFixed(2)}, ${ty.toFixed(2)}, ${tz.toFixed(2)})`;
      }

      // Compute delta rotation: newRot * inverse(origRot)
      const newEuler = new THREE.Euler(rxDeg * toRad, ryDeg * toRad, rzDeg * toRad, 'XYZ');
      const newQuat = new THREE.Quaternion().setFromEuler(newEuler);
      const deltaQuat = newQuat.multiply(origQuat.clone().invert());

      // Compute delta translation
      const deltaPos = new THREE.Vector3(tx - origPos.x, ty - origPos.y, tz - origPos.z);

      this._transformOverride = { mesh, deltaQuat, deltaPos };

      this._renderCurrentScene();

      // Update box helper and axes after the override has been applied
      if (this._boxHelper) this._boxHelper.update();
      this._createAxesOverlay(mesh);
    };

    // Attach handler to all sliders
    const allSliders = panel.querySelectorAll('input[type="range"]');
    for (const slider of allSliders) {
      slider.addEventListener('input', onSliderChange);
    }
  }

  // ─── Position Overrides (for investigation) ────────────────────────────────

  /**
   * Apply hardcoded position overrides for specific objects.
   * Used to investigate transform discrepancies between C++ and JS.
   */
  _applyPositionOverrides(managed, sceneEntry) {
    // sala scene: Box01-04 position corrections
    // The .pta file stores identical positions (0, 10, 34.68) for all 4 boxes,
    // but in the C++ demo they appear at different positions.
    if (sceneEntry.label === 'city/sala') {
      const overrides = {
        'Box01': { x: 0, y: -10 },    // Move down in Y
        'Box02': { x: 20, y: 10 },    // Move right in X
        'Box03': { x: 0, y: 30 },     // Move up in Y
        'Box04': { x: -20 },          // Move left in X
      };

      for (const [name, pos] of Object.entries(overrides)) {
        const entry = managed.meshes.get(name);
        if (!entry) continue;

        const e = entry.data.transformMatrix.elements;
        // Update position in the stored transformMatrix
        if (pos.x !== undefined) e[12] = pos.x;
        if (pos.y !== undefined) e[13] = pos.y;
        if (pos.z !== undefined) e[14] = pos.z;

        // Also update the mesh matrix immediately
        entry.mesh.matrix.copy(entry.data.transformMatrix);
        entry.mesh.matrixWorldNeedsUpdate = true;

        console.log(`[Override] ${name}: pos=(${e[12].toFixed(1)}, ${e[13].toFixed(1)}, ${e[14].toFixed(1)})`);
      }
    }
  }

  // ─── Scene Loading ─────────────────────────────────────────────────────────

  async _loadScene(sceneEntry) {
    // Cleanup previous scene
    this._cleanupScene();
    this._setStatus(`Loading ${sceneEntry.label}...`);
    this.texturePreview.classList.remove('visible');

    // Update selection UI
    this.sceneSelect.value = sceneEntry.path;
    for (const item of this.scenesList.querySelectorAll('.file-item')) {
      item.classList.toggle('active', item.textContent === sceneEntry.label);
    }

    try {
      // 1. Load PTA scene
      const ptaScene = await this.assetManager.loadPtaScene(sceneEntry.path);
      this.currentPtaScene = ptaScene;

      // 2. Load textures
      const textures = await this.assetManager.loadSceneTextures(ptaScene, sceneEntry.textureDir);

      // 3. Build Three.js scene
      const sceneId = sceneEntry.path;
      this.currentSceneId = sceneId;
      const managed = this.sceneManager.buildScene(sceneId, ptaScene, textures);

      // 4. Load lens flares and particles
      await this.sceneManager.loadSceneLensFlares(sceneId, (path) => this.assetManager.loadTextureByPath(path));
      await this.sceneManager.loadSceneParticles(sceneId, (path) => this.assetManager.loadTextureByPath(path));

      // 5. Setup animation range
      this.animStart = ptaScene.animStartTime || 0;
      this.animEnd = ptaScene.animEndTime || 0;
      this.animTime = this.animStart;
      const hasAnim = this.animEnd > this.animStart;
      this.timeline.disabled = !hasAnim;
      this.timeline.value = 0;
      this._updateTimeDisplay();

      // 6. Setup cameras
      this._populateCameraDropdown(managed);

      // 7. Fit orbit camera to scene
      this._fitOrbitToScene(managed);

      // 8. Populate info panel
      this._populateInfoPanel(ptaScene, managed);

      // 9. Apply position overrides for investigation
      this._applyPositionOverrides(managed, sceneEntry);

      // 10. Initial render
      this._renderCurrentScene();
      this._setStatus(`Loaded: ${sceneEntry.label}`);

    } catch (err) {
      console.error('Failed to load scene:', err);
      this._setStatus(`Error loading ${sceneEntry.label}: ${err.message}`);
    }
  }

  _cleanupScene() {
    if (!this.currentSceneId) return;
    this._deselectObject();
    this.isPlaying = false;
    this.playBtn.textContent = '\u25B6 Play';

    const managed = this.sceneManager.getScene(this.currentSceneId);
    if (managed) {
      managed.threeScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      for (const psys of managed.particleSystems) {
        psys.dispose();
      }
      this.sceneManager.scenes.delete(this.currentSceneId);
    }
    this.currentSceneId = null;
    this.currentPtaScene = null;
  }

  _fitOrbitToScene(managed) {
    const box = new THREE.Box3();
    for (const [, { mesh }] of managed.meshes) {
      mesh.updateWorldMatrix(true, true);
      const childBox = new THREE.Box3().setFromObject(mesh);
      box.union(childBox);
    }
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
    }
    this.orbitControls.fitToBox(box);
    // Update camera far plane based on scene size
    const size = new THREE.Vector3();
    box.getSize(size);
    this.orbitCamera.far = Math.max(size.length() * 10, 1000);
    this.orbitCamera.near = Math.max(size.length() * 0.001, 0.1);
    this.orbitCamera.updateProjectionMatrix();
  }

  _resetCamera() {
    if (!this.currentSceneId) return;
    const managed = this.sceneManager.getScene(this.currentSceneId);
    if (managed) {
      this._fitOrbitToScene(managed);
      this._renderCurrentScene();
    }
  }

  // ─── Camera Dropdown ───────────────────────────────────────────────────────

  _populateCameraDropdown(managed) {
    this.cameraSelect.innerHTML = '<option value="orbit">Orbit Camera</option>';
    for (const [name] of managed.cameras) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.cameraSelect.appendChild(opt);
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  _renderCurrentScene() {
    if (!this.currentSceneId) return;
    const managed = this.sceneManager.getScene(this.currentSceneId);
    if (!managed) return;

    // Set background color
    this.renderer.resetViewport();
    if (managed.bgColor) {
      this.renderer.clear(managed.bgColor.getHex());
    } else {
      this.renderer.clear(0x222233);
    }

    const selectedCamera = this.cameraSelect.value;
    const cam = selectedCamera === 'orbit' ? this.orbitCamera :
      (managed.cameras.get(selectedCamera)?.camera || this.orbitCamera);

    // Normal render: updates all mesh matrices from animation and renders
    if (selectedCamera === 'orbit') {
      this.sceneManager.renderScene(this.currentSceneId, this.animTime, null, 1, this.orbitCamera);
    } else {
      this.sceneManager.renderScene(this.currentSceneId, this.animTime, selectedCamera);
    }

    // If transform override is active, apply delta rotation and translation
    // to the mesh's computed matrix and re-render (without re-computing matrices).
    if (this._transformOverride) {
      const { mesh, deltaQuat, deltaPos } = this._transformOverride;
      // Apply delta rotation around the mesh's current position
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(mesh.matrix);

      const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(deltaQuat);
      const toOrigin = new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z);
      const toPos = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);

      // result = T(deltaPos) * T(pos) * R * T(-pos) * originalMatrix
      mesh.matrix.premultiply(toOrigin);
      mesh.matrix.premultiply(rotMatrix);
      mesh.matrix.premultiply(toPos);

      // Apply delta translation
      if (deltaPos.x !== 0 || deltaPos.y !== 0 || deltaPos.z !== 0) {
        const deltaTrans = new THREE.Matrix4().makeTranslation(deltaPos.x, deltaPos.y, deltaPos.z);
        mesh.matrix.premultiply(deltaTrans);
      }

      mesh.matrixWorldNeedsUpdate = true;

      // Clear and re-render with sceneTime=-1 to skip matrix updates
      this.renderer.resetViewport();
      if (managed.bgColor) {
        this.renderer.clear(managed.bgColor.getHex());
      } else {
        this.renderer.clear(0x222233);
      }
      this.sceneManager.renderScene(this.currentSceneId, -1, null, 1, cam);
    }

    // Render axes overlay for selected object
    if (this._axesOverlayScene && this.selectedObjectName) {
      this.renderer.webglRenderer.render(this._axesOverlayScene, cam);
    }

    // Update box helper if present
    if (this._boxHelper) this._boxHelper.update();
  }

  _renderLoop() {
    const loop = (timestamp) => {
      this.animFrameId = requestAnimationFrame(loop);

      if (this.isPlaying && this.currentSceneId && this.animEnd > this.animStart) {
        if (this.lastFrameTime === 0) this.lastFrameTime = timestamp;
        const delta = (timestamp - this.lastFrameTime) * this.playSpeed;
        this.lastFrameTime = timestamp;
        this.animTime += delta;

        if (this.animTime >= this.animEnd) {
          if (this.looping) {
            this.animTime = this.animStart;
          } else {
            this.animTime = this.animEnd;
            this.isPlaying = false;
            this.playBtn.textContent = '\u25B6 Play';
          }
        }

        const frac = (this.animTime - this.animStart) / (this.animEnd - this.animStart);
        this.timeline.value = Math.round(frac * 1000);
        this._updateTimeDisplay();
        this._renderCurrentScene();
      }
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  // ─── Playback Controls ────────────────────────────────────────────────────

  _togglePlay() {
    if (!this.currentSceneId || this.animEnd <= this.animStart) return;
    this.isPlaying = !this.isPlaying;
    this.playBtn.textContent = this.isPlaying ? '\u23F8 Pause' : '\u25B6 Play';
    if (this.isPlaying) {
      this.lastFrameTime = 0;
    }
  }

  _seek(deltaMs) {
    if (!this.currentSceneId || this.animEnd <= this.animStart) return;
    this.animTime = Math.max(this.animStart, Math.min(this.animEnd, this.animTime + deltaMs));
    const frac = (this.animTime - this.animStart) / (this.animEnd - this.animStart);
    this.timeline.value = Math.round(frac * 1000);
    this._updateTimeDisplay();
    this._renderCurrentScene();
  }

  _updateTimeDisplay() {
    const current = Math.max(0, this.animTime - this.animStart);
    const total = Math.max(0, this.animEnd - this.animStart);
    this.timeDisplay.textContent = `${this._formatTime(current)} / ${this._formatTime(total)}`;
  }

  _formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  // ─── Texture Preview ──────────────────────────────────────────────────────

  _showTexturePreview(path, filename) {
    this.previewImg.src = path;
    this.previewImg.onload = () => {
      const w = this.previewImg.naturalWidth;
      const h = this.previewImg.naturalHeight;
      this.previewInfo.textContent = `${filename}  |  ${w}×${h}`;
    };
    this.previewInfo.textContent = filename;
    this.texturePreview.classList.add('visible');
  }

  // ─── Info Panel ────────────────────────────────────────────────────────────

  _populateInfoPanel(ptaScene, managed) {
    this.noSceneMsg.style.display = 'none';
    this.infoPanels.innerHTML = '';

    // Header section
    this._addInfoSection('Header', () => {
      const rows = [];
      rows.push(this._infoRow('Objects', ptaScene.objects.length));
      rows.push(this._infoRow('Materials', ptaScene.materials.length));
      rows.push(this._infoRow('Cameras', ptaScene.cameras.length));
      rows.push(this._infoRow('Lights', ptaScene.lights.length));
      rows.push(this._infoRow('Helpers', (ptaScene.helpers || []).length));
      rows.push(this._infoRow('Anim Start', `${ptaScene.animStartTime}ms`));
      rows.push(this._infoRow('Anim End', `${ptaScene.animEndTime}ms`));
      const duration = ptaScene.animEndTime - ptaScene.animStartTime;
      rows.push(this._infoRow('Duration', `${this._formatTime(duration)}`));
      rows.push(this._infoRow('Lens Flares', managed.lensFlares.length));
      rows.push(this._infoRow('Particles', managed.particleSystems.length));
      return rows.join('');
    });

    // Objects section
    const objectsContent = this._addInfoSection(`Objects (${ptaScene.objects.length})`, () => {
      return ptaScene.objects.map(obj => {
        const keys = (obj.posKeys?.length || 0) + (obj.rotKeys?.length || 0) + (obj.sclKeys?.length || 0);
        return `<div class="info-item">
          <div class="name"><span class="visibility-toggle" data-object="${obj.name}" title="Toggle visibility">&#x1F441;</span>${obj.name}</div>
          <div class="detail">verts: ${obj.numVertices} | faces: ${obj.numFaces} | mat: ${obj.materialId}${keys > 0 ? ` | keys: ${keys}` : ''}</div>
        </div>`;
      }).join('');
    });

    // Attach visibility toggle handlers and click-to-select
    objectsContent.querySelectorAll('.visibility-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const objName = toggle.dataset.object;
        const entry = managed.meshes.get(objName);
        if (!entry) return;
        entry.mesh.visible = !entry.mesh.visible;
        toggle.classList.toggle('hidden', !entry.mesh.visible);
        this._renderCurrentScene();
      });
    });

    objectsContent.querySelectorAll('.info-item').forEach(item => {
      item.addEventListener('click', () => {
        const toggle = item.querySelector('.visibility-toggle');
        if (!toggle) return;
        const objName = toggle.dataset.object;
        this._selectObject(objName);
      });
    });

    // Materials section
    this._addInfoSection(`Materials (${ptaScene.materials.length})`, () => {
      return ptaScene.materials.map((mat, i) => {
        const flags = [];
        if (mat.isTwoSided) flags.push('2-sided');
        if (mat.isBumpMap) flags.push('bump');
        if (mat.tex1Spherical) flags.push('sphere1');
        if (mat.tex2Spherical) flags.push('sphere2');

        const diffSwatch = this._colorSwatch(mat.diffuse);
        const ambSwatch = this._colorSwatch(mat.ambient);
        const specSwatch = this._colorSwatch(mat.specular);

        return `<div class="info-item">
          <div class="name">[${i}] ${mat.name}</div>
          <div class="detail">
            diff: ${diffSwatch} amb: ${ambSwatch} spec: ${specSwatch} shin: ${mat.shininess?.toFixed(2) || '0'}
            ${mat.texture1 ? `<br>tex1: ${mat.texture1}` : ''}
            ${mat.texture2 ? `<br>tex2: ${mat.texture2}` : ''}
            ${flags.length ? `<br>flags: ${flags.join(', ')}` : ''}
          </div>
        </div>`;
      }).join('');
    });

    // Cameras section
    this._addInfoSection(`Cameras (${ptaScene.cameras.length})`, () => {
      return ptaScene.cameras.map(cam => {
        const typeStr = cam.type === 1 ? 'Free' : cam.type === 2 ? 'Target' : `Type ${cam.type}`;
        const keys = (cam.posKeys?.length || 0) + (cam.rotKeys?.length || 0) + (cam.settingsKeys?.length || 0);
        return `<div class="info-item">
          <div class="name">${cam.name}</div>
          <div class="detail">${typeStr} | FOV: ${cam.fov?.toFixed(1) || '?'}° | near: ${cam.near?.toFixed(1)} far: ${cam.far?.toFixed(0)}${keys > 0 ? ` | keys: ${keys}` : ''}</div>
        </div>`;
      }).join('');
    });

    // Lights section
    this._addInfoSection(`Lights (${ptaScene.lights.length})`, () => {
      return ptaScene.lights.map(light => {
        const typeStr = light.type === 1 ? 'Omni' : light.type === 2 ? 'Spot' : light.type === 3 ? 'Dir' : `Type ${light.type}`;
        const swatch = this._colorSwatch(light.color);
        return `<div class="info-item">
          <div class="name">${light.name}</div>
          <div class="detail">${typeStr} | color: ${swatch}</div>
        </div>`;
      }).join('');
    });

    // Helpers section
    if (ptaScene.helpers && ptaScene.helpers.length > 0) {
      this._addInfoSection(`Helpers (${ptaScene.helpers.length})`, () => {
        return ptaScene.helpers.map(helper => {
          const pos = new THREE.Vector3();
          helper.transformMatrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
          return `<div class="info-item">
            <div class="name">${helper.name}</div>
            <div class="detail">pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})
              ${helper.userProps ? `<br>${helper.userProps.substring(0, 80)}${helper.userProps.length > 80 ? '...' : ''}` : ''}</div>
          </div>`;
        }).join('');
      });
    }
  }

  _addInfoSection(title, contentFn) {
    const section = document.createElement('div');
    section.className = 'info-section';

    const header = document.createElement('div');
    header.className = 'info-section-header';
    header.innerHTML = `<span class="arrow">&#9660;</span> ${title}`;
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
    });

    const content = document.createElement('div');
    content.className = 'info-section-content';
    content.innerHTML = contentFn();

    section.appendChild(header);
    section.appendChild(content);
    this.infoPanels.appendChild(section);
    return content;
  }

  _infoRow(label, value) {
    return `<div class="info-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  }

  _colorSwatch(c) {
    if (!c) return '';
    const r = Math.round(Math.min(1, c.r) * 255);
    const g = Math.round(Math.min(1, c.g) * 255);
    const b = Math.round(Math.min(1, c.b) * 255);
    return `<span class="color-swatch" style="background:rgb(${r},${g},${b})" title="(${c.r?.toFixed(2)}, ${c.g?.toFixed(2)}, ${c.b?.toFixed(2)})"></span>`;
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  _setStatus(msg) {
    this.statusEl.textContent = msg;
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
const viewer = new PtaViewer();
window._viewer = viewer;
viewer.init();
