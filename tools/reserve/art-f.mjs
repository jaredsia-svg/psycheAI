// Reserve scenes, batch F: Gretel and Atlas. Drawn from the public-domain
// stories' own things (Grimm's trail of white pebbles home; the titan's
// celestial sphere), never a likeness or a later film's look.
export default function (h) {
  const { W, n, lin, rad, glow, tint, ground, starPath, stars, sparkle, scatter } = h;

  // A pine silhouette standing on (x, y), h tall.
  const pine = (x, y, ht, fill) => {
    const w = ht * 0.36;
    return '<path d="M' + x + ' ' + n(y - ht) + 'L' + n(x + w * 0.55) + ' ' + n(y - ht * 0.62) + 'H' + n(x + w * 0.3) +
      'L' + n(x + w * 0.8) + ' ' + n(y - ht * 0.3) + 'H' + n(x + w * 0.45) + 'L' + n(x + w) + ' ' + n(y - ht * 0.04) +
      'H' + n(x - w) + 'L' + n(x - w * 0.45) + ' ' + n(y - ht * 0.3) + 'H' + n(x - w * 0.8) + 'L' + n(x - w * 0.3) + ' ' +
      n(y - ht * 0.62) + 'H' + n(x - w * 0.55) + 'Z" fill="' + fill + '"/><rect x="' + n(x - 3) + '" y="' + n(y - ht * 0.05) +
      '" width="6" height="' + n(ht * 0.06) + '" fill="' + fill + '"/>';
  };

  return {
    scenes: {
      // Grimm: the white pebbles Hansel and Gretel laid, shining in the
      // moonlight like new coins, a trail through the dark wood back to the
      // lit window of home. Far off in the trees, small, the house of bread
      // and sugar they outwitted.
      'Gretel': () => {
        const pebble = rad('pebble', [[0, '#ffffff'], [0.6, '#eef0ff'], [1, '#b8b4e0']], 0.4, 0.35);
        const path = [[214, 432, 1.15], [244, 418, 1.1], [276, 410, 1.05], [300, 396, 1], [318, 380, 0.95], [336, 368, 0.9],
          [356, 358, 0.85], [378, 350, 0.8], [398, 344, 0.75], [416, 340, 0.7]];
        const stone = ([x, y, s]) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(16 * s) + '" fill="#fff" opacity=".16"/>' +
          '<ellipse cx="' + x + '" cy="' + y + '" rx="' + n(7 * s) + '" ry="' + n(4.6 * s) + '" fill="' + pebble + '"/>' +
          '<ellipse cx="' + n(x - 2 * s) + '" cy="' + n(y - 1.6 * s) + '" rx="' + n(2.2 * s) + '" ry="' + n(1.2 * s) + '" fill="#fff"/>';
        return tint('#1c1a4a', '#4a2a6a', 0.65) + stars(611, 46, 120, W, 0, 200) +
          // The moon, the bright centrepiece.
          glow('moon', 410, 92, 150, '#f4f0ff', 0.6) +
          '<circle cx="410" cy="92" r="46" fill="' + rad('moonf', [[0, '#fffefa'], [1, '#e8e2ff']], 0.42, 0.38) + '"/>' +
          '<circle cx="396" cy="82" r="7" fill="#d6cfee" opacity=".55"/><circle cx="424" cy="104" r="5" fill="#d6cfee" opacity=".55"/>' +
          // Moonbeams slanting into the wood.
          '<path d="M380 120L300 440H360Z" fill="#fff" opacity=".05"/><path d="M430 130L420 440H470Z" fill="#fff" opacity=".04"/>' +
          // The far wood, and deep in it, small, the sugar house.
          '<g opacity=".7">' + [150, 190, 230, 270, 310, 350, 390, 430, 470, 510].map((x, i) => pine(x, 300, 90 + (i % 3) * 18, '#2e2058')).join('') + '</g>' +
          '<g transform="translate(262 290) scale(.55)">' +
            '<rect x="-22" y="-22" width="44" height="30" fill="#c98a5a"/>' +
            '<path d="M-28 -20L0 -44L28 -20Z" fill="#fff4f8"/><path d="M-28 -20L0 -44L28 -20" fill="none" stroke="#ff8ab8" stroke-width="3" stroke-dasharray="4 4"/>' +
            '<rect x="-6" y="-8" width="12" height="16" rx="6" fill="#ff8ab8"/>' +
            '<circle cx="-14" cy="-12" r="3" fill="#ffd23c"/><circle cx="14" cy="-12" r="3" fill="#7ad0ff"/></g>' +
          // The near wood, darker.
          '<g>' + [[132, 380, 150], [176, 392, 120], [508, 376, 150]].map(([x, y, ht]) => pine(x, y, ht, '#170f30')).join('') + '</g>' +
          // Home: a cottage with its window lit, where the trail ends.
          glow('win', 432, 300, 64, '#ffd98a', 0.7) +
          '<g transform="translate(434 322) scale(.9)">' +
            '<rect x="-34" y="-24" width="68" height="44" fill="#3a2652"/>' +
            '<path d="M-44 -22L0 -60L44 -22Z" fill="#2a1a40"/><rect x="18" y="-56" width="10" height="20" fill="#2a1a40"/>' +
            '<path d="M24 -60C20 -72 30 -78 24 -90" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".18"/>' +
            '<rect x="-24" y="-14" width="20" height="18" rx="2" fill="#ffd98a"/><path d="M-14 -14V4M-24 -5H-4" stroke="#3a2652" stroke-width="2.4"/>' +
            '<rect x="6" y="-8" width="16" height="28" rx="2" fill="#24163a"/><circle cx="18" cy="6" r="1.6" fill="#ffd98a"/></g>' +
          // The forest floor and the shining path home.
          ground('M0 440V372C90 360 190 380 280 368S430 340 520 336V440Z', '#1e1438') +
          '<path d="M196 440C240 420 290 406 320 384S392 350 420 340L436 346C404 356 360 372 334 394S262 430 236 440Z" fill="#2c2050"/>' +
          path.map(stone).join('') +
          sparkle(352, 330, 6) + sparkle(300, 170, 5) + sparkle(488, 200, 6) +
          scatter(612, 12, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.4 + r() * 1.6) + '" fill="#ffe9a6" opacity="' + n(0.4 + r() * 0.5) + '"/>', 260, W, 220, 360);
      },

      // The titan who holds up the heavens: the celestial sphere, banded
      // with gold and dotted with constellations, borne on the shoulders of
      // a kneeling figure on a mountain peak at dawn, temple columns below.
      'Atlas': () => {
        const sphere = rad('sph', [[0, '#fffaf0'], [0.45, '#ffe6b0'], [1, '#e0a24a']], 0.36, 0.32);
        const gold = lin('gold', [[0, '#fff0b0'], [1, '#d08a2a']]);
        const titan = lin('titan', [[0, '#3a1a52'], [1, '#1a0a2a']]);
        const cx = 400, cy = 118, r = 82;
        // Constellation dots and lines on the sphere's face.
        const cons = [[[-40, -30], [-22, -44], [-4, -36], [8, -54]], [[18, 10], [36, -6], [54, 8], [40, 28]], [[-50, 20], [-30, 34], [-12, 22]]];
        const consMarkup = cons.map(pts => '<path d="M' + pts.map(([x, y]) => (cx + x) + ' ' + (cy + y)).join('L') +
          '" fill="none" stroke="#7a4a1a" stroke-width="1.6" opacity=".6"/>' +
          pts.map(([x, y]) => '<circle cx="' + (cx + x) + '" cy="' + (cy + y) + '" r="2.6" fill="#7a3a1a"/>').join('')).join('');
        const column = x => '<rect x="' + x + '" y="352" width="12" height="54" fill="#3a1a52"/><rect x="' + (x - 3) + '" y="346" width="18" height="7" fill="#3a1a52"/>';
        return tint('#2a1658', '#d0608a', 0.6) + stars(621, 40, 120, W, 0, 170) +
          // Dawn along the horizon.
          '<rect x="0" y="250" width="520" height="120" fill="' + lin('dawn', [[0, '#ffb070', 0], [1, '#ffb070', 0.55]]) + '"/>' +
          glow('halo', cx, cy, 170, '#ffe2a6', 0.75) +
          // The sphere, and its gold rings: the equator and the ecliptic.
          '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + sphere + '" stroke="#fff4d6" stroke-width="3"/>' +
          consMarkup +
          '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + r + '" ry="20" fill="none" stroke="' + gold + '" stroke-width="7"/>' +
          '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + r + '" ry="26" fill="none" stroke="' + gold + '" stroke-width="5" transform="rotate(-28 ' + cx + ' ' + cy + ')"/>' +
          '<ellipse cx="' + cx + '" cy="' + cy + '" rx="22" ry="' + r + '" fill="none" stroke="' + gold + '" stroke-width="4" opacity=".85"/>' +
          '<path d="M' + (cx - 30) + ' ' + (cy - 54) + 'A62 62 0 0 1 ' + (cx + 20) + ' ' + (cy - 70) + '" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".55"/>' +
          // The kneeling titan, a dark silhouette bearing it on his shoulders.
          '<g stroke="#22102f" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
            // Arms raised to the sphere.
            '<path d="M372 244L350 214L360 186" stroke-width="20"/><path d="M428 244L450 214L440 186" stroke-width="20"/>' +
            // Kneeling legs: the right knee forward, the left on the rock.
            '<path d="M414 292L454 300L456 330" stroke-width="22"/><path d="M386 292L376 330L338 330" stroke-width="22"/></g>' +
          '<g fill="' + titan + '">' +
            '<path d="M360 240C374 232 426 232 440 240L432 270C428 284 422 294 414 300H386C378 294 372 284 368 270Z"/>' +
            '<circle cx="400" cy="232" r="15"/>' +
            '<ellipse cx="360" cy="184" rx="13" ry="8"/><ellipse cx="440" cy="184" rx="13" ry="8"/></g>' +
          // The peak he kneels on.
          '<path d="M290 440L326 338C336 330 350 328 364 330H440C456 328 470 334 478 344L520 420V440Z" fill="#241038"/>' +
          '<path d="M330 346L352 372L370 346M444 340L456 366L470 352" fill="none" stroke="#3a1a52" stroke-width="3"/>' +
          // A temple on the lower slope.
          '<g opacity=".95"><path d="M190 346L246 326L302 346Z" fill="#3a1a52"/><rect x="196" y="346" width="100" height="6" fill="#3a1a52"/>' +
          [204, 226, 248, 270].map(column).join('') + '<rect x="190" y="404" width="112" height="8" fill="#3a1a52"/></g>' +
          ground('M0 440V412C100 402 200 418 300 410S440 404 520 410V440Z', '#180a28') +
          sparkle(300, 70, 7) + sparkle(498, 228, 8) + sparkle(318, 200, 5);
      },
    },
    emblems: {
      // Pebbles on a winding path to a lit house.
      'Gretel': '<path d="M30 8l11 10v14H19V18z" fill="currentColor" fill-opacity=".18"/><path d="M30 8l11 10v14H19V18z"/><path d="M27 32v-7h6v7"/><path d="M6 44c6-4 10-8 16-12"/><circle cx="8" cy="42" r="2" fill="currentColor" stroke="none"/><circle cx="13" cy="38.5" r="2" fill="currentColor" stroke="none"/><circle cx="18" cy="35" r="2" fill="currentColor" stroke="none"/>',
      // The celestial sphere with its rings.
      'Atlas': '<circle cx="24" cy="20" r="14" fill="currentColor" fill-opacity=".18"/><circle cx="24" cy="20" r="14"/><ellipse cx="24" cy="20" rx="14" ry="4"/><ellipse cx="24" cy="20" rx="14" ry="5" transform="rotate(-30 24 20)"/><path d="M12 38c4-3 8-4 12-4s8 1 12 4"/><path d="M8 44h32"/>',
    },
  };
}
