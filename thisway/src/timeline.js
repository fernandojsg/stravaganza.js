/**
 * timeline.js — Port of FXManagement.cpp
 *
 * Registers all ~60 effect instances with exact ms timing and priority,
 * matching the original Stravaganza demo.
 */

import { FXTelevision } from './effects/FXTelevision.js';
import { FXFadedImage } from './effects/FXFadedImage.js';
import { FXPulsatingImage, FXPulsatingImageGlow1, FXPulsatingImageTest, FXPulsatingThisWay } from './effects/FXPulsatingImage.js';
import { FXEuskalArrows } from './effects/FXEuskalArrows.js';
import { FXImageStencilTransition } from './effects/FXImageStencilTransition.js';
import { FXEuskal10ParticleSteam } from './effects/FXEuskal10ParticleSteam.js';
import { FXEP10ParticledSpheres } from './effects/FXEP10ParticledSpheres.js';
import { FXBackgroundDistortion } from './effects/FXBackgroundDistortion.js';
import { FXRadialBlurInOut } from './effects/FXRadialBlur.js';
import { FXStencilTransitionScaleOut, FXStencilTransitionExplosionOut, FXTransitionCapture } from './effects/FXStencilTransition.js';
import { FXBonedSpike } from './effects/FXBonedSpike.js';
import { FXGlow2 } from './effects/FXGlow2.js';
import { FX3DObjectMamut } from './effects/FX3DObjectMamut.js';
import { FX3DObjectBump } from './effects/FX3DObjectBump.js';
import { FXInfiniteScroll } from './effects/FXInfiniteScroll.js';
import { FXBackground1 } from './effects/FXBackground1.js';
import { FXRadialBlur } from './effects/FXRadialBlur.js';
import { FXEuskal10Greets } from './effects/FXEuskal10Greets.js';
import { FXEuskal10Credits } from './effects/FXEuskal10Credits.js';
import { FXEuskal10Circles } from './effects/FXEuskal10Circles.js';
import { FXRadialBlurCircles } from './effects/FXRadialBlur.js';
import { FXEuskal10GreetsScene } from './effects/FXEuskal10GreetsScene.js';
import { FXHairyObject } from './effects/FXHairyObject.js';
import { FXMapScreenToObject } from './effects/FXMapScreenToObject.js';
import { FXViewportInt } from './effects/FXViewportInt.js';

// Credit character textures
const ithaquaTextures = ['i.tga', 't.tga', 'h.tga', 'a.tga', 'q.tga', 'u.tga', 'a.tga'];
const teknoTextures   = ['t.tga', 'e.tga', 'k.tga', 'n.tga', 'o.tga'];
const wonderTextures  = ['w.tga', 'o.tga', 'n.tga', 'd.tga', 'e.tga', 'r.tga'];
const sgzTextures     = ['s.tga', 't.tga', 'r.tga', 'a.tga', 'v.tga', 'a.tga', 'g.tga', 'a.tga', 'n.tga', 'z.tga', 'a.tga'];

/**
 * Register all manual effects with the demo manager.
 * @param {import('./engine/DemoManager.js').DemoManager} dm
 */
export function registerAllEffects(dm) {
  // ---- Allocate effects ----

  const viewportInt1 = new FXViewportInt();
  viewportInt1.setup(0, 0, 512, 512);

  const televisionStart1 = new FXTelevision(); televisionStart1.setup();
  const televisionStart2 = new FXTelevision(); televisionStart2.setup();
  const televisionStart3 = new FXTelevision(); televisionStart3.setup();
  const televisionStart4 = new FXTelevision(); televisionStart4.setup();

  const arrows1 = new FXEuskalArrows();
  arrows1.setup('data/3Dscenes/arrows1/scene.PTA', 'data/textures/arrows', 'Camera02', 0.0, 0.2, 0, 1.0);
  const arrows2 = new FXEuskalArrows();
  arrows2.setup('data/3Dscenes/arrows1/scene.PTA', 'data/textures/arrows', 'Camera03', 0.0, 0.2, 0, 1.0);
  const arrows3 = new FXEuskalArrows();
  arrows3.setup('data/3Dscenes/arrows1/scene.PTA', 'data/textures/arrows', 'Camera01', 0.0, 0.2, 0, 1.0);
  const arrowsTransition = new FXImageStencilTransition();
  arrowsTransition.setup(2000.0, 'data/textures/arrows/transition.tga');
  const arrowsTransitionCapture = new FXTransitionCapture(arrowsTransition);

  // Particle steam (spheres section)
  const steamColor = { r: 0.1137, g: 0.1764, b: 0.2196 };
  const particleSteamSph = [];
  for (let i = 0; i < 6; i++) {
    const ps = new FXEuskal10ParticleSteam();
    ps.setup(700, 1.0, 2.0, -200.0, 200.0, 0.008, 0.015, 200.0, 'data/textures/Particles/glowwhite.tga', true, steamColor);
    particleSteamSph.push(ps);
  }

  // Particled spheres
  const sphereCameras = ['Camera01', 'Camera03', 'Camera02', 'Camera04', 'Camera06', 'Camera05'];
  const sphereSceneTimes = [1200, 1000, 1100, 1200, 1900, 1820];
  // Crossfade: 1000ms overlap between consecutive sphere scenes.
  // During overlap, the incoming sphere renders to an offscreen RT then composites
  // over the outgoing sphere with increasing alpha → true crossfade.
  // Sphere 1: no fade-in (arrows transition reveals it)
  // Spheres 2-6: 1000ms fade-in from previous sphere
  const sphereFadeIn = [0, 1000, 1000, 1000, 1000, 1000];
  const particledSpheres = sphereCameras.map((cam, i) => {
    const ps = new FXEP10ParticledSpheres();
    ps.setup('data/3Dscenes/particledspheres/scene.pta', 'data/textures/particledspheres/part.tga', 'data/textures/particledspheres', cam, sphereSceneTimes[i], 0.2);
    if (sphereFadeIn[i] > 0) ps.setFade(sphereFadeIn[i]);
    return ps;
  });

  const bgDistortionBalls = new FXBackgroundDistortion();
  bgDistortionBalls.setup(40, 40, 4300.0, steamColor);

  const radialBlurBalls = new FXRadialBlurInOut();
  radialBlurBalls.setup(512, 512, 1800.0, 1.05, 1.05, 0.00, 0.70);

  const transitionPreSpike = new FXStencilTransitionScaleOut();
  transitionPreSpike.setup(20, 10, 600.0);
  const transitionPreSpikeCapture = new FXTransitionCapture(transitionPreSpike);

  const bgLayer1Spike = new FXFadedImage();
  bgLayer1Spike.setup([0.5, 0.5, 0.0], [0.5, 0.5, 0.5], [1.28, 1.219, 0.0], [1.28, 1.219, 0.0], 0.0, 0.0, 1000.0, 12900.0, 1000.0, 'data/textures/spike/background.jpg', 1.0, 1.0);

  const spike = new FXBonedSpike();
  spike.setup(0, 0, 0, 0, 0, 0, 4.0, 'data/3Dscenes/spike/spike.pta', 'data/textures/spike');

  const pulsatingImg1 = new FXPulsatingImageTest();
  pulsatingImg1.setup(0.5, 0.5, 1.28, 1.21, 0.0, 1.0, 'data/textures/spike/flash.tga');

  // Glow letters: T-H-I-S-W-A-Y-Arrow
  const glowParams = [
    { x: 0.20, y: 0.5, tex: 'tglow' },
    { x: 0.30, y: 0.5, tex: 'hglow' },
    { x: 0.38, y: 0.5, tex: 'iglow' },
    { x: 0.45, y: 0.5, tex: 'sglow' },
    { x: 0.62, y: 0.5, tex: 'wglow' },
    { x: 0.73, y: 0.5, tex: 'aglow' },
    { x: 0.81, y: 0.5, tex: 'yglow' },
    { x: 0.50, y: 0.7, tex: 'flechaglow' },
  ];
  const glows = glowParams.map(p => {
    const g = new FXGlow2();
    g.setup(p.x, p.y, 0.15, 0.2, 0.89, 3.0, 3.0, 3000.0, true,
      `data/textures/thisway/${p.tex}.tga`,
      `data/textures/thisway/${p.tex}.tga`,
      'data/textures/glow/opacity.tga');
    return g;
  });

  const transitionExpl = new FXStencilTransitionExplosionOut();
  transitionExpl.setup(20, 20, 500.0);
  const transitionExplCapture = new FXTransitionCapture(transitionExpl);

  const mamutBackground = new FXFadedImage();
  mamutBackground.setup([0.5, 0.5, 0.0], [0.5, 0.5, 0.5], [1.28, 1.219, 0.0], [1.28, 1.219, 0.0], 0.0, 0.0, 0, 14000.0, 0, 'data/textures/Mamut/background.jpg', 1.0, 1.0);
  const mamut = new FX3DObjectMamut();
  mamut.setup('mamut', 'Camera01', 'data/3Dscenes/mamut/mamut.PTA', 'data/textures/Mamut');

  const bumpBackground = new FXFadedImage();
  bumpBackground.setup([0.5, 0.5, 0.0], [0.5, 0.5, 0.5], [1.28, 1.219, 0.0], [1.28, 1.219, 0.0], 0.0, 0.0, 1000.0, 12900.0, 1000.0, 'data/textures/bump/background.jpg', 1.0, 1.0);
  const bumpScroll = new FXInfiniteScroll();
  bumpScroll.setup([0.5, 0.5, 0.5], [1.0, 1.0, 1.0], [1.0, -1.0, 0.0], [0.0, 0.0, 0.0], 0.2, 0.8, 'data/textures/bump/grid.tga', false);
  const bump = new FX3DObjectBump();
  bump.setup('bump', 'Camera01', 'data/3Dscenes/bump/scene.pta', 'data/textures/bump');

  const classicBG1 = new FXBackground1(); classicBG1.setup(22, 0.7, 0.7, 'data/textures/classical/bg1.tga');
  const classicBG2 = new FXBackground1(); classicBG2.setup(22, 0.7, 0.7, 'data/textures/classical/bg2.tga');
  const classicBG3 = new FXBackground1(); classicBG3.setup(22, 0.7, 0.7, 'data/textures/classical/bg3.tga');

  const thisWayImgJapo1 = new FXFadedImage();
  thisWayImgJapo1.setup([0.5, 0.5, 0.1], [0.5, 0.5, 0.1], [0.6, 0.2, 0.1], [0.6, 0.2, 0.1], 0.0, 0.0, 150.0, 100.0, 150.0, 'data/textures/japo/thisway.tga', 1.0, 1.0);
  const thisWayImgJapo2 = new FXFadedImage();
  thisWayImgJapo2.setup([0.5, 0.5, 0.1], [0.5, 0.5, 0.1], [0.6, 0.2, 0.1], [0.6, 0.2, 0.1], 0.0, 0.0, 150.0, 100.0, 150.0, 'data/textures/japo/thisway.tga', 1.0, 1.0);

  const radialBlurLyrics = new FXRadialBlur();
  radialBlurLyrics.setup(512, 512, 14100.0, 1.02, 1.02, 0.88, 0.88);

  // Lyrics (12 faded images)
  const lyricSetups = [
    { pos1: [0.6, 0.6, 0.1], pos2: [0.5, 0.7, 0.1], size1: [0.3, 0.1, 0.1], size2: [0.3, 0.1, 0.1], tex: '1' },
    { pos1: [0.7, 0.4, 0.1], pos2: [0.6, 0.5, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '2' },
    { pos1: [0.4, 0.5, 0.1], pos2: [0.7, 0.6, 0.1], size1: [0.3, 0.1, 0.1], size2: [0.3, 0.1, 0.1], tex: '3' },
    { pos1: [0.5, 0.6, 0.1], pos2: [0.5, 0.4, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '4' },
    { pos1: [0.4, 0.7, 0.1], pos2: [0.4, 0.6, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '5' },
    { pos1: [0.6, 0.4, 0.1], pos2: [0.5, 0.6, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '6' },
    { pos1: [0.7, 0.6, 0.1], pos2: [0.4, 0.5, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '7' },
    { pos1: [0.8, 0.5, 0.1], pos2: [0.5, 0.7, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '8' },
    { pos1: [0.7, 0.7, 0.1], pos2: [0.7, 0.4, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '9' },
    { pos1: [0.5, 0.4, 0.1], pos2: [0.4, 0.7, 0.1], size1: [0.3, 0.1, 0.1], size2: [0.3, 0.1, 0.1], tex: '10' },
    { pos1: [0.6, 0.5, 0.1], pos2: [0.4, 0.4, 0.1], size1: [0.6, 0.1, 0.1], size2: [0.6, 0.1, 0.1], tex: '11' },
    { pos1: [0.5, 0.5, 0.1], pos2: [0.5, 0.5, 0.1], size1: [0.3, 0.1, 0.1], size2: [0.3, 0.1, 0.1], tex: '12' },
  ];
  const lyrics = lyricSetups.map(s => {
    const fx = new FXFadedImage();
    fx.setup(s.pos1, s.pos2, s.size1, s.size2, 0.0, 0.0, 800.0, 1400.0, 800.0, `data/textures/lyrics/${s.tex}.tga`, 1.0, 1.0);
    return fx;
  });

  const pulsatingThisWay = new FXPulsatingThisWay();
  pulsatingThisWay.setup(0.5, 0.5, 0.6, 0.2, 0.0, 1.0, 'data/textures/japo/thisway.tga');

  // Credits section labels
  const code = new FXEuskal10Greets();
  code.setup(0.4, 0.25, 0.2, 0.05, 1500.0, 2000.0, 1500.0, 'data/textures/credits/code.tga');
  const gfx = new FXEuskal10Greets();
  gfx.setup(0.7, 0.35, 0.2, 0.05, 1500.0, 2000.0, 1500.0, 'data/textures/credits/gfx.tga');
  const music = new FXEuskal10Greets();
  music.setup(0.3, 0.55, 0.2, 0.05, 1500.0, 2000.0, 1500.0, 'data/textures/credits/music.tga');

  const ithaqua = new FXEuskal10Credits();
  ithaqua.setup(7, ithaquaTextures, 'data/textures/credits/ithaqua', 0.4, 0.4, 0.04, 0.04, 0.30, 5000.0, 1600.0, 200.0);
  const tekno = new FXEuskal10Credits();
  tekno.setup(5, teknoTextures, 'data/textures/credits/tekno', 0.7, 0.5, 0.04, 0.04, 0.21, 5000.0, 1300.0, 200.0);
  const wonder = new FXEuskal10Credits();
  wonder.setup(6, wonderTextures, 'data/textures/credits/wonder', 0.3, 0.7, 0.04, 0.04, 0.26, 5000.0, 1450.0, 200.0);

  const hairyObject = new FXHairyObject();
  hairyObject.setup(30, 190.0, 8.0, 3.0, 'data/textures/Particles/glowwhite.jpg', 'data/3Dscenes/hairy/hairy.pta', 'GeoSphere01', 'Camera01');

  const euskal10Circles = new FXEuskal10Circles();
  euskal10Circles.setup('data/3Dscenes/circles/scene.pta', 'data/textures/circles', 'Camera01', 0.0, 1.0, 'data/textures/circles/background.jpg');

  const circlesTransition = new FXImageStencilTransition();
  circlesTransition.setup(2000.0, 'data/textures/transitions/circles1.tga');
  const circlesTransitionCapture = new FXTransitionCapture(circlesTransition);

  // Calamares (greets scenes)
  const calamaresSetups = [
    { deform: 40, file: 'camera01.PTA', cam: 'Camera01', time: 0.0, speed: 1.0 },
    { deform: 40, file: 'camera05.PTA', cam: 'Camera05', time: 0.0, speed: 1.0 },
    { deform: 40, file: 'camera03.PTA', cam: 'Camera03', time: 0.0, speed: 1.0 },
    { deform: 40, file: 'camera04.PTA', cam: 'Camera04', time: 600.0, speed: 0.9 },
  ];
  const calamareseFadeIn = [0, 500, 500, 500]; // No fade for first, 500ms for 2-4 (matches overlap)
  const calamares = calamaresSetups.map((s, i) => {
    const fx = new FXEuskal10GreetsScene();
    fx.setup(s.deform, `data/3Dscenes/calamares/${s.file}`, 'data/textures/calamares', s.cam, s.time, s.speed);
    fx.setFade(calamareseFadeIn[i]);
    return fx;
  });

  // Particle steam (calamares section)
  const particleSteamCal = [];
  for (let i = 0; i < 4; i++) {
    const ps = new FXEuskal10ParticleSteam();
    ps.setup(600, 1.0, 2.0, 0.0, 400.0, 0.008, 0.015, 350.0, 'data/textures/Particles/glowwhite.tga', true, steamColor);
    particleSteamCal.push(ps);
  }

  // Greets
  const greetTextures = [
    'escena', 'fuzzion', 'concept', 'anaconda', 'unknown',
    'hansa', 'threepixels', 'chankateam', 'talsit',
  ];
  const greetPositions = [
    [0.2, 0.20], [0.2, 0.35], [0.2, 0.50], [0.2, 0.65], [0.2, 0.80],
    [0.2, 0.28], [0.2, 0.43], [0.2, 0.58], [0.2, 0.72],
  ];
  const greets = greetTextures.map((tex, i) => {
    const fx = new FXEuskal10Greets();
    fx.setup(greetPositions[i][0], greetPositions[i][1], 0.3, 0.06, 1500.0, 2000.0, 1500.0, `data/textures/Greets/${tex}.tga`);
    return fx;
  });

  // Respects
  const respectTextures = [
    'farbrausch', 'mfx', 'thepimpbrigade', 'excess', 'calodox',
    'unique', 'einklang', 'thesilents', 'potion',
  ];
  const respectPositions = [
    [0.80, 0.20], [0.80, 0.35], [0.65, 0.50], [0.80, 0.65], [0.80, 0.80],
    [0.80, 0.28], [0.80, 0.43], [0.80, 0.58], [0.80, 0.72],
  ];
  const respectSizes = [
    [0.3, 0.06], [0.3, 0.06], [0.6, 0.06], [0.3, 0.06], [0.3, 0.06],
    [0.3, 0.06], [0.3, 0.06], [0.3, 0.06], [0.3, 0.06],
  ];
  const respects = respectTextures.map((tex, i) => {
    const fx = new FXEuskal10Greets();
    fx.setup(respectPositions[i][0], respectPositions[i][1], respectSizes[i][0], respectSizes[i][1], 1500.0, 2000.0, 1500.0, `data/textures/Greets/${tex}.tga`);
    return fx;
  });

  // Final TV section
  const televisionF = [];
  for (let i = 0; i < 7; i++) {
    const tv = new FXTelevision();
    tv.setup();
    televisionF.push(tv);
  }

  const finalScreenToObj = new FXMapScreenToObject();
  finalScreenToObj.setup('data/3Dscenes/FinalTV/television.pta', 'tv', 'Camera01', 'data/textures/FinalTV', 0.6);

  const stravaganzaFinal = new FXEuskal10Credits();
  stravaganzaFinal.setup(11, sgzTextures, 'data/textures/credits/stravaganza', 0.3, 0.5, 0.05, 0.08, 0.45, 8000.0, 2500.0, 200.0);

  const ep2000 = new FXFadedImage();
  ep2000.setup([0.284, 0.58, 0.0], [0.284, 0.58, 0.0], [0.46, 0.04, 0.0], [0.46, 0.04, 0.0], 0.0, 0.0, 2000.0, 2000.0, 2000.0, 'data/textures/credits/ep2002.tga', 1.0, 1.0);


  // ---- Register with demo system (exact timings from FXManagement.cpp) ----

  dm.addFX(televisionStart1, 1800, 2200, 3, 'TelevisionStart1');
  dm.addFX(televisionStart2, 2790, 2920, 3, 'TelevisionStart2');
  dm.addFX(televisionStart3, 3000, 3200, 3, 'TelevisionStart3');
  dm.addFX(televisionStart4, 4150, 4450, 3, 'TelevisionStart4');

  dm.addFX(arrows1, 4900, 10000, 2, 'Arrows1');
  dm.addFX(arrows2, 10000, 12000, 2, 'Arrows2');
  dm.addFX(arrows3, 12000, 16100, 2, 'Arrows3');
  // Two-phase transition: capture arrows content (priority 3, after arrows at 2),
  // render captured arrows as overlay (priority 8, after spheres at 7).
  // C++ used stencil buffer; JS uses framebuffer capture + mask overlay.
  dm.addFX(arrowsTransitionCapture, 14100, 16100, 3, 'Arrows Transition Capture');
  dm.addFX(arrowsTransition, 14100, 16100, 8, 'Arrows Transition');

  dm.addFX(particleSteamSph[0], 14100, 17500, 6, 'Particle Steam sph1');
  dm.addFX(particleSteamSph[1], 16500, 24900, 11, 'Particle Steam sph2');
  dm.addFX(particleSteamSph[2], 23900, 27000, 16, 'Particle Steam sph3');
  dm.addFX(particleSteamSph[3], 26000, 29500, 21, 'Particle Steam sph4');
  dm.addFX(particleSteamSph[4], 28500, 32300, 26, 'Particle Steam sph5');
  dm.addFX(particleSteamSph[5], 31300, 36700, 31, 'Particle Steam sph6');

  dm.addFX(particledSpheres[0], 14100, 17500, 7, 'Particled spheres 1');
  dm.addFX(particledSpheres[1], 16500, 24900, 10, 'Particled spheres 2');
  dm.addFX(particledSpheres[2], 23900, 27000, 15, 'Particled spheres 3');
  dm.addFX(particledSpheres[3], 26000, 29500, 20, 'Particled spheres 4');
  dm.addFX(particledSpheres[4], 28500, 32300, 25, 'Particled spheres 5');
  dm.addFX(particledSpheres[5], 31300, 36700, 30, 'Particled spheres 6');

  dm.addFX(viewportInt1, 19200, 23500, 0, 'Viewport int balls1');
  dm.addFX(bgDistortionBalls, 19200, 23500, 12, 'BG Distort Balls');
  dm.addFX(viewportInt1, 29500, 31300, 0, 'Viewport int balls2');
  dm.addFX(radialBlurBalls, 29500, 31300, 27, 'Radial Blur Balls');

  dm.addFX(viewportInt1, 36100, 36700, 0, 'Viewport int Spike');
  // Two-phase transition: capture old content (priority 31, before new scene),
  // render tiles as overlay (priority 36, after new scene).
  // C++ used stencil buffer; JS uses overlay approach.
  dm.addFX(transitionPreSpikeCapture, 36100, 36700, 31, 'Transition Spike Capture');
  dm.addFX(transitionPreSpike, 36100, 36700, 36, 'Transition Spike');

  dm.addFX(bgLayer1Spike, 36100, 51000, 32, 'pBGLayer1Spike');
  dm.addFX(spike, 36100, 51000, 34, 'Spike');
  dm.addFX(pulsatingImg1, 36100, 51000, 35, 'Pulsating Img 1');

  const glowNames = ['GlowT', 'GlowH', 'GlowI', 'GlowS', 'GlowW', 'GlowA', 'GlowY', 'Glow Arrow'];
  const glowStarts = [48050, 48211, 48211, 48719, 48873, 48873, 49370, 49516];
  glows.forEach((g, i) => dm.addFX(g, glowStarts[i], 50000, 34, glowNames[i]));

  dm.addFX(viewportInt1, 50000, 51000, 0, 'Viewport int Expl');
  // Two-phase: capture spike content (priority 36, after spike at 32-35),
  // render explosion tiles (priority 41, after mamut at 39-40).
  dm.addFX(transitionExplCapture, 50000, 51000, 36, 'Transition Expl Capture');
  dm.addFX(transitionExpl, 50000, 51000, 41, 'Transition Expl');

  dm.addFX(mamutBackground, 50000, 64000, 39, 'Mamut Background');
  dm.addFX(mamut, 50000, 64000, 40, 'Mamut');

  dm.addFX(bumpBackground, 64000, 71000, 42, 'Bumped flareobj bg');
  dm.addFX(bumpScroll, 64000, 71000, 43, 'Bump scroll');
  dm.addFX(bump, 64000, 71000, 45, 'Bumped flare object');

  dm.addFX(classicBG1, 71000, 85100, 3, 'Classical BG1');
  dm.addFX(classicBG2, 71000, 85100, 4, 'Classical BG2');
  dm.addFX(classicBG3, 71000, 85100, 5, 'Classical BG3');
  dm.addFX(hairyObject, 71000, 85100, 6, 'Hairy object');
  dm.addFX(gfx, 71000, 77000, 16, 'GFX');
  dm.addFX(tekno, 72000, 78000, 17, 'Tekno');
  dm.addFX(music, 78000, 84000, 16, 'Music');
  dm.addFX(wonder, 79000, 85000, 17, 'Wonder');
  dm.addFX(thisWayImgJapo1, 84350, 84750, 27, 'TW japo1');
  dm.addFX(thisWayImgJapo2, 84750, 85150, 27, 'TW japo2');

  dm.addFX(code, 85150, 90150, 66, 'Code');
  dm.addFX(ithaqua, 86150, 92150, 67, 'Ithaqua');
  dm.addFX(radialBlurLyrics, 85150, 108000, 57, 'Radial blur lyrics');
  dm.addFX(viewportInt1, 85150, 108000, 0, 'Viewport lyrics');

  // Lyrics timings
  const lyricTimings = [
    [92000, 95000], [93000, 96000], [93500, 96500], [95000, 98000],
    [96000, 99000], [97000, 100000], [98000, 101000], [99000, 102000],
    [101000, 104000], [102000, 105000], [103000, 106000], [104000, 107000],
  ];
  lyrics.forEach((fx, i) => dm.addFX(fx, lyricTimings[i][0], lyricTimings[i][1], 27, `Lyric${i + 1}`));

  dm.addFX(pulsatingThisWay, 104000, 108000, 27, 'Pulsating this way');

  dm.addFX(euskal10Circles, 108000, 124000, 6, 'Euskal 10 Circles');
  // Two-phase transition: capture circles content (priority 7, after circles at 6),
  // render captured circles as overlay (priority 11, after calamares at 10).
  dm.addFX(circlesTransitionCapture, 122000, 124000, 7, 'Circles Transition Capture');
  dm.addFX(circlesTransition, 122000, 124000, 11, 'Circles Transition');

  dm.addFX(calamares[0], 122000, 129400, 10, 'Calamares1');
  dm.addFX(calamares[1], 128900, 136400, 15, 'Calamares2');
  dm.addFX(calamares[2], 135900, 143400, 20, 'Calamares3');
  dm.addFX(calamares[3], 142900, 150800, 25, 'Calamares4');

  dm.addFX(particleSteamCal[0], 122000, 129400, 11, 'Particle Steam Cal 1');
  dm.addFX(particleSteamCal[1], 128900, 136400, 16, 'Particle Steam Cal 2');
  dm.addFX(particleSteamCal[2], 135900, 143400, 21, 'Particle Steam Cal 3');
  dm.addFX(particleSteamCal[3], 142900, 150800, 26, 'Particle Steam Cal 4');

  const greetStart = 124000;
  // Greets batch 1 (0-4)
  for (let i = 0; i < 5; i++) {
    dm.addFX(greets[i], greetStart, greetStart + 5000, 35, `Greet${i + 1}`);
  }
  // Greets batch 2 (5-8)
  for (let i = 5; i < 9; i++) {
    dm.addFX(greets[i], greetStart + 5000, greetStart + 10000, 35, `Greet${i + 1}`);
  }
  // Respects batch 1 (0-4)
  for (let i = 0; i < 5; i++) {
    dm.addFX(respects[i], greetStart + 10000, greetStart + 15000, 35, `Respect${i + 1}`);
  }
  // Respects batch 2 (5-8)
  for (let i = 5; i < 9; i++) {
    dm.addFX(respects[i], greetStart + 15000, greetStart + 20000, 35, `Respect${i + 1}`);
  }

  // Final TV section televisions
  const tvTimings = [
    [144250, 144650], [145500, 145750], [146350, 146450],
    [147450, 147550], [148250, 148550], [149350, 149650],
    [150800, 172000],
  ];
  televisionF.forEach((tv, i) => dm.addFX(tv, tvTimings[i][0], tvTimings[i][1], 40, `TelevisionF${i + 1}`));

  dm.addFX(viewportInt1, 146900, 172000, 0, 'Viewport tv');
  dm.addFX(stravaganzaFinal, 160000, 168000, 43, 'Stravaganza final');
  dm.addFX(ep2000, 162000, 168000, 43, 'EP2002');
  dm.addFX(finalScreenToObj, 146900, 172000, 42, 'Final Screen to obj');
}
