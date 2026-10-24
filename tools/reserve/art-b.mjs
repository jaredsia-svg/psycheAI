// Reserve scenes, batch B: Dorothy, Snow White, King Arthur, Hercules.
// Drawn from the public-domain stories' own things (Baum's 1900
// book, Grimm 1812, the Arthurian legend, Greek myth), never from a film.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, scatter } = h;

  const scenes = {

    // The yellow brick road winding up to a glowing green Emerald City, a
    // cyclone far off in the sky, and the book's silver shoes on the road.
    'Dorothy': () => {
      const green = lin('emer', [[0, '#c8ffd8'], [0.5, '#4fd88a'], [1, '#0f7a4a']]);
      const greenDark = lin('emerd', [[0, '#5fe39a'], [1, '#0a5a38']]);
      // The city: a cluster of spires, tallest in the middle.
      const spire = (x, w, top, base, fill) => '<path d="M' + x + ' ' + base + 'V' + (top + w) + 'L' + (x + w / 2) + ' ' + top + 'L' + (x + w) + ' ' + (top + w) + 'V' + base + 'Z" fill="' + fill + '"/>';
      const city = spire(356, 26, 150, 262, greenDark) + spire(380, 30, 118, 262, green) + spire(408, 40, 74, 262, green) +
        spire(446, 30, 112, 262, green) + spire(474, 26, 146, 262, greenDark) + spire(496, 22, 170, 262, greenDark) +
        '<g fill="#eafff0" opacity=".85">' + [[424, 120], [424, 150], [424, 180], [392, 170], [392, 200], [458, 160], [458, 190], [366, 200], [484, 200]]
          .map(([x, y]) => '<rect x="' + (x - 2.5) + '" y="' + y + '" width="5" height="9" rx="2.5"/>').join('') + '</g>' +
        '<path d="M350 262H520" stroke="#0a5a38" stroke-width="4"/>';
      const road = 'M196 440C250 420 330 408 330 376C330 346 270 340 290 310C306 288 370 286 400 268';
      const silver = lin('silv', [[0, '#ffffff'], [0.45, '#e4e8f4'], [1, '#8a92b0']]);
      // A low-heeled shoe in profile, toe to the left.
      const shoe = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
        '<path d="M-30 6C-32 -4 -24 -10 -14 -9C-4 -8 6 -12 14 -20C18 -24 24 -24 26 -18L28 6Z" fill="' + silver + '" stroke="#4a4f6a" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="M-32 6H28V10H-30Z" fill="#6a7090"/><path d="M18 10H28V22H22Z" fill="#6a7090" stroke="#4a4f6a" stroke-width="1.4"/>' +
        '<path d="M-6 -9C2 -4 10 -6 16 -14" fill="none" stroke="#4a4f6a" stroke-width="1.6"/>' +
        '<path d="M-24 -2C-16 -4 -10 -4 -4 -6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/></g>';
      const poppy = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 0V14" stroke="#1f5a2a" stroke-width="2"/>' +
        '<g fill="#ff3a4a"><circle cx="-4" cy="-2" r="5"/><circle cx="4" cy="-2" r="5"/><circle cx="0" cy="-6" r="5"/></g><circle cx="0" cy="-3" r="2" fill="#2a0b1a"/></g>';
      return tint('#ff9ad2', '#4a1f8a', 0.5) + stars(611, 26, 160, W, 0, 140) +
        // The cyclone, far off and small.
        '<g fill="none" stroke="#f3e6ff" stroke-linecap="round" opacity=".5"><path d="M236 34C262 28 300 30 318 38" stroke-width="5"/>' +
          '<path d="M244 48C266 44 296 46 308 52" stroke-width="4"/><path d="M254 62C270 60 290 62 298 66" stroke-width="3.5"/>' +
          '<path d="M262 76C274 76 284 78 288 82" stroke-width="3"/><path d="M270 90C276 92 280 96 278 102" stroke-width="2.5"/></g>' +
        glow('cg', 430, 190, 170, '#b6ffd0', 0.7) + city +
        sparkle(430, 54, 10, '#eafff0') + sparkle(500, 120, 7, '#eafff0') + sparkle(352, 128, 6, '#eafff0') +
        ground('M0 440V300C90 280 200 300 300 280S440 258 520 262V440Z', lin('hill', [[0, '#6a3aa8'], [1, '#3a1660']])) +
        // The road: dark edge, gold body, brick joints.
        '<path d="' + road + '" fill="none" stroke="#a8641a" stroke-width="40" stroke-linecap="round"/>' +
        '<path d="' + road + '" fill="none" stroke="' + lin('gold', [[0, '#fff0a0'], [1, '#f0b030']]) + '" stroke-width="34" stroke-linecap="round"/>' +
        '<path d="' + road + '" fill="none" stroke="#c98a1f" stroke-width="30" stroke-dasharray="2 12" opacity=".8"/>' +
        '<path d="' + road + '" fill="none" stroke="#c98a1f" stroke-width="1.6" opacity=".6"/>' +
        ground('M0 440V392C80 380 150 396 210 404L196 440ZM330 440C340 410 400 396 520 392V440Z', '#2a0f48') +
        poppy(246, 402, 1) + poppy(226, 414, 0.8) + poppy(356, 398, 0.9) + poppy(470, 404, 1.1) + poppy(500, 418, 0.8) + poppy(420, 414, 0.85) +
        glow('sg', 440, 372, 60, '#ffffff', 0.35) + shoe(420, 366, 1.1) + shoe(468, 380, 1.1) +
        sparkle(450, 334, 10) + sparkle(496, 352, 6) + sparkle(396, 350, 5);
    },

    // A red apple on the sill of an ebony-framed window, snow falling past,
    // a small lit cottage among snowy pines below.
    'Snow White': () => {
      const ebony = '#1a0a24';
      const pine = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 -60L-22 -18H-12L-30 14H-8L-26 40H26L8 14H30L12 -18H22Z" fill="#2a1442"/>' +
        '<path d="M0 -60L-10 -40L0 -44L10 -40ZM-12 -18L-20 -6L-8 -10L4 -6ZM-8 14L-18 26L-2 22L12 26Z" fill="#fff" opacity=".85"/><rect x="-4" y="40" width="8" height="10" fill="#1a0a24"/></g>';
      return tint('#c9b8ff', '#4a1f7a', 0.55) +
        glow('wg', 410, 150, 170, '#fff4fb', 0.75) +
        // The window: glass glow inside an ebony frame with a cross of bars.
        '<rect x="330" y="46" width="160" height="196" rx="10" fill="' + lin('glass', [[0, '#fff8ff'], [1, '#d8c6ff']]) + '"/>' +
        scatter(71, 22, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.6 + r() * 2.4) + '" fill="#b9a6e8" opacity=".7"/>', 340, 480, 56, 232) +
        '<path d="M330 56A10 10 0 0 1 340 46H480A10 10 0 0 1 490 56V242H330ZM344 60V228H476V60Z" fill="' + ebony + '" fill-rule="evenodd"/>' +
        '<path d="M410 60V228M344 144H476" stroke="' + ebony + '" stroke-width="8"/>' +
        '<path d="M322 242H498V258H322Z" fill="' + lin('sill', [[0, '#3a1f4a'], [1, ebony]]) + '"/>' +
        '<path d="M322 244H498" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".9"/>' +
        // The apple on the sill, its glow and its shine.
        glow('ag', 410, 214, 60, '#ff6a8a', 0.5) +
        '<g transform="translate(410 214)"><path d="M0 -20C-12 -32 -40 -28 -40 2C-40 28 -20 40 0 34C20 40 40 28 40 2C40 -28 12 -32 0 -20Z" fill="' + lin('red', [[0, '#ff5a6a'], [1, '#a8102a']], 0, 0, 1, 1) + '"/>' +
          '<path d="M0 -20V-36" stroke="#5a2e14" stroke-width="4" stroke-linecap="round"/><path d="M2 -32C10 -46 26 -44 30 -38C22 -30 10 -28 2 -32Z" fill="#5ab04a"/>' +
          '<ellipse cx="-18" cy="-6" rx="6" ry="11" fill="#fff" opacity=".55" transform="rotate(20 -18 -6)"/></g>' +
        sparkle(452, 186, 8) + sparkle(296, 80, 8) + sparkle(506, 300, 6) +
        ground('M0 440V318C100 300 220 320 320 306S460 296 520 300V440Z', '#3a1f5a') +
        '<path d="M0 320C100 302 220 322 320 308S460 298 520 302" fill="none" stroke="#fff" stroke-width="6" opacity=".8"/>' +
        pine(250, 330, 0.9) + pine(286, 318, 1.1) + pine(512, 330, 1) +
        // The cottage, lit, with snow on its roof.
        '<g transform="translate(398 324)"><path d="M-42 4L0 -34L42 4Z" fill="#5a2e4a"/><path d="M-46 6L0 -36L46 6" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>' +
          '<rect x="-32" y="4" width="64" height="44" fill="#7a4a5a"/><path d="M-6 48V26A6 6 0 0 1 6 26V48Z" fill="#2a0f2a"/>' +
          '<rect x="-24" y="14" width="12" height="12" fill="#ffe3a0"/><rect x="12" y="14" width="12" height="12" fill="#ffe3a0"/>' +
          '<rect x="20" y="-30" width="9" height="20" fill="#5a2e4a"/></g>' +
        glow('cw', 398, 344, 50, '#ffd27a', 0.35) +
        ground('M0 440V390C110 378 230 396 340 386S470 378 520 384V440Z', '#f3ecff') +
        '<path d="M0 404C120 394 240 410 360 400S480 394 520 398V440H0Z" fill="#d8ccf2"/>' +
        scatter(72, 46, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.4 + r() * 2.8) + '" fill="#fff" opacity="' + n(0.55 + r() * 0.45) + '"/>', 120, W, 0, 380);
    },

    // The sword in the stone at dawn, Camelot's towers on the hill behind,
    // light breaking round the blade.
    'King Arthur': () => {
      const tower = (x, w, top, base, roof) => '<rect x="' + x + '" y="' + top + '" width="' + w + '" height="' + (base - top) + '"/>' +
        (roof ? '<path d="M' + (x - 4) + ' ' + top + 'L' + (x + w / 2) + ' ' + (top - w * 1.2) + 'L' + (x + w + 4) + ' ' + top + 'Z"/>'
          : '<path d="M' + x + ' ' + top + 'v-8h' + n(w / 5) + 'v8h' + n(w / 5) + 'v-8h' + n(w / 5) + 'v8h' + n(w / 5) + 'v-8h' + n(w / 5) + 'v8z"/>');
      const blade = lin('blade', [[0, '#ffffff'], [0.5, '#f4f1ff'], [0.5, '#c6bde8'], [1, '#e9e4ff']], 0, 0, 1, 0);
      const gold = lin('hilt', [[0, '#ffe9a6'], [1, '#d9962a']]);
      return tint('#ffb37a', '#5a2a8a', 0.55) + stars(911, 18, 160, W, 0, 90) +
        glow('sun', 408, 150, 190, '#ffe2a6', 0.8) +
        '<circle cx="408" cy="168" r="58" opacity=".85" fill="' + lin('disc', [[0, '#fff6d6'], [1, '#ffc27a']]) + '"/>' +
        '<g stroke="#fff3d0" stroke-width="3" opacity=".45">' + [-60, -35, -12, 12, 35, 60].map(a => {
          const r = a * Math.PI / 180;
          return '<path d="M' + n(408 + 70 * Math.sin(r)) + ' ' + n(168 - 70 * Math.cos(r)) + 'L' + n(408 + 150 * Math.sin(r)) + ' ' + n(168 - 150 * Math.cos(r)) + '"/>';
        }).join('') + '</g>' +
        // Camelot on its hill.
        '<g fill="#4a1f6a" opacity=".85">' + tower(262, 20, 216, 300, true) + tower(286, 34, 236, 300) + tower(470, 22, 206, 300, true) +
          tower(494, 30, 230, 300) + '<rect x="262" y="262" width="262" height="40"/></g>' +
        '<g fill="#ffe3a0" opacity=".8"><rect x="270" y="236" width="4" height="9"/><rect x="478" y="226" width="4" height="9"/><rect x="300" y="254" width="4" height="8"/><rect x="506" y="250" width="4" height="8"/></g>' +
        ground('M0 440V316C100 298 220 312 320 300S460 286 520 292V440Z', lin('hill', [[0, '#7a3a8a'], [1, '#3a1452']])) +
        // The stone, and the sword driven into it.
        '<path d="M336 352C334 320 350 300 380 296H436C462 300 480 318 478 352Z" fill="' + lin('stone', [[0, '#a89ac8'], [1, '#4a3a6a']], 0, 0, 1, 1) + '"/>' +
        '<path d="M350 330C360 318 378 312 400 312" fill="none" stroke="#fff" stroke-width="3" opacity=".35" stroke-linecap="round"/>' +
        '<path d="M396 304V200L408 178L420 200V304Z" fill="' + blade + '" stroke="#5a4a8a" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M408 186V302" stroke="#8a7ac8" stroke-width="1.6" opacity=".8"/>' +
        '<path d="M366 196C376 186 440 186 450 196C440 206 376 206 366 196Z" fill="' + gold + '" stroke="#8a4a14" stroke-width="2"/>' +
        '<rect x="401" y="140" width="14" height="52" rx="4" fill="#7a2a3a" stroke="#4a1424" stroke-width="1.6"/>' +
        '<g stroke="#ffd98a" stroke-width="2.2"><path d="M401 150H415M401 160H415M401 170H415M401 180H415"/></g>' +
        '<circle cx="408" cy="134" r="10" fill="' + gold + '" stroke="#8a4a14" stroke-width="2"/>' +
        sparkle(432, 130, 11) + sparkle(372, 228, 7) + sparkle(480, 110, 7) +
        ground('M0 440V376C120 366 250 384 370 372S480 364 520 368V440Z', '#2a0f40') +
        scatter(912, 14, (x, y, r) => '<path d="M' + x + ' ' + y + 'l' + n(2 + r() * 3) + ' -' + n(8 + r() * 8) + 'l' + n(2 + r() * 3) + ' ' + n(8 + r() * 8) + '" fill="#3a1452"/>', 140, W, 374, 384);
    },

    // The Hercules constellation over a moonlit Greek temple on its hill,
    // his knotted olive-wood club leaning on the steps, olive branches by.
    'Hercules': () => {
      // The constellation's familiar shape: the Keystone and its limbs.
      const pts = { a: [330, 64], b: [372, 48], c: [404, 84], d: [376, 104], e: [350, 98], f: [440, 60], g: [476, 34], h: [432, 128], i: [470, 150], k: [300, 40], l: [286, 112] };
      const lines = [['e', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['c', 'f'], ['f', 'g'], ['d', 'h'], ['h', 'i'], ['a', 'k'], ['e', 'l']];
      const column = x => '<rect x="' + x + '" y="196" width="12" height="74" fill="' + lin('col' + x, [[0, '#fff6e6'], [1, '#c8b8e8']], 0, 0, 1, 0) + '"/>' +
        '<rect x="' + (x - 3) + '" y="192" width="18" height="6" fill="#f3ecff"/><rect x="' + (x - 3) + '" y="268" width="18" height="5" fill="#f3ecff"/>';
      const olive = (x, y, a, s) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')"><path d="M0 0C20 -6 40 -6 60 0" fill="none" stroke="#2a3a1a" stroke-width="2"/>' +
        [[12, -1, -30], [24, -3, 30], [36, -3, -30], [48, -2, 30], [58, 0, 0]].map(([lx, ly, la]) => '<ellipse cx="' + lx + '" cy="' + ly + '" rx="7" ry="2.6" fill="#7aa85a" transform="rotate(' + la + ' ' + lx + ' ' + ly + ')"/>').join('') +
        '<circle cx="30" cy="4" r="2.6" fill="#3a2a5a"/></g>';
      return tint('#2a1f7a', '#b8508a', 0.55) + stars(1011, 44, 120, W, 0, 200) +
        glow('cg', 390, 90, 150, '#e6d8ff', 0.55) +
        '<g stroke="#f3e6ff" stroke-width="1.6" opacity=".7">' + lines.map(([p, q]) => '<path d="M' + pts[p].join(' ') + 'L' + pts[q].join(' ') + '"/>').join('') + '</g>' +
        Object.values(pts).map(([x, y], i) => '<circle cx="' + x + '" cy="' + y + '" r="' + (i < 5 ? 4.2 : 3.2) + '" fill="#fff"/>' +
          '<circle cx="' + x + '" cy="' + y + '" r="' + (i < 5 ? 10 : 7) + '" fill="#fff" opacity=".18"/>').join('') +
        sparkle(372, 48, 9) + sparkle(476, 34, 7) +
        ground('M0 440V300C100 286 220 296 300 282S460 270 520 276V440Z', lin('hill', [[0, '#6a3a9a'], [1, '#2a1052']])) +
        glow('tg', 430, 230, 110, '#fff0d6', 0.4) +
        // The temple: pediment, columns, steps.
        '<path d="M354 192L430 154L506 192Z" fill="#f3ecff"/><path d="M370 186L430 158L490 186Z" fill="#d8c8f2"/>' +
        '<rect x="350" y="190" width="160" height="6" fill="#fff6e6"/>' +
        [362, 386, 410, 434, 458, 482].map(column).join('') +
        '<path d="M344 272H516V280H344ZM336 280H524V288H336Z" fill="#e6dcf6"/>' +
        // The club, knotted, leaning on the steps: thick at the head, worn at the grip.
        '<g transform="translate(312 324) rotate(-22)"><path d="M-16 -100C-26 -88 -24 -66 -18 -44C-14 -24 -10 0 -7 40C-6 48 6 48 7 40C10 0 14 -24 18 -44C24 -66 26 -88 16 -100C6 -110 -6 -110 -16 -100Z" fill="' + lin('club', [[0, '#a8683a'], [1, '#4a2410']], 0, 0, 1, 0) + '" stroke="#2a1206" stroke-width="2.6" stroke-linejoin="round"/>' +
          '<g fill="#3a1a08">' + [[-20, -84, 6], [17, -70, 5.6], [-16, -54, 5], [13, -36, 4.4], [-10, -16, 3.6]].map(([x, y, r]) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + n(r * 0.7) + '"/>').join('') + '</g>' +
          '<path d="M-6 -96C-12 -80 -12 -60 -8 -40" stroke="#ffd9a0" stroke-width="3" opacity=".45" fill="none" stroke-linecap="round"/>' +
          '<path d="M-7 20H7M-7 28H7" stroke="#2a1206" stroke-width="2" opacity=".6"/></g>' +
        ground('M0 440V378C120 368 250 386 370 374S480 366 520 370V440Z', '#1c0a3a') +
        olive(392, 386, -14, 1.5) + olive(458, 404, -24, 1.3) + olive(218, 400, -8, 1.2);
    },
  };

  const emblems = {
    // A pair of shoes on a winding road.
    'Dorothy': '<path d="M5 32c-1-6 4-9 9-8 5 1 10-2 14-7 3-3 7-3 8 1l1 14z" fill="currentColor" fill-opacity=".18"/><path d="M5 32c-1-6 4-9 9-8 5 1 10-2 14-7 3-3 7-3 8 1l1 14z"/><path d="M4 32h33"/><path d="M31 32v8h5v-8"/><path d="M17 24c4 3 9 2 13-4"/><path d="M38 4l1.6 3.9 3.9 1.6-3.9 1.6L38 15l-1.6-3.9-3.9-1.6 3.9-1.6z" fill="currentColor" stroke="none"/><path d="M6 44h36"/>',
    // An apple with its leaf, and a flake of snow.
    'Snow White': '<path d="M22 14c-5-5-16-3-16 10 0 11 8 18 16 15 8 3 16-4 16-15 0-13-11-15-16-10z" fill="currentColor" fill-opacity=".18"/><path d="M22 14c-5-5-16-3-16 10 0 11 8 18 16 15 8 3 16-4 16-15 0-13-11-15-16-10z"/><path d="M22 14V8"/><path d="M23 10c3-5 9-5 11-3-3 4-8 5-11 3z"/><path d="M12 20c-1 3-1 6 0 9"/><path d="M41 32v10M36.7 34.5l8.6 5M36.7 39.5l8.6-5"/>',
    // A crescent moon over an apple on a misty isle.
    // A sword set in a stone.
    'King Arthur': '<path d="M8 44c0-8 4-12 10-12h12c6 0 10 4 10 12z" fill="currentColor" fill-opacity=".18"/><path d="M8 44c0-8 4-12 10-12h12c6 0 10 4 10 12z"/><path d="M21 32V12l3-4 3 4v20z" fill="currentColor" fill-opacity=".18"/><path d="M21 32V12l3-4 3 4v20"/><path d="M15 12h18"/><path d="M24 12V4"/><circle cx="24" cy="3" r="1.6" fill="currentColor" stroke="none"/><path d="M38 6v4M36 8h4M8 14v3M6.5 15.5h3"/>',
    // A knotted club under four stars.
    'Hercules': '<g transform="rotate(-30 24 26)"><path d="M18 6c-4 3-4 9-2 15l4 22c0 2 4 2 4 0l4-22c2-6 2-12-2-15-2-2-6-2-8 0z" fill="currentColor" fill-opacity=".18"/><path d="M18 6c-4 3-4 9-2 15l4 22c0 2 4 2 4 0l4-22c2-6 2-12-2-15-2-2-6-2-8 0z"/><circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="27" cy="16" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="22" r="1.4" fill="currentColor" stroke="none"/><path d="M20 36h4"/></g><path d="M38 4l1.4 3.4 3.4 1.4-3.4 1.4L38 13.6l-1.4-3.4-3.4-1.4 3.4-1.4z" fill="currentColor" stroke="none"/><path d="M8 8v3M6.5 9.5h3"/>',
  };

  return { scenes, emblems };
}
