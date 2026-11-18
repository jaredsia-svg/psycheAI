// Four live scenes whose drawings leaned on a studio's own design (a bow, a
// winged skull-heart, a brooch, memory-orb shelves): Hello Kitty, Kuromi,
// Sailor Moon and Joy, redrawn from generic things (21 October 2026). Loaded
// into SCENES by tools/character-art.mjs; the emblems are mirrored in
// EMBLEM_PATHS in docs/copy.js.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, stars, sparkle, scatter, skyline } = h;

  const flower = (x, y, c, s = 1) => '<g fill="' + c + '">' + [0, 72, 144, 216, 288].map(a => {
    const r = a * Math.PI / 180;
    return '<circle cx="' + n(x + 6 * s * Math.sin(r)) + '" cy="' + n(y - 6 * s * Math.cos(r)) + '" r="' + n(4.6 * s) + '"/>';
  }).join('') + '</g><circle cx="' + x + '" cy="' + y + '" r="' + n(3.4 * s) + '" fill="#ffd23c"/>';

  // A cat sitting, seen from behind or side, about 60 tall, origin at its feet.
  const cat = (x, y, s, fill, tail = 1) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '">' +
    '<path d="M-18 0C-22 -20 -18 -38 -6 -44C-10 -50 -12 -58 -10 -64L-3 -56C1 -58 5 -58 9 -56L16 -64C18 -58 16 -50 12 -44C22 -36 24 -18 20 0Z"/>' +
    '<path d="M' + 18 * tail + ' -4C' + 34 * tail + ' -2 ' + 42 * tail + ' -14 ' + 38 * tail + ' -30C' + 36 * tail + ' -38 ' + 30 * tail + ' -40 ' + 28 * tail + ' -34C' +
      32 * tail + ' -26 ' + 30 * tail + ' -14 ' + 16 * tail + ' -12Z"/></g>';

  return {
    scenes: {
      // A tea party: one big glossy teapot pouring into a cup on a lace
      // tablecloth, the tea's steam curling up into a heart, sparkles and
      // little hearts floating in a pink sky.
      'Hello Kitty': () => {
        const china = lin('china', [[0, '#ffffff'], [0.6, '#fff0f5'], [1, '#ffc9dc']], 0, 0, 1, 1);
        const rim = lin('rim', [[0, '#ff9ab8'], [1, '#e0456e']]);
        const gold = lin('gold', [[0, '#fff3b0'], [1, '#e8a93a']]);
        const heart = (x, y, s, c, o = 1) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 8C-10 1 -12 -5 -10 -8C-7 -12 -2 -11 0 -6C2 -11 7 -12 10 -8C12 -5 10 1 0 8Z" fill="' + c + '" opacity="' + o + '"/>';
        const strawberry = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 14C-10 6 -12 -4 -8 -8C-4 -11 4 -11 8 -8C12 -4 10 6 0 14Z" fill="#ff4f6a"/>' +
          '<path d="M-7 -8L-3 -13L0 -9L3 -13L7 -8Z" fill="#5ab04a"/><g fill="#ffe3a0"><circle cx="-3" cy="-2" r="1"/><circle cx="3" cy="0" r="1"/><circle cx="0" cy="5" r="1"/></g></g>';
        let scallops = '';
        for (let x = 236; x < 530; x += 18) scallops += '<circle cx="' + x + '" cy="360" r="9"/>';
        let lace = '';
        for (let x = 244; x < 530; x += 18) lace += '<circle cx="' + x + '" cy="350" r="2.6"/>';
        return tint('#ffe0ec', '#d0487a', 0.5) +
          scatter(431, 22, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(3 + r() * 6) + '" fill="#fff" opacity=".28"/>', 120, W, 0, 260) +
          glow('g', 420, 200, 190, '#fff4f8', 0.9) +
          heart(268, 70, 1.1, '#fff', 0.7) + heart(500, 60, 0.9, '#ffc2d6') + heart(486, 150, 0.7, '#fff', 0.8) + heart(300, 150, 0.6, '#ffc2d6') +
          sparkle(350, 70, 10) + sparkle(512, 110, 8) + sparkle(262, 220, 7) + sparkle(470, 30, 6) +
          // The floor, and the lace-edged tablecloth.
          '<path d="M0 440V370C110 356 230 372 330 362S470 352 520 358V440Z" fill="#b8386a"/>' +
          '<path d="M230 300H520V360H230Z" fill="' + lin('cloth', [[0, '#fff8fb'], [1, '#ffd9e6']]) + '"/>' +
          '<g fill="#fff8fb">' + scallops + '</g><g fill="#ff9ab8" opacity=".6">' + lace + '</g>' +
          '<path d="M230 300H520" stroke="#ffc2d6" stroke-width="3"/>' +
          // The teapot, facing left and pouring.
          '<g transform="translate(436 226) scale(1.16)">' +
            '<path d="M58 -30C92 -34 96 30 58 28" fill="none" stroke="' + rim + '" stroke-width="10" stroke-linecap="round"/>' +
            '<path d="M-52 10C-72 4 -86 -20 -92 -40L-80 -46C-72 -28 -62 -14 -46 -12Z" fill="' + china + '" stroke="' + rim + '" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M-62 -40C-66 18 -40 60 0 60S66 18 62 -40Z" fill="' + china + '" stroke="' + rim + '" stroke-width="3"/>' +
            '<path d="M-64 -42H64" stroke="' + gold + '" stroke-width="7" stroke-linecap="round"/>' +
            '<path d="M-44 -44C-40 -70 40 -70 44 -44Z" fill="' + china + '" stroke="' + rim + '" stroke-width="3"/>' +
            '<circle cx="0" cy="-70" r="9" fill="' + rim + '" stroke="#fff" stroke-width="2.4"/>' +
            '<path d="M-50 40H50" stroke="' + gold + '" stroke-width="5" stroke-linecap="round" opacity=".9"/>' +
            heart(0, 4, 2.6, '#ff6a92') + heart(0, 4, 1.4, '#ffc2d6') +
            '<path d="M-48 -26C-50 0 -40 24 -24 40" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/></g>' +
          // The tea, falling into the cup.
          '<path d="M330 174C320 200 318 240 320 270" fill="none" stroke="#c97a4a" stroke-width="5" stroke-linecap="round" opacity=".9"/>' +
          '<g transform="translate(322 284)"><ellipse cx="0" cy="16" rx="38" ry="7" fill="' + china + '" stroke="' + rim + '" stroke-width="2.4"/>' +
            '<path d="M-26 -12H26C26 6 16 14 0 14S-26 6 -26 -12Z" fill="' + china + '" stroke="' + rim + '" stroke-width="2.4"/>' +
            '<path d="M-26 -6C-40 -6 -40 8 -24 8" fill="none" stroke="' + rim + '" stroke-width="3"/>' +
            '<ellipse cx="0" cy="-12" rx="26" ry="5" fill="#c97a4a"/><path d="M-20 -4H20" stroke="' + gold + '" stroke-width="2.4"/>' + heart(0, 2, 0.7, '#ff6a92') + '</g>' +
          // The steam, curling up into a heart.
          '<path d="M304 270C292 254 308 242 298 226C292 216 292 206 298 198" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/>' +
          '<path d="M298 198C288 180 304 168 312 180C318 166 338 172 330 192L310 214Z" fill="#fff" fill-opacity=".25" stroke="#fff" stroke-width="5" stroke-linejoin="round" opacity=".9"/>' +
          strawberry(478, 316, 0.9) + strawberry(500, 324, 0.8) +
          '<path d="M0 440V404C120 392 250 410 360 400S480 394 520 398V440Z" fill="#8a2452"/>';
      },

      // Gothic, moody but never grim: a big pale moon behind a spired chapel
      // with a glowing arched window, a twisted bare tree, a wrought-iron
      // fence and gate with an iron lantern, bats wheeling, and a black cat
      // sitting on the gate's stone pillar. Deep purple and black, magenta lights.
      'Kuromi': () => {
        const ink = '#12061e';
        const bat = (x, y, s, a = 0) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')" fill="' + ink + '">' +
          '<path d="M-5 -2C-11 -10 -24 -12 -30 -6C-24 -4 -22 2 -24 8C-18 4 -12 6 -7 10Z"/><path d="M5 -2C11 -10 24 -12 30 -6C24 -4 22 2 24 8C18 4 12 6 7 10Z"/>' +
          '<ellipse rx="6.5" ry="8"/><path d="M-5 -6L-7 -13L-2 -8ZM5 -6L7 -13L2 -8Z"/></g>';
        const magenta = '#ff4fb0';
        // The fence: spear-topped iron bars between two rails.
        let bars = '';
        for (let x = 252; x < 530; x += 14) {
          if (x > 388 && x < 452) continue;
          bars += '<rect x="' + (x - 1.6) + '" y="330" width="3.2" height="70"/><path d="M' + (x - 5) + ' 332L' + x + ' 318L' + (x + 5) + ' 332Z"/>';
        }
        // The gate: two leaves under a scrolled arch.
        let gate = '';
        for (let x = 396; x <= 444; x += 8) gate += '<rect x="' + (x - 1.4) + '" y="312" width="2.8" height="88"/>';
        const tree = '<g fill="none" stroke="' + ink + '" stroke-linecap="round">' +
          '<path d="M318 404C322 360 314 330 326 296C334 272 330 250 322 230" stroke-width="12"/>' +
          '<path d="M324 300C342 286 352 266 372 260C384 256 392 246 396 236" stroke-width="6"/>' +
          '<path d="M326 262C306 250 300 230 286 222C276 216 270 204 272 192" stroke-width="5"/>' +
          '<path d="M322 232C318 214 326 196 320 178M320 178C312 170 314 160 306 152M320 178C330 168 342 168 348 156" stroke-width="4"/>' +
          '<path d="M372 260C380 268 392 270 400 266M286 222C278 230 266 230 258 238M396 236C404 228 404 218 412 212" stroke-width="3"/></g>';
        return tint('#5a1a6a', '#0e0418', 0.75) + stars(611, 50, 120, W, 0, 240, '#ffd6f0') +
          glow('mg', 438, 118, 190, '#f0dcff', 0.55) +
          '<circle cx="438" cy="118" r="82" fill="' + rad('moon', [[0, '#fffaff'], [0.7, '#eadcff'], [1, '#c9b0f0']], 0.42, 0.4) + '"/>' +
          '<g fill="#c9b0f0" opacity=".45"><circle cx="410" cy="96" r="12"/><circle cx="462" cy="146" r="9"/><circle cx="468" cy="92" r="6"/></g>' +
          // The chapel with its spire, against the moon.
          '<g fill="' + ink + '"><path d="M430 300V176L446 150L462 176V300Z"/><path d="M446 150L446 82L452 150Z"/><path d="M442 96H450M446 90V102" stroke="' + ink + '" stroke-width="3"/>' +
            '<path d="M462 300V214L492 186L522 214V300Z"/><path d="M474 300V230H510V300Z"/></g>' +
          glow('win', 446, 214, 26, magenta, 0.7) +
          '<path d="M440 228V212A6 6 0 0 1 452 212V228Z" fill="' + magenta + '"/>' +
          '<path d="M484 254V236A8 8 0 0 1 500 236V254Z" fill="' + magenta + '" opacity=".9"/><path d="M492 228V254M484 244H500" stroke="' + ink + '" stroke-width="2"/>' +
          [[270, 60, 0.9, -10], [318, 104, 0.75, 8], [356, 48, 0.6, -6], [512, 52, 0.75, 12], [300, 172, 0.55, -14], [396, 196, 0.6, 6], [520, 156, 0.55, -8], [242, 132, 0.6, 10], [372, 140, 0.45, -2], [486, 26, 0.5, 6]]
            .map(([x, y, sc, an]) => bat(x, y, sc, an)).join('') +
          sparkle(512, 250, 8, '#ffd6f0') + sparkle(262, 250, 7, '#ffd6f0') +
          '<path d="M0 440V380C110 362 230 384 330 368S470 352 520 360V440Z" fill="#26082e"/>' +
          tree +
          // Fence, gate, pillars, lantern.
          '<g fill="' + ink + '">' + bars + '<rect x="246" y="344" width="290" height="4"/><rect x="246" y="378" width="290" height="4"/>' + gate +
            '<rect x="392" y="344" width="56" height="3"/><path d="M392 316C404 290 436 290 448 316" fill="none" stroke="' + ink + '" stroke-width="4"/>' +
            '<path d="M406 316C410 304 418 300 420 308M434 316C430 304 422 300 420 308" fill="none" stroke="' + ink + '" stroke-width="2.4"/>' +
            '<rect x="374" y="300" width="22" height="104"/><rect x="370" y="294" width="30" height="10" rx="2"/>' +
            '<rect x="446" y="300" width="22" height="104"/><rect x="442" y="294" width="30" height="10" rx="2"/></g>' +
          // The iron lantern on the right pillar.
          glow('lg', 457, 270, 40, magenta, 0.8) +
          '<g transform="translate(457 294)"><path d="M-9 0H9L8 -30H-8Z" fill="#ffc2e8" stroke="' + ink + '" stroke-width="3"/><path d="M-13 -30H13L0 -42Z" fill="' + ink + '"/>' +
            '<path d="M0 -42V-48" stroke="' + ink + '" stroke-width="3"/><path d="M0 -6C-4 -11 -4 -18 0 -24C4 -18 4 -11 0 -6Z" fill="' + magenta + '"/></g>' +
          // The cat, sitting up on the left pillar, looking at the moon.
          cat(385, 294, 1.1, '#000') +
          '<path d="M0 440V406C120 394 250 412 360 402S480 396 520 400V440Z" fill="#0e0418"/>';
      },

      // A luminous twilight: a radiant golden crescent with a strong halo and
      // a sparkling shooting star in a glowing pastel sky, a city lit in pastel
      // tones with warm windows, and a black cat on the nearest rooftop.
      'Sailor Moon': () => {
        const tail = lin('tail', [[0, '#ffffff', 0], [1, '#fffbe0', 1]], 0, 0, 1, 0);
        const sky = lin('sky', [[0, '#c9b8ff', 0.8], [0.45, '#ffc6e0', 0.8], [0.8, '#ffe2b8', 0.75], [1, '#bfe0ff', 0.7]]);
        return '<rect width="' + W + '" height="' + H + '" fill="' + sky + '"/>' + stars(421, 30, 120, W, 0, 200, '#fff') +
          glow('halo', 420, 116, 210, '#fff2b0', 0.95) +
          '<path d="M420 16A108 108 0 1 0 500 206A88 88 0 0 1 420 16Z" fill="' + lin('moon', [[0, '#fffbe6'], [0.6, '#ffe07a'], [1, '#ffc23c']]) + '"/>' +
          '<path d="M368 64C352 96 352 144 372 180" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/>' +
          // The shooting star, with a sparkling trail.
          '<path d="M222 52L322 100L318 110Z" fill="' + tail + '"/>' +
          glow('sg', 322, 104, 34, '#fffbe0', 0.95) +
          '<g transform="translate(322 104) rotate(20)"><path d="M0 -14L3.8 -4.4L14 -4.4L5.8 2L9 12.6L0 6.4L-9 12.6L-5.8 2L-14 -4.4L-3.8 -4.4Z" fill="#fffbe0" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>' +
          sparkle(270, 70, 6) + sparkle(296, 92, 4) + sparkle(250, 58, 4) +
          sparkle(492, 236, 10) + sparkle(276, 170, 8) + sparkle(352, 214, 7) + sparkle(512, 36, 8) +
          // The city in pastel layers, warm windows lit.
          skyline(422, 140, W, 420, 90, 180, '#d8c4ff', '#fff2b0') +
          skyline(424, 130, W, 430, 50, 120, '#f2b8d8', '#ffe08a') +
          skyline(423, 120, W, 440, 24, 70, '#a8c8f0', '#fff2b0') +
          // The nearest rooftop, and the cat on its ridge against the sky.
          '<path d="M300 440V338H520V440Z" fill="#6a4a9a"/><path d="M290 342L410 300L530 342Z" fill="#7a5aac"/>' +
          '<g fill="#ffe08a"><rect x="330" y="364" width="12" height="16" rx="2"/><rect x="470" y="364" width="12" height="16" rx="2"/></g>' +
          '<rect x="474" y="302" width="18" height="30" fill="#6a4a9a"/>' +
          glow('cg', 410, 270, 60, '#ffffff', 0.5) +
          cat(410, 302, 1.15, '#14082a', -1) +
          '<rect x="0" y="430" width="520" height="10" fill="#4a3478"/>';
      },

      // A bubble-shooter arcade game, glowing in its cabinet: a cluster of
      // glossy coloured bubbles at the top and a launcher at the bottom
      // aiming a golden one up between them.
      'Joy': () => {
        // Warm and luminous, led by gold: each a glassy sphere with a bright
        // core fading to its rim, a soft halo and a small highlight.
        const cols = ['#ffd23c', '#8ac8ff', '#ff8ab0', '#8ae0a0', '#c8a8ff'];
        const fills = {};
        const orb = c => fills[c] || (fills[c] = {
          core: rad('orb' + Object.keys(fills).length, [[0, '#ffffff', 1], [0.28, '#fffbe8', 0.95], [0.6, c, 0.95], [1, c, 0.7]], 0.42, 0.4),
          halo: rad('halo' + Object.keys(fills).length, [[0, c, 0.6], [0.6, c, 0.22], [1, c, 0]]),
        });
        const bubble = (x, y, c, r = 15) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(r * 1.55) + '" fill="' + orb(c).halo + '"/>' +
          '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + orb(c).core + '" stroke="#fff" stroke-opacity=".7" stroke-width="1.6"/>' +
          '<ellipse cx="' + n(x - r * 0.38) + '" cy="' + n(y - r * 0.42) + '" rx="' + n(r * 0.26) + '" ry="' + n(r * 0.16) + '" fill="#fff" opacity=".9" transform="rotate(-30 ' + n(x - r * 0.38) + ' ' + n(y - r * 0.42) + ')"/>';
        const pick = [[0, 1, 0, 2, 3, 0, 4], [2, 0, 4, 0, 1, 0], [0, 3, 1, 0, 2, 4, 0], [4, 0, 2, 0, 3]];
        let field = '';
        pick.forEach((row, ri) => row.forEach((ci, i) => {
          const x = 302 + i * 30 + (ri % 2 ? 15 : 0);
          const y = 74 + ri * 26;
          if (x < 500) field += bubble(x, y, cols[ci]);
        }));
        const screen = lin('screen', [[0, '#3a1a7a'], [1, '#1a0a3a']]);
        const cab = lin('cab', [[0, '#ff7ab8'], [1, '#c2366a']], 0, 0, 1, 0);
        return tint('#ffb35c', '#a33d6f', 0.5) + glow('sun', 400, 160, 210, '#fff0b0', 0.6) +
          scatter(511, 16, (x, y, r) => sparkle(x, y, n(4 + r() * 5)), 140, W, 10, 300) +
          // The cabinet and its screen.
          '<path d="M272 440V30C272 18 282 10 294 10H508C520 10 530 18 530 30V440Z" fill="' + cab + '" stroke="#fff" stroke-width="4"/>' +
          '<rect x="286" y="44" width="230" height="270" rx="10" fill="' + screen + '" stroke="#2a0b3d" stroke-width="4"/>' +
          '<rect x="286" y="22" width="230" height="18" rx="6" fill="#ffe36a" stroke="#2a0b3d" stroke-width="2"/>' +
          '<g fill="#2a0b3d">' + [0, 1, 2, 3, 4, 5, 6].map(i => '<circle cx="' + (330 + i * 24) + '" cy="31" r="4"/>').join('') + '</g>' +
          glow('scr', 400, 110, 140, '#ffe9a0', 0.3) + field +
          // The golden bubble in flight, and its path.
          '<path d="M400 286L364 214L384 176" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="4 6" opacity=".7"/>' +
          glow('gold', 384, 176, 34, '#ffe36a', 0.9) + bubble(384, 176, '#ffd23c', 16) +
          // The launcher.
          '<path d="M376 300A24 24 0 0 1 424 300Z" fill="#ffe36a" stroke="#fff" stroke-width="3"/>' +
          '<path d="M400 298L388 262L398 260L406 296Z" fill="#fff" stroke="#2a0b3d" stroke-width="2"/>' +
          bubble(450, 296, '#8ac8ff', 11) +
          // The controls.
          '<path d="M276 330H526V372H276Z" fill="#a8205a" stroke="#fff" stroke-width="3"/>' +
          '<path d="M330 352V336" stroke="#2a0b3d" stroke-width="5" stroke-linecap="round"/><circle cx="330" cy="334" r="8" fill="#ff5f8a" stroke="#fff" stroke-width="2"/>' +
          '<circle cx="440" cy="352" r="9" fill="#4fb8ff" stroke="#fff" stroke-width="2"/><circle cx="470" cy="352" r="9" fill="#6ad87a" stroke="#fff" stroke-width="2"/>' +
          '<path d="M0 440V392C120 378 240 398 340 388S470 380 520 384V440Z" fill="#5a1a4a"/>';
      },
    },
    emblems: {
      'Hello Kitty': '<path d="M8 18h28c0 12-6 20-14 20S8 30 8 18z" fill="currentColor" fill-opacity=".18"/><path d="M8 18h28c0 12-6 20-14 20S8 30 8 18z"/><path d="M36 22c6 0 6 9-1 9"/><path d="M6 42h32"/><path d="M16 12c0-3 3-3 3-6M24 12c0-3 3-3 3-6"/><circle cx="22" cy="27" r="3" fill="currentColor" stroke="none"/>',
      'Kuromi': '<path d="M30 4a17 17 0 1 0 14 26A14 14 0 0 1 30 4z" fill="currentColor" fill-opacity=".18"/><path d="M30 4a17 17 0 1 0 14 26A14 14 0 0 1 30 4z"/><path d="M14 44c-3-8-2-14 2-17-1-3-1-6 0-8l3 3c2-1 3-1 5 0l3-3c1 2 1 5 0 8 4 3 5 9 2 17z" fill="currentColor" stroke="none"/><path d="M6 10c2-2 5-2 6 0 1-2 4-2 6 0-2 1-3 3-3 5-1-1-2-2-3-1-1-1-2 0-3 1 0-2-1-4-3-5z" fill="currentColor" stroke="none"/>',
      'Sailor Moon': '<path d="M28 4a18 18 0 1 0 15 27A15 15 0 0 1 28 4z" fill="currentColor" fill-opacity=".18"/><path d="M28 4a18 18 0 1 0 15 27A15 15 0 0 1 28 4z"/><path d="M38 6l1.6 3.8 4 .4-3 2.7.9 4-3.5-2-3.5 2 .9-4-3-2.7 4-.4z" fill="currentColor" stroke="none"/><path d="M6 38l10-4"/>',
      'Joy': '<rect x="6" y="3" width="36" height="42" rx="5" fill="currentColor" fill-opacity=".18"/><rect x="6" y="3" width="36" height="42" rx="5"/><circle cx="15" cy="12" r="3.6"/><circle cx="24" cy="12" r="3.6"/><circle cx="33" cy="12" r="3.6"/><circle cx="19.5" cy="19.5" r="3.6"/><circle cx="28.5" cy="19.5" r="3.6"/><circle cx="24" cy="31" r="3.6" fill="currentColor" stroke="none"/><path d="M18 40a6 6 0 0 1 12 0"/><path d="M24 39l-2-6"/>',
    },
  };
}
