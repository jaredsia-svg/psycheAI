// Draws the scene behind each character on the Psyche Card's purple box and
// writes them to docs/character-art.js:
//
//   node tools/character-art.mjs
//
// Every scene is drawn from the symbols of a story (a moon, a sword, a wave,
// a skyline) rather than from the character's likeness, which belongs to the
// studio. All of them share one frame: a 520 x 440 view, bled off the right of
// the box and faded in from the left, with the bright centrepiece in the
// upper right and dark ground along the bottom, so the name, headline and
// blurb always sit on the quiet side. {id} is replaced per drawing by
// characterArt() in docs/copy.js, because the card is on the page more than
// once and gradients are found by id.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const W = 520;
const H = 440;
const n = value => Number(value.toFixed(1));

// ---------- building blocks ----------

let defs = [];
const stopList = stops => stops.map(([offset, color, alpha = 1]) =>
  '<stop offset="' + offset + '" stop-color="' + color + '" stop-opacity="' + alpha + '"/>').join('');
function lin(name, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  defs.push('<linearGradient id="{id}-' + name + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
    stopList(stops) + '</linearGradient>');
  return 'url(#{id}-' + name + ')';
}
function rad(name, stops, cx = 0.5, cy = 0.5) {
  defs.push('<radialGradient id="{id}-' + name + '" cx="' + cx + '" cy="' + cy + '">' + stopList(stops) + '</radialGradient>');
  return 'url(#{id}-' + name + ')';
}
const glow = (name, cx, cy, r, color, alpha = 0.8) =>
  '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + rad(name, [[0, color, alpha], [0.45, color, alpha * 0.4], [1, color, 0]]) + '"/>';
const tint = (top, bottom, alpha = 0.55) =>
  '<rect width="' + W + '" height="' + H + '" fill="' + lin('tint', [[0, top, alpha], [1, bottom, alpha]]) + '"/>';
const ground = (d, fill) => '<path d="' + d + '" fill="' + fill + '"/>';

// Deterministic scatter, so a rebuild draws the same scene.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stars(seed, count, x0 = 120, x1 = W, y0 = 0, y1 = 220, color = '#fff') {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    out += '<circle cx="' + n(x0 + r() * (x1 - x0)) + '" cy="' + n(y0 + r() * (y1 - y0)) + '" r="' + n(0.8 + r() * 1.8) +
      '" fill="' + color + '" opacity="' + n(0.35 + r() * 0.55) + '"/>';
  }
  return out;
}
const sparkle = (x, y, s, color = '#fff') =>
  '<path d="M' + x + ' ' + (y - s) + ' l' + n(s * 0.28) + ' ' + n(s * 0.72) + ' l' + n(s * 0.72) + ' ' + n(s * 0.28) +
  ' l' + n(-s * 0.72) + ' ' + n(s * 0.28) + ' l' + n(-s * 0.28) + ' ' + n(s * 0.72) + ' l' + n(-s * 0.28) + ' ' + n(-s * 0.72) +
  ' l' + n(-s * 0.72) + ' ' + n(-s * 0.28) + ' l' + n(s * 0.72) + ' ' + n(-s * 0.28) + 'z" fill="' + color + '"/>';
// Buildings with lit windows, left to right along a base line.
function skyline(seed, x0, x1, base, minH, maxH, fill, windows = '#ffe9a6', spires = false) {
  const r = rng(seed);
  let x = x0;
  let body = '';
  let lights = '';
  while (x < x1) {
    const w = 22 + r() * 34;
    const h = minH + r() * (maxH - minH);
    const top = base - h;
    body += spires && r() > 0.6
      ? '<path d="M' + n(x) + ' ' + base + 'V' + n(top + 14) + 'L' + n(x + w / 2) + ' ' + n(top - 18) + 'L' + n(x + w) + ' ' + n(top + 14) + 'V' + base + 'Z"/>'
      : '<rect x="' + n(x) + '" y="' + n(top) + '" width="' + n(w) + '" height="' + n(h) + '"/>';
    for (let wy = top + 10; wy < base - 8; wy += 13) {
      for (let wx = x + 5; wx < x + w - 6; wx += 9) {
        if (r() > 0.62) lights += '<rect x="' + n(wx) + '" y="' + n(wy) + '" width="3.6" height="5"/>';
      }
    }
    x += w + 2 + r() * 6;
  }
  return '<g fill="' + fill + '">' + body + '</g><g fill="' + windows + '" opacity=".75">' + lights + '</g>';
}
// Falling or drifting bits: petals, snow, leaves, sparks.
function scatter(seed, count, shape, x0 = 110, x1 = W, y0 = 0, y1 = H) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) out += shape(n(x0 + r() * (x1 - x0)), n(y0 + r() * (y1 - y0)), r);
  return out;
}
const fadeMask = () =>
  '<linearGradient id="{id}-fadex" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
  '<stop offset=".22" stop-color="#fff" stop-opacity="1"/></linearGradient>' +
  '<mask id="{id}-mask" maskContentUnits="userSpaceOnUse"><rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#{id}-fadex)"/></mask>';

function scene(draw) {
  defs = [];
  const body = draw();
  return '<defs>' + defs.join('') + fadeMask() + '</defs><g mask="url(#{id}-mask)">' + body + '</g>';
}

// ---------- the scenes ----------

const SCENES = {
  // Ice palace spires under an aurora, and a great crystal snowflake.
  'Elsa': () => {
    const arm = a => {
      const t = 'rotate(' + a + ' 370 140)';
      return '<g transform="' + t + '"><path d="M370 140V48"/><path d="M370 72l-16-16M370 72l16-16M370 96l-20-18M370 96l20-18M370 118l-12-10M370 118l12-10"/></g>';
    };
    return tint('#7fd8ff', '#2a2f8f', 0.5) + stars(11, 40) +
      '<path d="M140 70C220 30 300 90 380 50S500 40 540 20" fill="none" stroke="' + lin('aur1', [[0, '#7cf5d8', 0], [0.5, '#7cf5d8', 0.7], [1, '#8fb7ff', 0.4]], 0, 0, 1, 0) + '" stroke-width="22" stroke-linecap="round"/>' +
      '<path d="M170 110C250 70 330 130 410 90S520 80 540 64" fill="none" stroke="' + lin('aur2', [[0, '#d59bff', 0], [0.6, '#d59bff', 0.5], [1, '#8fb7ff', 0.3]], 0, 0, 1, 0) + '" stroke-width="14" stroke-linecap="round"/>' +
      glow('g', 370, 140, 150, '#c9f3ff', 0.75) +
      '<g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round">' + [0, 60, 120, 180, 240, 300].map(arm).join('') + '</g>' +
      '<path d="M370 116L391 128V152L370 164L349 152V128Z" fill="#e8fbff" stroke="#fff" stroke-width="3"/>' +
      ground('M150 440L190 380L214 400L246 300L270 386L300 250L326 380L352 320L380 392L420 270L446 386L478 330L520 380V440Z', lin('ice', [[0, '#e8fbff', 0.9], [1, '#6fb6e8', 0.35]])) +
      '<path d="M246 300L262 360M300 250L314 340M420 270L434 360" stroke="#fff" stroke-width="2" opacity=".8"/>' +
      ground('M120 440L180 410L260 420L360 402L440 418L520 400V440Z', '#1f2a6b') +
      scatter(12, 34, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.4 + r() * 2.6) + '" fill="#fff" opacity="' + n(0.5 + r() * 0.5) + '"/>') +
      sparkle(470, 60, 12) + sparkle(262, 196, 8);
  },

  // A wave curling over in the moonlight, and a voyaging canoe under sail.
  'Moana': () =>
    tint('#2fd3d9', '#0b3466', 0.55) + stars(21, 36, 120, W, 0, 160) +
    glow('moon', 300, 80, 80, '#fff4cf', 0.7) + '<circle cx="300" cy="80" r="30" fill="#fff6dc"/>' +
    '<path d="M150 330C190 240 260 170 360 130C440 100 510 120 530 180V440H150Z" fill="' + lin('wave', [[0, '#7ff0e6'], [0.45, '#1fb7c9'], [1, '#0d4a7a']]) + '"/>' +
    '<path d="M360 130C420 112 476 128 488 170C498 206 470 232 440 226C412 220 404 192 424 180C440 172 452 184 446 196" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>' +
    '<path d="M200 300C240 236 296 186 362 160" fill="none" stroke="#e9fffb" stroke-width="5" stroke-linecap="round" opacity=".8"/>' +
    scatter(22, 18, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#fff" opacity=".85"/>', 330, 500, 110, 170) +
    '<g fill="#08223f"><path d="M230 402h120l-14 12H244z"/><path d="M286 400V312"/><path d="M286 316C254 340 246 372 258 396H288z"/><path d="M292 320C318 336 330 364 324 392H292z"/></g>' +
    '<path d="M286 400V312" stroke="#08223f" stroke-width="3"/>' +
    ground('M120 440V404C170 392 220 412 270 404S380 392 430 404 500 396 520 400V440Z', '#062544') +
    '<path d="M160 418c20-6 40 6 60 0s40-6 60 0M300 424c20-6 40 6 60 0s40-6 60 0" fill="none" stroke="#7ff0e6" stroke-width="2" opacity=".6"/>',

  // A great sun behind a crown of rays, a rock jutting over the plain, and an acacia.
  'Simba': () =>
    tint('#ffb24a', '#7a2e7a', 0.55) +
    '<g fill="' + lin('rays', [[0, '#ffe7a0', 0.8], [1, '#ffb24a', 0]]) + '">' +
      [-60, -36, -12, 12, 36, 60].map(a => '<path d="M355 175L340 40L370 40Z" transform="rotate(' + a + ' 355 175)"/>').join('') + '</g>' +
    glow('sun', 355, 175, 170, '#ffd27a', 0.85) +
    '<circle cx="355" cy="175" r="98" fill="' + lin('disc', [[0, '#fff1b8'], [0.6, '#ffb54d'], [1, '#ff7a3d']]) + '"/>' +
    '<g fill="#7a2e7a" opacity=".35"><rect x="250" y="200" width="210" height="6"/><rect x="250" y="218" width="210" height="8"/><rect x="250" y="238" width="210" height="10"/></g>' +
    '<g fill="#2b0d2f"><path d="M150 440V372C200 364 250 376 300 368S420 356 520 362V440Z"/>' +
      '<path d="M520 300L440 298C420 300 404 306 396 314L380 318C376 322 380 326 388 326L430 330L520 340Z"/>' +
      '<path d="M198 372V318"/><path d="M198 318C176 316 160 306 150 296C176 300 190 296 198 292C206 296 222 300 248 296C238 306 222 316 198 318Z"/></g>' +
    '<path d="M198 372V318" stroke="#2b0d2f" stroke-width="5"/>' +
    '<g fill="none" stroke="#2b0d2f" stroke-width="2.4" stroke-linecap="round"><path d="M250 90q8-6 16 0q8-6 16 0"/><path d="M300 64q6-5 12 0q6-5 12 0"/><path d="M470 110q6-5 12 0q6-5 12 0"/></g>',

  // Floating lanterns over a lake at night, rising past a lone tower.
  'Rapunzel': () => {
    const lanFill = lin('lan', [[0, '#fff3c4'], [1, '#ff9a3c']]);
    const lanGlow = rad('lglow', [[0, '#ffd27a', 0.55], [0.45, '#ffd27a', 0.22], [1, '#ffd27a', 0]]);
    const lantern = (x, y, s) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(s * 3.4) + '" fill="' + lanGlow + '"/>' +
      '<path d="M' + (x - s) + ' ' + (y - s * 1.2) + 'h' + 2 * s + 'l' + n(s * 0.3) + ' ' + n(s * 2.2) + 'h' + n(-s * 2.6) + 'z" fill="' + lanFill + '"/>';
    const spots = [[300, 70, 9], [360, 40, 7], [420, 90, 11], [470, 50, 8], [250, 130, 7], [330, 150, 12], [400, 170, 8], [480, 150, 10], [220, 60, 5], [280, 210, 6], [440, 230, 7], [370, 240, 5], [500, 250, 6]];
    return tint('#2b2d7a', '#c4508f', 0.55) + stars(31, 40, 120, W, 0, 200) +
      spots.map(([x, y, s]) => lantern(x, y, s)).join('') +
      '<g fill="#1c0f3a"><rect x="430" y="210" width="38" height="150"/><path d="M420 214L449 160L478 214Z"/><rect x="440" y="236" width="10" height="14" fill="#ffd27a"/>' +
        '<path d="M150 440V360C220 350 300 366 380 356S470 344 520 352V440Z"/></g>' +
      '<rect x="150" y="372" width="370" height="68" fill="' + lin('lake', [[0, '#3b2a7a', 0.9], [1, '#1c0f3a', 1]]) + '"/>' +
      spots.filter(([, , s]) => s > 7).map(([x, , s]) => '<rect x="' + (x - 2) + '" y="' + (380 + s) + '" width="4" height="' + s * 3 + '" fill="#ffd27a" opacity=".45"/>').join('');
  },

  // A badge rising over a sunrise skyline.
  'Judy Hopps': () =>
    tint('#7fd8ff', '#3a2a8f', 0.5) + glow('sun', 360, 150, 170, '#ffe7a8', 0.6) +
    '<g transform="translate(360 140)"><path d="M0 -104L84 -72V-4C84 54 46 90 0 112C-46 90 -84 54 -84 -4V-72Z" fill="' + lin('gold', [[0, '#fff0b0'], [1, '#e1a12e']]) + '" stroke="#fff" stroke-width="4"/>' +
      '<path d="M0 -86L66 -60V-4C66 44 34 74 0 92C-34 74 -66 44 -66 -4V-60Z" fill="none" stroke="#b97a1f" stroke-width="3"/>' +
      '<path d="M0 -42L12 -16L40 -12L19 7L25 35L0 21L-25 35L-19 7L-40 -12L-12 -16Z" fill="#fff8dc" stroke="#b97a1f" stroke-width="3"/></g>' +
    sparkle(450, 70, 14) + sparkle(276, 74, 9) +
    skyline(41, 130, W, 440, 40, 150, '#2a1a5a', '#ffe9a6') +
    glow('red', 180, 300, 40, '#ff4d6d', 0.5) + glow('blue', 230, 300, 40, '#4da3ff', 0.5),

  // A fox's sly face in the city's neon dusk.
  'Nick Wilde': () =>
    tint('#3a2a8f', '#c4508f', 0.55) + stars(51, 26, 120, W, 0, 160) +
    '<path d="M300 70a42 42 0 1 0 44 56a34 34 0 1 1-44-56z" fill="#fff1c4" opacity=".9"/>' +
    glow('g', 380, 170, 140, '#ff9a5c', 0.55) +
    '<g transform="translate(380 172)">' +
      '<path d="M-92 -96L-34 -30H34L92 -96C104 -10 80 50 30 84L0 104L-30 84C-80 50 -104 -10 -92 -96Z" fill="' + lin('fur', [[0, '#ffb062'], [1, '#e8642c']]) + '"/>' +
      '<path d="M-80 -78L-40 -34L-60 -30ZM80 -78L40 -34L60 -30Z" fill="#7a2a1a" opacity=".6"/>' +
      '<path d="M-64 6C-40 30 -16 40 0 40C16 40 40 30 64 6C54 50 26 76 0 92C-26 76 -54 50 -64 6Z" fill="#fff4e4"/>' +
      '<path d="M-44 -6L-18 -2L-24 8ZM44 -6L18 -2L24 8Z" fill="#2a1240"/>' +
      '<path d="M-10 60H10L0 72Z" fill="#2a1240"/></g>' +
    sparkle(456, 118, 10) +
    skyline(52, 130, W, 440, 30, 110, '#1a1035', '#7ff0e6') +
    '<rect x="196" y="350" width="64" height="16" rx="8" fill="none" stroke="#ff6fb5" stroke-width="3"/><rect x="300" y="336" width="40" height="12" rx="6" fill="none" stroke="#7ff0e6" stroke-width="3"/>',

  // A heart that glows like a beacon over a bridge across the bay.
  'Baymax': () =>
    tint('#8fd8ff', '#c45aa0', 0.5) + glow('g', 370, 140, 160, '#ffd1e1', 0.8) +
    '<g fill="none" stroke="#fff" stroke-width="2" opacity=".5">' +
      [0, 60, 120, 180, 240, 300].map(a => '<path d="M370 140m0 -112l24 14v28l-24 14l-24 -14v-28z" transform="rotate(' + a + ' 370 140)"/>').join('') + '</g>' +
    '<path d="M370 226S286 174 286 116a42 42 0 0 1 84 -14a42 42 0 0 1 84 14c0 58 -84 110 -84 110z" fill="' + lin('heart', [[0, '#ff8aa8'], [1, '#e3264f']]) + '" stroke="#fff" stroke-width="5"/>' +
    '<path d="M370 106v52M344 132h52" stroke="#fff" stroke-width="12" stroke-linecap="round"/>' +
    '<g fill="#2a1240"><rect x="244" y="250" width="12" height="150"/><rect x="434" y="250" width="12" height="150"/><path d="M150 360h370v10H150z"/></g>' +
    '<path d="M250 254C300 340 390 340 440 254M150 300C190 330 230 330 250 300M440 300C470 330 500 330 520 310" fill="none" stroke="#2a1240" stroke-width="4"/>' +
    '<path d="M260 270v90M280 296v64M300 316v44M320 330v30M380 330v30M400 316v44M420 296v64" stroke="#2a1240" stroke-width="2"/>' +
    skyline(61, 130, W, 440, 20, 60, '#1c0f3a', '#ffd27a') + sparkle(470, 60, 11) + sparkle(270, 64, 8),

  // A sheriff's star over desert mesas at sundown, a lasso circling it.
  'Woody': () =>
    tint('#ffb35c', '#a33d6f', 0.55) + glow('sun', 370, 230, 160, '#ffd27a', 0.7) +
    '<circle cx="370" cy="236" r="62" fill="#ffd98a" opacity=".85"/>' +
    '<ellipse cx="370" cy="132" rx="128" ry="34" fill="none" stroke="#c88a3a" stroke-width="7" transform="rotate(-12 370 132)"/>' +
    '<g transform="translate(370 120)"><path d="M0 -92L22 -38L80 -46L42 0L80 46L22 38L0 92L-22 38L-80 46L-42 0L-80 -46L-22 -38Z" fill="' + lin('star', [[0, '#fff0b0'], [1, '#e1a12e']]) + '" stroke="#fff" stroke-width="4"/>' +
      [[0, -92], [80, -46], [80, 46], [0, 92], [-80, 46], [-80, -46]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="8" fill="#fff0b0" stroke="#b97a1f" stroke-width="3"/>').join('') +
      '<circle r="26" fill="none" stroke="#b97a1f" stroke-width="4"/></g>' +
    '<ellipse cx="370" cy="132" rx="128" ry="34" fill="none" stroke="#e7b05a" stroke-width="7" stroke-dasharray="190 400" transform="rotate(-12 370 132)"/>' +
    '<g fill="#3a1440"><path d="M150 440V360H200L212 340H286L300 360H360V440Z"/><path d="M380 440V330L396 316H470L484 330V352H520V440Z"/>' +
      '<path d="M236 360v-46a8 8 0 0 1 16 0v46M236 330h-12v-14a6 6 0 0 1 12 0M252 336h12v-18a6 6 0 0 0-12 0"/></g>' +
    sparkle(470, 54, 12) + sparkle(250, 90, 8),

  // A rocket climbing past a ringed planet into a field of stars.
  'Buzz Lightyear': () =>
    tint('#1b1f5e', '#5a2c9f', 0.6) + stars(71, 60, 120, W, 0, 360) +
    glow('pg', 410, 110, 130, '#b38cff', 0.6) +
    '<circle cx="410" cy="110" r="64" fill="' + lin('planet', [[0, '#c9b3ff'], [1, '#6a3fd0']]) + '"/>' +
    '<path d="M410 110m-62 -6c30 8 94 8 124 0" stroke="#6a3fd0" stroke-width="3" fill="none" opacity=".6"/>' +
    '<ellipse cx="410" cy="110" rx="118" ry="22" fill="none" stroke="#8ff0b8" stroke-width="7" transform="rotate(-18 410 110)"/>' +
    '<circle cx="250" cy="70" r="16" fill="#8ff0b8" opacity=".85"/>' +
    '<g transform="translate(300 250) rotate(38)">' +
      '<path d="M0 -96C30 -70 34 -20 24 30H-24C-34 -20 -30 -70 0 -96Z" fill="' + lin('hull', [[0, '#ffffff'], [1, '#cfd6ff']], 0, 0, 1, 0) + '" stroke="#fff" stroke-width="3"/>' +
      '<circle cy="-34" r="13" fill="#6a3fd0" stroke="#fff" stroke-width="4"/>' +
      '<path d="M-24 0L-52 34V54L-24 36ZM24 0L52 34V54L24 36Z" fill="#8ff0b8"/>' +
      '<path d="M-18 34C-18 70 -8 96 0 120C8 96 18 70 18 34Z" fill="' + lin('flame', [[0, '#fff3c4'], [0.5, '#ffb24a'], [1, '#ff4d6d', 0]]) + '"/></g>' +
    '<path d="M150 440C180 400 210 380 240 370" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity=".18"/>' +
    ground('M120 440V420C220 404 340 414 520 400V440Z', '#140b35'),

  // A seedling sheltered in a glass sphere, drifting among the stars over a heap of cubes.
  'WALL-E': () =>
    tint('#0f2b4f', '#5a2a7a', 0.6) + stars(81, 60, 120, W, 0, 300) +
    '<path d="M520 30A160 160 0 0 0 370 -40" fill="none" stroke="#7fd8ff" stroke-width="14" opacity=".35"/>' +
    glow('g', 370, 170, 150, '#8ff0b8', 0.6) +
    '<circle cx="370" cy="170" r="84" fill="' + rad('glass', [[0, '#e8fff4', 0.25], [0.8, '#bff7dd', 0.18], [1, '#ffffff', 0.55]], 0.4, 0.35) + '" stroke="#fff" stroke-width="4"/>' +
    '<path d="M330 120a52 52 0 0 1 40 -26" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>' +
    '<path d="M370 226V170" stroke="#3f8f4a" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M370 186C370 160 350 148 324 148C324 172 342 186 370 186Z" fill="#6fe08a"/><path d="M370 172C370 146 390 132 418 134C418 158 398 172 370 172Z" fill="#8ff0a0"/>' +
    '<path d="M330 226h80l-8 16h-64z" fill="#c9a07a"/>' +
    '<g fill="#22163f" stroke="#3a2a6a" stroke-width="2">' +
      [[150, 400], [186, 400], [222, 400], [168, 366], [204, 366], [186, 332], [300, 400], [336, 400], [318, 366], [420, 400], [456, 400], [492, 400], [438, 366], [474, 366], [456, 332], [456, 298]]
        .map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="34" height="32"/>').join('') + '</g>' +
    ground('M120 440V430H520V440Z', '#140b35') + sparkle(470, 70, 10) + sparkle(260, 110, 7),

  // A whisk in a halo of spices over the rooftops of Paris at night.
  'Remy': () =>
    tint('#2a3b8f', '#c4508f', 0.55) + stars(91, 30, 120, W, 0, 150) +
    glow('g', 350, 140, 150, '#ffe0a6', 0.7) +
    '<g transform="translate(350 132) rotate(28)" fill="none" stroke-linecap="round">' +
      [52, 38, 24, 10].map((w, i) => '<path d="M0 30C-' + w + ' 0 -' + w + ' -90 0 -112C' + w + ' -90 ' + w + ' 0 0 30" stroke="' + (i % 2 ? '#e9e4ff' : '#fff') + '" stroke-width="4.5"/>').join('') +
      '<path d="M0 -112V30" stroke="#fff" stroke-width="4"/>' +
      '<rect x="-11" y="26" width="22" height="20" rx="4" fill="#d9d2f5" stroke="#fff" stroke-width="3"/>' +
      '<rect x="-8" y="44" width="16" height="92" rx="8" fill="#c43e6a" stroke="#fff" stroke-width="3"/><circle cy="124" r="3.5" fill="#fff"/></g>' +
    scatter(92, 22, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(2 + r() * 3) + '" fill="' + ['#ffb24a', '#ff6f6f', '#8ff0a0', '#fff1b8'][Math.floor(r() * 4)] + '"/>', 250, 470, 30, 240) +
    '<path d="M260 230c-10-20 10-30 0-50M300 236c-10-20 10-30 0-50M440 226c-10-20 10-30 0-50" fill="none" stroke="#fff" stroke-width="4" opacity=".45" stroke-linecap="round"/>' +
    '<g fill="#1c0f3a"><path d="M470 440L478 300L486 230L490 180L494 230L502 300L510 440Z"/><path d="M462 340h56v8h-56zM472 290h36v6h-36z"/>' +
      '<path d="M150 440V372L180 352L210 372H236V346L262 330L288 346V372H320L350 350L380 372H420V440Z"/>' +
      '<rect x="190" y="338" width="8" height="18"/><rect x="300" y="352" width="8" height="18"/></g>' +
    '<g fill="#ffd27a"><rect x="250" y="388" width="10" height="12"/><rect x="340" y="384" width="10" height="12"/><rect x="200" y="392" width="10" height="12"/></g>',

  // A radiant sun and a stream of glowing memories.
  'Joy': () =>
    tint('#ffe36e', '#ff7ab8', 0.5) +
    '<g stroke="#fff3c4" stroke-width="10" stroke-linecap="round" opacity=".8">' +
      Array.from({ length: 14 }, (_, i) => '<path d="M370 150m0 -112v-30" transform="rotate(' + (i * 360 / 14) + ' 370 150)"/>').join('') + '</g>' +
    glow('g', 370, 150, 170, '#fff3a6', 0.9) +
    '<circle cx="370" cy="150" r="78" fill="' + lin('sun', [[0, '#fffbe0'], [1, '#ffd23c']]) + '" stroke="#fff" stroke-width="5"/>' +
    '<path d="M150 300C220 250 280 300 340 270S460 220 540 250" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".6"/>' +
    [[250, 250, 18, '#ffe36e'], [300, 300, 14, '#7fd8ff'], [440, 250, 20, '#ffe36e'], [490, 300, 12, '#ff8ab8'], [210, 190, 10, '#8ff0a0'], [470, 60, 14, '#ffe36e']]
      .map(([x, y, r, c]) => glow('o' + x, x, y, r * 2.4, c, 0.7) + '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '" stroke="#fff" stroke-width="3"/>').join('') +
    ground('M120 440V390C200 360 280 400 360 380S470 360 520 372V440Z', '#5a2a7a') + sparkle(250, 90, 10) + sparkle(480, 200, 9),

  // Gears turning on a blueprint grid, a wrench across them, sparks flying.
  'Iron Man': () => {
    const gear = (cx, cy, r, teeth, name) => {
      let d = '';
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        const b = a + Math.PI / teeth;
        const [r1, r2] = [r, r * 1.18];
        d += (i ? 'L' : 'M') + n(cx + r1 * Math.cos(a)) + ' ' + n(cy + r1 * Math.sin(a)) +
          'L' + n(cx + r2 * Math.cos(a + 0.08)) + ' ' + n(cy + r2 * Math.sin(a + 0.08)) +
          'L' + n(cx + r2 * Math.cos(b - 0.08)) + ' ' + n(cy + r2 * Math.sin(b - 0.08)) +
          'L' + n(cx + r1 * Math.cos(b)) + ' ' + n(cy + r1 * Math.sin(b));
      }
      return '<path d="' + d + 'Z" fill="' + lin(name, [[0, '#ffe39a'], [1, '#d4922c']]) + '" stroke="#fff" stroke-width="3"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + n(r * 0.42) + '" fill="#7a1a2a" stroke="#fff" stroke-width="3"/>';
    };
    let grid = '';
    for (let x = 140; x < W; x += 26) grid += '<path d="M' + x + ' 0V' + H + '"/>';
    for (let y = 0; y < H; y += 26) grid += '<path d="M120 ' + y + 'H' + W + '"/>';
    return tint('#ff5a3c', '#5a1a3a', 0.55) + '<g stroke="#fff" stroke-width="1" opacity=".14">' + grid + '</g>' +
      glow('g', 370, 150, 160, '#ffd27a', 0.7) +
      gear(350, 140, 74, 12, 'g1') + gear(462, 236, 44, 9, 'g2') +
      '<g transform="translate(380 190) rotate(-40)"><path d="M-12 -120a34 34 0 1 0 24 0v30h-24z" fill="#e9e4ff" stroke="#fff" stroke-width="3"/><rect x="-10" y="-92" width="20" height="170" rx="8" fill="#e9e4ff" stroke="#fff" stroke-width="3"/></g>' +
      scatter(102, 16, (x, y, r) => '<path d="M' + x + ' ' + y + 'l' + n(6 + r() * 10) + ' ' + n(-3 - r() * 6) + '" stroke="#ffe39a" stroke-width="3" stroke-linecap="round"/>', 240, 500, 220, 330) +
      ground('M120 440V392H520V440Z', '#3a0e22') + '<path d="M140 392H520" stroke="#ffb24a" stroke-width="2" opacity=".6"/>' + sparkle(250, 80, 10);
  },

  // A star-bright shield under rays of light.
  'Captain America': () =>
    tint('#2b4bd0', '#c43050', 0.5) + stars(111, 40, 120, W, 0, 260) +
    '<g fill="#fff" opacity=".22">' + [-50, -30, -10, 10, 30, 50].map(a => '<path d="M370 160L350 -40H390Z" transform="rotate(' + a + ' 370 160)"/>').join('') + '</g>' +
    glow('g', 370, 160, 160, '#ffffff', 0.55) +
    '<g transform="translate(372 176) scale(.84)"><path d="M-96 -112H96V-6C96 66 44 104 0 126C-44 104 -96 66 -96 -6Z" fill="#e9eeff" stroke="#fff" stroke-width="5"/>' +
      '<path d="M-96 -6H96M-96 -60H96" stroke="#c43050" stroke-width="22"/>' +
      '<path d="M-96 -112H96V-82H-96Z" fill="#2b4bd0"/>' +
      '<path d="M0 -60L16 -24L56 -22L25 4L35 42L0 20L-35 42L-25 4L-56 -22L-16 -24Z" fill="#2b4bd0" stroke="#fff" stroke-width="4"/>' +
      '<path d="M-96 -112H96V-6C96 66 44 104 0 126C-44 104 -96 66 -96 -6Z" fill="none" stroke="#fff" stroke-width="5"/></g>' +
    ground('M120 440V396C200 384 300 404 380 392S480 384 520 390V440Z', '#1a1240') + sparkle(470, 70, 12) + sparkle(260, 120, 8),

  // A web strung across the corner of the night sky over the city.
  'Spider-Man': () => {
    let web = '';
    const cx = 520;
    const cy = 0;
    const spokes = [100, 120, 140, 160, 180, 200];
    for (const a of spokes) {
      const t = (a * Math.PI) / 180;
      web += '<path d="M' + cx + ' ' + cy + 'L' + n(cx + 420 * Math.cos(t)) + ' ' + n(cy + 420 * Math.sin(t)) + '"/>';
    }
    for (const r of [60, 110, 160, 210, 260, 310]) {
      let d = '';
      spokes.forEach((a, i) => {
        const t = (a * Math.PI) / 180;
        const p = [n(cx + r * Math.cos(t)), n(cy + r * Math.sin(t))];
        if (!i) d += 'M' + p[0] + ' ' + p[1];
        else {
          const m = (((a - 10) * Math.PI) / 180);
          d += 'Q' + n(cx + r * 0.86 * Math.cos(m)) + ' ' + n(cy + r * 0.86 * Math.sin(m)) + ' ' + p[0] + ' ' + p[1];
        }
      });
      web += '<path d="' + d + '"/>';
    }
    return tint('#1a2a7a', '#c42a4a', 0.55) + stars(121, 30, 120, W, 0, 220) +
      glow('moon', 300, 110, 100, '#ffe9c4', 0.6) + '<circle cx="300" cy="110" r="44" fill="#fff1d6"/>' +
      '<g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".92">' + web + '</g>' +
      '<path d="M410 0V196" stroke="#fff" stroke-width="2"/>' +
      '<g transform="translate(410 206)" fill="#1a0f2f"><ellipse rx="9" ry="12"/><circle cy="-14" r="6"/>' +
        '<path d="M-6 -6L-22 -16M-7 0L-24 -2M-7 6L-22 14M-5 10L-16 24M6 -6L22 -16M7 0L24 -2M7 6L22 14M5 10L16 24" stroke="#1a0f2f" stroke-width="2.6"/></g>' +
      skyline(122, 130, W, 440, 70, 190, '#160b2f', '#ffe9a6', true);
  },

  // A mountain cracking under a green shockwave, boulders in the air.
  'Hulk': () =>
    tint('#3fbf5a', '#3a1a5a', 0.5) +
    '<g fill="#c9ff9a" opacity=".35">' + Array.from({ length: 12 }, (_, i) => '<path d="M380 150L366 -60H394Z" transform="rotate(' + (i * 30 + 8) + ' 380 150)"/>').join('') + '</g>' +
    glow('g', 380, 150, 200, '#9fff6f', 0.85) +
    '<circle cx="380" cy="150" r="54" fill="' + rad('core', [[0, '#f4ffd6'], [1, '#7fe64a']]) + '"/>' +
    '<g fill="none" stroke="#e8ffb0" stroke-linecap="round"><circle cx="380" cy="150" r="80" stroke-width="7" opacity=".85"/><circle cx="380" cy="150" r="118" stroke-width="4" opacity=".5"/><circle cx="380" cy="150" r="160" stroke-width="3" opacity=".3"/></g>' +
    '<path d="M300 0L290 50L316 58L280 120" fill="none" stroke="#f4ffd6" stroke-width="5" stroke-linejoin="round"/>' +
    ground('M150 440V330L200 270L236 296L284 240L330 290L380 250L430 300L480 262L520 290V440Z', lin('mtn', [[0, '#4a2a6a'], [1, '#1f0a2a']])) +
    '<path d="M284 240L296 300L276 340L304 400M380 250L372 320L396 380M480 262L470 330" fill="none" stroke="#9fff6f" stroke-width="4" stroke-linejoin="round"/>' +
    [[248, 120, 26, 20], [480, 70, 30, -15], [494, 200, 20, 40], [230, 210, 16, 10], [300, 30, 14, 30], [446, 250, 14, 60]]
      .map(([x, y, s, a]) => '<path d="M' + (x - s) + ' ' + y + 'l' + n(s * 0.7) + ' ' + (-s) + 'l' + n(s * 1.2) + ' ' + n(s * 0.3) + 'l' + n(s * 0.4) + ' ' + n(s * 1.2) + 'l' + n(-s) + ' ' + n(s * 0.6) + 'z" fill="#4a2a6a" stroke="#8fff6f" stroke-width="2" transform="rotate(' + a + ' ' + x + ' ' + y + ')"/>').join('') +
    ground('M120 440V400H520V440Z', '#1f0a2a'),

  // Claw marks of light across a jungle night, under a purple moon.
  'Black Panther': () =>
    tint('#2a1a5a', '#8a2ab0', 0.6) + stars(141, 30, 120, W, 0, 200) +
    glow('mglow', 400, 120, 140, '#d7a6ff', 0.6) + '<circle cx="400" cy="120" r="70" fill="' + lin('mdisc', [[0, '#f3e4ff'], [1, '#b98cff']]) + '"/>' +
    '<g stroke-linecap="round" fill="none">' +
      [[0, 0], [34, 10], [68, 20]].map(([dx, dy]) => '<path d="M' + (300 + dx) + ' ' + (40 + dy) + 'C' + (340 + dx) + ' ' + (120 + dy) + ' ' + (380 + dx) + ' ' + (200 + dy) + ' ' + (440 + dx) + ' ' + (280 + dy) + '" stroke="#fff" stroke-width="12"/>' +
        '<path d="M' + (300 + dx) + ' ' + (40 + dy) + 'C' + (340 + dx) + ' ' + (120 + dy) + ' ' + (380 + dx) + ' ' + (200 + dy) + ' ' + (440 + dx) + ' ' + (280 + dy) + '" stroke="#c9a6ff" stroke-width="4"/>').join('') + '</g>' +
    '<g fill="none" stroke="#c9a6ff" stroke-width="1.6" opacity=".55"><path d="M470 236l20 12v24l-20 12-20-12v-24zM490 272l20 12v24l-20 12-20-12v-24z"/></g>' +
    '<g fill="#140826">' +
      [[160, 440, 60, -30], [220, 440, 90, -10], [290, 440, 70, 20], [470, 440, 110, 30], [520, 440, 80, 10], [400, 440, 60, -20]]
        .map(([x, y, h, a]) => '<path d="M' + x + ' ' + y + 'C' + (x - 30) + ' ' + (y - h * 0.6) + ' ' + (x - 10) + ' ' + (y - h) + ' ' + x + ' ' + (y - h) + 'C' + (x + 10) + ' ' + (y - h) + ' ' + (x + 30) + ' ' + (y - h * 0.6) + ' ' + x + ' ' + y + 'Z" transform="rotate(' + a + ' ' + x + ' ' + y + ')"/>').join('') +
      '<path d="M120 440V400C220 380 320 410 420 392S500 384 520 388V440Z"/></g>',

  // Rings of light turning around an open eye.
  'Doctor Strange': () => {
    const ring = (r, ticks, w, o) => {
      let t = '';
      for (let i = 0; i < ticks; i++) t += '<path d="M370 ' + (160 - r) + 'v' + (i % 3 ? 6 : 12) + '" transform="rotate(' + n((i * 360) / ticks) + ' 370 160)"/>';
      return '<circle cx="370" cy="160" r="' + r + '" stroke-width="' + w + '" opacity="' + o + '"/>' + t;
    };
    return tint('#ff9a3c', '#4a1a7a', 0.55) + stars(151, 30, 120, W, 0, 300) +
      glow('g', 370, 160, 190, '#ffb24a', 0.75) +
      '<g fill="none" stroke="#ffd27a" stroke-linecap="round">' + ring(140, 48, 4, 0.7) + ring(110, 36, 3, 0.9) + ring(80, 24, 3, 1) +
        '<path d="M370 50L465 215H275Z" stroke-width="3" opacity=".7"/><path d="M370 270L275 105H465Z" stroke-width="3" opacity=".7"/>' +
        '<rect x="300" y="90" width="140" height="140" stroke-width="2" opacity=".5" transform="rotate(45 370 160)"/></g>' +
      '<path d="M320 160C340 134 356 124 370 124S400 134 420 160C400 186 384 196 370 196S340 186 320 160Z" fill="#fff8e0" stroke="#ffd27a" stroke-width="4"/>' +
      '<circle cx="370" cy="160" r="16" fill="#3fbf6a"/><circle cx="370" cy="160" r="7" fill="#12301a"/>' +
      scatter(152, 20, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="2.4" fill="#ffd27a"/>', 220, 510, 20, 320) +
      ground('M120 440V396C220 380 320 404 420 388S500 384 520 388V440Z', '#2a0d40');
  },

  // A golden lasso glowing over the columns of an ancient temple.
  'Wonder Woman': () =>
    tint('#ffcf5a', '#b0303a', 0.5) + stars(161, 30, 120, W, 0, 200) +
    glow('g', 370, 150, 170, '#ffe39a', 0.8) +
    '<ellipse cx="370" cy="150" rx="120" ry="66" fill="none" stroke="' + lin('rope', [[0, '#fff3b0'], [1, '#e0a12e']], 0, 0, 1, 0) + '" stroke-width="12" transform="rotate(-14 370 150)"/>' +
    '<ellipse cx="370" cy="150" rx="120" ry="66" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 10" transform="rotate(-14 370 150)"/>' +
    '<path d="M268 196C250 250 258 300 300 330" fill="none" stroke="#e0a12e" stroke-width="10" stroke-linecap="round"/>' +
    '<g fill="#3a0f2a"><path d="M300 330h220v12H300zM306 318h208l-14-12H320z"/>' +
      [320, 360, 400, 440, 480].map(x => '<rect x="' + x + '" y="342" width="18" height="70"/>').join('') +
      '<path d="M120 440V412H520V440Z"/></g>' +
    sparkle(470, 60, 13) + sparkle(260, 90, 9) + sparkle(430, 260, 8),

  // A full moon over a gothic skyline, a flock of bats crossing it.
  'Batman': () => {
    const bat = (x, y, s) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 0C6 -6 12 -6 16 -2C18 -8 24 -10 30 -6C26 -2 26 4 30 8C22 4 18 6 16 12C12 6 8 4 0 6C-8 4 -12 6 -16 12C-18 6 -22 4 -30 8C-26 4 -26 -2 -30 -6C-24 -10 -18 -8 -16 -2C-12 -6 -6 -6 0 0Z"/>';
    return tint('#0e1033', '#3a2a6a', 0.65) + stars(171, 40, 120, W, 0, 200) +
      '<path d="M300 440L360 160L380 440Z" fill="#fff" opacity=".08"/><path d="M440 440L420 140L470 440Z" fill="#fff" opacity=".06"/>' +
      glow('moon', 380, 130, 170, '#fff4d6', 0.55) +
      '<circle cx="380" cy="130" r="92" fill="' + rad('moonf', [[0, '#fffaf0'], [1, '#e8dcc0']], 0.4, 0.35) + '"/>' +
      '<circle cx="350" cy="110" r="12" fill="#d8ccb0" opacity=".5"/><circle cx="410" cy="160" r="8" fill="#d8ccb0" opacity=".5"/>' +
      '<g fill="#0a0820">' + [[330, 120, 1.4], [400, 90, 1.1], [440, 150, 0.9], [300, 170, 0.8], [470, 100, 0.7], [250, 120, 0.6], [360, 200, 0.7]].map(([x, y, s]) => bat(x, y, s)).join('') + '</g>' +
      skyline(172, 130, W, 440, 80, 230, '#0a0820', '#ffd27a', true);
  },

  // A lightning bolt splitting a storm, sparks crackling off it.
  'Pikachu': () =>
    tint('#ffd23c', '#3a2a8f', 0.5) +
    '<g fill="#3a2a6a" opacity=".55"><ellipse cx="300" cy="40" rx="110" ry="40"/><ellipse cx="440" cy="30" rx="120" ry="44"/><ellipse cx="380" cy="70" rx="90" ry="30"/></g>' +
    glow('g', 380, 190, 180, '#fff3a0', 0.85) +
    '<path d="M400 30L300 210H372L330 380L470 170H392L440 30Z" fill="' + lin('bolt', [[0, '#fffbe0'], [1, '#ffd23c']]) + '" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>' +
    '<g fill="none" stroke="#fff3a0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M260 120l-24 20h18l-20 26"/><path d="M490 240l-20 16h14l-16 22"/><path d="M250 300l-18 14h12l-14 18"/></g>' +
    scatter(182, 18, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#fff8c4"/>', 260, 500, 100, 340) +
    ground('M120 440V404C220 390 320 410 420 396S500 392 520 396V440Z', '#2a1a5a'),

  // A spotted mushroom on rolling hills, coins glinting in the sky.
  'Mario': () =>
    tint('#5ac8fa', '#3a2a8f', 0.45) +
    '<g fill="#fff" opacity=".85"><ellipse cx="290" cy="60" rx="40" ry="16"/><ellipse cx="316" cy="50" rx="26" ry="16"/><ellipse cx="470" cy="90" rx="40" ry="14"/><ellipse cx="494" cy="80" rx="22" ry="14"/></g>' +
    glow('g', 370, 180, 160, '#fff3c4', 0.6) +
    '<path d="M286 186C286 116 330 76 370 76S454 116 454 186Z" fill="' + lin('cap', [[0, '#ff6b6b'], [1, '#d6283f']]) + '" stroke="#fff" stroke-width="5"/>' +
    '<g fill="#fff"><circle cx="370" cy="116" r="20"/><circle cx="318" cy="156" r="16"/><circle cx="424" cy="156" r="16"/><circle cx="336" cy="100" r="8"/><circle cx="404" cy="98" r="8"/></g>' +
    '<path d="M330 186h80c4 40 -6 70 -40 70s-44-30-40-70z" fill="#fff4e4" stroke="#fff" stroke-width="4"/>' +
    '<g fill="#2a1240"><ellipse cx="356" cy="214" rx="5" ry="10"/><ellipse cx="384" cy="214" rx="5" ry="10"/></g>' +
    [[250, 150], [480, 170], [270, 250], [460, 260]].map(([x, y]) => '<ellipse cx="' + x + '" cy="' + y + '" rx="10" ry="13" fill="#ffd23c" stroke="#fff" stroke-width="3"/><rect x="' + (x - 2) + '" y="' + (y - 6) + '" width="4" height="12" fill="#e1a12e"/>').join('') +
    ground('M120 440V330C180 290 240 300 280 330S360 290 420 316 500 300 520 310V440Z', '#3f9f5a') +
    ground('M120 440V380C200 350 280 380 360 362S470 350 520 360V440Z', '#226b3f'),

  // A compass rose over a far castle on the hills, birds on the wind.
  'Link': () =>
    tint('#3ac0b0', '#2a3a7a', 0.5) +
    '<g fill="#fff" opacity=".6"><ellipse cx="260" cy="90" rx="44" ry="12"/><ellipse cx="470" cy="210" rx="50" ry="12"/></g>' +
    glow('g', 370, 150, 160, '#fff1b8', 0.7) +
    '<g transform="translate(370 150)">' +
      '<circle r="96" fill="none" stroke="#ffe39a" stroke-width="5"/><circle r="80" fill="none" stroke="#ffe39a" stroke-width="2"/>' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(a => '<path d="M0 -' + (a % 90 ? 70 : 112) + 'L' + (a % 90 ? 10 : 16) + ' 0L0 ' + (a % 90 ? 10 : 16) + 'L-' + (a % 90 ? 10 : 16) + ' 0Z" fill="' + (a % 90 ? '#e8d6a0' : '#fff3c4') + '" stroke="#b97a1f" stroke-width="2" transform="rotate(' + a + ')"/>').join('') +
      '<circle r="10" fill="#b97a1f"/></g>' +
    '<g fill="none" stroke="#1c1240" stroke-width="2.4" stroke-linecap="round"><path d="M250 210q7-6 14 0q7-6 14 0"/><path d="M290 190q5-5 10 0q5-5 10 0"/><path d="M480 60q6-5 12 0q6-5 12 0"/></g>' +
    ground('M150 440V340C210 320 270 330 330 350S450 320 520 330V440Z', '#2f6b5a') +
    '<g fill="#1c1240"><rect x="430" y="286" width="16" height="50"/><rect x="452" y="300" width="40" height="36"/><rect x="496" y="280" width="16" height="56"/>' +
      '<path d="M426 286l12-20 12 20zM492 280l12-20 12 20zM452 300l20-16 20 16z"/></g>' +
    ground('M120 440V390C200 370 300 396 400 380S490 372 520 378V440Z', '#183a35'),

  // A great leaf held over the forest in the rain, fireflies under the tree.
  'Totoro': () =>
    tint('#3a9f6a', '#1a2a4a', 0.55) +
    '<g stroke="#cfeaff" stroke-width="2" stroke-linecap="round" opacity=".5">' +
      scatter(191, 40, (x, y) => '<path d="M' + x + ' ' + y + 'l-6 18"/>', 120, W, 0, 360) + '</g>' +
    '<g fill="#12301f"><path d="M430 440V250C430 230 450 230 450 250V440Z"/>' +
      '<ellipse cx="440" cy="220" rx="110" ry="70"/><ellipse cx="380" cy="250" rx="80" ry="50"/><ellipse cx="500" cy="260" rx="70" ry="50"/></g>' +
    glow('g', 330, 140, 130, '#c9ffd6', 0.55) +
    '<g transform="translate(330 136) rotate(-18)"><path d="M0 -96C70 -70 80 10 0 64C-80 10 -70 -70 0 -96Z" fill="' + lin('leaf', [[0, '#9bf0a6'], [1, '#2f9f5a']]) + '" stroke="#e8ffe8" stroke-width="4"/>' +
      '<path d="M0 -92V96M0 -50l-34 -18M0 -50l34 -18M0 -10l-46 -20M0 -10l46 -20M0 28l-38 -18M0 28l38 -18" stroke="#e8ffe8" stroke-width="3" fill="none"/></g>' +
    scatter(192, 14, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="#f6ff9a"/>' + '<circle cx="' + x + '" cy="' + y + '" r="7" fill="#f6ff9a" opacity=".25"/>', 260, 500, 280, 400) +
    ground('M120 440V400C220 384 320 408 420 394S500 390 520 392V440Z', '#0c2016'),

  // A great onion in the swamp at dusk, cattails and a hut by the water.
  'Shrek': () =>
    tint('#9fcf4a', '#2a3a2a', 0.55) + stars(201, 20, 120, W, 0, 140) +
    '<circle cx="470" cy="60" r="26" fill="#fff4cf" opacity=".85"/>' +
    glow('g', 360, 170, 150, '#e9ffa6', 0.55) +
    '<path d="M360 64C334 100 280 128 280 186C280 232 318 262 360 262S440 232 440 186C440 128 386 100 360 64Z" fill="' + lin('onion', [[0, '#e6c3ff'], [1, '#8a3fb0']]) + '" stroke="#fff" stroke-width="5"/>' +
    '<path d="M360 76C342 108 312 138 312 188C312 226 336 250 360 254M360 76C378 108 408 138 408 188C408 226 384 250 360 254M360 80V254" fill="none" stroke="#fff" stroke-width="3" opacity=".7"/>' +
    '<path d="M360 60C362 44 372 34 384 30M360 60C354 46 344 40 332 38" stroke="#6fbf4a" stroke-width="5" stroke-linecap="round" fill="none"/>' +
    '<path d="M330 250l-4 10M360 252v12M390 250l4 10" stroke="#e6c3ff" stroke-width="3" stroke-linecap="round"/>' +
    '<g fill="#1c2a14"><path d="M430 350L470 320L510 350V390H430Z"/><rect x="460" y="360" width="16" height="30" fill="#ffd27a"/>' +
      '<path d="M150 440V390C230 380 330 396 430 386S500 382 520 384V440Z"/></g>' +
    '<g stroke="#1c2a14" stroke-width="3" stroke-linecap="round">' + [210, 230, 250, 400, 418].map((x, i) => '<path d="M' + x + ' 400V' + (330 + i * 7) + '"/><rect x="' + (x - 3) + '" y="' + (330 + i * 7) + '" width="6" height="22" rx="3" fill="#5a3a1a"/>').join('') + '</g>' +
    scatter(202, 12, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="2.4" fill="#f6ff9a"/>', 230, 510, 250, 380) +
    '<path d="M150 410c30-6 60 6 90 0s60-6 90 0 60 6 90 0" fill="none" stroke="#9fcf4a" stroke-width="2" opacity=".5"/>',

  // A steaming bowl of dumplings between bamboo, peach blossom drifting.
  'Po': () =>
    tint('#ff9a5c', '#5a2a5a', 0.55) +
    '<path d="M240 160l60-90 50 60 40-50 70 80" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>' +
    '<circle cx="300" cy="90" r="34" fill="#fff1d6" opacity=".8"/>' +
    glow('g', 370, 190, 150, '#ffe0b0', 0.75) +
    '<path d="M330 160c-12-26 12-36 0-62M370 156c-12-26 12-36 0-62M410 160c-12-26 12-36 0-62" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/>' +
    '<g fill="#fff8ec" stroke="#e9c9a0" stroke-width="2"><path d="M300 196c0-26 22-36 34-36s34 10 34 36z"/><path d="M366 196c0-28 22-40 36-40s36 12 36 40z"/><path d="M336 196c0-20 16-30 30-30s30 10 30 30z"/></g>' +
    '<path d="M276 196H464C464 252 420 282 370 282S276 252 276 196Z" fill="' + lin('bowl', [[0, '#ff6b6b'], [1, '#b0303a']]) + '" stroke="#fff" stroke-width="5"/>' +
    '<path d="M300 220c20 10 40 10 70 10s50 0 70-10" fill="none" stroke="#ffd27a" stroke-width="4"/>' +
    '<path d="M330 296h80" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M430 110L500 220M446 104L512 214" stroke="#e9c9a0" stroke-width="6" stroke-linecap="round"/>' +
    '<g fill="#2a1430">' + [[480, 200], [500, 150], [176, 160], [204, 120]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="12" height="' + (440 - y) + '"/><rect x="' + (x - 2) + '" y="' + (y + 70) + '" width="16" height="4"/><rect x="' + (x - 2) + '" y="' + (y + 150) + '" width="16" height="4"/>').join('') + '</g>' +
    scatter(212, 12, (x, y, r) => '<ellipse cx="' + x + '" cy="' + y + '" rx="6" ry="3.6" fill="#ffc6da" transform="rotate(' + n(r() * 180) + ' ' + x + ' ' + y + ')"/>', 220, 510, 20, 340) +
    ground('M120 440V384C220 370 320 392 420 378S500 372 520 376V440Z', '#2a1430'),

  // A dragon in flight over sea stacks, a burst of flame ahead of it.
  'Hiccup': () =>
    tint('#3a7ad0', '#2a1a4a', 0.55) + stars(221, 30, 120, W, 0, 200) +
    glow('fire', 236, 178, 90, '#ffb24a', 0.75) +
    '<path d="M270 166C248 150 226 160 204 150C218 166 210 182 194 196C222 192 246 194 270 172Z" fill="' + lin('flame', [[0, '#ff4d3d'], [0.6, '#ffb24a'], [1, '#fff3c4']], 0, 0, 1, 0) + '"/>' +
    '<g fill="#140826">' +
      '<path d="M400 150C420 108 452 70 504 40C494 68 492 86 496 102C482 98 468 102 460 114C450 108 436 112 430 126C420 122 410 132 412 150Z" opacity=".8"/>' +
      '<ellipse cx="386" cy="160" rx="58" ry="19" transform="rotate(-6 386 160)"/>' +
      '<path d="M340 154C320 148 304 150 292 158L268 160L276 166L268 172L292 172C306 174 322 170 344 168Z"/>' +
      '<path d="M300 154l-8 -14l12 8zM312 152l-4 -15l10 10z"/>' +
      '<path d="M436 158C466 164 486 182 508 180L524 170L516 190C484 198 460 186 434 172Z"/><path d="M508 180l14 -14l2 18z"/>' +
      '<path d="M372 152C352 104 320 72 266 54C284 78 288 94 284 110C298 104 312 108 318 120C330 114 344 120 348 134C358 132 366 142 362 156Z"/>' +
      '<path d="M370 172l-6 18l8 -2zM404 172l2 18l6 -4z"/></g>' +
    '<circle cx="292" cy="160" r="2.4" fill="#ffd27a"/>' +
    '<g fill="#1a1035"><path d="M200 440V330L214 316L230 330V440Z"/><path d="M420 440V300L440 280L462 300V440Z"/><path d="M470 440V340L486 326L502 340V440Z"/></g>' +
    ground('M120 440V400C220 390 320 408 420 396S500 392 520 396V440Z', '#0c1a3a') +
    '<path d="M150 414c30-6 60 6 90 0s60-6 90 0 60 6 90 0 60-6 90 0" fill="none" stroke="#7fd8ff" stroke-width="2" opacity=".5"/>',
};

// ---------- write ----------

const art = { Mulan: readFileSync(new URL('./character-art-mulan.txt', import.meta.url), 'utf8').trim() };
for (const [name, draw] of Object.entries(SCENES)) art[name] = scene(draw);

const out = '// Generated by tools/character-art.mjs — edit that, not this.\n' +
  '//\n' +
  '// The scene behind each character in the Psyche Card\'s purple box, drawn\n' +
  '// from the symbols of the story rather than the character. Read by\n' +
  '// characterArt() in copy.js.\n' +
  '(function (root) {\n  \'use strict\';\n  root.PsycheCharacterArt = ' + JSON.stringify(art, null, 1).replace(/\n/g, '\n  ') + ';\n' +
  '})(typeof window !== \'undefined\' ? window : globalThis);\n';
writeFileSync(root + 'docs/character-art.js', out);
const sizes = Object.entries(art).map(([k, v]) => k + ' ' + (v.length / 1024).toFixed(1) + 'k');
console.log(Object.keys(art).length + ' scenes, ' + (out.length / 1024).toFixed(0) + ' KB\n' + sizes.join(', '));
