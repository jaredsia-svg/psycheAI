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
// A point along a cubic curve, for setting things along a path.
const bez = (p0, p1, p2, p3, t) => [0, 1].map(k => n((1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k]));
// A star of `points` points, as a path around the origin.
function starPath(points, outer, inner) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    d += (i ? 'L' : 'M') + n(r * Math.cos(a)) + ' ' + n(r * Math.sin(a));
  }
  return d + 'Z';
}

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
  // Ground that starts partway in would show a hard edge wherever the box
  // crops the scene, so every band runs off the left.
  const body = draw().replace(/M1[25]0 440V/g, 'M0 440V');
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

  // A voyaging canoe under a great crab-claw sail, the sun going down behind it.
  'Moana': () => {
    const hull = (dx, dy, fill) => '<path transform="translate(' + dx + ' ' + dy + ')" d="M206 318C214 334 226 344 246 346H484C504 346 516 336 524 318C526 344 512 366 486 374H248C222 370 206 346 206 318Z" fill="' + fill + '"/>';
    return tint('#ff9a6a', '#0b3466', 0.55) + stars(21, 30, 120, W, 0, 110) +
      glow('sun', 300, 300, 210, '#ffd9a0', 0.8) +
      '<circle cx="300" cy="318" r="60" fill="' + lin('sdisc', [[0, '#fff3d0'], [1, '#ff9a6a']]) + '"/>' +
      '<path d="M0 352H520V440H0Z" fill="' + lin('sea', [[0, '#1fb7c9'], [1, '#062544']]) + '"/>' +
      '<g fill="#ffe3b0" opacity=".7"><rect x="250" y="360" width="76" height="3" rx="1.5"/><rect x="262" y="370" width="52" height="3" rx="1.5"/><rect x="272" y="380" width="32" height="3" rx="1.5"/></g>' +
      hull(14, -10, '#24100a') +
      '<path d="M252 334H488V342H252Z" fill="#8a5a2e"/>' +
      '<path d="M282 334L302 312H350L370 334Z" fill="#c99a5a"/><path d="M292 334V318M306 334V314M320 334V314M334 334V314M348 334V316" stroke="#8a5a2e" stroke-width="2"/>' +
      '<path d="M392 340V58" stroke="#3a1c0c" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M392 330L258 94Q376 126 506 52Z" fill="' + lin('sail', [[0, '#fff1d0'], [1, '#e0a868']]) + '"/>' +
      '<g stroke="#c98a4a" stroke-width="2" opacity=".7"><path d="M392 330L304 108M392 330L348 116M392 330L398 108M392 330L446 90M392 330L478 70"/></g>' +
      '<path d="M386 168a6 6 0 1 1 12 0a14 14 0 1 1-28 0a22 22 0 1 1 44 0a30 30 0 1 1-60 0" fill="none" stroke="#b0563a" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M392 330L258 94M392 330L506 52" stroke="#5a2e14" stroke-width="7" stroke-linecap="round"/>' +
      hull(0, 0, lin('wood', [[0, '#8a4a22'], [1, '#2e160c']])) +
      '<path d="M222 340C232 352 244 356 262 356H470" stroke="#ffd9a0" stroke-width="2" opacity=".5" fill="none"/>' +
      ground('M0 440V384C60 374 120 392 180 384S300 374 360 386 460 376 520 382V440Z', '#062544') +
      '<path d="M40 400c20-6 40 6 60 0s40-6 60 0M220 404c20-6 40 6 60 0s40-6 60 0M400 398c20-6 40 6 60 0" fill="none" stroke="#7ff0e6" stroke-width="2" opacity=".6"/>' +
      sparkle(476, 150, 9) + sparkle(250, 60, 7);
  },

  // A lion seated at the tip of the jutting rock, its mane against a great rising sun.
  'Simba': () => {
    const r = rng(311);
    const tuft = (deg, len, w) => {
      const a = (deg * Math.PI) / 180;
      const [dx, dy] = [Math.cos(a), Math.sin(a)];
      const [bx, by] = [-16 + dx * 30, -110 + dy * 30];
      return '<path d="M' + n(bx - dy * w) + ' ' + n(by + dx * w) +
        'Q' + n(bx + dx * len * 0.6 - dy * w * 0.9) + ' ' + n(by + dy * len * 0.6 + dx * w * 0.9) + ' ' + n(bx + dx * len) + ' ' + n(by + dy * len + 4) +
        'Q' + n(bx + dx * len * 0.55 + dy * w * 0.7) + ' ' + n(by + dy * len * 0.55 - dx * w * 0.7) + ' ' + n(bx + dy * w) + ' ' + n(by - dx * w) + 'Z"/>';
    };
    let mane = '<circle cx="-16" cy="-110" r="40"/>';
    for (let i = 0; i < 22; i++) {
      const deg = -140 + i * 13 + (r() - 0.5) * 6;
      mane += tuft(deg, 18 + r() * 10 + (deg > 60 ? 12 : 0), 12 + r() * 4);
    }
    return tint('#ffb24a', '#7a2e7a', 0.55) +
      '<g fill="' + lin('rays', [[0, '#ffe7a0', 0.8], [1, '#ffb24a', 0]]) + '">' +
        [-64, -40, -16, 8, 32, 56].map(a => '<path d="M400 200L384 40L416 40Z" transform="rotate(' + a + ' 400 200)"/>').join('') + '</g>' +
      glow('sun', 400, 200, 190, '#ffd27a', 0.85) +
      '<circle cx="400" cy="200" r="104" fill="' + lin('disc', [[0, '#fff1b8'], [0.6, '#ffb54d'], [1, '#ff7a3d']]) + '"/>' +
      '<g fill="#7a2e7a" opacity=".3"><rect x="290" y="236" width="220" height="6"/><rect x="290" y="254" width="220" height="8"/><rect x="290" y="274" width="220" height="10"/></g>' +
      '<g fill="none" stroke="#2b0d2f" stroke-width="2.4" stroke-linecap="round"><path d="M250 90q8-6 16 0q8-6 16 0"/><path d="M300 60q6-5 12 0q6-5 12 0"/><path d="M482 100q6-5 12 0q6-5 12 0"/></g>' +
      '<g fill="#2b0d2f"><path d="M0 440V372C80 364 200 376 300 368S420 356 520 362V440Z"/>' +
        '<path d="M520 300H360C344 302 330 308 322 316L304 320C300 324 304 328 312 328L360 334L520 346Z"/><path d="M400 336L430 372H520V340Z"/>' +
        '<path d="M206 372V318" stroke="#2b0d2f" stroke-width="5"/><path d="M206 318C184 316 168 306 158 296C184 300 198 296 206 292C214 296 230 300 256 296C246 306 230 316 206 318Z"/>' +
        '<path d="M300 372l4-14 3 14M318 370l3-12 3 12M150 374l4-14 3 14" stroke="#2b0d2f" stroke-width="2"/>' +
        '<g transform="translate(446 300) scale(.95)">' +
          '<path d="M64 -4C84 0 96 -6 100 -18" fill="none" stroke="#2b0d2f" stroke-width="5" stroke-linecap="round"/><ellipse cx="101" cy="-23" rx="5" ry="8" transform="rotate(20 101 -23)"/>' +
          '<path d="M-58 0C-60 -5 -56 -9 -48 -9H-44C-42 -30 -40 -52 -42 -70C-42 -80 -38 -90 -30 -96L10 -100C30 -90 44 -74 56 -58C70 -42 76 -24 72 -10C70 -2 64 0 56 0Z"/>' +
          '<ellipse cx="-12" cy="-4" rx="18" ry="5"/>' + mane +
          '<circle cx="-34" cy="-142" r="7"/>' +
          '<path d="M-28 -142C-44 -146 -58 -138 -64 -128L-72 -120C-77 -114 -75 -105 -68 -101C-62 -97 -52 -95 -42 -97C-32 -99 -26 -108 -26 -120Z"/></g></g>' +
      '<path d="M360 300H520" stroke="#ffd27a" stroke-width="2" opacity=".5"/>' + sparkle(270, 150, 9);
  },

  // A tower with a long golden braid falling from its window, lanterns rising around it.
  'Rapunzel': () => {
    const lanFill = lin('lan', [[0, '#fff3c4'], [1, '#ff9a3c']]);
    const lanGlow = rad('lglow', [[0, '#ffd27a', 0.55], [0.45, '#ffd27a', 0.22], [1, '#ffd27a', 0]]);
    const lantern = (x, y, s) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(s * 3.4) + '" fill="' + lanGlow + '"/>' +
      '<path d="M' + (x - s) + ' ' + (y - s * 1.2) + 'h' + 2 * s + 'l' + n(s * 0.3) + ' ' + n(s * 2.2) + 'h' + n(-s * 2.6) + 'z" fill="' + lanFill + '"/>';
    const spots = [[290, 70, 9], [346, 40, 7], [250, 140, 7], [322, 160, 11], [214, 60, 5], [300, 236, 6], [504, 240, 6], [508, 96, 8], [370, 110, 6], [240, 260, 5], [512, 170, 5]];
    const segs = [[[438, 166], [410, 180], [392, 214], [404, 250]], [[404, 250], [416, 290], [380, 316], [352, 340]], [[352, 340], [324, 364], [300, 396], [262, 424]]];
    const hair = 'M438 166C410 180 392 214 404 250C416 290 380 316 352 340C324 364 300 396 262 424C252 432 240 438 228 446';
    const blooms = [];
    segs.forEach(s => [0.25, 0.7].forEach(t => blooms.push(bez(...s, t))));
    const flower = ([x, y], i) => '<g fill="' + ['#ff8ab8', '#c49bff', '#fff'][i % 3] + '">' +
      [[0, -5], [5, -1], [3, 5], [-3, 5], [-5, -1]].map(([dx, dy]) => '<circle cx="' + n(x + dx) + '" cy="' + n(y + dy) + '" r="3.4"/>').join('') +
      '</g><circle cx="' + x + '" cy="' + y + '" r="2.4" fill="#ffd23c"/>';
    return tint('#2b2d7a', '#c4508f', 0.55) + stars(31, 40, 120, W, 0, 200) +
      spots.map(([x, y, s]) => lantern(x, y, s)).join('') +
      '<rect x="0" y="396" width="520" height="44" fill="' + lin('lake', [[0, '#3b2a7a', 0.9], [1, '#1c0f3a', 1]]) + '"/>' +
      spots.filter(([x, , s]) => s > 6 && x < 380).map(([x, , s]) => '<rect x="' + (x - 2) + '" y="' + (402 + s) + '" width="4" height="' + s * 2 + '" fill="#ffd27a" opacity=".45"/>').join('') +
      '<path d="M372 440L384 396C394 384 416 380 440 382L520 376V440Z" fill="#1c0f3a"/>' +
      '<path d="M414 388V150H474V388Z" fill="' + lin('stone', [[0, '#6a5aaa'], [1, '#2a1a5a']], 0, 0, 1, 0) + '"/>' +
      '<g stroke="#1c0f3a" stroke-width="2" opacity=".5"><path d="M414 210H474M414 260H474M414 310H474M414 360H474M440 210V260M456 260V310M432 310V360M452 360V388M428 150V210"/></g>' +
      '<path d="M400 156L444 38L488 156Z" fill="' + lin('roof', [[0, '#d07ad8'], [1, '#6a2a8a']]) + '"/>' +
      '<path d="M400 156H488" stroke="#1c0f3a" stroke-width="4"/><path d="M444 38V16" stroke="#1c0f3a" stroke-width="3"/><path d="M444 16L466 22L444 28Z" fill="#ff8ab8"/>' +
      glow('win', 444, 178, 40, '#ffd27a', 0.6) + '<path d="M430 192V174A14 14 0 0 1 458 174V192Z" fill="#ffe3a0" stroke="#1c0f3a" stroke-width="3"/>' +
      '<path d="' + hair + '" fill="none" stroke="#b07818" stroke-width="22" stroke-linecap="round"/>' +
      '<path d="' + hair + '" fill="none" stroke="' + lin('hair', [[0, '#fff0a0'], [1, '#f0b030']]) + '" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="' + hair + '" fill="none" stroke="#c98a1f" stroke-width="4" stroke-dasharray="10 9" stroke-linecap="round"/>' +
      '<path d="M438 166C424 172 414 184 410 196" fill="none" stroke="#fff8d0" stroke-width="4" stroke-linecap="round" opacity=".8"/>' +
      blooms.map(flower).join('') + sparkle(480, 290, 8);
  },

  // A rabbit officer on a rooftop at dusk, rim-lit red and blue, looking out over a city of many climates.
  'Judy Hopps': () => {
    const bunny = 'M-26 0C-30 -6 -22 -8 -10 -8H10C16 -8 16 0 10 0Z' +
      'M-12 -8C-16 -30 -18 -60 -14 -84C-10 -96 6 -98 14 -88C20 -70 20 -40 16 -20C14 -12 12 -8 10 -8Z' +
      'M-4 -86C-14 -78 -20 -66 -20 -56C-18 -52 -14 -54 -14 -58C-12 -66 -6 -74 2 -80Z' +
      'M-4 -96C-16 -96 -26 -104 -28 -114C-30 -122 -24 -130 -14 -134C-2 -138 10 -132 14 -122C16 -112 10 -100 -4 -96Z' +
      'M-6 -132C-12 -160 -10 -186 -2 -200C6 -184 6 -158 4 -132Z' +
      'M4 -130C6 -156 14 -180 26 -192C28 -172 20 -150 12 -128Z' +
      'M14 -36A8 8 0 1 0 30 -36A8 8 0 1 0 14 -36Z';
    return tint('#5ac8d8', '#ff6fa8', 0.55) + stars(41, 16, 120, W, 0, 90) +
      glow('sun', 330, 310, 200, '#ffd9a0', 0.75) + '<circle cx="330" cy="318" r="50" fill="#ffe7b8" opacity=".9"/>' +
      skyline(43, 130, W, 372, 50, 170, '#7a5aa8', '#ffe9a6') +
      '<g fill="#5a3a8a"><path d="M300 372V130L308 104L316 130V372Z"/><path d="M286 372V180H330V372Z"/></g>' +
      '<circle cx="308" cy="100" r="4" fill="#ff6f7f"/>' + glow('beacon', 308, 100, 16, '#ff6f7f', 0.7) +
      '<path d="M170 372A64 64 0 0 1 298 372Z" fill="' + lin('dome', [[0, '#d8f4ff', 0.85], [1, '#7fb8e8', 0.6]]) + '" stroke="#fff" stroke-width="2"/>' +
      '<path d="M234 308V372M200 318C214 340 220 356 222 372M268 318C254 340 248 356 246 372M178 346H290" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7"/>' +
      '<g fill="#2a5a4a"><ellipse cx="500" cy="300" rx="40" ry="34"/><ellipse cx="470" cy="320" rx="30" ry="24"/><rect x="496" y="320" width="8" height="52"/></g>' +
      skyline(44, 130, W, 400, 20, 60, '#3a2266', '#ffd27a') +
      ground('M0 440V400H340V378H520V440Z', '#1a1035') +
      '<path d="M340 378H520" stroke="#ffb0c8" stroke-width="2" opacity=".6"/>' +
      glow('red', 360, 330, 90, '#ff4d6d', 0.55) + glow('blue', 500, 330, 90, '#4da3ff', 0.55) +
      '<g transform="translate(430 378) scale(1.02)">' +
        '<path d="' + bunny + '" fill="none" stroke="' + lin('rim', [[0, '#ff6f8a'], [1, '#6fb8ff']], 0, 0, 1, 0) + '" stroke-width="6" stroke-linejoin="round"/>' +
        '<path d="' + bunny + '" fill="#1a1035"/>' +
        '<path d="M-1 -136C-5 -160 -4 -180 -1 -192" stroke="#ffb0c8" stroke-width="3" fill="none" opacity=".4" stroke-linecap="round"/>' +
        '<circle cx="-17" cy="-118" r="2.6" fill="#b48cff"/><circle cx="-28" cy="-113" r="2" fill="#ffb0c8"/>' +
        '<path d="M-8 -74l6 2.6v5c0 4.4-2.6 7-6 8.6c-3.4-1.6-6-4.2-6-8.6v-5z" fill="#ffd23c"/></g>' +
      sparkle(416, 300, 7) + sparkle(470, 70, 11) + sparkle(260, 120, 7);
  },

  // A fox sitting on a rooftop ledge under the moon, tie loose, one sly green eye, the city's neon below.
  'Nick Wilde': () => {
    const fox = 'M-62 -112C-56 -116 -48 -120 -42 -126L-38 -162L-26 -136L-12 -162L-8 -126C-4 -120 -2 -110 0 -100C10 -80 30 -60 38 -36C44 -18 42 -6 36 0H-44C-48 0 -48 -6 -42 -6L-36 -8C-36 -30 -38 -54 -36 -72C-36 -82 -38 -92 -44 -98L-50 -102C-54 -104 -58 -108 -62 -112Z' +
      'M30 -2C20 8 -20 8 -50 4C-66 2 -76 -6 -78 -14C-70 -10 -56 -10 -44 -12C-20 -14 10 -16 30 -18Z';
    return tint('#2a2a8f', '#c4508f', 0.6) + stars(51, 34, 120, W, 0, 200) +
      glow('moon', 400, 214, 150, '#ffe9c4', 0.55) +
      '<circle cx="400" cy="214" r="80" fill="' + rad('mface', [[0, '#fffaf0'], [1, '#ffd9a8']], 0.4, 0.35) + '"/>' +
      '<g fill="#e8c8a0" opacity=".45"><circle cx="372" cy="190" r="10"/><circle cx="430" cy="240" r="7"/><circle cx="420" cy="180" r="4"/></g>' +
      skyline(52, 130, W, 440, 40, 150, '#1a1035', '#7ff0e6') +
      '<g fill="none" stroke-width="3"><rect x="160" y="300" width="70" height="18" rx="9" stroke="#ff6fb5"/><rect x="240" y="276" width="44" height="14" rx="7" stroke="#7ff0e6"/><path d="M180 260h30" stroke="#ffe36e"/></g>' +
      glow('neon', 200, 300, 60, '#ff6fb5', 0.4) +
      ground('M0 440V400H330V380H520V440Z', '#120a24') +
      '<path d="M330 380H520" stroke="#ff9a5c" stroke-width="2" opacity=".6"/>' +
      '<g transform="translate(432 380) scale(1.15)">' +
        '<path d="' + fox + '" fill="none" stroke="#ff9a5c" stroke-width="4" stroke-linejoin="round" stroke-opacity=".9"/>' +
        '<path d="' + fox + '" fill="#140a28"/>' +
        '<path d="M-78 -14C-76 -6 -66 2 -54 4C-58 -2 -60 -8 -60 -11C-68 -10 -74 -11 -78 -14Z" fill="#fff1e0"/>' +
        '<path d="M-36 -146L-30 -134L-38 -130ZM-14 -146L-20 -134L-12 -130Z" fill="#ff9a5c" opacity=".55"/>' +
        '<path d="M-42 -98L-36 -96L-37 -74L-40 -68L-44 -74Z" fill="#4a6aff"/><path d="M-43 -90l6-2M-43 -80l6-2" stroke="#ffd27a" stroke-width="2"/>' +
        '<path d="M-50 -120C-47 -124 -41 -124 -38 -121C-41 -118 -47 -118 -50 -120Z" fill="#a8ec8a"/>' +
        '<path d="M-51 -121C-47 -124 -41 -124 -37 -122" stroke="#140a28" stroke-width="1.6" fill="none"/></g>' +
      sparkle(476, 70, 10) + sparkle(270, 120, 7);
  },

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

  // A cowboy boot with its spur, a lasso round it and a sheriff's star, over desert mesas at sundown.
  'Woody': () => {
    const rope = 'transform="rotate(-8 426 204)"';
    return tint('#ffb35c', '#a33d6f', 0.55) + glow('sun', 380, 210, 180, '#ffd27a', 0.7) +
      '<circle cx="380" cy="214" r="70" fill="#ffd98a" opacity=".8"/>' +
      '<g fill="#3a1440" opacity=".5"><path d="M150 372V306L170 296H246L256 306V372ZM456 372V286L472 276H520V372Z"/></g>' +
      '<ellipse cx="426" cy="204" rx="72" ry="17" fill="none" stroke="#a8702a" stroke-width="7" ' + rope + '/>' +
      '<g transform="translate(392 264) scale(1.04)">' +
        '<path d="M-8 -120Q14 -106 33 -122Q52 -106 76 -120L72 30C72 52 78 74 82 96V112H42V102L-62 104C-98 106 -114 96 -108 80C-102 64 -74 58 -44 50C-22 44 -12 30 -10 6Z" fill="' + lin('leather', [[0, '#d48a46'], [1, '#6e3a1a']], 0, 0, 1, 0) + '" stroke="#4a2410" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M42 98H82V112H42Z" fill="#3a1c0c"/><path d="M-104 92C-96 102 -80 104 -62 104H42" fill="none" stroke="#3a1c0c" stroke-width="6" stroke-linecap="round"/>' +
        '<g fill="none" stroke="#ffd98a" stroke-width="2.6" stroke-dasharray="5 4" stroke-linecap="round"><path d="M6 -86C20 -64 46 -64 60 -86M6 -46C20 -24 46 -24 60 -46M12 -8C26 10 46 10 58 -8"/><path d="M-90 82C-70 70 -40 66 -16 58"/></g>' +
        '<path d="M2 -120V-136a8 8 0 0 1 16 0V-118M50 -118V-136a8 8 0 0 1 16 0V-120" fill="none" stroke="#4a2410" stroke-width="4"/>' +
        '<path d="M66 78C80 82 92 84 100 80" fill="none" stroke="#c9d2e6" stroke-width="5" stroke-linecap="round"/>' +
        '<g transform="translate(110 80)"><path d="' + starPath(6, 13, 5) + '" fill="#ffe39a" stroke="#fff" stroke-width="2"/><circle r="3" fill="#b97a1f"/></g></g>' +
      '<path d="M354 204A72 17 0 0 0 498 204" fill="none" stroke="#e7b05a" stroke-width="7" ' + rope + '/>' +
      '<path d="M354 208C340 236 344 270 330 300" fill="none" stroke="#e7b05a" stroke-width="6" stroke-linecap="round"/>' +
      '<g transform="translate(478 78) scale(.42)"><path d="M0 -92L22 -38L80 -46L42 0L80 46L22 38L0 92L-22 38L-80 46L-42 0L-80 -46L-22 -38Z" fill="' + lin('star', [[0, '#fff0b0'], [1, '#e1a12e']]) + '" stroke="#fff" stroke-width="7"/><circle r="26" fill="none" stroke="#b97a1f" stroke-width="7"/></g>' +
      ground('M0 440V376C120 368 260 382 380 374S480 368 520 372V440Z', '#3a1440') +
      '<path d="M226 380V300a10 10 0 0 1 20 0V380ZM226 340H212a8 8 0 0 1-8-8V318a6 6 0 0 1 12 0v10h10ZM246 330h12v-16a6 6 0 0 1 12 0v20a8 8 0 0 1-8 8H246Z" fill="#3a1440"/>' +
      sparkle(270, 90, 8);
  },

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

  // A little boxy robot with binocular eyes, a seedling in its hand, looking up at a green-blue planet.
  'WALL-E': () => {
    const rust = lin('rust', [[0, '#f2c25a'], [1, '#a8642a']]);
    const steel = lin('steel', [[0, '#e0e4f0'], [1, '#7a80a0']]);
    const eye = (x, a) => '<g transform="rotate(' + a + ' ' + x + ' -189)"><rect x="' + (x - 23) + '" y="-207" width="46" height="36" rx="15" fill="' + steel + '" stroke="#3a3550" stroke-width="3"/>' +
      '<circle cx="' + x + '" cy="-189" r="12.5" fill="#1a1430"/><circle cx="' + x + '" cy="-189" r="7" fill="#3a5a9a"/><circle cx="' + (x - 3) + '" cy="-193" r="3" fill="#fff"/></g>';
    return tint('#0f2b4f', '#5a2a7a', 0.6) + stars(81, 70, 120, W, 0, 330) +
      glow('atmo', 448, 100, 116, '#7fd8ff', 0.7) +
      '<circle cx="448" cy="100" r="66" fill="' + rad('earth', [[0, '#8fd0ff'], [0.7, '#2a6ad0'], [1, '#123a8a']], 0.35, 0.35) + '"/>' +
      '<g fill="#6fd08a"><path d="M406 74c14-14 36-10 42 4s-6 22-20 20-28-2-22-24z"/><path d="M458 108c10-10 30-6 32 8s-10 24-24 22-16-18-8-30z"/><path d="M414 128c8-4 18 0 18 8s-12 10-18 4z"/><path d="M468 52c8-6 20-2 20 6s-12 8-20-6z"/></g>' +
      '<g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".75"><path d="M396 96c20-6 40 4 60-2"/><path d="M428 150c16-4 30 2 44-4"/><path d="M466 76c8-2 16 0 22 4"/></g>' +
      '<path d="M448 34A66 66 0 0 1 448 166A40 66 0 0 0 448 34Z" fill="#0a1030" opacity=".4"/>' +
      '<circle cx="448" cy="100" r="66" fill="none" stroke="#bff0ff" stroke-width="3" opacity=".7"/>' +
      '<circle cx="296" cy="64" r="10" fill="#d8d0f0"/><circle cx="292" cy="61" r="3" fill="#b8b0d8"/>' +
      '<g fill="#2a1f4a">' + [[170, 368], [200, 362], [186, 344], [470, 362], [494, 356]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="22" height="20"/>').join('') + '</g>' +
      ground('M0 440V380C120 370 260 384 400 376S490 370 520 372V440Z', '#1c1238') +
      '<g transform="translate(352 386) scale(1.05)">' +
        '<rect x="-88" y="-68" width="38" height="68" rx="16" fill="#3a3550" stroke="#1a1430" stroke-width="3"/><rect x="50" y="-68" width="38" height="68" rx="16" fill="#3a3550" stroke="#1a1430" stroke-width="3"/>' +
        '<g fill="#6a6488"><circle cx="-69" cy="-48" r="7"/><circle cx="-69" cy="-20" r="7"/><circle cx="69" cy="-48" r="7"/><circle cx="69" cy="-20" r="7"/></g>' +
        '<rect x="-54" y="-126" width="108" height="100" rx="5" fill="' + rust + '" stroke="#5a3418" stroke-width="3"/>' +
        '<path d="M-54 -80H54" stroke="#5a3418" stroke-width="3"/>' +
        '<rect x="-42" y="-116" width="34" height="14" rx="3" fill="#2a1a30"/><rect x="-38" y="-112" width="16" height="6" fill="#8ff0a0"/>' +
        '<g fill="#5a3418"><rect x="10" y="-116" width="34" height="3"/><rect x="10" y="-109" width="34" height="3"/><rect x="10" y="-102" width="34" height="3"/></g>' +
        '<path d="M-30 -60l6 18M24 -66l-4 14" stroke="#8a5420" stroke-width="3" stroke-linecap="round" opacity=".6"/>' +
        '<path d="M-54 -98H-78V-86H-54Z" fill="' + steel + '"/><path d="M-78 -100h-10v6h8v4h-8v6h10Z" fill="#c9cfe0"/>' +
        '<path d="M54 -98H80V-86H54Z" fill="' + steel + '"/>' +
        '<path d="M78 -94H98L94 -80H82Z" fill="#c9a07a"/><path d="M88 -94V-114" stroke="#3f8f4a" stroke-width="3"/>' +
        '<path d="M88 -108C88 -120 78 -126 68 -124C68 -114 76 -108 88 -108Z" fill="#6fe08a"/><path d="M88 -114C88 -126 98 -132 108 -130C108 -120 100 -114 88 -114Z" fill="#8ff0a0"/>' +
        '<rect x="-5" y="-172" width="10" height="48" fill="' + steel + '"/><circle cx="0" cy="-150" r="5" fill="#6a7090"/>' +
        '<rect x="-8" y="-195" width="16" height="10" fill="#7a80a0"/>' + eye(-27, -10) + eye(27, 10) + '</g>' +
      sparkle(262, 130, 8) + glow('plant', 444, 268, 30, '#8ff0a0', 0.5);
  },

  // A copper pot on the flame in a tiled kitchen, a little chef peeking over its rim, utensils on the rail.
  'Remy': () => {
    let tiles = '';
    for (let x = 130; x < W; x += 30) tiles += '<path d="M' + x + ' 0V356"/>';
    for (let y = 30; y < 356; y += 30) tiles += '<path d="M120 ' + y + 'H' + W + '"/>';
    const copper = lin('copper', [[0, '#ffb27a'], [0.5, '#d66a3a'], [1, '#8a3a1e']], 0, 0, 1, 0);
    return tint('#ffb35c', '#6a2a5a', 0.55) + '<g stroke="#fff" stroke-width="1.5" opacity=".14">' + tiles + '</g>' +
      glow('g', 370, 230, 180, '#ffe0a6', 0.6) +
      '<rect x="226" y="38" width="294" height="7" rx="3.5" fill="#e9e4ff"/>' +
      '<g fill="none" stroke="#e9e4ff" stroke-width="3"><circle cx="262" cy="50" r="5"/><circle cx="452" cy="50" r="5"/><circle cx="500" cy="50" r="5"/></g>' +
      '<rect x="259" y="54" width="6" height="96" rx="3" fill="#e9e4ff"/><path d="M242 148A20 20 0 0 0 282 148Z" fill="#e9e4ff" stroke="#fff" stroke-width="2"/>' +
      '<rect x="449" y="54" width="6" height="40" rx="3" fill="#5a2e14"/>' +
      '<g fill="none" stroke="#fff" stroke-width="2.6">' + [14, 9, 4].map(w => '<path d="M452 94C' + (452 - w) + ' 110 ' + (452 - w * 1.4) + ' 140 452 156C' + (452 + w * 1.4) + ' 140 ' + (452 + w) + ' 110 452 94"/>').join('') + '</g>' +
      '<rect x="494" y="54" width="12" height="40" rx="4" fill="#5a2e14"/><circle cx="500" cy="66" r="2" fill="#ffd27a"/><circle cx="500" cy="82" r="2" fill="#ffd27a"/>' +
      '<path d="M492 94H508V196C508 206 500 212 492 206Z" fill="' + lin('blade', [[0, '#ffffff'], [1, '#aab4d0']], 0, 0, 1, 0) + '" stroke="#fff" stroke-width="2"/>' +
      '<path d="M330 196c-12-24 12-34 0-58M370 190c-12-24 12-34 0-58M410 196c-12-24 12-34 0-58" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".55"/>' +
      '<path d="M318 232L290 150" stroke="#7a4a22" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="M282 250H264C256 250 256 266 264 266H282M458 250H476C484 250 484 266 476 266H458" fill="none" stroke="#8a3a1e" stroke-width="7"/>' +
      '<path d="M282 236H458V306C458 322 444 332 426 332H314C296 332 282 322 282 306Z" fill="' + copper + '"/>' +
      '<path d="M300 252V316" stroke="#fff" stroke-width="8" opacity=".35" stroke-linecap="round"/>' +
      '<ellipse cx="370" cy="236" rx="92" ry="15" fill="#ffc29a" stroke="#8a3a1e" stroke-width="3"/>' +
      '<ellipse cx="370" cy="237" rx="80" ry="9" fill="#c4502a"/><g fill="#ffb27a"><circle cx="350" cy="236" r="3"/><circle cx="392" cy="238" r="2.4"/></g>' +
      '<g transform="translate(434 210) scale(1.35)">' +
        '<path d="M14 6C30 10 34 26 24 40" stroke="#c48aa0" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="2" cy="2" rx="16" ry="12" fill="#8a8aa6"/><circle cx="-8" cy="-20" r="7" fill="#8a8aa6"/><circle cx="-8" cy="-20" r="4" fill="#ffb0c8"/>' +
        '<circle cx="-14" cy="-10" r="10" fill="#9a9ab6"/><path d="M-20 -15L-34 -7L-20 -3Z" fill="#9a9ab6"/><circle cx="-34" cy="-7" r="2.4" fill="#ff8ab8"/><circle cx="-18" cy="-12" r="1.8" fill="#1a1430"/>' +
        '<path d="M-23 -26H-5V-21H-23Z" fill="#fff"/><ellipse cx="-14" cy="-33" rx="12" ry="9" fill="#fff"/>' +
        '<ellipse cx="-14" cy="12" rx="4" ry="3" fill="#ffb0c8"/><ellipse cx="0" cy="13" rx="4" ry="3" fill="#ffb0c8"/></g>' +
      '<g fill="#7fb8ff">' + [300, 330, 360, 390, 420, 450].map(x => '<path d="M' + x + ' 352C' + (x - 7) + ' 344 ' + (x - 3) + ' 336 ' + x + ' 330C' + (x + 3) + ' 336 ' + (x + 7) + ' 344 ' + x + ' 352Z"/>').join('') + '</g>' +
      ground('M0 440V352H520V440Z', '#1c0f3a') + '<path d="M270 352H480" stroke="#4a3a6a" stroke-width="4"/>' +
      '<g fill="#3a2a5a" stroke="#6a5a8a" stroke-width="2"><circle cx="300" cy="396" r="10"/><circle cx="350" cy="396" r="10"/><circle cx="400" cy="396" r="10"/><circle cx="450" cy="396" r="10"/></g>' +
      sparkle(220, 100, 9);
  },

  // A glowing golden memory over shelves of coloured ones, above the curve of the control desk.
  'Joy': () => {
    const cols = ['#ffe36e', '#7fd8ff', '#ff6f7f', '#8ff0a0', '#c49bff'];
    const r = rng(231);
    let shelves = '';
    for (const [y, x0] of [[56, 236], [108, 220], [160, 420], [212, 430]]) {
      shelves += '<rect x="' + x0 + '" y="' + (y + 14) + '" width="' + (W - x0) + '" height="4" fill="#fff" opacity=".4"/>';
      for (let x = x0 + 14; x < W; x += 30) {
        const c = cols[Math.floor(r() * cols.length)];
        shelves += '<circle cx="' + x + '" cy="' + y + '" r="11.5" fill="' + c + '" stroke="#fff" stroke-width="1.5"/><circle cx="' + (x - 3) + '" cy="' + (y - 4) + '" r="3.2" fill="#fff" opacity=".75"/>';
      }
    }
    // The desk's top runs along this curve; its buttons are set along it.
    const edge = [[0, 404], [150, 368], [340, 340], [520, 344]];
    let keys = '';
    [0.42, 0.5, 0.58, 0.82, 0.9].forEach((t, i) => {
      const [x, y] = bez(...edge, t);
      const c = cols[i % cols.length];
      keys += '<ellipse cx="' + x + '" cy="' + n(y + 8) + '" rx="16" ry="6.5" fill="' + c + '" opacity=".35"/>' +
        '<ellipse cx="' + x + '" cy="' + n(y + 6) + '" rx="11" ry="4.6" fill="' + c + '" stroke="#fff" stroke-width="1.4"/>';
    });
    [0.46, 0.54, 0.86].forEach(t => {
      const [x, y] = bez(...edge, t);
      keys += '<rect x="' + n(x - 7) + '" y="' + n(y + 14) + '" width="14" height="3" rx="1.5" fill="#fff" opacity=".7"/>';
    });
    const [lx, ly] = bez(...edge, 0.7);
    return tint('#ffd56e', '#7a3aa0', 0.5) + glow('back', 400, 130, 220, '#fff3c4', 0.5) + shelves +
      glow('core', 344, 186, 140, '#fff3a6', 0.95) +
      '<circle cx="344" cy="186" r="64" fill="' + rad('orb', [[0, '#fffbe0'], [0.55, '#ffe36e'], [1, '#f0a020']], 0.4, 0.35) + '" stroke="#fff" stroke-width="5"/>' +
      '<path d="M314 196c8-30 50-34 60-4s-28 32-38 12 12-24 22-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/>' +
      '<path d="M310 158a44 44 0 0 1 30 -22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>' +
      '<path d="M0 404C150 368 340 340 520 344V372C340 368 160 392 0 428Z" fill="' + lin('desktop', [[0, '#f4e8ff'], [1, '#b89ae0']]) + '"/>' +
      '<path d="M0 428C160 392 340 368 520 372V440H0Z" fill="' + lin('deskfront', [[0, '#6a3aa0'], [1, '#2a1050']]) + '"/>' +
      '<path d="M0 404C150 368 340 340 520 344" stroke="#fff" stroke-width="3" fill="none"/>' +
      '<path d="M0 428C160 392 340 368 520 372" stroke="#ffe36e" stroke-width="2" fill="none" opacity=".7"/>' +
      '<ellipse cx="344" cy="356" rx="60" ry="6" fill="#fff3a6" opacity=".5"/>' +
      keys +
      '<ellipse cx="' + lx + '" cy="' + n(ly + 8) + '" rx="16" ry="6" fill="#3a2a5a"/>' +
      '<path d="M' + lx + ' ' + n(ly + 6) + 'L' + n(lx - 10) + ' ' + n(ly - 40) + '" stroke="#e9e4ff" stroke-width="6" stroke-linecap="round"/>' +
      glow('knob', n(lx - 10), n(ly - 44), 26, '#ff6f7f', 0.7) +
      '<circle cx="' + n(lx - 10) + '" cy="' + n(ly - 44) + '" r="11" fill="' + rad('knobf', [[0, '#ffb0b8'], [1, '#e8344a']], 0.4, 0.35) + '" stroke="#fff" stroke-width="2.4"/>' +
      '<g fill="#e9d6ff" opacity=".55"><rect x="250" y="408" width="70" height="5" rx="2.5"/><rect x="360" y="400" width="110" height="5" rx="2.5"/></g>' +
      '<g fill="#ffe36e"><circle cx="276" cy="410.5" r="4.5"/><circle cx="430" cy="402.5" r="4.5"/></g>' +
      sparkle(250, 220, 10) + sparkle(480, 280, 9) + sparkle(420, 250, 6);
  },

  // A red and gold armoured robot flying up over the city, thrusters blazing.
  'Iron Man': () => {
    const red = lin('armour', [[0, '#ff6a52'], [1, '#9a1020']], 0, 0, 1, 0);
    const gold = lin('gold', [[0, '#ffe9a6'], [1, '#d4922c']]);
    const thrust = lin('thrust', [[0, '#ffffff'], [0.25, '#fff3b0'], [0.6, '#ff9a3c', 0.75], [1, '#ff4d3d', 0]]);
    const flame = (x, y, w, len) => '<path d="M' + (x - w) + ' ' + y + 'C' + (x - w) + ' ' + (y + len * 0.5) + ' ' + (x - w / 3) + ' ' + (y + len * 0.8) + ' ' + x + ' ' + (y + len) + 'C' + (x + w / 3) + ' ' + (y + len * 0.8) + ' ' + (x + w) + ' ' + (y + len * 0.5) + ' ' + (x + w) + ' ' + y + 'Z" fill="' + thrust + '"/>';
    let streaks = '';
    const s = rng(103);
    for (let i = 0; i < 9; i++) {
      const x = n(170 + s() * 300);
      const y = n(120 + s() * 260);
      const l = n(30 + s() * 60);
      streaks += '<path d="M' + x + ' ' + y + 'l' + n(-l * 0.53) + ' ' + n(l * 0.85) + '"/>';
    }
    return tint('#ff7a4a', '#3a1a5a', 0.55) + stars(101, 20, 120, W, 0, 160) +
      '<g stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".3">' + streaks + '</g>' +
      '<path d="M200 430C250 360 290 300 340 250" stroke="#fff" stroke-width="20" stroke-linecap="round" fill="none" opacity=".12"/>' +
      glow('g', 410, 170, 170, '#ffd27a', 0.7) +
      skyline(104, 130, W, 440, 40, 130, '#2a0e2e', '#ffd27a') +
      '<g transform="translate(392 214) rotate(32) scale(1.1)">' +
        flame(-47, -30, 7, 46) + flame(47, -30, 7, 46) + flame(-13, 50, 10, 120) + flame(13, 50, 10, 120) +
        '<path d="M-24 -30H-4L-6 50H-21ZM4 -30H24L21 50H6Z" fill="' + red + '"/>' +
        '<path d="M-22 6H-5L-6 32H-21ZM5 6H22L21 32H6Z" fill="' + gold + '"/>' +
        '<path d="M-27 -58H27L23 -30H-23Z" fill="' + gold + '"/>' +
        '<path d="M-50 -114L-32 -112L-40 -52L-54 -54ZM50 -114L32 -112L40 -52L54 -54Z" fill="' + red + '"/>' +
        '<path d="M-54 -56L-40 -54L-42 -30H-55ZM54 -56L40 -54L42 -30H55Z" fill="' + gold + '"/>' +
        '<path d="M-36 -118C-30 -126 30 -126 36 -118L30 -62C24 -52 -24 -52 -30 -62Z" fill="' + red + '"/>' +
        '<path d="M-22 -80H22M-18 -70H18" stroke="#7a0a18" stroke-width="2"/>' +
        '<circle cx="-40" cy="-112" r="12" fill="' + red + '"/><circle cx="40" cy="-112" r="12" fill="' + red + '"/>' +
        glow('arc', 0, -98, 26, '#bff4ff', 0.9) + '<circle cx="0" cy="-98" r="9" fill="#e8fbff" stroke="#7fd8ff" stroke-width="2"/>' +
        '<path d="M-8 -126h16v8h-16z" fill="#5a0a18"/>' +
        '<path d="M-22 -146C-22 -172 22 -172 22 -146L20 -128C14 -120 -14 -120 -20 -128Z" fill="' + red + '"/>' +
        '<path d="M-15 -152H15L13 -132C8 -126 -8 -126 -13 -132Z" fill="' + gold + '"/>' +
        '<path d="M-12 -146H-3L-4 -142H-11ZM12 -146H3L4 -142H11Z" fill="#e8fbff"/>' +
        '<path d="M-28 -116C-20 -120 -8 -122 0 -122" stroke="#fff" stroke-width="2.4" fill="none" opacity=".6" stroke-linecap="round"/></g>' +
      sparkle(270, 90, 10) + sparkle(486, 300, 8);
  },

  // A round star shield flying out of a waving flag, glinting as it spins.
  'Captain America': () => {
    let stripes = '';
    for (let i = 0; i < 7; i++) {
      const y = i * 46 + 6;
      stripes += '<path d="M120 ' + y + 'C220 ' + (y - 18) + ' 320 ' + (y + 22) + ' 520 ' + (y - 6) + 'v22C320 ' + (y + 44) + ' 220 ' + (y + 4) + ' 120 ' + (y + 22) + 'Z"/>';
    }
    return tint('#2b4bd0', '#c43050', 0.5) +
      '<g fill="#fff" opacity=".09">' + stripes + '</g>' + stars(111, 40, 120, W, 0, 260) +
      '<g fill="#fff" opacity=".18">' + [-56, -34, -12, 10, 32, 54].map(a => '<path d="M380 170L362 -40H398Z" transform="rotate(' + a + ' 380 170)"/>').join('') + '</g>' +
      glow('g', 380, 170, 190, '#ffffff', 0.55) +
      '<g fill="none" stroke-linecap="round"><path d="M150 230C200 214 240 210 276 214" stroke="#fff" stroke-width="12" opacity=".3"/><path d="M170 270C210 252 240 246 270 246" stroke="#fff" stroke-width="7" opacity=".25"/><path d="M190 190C220 180 246 178 266 180" stroke="#fff" stroke-width="5" opacity=".25"/></g>' +
      '<g transform="translate(382 172) rotate(-14)">' +
        '<circle r="124" fill="' + lin('red', [[0, '#ff7080'], [1, '#a8142c']]) + '"/>' +
        '<circle r="100" fill="' + lin('silver', [[0, '#ffffff'], [1, '#b8c2dc']]) + '"/>' +
        '<circle r="76" fill="' + lin('red2', [[0, '#ff6a7a'], [1, '#b0182f']]) + '"/>' +
        '<circle r="54" fill="' + rad('blue', [[0, '#6a8aff'], [1, '#1a2a8a']], 0.4, 0.35) + '"/>' +
        '<path d="' + starPath(5, 50, 20) + '" fill="#fff" stroke="#dfe6ff" stroke-width="2"/>' +
        '<circle r="124" fill="none" stroke="#fff" stroke-width="5"/>' +
        '<path d="M-100 -66A120 120 0 0 1 30 -118" stroke="#fff" stroke-width="7" fill="none" opacity=".6" stroke-linecap="round"/>' +
        '<path d="M-60 -32A70 70 0 0 1 10 -70" stroke="#fff" stroke-width="5" fill="none" opacity=".45" stroke-linecap="round"/>' +
        '<path d="M110 50A120 120 0 0 1 40 112" stroke="#5a0a18" stroke-width="6" fill="none" opacity=".35" stroke-linecap="round"/></g>' +
      sparkle(300, 76, 14) + sparkle(480, 254, 10) +
      skyline(112, 130, W, 440, 30, 100, '#1a1240', '#ffe9a6') + sparkle(250, 140, 7);
  },

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

  // A panther's face, fierce and still, traced in silver and lit violet in front of the moon.
  'Black Panther': () => {
    const leaf = (x, y, h, a) => '<path d="M' + x + ' ' + y + 'C' + (x - 30) + ' ' + (y - h * 0.6) + ' ' + (x - 10) + ' ' + (y - h) + ' ' + x + ' ' + (y - h) + 'C' + (x + 10) + ' ' + (y - h) + ' ' + (x + 30) + ' ' + (y - h * 0.6) + ' ' + x + ' ' + y + 'Z" transform="rotate(' + a + ' ' + x + ' ' + y + ')"/>';
    const head = 'M-70 -78C-82 -96 -96 -98 -100 -84C-104 -70 -96 -56 -88 -50C-96 -30 -100 -6 -94 16C-88 40 -60 66 -30 80C-18 88 18 88 30 80C60 66 88 40 94 16C100 -6 96 -30 88 -50C96 -56 104 -70 100 -84C96 -98 82 -96 70 -78C46 -92 -46 -92 -70 -78Z';
    const eye = s => '<path d="M' + (-64 * s) + ' -14C' + (-52 * s) + ' -30 ' + (-30 * s) + ' -30 ' + (-16 * s) + ' -12C' + (-32 * s) + ' -6 ' + (-52 * s) + ' -4 ' + (-64 * s) + ' -14Z" fill="' + eyeFill + '"/>' +
      '<ellipse cx="' + (-38 * s) + '" cy="-14" rx="3" ry="8" fill="#140826"/>';
    const eyeFill = lin('eye', [[0, '#fff3a0'], [1, '#ffb83c']]);
    return tint('#2a1a5a', '#8a2ab0', 0.6) + stars(141, 40, 120, W, 0, 260) +
      glow('mglow', 380, 170, 190, '#d7a6ff', 0.6) + '<circle cx="380" cy="170" r="118" fill="' + lin('mdisc', [[0, '#f3e4ff'], [1, '#a77cf0']]) + '"/>' +
      '<g fill="#c9a6ff" opacity=".35"><circle cx="330" cy="110" r="14"/><circle cx="450" cy="220" r="10"/><circle cx="440" cy="100" r="6"/></g>' +
      '<g fill="#140826">' + [[160, 440, 80, -30], [220, 440, 110, -10], [500, 440, 130, 24], [520, 380, 90, 40], [460, 440, 80, 10], [300, 440, 70, 16]].map(([x, y, h, a]) => leaf(x, y, h, a)).join('') + '</g>' +
      ground('M0 440V404C120 394 260 410 380 400S490 394 520 398V440Z', '#140826') +
      '<g transform="translate(380 186) scale(1.06)">' +
        '<path d="M-60 96C-30 118 30 118 60 96" fill="none" stroke="#e9e4ff" stroke-width="3"/>' +
        '<g fill="#e9e4ff">' + [-48, -28, -8, 12, 32].map(x => '<path d="M' + (x - 2) + ' ' + n(104 + (Math.abs(x + 2) < 20 ? 6 : 2)) + 'l6 0l-3 14z"/>').join('') + '</g>' +
        '<path d="' + head + '" fill="' + rad('fur', [[0, '#2e1c50'], [1, '#08040f']], 0.5, 0.4) + '" stroke="#c9a6ff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-92 -80C-92 -72 -88 -64 -82 -60L-72 -74ZM92 -80C92 -72 88 -64 82 -60L72 -74Z" fill="#5a3a8a"/>' +
        '<g fill="none" stroke="#c9b8ff" stroke-width="2" stroke-linecap="round" opacity=".85">' +
          '<path d="M-16 -12C-12 -40 -10 -58 -8 -78M16 -12C12 -40 10 -58 8 -78"/>' +
          '<path d="M-8 -40L-12 20M8 -40L12 20"/>' +
          '<path d="M-84 -40L-60 -2L-40 40M84 -40L60 -2L40 40"/>' +
          '<path d="M-70 -64L-36 -40L-16 -12M70 -64L36 -40L16 -12"/>' +
          '<path d="M-90 10L-56 30L-30 64M90 10L56 30L30 64"/></g>' +
        eye(1) + eye(-1) +
        '<path d="M-16 22H16L0 40Z" fill="#c9a6ff"/>' +
        '<path d="M0 40V52M0 52C-10 62-24 62-32 54M0 52C10 62 24 62 32 54" fill="none" stroke="#c9a6ff" stroke-width="2.4" stroke-linecap="round"/>' +
        '<g fill="#c9a6ff" opacity=".7"><circle cx="-24" cy="46" r="1.8"/><circle cx="-32" cy="42" r="1.8"/><circle cx="-28" cy="52" r="1.8"/><circle cx="24" cy="46" r="1.8"/><circle cx="32" cy="42" r="1.8"/><circle cx="28" cy="52" r="1.8"/></g></g>' +
      glow('eyes', 380, 172, 90, '#ffd27a', 0.18) +
      sparkle(490, 60, 10) + sparkle(264, 96, 8);
  },

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

  // A golden headband with a faceted red star, before a sword and a glowing lasso, over a cliffside temple at sunset.
  'Wonder Woman': () => {
    const gold = lin('gold', [[0, '#fff6c4'], [0.5, '#f0c050'], [1, '#b8781e']]);
    let ruby = '';
    for (let i = 0; i < 10; i++) {
      const p = j => {
        const a = ((j % 10) * 36 - 90) * Math.PI / 180;
        const rr = j % 2 ? 9 : 23;
        return n(rr * Math.cos(a)) + ' ' + n(rr * Math.sin(a));
      };
      ruby += '<path d="M0 0L' + p(i) + 'L' + p(i + 1) + 'Z" fill="' + (i % 2 ? '#ff7a84' : '#b0142c') + '"/>';
    }
    return tint('#ffb84a', '#a3203a', 0.55) + stars(161, 24, 120, W, 0, 150) +
      '<g fill="#fff3c4" opacity=".22">' + [-60, -36, -12, 12, 36, 60].map(a => '<path d="M380 176L364 -40H396Z" transform="rotate(' + a + ' 380 176)"/>').join('') + '</g>' +
      glow('g', 380, 180, 200, '#ffe39a', 0.85) +
      '<path d="M0 440V380C120 372 260 386 380 380S490 376 520 378V440Z" fill="' + lin('sea', [[0, '#ff9a6a', 0.7], [1, '#5a1a3a']]) + '"/>' +
      '<g fill="#3a0f2a"><path d="M300 440L322 410H520V440Z"/><path d="M318 410H520V404H326ZM326 404H520V398H334Z"/>' +
        [342, 372, 402, 432, 462, 492].map(x => '<rect x="' + x + '" y="348" width="13" height="50"/>').join('') +
        '<path d="M330 338H520V348H330Z"/><path d="M322 338L428 310L534 338Z"/></g>' +
      '<g transform="translate(380 180) rotate(40)">' +
        '<path d="M-7 -150L0 -172L7 -150V60H-7Z" fill="' + lin('blade', [[0, '#ffffff'], [1, '#a8b0c8']], 0, 0, 1, 0) + '" stroke="#fff" stroke-width="2"/>' +
        '<path d="M0 -150V56" stroke="#8a94b0" stroke-width="1.6"/>' +
        '<path d="M-36 60H36L30 70H-30Z" fill="' + gold + '" stroke="#fff" stroke-width="2"/>' +
        '<rect x="-5" y="70" width="10" height="42" fill="#5a2a1a"/><path d="M-5 78h10M-5 88h10M-5 98h10" stroke="#c98a4a" stroke-width="2"/>' +
        '<circle cy="118" r="8" fill="' + gold + '" stroke="#fff" stroke-width="2"/></g>' +
      '<g transform="rotate(-12 380 182)" fill="none">' +
        '<ellipse cx="380" cy="182" rx="150" ry="52" stroke="#fff3b0" stroke-width="20" opacity=".22"/>' +
        '<ellipse cx="380" cy="182" rx="150" ry="52" stroke="#f0bf4a" stroke-width="6"/>' +
        '<ellipse cx="380" cy="182" rx="150" ry="52" stroke="#fff8d8" stroke-width="2.4" stroke-dasharray="7 7"/></g>' +
      '<g transform="translate(380 176) scale(1.1)">' +
        '<path d="M-120 26C-60 -8 60 -8 120 26L114 46C58 16 -58 16 -114 46Z" fill="' + gold + '" stroke="#7a4a10" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M-114 30C-58 0 58 0 114 30" stroke="#fffbe0" stroke-width="2.4" fill="none"/>' +
        '<path d="M-110 40C-56 12 56 12 110 40" stroke="#9a6014" stroke-width="2" fill="none" opacity=".7"/>' +
        '<path d="M-50 12L0 -64L50 12C30 6 -30 6 -50 12Z" fill="' + gold + '" stroke="#7a4a10" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M-36 8L0 -46L36 8" stroke="#9a6014" stroke-width="2" fill="none"/><path d="M-44 10L0 -58" stroke="#fffbe0" stroke-width="2" fill="none"/>' +
        '<g transform="translate(0 -14)"><circle r="28" fill="#ff4d5a" opacity=".25"/>' + ruby + '<path d="' + starPath(5, 23, 9) + '" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g></g>' +
      sparkle(480, 64, 13) + sparkle(270, 96, 9) + sparkle(470, 270, 7);
  },

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

  // A great grey forest spirit under a red umbrella at a bus stop in the rain.
  'Totoro': () => {
    const fur = lin('fur', [[0, '#a8a8b8'], [1, '#5a5a6e']]);
    return tint('#3a9f6a', '#1a2a4a', 0.6) +
      '<g fill="#12301f"><path d="M470 440V230C470 214 488 214 488 230V440Z"/><ellipse cx="480" cy="190" rx="90" ry="70"/><ellipse cx="420" cy="130" rx="80" ry="54"/><ellipse cx="520" cy="110" rx="70" ry="60"/></g>' +
      '<g stroke="#cfeaff" stroke-width="2" stroke-linecap="round" opacity=".5">' +
        scatter(191, 46, (x, y) => '<path d="M' + x + ' ' + y + 'l-6 18"/>', 120, W, 0, 380) + '</g>' +
      glow('lamp', 250, 236, 60, '#fff3c4', 0.6) +
      '<g fill="#0c2016"><rect x="246" y="250" width="7" height="150"/><circle cx="249.5" cy="242" r="18"/></g><circle cx="249.5" cy="242" r="11" fill="#ffe9a6" opacity=".4"/>' +
      glow('g', 400, 220, 170, '#c9ffd6', 0.4) +
      ground('M0 440V398C120 386 260 404 380 394S490 390 520 392V440Z', '#0c2016') +
      '<g fill="#7fb8d8" opacity=".35"><ellipse cx="300" cy="414" rx="40" ry="5"/><ellipse cx="460" cy="420" rx="34" ry="4"/></g>' +
      '<g transform="translate(386 296) scale(.95)">' +
        '<g transform="translate(62 -196) rotate(12)">' +
          '<path d="M0 0V128" stroke="#3a2a2a" stroke-width="5"/><path d="M0 128c0 14-16 14-16 2" stroke="#3a2a2a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
          '<path d="M-86 0C-86 -52 -44 -80 0 -80C44 -80 86 -52 86 0Q64 -12 43 0Q22 -12 0 0Q-22 -12 -43 0Q-64 -12 -86 0Z" fill="' + lin('brolly', [[0, '#ff6a5a'], [1, '#b01a2a']]) + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
          '<path d="M0 -80V0M0 -80C-24 -60 -40 -30 -43 0M0 -80C24 -60 40 -30 43 0" stroke="#7a0a18" stroke-width="2" fill="none"/>' +
          '<path d="M0 -80V-94" stroke="#3a2a2a" stroke-width="4"/>' +
          '<path d="M-60 -40C-50 -60 -30 -72 -10 -76" stroke="#fff" stroke-width="5" fill="none" opacity=".45" stroke-linecap="round"/></g>' +
        '<path d="M-46 -90L-58 -150L-22 -100ZM46 -90L58 -150L22 -100Z" fill="' + fur + '"/>' +
        '<path d="M-90 40C-96 -40 -60 -102 0 -104C60 -102 96 -40 90 40C86 90 50 110 0 110C-50 110 -86 90 -90 40Z" fill="' + fur + '"/>' +
        '<path d="M-62 26C-60 -16 -30 -36 0 -36C30 -36 60 -16 62 26C60 74 30 98 0 98C-30 98 -60 74 -62 26Z" fill="#f2ead2"/>' +
        '<g fill="none" stroke="#6a6a7e" stroke-width="4" stroke-linecap="round"><path d="M-30 -10l8-8l8 8M-6 -14l8-8l8 8M18 -10l8-8l8 8M-18 10l8-8l8 8M6 10l8-8l8 8"/></g>' +
        '<circle cx="-34" cy="-62" r="11" fill="#fff"/><circle cx="34" cy="-62" r="11" fill="#fff"/><circle cx="-32" cy="-62" r="5.5" fill="#1a1a2a"/><circle cx="32" cy="-62" r="5.5" fill="#1a1a2a"/>' +
        '<path d="M-9 -78H9L0 -70Z" fill="#2a2a3a"/>' +
        '<path d="M-46 -48l-36 -6M-46 -40l-38 2M46 -48l36 -6M46 -40l38 2" stroke="#2a2a3a" stroke-width="2.5" stroke-linecap="round"/>' +
        '<path d="M72 -6C80 -34 60 -64 40 -70C30 -62 40 -36 54 -6Z" fill="' + fur + '"/>' +
        '<path d="M-72 -6C-86 20 -84 50 -76 64C-66 52 -64 26 -58 4Z" fill="' + fur + '"/>' +
        '<ellipse cx="-40" cy="106" rx="24" ry="8" fill="#5a5a6e"/><ellipse cx="40" cy="106" rx="24" ry="8" fill="#5a5a6e"/></g>' +
      scatter(192, 12, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="#f6ff9a"/><circle cx="' + x + '" cy="' + y + '" r="7" fill="#f6ff9a" opacity=".25"/>', 200, 330, 280, 390);
  },

  // A home in an old tree stump by the swamp, smoke curling green, a KEEP OUT sign at the bank.
  'Shrek': () => {
    const bark = lin('bark', [[0, '#8a6a36'], [1, '#3a2a14']], 0, 0, 1, 0);
    return tint('#7fe03a', '#14380f', 0.72) + stars(201, 18, 120, W, 0, 120, '#f6ffd0') +
      glow('moon', 470, 66, 90, '#f6ffb0', 0.6) + '<circle cx="470" cy="66" r="28" fill="#f6ffd0"/>' +
      glow('g', 392, 270, 180, '#c9ff7a', 0.5) +
      '<g fill="#2a4a1c" opacity=".7"><ellipse cx="200" cy="350" rx="80" ry="50"/><ellipse cx="520" cy="320" rx="60" ry="80"/></g>' +
      '<path d="M318 394C326 360 330 300 326 220C324 190 330 168 340 160L352 176L364 150L380 172L396 146L410 170L426 152L436 176L450 160C460 172 462 196 460 230C456 300 462 360 474 394C440 402 360 402 318 394Z" fill="' + bark + '"/>' +
      '<path d="M318 394C300 398 284 404 266 412H330ZM474 394C492 398 506 404 520 408H460Z" fill="#3a2a14"/>' +
      '<g stroke="#2a1a0a" stroke-width="2.5" fill="none" opacity=".6"><path d="M342 200C338 260 340 330 336 380M360 190C356 240 360 300 356 340M436 196C440 250 436 320 444 380M452 220C454 280 450 340 458 380"/></g>' +
      '<g fill="#6fbf3a"><ellipse cx="346" cy="166" rx="16" ry="7"/><ellipse cx="400" cy="150" rx="14" ry="6"/><ellipse cx="444" cy="168" rx="14" ry="6"/><ellipse cx="330" cy="300" rx="8" ry="16"/></g>' +
      '<path d="M430 162L434 112H450L452 166Z" fill="#5a4a3a"/>' +
      '<path d="M442 106c-10-14 8-24-2-38s10-24 4-36" stroke="#d8ffb0" stroke-width="8" fill="none" opacity=".45" stroke-linecap="round"/>' +
      glow('win', 356, 262, 40, '#ffd27a', 0.6) +
      '<circle cx="356" cy="262" r="16" fill="#ffd27a" stroke="#2a1a0a" stroke-width="4"/><path d="M356 246V278M340 262H372" stroke="#2a1a0a" stroke-width="3"/>' +
      '<circle cx="432" cy="232" r="13" fill="#ffd27a" stroke="#2a1a0a" stroke-width="4"/><path d="M432 219V245M419 232H445" stroke="#2a1a0a" stroke-width="3"/>' +
      '<path d="M370 394V344A26 26 0 0 1 422 344V394Z" fill="#6a4a22" stroke="#2a1a0a" stroke-width="3"/><path d="M396 318V394M378 342H414M376 366H416" stroke="#2a1a0a" stroke-width="2"/><circle cx="414" cy="370" r="3.4" fill="#ffd27a"/>' +
      '<path d="M0 404H520V440H0Z" fill="' + lin('swamp', [[0, '#3f6b2a'], [1, '#14280f']]) + '"/>' +
      '<path d="M0 406C80 394 200 400 300 396S460 398 520 400V410H0Z" fill="#1c3a14"/>' +
      '<g fill="#6fbf3a" opacity=".8"><ellipse cx="200" cy="424" rx="16" ry="4"/><ellipse cx="300" cy="430" rx="12" ry="3.4"/><ellipse cx="460" cy="426" rx="14" ry="3.6"/></g>' +
      '<rect x="292" y="350" width="7" height="56" fill="#4a3018"/>' +
      '<path d="M262 344L326 336L328 364L264 370Z" fill="#b08a4a" stroke="#4a3018" stroke-width="3"/>' +
      '<text x="295" y="358" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="900" fill="#2a1a0a" text-anchor="middle" transform="rotate(-6 295 356)">KEEP OUT</text>' +
      '<g stroke="#2a3a14" stroke-width="3" stroke-linecap="round">' + [200, 216, 488, 504].map((x, i) => '<path d="M' + x + ' 410V' + (338 + i * 6) + '"/><rect x="' + (x - 3) + '" y="' + (338 + i * 6) + '" width="6" height="22" rx="3" fill="#6a4a22"/>').join('') + '</g>' +
      scatter(202, 14, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="2.4" fill="#e9ff7a"/><circle cx="' + x + '" cy="' + y + '" r="7" fill="#e9ff7a" opacity=".25"/>', 220, 510, 200, 390) +
      '<g fill="none" stroke="#9fe05a" stroke-width="2" opacity=".6"><circle cx="240" cy="420" r="4"/><circle cx="380" cy="426" r="3"/><circle cx="420" cy="418" r="2.4"/></g>';
  },

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

  // A black dragon with a red tail fin sweeping across a full moon through storm clouds, a blue blast ahead of it.
  'Hiccup': () => {
    const wing = 'M-12 -40C-40 -58 -66 -70 -92 -68C-120 -66 -150 -56 -176 -44Q-152 -30 -150 0Q-130 2 -110 16Q-86 6 -60 20Q-36 6 -14 14Z';
    const ribs = '<path d="M-92 -68L-150 0M-92 -68L-110 16M-92 -68L-60 20M-92 -68L-176 -44" stroke="#2a3a5a" stroke-width="2" fill="none"/>';
    const body = 'M0 -102C14 -102 22 -92 22 -80C22 -72 16 -66 12 -62C18 -42 22 -20 20 0C18 20 12 40 8 60C8 100 4 140 0 180C-4 140 -8 100 -8 60C-12 40 -18 20 -20 0C-22 -20 -18 -42 -12 -62C-16 -66 -22 -72 -22 -80C-22 -92 -14 -102 0 -102Z' +
      'M20 -84L40 -78L20 -70ZM16 -74L36 -60L14 -64ZM-20 -84L-40 -78L-20 -70ZM-16 -74L-36 -60L-14 -64Z' +
      'M-16 36L-32 58L-18 54ZM16 36L32 58L18 54Z';
    // The tail: a ribbon that tapers along an S-curve, spines down its middle,
    // a pair of small fins halfway and the two swept tail fins at its end,
    // the right one red.
    const curve = [[0, 52], [14, 104], [-34, 140], [-16, 204]];
    const along = t => {
      const p = bez(...curve, t);
      const q = bez(...curve, Math.min(1, t + 0.01));
      const r = bez(...curve, Math.max(0, t - 0.01));
      const len = Math.hypot(q[0] - r[0], q[1] - r[1]) || 1;
      const d = [(q[0] - r[0]) / len, (q[1] - r[1]) / len];
      return { p, d, nrm: [-d[1], d[0]] };
    };
    const at = (o, a, b) => n(o.p[0] + o.nrm[0] * a + o.d[0] * b) + ' ' + n(o.p[1] + o.nrm[1] * a + o.d[1] * b);
    const steps = 28;
    const left = [];
    const right = [];
    for (let i = 0; i <= steps; i++) {
      const o = along(i / steps);
      const w = 11 * (1 - i / steps) + 2;
      left.push(at(o, w, 0));
      right.unshift(at(o, -w, 0));
    }
    const tailPath = 'M' + left.join('L') + 'L' + right.join('L') + 'Z';
    const fin = (t, side, span, back) => {
      const o = along(t);
      return 'M' + at(o, 0, -4) + 'Q' + at(o, side * span * 0.6, -back * 0.3) + ' ' + at(o, side * span, back * 0.55) +
        'Q' + at(o, side * span * 0.62, back * 0.5) + ' ' + at(o, side * span * 0.5, back * 0.85) +
        'Q' + at(o, side * span * 0.3, back * 0.62) + ' ' + at(o, 0, back) + 'Z';
    };
    let spines = '';
    for (const t of [0.12, 0.24, 0.36, 0.62, 0.74]) {
      const o = along(t);
      spines += 'M' + at(o, -2.6, 0) + 'L' + at(o, 0, 9) + 'L' + at(o, 2.6, 0) + 'Z';
    }
    const tail = '<path d="' + tailPath + '"/><path d="' + fin(0.48, 1, 16, 14) + fin(0.48, -1, 16, 14) + fin(0.9, 1, 36, 26) + spines + '"/>';
    const redFin = '<path d="' + fin(0.9, -1, 36, 26) + '" fill="#d8283a" stroke="#ff8a8a" stroke-width="1.5"/>';
    const cloud = (x, y, rx, ry, fill, o) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" opacity="' + o + '"/><path d="M' + (x - rx * 0.7) + ' ' + n(y - ry * 0.7) + 'Q' + x + ' ' + n(y - ry * 1.1) + ' ' + (x + rx * 0.7) + ' ' + n(y - ry * 0.7) + '" stroke="#dfe8ff" stroke-width="2" fill="none" opacity="' + n(o * 0.6) + '"/>';
    return tint('#1a2a5a', '#3a2a6a', 0.7) + stars(221, 50, 120, W, 0, 260) +
      glow('moonglow', 380, 190, 200, '#cfe0ff', 0.55) +
      '<circle cx="380" cy="190" r="120" fill="' + rad('moon', [[0, '#ffffff'], [1, '#c8d6f0']], 0.4, 0.35) + '"/>' +
      '<g fill="#a8b8d8" opacity=".35"><circle cx="340" cy="150" r="18"/><circle cx="420" cy="230" r="12"/><circle cx="430" cy="140" r="7"/></g>' +
      cloud(300, 300, 190, 16, '#4a5a8a', 0.8) + cloud(470, 120, 110, 12, '#5a6a9a', 0.7) + cloud(330, 330, 150, 10, '#3a4a7a', 0.7) +
      '<g transform="translate(392 196) rotate(32) scale(.86)">' +
        '<path d="M0 -100L0 -230" stroke="#7fb8ff" stroke-width="22" stroke-linecap="round" opacity=".25"/>' +
        '<path d="M0 -104L0 -214" stroke="#cfe8ff" stroke-width="7" stroke-linecap="round"/>' +
        '<circle cy="-222" r="16" fill="' + rad('blast', [[0, '#ffffff'], [0.5, '#9fc8ff', 0.9], [1, '#7a6aff', 0]]) + '"/>' +
        '<g fill="#0a0e1c" stroke="#9fb8e8" stroke-width="2" stroke-opacity=".55">' +
          '<path d="' + wing + '"/><path d="' + wing + '" transform="scale(-1 1)"/>' +
          tail + '<path d="' + body + '"/></g>' +
        ribs + '<g transform="scale(-1 1)">' + ribs + '</g>' +
        redFin +
        '<path d="M-10 -88C-6 -84 -2 -84 0 -86" stroke="#9ff05a" stroke-width="2" fill="none"/><path d="M10 -88C6 -84 2 -84 0 -86" stroke="#9ff05a" stroke-width="2" fill="none"/></g>' +
      cloud(240, 372, 200, 14, '#2a3360', 0.85) + cloud(470, 386, 120, 10, '#232a55', 0.85) +
      '<g fill="#0c1230"><path d="M200 440V340L214 326L230 340V440Z"/><path d="M450 440V320L468 304L486 320V440Z"/></g>' +
      ground('M0 440V404C120 396 260 410 380 402S490 398 520 400V440Z', '#0a1028') +
      '<path d="M200 418c30-6 60 6 90 0s60-6 90 0 60 6 90 0" fill="none" stroke="#cfe0ff" stroke-width="2" opacity=".4"/>' +
      sparkle(488, 60, 9) + sparkle(250, 90, 7);
  },

  // A spellbook open in the air above a castle of lit windows, a wand
  // trailing sparks across its pages, candles floating in the dark.
  'Hermione Granger': () => {
    const halo = rad('cg', [[0, '#ffd27a', 0.6], [1, '#ffd27a', 0]]);
    const candle = (x, y, r) => {
      const h = n(14 + r() * 12);
      return '<circle cx="' + x + '" cy="' + n(y - 4) + '" r="12" fill="' + halo + '"/>' +
        '<rect x="' + n(x - 3) + '" y="' + y + '" width="6" height="' + h + '" rx="1.5" fill="#fff4dc"/>' +
        '<path d="M' + x + ' ' + n(y - 9) + 'c3 4 3 7 0 8c-3-1-3-4 0-8z" fill="#ffb84a"/>';
    };
    const page = side => {
      const s = side;
      return '<path d="M390 150C' + (390 - 30 * s) + ' 132 ' + (390 - 70 * s) + ' 130 ' + (390 - 100 * s) + ' 140L' + (390 - 100 * s) + ' 222C' +
        (390 - 70 * s) + ' 212 ' + (390 - 30 * s) + ' 214 390 232Z" fill="' + lin('pg' + (s > 0 ? 'l' : 'r'), [[0, '#fffaf0'], [1, '#f0dcb4']]) + '" stroke="#c9a46a" stroke-width="1.6"/>' +
        [0, 1, 2, 3, 4].map(i => '<path d="M' + (390 - 16 * s) + ' ' + (160 + i * 13) + 'C' + (390 - 40 * s) + ' ' + (150 + i * 13) + ' ' +
          (390 - 66 * s) + ' ' + (149 + i * 13) + ' ' + (390 - 88 * s) + ' ' + (155 + i * 13) + '" stroke="#b08a5a" stroke-width="1.6" fill="none" opacity=".55"/>').join('');
    };
    let trail = '';
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const [x, y] = bez([456, 170], [486, 130], [440, 80], [500, 50], t);
      trail += i % 3 === 0 ? sparkle(x, y, n(4 + t * 6), '#fff6c4') : '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.6 + t * 1.4) + '" fill="#ffe9a6" opacity=".85"/>';
    }
    return tint('#f2b84a', '#2a1048', 0.58) + stars(401, 34, 120, W, 0, 220, '#fff6dc') +
      scatter(402, 9, (x, y, r) => candle(x, y, r), 160, 510, 70, 130) +
      glow('g', 390, 186, 170, '#ffe2a0', 0.75) +
      '<path d="M390 158C356 140 312 138 282 148L282 236C312 226 356 228 390 246C424 228 468 226 498 236L498 148C468 138 424 140 390 158Z" fill="#7a1a2a" stroke="#f0c050" stroke-width="2"/>' +
      page(1) + page(-1) + '<path d="M390 150V232" stroke="#c9a46a" stroke-width="2"/>' +
      '<path d="M354 148c6-10 14-14 22-12M404 136c8-2 16 2 22 12" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>' +
      '<g transform="translate(456 170) rotate(-35)"><rect x="-4" y="0" width="8" height="120" rx="3" fill="' + lin('wand', [[0, '#8a5a2a'], [1, '#3a200e']], 0, 0, 1, 0) + '"/>' +
        '<path d="M-5 74h10M-5 84h10M-5 94h10" stroke="#c9945a" stroke-width="2.4"/><circle cy="0" r="4" fill="#fff6c4"/></g>' +
      trail +
      '<path d="M0 440V360C90 350 200 362 280 352S440 340 520 348V440Z" fill="#1c0b30"/>' +
      '<g fill="#140826"><rect x="312" y="326" width="186" height="46"/>' +
        '<rect x="316" y="302" width="24" height="70"/><path d="M312 302L328 272L344 302Z"/>' +
        '<rect x="362" y="292" width="28" height="80"/><path d="M357 292L376 256L395 292Z"/>' +
        '<rect x="420" y="282" width="32" height="90"/><path d="M415 282L436 252L457 282Z"/>' +
        '<rect x="472" y="304" width="22" height="68"/><path d="M468 304L483 276L498 304Z"/>' +
        [318, 342, 396, 456].map(x => '<rect x="' + x + '" y="318" width="10" height="8"/>').join('') + '</g>' +
      '<g fill="#ffd27a" opacity=".85">' + [[324, 312], [326, 336], [372, 304], [380, 330], [432, 294], [440, 320], [432, 346], [478, 320], [404, 348], [464, 350], [350, 350]]
        .map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="5" height="8" rx="2.5"/>').join('') + '</g>' +
      '<rect x="0" y="372" width="520" height="68" fill="' + lin('lake', [[0, '#2a1450'], [1, '#0e0620']]) + '"/>' +
      '<g fill="#ffd27a" opacity=".35">' + [[322, 384], [376, 392], [436, 386], [482, 396]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="5" height="16" rx="2.5"/>').join('') + '</g>';
  },

  // A glossy pink skull under a black two-pointed jester cap, a devil's tail
  // curling from behind it, under a small lilac crescent; little bats, hearts
  // and sparkles on a plum night, a spiked fence along the hills.
  'Kuromi': () => {
    defs.push('<mask id="{id}-cres" maskUnits="userSpaceOnUse"><rect width="' + W + '" height="' + H + '" fill="#fff"/><circle cx="392" cy="34" r="36" fill="#000"/></mask>');
    const pink = lin('pink', [[0, '#ffd6ea'], [0.55, '#ff8cc4'], [1, '#f0559c']], 0, 0, 0.4, 1);
    const ink = lin('ink', [[0, '#3c2558'], [1, '#120820']], 0, 0, 0.6, 1);
    const bat = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="#1a0c2c">' +
      '<path d="M-6 -2C-12 -10 -24 -12 -30 -6C-24 -4 -22 2 -24 8C-18 4 -12 6 -8 10Z"/><path d="M6 -2C12 -10 24 -12 30 -6C24 -4 22 2 24 8C18 4 12 6 8 10Z"/>' +
      '<circle r="8"/><path d="M-6 -6L-8 -14L-2 -8ZM6 -6L8 -14L2 -8Z"/><circle cx="-3" cy="-1" r="1.6" fill="#ff8cc4"/><circle cx="3" cy="-1" r="1.6" fill="#ff8cc4"/></g>';
    const heart = (x, y, s, c) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 7C-9 1 -11 -4 -9 -7C-6 -11 -2 -10 0 -6C2 -10 6 -11 9 -7C11 -4 9 1 0 7Z" fill="' + c + '"/>';
    const ear = side => {
      const k = side;
      return '<path d="M' + (-34 * k) + ' -40C' + (-58 * k) + ' -78 ' + (-88 * k) + ' -118 ' + (-128 * k) + ' -140C' + (-120 * k) + ' -118 ' +
        (-112 * k) + ' -76 ' + (-88 * k) + ' -40C' + (-76 * k) + ' -22 ' + (-62 * k) + ' -14 ' + (-52 * k) + ' -10Z" fill="' + ink + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M' + (-46 * k) + ' -44C' + (-66 * k) + ' -76 ' + (-90 * k) + ' -106 ' + (-116 * k) + ' -128" stroke="#8a62b8" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>';
    };
    return tint('#ff9ad2', '#1c0c34', 0.64) + stars(411, 44, 120, W, 0, 250, '#ffe0f4') +
      glow('mg', 372, 52, 70, '#f3dcff', 0.5) +
      '<circle cx="372" cy="52" r="42" fill="' + lin('moon', [[0, '#fbf0ff'], [1, '#cfa8ff']]) + '" mask="url(#{id}-cres)"/>' +
      glow('g', 372, 210, 180, '#ff9ad2', 0.62) +
      '<path d="M400 266C456 290 500 258 484 220" fill="none" stroke="#1a0c2c" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="M484 220L470 214L476 196L490 208L502 200L498 218Z" fill="#1a0c2c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
      '<g transform="translate(372 210) scale(1.02)">' + ear(1) + ear(-1) +
        '<path d="M0 -50C-34 -50 -54 -28 -54 0C-54 18 -46 30 -34 36V48C-34 54 -28 58 -22 58H22C28 58 34 54 34 48V36C46 30 54 18 54 0C54 -28 34 -50 0 -50Z" fill="' + pink + '" stroke="#fff" stroke-width="3.5"/>' +
        '<path d="M-54 -6C-56 -44 -30 -66 0 -66C30 -66 56 -44 54 -6C38 -22 -38 -22 -54 -6Z" fill="' + ink + '" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>' +
        '<path d="M-40 -30C-28 -48 -14 -56 4 -58" stroke="#8a62b8" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>' +
        '<ellipse cx="-20" cy="10" rx="13" ry="15" fill="#2a1240"/><ellipse cx="20" cy="10" rx="13" ry="15" fill="#2a1240"/>' +
        '<circle cx="-15" cy="4" r="4.2" fill="#fff"/><circle cx="25" cy="4" r="4.2" fill="#fff"/><circle cx="-23" cy="16" r="2" fill="#fff" opacity=".7"/><circle cx="17" cy="16" r="2" fill="#fff" opacity=".7"/>' +
        '<path d="M0 34C-3 29 -9 30 -8 34C-7 37 0 40 0 40C0 40 7 37 8 34C9 30 3 29 0 34Z" fill="#2a1240"/>' +
        '<path d="M-20 46H20" stroke="#c43d82" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M-12 46V56M-4 46V58M4 46V58M12 46V56" stroke="#c43d82" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M-44 -2C-44 -10 -40 -16 -34 -18C-38 -10 -38 -2 -36 6Z" fill="#fff" opacity=".55"/>' +
        '<ellipse cx="-34" cy="30" rx="8" ry="4" fill="#ff5f9a" opacity=".45"/><ellipse cx="34" cy="30" rx="8" ry="4" fill="#ff5f9a" opacity=".45"/></g>' +
      [[250, 160, 1.05], [494, 130, 0.8], [262, 290, 0.7], [478, 304, 0.75], [452, 74, 0.6]].map(([x, y, sc]) => bat(x, y, sc)).join('') +
      heart(300, 210, 1.5, '#ff5f9a') + heart(502, 160, 1.1, '#ffc2e0') + heart(238, 220, 0.9, '#ffc2e0') + heart(352, 100, 0.9, '#ff8cc4') + heart(470, 250, 0.8, '#ff8cc4') +
      sparkle(500, 70, 10, '#ffe0f4') + sparkle(236, 100, 8, '#ffe0f4') + sparkle(320, 300, 6, '#ffe0f4') +
      '<path d="M0 440V378C110 360 230 382 330 366S470 352 520 360V440Z" fill="#2a1446"/>' +
      '<g fill="#160a26">' + Array.from({ length: 14 }, (_, i) => 252 + i * 20).map(x =>
        '<rect x="' + (x - 2.5) + '" y="340" width="5" height="60"/><path d="M' + (x - 6) + ' 342C' + (x - 4) + ' 334 ' + (x - 2) + ' 330 ' + x + ' 322C' + (x + 2) + ' 330 ' + (x + 4) + ' 334 ' + (x + 6) + ' 342Z"/>').join('') +
        '<rect x="246" y="352" width="290" height="5"/><rect x="246" y="378" width="290" height="5"/></g>' +
      '<path d="M0 440V402C120 390 250 408 360 398S480 392 520 396V440Z" fill="#160a26"/>' +
      '<g fill="#ff8cc4">' + [[290, 410], [350, 420], [430, 412], [500, 422]].map(([x, y]) => heart(x, y, 0.6, '#ff8cc4')).join('') + '</g>';
  },

  // A heart-shaped brooch with a crescent at its centre, ribbons streaming,
  // under a great crescent moon over a city at night and its lattice tower.
  'Sailor Moon': () => {
    defs.push('<mask id="{id}-cres" maskUnits="userSpaceOnUse"><rect width="' + W + '" height="' + H + '" fill="#fff"/><circle cx="500" cy="40" r="72" fill="#000"/></mask>');
    defs.push('<mask id="{id}-inner" maskUnits="userSpaceOnUse"><rect width="' + W + '" height="' + H + '" fill="#fff"/><circle cx="386" cy="190" r="22" fill="#000"/></mask>');
    const gold = lin('gold', [[0, '#fff6c4'], [0.5, '#f4c84a'], [1, '#c98a1f']]);
    const heart = s => 'M0 ' + n(40 * s) + 'C' + n(-50 * s) + ' ' + n(6 * s) + ' ' + n(-62 * s) + ' ' + n(-24 * s) + ' ' + n(-44 * s) + ' ' + n(-42 * s) +
      'C' + n(-28 * s) + ' ' + n(-58 * s) + ' ' + n(-8 * s) + ' ' + n(-50 * s) + ' 0 ' + n(-34 * s) +
      'C' + n(8 * s) + ' ' + n(-50 * s) + ' ' + n(28 * s) + ' ' + n(-58 * s) + ' ' + n(44 * s) + ' ' + n(-42 * s) +
      'C' + n(62 * s) + ' ' + n(-24 * s) + ' ' + n(50 * s) + ' ' + n(6 * s) + ' 0 ' + n(40 * s) + 'Z';
    const tower = '<g fill="none" stroke="#ff5a6a" stroke-width="2.4"><path d="M262 400L290 250L318 400M276 330H304M270 360H310M282 290H298M290 250V220"/>' +
      '<path d="M266 380L314 340M314 380L266 340M274 330L306 296M306 330L274 296"/></g>' +
      '<rect x="278" y="312" width="24" height="7" fill="#ff5a6a"/>';
    return tint('#ff9ad5', '#24247a', 0.55) + stars(421, 46, 120, W, 0, 260) +
      '<circle cx="460" cy="74" r="80" fill="' + lin('moon', [[0, '#fffbe6'], [1, '#ffe08a']]) + '" mask="url(#{id}-cres)"/>' +
      glow('g', 380, 196, 170, '#ffd6f0', 0.75) +
      '<path d="M380 210C320 230 280 280 230 300C270 290 320 270 360 240Z" fill="#ff7ab8" opacity=".85"/>' +
      '<path d="M380 210C440 236 470 290 520 306V290C480 276 450 246 400 220Z" fill="#7ab8ff" opacity=".85"/>' +
      '<path d="M380 210C330 250 312 300 300 340C330 300 352 262 386 232Z" fill="#ffb3d9" opacity=".7"/>' +
      '<g transform="translate(380 196)"><path d="' + heart(1.5) + '" fill="' + gold + '" stroke="#fff" stroke-width="3"/>' +
        '<path d="' + heart(1.18) + '" fill="' + lin('pink', [[0, '#ffc2e0'], [1, '#ff4f9a']]) + '" stroke="#c98a1f" stroke-width="2"/></g>' +
      '<circle cx="372" cy="190" r="26" fill="' + gold + '" mask="url(#{id}-inner)"/>' +
      [[380, 128, '#ff4f6a'], [324, 170, '#4f9aff'], [436, 170, '#4fd08a'], [380, 246, '#ffe04f']].map(([x, y, c]) =>
        '<circle cx="' + x + '" cy="' + y + '" r="7" fill="' + c + '" stroke="#fff" stroke-width="2"/>').join('') +
      sparkle(476, 210, 12) + sparkle(270, 120, 9) + sparkle(452, 290, 7) + sparkle(318, 90, 6) +
      skyline(422, 140, W, 420, 50, 150, '#1a1650', '#ffe9a6') + tower +
      '<rect x="0" y="420" width="520" height="20" fill="#120e3a"/>';
  },

  // A golden crown set with gems above a pink-roofed castle on green hills,
  // pennants flying, a peach or two in the grass.
  'Princess Peach': () => {
    const gold = lin('gold', [[0, '#fff6c4'], [0.5, '#f4c84a'], [1, '#c98a1f']]);
    const cone = (x, y, w, h) => '<path d="M' + (x - w / 2 - 4) + ' ' + y + 'L' + x + ' ' + (y - h) + 'L' + (x + w / 2 + 4) + ' ' + y + 'Z" fill="' + lin('roof', [[0, '#ff9ac8'], [1, '#d0447e']]) + '"/>';
    const peach = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 -8C-10 -14 -22 -6 -22 6C-22 16 -12 22 0 22S22 16 22 6C22 -6 10 -14 0 -8Z" fill="' + lin('peach', [[0, '#ffd2a8'], [1, '#ff7a6a']]) + '"/>' +
      '<path d="M0 -8C-3 2 -3 12 0 22" stroke="#e05a5a" stroke-width="1.6" fill="none"/><path d="M2 -9C8 -18 16 -18 20 -14C14 -9 8 -8 2 -9Z" fill="#4fa04a"/></g>';
    return tint('#ffc2dc', '#7a3a9a', 0.5) +
      '<g fill="#fff" opacity=".8"><ellipse cx="270" cy="70" rx="44" ry="15"/><ellipse cx="298" cy="60" rx="26" ry="15"/><ellipse cx="480" cy="230" rx="40" ry="12"/><ellipse cx="504" cy="222" rx="22" ry="12"/></g>' +
      '<g fill="#fff6c4" opacity=".2">' + [-50, -25, 0, 25, 50].map(a => '<path d="M384 150L370 -30H398Z" transform="rotate(' + a + ' 384 150)"/>').join('') + '</g>' +
      glow('g', 384, 136, 160, '#fff1b8', 0.85) +
      '<g transform="translate(384 128) scale(.92)">' +
        '<path d="M-70 40L-82 -34L-44 -6L-22 -56L0 -14L22 -56L44 -6L82 -34L70 40Z" fill="' + gold + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-72 40H72V58H-72Z" fill="' + gold + '" stroke="#fff" stroke-width="3"/>' +
        [[-82, -34], [-22, -56], [22, -56], [82, -34]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="8" fill="#fffbe6" stroke="#c98a1f" stroke-width="2"/>').join('') +
        '<path d="M0 -4l12 16-12 16-12-16z" fill="#4f9aff" stroke="#fff" stroke-width="2"/>' +
        '<circle cx="-40" cy="20" r="8" fill="#ff4f6a" stroke="#fff" stroke-width="2"/><circle cx="40" cy="20" r="8" fill="#ff4f6a" stroke="#fff" stroke-width="2"/>' +
        '<circle cx="-50" cy="49" r="4" fill="#4f9aff"/><circle cx="0" cy="49" r="4" fill="#ff4f6a"/><circle cx="50" cy="49" r="4" fill="#4f9aff"/></g>' +
      sparkle(476, 96, 11) + sparkle(290, 150, 8) + sparkle(470, 180, 6) +
      '<path d="M0 440V330C80 300 160 318 230 336S380 300 520 320V440Z" fill="#6fcf6a"/>' +
      '<g transform="translate(0 30)"><g fill="#fffaf4">' +
        '<rect x="330" y="270" width="150" height="90"/><rect x="316" y="250" width="34" height="110"/><rect x="460" y="250" width="34" height="110"/>' +
        '<rect x="384" y="236" width="42" height="124"/></g>' +
      cone(333, 250, 34, 50) + cone(477, 250, 34, 50) + cone(405, 236, 42, 60) +
      '<path d="M405 176V158" stroke="#7a3a9a" stroke-width="3"/><path d="M405 158L426 164L405 170Z" fill="#ff5f9a"/>' +
      '<path d="M392 360V326A13 13 0 0 1 418 326V360Z" fill="#a0522d"/>' +
      '<g fill="#ffd27a"><circle cx="405" cy="268" r="9"/></g><path d="' + starPath(5, 6, 2.6) + '" fill="#ff5f9a" transform="translate(405 268)"/>' +
      '<g fill="#7ab8ff">' + [[338, 292], [462, 292], [354, 320], [446, 320]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="10" height="16" rx="5"/>').join('') + '</g></g>' +
      '<path d="M0 440V384C100 366 220 390 330 376S460 366 520 372V440Z" fill="#3f9f4a"/>' +
      peach(250, 396, 1.1) + peach(286, 410, 0.8) + peach(500, 404, 0.9);
  },

  // A big red bow over a little cottage on a hill of apples and flowers,
  // polka dots in a pink sky.
  'Hello Kitty': () => {
    const red = lin('red', [[0, '#ff6a7a'], [1, '#d01a32']]);
    const apple = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 -10C-6 -16 -20 -14 -20 2C-20 16 -10 22 0 18C10 22 20 16 20 2C20 -14 6 -16 0 -10Z" fill="' + red + '"/>' +
      '<path d="M0 -10V-18" stroke="#6a3a1a" stroke-width="2.4"/><path d="M2 -16C8 -24 16 -22 18 -18C12 -14 6 -13 2 -16Z" fill="#5ab04a"/>' +
      '<ellipse cx="-9" cy="-3" rx="3" ry="5" fill="#fff" opacity=".5"/></g>';
    const flower = (x, y, c) => '<g fill="' + c + '">' + [0, 72, 144, 216, 288].map(a => {
      const r = a * Math.PI / 180;
      return '<circle cx="' + n(x + 6 * Math.sin(r)) + '" cy="' + n(y - 6 * Math.cos(r)) + '" r="4.6"/>';
    }).join('') + '</g><circle cx="' + x + '" cy="' + y + '" r="3.4" fill="#ffd23c"/>';
    return tint('#ffd6e4', '#c2366a', 0.5) +
      scatter(431, 30, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(4 + r() * 6) + '" fill="#fff" opacity=".35"/>', 120, W, 0, 300) +
      glow('g', 384, 158, 170, '#fff0f4', 0.85) +
      '<g transform="translate(384 156)">' +
        '<path d="M-14 22L-46 92L-26 82L-16 100L-2 30Z" fill="' + red + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M14 22L46 92L26 82L16 100L2 30Z" fill="' + red + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-12 0C-50 -66 -120 -64 -122 -6C-124 54 -54 62 -12 10Z" fill="' + red + '" stroke="#fff" stroke-width="4"/>' +
        '<path d="M12 0C50 -66 120 -64 122 -6C124 54 54 62 12 10Z" fill="' + red + '" stroke="#fff" stroke-width="4"/>' +
        '<path d="M-24 2C-52 -38 -92 -40 -96 -6C-98 26 -60 34 -26 8Z" fill="#a8102a" opacity=".45"/>' +
        '<path d="M24 2C52 -38 92 -40 96 -6C98 26 60 34 26 8Z" fill="#a8102a" opacity=".45"/>' +
        '<path d="M-100 -30C-92 -48 -70 -52 -52 -40" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>' +
        '<path d="M100 -30C92 -48 70 -52 52 -40" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>' +
        '<ellipse cx="0" cy="4" rx="22" ry="26" fill="' + red + '" stroke="#fff" stroke-width="4"/>' +
        '<ellipse cx="-6" cy="-6" rx="6" ry="9" fill="#fff" opacity=".45"/></g>' +
      sparkle(270, 90, 9) + sparkle(500, 250, 8) + sparkle(290, 250, 6) +
      '<path d="M0 440V340C90 320 190 336 270 346S420 318 520 326V440Z" fill="#a8e08a"/>' +
      '<g transform="translate(456 300)"><rect x="-34" y="0" width="68" height="56" fill="#fffaf4"/>' +
        '<path d="M-44 4L0 -36L44 4Z" fill="' + red + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-10 56V30A10 10 0 0 1 10 30V56Z" fill="#ffb3c6"/>' +
        '<path d="M0 -8C-6 -14 -14 -10 -12 -4C-10 2 0 8 0 8S10 2 12 -4C14 -10 6 -14 0 -8Z" fill="#ff8aa8" transform="translate(-18 22) scale(.7)"/>' +
        '<path d="M0 -8C-6 -14 -14 -10 -12 -4C-10 2 0 8 0 8S10 2 12 -4C14 -10 6 -14 0 -8Z" fill="#ff8aa8" transform="translate(18 22) scale(.7)"/></g>' +
      '<path d="M0 440V388C110 372 230 392 340 380S470 372 520 378V440Z" fill="#6fc06a"/>' +
      apple(300, 372, 1) + apple(334, 380, 0.9) + apple(366, 374, 1.05) +
      flower(250, 404, '#fff') + flower(400, 410, '#ffc2dc') + flower(440, 400, '#fff') + flower(500, 414, '#ffc2dc') + flower(220, 424, '#ffc2dc');
  },
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
