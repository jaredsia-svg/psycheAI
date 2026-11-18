// Live (21 October 2026), loaded into SCENES by tools/character-art.mjs: Sherlock Holmes as a cinematic London night (Conan Doyle,
// public domain). A great moon behind the clock tower over the Thames, fog lit
// gold and violet over the rooftops and chimneys, gaslights along a cobbled
// street, and the hero: a brass magnifying glass whose lens finds a glowing
// trail of footprints in the street below. Built like the reserve, for preview.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter } = h;
  return {
    scenes: {
    'Sherlock Holmes': () => {
      const ink = '#0c0618';
      const brass = lin('brass', [[0, '#fff0b8'], [0.35, '#e8b24a'], [0.7, '#a8661c'], [1, '#5a3008']], 0, 0, 1, 1);
      const brassIn = lin('brassin', [[0, '#7a4810'], [0.5, '#f4c868'], [1, '#7a4810']], 0, 0, 1, 0);
      const wood = lin('wood', [[0, '#3a1608'], [0.45, '#9a5428'], [0.6, '#c27a40'], [1, '#2a0e04']], 0, 0, 1, 0);
      const moonF = rad('moonf', [[0, '#fffbee'], [0.7, '#f4e4c4'], [1, '#d8c4a4']], 0.42, 0.38);
      const river = lin('river', [[0, '#5a3a8a'], [1, '#160a2a']]);
      const roof = lin('roof', [[0, '#24123a'], [1, '#0a0414']]);
      const fogGold = lin('foggold', [[0, '#ffd28a', 0], [0.5, '#ffd28a', 0.32], [1, '#ffd28a', 0]], 0, 0, 1, 0);
      const fogViolet = lin('fogviolet', [[0, '#c9a6ff', 0], [0.5, '#c9a6ff', 0.26], [1, '#c9a6ff', 0]], 0, 0, 1, 0);
      const lensF = rad('lensf', [[0, '#5a3a3a'], [0.7, '#2a1424'], [1, '#160a1a']], 0.5, 0.5);
      const fog = (y, h2, fill, dx = 0) => '<path d="M' + (120 + dx) + ' ' + y + 'C' + (200 + dx) + ' ' + (y - h2) + ' ' + (300 + dx) + ' ' + (y + h2 * 0.6) + ' ' + (390 + dx) + ' ' + (y - h2 * 0.3) +
        'S' + (500 + dx) + ' ' + (y - h2) + ' 560 ' + y + 'V' + (y + h2 * 1.4) + 'C460 ' + (y + h2 * 2) + ' 300 ' + (y + h2 * 0.8) + ' 120 ' + (y + h2 * 1.6) + 'Z" fill="' + fill + '"/>';
      const lamp = (x, y, s) => glow('lamp' + x, x, y, 34 * s, '#ffcf7a', 0.85) +
        '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + ink + '">' +
        '<path d="M-1.6 8V60H1.6V8Z"/><path d="M-6 60H6V64H-6Z"/>' +
        '<path d="M-7 -8L-5 6H5L7 -8Z" fill="#ffe6a6" stroke="' + ink + '" stroke-width="1.6"/><path d="M-9 -8L0 -16L9 -8Z"/><path d="M-1 -16V-20H1V-16Z"/></g>';
      // A footprint: sole and heel, glowing.
      const step = (x, y, a, s, o) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')" opacity="' + o + '" fill="#ffd27a">' +
        '<path d="M-4.6 -9C-6 -16 -3 -19 0 -19S6 -16 4.6 -9L3.6 1C3 4 -3 4 -3.6 1Z"/>' +
        '<path d="M-3.4 6C-3.6 4.6 3.6 4.6 3.4 6L3 11C2.6 13 -2.6 13 -3 11Z"/></g>';
      // A walk: prints alternating left and right of a line, each turned along it.
      const walk = (x0, y0, x1, y1, count, s, o0, o1, a0 = 0) => {
        const ang = Math.atan2(y1 - y0, x1 - x0), deg = ang * 180 / Math.PI + 90 + a0;
        return Array.from({ length: count }, (_, k) => {
          const t = count > 1 ? k / (count - 1) : 0, side = k % 2 ? 1 : -1;
          const x = x0 + (x1 - x0) * t - Math.sin(ang) * side * 6 * s, y = y0 + (y1 - y0) * t + Math.cos(ang) * side * 6 * s;
          return step(n(x), n(y), n(deg + side * 6), s, n(o0 + (o1 - o0) * t));
        }).join('');
      };
      // Chimney stacks with their pots along a roof line.
      const chimneys = (pts) => pts.map(([x, y, w, pots]) => '<path d="M' + x + ' 440V' + y + 'H' + (x + w) + 'V440Z"/>' +
        Array.from({ length: pots }, (_, k) => '<path d="M' + (x + 3 + k * 8) + ' ' + y + 'V' + (y - 9) + 'H' + (x + 8 + k * 8) + 'V' + y + 'Z"/>').join('')).join('');
      // The magnifying glass: lens centre, radius, tilt of the handle.
      const LX = 432, LY = 268, LR = 62;
      const cobbles = (() => {
        const r = rng(907); let out = '';
        for (let y = LY - LR; y < LY + LR; y += 13) {
          for (let x = LX - LR - (y % 2 ? 9 : 0); x < LX + LR; x += 18) {
            out += '<rect x="' + n(x + r() * 2) + '" y="' + n(y + r() * 2) + '" width="15" height="10" rx="4" fill="#4a2a3a" opacity="' + n(0.55 + r() * 0.35) + '"/>';
          }
        }
        return out;
      })();
      return tint('#0e0a30', '#4a1e6a', 0.72) + stars(311, 46, 120, W, 0, 200) +
        // The moon, with a wide halo.
        glow('halo', 432, 104, 200, '#e8d8ff', 0.4) + glow('halo2', 432, 104, 110, '#fff4dc', 0.55) +
        '<circle cx="432" cy="104" r="70" fill="' + moonF + '"/>' +
        '<g fill="#cbb594" opacity=".45"><circle cx="410" cy="84" r="11"/><circle cx="452" cy="124" r="8"/><circle cx="448" cy="78" r="5"/><circle cx="418" cy="128" r="6"/></g>' +
        // The clock tower against the moon, its face lit, and the long roof of the palace below.
        '<g fill="' + ink + '">' +
          '<path d="M372 330V150H402V330Z"/><path d="M368 150H406V138H368Z"/>' +
          '<path d="M370 138L376 112H398L404 138Z"/><path d="M376 112L387 54L398 112Z"/><path d="M386 54V40H388V54Z"/>' +
          '<path d="M366 140V128H370V140ZM404 140V128H408V140Z"/><path d="M366 128L368 120L370 128ZM404 128L406 120L408 128Z"/>' +
          '<path d="M364 196H410V204H364Z"/>' +
          '<path d="M300 330V286H312V272H318V286H344V278H350V286H372V330Z"/><path d="M402 330V292H420V280H426V292H452V300H470V330Z"/>' +
          Array.from({ length: 9 }, (_, k) => '<path d="M' + (300 + k * 8) + ' 286V280H' + (303 + k * 8) + 'V286Z"/>').join('') +
        '</g>' +
        glow('clock', 387, 170, 26, '#ffd27a', 0.9) +
        '<circle cx="387" cy="170" r="11" fill="#ffe8a8" stroke="' + ink + '" stroke-width="2.4"/>' +
        '<path d="M387 170V163M387 170L392 173" stroke="' + ink + '" stroke-width="1.8" stroke-linecap="round"/>' +
        '<g fill="#ffd27a" opacity=".55"><rect x="379" y="120" width="2" height="12"/><rect x="384" y="120" width="2" height="12"/><rect x="389" y="120" width="2" height="12"/><rect x="394" y="120" width="2" height="12"/></g>' +
        '<g fill="#ffd27a" opacity=".8"><rect x="378" y="214" width="4" height="9"/><rect x="392" y="214" width="4" height="9"/><rect x="378" y="240" width="4" height="9"/><rect x="392" y="240" width="4" height="9"/>' +
          '<rect x="322" y="300" width="4" height="7"/><rect x="336" y="300" width="4" height="7"/><rect x="430" y="306" width="4" height="7"/><rect x="446" y="306" width="4" height="7"/></g>' +
        // The Thames, the moon's path on it.
        '<rect x="0" y="330" width="520" height="30" fill="' + river + '"/>' +
        '<g fill="#fff4dc">' + [[420, 334, 30], [428, 340, 22], [416, 346, 16], [432, 352, 10]].map(([x, y, w]) => '<rect x="' + (x - w / 2) + '" y="' + y + '" width="' + w + '" height="2" opacity=".6"/>').join('') + '</g>' +
        '<g fill="#ffd27a" opacity=".55"><rect x="320" y="338" width="10" height="2"/><rect x="384" y="342" width="6" height="2"/><rect x="470" y="340" width="8" height="2"/></g>' +
        fog(300, 14, fogViolet) + fog(318, 10, fogGold, -40) +
        // The near rooftops and chimneys, lit windows, smoke rising.
        '<g fill="' + roof + '">' +
          '<path d="M120 440V372L170 352L220 372V360H262L300 344L338 360V440Z"/>' +
          '<path d="M330 440V368H372L404 350L436 368H470V356L500 344L520 352V440Z"/>' +
          chimneys([[176, 334, 18, 2], [248, 340, 14, 1], [296, 326, 20, 2], [384, 332, 16, 2], [478, 326, 18, 2]]) +
        '</g>' +
        '<g fill="#ffcf7a" opacity=".85"><rect x="140" y="390" width="7" height="10"/><rect x="186" y="384" width="7" height="10"/><rect x="232" y="392" width="7" height="10"/>' +
          '<rect x="346" y="388" width="7" height="10"/><rect x="420" y="384" width="7" height="10"/><rect x="494" y="380" width="7" height="10"/></g>' +
        '<g fill="none" stroke="#e8d8ff" stroke-linecap="round" opacity=".22"><path d="M306 322C296 304 316 292 304 276S316 252 306 238" stroke-width="7"/><path d="M486 322C478 306 496 296 486 282" stroke-width="6"/></g>' +
        // Gaslights along the street, a hansom cab's two lamps far off.
        lamp(222, 380, 0.7) + lamp(278, 372, 0.8) + lamp(500, 384, 0.9) +
        '<g fill="#ffe6a6"><circle cx="350" cy="420" r="2.2"/><circle cx="360" cy="420" r="2.2"/></g>' +
        fog(372, 12, fogGold, 20) + fog(392, 10, fogViolet, -20) +
        // The trail of footprints walking into the lens.
        walk(232, 432, 360, 366, 6, 0.75, 0.25, 0.7) +
        // The glass: handle, brass rim with its engraving, and the lens.
        '<g transform="rotate(-40 ' + LX + ' ' + LY + ')">' +
          '<path d="M' + (LX - 11) + ' ' + (LY + LR + 6) + 'H' + (LX + 11) + 'L' + (LX + 9) + ' ' + (LY + LR + 22) + 'H' + (LX - 9) + 'Z" fill="' + brass + '" stroke="' + ink + '" stroke-width="2"/>' +
          '<path d="M' + (LX - 10) + ' ' + (LY + LR + 22) + 'C' + (LX - 15) + ' ' + (LY + LR + 40) + ' ' + (LX - 8) + ' ' + (LY + LR + 52) + ' ' + (LX - 12) + ' ' + (LY + LR + 70) +
            'C' + (LX - 16) + ' ' + (LY + LR + 92) + ' ' + (LX - 11) + ' ' + (LY + LR + 112) + ' ' + (LX - 8) + ' ' + (LY + LR + 128) + 'H' + (LX + 8) +
            'C' + (LX + 11) + ' ' + (LY + LR + 112) + ' ' + (LX + 16) + ' ' + (LY + LR + 92) + ' ' + (LX + 12) + ' ' + (LY + LR + 70) +
            'C' + (LX + 8) + ' ' + (LY + LR + 52) + ' ' + (LX + 15) + ' ' + (LY + LR + 40) + ' ' + (LX + 10) + ' ' + (LY + LR + 22) + 'Z" fill="' + wood + '" stroke="' + ink + '" stroke-width="2.4"/>' +
          '<g stroke="' + brass + '" stroke-width="4"><path d="M' + (LX - 13) + ' ' + (LY + LR + 46) + 'H' + (LX + 13) + '"/><path d="M' + (LX - 14) + ' ' + (LY + LR + 96) + 'H' + (LX + 14) + '"/></g>' +
          '<path d="M' + (LX - 4) + ' ' + (LY + LR + 30) + 'C' + (LX - 7) + ' ' + (LY + LR + 60) + ' ' + (LX - 4) + ' ' + (LY + LR + 100) + ' ' + (LX - 3) + ' ' + (LY + LR + 120) + '" fill="none" stroke="#f0b070" stroke-width="2.4" opacity=".55" stroke-linecap="round"/>' +
        '</g>' +
        glow('lensglow', LX, LY, LR + 40, '#ffd27a', 0.45) +
        '<clipPath id="{id}-lens"><circle cx="' + LX + '" cy="' + LY + '" r="' + LR + '"/></clipPath>' +
        '<g clip-path="url(#{id}-lens)">' +
          '<circle cx="' + LX + '" cy="' + LY + '" r="' + LR + '" fill="' + lensF + '"/>' + cobbles +
          glow('trail', LX - 6, LY + 4, 54, '#ffcf7a', 0.55) +
          walk(LX - 46, LY + 50, LX + 44, LY - 40, 4, 1.7, 0.85, 1) +
          '<path d="M' + (LX - 54) + ' ' + (LY - 14) + 'L' + (LX - 30) + ' ' + (LY - 22) + 'M' + (LX + 20) + ' ' + (LY + 40) + 'l10 -4l4 10" stroke="#ffe6a6" stroke-width="1.6" fill="none" opacity=".6"/>' +
          '<circle cx="' + (LX + 30) + '" cy="' + (LY + 34) + '" r="3" fill="#ffe6a6" opacity=".8"/>' +
          '<circle cx="' + LX + '" cy="' + LY + '" r="' + LR + '" fill="' + rad('lensedge', [[0.75, '#fff', 0], [0.92, '#c9a6ff', 0.25], [1, '#ffffff', 0.55]]) + '"/>' +
        '</g>' +
        '<circle cx="' + LX + '" cy="' + LY + '" r="' + (LR + 7) + '" fill="none" stroke="' + ink + '" stroke-width="18"/>' +
        '<circle cx="' + LX + '" cy="' + LY + '" r="' + (LR + 7) + '" fill="none" stroke="' + brass + '" stroke-width="13"/>' +
        '<circle cx="' + LX + '" cy="' + LY + '" r="' + (LR + 7) + '" fill="none" stroke="' + brassIn + '" stroke-width="3" stroke-dasharray="2 5" opacity=".9"/>' +
        '<circle cx="' + LX + '" cy="' + LY + '" r="' + (LR + 1) + '" fill="none" stroke="#5a3008" stroke-width="2"/>' +
        // Moonlight caught on the glass: a long arc and a flare.
        '<path d="M' + (LX - 44) + ' ' + (LY - 30) + 'A54 54 0 0 1 ' + (LX - 6) + ' ' + (LY - 52) + '" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/>' +
        '<path d="M' + (LX - 46) + ' ' + (LY - 14) + 'A54 54 0 0 1 ' + (LX - 40) + ' ' + (LY - 26) + '" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/>' +
        glow('flare', LX - 30, LY - 44, 26, '#ffffff', 0.9) + sparkle(LX - 30, LY - 44, 15) +
        '<path d="M' + (LX - 30) + ' ' + (LY - 44) + 'L' + (LX + 70) + ' ' + (LY + 30) + '" stroke="#fff" stroke-width="1.4" opacity=".25"/>' +
        '<g fill="#e8d8ff" opacity=".7"><circle cx="' + (LX + 22) + '" cy="' + (LY - 8) + '" r="4"/><circle cx="' + (LX + 46) + '" cy="' + (LY + 10) + '" r="2.4"/></g>' +
        sparkle(300, 70, 7) + sparkle(498, 210, 8) + sparkle(352, 236, 5) +
        ground('M0 440V428C120 420 260 432 380 424S480 420 520 422V440Z', '#07030f');
    },
    },
    emblems: {
      'Sherlock Holmes': '<circle cx="19" cy="19" r="13" fill="currentColor" fill-opacity=".18"/><circle cx="19" cy="19" r="13"/><circle cx="19" cy="19" r="9.5" stroke-dasharray="1.5 3"/><path d="M28.5 28.5L32 32"/><path d="M31 31l11 11a3 3 0 0 1-4 4L27 35z" fill="currentColor" fill-opacity=".18"/><path d="M31 31l11 11a3 3 0 0 1-4 4L27 35z"/><ellipse cx="16.5" cy="17" rx="2.4" ry="3.8" fill="currentColor" stroke="none"/><ellipse cx="16.5" cy="23.4" rx="1.8" ry="2" fill="currentColor" stroke="none"/><ellipse cx="22.5" cy="13" rx="1.8" ry="2.8" fill="currentColor" stroke="none" opacity=".6"/><path d="M11 13a9 9 0 0 1 5-4"/><path d="M40 6l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" stroke="none"/>',
    },
  };
}
