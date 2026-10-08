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

  // A lion on the jutting rock, its head raised to a great rising sun.
  'Simba': () => {
    let mane = '';
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const m = a - Math.PI / 16;
      const p = [n(-78 + 28 * Math.cos(a)), n(-72 + 30 * Math.sin(a))];
      mane += i ? 'Q' + n(-78 + 40 * Math.cos(m)) + ' ' + n(-72 + 42 * Math.sin(m)) + ' ' + p[0] + ' ' + p[1] : 'M' + p[0] + ' ' + p[1];
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
        '<g transform="translate(436 300) scale(.84)">' +
          '<path d="M96 -40C116 -40 126 -30 128 -16" fill="none" stroke="#2b0d2f" stroke-width="6" stroke-linecap="round"/><ellipse cx="129" cy="-11" rx="6" ry="9"/>' +
          '<path d="M-122 -76C-122 -86 -114 -94 -104 -96L-100 -104L-94 -96C-84 -96 -74 -90 -66 -80C-60 -66 -50 -58 -36 -58C-10 -62 30 -62 56 -58C78 -54 94 -46 98 -34C102 -22 100 -10 96 0L84 0C84 -8 82 -14 78 -18C72 -12 68 -6 68 0L56 0C58 -10 58 -20 56 -26C30 -22 0 -22 -24 -26C-26 -16 -28 -8 -26 0L-38 0C-40 -10 -42 -20 -46 -28C-50 -18 -52 -8 -52 0L-64 0C-64 -16 -64 -34 -70 -46C-80 -56 -90 -64 -98 -66C-108 -68 -116 -70 -122 -76Z"/>' +
          '<path d="' + mane + 'Z"/>' +
          '<path d="M-96 -96C-108 -98 -120 -92 -126 -82L-130 -74C-128 -68 -120 -66 -112 -68L-104 -64C-96 -62 -90 -66 -88 -72Z"/><circle cx="-88" cy="-100" r="6"/></g></g>' +
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

  // A badge wearing a rabbit's long ears over a sunrise city, a carrot pen at its side.
  'Judy Hopps': () => {
    const earFill = lin('ear', [[0, '#eee8fb'], [1, '#9a90c4']]);
    const ear = (x, a) => '<g transform="translate(' + x + ' 128) rotate(' + a + ') scale(.82)"><path d="M0 0C-24 -40 -26 -112 0 -150C26 -112 24 -40 0 0Z" fill="' + earFill + '" stroke="#fff" stroke-width="4"/>' +
      '<path d="M0 -16C-12 -46 -12 -104 0 -130C12 -104 12 -46 0 -16Z" fill="#ffb0c8"/></g>';
    return tint('#7fd8ff', '#3a2a8f', 0.5) + glow('sun', 370, 180, 190, '#ffe7a8', 0.65) +
      skyline(41, 130, W, 440, 40, 150, '#2a1a5a', '#ffe9a6') +
      ear(334, -16) + ear(408, 14) +
      '<g transform="translate(370 214) scale(.92)"><path d="M0 -104L84 -72V-4C84 54 46 90 0 112C-46 90 -84 54 -84 -4V-72Z" fill="' + lin('gold', [[0, '#fff0b0'], [1, '#e1a12e']]) + '" stroke="#fff" stroke-width="4"/>' +
        '<path d="M0 -86L66 -60V-4C66 44 34 74 0 92C-34 74 -66 44 -66 -4V-60Z" fill="none" stroke="#b97a1f" stroke-width="3"/>' +
        '<path d="M0 -42L12 -16L40 -12L19 7L25 35L0 21L-25 35L-19 7L-40 -12L-12 -16Z" fill="#fff8dc" stroke="#b97a1f" stroke-width="3"/>' +
        '<path d="M-56 52H56" stroke="#b97a1f" stroke-width="3" opacity=".6"/></g>' +
      '<g transform="translate(474 300) rotate(28)">' +
        '<path d="M0 -50C10 -50 15 -40 13 -30L4 50C2 56 -2 56 -4 50L-13 -30C-15 -40 -10 -50 0 -50Z" fill="' + lin('carrot', [[0, '#ffb04a'], [1, '#e8642c']], 0, 0, 1, 0) + '" stroke="#fff" stroke-width="3"/>' +
        '<path d="M-10 -20h8M2 -2h8M-8 18h7" stroke="#b8481a" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M0 -50C-6 -64 -16 -70 -24 -68M0 -50C2 -66 2 -74 -2 -82M0 -50C8 -62 18 -66 24 -62" fill="none" stroke="#6fd06a" stroke-width="5" stroke-linecap="round"/></g>' +
      sparkle(470, 66, 13) + sparkle(270, 90, 9) +
      glow('red', 200, 300, 44, '#ff4d6d', 0.55) + glow('blue', 250, 300, 44, '#4da3ff', 0.55);
  },

  // A sly fox in shirt and tie, half-lidded, against the city's neon dusk.
  'Nick Wilde': () => {
    const fur = lin('fur', [[0, '#ffb062'], [1, '#d9541f']]);
    const eye = s => '<path d="M' + (-60 * s) + ' -22C' + (-50 * s) + ' -34 ' + (-30 * s) + ' -36 ' + (-18 * s) + ' -24C' + (-30 * s) + ' -12 ' + (-50 * s) + ' -12 ' + (-60 * s) + ' -22Z" fill="#a8ec8a"/>' +
      '<ellipse cx="' + (-36 * s) + '" cy="-22" rx="3.6" ry="8" fill="#12301a"/>' +
      '<path d="M' + (-62 * s) + ' -21C' + (-50 * s) + ' -35 ' + (-30 * s) + ' -37 ' + (-16 * s) + ' -24C' + (-30 * s) + ' -25 ' + (-48 * s) + ' -26 ' + (-62 * s) + ' -21Z" fill="#e8642c"/>' +
      '<path d="M' + (-60 * s) + ' -24C' + (-46 * s) + ' -27 ' + (-30 * s) + ' -27 ' + (-18 * s) + ' -23" stroke="#5a1a0a" stroke-width="3.5" fill="none" stroke-linecap="round"/>';
    return tint('#3a2a8f', '#c4508f', 0.55) + stars(51, 26, 120, W, 0, 160) +
      '<path d="M260 50a38 38 0 1 0 40 50a30 30 0 1 1-40-50z" fill="#fff1c4" opacity=".9"/>' +
      glow('g', 384, 180, 170, '#ff9a5c', 0.55) +
      skyline(52, 130, W, 440, 40, 130, '#1a1035', '#7ff0e6') +
      '<rect x="160" y="340" width="64" height="16" rx="8" fill="none" stroke="#ff6fb5" stroke-width="3"/><rect x="240" y="318" width="40" height="12" rx="6" fill="none" stroke="#7ff0e6" stroke-width="3"/>' +
      '<g transform="translate(384 150) scale(.92)">' +
        '<path d="M-96 108L0 156L96 108L124 310H-124Z" fill="' + lin('shirt', [[0, '#8fe09a'], [1, '#3f8f5a']]) + '"/>' +
        '<g fill="#2f6b45" opacity=".45"><circle cx="-70" cy="200" r="8"/><circle cx="-40" cy="250" r="8"/><circle cx="64" cy="190" r="8"/><circle cx="80" cy="260" r="8"/><circle cx="-90" cy="280" r="8"/></g>' +
        '<path d="M-64 100L-6 152L-34 176ZM64 100L6 152L34 176Z" fill="#c8f6cc"/>' +
        '<path d="M-12 150H12L18 256L0 280L-18 256Z" fill="#3a4ab0"/><path d="M-13 184L15 172M-15 216L17 202M-17 248L18 234" stroke="#ffd27a" stroke-width="4"/>' +
        '<path d="M-74 -40L-98 -132L-26 -78ZM74 -40L98 -132L26 -78Z" fill="' + fur + '"/>' +
        '<path d="M-70 -56L-88 -116L-42 -80ZM70 -56L88 -116L42 -80Z" fill="#7a2a1a" opacity=".55"/>' +
        '<path d="M-98 -132L-90 -100L-84 -112ZM98 -132L90 -100L84 -112Z" fill="#3a1208"/>' +
        '<path d="M-100 -30C-94 -82 -42 -96 0 -96C42 -96 94 -82 100 -30C104 12 74 36 48 56L0 104L-48 56C-74 36 -104 12 -100 -30Z" fill="' + fur + '"/>' +
        '<path d="M-100 -14C-74 12 -46 22 -24 26C-14 40 -8 70 0 96C8 70 14 40 24 26C46 22 74 12 100 -14C94 28 58 60 0 110C-58 60 -94 28 -100 -14Z" fill="#fff4e4"/>' +
        '<path d="M-22 -94L0 -44L22 -94Z" fill="#b8401a" opacity=".3"/>' +
        eye(1) + eye(-1) +
        '<path d="M-66 -42L-22 -38M22 -40L66 -52" stroke="#7a2a1a" stroke-width="4.5" stroke-linecap="round"/>' +
        '<ellipse cx="0" cy="98" rx="13" ry="9" fill="#2a1240"/><path d="M-4 94a5 3 0 0 1 8 0" fill="#fff" opacity=".5"/>' +
        '<path d="M2 108C8 118 22 120 34 110" stroke="#2a1240" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>' +
      sparkle(476, 60, 10);
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

  // A glowing golden memory over shelves of coloured ones, and the control desk below.
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
    return tint('#ffd56e', '#7a3aa0', 0.5) + glow('back', 400, 130, 220, '#fff3c4', 0.5) + shelves +
      glow('core', 344, 196, 140, '#fff3a6', 0.95) +
      '<circle cx="344" cy="196" r="64" fill="' + rad('orb', [[0, '#fffbe0'], [0.55, '#ffe36e'], [1, '#f0a020']], 0.4, 0.35) + '" stroke="#fff" stroke-width="5"/>' +
      '<path d="M314 206c8-30 50-34 60-4s-28 32-38 12 12-24 22-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/>' +
      '<path d="M310 168a44 44 0 0 1 30 -22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>' +
      ground('M0 440V352C120 330 260 318 380 322S480 332 520 336V440Z', lin('desk', [[0, '#8a5ac0'], [1, '#2a1050']])) +
      '<path d="M150 344C260 324 380 318 520 334" stroke="#e9d6ff" stroke-width="4" fill="none" opacity=".7"/>' +
      '<path d="M300 344L284 298" stroke="#e9e4ff" stroke-width="6" stroke-linecap="round"/><circle cx="282" cy="294" r="11" fill="#ff6f7f" stroke="#fff" stroke-width="3"/>' +
      [[210, 366, '#ffe36e'], [236, 360, '#7fd8ff'], [330, 356, '#8ff0a0'], [356, 356, '#ff6f7f'], [382, 356, '#c49bff'], [500, 362, '#ffe36e']]
        .map(([x, y, c]) => '<circle cx="' + x + '" cy="' + y + '" r="8" fill="' + c + '" stroke="#fff" stroke-width="2"/>').join('') +
      '<rect x="404" y="350" width="80" height="36" rx="6" fill="#1a1035" stroke="#e9d6ff" stroke-width="2"/>' +
      '<path d="M410 370l10-8 10 12 10-16 10 14 10-6 14 4" fill="none" stroke="#ffe36e" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<g fill="#e9d6ff" opacity=".6"><rect x="200" y="392" width="60" height="6" rx="3"/><rect x="300" y="390" width="90" height="6" rx="3"/></g>' +
      sparkle(250, 230, 10) + sparkle(480, 280, 9) + sparkle(420, 250, 6);
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

  // A black panther stalking along a ledge under a purple moon, eyes glowing.
  'Black Panther': () => {
    const leaf = (x, y, h, a) => '<path d="M' + x + ' ' + y + 'C' + (x - 30) + ' ' + (y - h * 0.6) + ' ' + (x - 10) + ' ' + (y - h) + ' ' + x + ' ' + (y - h) + 'C' + (x + 10) + ' ' + (y - h) + ' ' + (x + 30) + ' ' + (y - h * 0.6) + ' ' + x + ' ' + y + 'Z" transform="rotate(' + a + ' ' + x + ' ' + y + ')"/>';
    const cat = 'M-118 -40C-118 -50 -110 -58 -100 -60L-96 -70L-90 -61C-80 -62 -70 -60 -62 -54C-40 -62 -10 -66 20 -64C50 -62 76 -58 92 -46C104 -38 108 -24 104 -12C102 -6 96 -2 92 0L80 0C82 -8 80 -16 74 -22C66 -14 60 -6 60 0L48 0C50 -10 52 -20 50 -28C30 -24 0 -24 -20 -28C-24 -18 -26 -8 -24 0L-36 0C-38 -10 -40 -20 -44 -30C-48 -20 -52 -10 -52 0L-64 0C-64 -14 -62 -26 -66 -34C-76 -32 -86 -30 -96 -30C-106 -30 -114 -32 -118 -40Z' +
      'M100 -40C130 -44 150 -30 156 -10C158 -2 152 0 150 -6C144 -24 128 -32 104 -30Z';
    return tint('#2a1a5a', '#8a2ab0', 0.6) + stars(141, 34, 120, W, 0, 200) +
      glow('mglow', 404, 176, 160, '#d7a6ff', 0.6) + '<circle cx="404" cy="176" r="86" fill="' + lin('mdisc', [[0, '#f3e4ff'], [1, '#b98cff']]) + '"/>' +
      '<g fill="#c9a6ff" opacity=".35"><circle cx="380" cy="150" r="12"/><circle cx="430" cy="200" r="8"/><circle cx="420" cy="140" r="5"/></g>' +
      '<g stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" fill="none"><path d="M262 40C276 70 286 100 290 130M282 34C296 64 306 94 310 124M302 30C316 60 326 90 330 120"/></g>' +
      '<g fill="#140826">' + [[160, 440, 80, -30], [220, 440, 100, -10], [500, 360, 120, 24], [520, 300, 90, 40], [470, 370, 70, 10]].map(([x, y, h, a]) => leaf(x, y, h, a)).join('') + '</g>' +
      '<path d="M0 440V400C100 390 180 370 240 362C300 352 400 356 520 350V440Z" fill="#140826"/>' +
      '<path d="M240 362C300 352 400 356 520 350" stroke="#c9a6ff" stroke-width="2" opacity=".5" fill="none"/>' +
      '<g transform="translate(372 358) scale(1.15)">' +
        '<path d="' + cat + '" fill="#0c0618" stroke="#c9a6ff" stroke-width="2.2" stroke-opacity=".85" stroke-linejoin="round"/>' +
        '<path d="M-110 -47C-107 -51 -100 -51 -97 -47C-100 -44 -107 -44 -110 -47Z" fill="#ffe36e"/>' +
        '<path d="M-74 -54C-70 -42 -66 -36 -60 -32" stroke="#e9e4ff" stroke-width="2" fill="none"/>' +
        '<path d="M-72 -46l-4 6 6-2ZM-68 -38l-3 6 6-3Z" fill="#e9e4ff"/></g>' +
      sparkle(480, 60, 10) + sparkle(250, 200, 7);
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

  // A golden headband with its red star, the lasso coiled below, over temple columns.
  'Wonder Woman': () => {
    const gold = lin('gold', [[0, '#fff3b0'], [1, '#d4922c']]);
    return tint('#ffcf5a', '#b0303a', 0.5) + stars(161, 30, 120, W, 0, 200) +
      '<g fill="#fff3c4" opacity=".25">' + [-60, -36, -12, 12, 36, 60].map(a => '<path d="M372 150L356 -40H388Z" transform="rotate(' + a + ' 372 150)"/>').join('') + '</g>' +
      glow('g', 372, 160, 190, '#ffe39a', 0.85) +
      '<g fill="none" stroke-width="8" stroke-linecap="round"><ellipse cx="384" cy="296" rx="112" ry="24" stroke="#d4922c"/><ellipse cx="388" cy="284" rx="96" ry="20" stroke="#f0bf4a"/><ellipse cx="392" cy="272" rx="80" ry="16" stroke="#ffe39a"/></g>' +
      '<path d="M274 300C250 330 262 360 300 372" fill="none" stroke="#f0bf4a" stroke-width="7" stroke-linecap="round"/>' +
      glow('lasso', 390, 284, 120, '#fff3b0', 0.45) +
      '<g transform="translate(374 170) scale(1.08)">' +
        '<path d="M-130 30C-70 -6 70 -6 130 30L126 50C70 18 -70 18 -126 50Z" fill="' + gold + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-118 38C-60 10 60 10 118 38" stroke="#b97a1f" stroke-width="2" fill="none"/>' +
        '<path d="M-46 14L0 -70L46 14C26 8 -26 8 -46 14Z" fill="' + gold + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-30 6L0 -48L30 6" stroke="#b97a1f" stroke-width="2" fill="none"/>' +
        '<g transform="translate(0 -16)"><path d="' + starPath(5, 22, 9) + '" fill="' + lin('ruby', [[0, '#ff6a6a'], [1, '#b0182f']]) + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></g></g>' +
      '<g fill="#3a0f2a"><path d="M300 338h220v12H300zM306 326h208l-14-12H320z"/>' +
        [320, 360, 400, 440, 480].map(x => '<rect x="' + x + '" y="350" width="18" height="70"/>').join('') +
        '<path d="M0 440V414H520V440Z"/></g>' +
      sparkle(480, 70, 13) + sparkle(260, 100, 9) + sparkle(300, 200, 6);
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

  // A black dragon with a red tail fin and a rider on its back, gliding through a sunset.
  'Hiccup': () => {
    const hide = lin('hide', [[0, '#2e2e44'], [1, '#0a0a14']]);
    return tint('#ff8a5c', '#2a2a6a', 0.55) + stars(221, 24, 120, W, 0, 110) +
      glow('sun', 330, 280, 200, '#ffc27a', 0.8) + '<circle cx="330" cy="290" r="54" fill="#ffe0a6"/>' +
      '<g fill="#ffb0a0" opacity=".55"><ellipse cx="260" cy="250" rx="90" ry="14"/><ellipse cx="460" cy="230" rx="80" ry="12"/><ellipse cx="400" cy="300" rx="120" ry="12"/></g>' +
      '<g fill="#c46a9a" opacity=".45"><ellipse cx="300" cy="120" rx="80" ry="16"/><ellipse cx="480" cy="150" rx="70" ry="14"/></g>' +
      '<g fill="#1a1035"><path d="M200 440V330L214 316L230 330V440Z"/><path d="M440 440V300L460 280L482 300V440Z"/><path d="M488 440V340L504 326L520 340V440Z"/></g>' +
      ground('M0 440V398C120 388 260 406 380 396S490 390 520 394V440Z', '#0c1a3a') +
      '<path d="M150 414c30-6 60 6 90 0s60-6 90 0 60 6 90 0 60-6 90 0" fill="none" stroke="#ffc27a" stroke-width="2" opacity=".5"/>' +
      '<g transform="translate(392 196) rotate(-10) scale(.95)">' +
        '<path d="M10 -14C24 -54 56 -92 116 -120C108 -96 112 -84 128 -76C116 -64 108 -50 112 -36C92 -30 62 -14 40 -6Z" fill="#16162a"/>' +
        '<path d="M96 -2C130 10 136 50 110 74C96 86 70 88 50 84L52 76C70 78 90 74 100 62C116 44 112 20 92 10Z" fill="' + hide + '"/>' +
        '<path d="M54 74L22 60L32 84Z" fill="#0a0a14"/><path d="M54 84L24 102L38 78Z" fill="#d8283a" stroke="#ff8a8a" stroke-width="1.5"/>' +
        '<path d="M-64 -6C-40 -24 20 -28 64 -16C84 -10 98 -2 108 4C96 14 80 16 60 16C20 22 -40 18 -64 8Z" fill="' + hide + '"/>' +
        '<path d="M-20 12L-30 34L-18 32L-8 14ZM50 12L52 36L62 32L64 14Z" fill="#0a0a14"/>' +
        '<path d="M-60 -6C-78 -16 -96 -22 -114 -20C-136 -18 -150 -6 -148 8C-146 20 -130 24 -112 22C-94 20 -78 14 -60 8Z" fill="' + hide + '"/>' +
        '<path d="M-100 -18L-82 -44L-86 -14ZM-110 -19L-104 -48L-96 -17ZM-90 -14L-66 -30L-74 -8Z" fill="#16162a"/>' +
        '<path d="M-132 -6C-126 -15 -112 -15 -106 -6C-112 1 -126 1 -132 -6Z" fill="#9ff05a"/><ellipse cx="-119" cy="-6" rx="1.8" ry="5" fill="#0a0a14"/>' +
        '<path d="M-146 10C-134 14 -122 14 -110 12" stroke="#4a4a6a" stroke-width="1.6" fill="none"/>' +
        '<path d="M-36 -20l6-10 4 10ZM-6 -25l6-10 4 10ZM24 -24l6-9 4 9ZM112 10l7-6 2 9ZM124 30l8-3-1 9Z" fill="#0a0a14"/>' +
        '<g fill="#0a0a14"><circle cx="-42" cy="-42" r="6"/><path d="M-48 -36H-36L-32 -18H-52Z"/><path d="M-36 -32L-24 -24" stroke="#0a0a14" stroke-width="3"/></g>' +
        '<path d="M-24 -16C-34 -60 -24 -112 18 -152C26 -122 44 -112 64 -110C60 -90 70 -76 86 -70C74 -54 60 -36 32 -18Z" fill="' + hide + '" stroke="#ff9a6a" stroke-width="1.5" stroke-opacity=".6"/>' +
        '<path d="M0 -20L18 -150M8 -20L62 -108M16 -18L84 -70" stroke="#4a4a6a" stroke-width="2.5" fill="none"/></g>' +
      sparkle(476, 70, 10) + sparkle(250, 160, 7);
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
