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

  // A magnifying glass over a trail of footprints in the fog, a gas lamp and
  // the chimneys of Baker Street under a full moon (Conan Doyle, public domain).
  'Sherlock Holmes': () => {
    const brass = lin('brass', [[0, '#ffe9a6'], [0.5, '#e0a33a'], [1, '#9a5a1a']], 0, 0, 1, 1);
    const lens = rad('lens', [[0, '#fffaf0', 0.95], [0.6, '#ffe8c0', 0.55], [1, '#d6c0ff', 0.25]], 0.38, 0.34);
    const fog = (y, o) => '<path d="M0 ' + y + 'C90 ' + (y - 14) + ' 170 ' + (y + 10) + ' 260 ' + (y - 4) + 'S430 ' + (y - 16) + ' 520 ' + (y - 2) + 'V' + (y + 26) + 'H0Z" fill="#fff" opacity="' + o + '"/>';
    const print = (x, y, a, s = 1) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')" fill="#2a0b3d" opacity=".75">' +
      '<ellipse cx="0" cy="0" rx="6" ry="10"/><ellipse cx="0" cy="15" rx="4.6" ry="5"/></g>';
    const chimneys = '<g fill="#1c0a2e">' +
      '<path d="M150 440V352H196V330H206V352H232V340H262V352H300V312H318V300H330V312H344V352H372V440Z"/>' +
      '<path d="M360 440V336H392V316H402V308H414V316H424V336H452V326H476V336H520V440Z"/></g>' +
      '<g fill="#ffd27a" opacity=".8"><rect x="214" y="372" width="9" height="13"/><rect x="236" y="372" width="9" height="13"/><rect x="392" y="356" width="9" height="13"/><rect x="470" y="356" width="9" height="13"/><rect x="448" y="384" width="9" height="13"/></g>';
    const smoke = '<path d="M408 304C398 290 418 280 406 266S414 244 404 232" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".18"/>';
    return tint('#1a1240', '#5a2a7a', 0.6) + stars(211, 30, 120, W, 0, 160) +
      glow('moon', 420, 92, 150, '#fff4d6', 0.55) +
      '<circle cx="420" cy="92" r="56" fill="' + rad('moonf', [[0, '#fffaf0'], [1, '#eadcc0']], 0.4, 0.35) + '"/>' +
      '<circle cx="404" cy="80" r="8" fill="#d8ccb0" opacity=".5"/><circle cx="436" cy="108" r="6" fill="#d8ccb0" opacity=".5"/>' +
      // The gas lamp on its post, haloed in fog.
      glow('lamp', 270, 214, 70, '#ffd98a', 0.7) +
      '<path d="M268 440V236H272V440Z" fill="#1c0a2e"/><path d="M258 236H282L278 226H262Z" fill="#1c0a2e"/>' +
      '<path d="M260 226L256 200H284L280 226Z" fill="#ffe7a8" stroke="#1c0a2e" stroke-width="3"/><path d="M254 200L270 188L286 200Z" fill="#1c0a2e"/>' +
      fog(300, 0.1) + chimneys + smoke + fog(360, 0.12) +
      // Footprints walking out of the fog toward the glass.
      print(176, 424, -18, 0.8) + print(206, 410, 14, 0.8) + print(236, 400, -12, 0.85) + print(270, 388, 16, 0.9) +
      '<g transform="translate(372 196) rotate(-24)">' +
        '<path d="M-10 70H10L14 168C14 178 -14 178 -14 168Z" fill="' + lin('handle', [[0, '#8a4a2a'], [1, '#3a1a0a']], 0, 0, 1, 0) + '" stroke="#2a0b10" stroke-width="3"/>' +
        '<rect x="-14" y="62" width="28" height="14" rx="4" fill="' + brass + '" stroke="#5a3010" stroke-width="2"/>' +
        '<circle r="70" fill="' + lens + '"/>' +
        '<g transform="translate(-4 4) rotate(24)" fill="#5a2a7a" opacity=".55"><ellipse cx="-8" cy="-10" rx="11" ry="18"/><ellipse cx="-8" cy="18" rx="8" ry="9"/>' +
          '<ellipse cx="20" cy="-22" rx="7" ry="12" opacity=".6"/></g>' +
        '<circle r="70" fill="none" stroke="' + brass + '" stroke-width="12"/><circle r="70" fill="none" stroke="#5a3010" stroke-width="2" opacity=".6"/>' +
        '<path d="M-44 -40A58 58 0 0 1 -6 -62" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75"/></g>' +
      sparkle(476, 210, 9) + sparkle(300, 120, 6) + fog(404, 0.1);
  },

  // A doctor's bag and an open casebook with its pen under the lit window of a
  // first-floor study, and a pocket watch (Conan Doyle, public domain). All of it kept to the right, clear of the card's write-up.
  'Dr Watson': () => {
    const leather = lin('bag', [[0, '#a8603a'], [1, '#4a2010']], 0, 0, 0, 1);
    const brass = lin('brass', [[0, '#ffe9a6'], [1, '#c98a2a']]);
    const page = lin('page', [[0, '#fffaf0'], [1, '#f0e2c8']], 0, 0, 1, 0);
    return tint('#2a1650', '#8a3a7a', 0.55) + stars(221, 26, 120, W, 0, 150) +
      // The window, lit from inside: the warm centrepiece.
      glow('win', 410, 128, 150, '#ffd98a', 0.75) +
      '<rect x="350" y="52" width="120" height="150" rx="6" fill="#3a1a4a"/>' +
      '<rect x="360" y="62" width="100" height="130" fill="' + lin('glass', [[0, '#fff0c4'], [1, '#ffc46a']]) + '"/>' +
      '<path d="M410 62V192M360 127H460" stroke="#3a1a4a" stroke-width="6"/>' +
      '<path d="M360 62C378 96 378 160 364 192" fill="#c2366a" opacity=".55"/><path d="M460 62C442 96 442 160 456 192" fill="#c2366a" opacity=".55"/>' +
      '<rect x="342" y="200" width="136" height="10" rx="3" fill="#3a1a4a"/>' +
      '<g fill="#3a1a4a" opacity=".85"><circle cx="440" cy="166" r="12"/><path d="M426 192C426 176 454 176 454 192Z"/></g>' +
      '<path d="M0 440V300C110 288 220 296 330 292S470 286 520 290V440Z" fill="#2a0b3d" opacity=".55"/>' +
      // The bag, open at the clasp.
      '<g transform="translate(424 300) scale(.84)">' +
        '<path d="M-38 -44C-38 -70 38 -70 38 -44" fill="none" stroke="#3a1608" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M-78 -30H78L90 54C92 66 84 72 72 72H-72C-84 72 -92 66 -90 54Z" fill="' + leather + '" stroke="#2a0e06" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M-82 -30C-60 -46 60 -46 82 -30" fill="none" stroke="#2a0e06" stroke-width="5"/>' +
        '<rect x="-84" y="-34" width="168" height="10" rx="5" fill="' + brass + '" stroke="#7a4a10" stroke-width="2"/>' +
        '<rect x="-12" y="-28" width="24" height="18" rx="4" fill="' + brass + '" stroke="#7a4a10" stroke-width="2"/>' +
        '<g fill="none" stroke="#ffd98a" stroke-width="2.2" stroke-dasharray="5 4" opacity=".7"><path d="M-70 -14H70M-72 58H72"/></g>' +
        '<path d="M-14 16H14M0 2V30" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".85"/></g>' +
      // The casebook, open, and the pen across it.
      '<g transform="translate(392 394) rotate(-8) scale(.62)">' +
        '<path d="M-64 -30C-40 -36 -14 -34 0 -24C14 -34 40 -36 64 -30V26C40 20 14 22 0 32C-14 22 -40 20 -64 26Z" fill="' + page + '" stroke="#7a4a3a" stroke-width="2.4"/>' +
        '<path d="M0 -24V32" stroke="#7a4a3a" stroke-width="2"/>' +
        '<g stroke="#8a6a8a" stroke-width="2" opacity=".6"><path d="M-54 -16C-38 -20 -22 -19 -10 -14M-54 -4C-38 -8 -22 -7 -10 -2M-54 8C-38 4 -22 5 -10 10M10 -14C22 -19 38 -20 54 -16M10 -2C22 -7 38 -8 54 -4"/></g>' +
        '<path d="M14 18L66 -40" stroke="#2a0b3d" stroke-width="5" stroke-linecap="round"/><path d="M60 -33L70 -44" stroke="' + brass + '" stroke-width="5" stroke-linecap="round"/></g>' +
      // A pocket watch on its chain.
      '<g transform="translate(482 398) scale(.8)"><path d="M-6 -18C-20 -30 -34 -26 -40 -14" fill="none" stroke="' + brass + '" stroke-width="2.6" stroke-dasharray="3 2"/>' +
        '<circle r="18" fill="' + brass + '" stroke="#7a4a10" stroke-width="2"/><circle r="13" fill="#fffaf0"/>' +
        '<path d="M0 0V-9M0 0L6 4" stroke="#3a1a4a" stroke-width="2" stroke-linecap="round"/><rect x="-3" y="-24" width="6" height="7" rx="2" fill="' + brass + '"/></g>' +
      ground('M0 440V418C120 410 260 422 380 414S480 410 520 412V440Z', '#1c0a2e') +
      sparkle(300, 92, 7) + sparkle(498, 250, 8);
  },

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

  // A voyaging canoe under a great crab-claw sail painted with a frigatebird and
  // stars, the sun going down behind it.
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
      // A frigatebird painted on the sail, the wayfinder's bird that points to land.
      '<path d="M352 176C366 160 380 156 392 170C404 154 424 150 442 160C428 160 412 166 400 180L392 190L384 180C376 172 364 170 352 176Z" fill="#b0563a"/>' +
      '<path d="M392 190L386 206L392 202L398 206Z" fill="#b0563a"/>' +
      '<g fill="#b0563a"><circle cx="346" cy="214" r="3"/><circle cx="438" cy="204" r="3"/><circle cx="420" cy="232" r="2.4"/><circle cx="364" cy="240" r="2.4"/></g>' +
      '<path d="M392 330L258 94M392 330L506 52" stroke="#5a2e14" stroke-width="7" stroke-linecap="round"/>' +
      hull(0, 0, lin('wood', [[0, '#8a4a22'], [1, '#2e160c']])) +
      '<path d="M222 340C232 352 244 356 262 356H470" stroke="#ffd9a0" stroke-width="2" opacity=".5" fill="none"/>' +
      ground('M0 440V384C60 374 120 392 180 384S300 374 360 386 460 376 520 382V440Z', '#062544') +
      '<path d="M40 400c20-6 40 6 60 0s40-6 60 0M220 404c20-6 40 6 60 0s40-6 60 0M400 398c20-6 40 6 60 0" fill="none" stroke="#7ff0e6" stroke-width="2" opacity=".6"/>' +
      sparkle(476, 150, 9) + sparkle(250, 60, 7);
  },

  // A tower with no door and a long golden braid falling from its one window,
  // under a crescent moon, rampion (the rapunzel the tale is named after) in
  // bloom in the witch's garden below (Grimm, 1812). No lanterns: those are
  // the 2010 film's.
  'Rapunzel': () => {
    const bell = lin('bell', [[0, '#c9b4ff'], [1, '#6a4ad8']]);
    const rampion = (x, y, s, lean = 0) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + lean + ') scale(' + s + ')">' +
      '<path d="M0 0C-2 -20 2 -40 0 -58" fill="none" stroke="#3f8a4a" stroke-width="2.6"/>' +
      [[-1, -54, -30], [1, -40, 30], [-1, -26, -26]].map(([side, by, a]) =>
        '<g transform="translate(' + side * 2 + ' ' + by + ') rotate(' + a + ')"><path d="M0 0V5" stroke="#3f8a4a" stroke-width="2"/>' +
        '<path d="M-6 5C-6 15 -4 19 -7 22H7C4 19 6 15 6 5Z" fill="' + bell + '"/><path d="M-7 22L-3 19L0 23L3 19L7 22" fill="none" stroke="#6a4ad8" stroke-width="1.6"/></g>').join('') +
      '<path d="M0 -8C-10 -12 -16 -8 -18 -2C-10 0 -4 -2 0 -8ZM0 -16C10 -20 16 -16 18 -10C10 -8 4 -10 0 -16Z" fill="#5ab04a"/></g>';
    const segs = [[[438, 166], [410, 180], [392, 214], [404, 250]], [[404, 250], [416, 290], [380, 316], [352, 340]], [[352, 340], [324, 364], [300, 396], [262, 424]]];
    const hair = 'M438 166C410 180 392 214 404 250C416 290 380 316 352 340C324 364 300 396 262 424C252 432 240 438 228 446';
    const blooms = [];
    segs.forEach(s => [0.25, 0.7].forEach(t => blooms.push(bez(...s, t))));
    const flower = ([x, y], i) => '<g fill="' + ['#ff8ab8', '#c49bff', '#fff'][i % 3] + '">' +
      [[0, -5], [5, -1], [3, 5], [-3, 5], [-5, -1]].map(([dx, dy]) => '<circle cx="' + n(x + dx) + '" cy="' + n(y + dy) + '" r="3.4"/>').join('') +
      '</g><circle cx="' + x + '" cy="' + y + '" r="2.4" fill="#ffd23c"/>';
    return tint('#2b2d7a', '#c4508f', 0.55) + stars(31, 60, 120, W, 0, 260) +
      glow('moonglow', 318, 92, 120, '#fff4d6', 0.5) +
      '<path d="M330 44A50 50 0 1 0 352 136A40 40 0 0 1 330 44Z" fill="' + lin('moon', [[0, '#fffaf0'], [1, '#ffe0a0']]) + '"/>' +
      sparkle(268, 160, 7) + sparkle(372, 232, 5) + sparkle(506, 210, 6) +
      '<path d="M0 440V392C90 380 190 396 280 386S380 376 420 384H520V440Z" fill="' + lin('lawn', [[0, '#3b2a7a', 0.95], [1, '#1c0f3a', 1]]) + '"/>' +
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
      blooms.map(flower).join('') + sparkle(480, 290, 8) +
      rampion(300, 420, 1, -6) + rampion(332, 428, 0.8, 8) + rampion(486, 410, 0.9, -4) + rampion(510, 424, 0.7, 10);
  },

  // A rabbit on a rooftop at dusk, rim-lit by the sunset, looking out over the city.
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
      '<g fill="#6a4a9a"><rect x="180" y="300" width="40" height="72"/><rect x="226" y="280" width="34" height="92"/><rect x="470" y="290" width="44" height="82"/></g>' +
      '<g fill="#ffe9a6" opacity=".7"><rect x="188" y="312" width="5" height="7"/><rect x="204" y="330" width="5" height="7"/><rect x="236" y="296" width="5" height="7"/><rect x="246" y="320" width="5" height="7"/><rect x="480" y="304" width="5" height="7"/><rect x="498" y="330" width="5" height="7"/></g>' +
      skyline(44, 130, W, 400, 20, 60, '#3a2266', '#ffd27a') +
      ground('M0 440V400H340V378H520V440Z', '#1a1035') +
      '<path d="M340 378H520" stroke="#ffb0c8" stroke-width="2" opacity=".6"/>' +
      glow('warm', 360, 330, 90, '#ff9a7a', 0.5) + glow('cool', 500, 330, 90, '#c49bff', 0.45) +
      '<g transform="translate(430 378) scale(1.02)">' +
        '<path d="' + bunny + '" fill="none" stroke="' + lin('rim', [[0, '#ffb08a'], [1, '#d6a8ff']], 0, 0, 1, 0) + '" stroke-width="6" stroke-linejoin="round"/>' +
        '<path d="' + bunny + '" fill="#1a1035"/>' +
        '<path d="M-1 -136C-5 -160 -4 -180 -1 -192" stroke="#ffb0c8" stroke-width="3" fill="none" opacity=".4" stroke-linecap="round"/>' +
        '<circle cx="-17" cy="-118" r="2.6" fill="#b48cff"/><circle cx="-28" cy="-113" r="2" fill="#ffb0c8"/></g>' +
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

  // A soft white pillow of a heart with a red first-aid badge (a white cross
  // on red; a red cross on white is the Red Cross's own emblem), over the
  // bridge and the city at dusk: care, not the robot.
  'Baymax': () => {
    const white = lin('body', [[0, '#ffffff'], [0.7, '#f1f2fa'], [1, '#cfd3e6']], 0, 0, 1, 1);
    const heart = (x, y, s, c) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 7C-9 1 -11 -4 -9 -7C-6 -11 -2 -10 0 -6C2 -10 6 -11 9 -7C11 -4 9 1 0 7Z" fill="' + c + '"/>';
    return tint('#8fd8ff', '#c45aa0', 0.5) + glow('g', 380, 190, 200, '#ffe1ec', 0.85) +
      '<g fill="#2a1240" opacity=".75"><rect x="214" y="230" width="12" height="170"/><rect x="500" y="230" width="12" height="170"/><path d="M130 360h390v10H130z"/></g>' +
      '<path d="M220 234C270 330 450 330 506 234M130 300C170 330 200 330 220 300" fill="none" stroke="#2a1240" stroke-width="4" opacity=".75"/>' +
      skyline(61, 130, W, 440, 20, 60, '#1c0f3a', '#ffd27a') +
      '<g transform="translate(378 196)">' +
        '<ellipse cx="0" cy="150" rx="110" ry="12" fill="#1c0f3a" opacity=".3"/>' +
        '<path d="M0 120C-70 72 -128 22 -128 -40C-128 -92 -90 -122 -50 -122C-24 -122 -8 -108 0 -88C8 -108 24 -122 50 -122C90 -122 128 -92 128 -40C128 22 70 72 0 120Z" fill="' + white + '" stroke="#b8bdd4" stroke-width="3"/>' +
        '<path d="M-96 -62C-90 -90 -66 -104 -44 -102" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" opacity=".9"/>' +
        '<path d="M-60 40C-30 70 30 70 60 40" stroke="#dfe2f0" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>' +
        '<g transform="translate(0 -22)"><rect x="-40" y="-40" width="80" height="80" rx="18" fill="' + lin('badge', [[0, '#ff6a7e'], [1, '#d8203c']]) + '" stroke="#fff" stroke-width="4"/>' +
          '<rect x="-9" y="-28" width="18" height="56" rx="3" fill="#fff"/><rect x="-28" y="-9" width="56" height="18" rx="3" fill="#fff"/></g></g>' +
      heart(262, 150, 1.6, '#ff8aa8') + heart(500, 110, 1.3, '#ffffff') + heart(486, 300, 1.1, '#ff8aa8') + heart(270, 300, 1, '#ffffff') +
      sparkle(476, 60, 11) + sparkle(262, 80, 8) + sparkle(300, 220, 6);
  },

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

  // A green seedling in a clay pot on a stack of weathered wooden crates, the
  // blue Earth rising behind: the plant, not the robot.
  'WALL-E': () => {
    const rust = lin('rust', [[0, '#e8b866'], [1, '#9a6230']]);
    const rust2 = lin('rust2', [[0, '#d09a52'], [1, '#74441e']]);
    // A wooden crate: planks, a frame and a cross brace.
    const cube = (x, y, s, f) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><rect x="-22" y="-22" width="44" height="44" rx="2" fill="' + f + '" stroke="#5a3418" stroke-width="2.5"/>' +
      '<path d="M-22 -8H22M-22 7H22" stroke="#5a3418" stroke-width="1.4" opacity=".5"/>' +
      '<path d="M-18 -18L18 18" stroke="#5a3418" stroke-width="3" opacity=".7"/><rect x="-22" y="-22" width="44" height="44" rx="2" fill="none" stroke="#7a4a20" stroke-width="5" opacity=".35"/>' +
      '<circle cx="-17" cy="-17" r="1.4" fill="#3a2010"/><circle cx="17" cy="-17" r="1.4" fill="#3a2010"/><circle cx="-17" cy="17" r="1.4" fill="#3a2010"/><circle cx="17" cy="17" r="1.4" fill="#3a2010"/></g>';
    return tint('#0f2b4f', '#5a2a7a', 0.6) + stars(81, 70, 120, W, 0, 330) +
      glow('atmo', 446, 62, 78, '#8fd8ff', 0.75) +
      '<circle cx="446" cy="62" r="44" fill="' + rad('earth', [[0, '#5fa8ff'], [0.55, '#1f5fc8'], [0.85, '#0f3a8a'], [1, '#08245a']], 0.35, 0.35) + '"/>' +
      // Soft cloud bands and a storm swirl, white on the ocean and kept to
      // the globe; no land drawn.
      (defs.push('<clipPath id="{id}-globe"><circle cx="446" cy="62" r="44"/></clipPath>'), '') +
      '<g clip-path="url(#{id}-globe)" fill="#fff">' +
        '<ellipse cx="430" cy="38" rx="34" ry="6" opacity=".55" transform="rotate(-12 430 38)"/>' +
        '<ellipse cx="460" cy="48" rx="26" ry="4" opacity=".4" transform="rotate(-8 460 48)"/>' +
        '<ellipse cx="438" cy="72" rx="40" ry="5" opacity=".5" transform="rotate(6 438 72)"/>' +
        '<ellipse cx="470" cy="86" rx="22" ry="4" opacity=".45" transform="rotate(10 470 86)"/>' +
        '<ellipse cx="426" cy="96" rx="26" ry="4" opacity=".35"/>' +
        '<path d="M452 60c-8-6-20-2-18 8s16 10 20 2-4-12-10-8" fill="none" stroke="#fff" stroke-width="3" opacity=".6" stroke-linecap="round"/>' +
        '<circle cx="430" cy="44" r="30" fill="' + rad('shine', [[0, '#ffffff', 0.35], [1, '#ffffff', 0]]) + '"/></g>' +
      // Night side.
      '<path d="M446 18A44 44 0 0 1 446 106A26 44 0 0 0 446 18Z" fill="#020a24" opacity=".55"/>' +
      '<circle cx="446" cy="62" r="44" fill="none" stroke="#bfe8ff" stroke-width="2.5" opacity=".8"/>' +
      '<circle cx="296" cy="64" r="10" fill="#d8d0f0"/><circle cx="292" cy="61" r="3" fill="#b8b0d8"/>' +
      '<g fill="#2a1f4a" opacity=".8"><path d="M150 380L190 300L230 330L262 270L300 380Z"/><path d="M440 380L470 310L500 330L520 300V380Z"/></g>' +
      ground('M0 440V380C120 370 260 384 400 376S490 370 520 372V440Z', '#1c1238') +
      // The crates, stacked in a pyramid.
      cube(300, 356, 1, rust2) + cube(346, 356, 1, rust) + cube(392, 356, 1, rust2) + cube(438, 356, 1, rust) + cube(484, 356, 1, rust2) +
      cube(323, 312, 1, rust) + cube(369, 312, 1, rust2) + cube(415, 312, 1, rust) + cube(461, 312, 1, rust2) +
      cube(346, 268, 1, rust2) + cube(392, 268, 1, rust) + cube(438, 268, 1, rust2) +
      // The clay pot on top, the seedling in it.
      '<g transform="translate(392 246)">' +
        '<path d="M-28 -44H16L10 0H-22Z" fill="' + lin('pot', [[0, '#e8865a'], [1, '#9a4426']], 0, 0, 1, 0) + '" stroke="#5a2414" stroke-width="3" stroke-linejoin="round"/>' +
        '<rect x="-34" y="-58" width="56" height="14" rx="3" fill="' + lin('rim', [[0, '#f09a6a'], [1, '#b0502c']], 0, 0, 1, 0) + '" stroke="#5a2414" stroke-width="3"/>' +
        '<path d="M-26 -56H16" stroke="#ffc49a" stroke-width="2" opacity=".6"/><ellipse cx="-6" cy="-58" rx="24" ry="3.4" fill="#4a2a18"/>' +
        '<path d="M-9 -60C-10 -80 -6 -96 -4 -108" stroke="#3f8f4a" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<path d="M-5 -92C-6 -110 -24 -120 -40 -116C-38 -100 -22 -92 -5 -92Z" fill="#6fe08a"/>' +
        '<path d="M-4 -104C-2 -122 16 -130 32 -126C30 -110 14 -102 -4 -104Z" fill="#8ff0a0"/></g>' +
      glow('plant', 388, 142, 40, '#8ff0a0', 0.5) +
      sparkle(262, 130, 8) + sparkle(250, 240, 6) + sparkle(500, 220, 7);
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

  // A glowing reactor ring over the city, two red-and-gold flight trails
  // spiralling up into a gold burst: the power and the flight, no suit.
  'Iron Man': () => {
    const red = lin('trail-r', [[0, '#ff6a52', 0], [0.6, '#e8303a', 0.85], [1, '#ff6a52']]);
    const gold = lin('trail-g', [[0, '#ffe9a6', 0], [0.6, '#f0b23c', 0.85], [1, '#ffe9a6']]);
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
      glow('g', 392, 170, 190, '#ffd27a', 0.75) +
      '<g fill="#ffe9a6" opacity=".22">' + Array.from({ length: 16 }, (_, i) => '<path d="M392 170L384 -40H400Z" transform="rotate(' + (i * 22.5) + ' 392 170)"/>').join('') + '</g>' +
      skyline(104, 130, W, 440, 40, 130, '#2a0e2e', '#ffd27a') +
      // Two trails rising from the city and curling round the ring.
      '<path d="M210 430C250 330 300 300 330 250C360 200 470 210 470 160" stroke="' + red + '" stroke-width="14" fill="none" stroke-linecap="round"/>' +
      '<path d="M250 440C290 350 320 330 350 290C390 236 480 250 494 196" stroke="' + gold + '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
      // More flight trails swooping round the reactor, red and orange, each
      // fading in from its tail.
      (() => {
        const trail = (name, c) => lin(name, [[0, c, 0], [0.55, c, 0.8], [1, '#ffe9a6', 0.95]], 0, 0, 1, 0);
        const loop = trail('loop-r', '#ff2a3a');
        const loop2 = trail('loop-r2', '#e8202e');
        const orange = trail('loop-o', '#ff8a2a');
        return '<g fill="none" stroke-linecap="round">' +
          '<path d="M250 120C280 40 420 30 486 92" stroke="' + loop + '" stroke-width="10"/>' +
          '<path d="M276 200C266 120 340 60 420 64" stroke="' + orange + '" stroke-width="6"/>' +
          '<path d="M300 300C380 330 470 290 500 210" stroke="' + loop + '" stroke-width="7"/>' +
          '<path d="M480 40C520 90 520 150 494 196" stroke="' + loop2 + '" stroke-width="5"/></g>';
      })() +
      '<g transform="translate(392 170)">' +
        glow('arc', 0, 0, 110, '#bff4ff', 0.9) +
        '<circle r="70" fill="#14223a" stroke="' + lin('rim', [[0, '#ffe9a6'], [1, '#d4922c']]) + '" stroke-width="10"/>' +
        '<circle r="54" fill="none" stroke="#7fd8ff" stroke-width="12" stroke-dasharray="14 7" opacity=".9"/>' +
        '<circle r="36" fill="' + rad('core', [[0, '#ffffff'], [0.55, '#dffaff'], [1, '#7fd8ff']]) + '"/>' +
        '<circle r="36" fill="none" stroke="#fff" stroke-width="3"/>' +
        '<path d="M-48 -30C-36 -50 -14 -60 6 -60" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".5"/></g>' +
      sparkle(270, 90, 10, '#ff6a52') + sparkle(486, 300, 8) + sparkle(300, 180, 6, '#ff6a52') + sparkle(500, 70, 9, '#ff3b3b') + sparkle(290, 300, 8, '#ff3b3b') + sparkle(470, 250, 6, '#ffd27a');
  },

  // A great white star bursting through red-and-white stripes in a blue
  // night: the colours and the star, never the shield.
  'Captain America': () => {
    let stripes = '';
    for (let i = 0; i < 7; i++) {
      const y = i * 46 + 6;
      stripes += '<path d="M120 ' + y + 'C220 ' + (y - 18) + ' 320 ' + (y + 22) + ' 520 ' + (y - 6) + 'v22C320 ' + (y + 44) + ' 220 ' + (y + 4) + ' 120 ' + (y + 22) + 'Z"/>';
    }
    return tint('#2b4bd0', '#c43050', 0.55) +
      '<g fill="#ff5a6e" opacity=".22">' + stripes + '</g>' + stars(111, 40, 120, W, 0, 260) +
      '<g fill="#fff" opacity=".2">' + Array.from({ length: 10 }, (_, i) => '<path d="M384 176L372 -40H396Z" transform="rotate(' + (i * 36) + ' 384 176)"/>').join('') + '</g>' +
      glow('g', 384, 176, 200, '#ffffff', 0.6) +
      '<g transform="translate(384 176)">' +
        '<path d="' + starPath(5, 118, 46) + '" fill="' + lin('star', [[0, '#ffffff'], [1, '#d6def8']]) + '" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>' +
        '<path d="' + starPath(5, 118, 46) + '" fill="none" stroke="#2b4bd0" stroke-width="3" stroke-linejoin="round" opacity=".25" transform="translate(5 6)"/>' +
        '<path d="M0 -118L0 0L-112 -36" fill="#fff" opacity=".6"/></g>' +
      '<g fill="none" stroke-linecap="round"><path d="M150 230C200 214 240 210 276 214" stroke="#fff" stroke-width="12" opacity=".3"/><path d="M170 270C210 252 240 246 270 246" stroke="#fff" stroke-width="7" opacity=".25"/></g>' +
      (() => {
        // Sparks bursting out from the star, red and blue by turns.
        const r = rng(113);
        let out = '';
        for (let i = 0; i < 30; i++) {
          const a = r() * Math.PI * 2;
          const d = 130 + r() * 90;
          const x = n(384 + Math.cos(a) * d);
          const y = n(176 + Math.sin(a) * d);
          const c = i % 2 ? '#ff3b4e' : '#4a7bff';
          const l = 10 + r() * 16;
          out += '<path d="M' + x + ' ' + y + 'l' + n(Math.cos(a) * l) + ' ' + n(Math.sin(a) * l) + '" stroke="' + c + '" stroke-width="' + n(3 + r() * 2.5) + '" stroke-linecap="round"/>' +
            '<circle cx="' + n(x + Math.cos(a) * (l + 9)) + '" cy="' + n(y + Math.sin(a) * (l + 9)) + '" r="' + n(2 + r() * 2.5) + '" fill="' + c + '"/>';
        }
        return out;
      })() +
      sparkle(300, 76, 14, '#ff8a9a') + sparkle(480, 290, 10, '#8ab0ff') + sparkle(250, 140, 7) + sparkle(500, 70, 9, '#8ab0ff') + sparkle(280, 260, 8, '#ff8a9a') +
      skyline(112, 130, W, 440, 30, 100, '#1a1240', '#ffe9a6');
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

  // A mountain cracking under a golden shockwave with a green edge, boulders in the air.
  'Hulk': () =>
    tint('#ffb44a', '#3a1a5a', 0.5) +
    '<g fill="#ffe0a0" opacity=".35">' + Array.from({ length: 12 }, (_, i) => '<path d="M380 150L366 -60H394Z" transform="rotate(' + (i * 30 + 8) + ' 380 150)"/>').join('') + '</g>' +
    glow('gg', 380, 150, 230, '#8fe06a', 0.55) + glow('g', 380, 150, 170, '#ffd27a', 0.8) +
    '<circle cx="380" cy="150" r="54" fill="' + rad('core', [[0, '#fff6d6'], [0.55, '#ffd56a'], [1, '#8fd85a']]) + '"/>' +
    '<g fill="none" stroke="#ffe6b0" stroke-linecap="round"><circle cx="380" cy="150" r="80" stroke-width="7" opacity=".85"/></g><g fill="none" stroke="#b8f08a" stroke-linecap="round"><circle cx="380" cy="150" r="118" stroke-width="4" opacity=".55"/><circle cx="380" cy="150" r="160" stroke-width="3" opacity=".35"/></g>' +
    '<path d="M300 0L290 50L316 58L280 120" fill="none" stroke="#fff6d6" stroke-width="5" stroke-linejoin="round"/>' +
    ground('M150 440V330L200 270L236 296L284 240L330 290L380 250L430 300L480 262L520 290V440Z', lin('mtn', [[0, '#3a4a4a'], [0.35, '#3a2a5a'], [1, '#1f0a2a']])) +
    '<path d="M284 240L296 300L276 340L304 400M380 250L372 320L396 380M480 262L470 330" fill="none" stroke="#ffc86a" stroke-width="4" stroke-linejoin="round"/>' +
    [[248, 120, 26, 20], [480, 70, 30, -15], [494, 200, 20, 40], [230, 210, 16, 10], [300, 30, 14, 30], [446, 250, 14, 60]]
      .map(([x, y, s, a]) => '<path d="M' + (x - s) + ' ' + y + 'l' + n(s * 0.7) + ' ' + (-s) + 'l' + n(s * 1.2) + ' ' + n(s * 0.3) + 'l' + n(s * 0.4) + ' ' + n(s * 1.2) + 'l' + n(-s) + ' ' + n(s * 0.6) + 'z" fill="#3a2a3a" stroke="#ffc86a" stroke-width="2" transform="rotate(' + a + ' ' + x + ' ' + y + ')"/>').join('') +
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

  // A thunderbolt striking a summer meadow under storm clouds, sparks in the
  // grass: the electricity, never the ball.
  'Pikachu': () => {
    const bolt = lin('bolt', [[0, '#fffbe0'], [1, '#ffd23c']]);
    return tint('#c9a020', '#2a1a6a', 0.6) +
      '<g fill="#2a1a4a" opacity=".75"><ellipse cx="300" cy="40" rx="110" ry="40"/><ellipse cx="440" cy="30" rx="120" ry="44"/><ellipse cx="380" cy="70" rx="90" ry="30"/><ellipse cx="500" cy="80" rx="60" ry="26"/></g>' +
      glow('g', 384, 230, 200, '#fff3a0', 0.9) +
      '<path d="M430 18L356 150H404L382 268L486 120H432L470 18Z" fill="' + bolt + '" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>' +
      '<path d="M430 18L356 150H404L382 268" fill="none" stroke="#ffb020" stroke-width="3" stroke-linejoin="round" opacity=".5"/>' +
      '<path d="M290 50L256 116H280L264 168L318 92H292L312 50Z" fill="#fff3a0" stroke="#fff" stroke-width="3" stroke-linejoin="round" opacity=".85"/>' +
      '<path d="M512 120L490 160H504L494 190L520 150Z" fill="#fff3a0" opacity=".8"/>' +
      '<g transform="translate(386 270)">' + glow('hit', 0, 0, 56, '#fff8c4', 0.9) + '</g>' +
      '<g fill="none" stroke="#fff3a0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M262 214l-22 18h16l-18 24"/><path d="M500 250l-18 14h12l-14 20"/><path d="M256 320l-16 12h10l-12 16"/></g>' +
      scatter(182, 18, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#fff8c4"/>', 250, 510, 100, 340) +
      '<g fill="#ff6a5a" opacity=".85"><circle cx="276" cy="270" r="9"/><circle cx="470" cy="300" r="7"/></g>' +
      '<path d="M0 440V356C110 340 230 362 330 350S470 336 520 342V440Z" fill="#5ab04a"/>' +
      // A great stadium on the hill: stone tiers and lit arches, a red rim,
      // floodlights raking the storm and banners on its crown. Generic, not
      // any game's own building.
      '<g transform="translate(384 334) scale(.92)">' +
        // Floodlight beams into the clouds, behind everything.
        '<path d="M-118 -96L-210 -330H-150Z" fill="#fff8d0" opacity=".16"/><path d="M118 -96L150 -330H210Z" fill="#fff8d0" opacity=".16"/>' +
        '<path d="M-118 -96L-120 -330H-70Z" fill="#fff8d0" opacity=".1"/><path d="M118 -96L70 -330H120Z" fill="#fff8d0" opacity=".1"/>' +
        // The bowl's light, rising from inside.
        '<ellipse cx="0" cy="-58" rx="104" ry="20" fill="' + rad('bowl', [[0, '#fffbe0', 0.95], [0.6, '#ffd23c', 0.6], [1, '#ffd23c', 0]]) + '"/>' +
        // The walls: upper tier, then the lower with its arches.
        '<path d="M-124 -56C-124 -76 124 -76 124 -56V-30H-124Z" fill="' + lin('tier', [[0, '#5a4a7a'], [1, '#2a1f4a']]) + '" stroke="#1a1030" stroke-width="2"/>' +
        '<path d="M-124 -56C-90 -46 90 -46 124 -56" stroke="#c01a2a" stroke-width="8" fill="none"/>' +
        '<path d="M-124 -60C-90 -50 90 -50 124 -60" stroke="#ff6a5a" stroke-width="2.5" fill="none"/>' +
        '<path d="M-132 -30H132V40H-132Z" fill="' + lin('wall', [[0, '#3e3260'], [1, '#1a1030']]) + '" stroke="#1a1030" stroke-width="2"/>' +
        Array.from({ length: 11 }, (_, k) => -110 + k * 22).map(x =>
          '<path d="M' + (x - 7) + ' 30V-6A7 7 0 0 1 ' + (x + 7) + ' -6V30Z" fill="#ffd96a" opacity=".85"/>').join('') +
        Array.from({ length: 12 }, (_, k) => -118 + k * 21.5).map(x => '<rect x="' + n(x) + '" y="-44" width="7" height="8" fill="#ffe9a6" opacity=".7"/>').join('') +
        '<path d="M-132 -30H132" stroke="#c01a2a" stroke-width="4"/>' +
        // The great gate, with the bolt over it.
        '<path d="M-22 40V2A22 22 0 0 1 22 2V40Z" fill="' + lin('gate', [[0, '#fff3b0'], [1, '#ffb020']]) + '" stroke="#1a1030" stroke-width="3"/>' +
        '<path d="M4 -24L-6 -12H1L-4 -2L8 -16H1L6 -24Z" fill="#ffd23c" stroke="#1a1030" stroke-width="1.5" stroke-linejoin="round"/>' +
        // Floodlight towers.
        '<g fill="#1a1030"><path d="M-122 40L-118 -96H-112L-108 40Z"/><path d="M108 40L112 -96H118L122 40Z"/></g>' +
        '<g fill="#fff8d0" stroke="#1a1030" stroke-width="2"><rect x="-130" y="-108" width="30" height="14" rx="2"/><rect x="100" y="-108" width="30" height="14" rx="2"/></g>' +
        glow('fl1', -115, -101, 26, '#fff8d0', 0.8) + glow('fl2', 115, -101, 26, '#fff8d0', 0.8) +
        // Banners along the crown.
        [-84, -42, 42, 84].map((x, k) => '<path d="M' + x + ' -68V-94" stroke="#1a1030" stroke-width="2"/><path d="M' + x + ' -94H' + (x + 16) + 'L' + (x + 11) + ' -88L' + (x + 16) + ' -82H' + x + 'Z" fill="' + (k % 2 ? '#ffd23c' : '#e8303a') + '"/>').join('') +
      '</g>' +
      '<path d="M0 440V392C120 378 250 400 360 388S480 382 520 386V440Z" fill="#2f7d3a"/>' +
      '<g stroke="#2f7d3a" stroke-width="3" stroke-linecap="round">' + [250, 286, 330].map(x => '<path d="M' + x + ' 352l-4 -12M' + (x + 6) + ' 352l2 -14M' + (x + 12) + ' 352l6 -10"/>').join('') + '</g>';
  },

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

  // A country bus stop in the rain under a camphor tree: a red umbrella and a
  // grey one open side by side, and a great leaf held up like a third,
  // fireflies and acorns at their feet. The things, never the spirit.
  'Totoro': () => {
    const leaf = lin('leaf', [[0, '#3f7a52'], [1, '#163a26']]);
    let crown = '';
    for (const [x, y, r] of [[320, 40, 56], [400, 20, 66], [480, 34, 60], [530, 80, 50], [360, 80, 40]]) crown += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
    // An open umbrella: a scalloped canopy, its ribs, a shaft and a crook.
    const brolly = (x, y, s, a, top, bottom, rib) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')">' +
      '<path d="M0 0V112" stroke="#2a2a3a" stroke-width="5"/><path d="M0 112c0 14-16 14-16 2" stroke="#2a2a3a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M-86 0C-86 -52 -44 -80 0 -80C44 -80 86 -52 86 0Q64 -12 43 0Q22 -12 0 0Q-22 -12 -43 0Q-64 -12 -86 0Z" fill="' + lin('b' + x, [[0, top], [1, bottom]]) + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M0 -80V0M0 -80C-24 -60 -40 -30 -43 0M0 -80C24 -60 40 -30 43 0" stroke="' + rib + '" stroke-width="2" fill="none"/>' +
      '<path d="M0 -80V-94" stroke="#2a2a3a" stroke-width="4"/>' +
      '<path d="M-60 -40C-50 -60 -30 -72 -10 -76" stroke="#fff" stroke-width="5" fill="none" opacity=".4" stroke-linecap="round"/></g>';
    return tint('#3a9f6a', '#1a2a4a', 0.6) +
      glow('mg', 300, 120, 90, '#f2ead2', 0.45) +
      '<circle cx="300" cy="120" r="34" fill="' + lin('moon', [[0, '#fbf6e6'], [1, '#e0d6b8']]) + '" opacity=".9"/>' +
      '<g fill="' + leaf + '">' + crown + '</g><g fill="#6aa878" opacity=".4"><ellipse cx="400" cy="60" rx="40" ry="14"/><ellipse cx="490" cy="70" rx="30" ry="10"/></g>' +
      '<path d="M500 440C504 300 506 180 512 100L530 100V440Z" fill="#2a1e1a"/>' +
      '<g stroke="#cfeaff" stroke-width="2" stroke-linecap="round" opacity=".5">' +
        scatter(191, 50, (x, y) => '<path d="M' + x + ' ' + y + 'l-6 18"/>', 120, W, 0, 380) + '</g>' +
      glow('lamp', 236, 236, 60, '#fff3c4', 0.6) +
      '<g fill="#0c2016"><rect x="232" y="250" width="7" height="150"/><circle cx="235.5" cy="242" r="18"/></g><circle cx="235.5" cy="242" r="11" fill="#ffe9a6" opacity=".4"/>' +
      glow('g', 400, 230, 150, '#c9ffd6', 0.35) +
      // The bus-stop sign: a plate of times on a post.
      '<g transform="translate(270 300)"><rect x="-3" y="0" width="6" height="104" fill="#3a3a48"/>' +
        '<rect x="-20" y="-40" width="40" height="44" rx="6" fill="#f2ead2" stroke="#3a3a48" stroke-width="4"/>' +
        '<path d="M-11 -28H11M-11 -18H11M-11 -8H5" stroke="#3a3a48" stroke-width="3" stroke-linecap="round"/></g>' +
      // The great leaf, held up on its stem like an umbrella.
      '<g transform="translate(452 236) rotate(8) scale(.9)">' +
        '<path d="M0 0V170" stroke="#2f6a3a" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M0 8C-46 10 -84 -18 -88 -60C-60 -54 -30 -70 -6 -98C-2 -80 2 -80 6 -98C30 -70 60 -54 88 -60C84 -18 46 10 0 8Z" fill="' + lin('taro', [[0, '#7ad87a'], [1, '#2f8a44']]) + '" stroke="#d8ffd0" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="M0 6V-84M0 -10C-20 -24 -44 -36 -70 -46M0 -10C20 -24 44 -36 70 -46M0 -36C-14 -52 -26 -66 -36 -78M0 -36C14 -52 26 -66 36 -78" stroke="#2f6a3a" stroke-width="2" fill="none" opacity=".7"/></g>' +
      // The grey umbrella and the red one, open in the rain.
      brolly(388, 256, 0.72, -6, '#a8a8b8', '#5a5a6e', '#3a3a4e') +
      brolly(318, 238, 0.82, -14, '#ff6a5a', '#b01a2a', '#7a0a18') +
      ground('M0 440V398C120 386 260 404 380 394S490 390 520 392V440Z', '#0c2016') +
      '<g fill="#7fb8d8" opacity=".35"><ellipse cx="300" cy="414" rx="40" ry="5"/><ellipse cx="440" cy="420" rx="34" ry="4"/></g>' +
      [[456, 410, 1.3], [480, 416, 1.1], [384, 412, 1.2], [270, 420, 1]].map(([x, y, k]) => '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')"><ellipse cx="0" cy="1" rx="6" ry="8" fill="#b8843e"/><path d="M-7 -3C-5 -10 5 -10 7 -3Z" fill="#5a3a1a"/><path d="M0 -9V-12" stroke="#5a3a1a" stroke-width="2"/></g>').join('') +
      scatter(192, 14, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="#f6ff9a"/><circle cx="' + x + '" cy="' + y + '" r="7" fill="#f6ff9a" opacity=".25"/>', 200, 500, 300, 390);
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

  // A book open in the air above a domed library tower with lit windows, a
  // wand trailing sparks across its pages, fireflies in the dark.
  'Hermione Granger': () => {
    const halo = rad('cg', [[0, '#ffe08a', 0.7], [1, '#ffe08a', 0]]);
    const firefly = (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(7 + r() * 5) + '" fill="' + halo + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.6 + r() * 1.2) + '" fill="#fff6c4"/>';
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
      scatter(402, 14, (x, y, r) => firefly(x, y, r), 160, 510, 60, 330) +
      glow('g', 390, 186, 170, '#ffe2a0', 0.75) +
      '<path d="M390 158C356 140 312 138 282 148L282 236C312 226 356 228 390 246C424 228 468 226 498 236L498 148C468 138 424 140 390 158Z" fill="#7a1a2a" stroke="#f0c050" stroke-width="2"/>' +
      page(1) + page(-1) + '<path d="M390 150V232" stroke="#c9a46a" stroke-width="2"/>' +
      '<path d="M354 148c6-10 14-14 22-12M404 136c8-2 16 2 22 12" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>' +
      '<g transform="translate(456 170) rotate(-35)"><rect x="-4" y="0" width="8" height="120" rx="3" fill="' + lin('wand', [[0, '#8a5a2a'], [1, '#3a200e']], 0, 0, 1, 0) + '"/>' +
        '<path d="M-5 74h10M-5 84h10M-5 94h10" stroke="#c9945a" stroke-width="2.4"/><circle cy="0" r="4" fill="#fff6c4"/></g>' +
      trail +
      '<path d="M0 440V360C90 350 200 362 280 352S440 340 520 348V440Z" fill="#1c0b30"/>' +
      // The library: a long hall of arched windows and a round domed tower.
      '<g fill="#140826"><rect x="304" y="322" width="200" height="50"/><path d="M300 324H508L504 316H304Z"/>' +
        '<rect x="404" y="268" width="52" height="104"/><path d="M398 270H462V262H398Z"/>' +
        '<path d="M404 262A26 26 0 0 1 456 262Z"/><path d="M430 236V226" stroke="#140826" stroke-width="3"/><circle cx="430" cy="224" r="3"/></g>' +
      '<g fill="#ffd27a" opacity=".85">' + [314, 336, 358, 380, 470, 490].map(x => '<path d="M' + x + ' 360V342A5 5 0 0 1 ' + (x + 10) + ' 342V360Z"/>').join('') +
        [416, 436].map(x => '<path d="M' + x + ' 300V286A4 4 0 0 1 ' + (x + 8) + ' 286V300Z"/><path d="M' + x + ' 336V322A4 4 0 0 1 ' + (x + 8) + ' 322V336Z"/>').join('') + '</g>' +
      '<rect x="0" y="372" width="520" height="68" fill="' + lin('lake', [[0, '#2a1450'], [1, '#0e0620']]) + '"/>' +
      '<g fill="#ffd27a" opacity=".35">' + [[322, 384], [376, 392], [436, 386], [482, 396]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="5" height="16" rx="2.5"/>').join('') + '</g>';
  },

  // A crown of peach blossom above a pink-roofed castle on green hills,
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
        // A thin gold band, and a ring of peach blossom and leaves along it.
        '<path d="M-82 40C-60 58 60 58 82 40" fill="none" stroke="' + gold + '" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M-82 40C-60 58 60 58 82 40" fill="none" stroke="#fff" stroke-width="2" opacity=".7"/>' +
        [[-74, 24, -40], [-52, 6, -20], [-24, -4, -8], [24, -4, 8], [52, 6, 20], [74, 24, 40], [-40, 38, -30], [40, 38, 30]]
          .map(([x, y, a]) => '<path d="M' + x + ' ' + y + 'c-6-14 4-26 16-28c-2 14-8 24-16 28z" fill="#5ab04a" transform="rotate(' + a + ' ' + x + ' ' + y + ')"/>').join('') +
        [[-66, 30, 1], [-40, 10, 1.1], [0, -14, 1.35], [40, 10, 1.1], [66, 30, 1], [-18, 26, 0.9], [18, 26, 0.9]].map(([x, y, k]) =>
          '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')">' + [0, 72, 144, 216, 288].map(a =>
            '<ellipse cx="0" cy="-9" rx="7" ry="9.5" fill="' + lin('pet', [[0, '#fff0f4'], [1, '#ff8ab0']]) + '" stroke="#fff" stroke-width="1.4" transform="rotate(' + a + ')"/>').join('') +
          '<circle r="5" fill="#ffd23c"/><circle r="2" fill="#ff8a3a"/></g>').join('') + '</g>' +
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


};

// ---------- redrawn scenes ----------
//
// Eight scenes that leaned on a studio's own design (Hello Kitty's bow,
// Kuromi's winged skull-heart, Sailor Moon's brooch, Joy's memory orbs, Wonder
// Woman's star tiara, Toothless's red fin, Pride Rock, Shrek's stump house),
// redrawn from generic things (21 October 2026). They live in tools/art/,
// built from the same blocks as the reserve below. Their emblems are copied
// into EMBLEM_PATHS in docs/copy.js, which is what the app reads.
const { readdirSync } = await import('node:fs');
const artDir = new URL('./art/', import.meta.url);
for (const file of readdirSync(artDir).filter(f => /\.mjs$/.test(f)).sort()) {
  const made = (await import(new URL(file, artDir))).default({ W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter });
  Object.assign(SCENES, made.scenes || {});
}

// ---------- the reserve ----------
//
// Replacements drawn in advance, from public-domain stories, for the studio
// characters still in the catalogue, in case one has to go at short notice.
// Each tools/reserve/art-*.mjs exports a function given these building blocks
// and returning { scenes, emblems }. Nothing in docs/ reads them: they are
// written to tools/reserve/character-art-reserve.js, and moving one into the
// catalogue is a matter of moving its drawing up into SCENES.
const HELPERS = { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter };
const reserveDir = new URL('./reserve/', import.meta.url);
const reserve = {};
const reserveEmblems = {};
// RESERVE_ONLY=art-x.mjs RESERVE_OUT=path builds that one file alone, for a
// preview, and leaves docs/ and the reserve file untouched.
const only = process.env.RESERVE_ONLY;
for (const file of readdirSync(reserveDir).filter(f => /^art-.*\.mjs$/.test(f) && (!only || f === only)).sort()) {
  const made = (await import(new URL(file, reserveDir))).default(HELPERS);
  for (const [name, draw] of Object.entries(made.scenes || {})) reserve[name] = scene(draw);
  Object.assign(reserveEmblems, made.emblems || {});
}
writeFileSync(only ? process.env.RESERVE_OUT : root + 'tools/reserve/character-art-reserve.js', '// Generated by tools/character-art.mjs from tools/reserve/art-*.mjs.\n' +
  '// Backup scenes and emblems, not served: see the reserve section there.\n' +
  '(function (root) {\n  \'use strict\';\n  root.PsycheCharacterArtReserve = ' + JSON.stringify({ scenes: reserve, emblems: reserveEmblems }, null, 1).replace(/\n/g, '\n  ') + ';\n' +
  '})(typeof window !== \'undefined\' ? window : globalThis);\n');
if (Object.keys(reserve).length) console.log('reserve: ' + Object.keys(reserve).join(', '));
if (only) process.exit(0);

// ---------- write ----------

// Mulan is the first scene, as she has always been; her drawing is tools/art/mulan.mjs.
const art = { Mulan: '' };
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
