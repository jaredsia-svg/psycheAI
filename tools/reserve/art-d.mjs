// Reserve scenes, batch D: Goldilocks, Heidi, Sinbad, The Tortoise, The Ant.
// Drawn from the public-domain stories' own things (three bowls, an Alpine
// hut, a dhow and the roc, a road to a finish ribbon, a wheat field), never a
// likeness or a later film's look.
export default function (h) {
  const { W, n, lin, rad, glow, tint, ground, starPath, stars, sparkle, scatter } = h;

  const pine = (x, y, s, fill) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 -60L16 -30H8L22 -6H10L26 18H-26L-10 -6H-22L-8 -30H-16Z" fill="' + fill + '"/>' +
    '<rect x="' + n(x - 3 * s) + '" y="' + n(y + 18 * s) + '" width="' + n(6 * s) + '" height="' + n(10 * s) + '" fill="' + fill + '"/>';
  const flower = (x, y, c, r = 4) => '<g fill="' + c + '">' + [0, 72, 144, 216, 288].map(a => {
    const t = a * Math.PI / 180;
    return '<circle cx="' + n(x + r * 1.3 * Math.sin(t)) + '" cy="' + n(y - r * 1.3 * Math.cos(t)) + '" r="' + r + '"/>';
  }).join('') + '</g><circle cx="' + x + '" cy="' + y + '" r="' + n(r * 0.8) + '" fill="#ffd23c"/>';

  return {
    scenes: {
      // A cottage in the woods with its door open, and in the bright window
      // three bowls of porridge, great, middle and small, steaming on the table.
      'Goldilocks': () => {
        const wall = lin('wall', [[0, '#fff3dc'], [1, '#e8c89a']]);
        const roof = lin('roof', [[0, '#d0603a'], [1, '#7a2a2a']]);
        const bowl = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
          '<path d="M-20 0H20C20 14 10 20 0 20S-20 14 -20 0Z" fill="#c9732a" stroke="#6a3010" stroke-width="2"/>' +
          '<ellipse cx="0" cy="0" rx="20" ry="5" fill="#fff6dc" stroke="#6a3010" stroke-width="2"/>' +
          '<path d="M-6 -6C-10 -12 -2 -16 -6 -24M6 -6C2 -12 10 -16 6 -24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/></g>';
        return tint('#ffd27a', '#b83a7a', 0.5) + glow('sun', 420, 96, 170, '#fff2c4', 0.8) +
          '<circle cx="420" cy="96" r="44" fill="#fff6d6" opacity=".9"/>' +
          pine(200, 330, 1.4, '#5a2a6a') + pine(250, 320, 1.1, '#6a3a7a') + pine(500, 300, 1.5, '#5a2a6a') +
          '<path d="M0 440V340C110 326 230 344 330 336S470 324 520 330V440Z" fill="#7ac06a"/>' +
          // The cottage.
          '<g transform="translate(398 264)">' +
            '<rect x="-84" y="-30" width="168" height="104" fill="' + wall + '" stroke="#6a3010" stroke-width="3"/>' +
            '<path d="M-100 -26L0 -100L100 -26Z" fill="' + roof + '" stroke="#5a1a1a" stroke-width="3" stroke-linejoin="round"/>' +
            '<rect x="40" y="-90" width="18" height="34" fill="#7a3a2a"/>' +
            '<path d="M49 -96C40 -110 58 -116 48 -132" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".35"/>' +
            glow('win', -24, 8, 60, '#ffd98a', 0.6) +
            '<rect x="-74" y="-16" width="100" height="60" rx="4" fill="#ffe7a8" stroke="#6a3010" stroke-width="3"/>' +
            '<rect x="-70" y="22" width="92" height="6" fill="#8a4a20"/>' +
            bowl(-52, 12, 1.05) + bowl(-22, 15, 0.8) + bowl(4, 18, 0.58) +
            '<path d="M38 74V8A18 18 0 0 1 74 8V74Z" fill="#8a4a20" stroke="#5a2a10" stroke-width="3"/>' +
            '<path d="M38 74V8A18 18 0 0 1 50 -8V60Z" fill="#ffe7a8" opacity=".5"/>' +
            '<circle cx="66" cy="42" r="3" fill="#ffd98a"/></g>' +
          // The path out of the woods to the door.
          '<path d="M300 440C330 410 380 380 432 340H468C420 380 380 410 360 440Z" fill="#e8c89a" opacity=".85"/>' +
          ground('M0 440V398C120 386 240 404 340 394S470 386 520 392V440Z', '#3f8a4a') +
          flower(300, 400, '#fff') + flower(486, 396, '#ffb3c6') + flower(500, 418, '#fff') + flower(280, 424, '#ffb3c6') +
          sparkle(300, 120, 8) + sparkle(500, 180, 7);
      },

      // Alpine morning: snowy peaks catching the sunrise, the grandfather's hut
      // on the slope, edelweiss and a goat's bell in the meadow.
      'Heidi': () => {
        const peak = lin('peak', [[0, '#fff6f0'], [1, '#c9a0d8']]);
        const edel = (x, y, s) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 18V0" stroke="#3f8a4a" stroke-width="2.4"/>' +
          [0, 60, 120, 180, 240, 300].map(a => '<ellipse cx="0" cy="-8" rx="3.6" ry="8" fill="#fffaf0" stroke="#c9c0d8" stroke-width="1" transform="rotate(' + a + ')"/>').join('') +
          '<circle r="3.6" fill="#ffd23c"/></g>';
        return tint('#ffb0a0', '#7a3a9a', 0.5) + glow('sun', 430, 160, 170, '#fff2c4', 0.85) +
          '<circle cx="430" cy="170" r="40" fill="#fff6d6"/>' +
          '<path d="M180 300L290 120L340 190L410 60L520 230V300Z" fill="' + peak + '"/>' +
          '<path d="M290 120L270 156L290 150L300 166L316 152Z M410 60L384 106L404 98L416 118L436 98Z" fill="#fff"/>' +
          '<path d="M290 120L340 190L320 300H260Z M410 60L520 230V300H440Z" fill="#8a5aa8" opacity=".35"/>' +
          '<path d="M0 440V300C120 270 260 290 360 262S480 240 520 246V440Z" fill="' + lin('meadow', [[0, '#8ad07a'], [1, '#3f8a4a']]) + '"/>' +
          // The hut, with its bench and the fir trees behind.
          pine(462, 254, 0.8, '#2f6a3a') + pine(492, 250, 0.95, '#2f6a3a') +
          '<g transform="translate(410 270)">' +
            '<rect x="-42" y="-10" width="84" height="46" fill="' + lin('logs', [[0, '#b07040'], [1, '#6a3a1a']]) + '" stroke="#4a2410" stroke-width="2.4"/>' +
            '<g stroke="#4a2410" stroke-width="1.6" opacity=".6"><path d="M-42 2H42M-42 14H42M-42 26H42"/></g>' +
            '<path d="M-54 -6L0 -44L54 -6Z" fill="#7a3a2a" stroke="#4a1a10" stroke-width="2.4" stroke-linejoin="round"/>' +
            '<rect x="-10" y="8" width="20" height="28" fill="#4a2410"/><rect x="18" y="0" width="16" height="14" fill="#ffe7a8" stroke="#4a2410" stroke-width="2"/>' +
            '<path d="M-38 30H-18" stroke="#4a2410" stroke-width="4"/></g>' +
          // A goat's bell on its collar strap, lying in the grass.
          '<g transform="translate(330 368)"><path d="M-26 -12C-10 -22 10 -22 26 -12" fill="none" stroke="#c2366a" stroke-width="6" stroke-linecap="round"/>' +
            '<path d="M-14 -10H14L18 18H-18Z" fill="' + lin('bell', [[0, '#ffe9a6'], [1, '#c98a2a']]) + '" stroke="#7a4a10" stroke-width="2"/>' +
            '<circle cy="22" r="4" fill="#7a4a10"/></g>' +
          ground('M0 440V404C120 394 240 410 340 400S470 392 520 398V440Z', '#2f6a3a') +
          edel(290, 404, 1) + edel(470, 382, 0.9) + edel(500, 410, 1.1) + edel(392, 414, 0.8) +
          flower(260, 420, '#c9a0ff', 3) + flower(440, 420, '#ffb3c6', 3) + sparkle(330, 90, 7);
      },

      // A dhow under its triangular sail on a night sea, the vast roc flying
      // across the moon, an island of the voyages on the horizon.
      'Sinbad': () => {
        const sea = lin('sea', [[0, '#2a1a6a'], [1, '#0e0628']]);
        const sail = lin('sail', [[0, '#fff6e0'], [1, '#e8c89a']], 0, 0, 1, 1);
        return tint('#1a1450', '#7a2a7a', 0.6) + stars(311, 60, 120, W, 0, 260, '#ffe9c4') +
          glow('moon', 410, 110, 160, '#fff0c4', 0.7) +
          '<circle cx="410" cy="110" r="62" fill="' + rad('moonf', [[0, '#fffaf0'], [1, '#ffd98a']], 0.4, 0.35) + '"/>' +
          // The roc, wings spread, across the moon.
          '<g transform="translate(420 104)" fill="#2a0d3e">' +
            '<path d="M0 0C-30 -30 -80 -36 -120 -24C-90 -14 -60 4 -30 6C-50 14 -70 20 -96 22C-60 30 -20 20 0 10C20 20 60 30 96 22C70 20 50 14 30 6C60 4 90 -14 120 -24C80 -36 30 -30 0 0Z"/>' +
            '<path d="M-6 6L0 30L6 6Z"/><circle cx="0" cy="-2" r="7"/></g>' +
          '<rect x="0" y="290" width="520" height="150" fill="' + sea + '"/>' +
          '<path d="M370 290H450L430 440H390Z" fill="#ffd98a" opacity=".2"/>' +
          // The island, with two palms.
          '<path d="M190 292C220 270 270 266 300 280C312 276 324 282 330 292Z" fill="#14062a"/>' +
          '<path d="M250 276C252 260 256 248 262 240M262 240C252 236 244 240 238 246M262 240C268 232 278 232 284 236M262 240C266 248 266 254 262 260" fill="none" stroke="#14062a" stroke-width="3" stroke-linecap="round"/>' +
          // The dhow: long sloping yard, lateen sail, raked hull.
          '<g transform="translate(410 330)">' +
            '<path d="M-4 22L4 -110" stroke="#3a1a0a" stroke-width="5"/>' +
            '<path d="M-96 2L66 -150" stroke="#3a1a0a" stroke-width="5" stroke-linecap="round"/>' +
            '<path d="M-92 0L62 -146C70 -100 62 -40 40 4Z" fill="' + sail + '" stroke="#8a5a3a" stroke-width="2.4" stroke-linejoin="round"/>' +
            '<path d="M-40 -48C0 -60 34 -78 58 -110" fill="none" stroke="#c2366a" stroke-width="5" opacity=".7"/>' +
            '<path d="M-110 6C-80 22 60 24 96 2L82 30C40 42 -60 42 -92 28Z" fill="' + lin('hull', [[0, '#8a4a20'], [1, '#3a1608']]) + '" stroke="#1a0804" stroke-width="2.4"/>' +
            '<path d="M-96 24C-40 32 40 32 84 20" stroke="#ffd98a" stroke-width="2.4" stroke-dasharray="4 6" opacity=".8"/>' +
            '<path d="M60 -150L72 -158L66 -146Z" fill="#c2366a"/></g>' +
          '<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".25"><path d="M280 380C300 374 320 374 340 380S380 386 400 380M420 396C440 390 460 390 480 396"/></g>' +
          sparkle(300, 70, 8) + sparkle(500, 230, 7);
      },

      // A tortoise plodding up a winding road toward the finish ribbon,
      // the sun rising behind it.
      'The Tortoise': () => {
        const shell = lin('shell', [[0, '#a8d070'], [1, '#4a7a3a']]);
        return tint('#ffc070', '#a83a7a', 0.5) + glow('sun', 420, 130, 170, '#fff2c4', 0.85) +
          '<circle cx="420" cy="130" r="50" fill="#fff6d6"/>' +
          '<path d="M0 440V280C110 262 230 276 330 262S470 246 520 252V440Z" fill="' + lin('hill', [[0, '#9ad07a'], [1, '#3f8a4a']]) + '"/>' +
          // The road, winding up to the line.
          '<path d="M240 440C300 410 420 400 400 360S400 300 450 244L494 242C450 290 448 330 450 360C454 404 360 420 330 440Z" fill="#f0d8a8" opacity=".9"/>' +
          // The finish: two posts and a ribbon.
          '<path d="M444 250V196M500 248V194" stroke="#6a3a1a" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M444 204C464 212 482 212 500 202" fill="none" stroke="#c2366a" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="M500 194L518 200L500 206Z" fill="#ffd23c"/>' +
          // The tortoise.
          '<g transform="translate(394 312) scale(1.25)">' +
            '<ellipse cx="0" cy="18" rx="64" ry="8" fill="#1c3a1a" opacity=".35"/>' +
            '<path d="M-50 10C-50 -30 -24 -48 4 -48S56 -30 56 10Z" fill="' + shell + '" stroke="#2a4a1a" stroke-width="3"/>' +
            '<g fill="none" stroke="#2a4a1a" stroke-width="2.4" opacity=".7"><path d="M-16 -30L4 -40L24 -30L22 -10H-14Z"/><path d="M-14 -10L-36 4M22 -10L44 4M4 -40V-48M-16 -30L-36 -20M24 -30L44 -20"/></g>' +
            '<path d="M-56 10H62" stroke="#2a4a1a" stroke-width="5" stroke-linecap="round"/>' +
            '<path d="M56 0C70 -6 86 -6 92 4C94 12 84 16 66 12Z" fill="#8ab060" stroke="#2a4a1a" stroke-width="2.4"/><circle cx="82" cy="2" r="2.4" fill="#1a2a10"/>' +
            '<g fill="#8ab060" stroke="#2a4a1a" stroke-width="2.4"><path d="M-36 10V22H-24V10Z"/><path d="M30 10V22H42V10Z"/></g>' +
            '<path d="M-50 4L-64 8L-50 12Z" fill="#8ab060"/></g>' +
          ground('M0 440V412C120 402 240 418 340 408S470 400 520 406V440Z', '#2f6a3a') +
          flower(300, 412, '#fff', 3) + flower(490, 410, '#ffb3c6', 3) + sparkle(470, 90, 8) + sparkle(300, 150, 6);
      },

      // An ant carrying a grain of wheat home to its tidy nest at the edge
      // of a golden field at harvest sunset.
      'The Ant': () => {
        const gold = lin('gold', [[0, '#ffe39a'], [1, '#d08a2a']]);
        const stalk = (x, y, s, a) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')">' +
          '<path d="M0 0V-80" stroke="#c98a2a" stroke-width="2.4"/>' +
          [0, 1, 2, 3, 4].map(i => '<ellipse cx="-4" cy="' + (-82 + i * 9) + '" rx="3.4" ry="6" fill="' + gold + '" transform="rotate(-24 -4 ' + (-82 + i * 9) + ')"/>' +
            '<ellipse cx="4" cy="' + (-78 + i * 9) + '" rx="3.4" ry="6" fill="' + gold + '" transform="rotate(24 4 ' + (-78 + i * 9) + ')"/>').join('') +
          '<path d="M0 -86V-104" stroke="#e8b04a" stroke-width="1.4"/></g>';
        const wheat = [];
        for (let i = 0; i < 22; i++) wheat.push(stalk(150 + i * 17, 340 + (i % 3) * 6, 0.8 + (i % 4) * 0.08, (i % 5) * 3 - 6));
        return tint('#ffb060', '#9a2a6a', 0.55) + glow('sun', 440, 110, 170, '#fff0c4', 0.85) +
          '<circle cx="440" cy="110" r="50" fill="#fff4c4"/>' +
          '<path d="M0 440V320C120 304 240 316 340 306S470 296 520 300V440Z" fill="#e8a84a"/>' +
          wheat.join('') +
          // The nest: a neat mound with its doorway and a little granary of grains.
          '<path d="M300 440V384C330 320 430 310 480 370C494 390 504 410 504 440Z" fill="' + lin('mound', [[0, '#b07a4a'], [1, '#5a3418']]) + '"/>' +
          '<path d="M410 400C410 380 436 380 436 400V414H410Z" fill="#2a1408"/>' +
          '<g fill="' + gold + '" stroke="#8a5a1a" stroke-width="1">' + [[452, 402], [464, 404], [458, 394], [472, 408], [446, 412]].map(([x, y]) => '<ellipse cx="' + x + '" cy="' + y + '" rx="5" ry="3.2"/>').join('') + '</g>' +
          // The ant, carrying its grain overhead.
          '<g transform="translate(372 306) scale(2.4)" fill="#2a0d1e" stroke="#2a0d1e" stroke-linecap="round">' +
            '<ellipse cx="-14" cy="0" rx="10" ry="8"/><ellipse cx="2" cy="-2" rx="7" ry="6"/><circle cx="14" cy="-6" r="6"/>' +
            '<path d="M-10 6L-18 16M-2 6L-6 18M4 4L8 16" stroke-width="2.4" fill="none"/>' +
            '<path d="M16 -11L22 -20M12 -11L12 -21" stroke-width="2" fill="none"/>' +
            '<path d="M6 -6L10 -24M0 -6L-4 -24" stroke-width="2.4" fill="none"/>' +
            '<ellipse cx="3" cy="-30" rx="12" ry="6.4" fill="' + gold + '" stroke="#8a5a1a" stroke-width="1.4"/>' +
            '<circle cx="16" cy="-7" r="1.6" fill="#fff" stroke="none"/></g>' +
          ground('M0 440V418C120 410 240 424 340 414S470 408 520 412V440Z', '#5a2a1a') +
          sparkle(300, 110, 8) + sparkle(500, 240, 7) +
          scatter(331, 14, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.4 + r() * 1.6) + '" fill="#fff6c4" opacity="' + n(0.4 + r() * 0.4) + '"/>', 220, W, 180, 320);
      },
    },

    emblems: {
      // Three bowls, great, middle and small.
      'Goldilocks': '<path d="M3 26h18c0 7-4 10-9 10s-9-3-9-10z" fill="currentColor" fill-opacity=".18"/><path d="M3 26h18c0 7-4 10-9 10s-9-3-9-10z"/><path d="M24 30h13c0 5-3 7-6.5 7S24 35 24 30z"/><path d="M39 33h7c0 3-1.5 4-3.5 4S39 36 39 33z"/><path d="M2 41h44"/><path d="M9 20c-2-3 2-5 0-8M15 20c-2-3 2-5 0-8M30 25c-2-3 2-4 0-7"/>',
      // An edelweiss.
      'Heidi': '<path d="M24 44V28"/><path d="M24 26c-3-8-3-14 0-20 3 6 3 12 0 20zM24 26c8-3 14-3 20 0-6 3-12 3-20 0zM24 26c-8-3-14-3-20 0 6 3 12 3 20 0z" fill="currentColor" fill-opacity=".18"/><path d="M24 26c-3-8-3-14 0-20 3 6 3 12 0 20zM24 26c8-3 14-3 20 0-6 3-12 3-20 0zM24 26c-8-3-14-3-20 0 6 3 12 3 20 0z"/><path d="M24 26l-11-11M24 26l11-11"/><circle cx="24" cy="26" r="3" fill="currentColor" stroke="none"/><path d="M18 40c2-2 4-2 6 0M24 40c2-2 4-2 6 0"/>',
      // A dhow under its lateen sail.
      'Sinbad': '<path d="M23 34L25 8"/><path d="M8 32L38 4c2 10 0 20-6 28z" fill="currentColor" fill-opacity=".18"/><path d="M8 32L38 4c2 10 0 20-6 28z"/><path d="M4 34c6 4 34 4 40-1l-3 6c-8 3-28 3-34 0z" fill="currentColor" fill-opacity=".18"/><path d="M4 34c6 4 34 4 40-1l-3 6c-8 3-28 3-34 0z"/><path d="M6 45c4-2 8-2 12 0s8 2 12 0 8-2 12 0"/>',
      // A tortoise.
      'The Tortoise': '<path d="M6 32c0-12 7-18 16-18s16 6 16 18z" fill="currentColor" fill-opacity=".18"/><path d="M6 32c0-12 7-18 16-18s16 6 16 18z"/><path d="M15 20l7-4 7 4-1 7h-12z"/><path d="M4 32h37"/><path d="M38 28c3-2 7-2 8 1s-3 4-7 3"/><path d="M12 32v5M30 32v5"/><circle cx="43" cy="28" r=".8" fill="currentColor"/>',
      // An ant with its grain.
      'The Ant': '<ellipse cx="14" cy="32" rx="7" ry="5.6" fill="currentColor" fill-opacity=".18"/><ellipse cx="14" cy="32" rx="7" ry="5.6"/><ellipse cx="25" cy="30" rx="4.6" ry="4"/><circle cx="33" cy="27" r="4"/><path d="M12 37l-4 7M18 37l-1 7M25 34l3 7"/><path d="M35 23l4-6M32 23l0-6"/><path d="M27 26l2-10M23 26l-2-10"/><ellipse cx="25" cy="12" rx="8" ry="4" fill="currentColor" fill-opacity=".18"/><ellipse cx="25" cy="12" rx="8" ry="4"/>',
    },
  };
}
