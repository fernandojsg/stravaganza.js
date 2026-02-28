/**
 * ScriptParser - Parse PTA demo.scr script files.
 *
 * Format: text-based, one command per line
 * - Lines starting with ; are comments
 * - Commands: DEMO_START, 3D_LOADSCENE, 3D_LOADIMAGE, 3D_SCENE, 3D_IMAGE,
 *   3D_FADE, 3D_FLASH, 3D_ALPHAFUNC, 3D_FOG, 3D_VIEWPORT, 3D_MOTIONBLUR,
 *   3D_WIDEBLUR, 3D_CLEAR_ZBUFF, 3D_CLEAR_FRAMEBUFF, FX
 * - Key=value pairs, tuples as (a,b,c)
 */

/**
 * Parse a tuple string like "(0.5,0.3,0.1)" into an array of numbers.
 * For blend mode tuples like "(ALPHA, INVALPHA)", returns parsed blend mode values.
 */
function parseTuple(str) {
  if (!str) return [];
  const inner = str.replace(/[()]/g, '').trim();
  const parts = inner.split(',').map(s => s.trim());

  // Check if any part is a blend mode name (non-numeric)
  const hasBlendModes = parts.some(s => isNaN(parseFloat(s)) && BLEND_MODE_NAMES[s.toUpperCase()] !== undefined);
  if (hasBlendModes) {
    return parts.map(s => {
      const num = parseFloat(s);
      if (!isNaN(num)) return num;
      return BLEND_MODE_NAMES[s.toUpperCase()] ?? 0;
    });
  }

  return parts.map(s => parseFloat(s));
}

/** PTA blend mode name → internal enum value */
const BLEND_MODE_NAMES = {
  'ZERO': 0, 'ONE': 1,
  'SRCCOLOR': 2, 'INVSRCCOLOR': 3,
  'ALPHA': 4, 'SRCALPHA': 4,
  'INVALPHA': 5, 'INVSRCALPHA': 5,
  'DSTALPHA': 6, 'INVDSTALPHA': 7,
  'DSTCOLOR': 8, 'INVDSTCOLOR': 9,
};

/**
 * Parse a single line into key-value pairs.
 * @param {string} line
 * @returns {Object}
 */
function parseKeyValues(line) {
  const result = {};
  // Match key=value or key=(tuple) patterns
  const regex = /(\w+)\s*=\s*(\([^)]*\)|"[^"]*"|[^\s]+)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    let value = match[2];

    // Remove quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    // Parse tuples
    if (value.startsWith('(')) {
      result[key] = parseTuple(value);
    } else if (value === 'IN' || value === 'OUT' || value === 'ON' || value === 'OFF' ||
               value === 'LINEAR' || value === 'EXP' || value === 'EXP2') {
      result[key] = value;
    } else {
      // Try to parse as number
      const num = parseFloat(value);
      result[key] = isNaN(num) ? value : num;
    }
  }

  // Check for FORCE modifier
  if (line.includes('FORCE')) {
    result.force = true;
  }

  return result;
}

/**
 * Parse a demo script string into a list of commands.
 * @param {string} text - Script file contents
 * @returns {Array<{type: string, params: Object}>}
 */
export function parseScript(text) {
  const commands = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith(';')) continue;

    // Determine command type (first word)
    const spaceIdx = line.indexOf(' ');
    const cmdType = spaceIdx >= 0 ? line.substring(0, spaceIdx) : line;
    const rest = spaceIdx >= 0 ? line.substring(spaceIdx + 1) : '';

    const params = parseKeyValues(rest);
    params._raw = line; // Keep raw line for debugging

    commands.push({ type: cmdType, params });
  }

  return commands;
}

/**
 * Parse blend mode string to numeric value.
 * Used by 3D_ALPHAFUNC command.
 * @param {string} mode
 * @returns {number}
 */
export function parseBlendMode(mode) {
  return BLEND_MODE_NAMES[mode.toUpperCase()] ?? 1;
}
