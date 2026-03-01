/**
 * timeline.js - Odyssey demo effect timeline.
 * Port of Odyssey/Stravaganza Demo/FXManagement.cpp
 *
 * Registers all ~55 manual effect instances with exact ms timing.
 * Script-based effects (3D_SCENE, 3D_IMAGE, 3D_FADE, etc.) are loaded
 * separately from demo.scr by DemoManager.loadScript().
 */

import { FXBackground1 } from './effects/FXBackground1.js';
import { FXParticleText, FXPTextIthaqua, FXPTextTekno, FXPTextCircuitry, FXPTextWonder } from './effects/FXParticleText.js';
import { FXWideBlurredText } from './effects/FXWideBlurredText.js';
import { FXWavingGrid, FXWavingDemoLogo, FXWavingBlur } from './effects/FXWavingGrid.js';
import { FXBouncingObject } from './effects/FXBouncingObject.js';
import { FXWideBlurState } from './effects/FXWideBlurState.js';
import { FXWideBlur } from './effects/FXWideBlur.js';
import { FXParticleColumn } from './effects/FXParticleColumn.js';
import { FXSplineForm } from './effects/FXSplineForm.js';
import { FXQuadTrail } from './effects/FXQuadTrail.js';
import { FXSpiral1 } from './effects/FXSpiral.js';
import { splinesIthaqua, splinesTekno, splinesInterface, splinesWonder } from './effects/SplineDefinitions.js';

const megapeich = 20000;

export function registerAllEffects(dm) {

  // ============================================================
  // Credits
  // ============================================================

  const partTextIthaqua = new FXPTextIthaqua();
  partTextIthaqua.setup(0.30, 0.43, 1.0, splinesIthaqua, splinesIthaqua.length, 400, 'data/textures/particles/particlefirebig.jpg', true, 3000.0);

  const partTextTekno = new FXPTextTekno();
  partTextTekno.setup(0.75, 0.37, 1.0, splinesTekno, splinesTekno.length, 400, 'data/textures/particles/particlefirebig.jpg', true, 3000.0);

  const partTextCircuitry = new FXPTextCircuitry();
  partTextCircuitry.setup(0.62, 0.70, 1.0, splinesInterface, splinesInterface.length, 400, 'data/textures/particles/particlefirebig.jpg', true, 3000.0);

  const partTextWonder = new FXPTextWonder();
  partTextWonder.setup(0.38, 0.86, 1.0, splinesWonder, splinesWonder.length, 400, 'data/textures/particles/particlefirebig.jpg', true, 3000.0);

  const stravaganza = new FXWideBlurredText();
  stravaganza.setup(10, 0.5, 0.5, 2.4, 1.2, 0.8, 0.4, 0.0, 0.0, 'data/textures/credits/stravaganza.tga', null, 4000.0, 1000.0, 85.0);

  const title = new FXWavingDemoLogo();
  title.setup(0.5, 0.5, 0.8, 0.5, 50, 15, 'data/textures/credits/title.jpg', 6400);

  // End times extended +1000ms vs C++ to allow the full 3s alpha fade-out
  // (duration=3000 + 3000 fade = 6000ms total needed)
  dm.addFX(partTextIthaqua,   13000, 19000, 8, 'FXPartText Ithaqua');
  dm.addFX(partTextTekno,     19000, 25000, 8, 'FXPartText Tekno');
  dm.addFX(partTextCircuitry, 25500, 31500, 8, 'FXPartText Circuitry');
  dm.addFX(partTextWonder,    32000, 38000, 8, 'FXPartText Wonder');

  dm.addFX(stravaganza, 37200, 43200, 9, 'Stravaganza');
  dm.addFX(title,        43300, 49700, 9, 'Title');

  // ============================================================
  // 2D Compositions (Bouncing objects)
  // ============================================================

  const bounceTimes = [
    [55790, 58804],
    [61959, 65073],
    [68078, 71232],
    [74297, 77391],
  ];

  for (let i = 0; i < 4; i++) {
    const [start, end] = bounceTimes[i];

    const bg = new FXBackground1();
    bg.setup(20, 0.7, 0.7, 'data/textures/backgrounds/bouncingobjbackground.tga');
    dm.addFX(bg, start, end, 1, `Bouncing object background ${i + 1}`);

    const wavBlur = new FXWavingBlur();
    wavBlur.setup(0.5, 0.5, 1.2, 1.2, 30, 20, 'data/textures/backgrounds/bouncingobjwblur.jpg', 100000);
    dm.addFX(wavBlur, start, end, 2, `Bouncing object waving blur ${i + 1}`);

    const bouncing = new FXBouncingObject();
    bouncing.setup(null, null, 'data/3dscenes/compos1/bola.pta', 'data/textures/compos1');
    dm.addFX(bouncing, start, end, 4, `Bouncing object ${i + 1}`);
  }

  // ============================================================
  // Wide blur (camera rotation zoom)
  // ============================================================

  const wideBlurState1 = new FXWideBlurState();
  wideBlurState1.setup(true);
  dm.addFX(wideBlurState1, 82000, 83500, 1, 'WideBlurState1');

  const wideBlurState2 = new FXWideBlurState();
  wideBlurState2.setup(true);
  dm.addFX(wideBlurState2, 88500, 89800, 1, 'WideBlurState2');

  const wideBlurStateOff = new FXWideBlurState();
  wideBlurStateOff.setup(false);
  dm.addFX(wideBlurStateOff, 89800, 92000, 1, 'WideBlurStateOFF');

  const wideBlur1 = new FXWideBlur();
  wideBlur1.setup(7, 0.8, 0.0, 1000.0, 500.0, false);
  dm.addFX(wideBlur1, 82000, 83500, 3, 'WideBlur1');

  const wideBlur2 = new FXWideBlur();
  wideBlur2.setup(7, 0.8, 0.0, 900.0, 400.0, false);
  dm.addFX(wideBlur2, 88500, 89800, 3, 'WideBlur2');

  // ============================================================
  // Electric Guitar section
  // ============================================================

  const egBackground = new FXBackground1();
  egBackground.setup(15, 0.7, 0.7, 'data/textures/backgrounds/elguitar1.tga');
  dm.addFX(egBackground, 92513, 108300, 1, 'EG Background');

  const egWavBlur = new FXWavingBlur();
  egWavBlur.setup(0.5, 0.5, 1.0, 1.0, 50, 24, 'data/textures/backgrounds/elguitar1.tga', 18000);
  dm.addFX(egWavBlur, 92513, 108300, 2, 'EG Ghost blur');

  const egPartColumn = new FXParticleColumn();
  egPartColumn.setup(
    250, 1.5, 1.5, 0.2, 1.1,
    { x: 7.0, y: -10.0, z: -20.0 },
    { x: 7.0, y: 10.0, z: -20.0 },
    'data/textures/particles/glowwhite.jpg'
  );
  dm.addFX(egPartColumn, 92513, 108300, 4, 'EG Particle column');

  const egSpline = new FXSplineForm();
  egSpline.setup(
    { x: -67.0, y: -40.0, z: -200.0 }, 67.0,
    20, 800,
    'data/textures/particles/glowwhite.jpg',
    'data/textures/particles/glowblack.tga'
  );
  dm.addFX(egSpline, 92513, 108300, 4, 'EG Spline effect');

  // ============================================================
  // Viewport trails (6 groups of 4 quad trails)
  // ============================================================

  const vpTexture = 'data/textures/viewports/viewportquad.tga';
  const vpParams = { numQuads: 15, numSim: 50, startSize: 0.1, endSize: 0.25, startAngle: 0.0, endAngle: 180.0, duration: 1200.0 };

  // Start positions: 4 corners
  const corners = [
    { x: 0.2, y: 0.2, z: 0.1 },
    { x: 0.2, y: 0.8, z: 0.1 },
    { x: 0.8, y: 0.8, z: 0.1 },
    { x: 0.8, y: 0.2, z: 0.1 },
  ];

  // End positions for each group
  const groupEnds = [
    { x: 0.50, y: 0.50, z: 0.1 }, // group 1
    { x: 0.25, y: 0.25, z: 0.1 }, // group 2
    { x: 0.75, y: 0.75, z: 0.1 }, // group 3
    { x: 0.25, y: 0.75, z: 0.1 }, // group 4
    { x: 0.75, y: 0.25, z: 0.1 }, // group 5
    { x: 0.35, y: 0.65, z: 0.1 }, // group 6
  ];

  // Center times and priorities for each group
  const groupTimes = [
    { center: 110179, priority: 4 },
    { center: 113183, priority: 8 },
    { center: 116037, priority: 12 },
    { center: 122386, priority: 16 },
    { center: 125581, priority: 20 },
    { center: 128495, priority: 24 },
  ];

  for (let g = 0; g < 6; g++) {
    const { center, priority } = groupTimes[g];
    const endPos = groupEnds[g];
    const start = center - 1200;
    const end = center + 400;

    for (let c = 0; c < 4; c++) {
      const qt = new FXQuadTrail();
      qt.setup(vpParams.numQuads, vpParams.numSim, corners[c], endPos,
        vpParams.startSize, vpParams.endSize, vpParams.startAngle, vpParams.endAngle,
        vpParams.duration, vpTexture);
      dm.addFX(qt, start, end, priority, `Viewport trail ${g + 1}${c + 1}`);
    }
  }

  // ============================================================
  // Greetings & Respects
  // ============================================================

  const greetSpiral = new FXSpiral1();
  greetSpiral.setup(25, { x: 0.75, y: 0.70, z: 0.0 }, 0.0, 0.45, 280.0, 'data/textures/backgrounds/elguitarspiral.jpg');
  dm.addFX(greetSpiral, 171400 - megapeich, 182700 - megapeich, 3, 'Greet Spiral');

  const greetBackground = new FXBackground1();
  greetBackground.setup(25, 0.7, 0.7, 'data/textures/backgrounds/elguitar2.tga');
  dm.addFX(greetBackground, 171400 - megapeich, 182700 - megapeich, 2, 'Greet Background');

  const fxGreetings = new FXWideBlurredText();
  fxGreetings.setup(15, 0.75, 0.1, 1.5, 0.15, 0.4, 0.08, 0.0, 0.0, 'data/textures/greets/greetings.tga', null, 700.0, 3000.0, 20.0);
  dm.addFX(fxGreetings, 171400 - megapeich, 176500 - megapeich, 50, 'Greetings');

  const fxRespects = new FXWideBlurredText();
  fxRespects.setup(15, 0.75, 0.1, 1.5, 0.15, 0.4, 0.08, 0.0, 0.0, 'data/textures/greets/respects.tga', null, 700.0, 3000.0, 20.0);
  dm.addFX(fxRespects, 177000 - megapeich, 181700 - megapeich, 50, 'Respects');

  const fxSurrender = new FXWideBlurredText();
  fxSurrender.setup(10, 0.67, 0.8, 2.0, 0.15, 0.50, 0.15, 0.0, 0.0, 'data/textures/greets/surrender.tga', null, 500.0, 2000.0, 20.0);
  dm.addFX(fxSurrender, 176000 - megapeich, 182500 - megapeich, 50, 'All of you must...');

  const fxFutile = new FXWideBlurredText();
  fxFutile.setup(15, 0.5, 0.7, 2.0, 0.13, 0.70, 0.13, 0.0, 0.0, 'data/textures/greets/futile.tga', null, 500.0, 6000.0, 20.0);
  dm.addFX(fxFutile, 183000 - megapeich, 190000 - megapeich, 50, 'Resistance is futile');

  // Individual greet lines
  const fWidth1 = 1.2, fWidth2 = 0.3, fHeight1 = 0.45, fHeight2 = 0.06;

  const greetData = [
    { y: 0.20, tex: 'greet01.tga', h2: fHeight2 - 0.01, timeTillFade: 3000, startMs: 172237 },
    { y: 0.33, tex: 'greet09.tga', h2: fHeight2, timeTillFade: 2400, startMs: 172837 },
    { y: 0.46, tex: 'greet03.tga', h2: fHeight2, timeTillFade: 1800, startMs: 173459 },
    { y: 0.59, tex: 'greet02.tga', h2: fHeight2, timeTillFade: 1200, startMs: 174050 },
    { y: 0.72, tex: 'greet07.tga', h2: fHeight2, timeTillFade: 600, startMs: 174631 },
    { y: 0.85, tex: 'greet11.tga', h2: fHeight2 - 0.01, timeTillFade: 0, startMs: 175252 },
  ];

  for (let i = 0; i < greetData.length; i++) {
    const g = greetData[i];
    const fx = new FXWideBlurredText();
    fx.setup(10, 0.2, g.y, fWidth1, fHeight1, fWidth2, g.h2, 0.0, 0.0,
      `data/textures/greets/${g.tex}`, null, 500.0, g.timeTillFade, 20.0);
    dm.addFX(fx, g.startMs - 500 - megapeich, 175702 - megapeich, 55, `Greet ${String(i + 1).padStart(2, '0')}`);
  }

  // Individual respect lines
  const respectData = [
    { y: 0.2, tex: 'respect01.tga', h2: fHeight2, timeTillFade: 4200, startMs: 177024 },
    { y: 0.3, tex: 'respect02.tga', h2: fHeight2, timeTillFade: 3600, startMs: 177635 },
    { y: 0.4, tex: 'respect03.tga', h2: fHeight2, timeTillFade: 3000, startMs: 178236 },
    { y: 0.5, tex: 'respect04.tga', h2: fHeight2, timeTillFade: 2400, startMs: 178827 },
    { y: 0.6, tex: 'respect05.tga', h2: fHeight2 - 0.01, timeTillFade: 1800, startMs: 179418 },
    { y: 0.7, tex: 'respect06.tga', h2: fHeight2, timeTillFade: 1200, startMs: 180018 },
    { y: 0.8, tex: 'respect07.tga', h2: fHeight2, timeTillFade: 600, startMs: 180619 },
  ];

  for (let i = 0; i < respectData.length; i++) {
    const r = respectData[i];
    const fx = new FXWideBlurredText();
    fx.setup(10, 0.2, r.y, fWidth1, fHeight1, fWidth2, r.h2, 0.0, 0.0,
      `data/textures/greets/${r.tex}`, null, 500.0, r.timeTillFade, 20.0);
    dm.addFX(fx, r.startMs - 500 - megapeich, 182700 - megapeich, 55, `Respect ${String(i + 1).padStart(2, '0')}`);
  }
}
