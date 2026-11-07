// Reserve scenes, batch C: Aladdin, Robin Hood, Merlin, the Beast and Sun
// Wukong, each drawn from the things of the original public-domain story
// (the Nights, the English ballads, Geoffrey of Monmouth, Beaumont's tale,
// Journey to the West) and never from a film's look. See the reserve section
// of tools/character-art.mjs.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter } = h;

  // A cut gem, as a small faceted polygon.
  const gem = (x, y, s, c, light = '#fff') =>
    '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M-8 -4L-4 -9H4L8 -4L0 8Z" fill="' + c + '" stroke="#fff" stroke-width="1" stroke-opacity=".5"/>' +
    '<path d="M-8 -4H8M-4 -9L-2 -4L0 8M4 -9L2 -4L0 8" fill="none" stroke="' + light + '" stroke-width=".8" opacity=".55"/>' +
    '<path d="M-4 -9L-2 -4H-8Z" fill="' + light + '" opacity=".45"/></g>';
  const coin = (x, y, s) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + n(9 * s) + '" ry="' + n(3.6 * s) + '" fill="#ffd23c" stroke="#b97a1f" stroke-width="1.2"/>';

  // A rose bloom: outer petals, a cupped middle, a swirl at the heart.
  function rose(x, y, s, fill, dark) {
    const petals = [0, 72, 144, 216, 288].map(a =>
      '<ellipse cx="0" cy="-15" rx="13" ry="17" transform="rotate(' + a + ')" fill="' + fill + '"/>').join('');
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' + petals +
      '<path d="M-16 -2C-16 -20 16 -20 16 -2C16 12 -16 12 -16 -2Z" fill="' + dark + '"/>' +
      '<path d="M-12 -6C-10 -18 10 -18 12 -6C6 -12 -6 -12 -12 -6Z" fill="#ff8aa0" opacity=".55"/>' +
      '<path d="M-6 -2C-6 -10 6 -10 6 -3C6 3 -2 4 -3 -1C-3 -4 1 -5 2 -2" fill="none" stroke="#5a0618" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M-26 -10C-24 -22 -14 -30 -4 -31" fill="none" stroke="#ffc2cc" stroke-width="2.4" stroke-linecap="round" opacity=".6"/></g>';
  }

  const scenes = {

    // An oil lamp in a cave of jewels, a wisp of smoke curling up out of its
    // spout into the light, and a ring lying in the gold.
    'Aladdin': () => {
      const gold = lin('agold', [[0, '#fff0b0'], [0.45, '#ffc94a'], [1, '#b8741c']]);
      const goldSide = lin('aside', [[0, '#ffe38a'], [1, '#9a5a12']], 0, 0, 1, 0);
      const smoke = lin('asmoke', [[0, '#fff', 0.85], [1, '#f6d7ff', 0.25]]);
      const rock = lin('arock', [[0, '#2a0b3d', 0.95], [1, '#1a0628', 1]]);
      const lamp = '<g transform="translate(368 256) scale(1.08)">' +
        '<path d="M-74 -4C-94 -12 -100 22 -70 18" fill="none" stroke="' + goldSide + '" stroke-width="7" stroke-linecap="round"/>' +
        '<path d="M-70 0C-70 -30 50 -34 66 -12L108 -34C116 -38 120 -32 114 -26L78 8C66 30 -58 34 -70 0Z" fill="' + gold + '" stroke="#7a420c" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="M-58 -8C-40 -22 20 -24 50 -12" fill="none" stroke="#fff6cc" stroke-width="4" stroke-linecap="round" opacity=".8"/>' +
        '<path d="M-28 -20C-28 -48 28 -48 28 -20Z" fill="' + gold + '" stroke="#7a420c" stroke-width="2.5"/>' +
        '<circle cx="0" cy="-50" r="7" fill="' + gold + '" stroke="#7a420c" stroke-width="2"/>' +
        '<path d="M-24 22L-32 38H32L24 22Z" fill="' + goldSide + '" stroke="#7a420c" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<g fill="#c81a4a"><circle cx="-34" cy="2" r="4.5"/><circle cx="0" cy="6" r="5"/><circle cx="34" cy="2" r="4.5"/></g>' +
        '<g fill="#fff" opacity=".6"><circle cx="-35" cy="0" r="1.4"/><circle cx="-1" cy="4" r="1.6"/><circle cx="33" cy="0" r="1.4"/></g></g>';
      const wisp = 'M492 222C470 196 500 226 482 196C466 170 430 168 440 140C450 112 494 120 488 92C484 70 456 62 462 40';
      return tint('#2a1060', '#b03a7a', 0.6) +
        glow('acave', 410, 150, 230, '#ffd27a', 0.55) + glow('alamp', 380, 250, 150, '#ffe2a6', 0.45) +
        // the cave's mouth, rock overhanging the top and right
        '<path d="M150 0H520V440H500C512 360 506 250 470 180C430 104 340 66 250 60C206 56 170 30 150 0Z" fill="' + rock + '" opacity=".0"/>' +
        '<path d="M190 0H520V96C500 60 456 34 404 26C330 16 262 22 190 0Z" fill="' + rock + '"/>' +
        '<path d="M520 70C496 120 500 190 512 250C520 290 520 330 520 360Z" fill="' + rock + '"/>' +
        '<g fill="#3a1352" opacity=".7"><path d="M262 0L274 34L286 4ZM330 14L340 46L352 18ZM410 26L418 58L428 30ZM470 44L476 70L486 50Z"/></g>' +
        // jewels set in the rock, glinting
        gem(300, 30, 0.9, '#3ad1c4') + gem(386, 40, 1.1, '#ff5f9a') + gem(478, 70, 0.9, '#7ab8ff') + gem(506, 170, 1, '#9be37a') + gem(500, 300, 0.9, '#ff5f9a') +
        stars(331, 26, 220, 500, 60, 220, '#ffe9a6') +
        // the smoke
        '<path d="' + wisp + '" fill="none" stroke="' + smoke + '" stroke-width="16" stroke-linecap="round" opacity=".55"/>' +
        '<path d="' + wisp + '" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>' +
        '<path d="M462 40C466 22 488 16 500 26C510 36 500 50 488 46" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>' +
        '<path d="M440 140C426 132 416 140 420 150" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity=".55"/>' +
        sparkle(428, 96, 9) + sparkle(500, 120, 6) + sparkle(456, 60, 5, '#ffe9a6') + sparkle(410, 186, 6, '#ffe9a6') +
        // the treasure floor
        ground('M0 440V384C110 368 220 386 320 370S460 356 520 362V440Z', '#3a1352') +
        '<path d="M210 380C240 320 320 300 372 312C420 296 480 292 520 304V440H210Z" fill="' + lin('apile', [[0, '#ffcf5a'], [1, '#a8601a']]) + '"/>' +
        scatter(332, 40, (x, y) => coin(x, y, 1), 240, 520, 322, 430) +
        lamp +
        gem(258, 396, 1.3, '#3ad1c4') + gem(470, 380, 1.4, '#ff5f9a') + gem(330, 410, 1.1, '#7ab8ff') + gem(500, 414, 1.2, '#9be37a') +
        // the ring, lying in the gold
        '<g transform="translate(298 380) rotate(-14)"><ellipse rx="17" ry="9" fill="none" stroke="#ffe08a" stroke-width="5"/>' +
        '<ellipse rx="17" ry="9" fill="none" stroke="#b97a1f" stroke-width="1.4"/>' + gem(0, -12, 0.9, '#c81a4a') + '</g>' +
        sparkle(250, 368, 6, '#fff6cc') + sparkle(492, 346, 7, '#fff6cc');
    },

    // A target in a Sherwood clearing, one arrow in the gold and a silver one
    // splitting it, a longbow standing by and the great oaks all around.
    'Robin Hood': () => {
      const oak = lin('roak', [[0, '#1e3a2a'], [1, '#0e1e18']]);
      const bow = lin('rbow', [[0, '#e4a860'], [1, '#7a4214']]);
      const silver = lin('rsilver', [[0, '#ffffff'], [1, '#b8c0dc']], 0, 0, 1, 0);
      const crown = (x, y, s, fill, alpha = 1) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '" opacity="' + alpha + '">' +
        '<circle cx="0" cy="0" r="34"/><circle cx="-30" cy="14" r="26"/><circle cx="30" cy="12" r="28"/><circle cx="-12" cy="-26" r="24"/><circle cx="18" cy="-24" r="22"/><circle cx="0" cy="22" r="26"/></g>';
      const tx = 398;
      const ty = 156;
      // the shaft runs in from the lower left
      const ang = Math.atan2(ty - 300, tx - 250);
      const arrow = (dx, dy, shaft, fletch, len) => {
        const x0 = n(tx + dx - Math.cos(ang) * len);
        const y0 = n(ty + dy - Math.sin(ang) * len);
        const deg = n(ang * 180 / Math.PI);
        return '<path d="M' + x0 + ' ' + y0 + 'L' + (tx + dx) + ' ' + (ty + dy) + '" stroke="' + shaft + '" stroke-width="5" stroke-linecap="round"/>' +
          '<g transform="translate(' + x0 + ' ' + y0 + ') rotate(' + deg + ')"><path d="M2 0L-16 -9L-10 0L-16 9Z" fill="' + fletch + '" stroke="#fff" stroke-width="1"/>' +
          '<path d="M14 0L-4 -8L2 0L-4 8Z" fill="' + fletch + '" opacity=".75"/></g>';
      };
      return tint('#1e4a5a', '#a33d6f', 0.55) +
        glow('rsun', 400, 150, 200, '#fff0c4', 0.65) +
        // shafts of light through the canopy
        '<path d="M330 0L400 0L470 440H380Z" fill="#fff" opacity=".07"/><path d="M450 0L490 0L520 300V440L490 440Z" fill="#fff" opacity=".05"/>' +
        crown(250, 40, 1.6, '#163024', 0.55) + crown(520, 30, 1.8, oak) + crown(120, 70, 1.4, '#163024', 0.4) +
        '<path d="M470 440V90H504V440Z" fill="' + lin('rtrunk', [[0, '#3a2414'], [1, '#1e120a']], 0, 0, 1, 0) + '"/>' +
        '<path d="M470 200C452 186 436 190 420 176M504 150C514 140 520 140 520 140" fill="none" stroke="#2a180c" stroke-width="7" stroke-linecap="round"/>' +
        scatter(91, 18, (x, y, r) => '<ellipse cx="' + x + '" cy="' + y + '" rx="5" ry="2.6" transform="rotate(' + n(r() * 180) + ' ' + x + ' ' + y + ')" fill="#9ad07a" opacity=".55"/>', 220, 500, 60, 300) +
        // the target on its stand
        '<g stroke="#5a3214" stroke-width="7" stroke-linecap="round"><path d="M372 230L350 372M424 230L446 372M398 240V372"/></g>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="82" fill="#3a1440" opacity=".25" transform="translate(5 7)"/>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="80" fill="#fff7ea" stroke="#5a3214" stroke-width="4"/>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="64" fill="#3a2a6a"/>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="48" fill="#4a8ae0"/>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="32" fill="#e2445c"/>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="16" fill="#ffd23c"/>' +
        '<path d="M' + (tx - 56) + ' ' + (ty - 40) + 'A70 70 0 0 1 ' + (tx + 20) + ' ' + (ty - 74) + '" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>' +
        // the arrow in the gold, and the silver one that splits it
        arrow(-3, 2, '#c98a46', '#e2445c', 150) +
        '<path d="M' + (tx - 14) + ' ' + (ty + 12) + 'l-12 6M' + (tx - 12) + ' ' + (ty + 4) + 'l-14 -4" stroke="#e8c79a" stroke-width="2.4" stroke-linecap="round"/>' +
        arrow(2, -2, silver, '#ffffff', 176) +
        sparkle(tx + 2, ty - 4, 12) + sparkle(470, 60, 7) + sparkle(318, 80, 6, '#fff6cc') +
        // the longbow, unstrung arc and string, leaning by the stand
        '<path d="M300 182C262 250 262 330 296 398" fill="none" stroke="' + bow + '" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M300 182L296 398" stroke="#fff6e0" stroke-width="1.6" opacity=".85"/>' +
        '<path d="M268 284H276" stroke="#3a1c0c" stroke-width="10" stroke-linecap="round"/>' +
        // the forest floor
        ground('M0 440V376C120 362 250 380 360 368S470 360 520 364V440Z', '#163024') +
        crown(180, 412, 1, oak) + crown(380, 430, 1.1, oak) + crown(520, 420, 1, oak) +
        '<g fill="#ffd27a" opacity=".7">' + [[236, 380], [330, 394], [450, 384], [500, 398]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="2.2"/>').join('') + '</g>';
    },

    // A staff crowned with a glowing crystal over the standing stones he is
    // said to have raised, under a sky full of stars.
    'Merlin': () => {
      const stone = lin('mstone', [[0, '#8a7ab8'], [1, '#2e1f5a']]);
      const crystal = lin('mcrys', [[0, '#ffffff'], [0.4, '#c9f2ff'], [1, '#7a6aff']], 0, 0, 1, 1);
      const staff = lin('mstaff', [[0, '#c98a46'], [1, '#5a3214']], 0, 0, 1, 0);
      const tri = (x, base, w, h, lintel = true) =>
        '<rect x="' + x + '" y="' + (base - h) + '" width="' + w + '" height="' + h + '" rx="4" fill="' + stone + '"/>' +
        '<rect x="' + (x + w + 26) + '" y="' + (base - h + 4) + '" width="' + w + '" height="' + (h - 4) + '" rx="4" fill="' + stone + '"/>' +
        (lintel ? '<rect x="' + (x - 6) + '" y="' + (base - h - 18) + '" width="' + (w * 2 + 38) + '" height="20" rx="4" fill="' + stone + '"/>' : '') +
        '<path d="M' + (x + 6) + ' ' + (base - h + 14) + 'v' + (h - 30) + '" stroke="#c9bcf0" stroke-width="2.4" opacity=".35" stroke-linecap="round"/>';
      return tint('#120c40', '#5a2a8a', 0.65) + stars(441, 70, 140, W, 0, 260) +
        // a constellation, joined up
        '<path d="M250 70L296 44L344 60L372 28M296 44L310 96" fill="none" stroke="#fff" stroke-width="1.2" opacity=".4"/>' +
        '<g fill="#fff">' + [[250, 70], [296, 44], [344, 60], [372, 28], [310, 96]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="2.6"/>').join('') + '</g>' +
        '<path d="M520 20A44 44 0 1 1 476 64A34 34 0 0 0 520 20Z" fill="#fff4d6" opacity=".9"/>' +
        glow('mglow', 420, 128, 170, '#c9f2ff', 0.7) +
        // rays from the crystal
        '<g stroke="#fff" stroke-width="2" opacity=".35" stroke-linecap="round">' +
          [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(a => {
            const r = a * Math.PI / 180;
            return '<path d="M' + n(420 + 52 * Math.cos(r)) + ' ' + n(128 + 52 * Math.sin(r)) + 'L' + n(420 + 84 * Math.cos(r)) + ' ' + n(128 + 84 * Math.sin(r)) + '"/>';
          }).join('') + '</g>' +
        // the stones, a ring of trilithons on the plain
        ground('M0 440V368C120 352 260 366 380 356S480 350 520 354V440Z', '#1c1040') +
        '<g opacity=".55">' + tri(196, 372, 22, 70) + '</g>' + tri(262, 378, 30, 104) + tri(452, 374, 26, 96, false) +
        '<rect x="520" y="270" width="30" height="104" rx="4" fill="' + stone + '"/>' +
        '<path d="M330 372L346 300L372 306L360 374Z" fill="' + stone + '" opacity=".8"/>' +
        // the staff, its head curled round the crystal
        '<path d="M432 402L418 172" stroke="' + staff + '" stroke-width="10" stroke-linecap="round"/>' +
        '<path d="M418 176C396 170 392 146 404 132M418 176C442 168 446 146 436 132" fill="none" stroke="#7a4a20" stroke-width="6" stroke-linecap="round"/>' +
        '<g transform="translate(420 124)"><path d="M0 -40L20 -8L10 30H-10L-20 -8Z" fill="' + crystal + '" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>' +
          '<path d="M0 -40L4 -8L10 30M0 -40L-6 -8L-10 30M-20 -8H20" fill="none" stroke="#fff" stroke-width="1.4" opacity=".7"/>' +
          '<path d="M-14 -10L-4 -32L-6 -8Z" fill="#fff" opacity=".7"/></g>' +
        sparkle(372, 90, 9) + sparkle(470, 190, 8) + sparkle(456, 70, 6) + sparkle(380, 200, 5, '#c9f2ff') +
        scatter(442, 10, (x, y) => sparkle(x, y, 3.5, '#c9f2ff'), 300, 500, 200, 340) +
        '<path d="M0 440V398C130 386 270 404 400 392S490 388 520 390V440Z" fill="#120a2e"/>';
    },

    // A castle dark in its wood under a full moon, and in the moonlit garden
    // the single rose that began the story, a ring lying by it.
    'The Beast': () => {
      const red = lin('brose', [[0, '#ff4a6a'], [1, '#a8102a']]);
      const stem = '#2e6a3a';
      const castle = '<g fill="#1c0a2e">' +
        '<path d="M300 330V250H316V236H330V250H346V330Z"/>' +
        '<path d="M340 330V200L362 160L384 200V330Z"/>' +
        '<path d="M380 330V234H470V330Z"/>' +
        '<path d="M420 236V176L446 124L472 176V236Z"/>' +
        '<path d="M466 330V214L486 182L506 214V330Z"/>' +
        '<path d="M380 234V222H392V234ZM400 234V222H412V234ZM440 234V222H452V234Z"/></g>' +
        '<g fill="#ffd27a" opacity=".85"><path d="M356 230V218A6 6 0 0 1 368 218V230Z"/><path d="M440 190V178A6 6 0 0 1 452 178V190Z"/>' +
        '<rect x="400" y="262" width="8" height="12" rx="4"/><rect x="484" y="236" width="7" height="11" rx="3.5"/></g>';
      const tree = (x, base, h, s = 1) => '<path transform="translate(' + x + ' ' + base + ') scale(' + s + ')" d="M-3 0V-' + h * 0.4 + 'L-24 -' + h * 0.4 + 'L-4 -' + h * 0.62 + 'L-18 -' + h * 0.62 + 'L0 -' + h + 'L18 -' + h * 0.62 + 'L4 -' + h * 0.62 + 'L24 -' + h * 0.4 + 'L3 -' + h * 0.4 + 'V0Z"/>';
      return tint('#141040', '#7a2a7a', 0.6) + stars(551, 40, 120, W, 0, 200) +
        glow('bmoon', 400, 120, 180, '#fff4d6', 0.6) +
        '<circle cx="400" cy="118" r="80" fill="' + rad('bmoonf', [[0, '#fffaf0'], [1, '#e8dcc0']], 0.4, 0.35) + '"/>' +
        '<circle cx="372" cy="98" r="11" fill="#d8ccb0" opacity=".5"/><circle cx="426" cy="146" r="7" fill="#d8ccb0" opacity=".5"/>' +
        '<path d="M150 340C250 300 330 300 520 316V440H150Z" fill="#2a0f3e" opacity=".8"/>' +
        castle +
        '<g fill="#160826">' + tree(240, 350, 110) + tree(276, 356, 80) + tree(510, 352, 120) + tree(288, 360, 60) + '</g>' +
        // the garden: a hedge with moonlit edges, and the rose rising from it
        ground('M0 440V372C120 356 250 374 360 362S470 354 520 358V440Z', '#1c0a2e') +
        '<path d="M150 440V388C220 372 320 384 400 376S490 370 520 374V440Z" fill="' + lin('bhedge', [[0, '#2e5a3a'], [1, '#12261a']]) + '"/>' +
        scatter(552, 22, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="7" fill="#3a7048" opacity=".65"/>', 160, 520, 380, 400) +
        '<path d="M446 440C452 390 432 330 436 270" fill="none" stroke="' + stem + '" stroke-width="7" stroke-linecap="round"/>' +
        '<path d="M442 350C420 334 398 338 388 350C404 362 426 362 442 350Z" fill="#3e8a4a"/><path d="M440 312C460 296 484 298 494 312C478 324 456 324 440 312Z" fill="#3e8a4a"/>' +
        '<path d="M442 350C424 346 406 348 390 350M440 312C458 308 476 310 492 312" stroke="#2a5a32" stroke-width="1.6" fill="none"/>' +
        '<g stroke="' + stem + '" stroke-width="3" stroke-linecap="round"><path d="M444 392l9 -5M438 300l-8 -5"/></g>' +
        glow('brglow', 436, 252, 80, '#ff8aa0', 0.5) +
        rose(436, 252, 1.45, red, '#8a0a22') +
        // a fallen petal and the ring beside it
        '<path d="M368 408C360 398 372 390 380 398C384 404 376 412 368 408Z" fill="#e2304e"/>' +
        '<g transform="translate(320 404) rotate(-10)"><ellipse rx="14" ry="7" fill="none" stroke="#ffe08a" stroke-width="4.4"/>' +
          '<path d="M-5 -10L0 -16L5 -10L0 -5Z" fill="#c9f2ff" stroke="#fff" stroke-width="1"/></g>' +
        sparkle(470, 220, 8) + sparkle(396, 300, 6) + sparkle(300, 70, 7) + sparkle(512, 90, 5);
    },

    // The golden staff with its red ends, riding a swirling cloud over the
    // peaks and waterfall of Flower-Fruit Mountain, peaches on a branch above.
    'Sun Wukong': () => {
      const gold = lin('sgold', [[0, '#fff3b0'], [0.5, '#ffcf3c'], [1, '#c07a14']], 0, 0, 1, 1);
      const peach = lin('speach', [[0, '#ffd2b0'], [0.6, '#ff8a7a'], [1, '#e0405a']], 0, 0, 1, 1);
      const cloudFill = lin('scloud', [[0, '#ffffff'], [1, '#ffd6ec']]);
      const peachAt = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
        '<path d="M0 -14C-12 -18 -20 -6 -18 6C-16 16 -6 20 0 18C6 20 16 16 18 6C20 -6 12 -18 0 -14Z" fill="' + peach + '"/>' +
        '<path d="M0 -14C-3 -2 -3 10 0 18" fill="none" stroke="#c03a52" stroke-width="1.6" opacity=".6"/>' +
        '<ellipse cx="-8" cy="-4" rx="4" ry="6" fill="#fff" opacity=".45"/>' +
        '<path d="M0 -14C6 -24 16 -24 20 -18C14 -12 6 -12 0 -14Z" fill="#5ab04a"/></g>';
      // the cloud: puffs with curling ends, the way the old paintings draw it
      const curl = (x, y, r, dir = 1) => '<path d="M' + x + ' ' + y + 'a' + r + ' ' + r + ' 0 1 ' + (dir > 0 ? 1 : 0) + ' ' + n(r * 1.4 * dir) + ' ' + n(-r * 0.6) + 'a' + n(r * 0.55) + ' ' + n(r * 0.55) + ' 0 1 ' + (dir > 0 ? 0 : 1) + ' ' + n(-r * 0.8 * dir) + ' ' + n(r * 0.3) + '" fill="none" stroke="#c45a9a" stroke-width="3" stroke-linecap="round" opacity=".7"/>';
      const cloud = '<g transform="translate(400 236)">' +
        '<path d="M-108 20C-130 18 -132 -6 -110 -10C-112 -34 -80 -42 -66 -26C-60 -52 -20 -58 -8 -34C4 -56 46 -52 50 -26C70 -40 104 -28 98 -4C122 -6 132 18 110 26C90 34 -86 34 -108 20Z" fill="' + cloudFill + '" stroke="#fff" stroke-width="3"/>' +
        '<path d="M-118 26C-150 30 -170 14 -168 -2" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".8"/>' +
        '<path d="M-168 -2C-166 -18 -146 -20 -144 -6" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/></g>' +
        curl(318, 238, 12) + curl(386, 218, 14) + curl(456, 226, 12, -1) + curl(488, 244, 9);
      // the staff, end to end across the box
      const sx0 = 262; const sy0 = 196; const sx1 = 520; const sy1 = 74;
      const along = t => [n(sx0 + (sx1 - sx0) * t), n(sy0 + (sy1 - sy0) * t)];
      const [a1, b1] = along(0.08); const [a2, b2] = along(0.92);
      const band = t => { const [x, y] = along(t); return '<circle cx="' + x + '" cy="' + y + '" r="10" fill="none" stroke="#a8601a" stroke-width="2.4"/>'; };
      return tint('#ffb37a', '#b03a7a', 0.55) +
        glow('ssun', 420, 120, 200, '#fff0c4', 0.8) +
        '<circle cx="430" cy="128" r="62" fill="#fff4cc" opacity=".75"/>' +
        // Flower-Fruit Mountain: peaks, mist and the waterfall over the cave
        '<path d="M150 440V320L210 250L250 290L300 210L350 270L400 196L452 262L486 228L520 250V440Z" fill="#7a2a6a" opacity=".55"/>' +
        '<path d="M150 440V350L230 296L280 330L340 270L392 320L440 270L490 300L520 286V440Z" fill="' + lin('smount', [[0, '#5a1a5a'], [1, '#2a0b3d']]) + '"/>' +
        '<path d="M374 300C380 330 378 380 384 440H404C398 384 398 334 394 300Z" fill="' + lin('sfall', [[0, '#e8f4ff'], [1, '#a8d4ff', 0.6]]) + '"/>' +
        '<g stroke="#fff" stroke-width="1.6" opacity=".6"><path d="M382 320V360M390 330V384M398 316V350"/></g>' +
        '<path d="M330 300C360 290 400 292 430 300" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".35"/>' +
        cloud +
        // the staff, gold with red ends
        '<path d="M' + sx0 + ' ' + sy0 + 'L' + sx1 + ' ' + sy1 + '" stroke="#7a420c" stroke-width="19" stroke-linecap="round" opacity=".35" transform="translate(3 5)"/>' +
        '<path d="M' + sx0 + ' ' + sy0 + 'L' + sx1 + ' ' + sy1 + '" stroke="' + gold + '" stroke-width="16" stroke-linecap="round"/>' +
        '<path d="M' + sx0 + ' ' + sy0 + 'L' + a1 + ' ' + b1 + 'M' + a2 + ' ' + b2 + 'L' + sx1 + ' ' + sy1 + '" stroke="#e01a3a" stroke-width="20" stroke-linecap="round"/>' +
        band(0.1) + band(0.9) + band(0.5) +
        '<path d="M' + along(0.2).join(' ') + 'L' + along(0.8).join(' ') + '" stroke="#fffbe0" stroke-width="3" stroke-linecap="round" opacity=".8" transform="translate(-1 -3)"/>' +
        // a peach branch reaching in at the top
        '<path d="M520 0C480 20 440 18 400 6M470 14C466 30 470 40 478 48" fill="none" stroke="#6a3a1a" stroke-width="5" stroke-linecap="round"/>' +
        '<g fill="#5ab04a"><path d="M430 12C420 0 404 0 398 8C408 18 422 18 430 12Z"/><path d="M500 10C506 -2 520 -2 524 6C516 16 504 16 500 10Z"/></g>' +
        peachAt(476, 60, 1.4) + peachAt(436, 30, 1.05) +
        sparkle(300, 100, 8) + sparkle(500, 170, 7) + sparkle(350, 160, 5, '#fff6cc') +
        scatter(661, 12, (x, y, r) => '<path d="M' + x + ' ' + y + 'c-4 -4 -10 -1 -8 4 2 4 8 4 8 -4z" fill="#ffb3c6" opacity="' + n(0.5 + r() * 0.4) + '"/>', 220, 520, 30, 300) +
        '<path d="M0 440V392C120 380 260 398 380 388S480 382 520 386V440Z" fill="#2a0b3d"/>';
    },
  };

  const fill = d => '<path d="' + d + '" fill="currentColor" fill-opacity=".18"/><path d="' + d + '"/>';
  const emblems = {
    // An oil lamp, smoke curling from its spout.
    'Aladdin': fill('M6 31c0-6 10-9 18-9s13 2 15 5l6-5c1-1 2 0 1 1l-6 8c-2 4-9 7-16 7S6 37 6 31z') +
      '<path d="M17 23c0-5 3-8 7-8s7 3 7 8"/><circle cx="24" cy="13" r="1.8"/><path d="M6 29c-4 0-4 6 0 6"/><path d="M18 38l-2 5h16l-2-5"/>' +
      '<path d="M42 20c-3-3 2-5 0-8s2-5 0-8"/>',
    // A target with an arrow in the gold.
    'Robin Hood': fill('M20 8a18 18 0 1 0 .01 0z') + '<circle cx="20" cy="26" r="11"/><circle cx="20" cy="26" r="4" fill="currentColor" stroke="none"/>' +
      '<path d="M20 26L43 5"/><path d="M38 4l5 1 1 5M35 7l4 1M41 11l-1-4"/>',
    // A crystal on a staff, with a star.
    'Merlin': fill('M24 3l8 9-8 11-8-11z') + '<path d="M24 3v20M16 12h16"/><path d="M24 23v22"/><path d="M19 25c-3 1-4 4-3 6M29 25c3 1 4 4 3 6"/>' +
      '<path d="M40 30l1 2.6 2.6 1-2.6 1L40 37l-1-2.4-2.6-1 2.6-1z" fill="currentColor" stroke="none"/><path d="M8 34v4M6 36h4"/>',
    // A single rose on its stem.
    'The Beast': fill('M24 23c-8 0-12-6-10-13 4 2 7 1 10-4 3 5 6 6 10 4 2 7-2 13-10 13z') +
      '<path d="M19 14c2 3 7 3 10 0"/><path d="M24 23v22"/><path d="M24 33c-5-3-9-2-11 1 4 3 8 2 11-1z"/><path d="M24 38c5-3 9-2 11 1-4 3-8 2-11-1z"/>',
    // The staff over a curling cloud.
    'Sun Wukong': fill('M5 40c-3 0-4-5 0-6 0-4 6-6 9-3 2-4 9-3 10 1 4-1 6 3 4 6-1 2-3 2-4 2z') +
      '<path d="M5 40c-3 1-4-3-2-4"/><path d="M9 28L43 6"/><path d="M9 28l5-3M38 9l5-3" stroke-width="4"/>',
  };

  return { scenes, emblems };
}
