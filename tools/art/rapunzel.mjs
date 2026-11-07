// Live (21 October 2026), loaded into SCENES by tools/character-art.mjs: Rapunzel from Grimm's tale (1812), made epic. A tall,
// doorless stone tower rising out of a misty enchanted forest at twilight,
// its one window glowing gold under a huge crescent moon, and an immense
// golden braid woven with flowers falling all the way down into the witch's
// walled garden of rampion, the bellflower the tale is named after. No
// lanterns, no frying pan, no dress: those are the 2010 film's.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter } = h;
  return {
    scenes: {
    'Rapunzel': () => {
      const ink = '#140a30';
      // ---------- sky ----------
      const sky = tint('#120c46', '#b4407e', 0.78);
      const moon = glow('mglow', 330, 70, 110, '#fff2d0', 0.55) +
        '<path d="M344 22A48 48 0 1 0 372 112A40 40 0 0 1 344 22Z" fill="' + lin('moon', [[0, '#fffaf0'], [1, '#ffd88a']]) + '"/>' +
        '<g fill="#e8c27a" opacity=".35"><circle cx="318" cy="62" r="5"/><circle cx="330" cy="92" r="3.4"/></g>';
      // ---------- the tower ----------
      const TX = 448, TOP = 120, BASE = 420;
      const wTop = 30, wBase = 40; // half widths
      const towerPath = 'M' + (TX - wTop) + ' ' + TOP + 'L' + (TX - wBase) + ' ' + BASE + 'H' + (TX + wBase) + 'L' + (TX + wTop) + ' ' + TOP + 'Z';
      const stone = lin('stone', [[0, '#3a2a6a'], [0.55, '#6a5aa8'], [1, '#2a1a52']], 0, 0, 1, 0);
      let joints = '';
      const r = rng(77);
      for (let y = TOP + 14, row = 0; y < BASE; y += 15, row++) {
        const t = (y - TOP) / (BASE - TOP), hw = wTop + (wBase - wTop) * t;
        joints += 'M' + n(TX - hw) + ' ' + y + 'H' + n(TX + hw);
        for (let x = TX - hw + (row % 2 ? 9 : 18); x < TX + hw - 4; x += 20 + r() * 6) joints += 'M' + n(x) + ' ' + y + 'V' + (y + 15);
      }
      const ivy = (x0, y0, len, dir, seed) => {
        const q = rng(seed); let d = '', leaves = '';
        let x = x0, y = y0;
        d += 'M' + x + ' ' + y;
        for (let i = 0; i < len; i++) {
          const nx = x + dir * (q() * 6 - 1), ny = y + 9;
          d += 'Q' + n(x + dir * 5) + ' ' + n(y + 4) + ' ' + n(nx) + ' ' + ny;
          leaves += '<path d="M' + n(nx) + ' ' + ny + 'c' + n(dir * 4) + ' -6 ' + n(dir * 10) + ' -4 ' + n(dir * 9) + ' 2c-3 3 -7 3 ' + n(-dir * 9) + ' -2z" fill="' + (i % 3 ? '#3f8a5a' : '#62b070') + '"/>';
          x = nx; y = ny;
        }
        return '<path d="' + d + '" fill="none" stroke="#2a5a3a" stroke-width="1.6"/>' + leaves;
      };
      const roof = lin('roof', [[0, '#c86ad0'], [0.5, '#7a3a9a'], [1, '#3a1a5a']], 0, 0, 1, 0);
      const tower =
        '<path d="' + towerPath + '" fill="' + stone + '"/>' +
        '<path d="' + joints + '" stroke="' + ink + '" stroke-width="1.6" opacity=".45"/>' +
        // moonlight on the left edge, window light on the right
        '<path d="M' + (TX - wTop) + ' ' + TOP + 'L' + (TX - wBase) + ' ' + BASE + 'h6L' + (TX - wTop + 5) + ' ' + TOP + 'Z" fill="#c9b8ff" opacity=".35"/>' +
        '<path d="M' + (TX + wTop) + ' ' + TOP + 'L' + (TX + wBase) + ' ' + BASE + 'h-7L' + (TX + wTop - 6) + ' ' + TOP + 'Z" fill="#ffcf7a" opacity=".22"/>' +
        ivy(TX - wTop + 4, 210, 18, 1, 5) + ivy(TX + wBase - 6, 260, 15, -1, 9) +
        // corbelled parapet and the cone roof
        '<path d="M' + (TX - wTop - 8) + ' ' + TOP + 'h' + (2 * wTop + 16) + 'v-10h' + (-2 * wTop - 16) + 'Z" fill="#4a3a7a" stroke="' + ink + '" stroke-width="2"/>' +
        '<g fill="#4a3a7a" stroke="' + ink + '" stroke-width="1.4">' + [-1, 0, 1].map(k => '<path d="M' + n(TX + k * 22 - 5) + ' ' + (TOP + 1) + 'l5 9l5 -9z"/>').join('') + '</g>' +
        '<path d="M' + (TX - wTop - 14) + ' ' + (TOP - 10) + 'L' + TX + ' 22L' + (TX + wTop + 14) + ' ' + (TOP - 10) + 'Z" fill="' + roof + '" stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"/>' +
        '<g stroke="' + ink + '" stroke-width="1.2" opacity=".4">' + [0.25, 0.5, 0.75].map(t => '<path d="M' + n(TX - (wTop + 14) * (1 - t) - 0) + ' ' + n(TOP - 10 - (TOP - 32) * t) + 'L' + n(TX + (wTop + 14) * (1 - t)) + ' ' + n(TOP - 10 - (TOP - 32) * t) + '"/>').join('') + '</g>' +
        '<path d="M' + TX + ' 22V4" stroke="' + ink + '" stroke-width="2.4"/><path d="M' + TX + ' 4L' + (TX + 18) + ' 10L' + TX + ' 16Z" fill="#ff8ab8"/>';
      // ---------- the window and its glow ----------
      const WY = 150;
      const windowEl = glow('win', TX, WY, 90, '#ffd27a', 0.85) +
        '<path d="M' + (TX - 13) + ' ' + (WY + 18) + 'V' + (WY - 4) + 'A13 13 0 0 1 ' + (TX + 13) + ' ' + (WY - 4) + 'V' + (WY + 18) + 'Z" fill="' + lin('glass', [[0, '#fff6cc'], [1, '#ffb44a']]) + '" stroke="' + ink + '" stroke-width="3.4"/>' +
        '<path d="M' + TX + ' ' + (WY - 16) + 'V' + (WY + 18) + 'M' + (TX - 13) + ' ' + (WY + 4) + 'H' + (TX + 13) + '" stroke="' + ink + '" stroke-width="1.8" opacity=".6"/>' +
        '<path d="M' + (TX - 17) + ' ' + (WY + 18) + 'h34v5h-34z" fill="#4a3a7a" stroke="' + ink + '" stroke-width="1.6"/>';
      // ---------- the braid ----------
      // A real three-strand plait: leaf-shaped lobes crossing left and right
      // down the hair's line, each shaded and combed with fine strands, the
      // later lobe always over the one above, so the flowers tucked between
      // them sit under the next crossing. It tapers and sways as it falls to
      // the garden wall, with a few loose wisps and a tied, splayed end.
      const segs = [
        [[TX - 8, WY + 18], [TX - 44, WY + 40], [TX - 80, 204], [TX - 58, 248]],
        [[TX - 58, 248], [TX - 38, 290], [TX - 96, 308], [TX - 112, 344]],
        [[TX - 112, 344], [TX - 124, 368], [TX - 112, 382], [TX - 126, 398]],
      ];
      // Points along the curve by arc length.
      const pts = [];
      segs.forEach(sg => { for (let k = 0; k <= 60; k++) { if (pts.length && k === 0) continue; pts.push(bez(...sg, k / 60)); } });
      const len = [0];
      for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const L = len[len.length - 1];
      const along = d => {
        let k = 1; while (k < len.length - 1 && len[k] < d) k++;
        const a = pts[k - 1], b = pts[k], f = (d - len[k - 1]) / Math.max(1e-6, len[k] - len[k - 1]);
        return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
      };
      // A tapering underlay in the hair's own deep tone, so the gaps between
      // lobes read as the plait's shadowed depths rather than a sleeve.
      const edge = side => { const out = []; for (let d = 0; d <= L; d += 4) { const c = along(d), r = (c.ang + 90 * side) * Math.PI / 180, w = (17 - 8 * (d / L)) * 0.82; out.push(n(c.x + Math.cos(r) * w) + ' ' + n(c.y + Math.sin(r) * w)); } return out; };
      const ribbon = 'M' + edge(1).join('L') + 'L' + edge(-1).reverse().join('L') + 'Z';
      const lobeFill = lin('lobe', [[0, '#fff3c2'], [0.35, '#f6cf6a'], [0.75, '#d99a32'], [1, '#8a5414']]);
      const STEP = 7.6, END = L - 16;
      const width = d => 17 - 8 * (d / L);
      const flower = (x, y, kind, rot) => {
        if (kind === 'rose') return '<g transform="translate(' + n(x) + ' ' + n(y) + ') rotate(' + rot + ')"><circle r="4.4" fill="#e85a8a"/><circle r="3" fill="#ff8ab0"/>' +
          '<path d="M-2 0A2 2 0 1 1 1.4 1.6" fill="none" stroke="#b02a5a" stroke-width="1"/><path d="M3 3c4 1 6 4 6 6c-3 0-6-2-6-6z" fill="#4a9a52"/></g>';
        if (kind === 'forget') return '<g transform="translate(' + n(x) + ' ' + n(y) + ')"><g fill="#8ab8ff">' +
          [0, 72, 144, 216, 288].map(a => '<circle cx="' + n(2.6 * Math.sin((a + rot) * Math.PI / 180)) + '" cy="' + n(-2.6 * Math.cos((a + rot) * Math.PI / 180)) + '" r="1.8"/>').join('') +
          '</g><circle r="1" fill="#ffe066"/></g>';
        if (kind === 'daisy') return '<g transform="translate(' + n(x) + ' ' + n(y) + ') rotate(' + rot + ')"><g fill="#fffaf2">' +
          Array.from({ length: 8 }, (_, k) => '<ellipse cx="0" cy="-3.2" rx="1.1" ry="2.6" transform="rotate(' + k * 45 + ')"/>').join('') +
          '</g><circle r="1.5" fill="#ffc83c"/></g>';
        if (kind === 'bud') return '<g transform="translate(' + n(x) + ' ' + n(y) + ') rotate(' + rot + ')"><path d="M0 3C-3 0 -2 -4 0 -5C2 -4 3 0 0 3Z" fill="#ffb0c8"/><path d="M0 3C-2 2 -3 4 -5 4M0 3C2 2 3 4 5 4" stroke="#4a9a52" stroke-width="1.2" fill="none"/></g>';
        return '<g transform="translate(' + n(x) + ' ' + n(y) + ') rotate(' + rot + ')"><path d="M0 0C3 -4 9 -4 11 0C9 3 3 3 0 0Z" fill="#5aa860"/><path d="M0 0H10" stroke="#3a7a42" stroke-width=".7"/></g>';
      };
      const kinds = ['rose', 'leaf', 'forget', 'daisy', 'bud', 'forget', 'rose', 'leaf', 'daisy', 'forget', 'bud', 'rose'];
      let lobes = '', fi = 0;
      for (let d = 0, i = 0; d < END; d += STEP, i++) {
        const side = i % 2 ? 1 : -1, w = width(d);
        const c = along(d + STEP * 0.5);
        const a = STEP * 1.55, bb = w * 0.78;
        // The lobe, slanted across the line of the braid.
        let g = '<g transform="translate(' + n(c.x) + ' ' + n(c.y) + ') rotate(' + n(c.ang) + ') translate(0 ' + n(side * w * 0.3) + ') rotate(' + (side * -40) + ')">' +
          '<path d="M' + n(-a) + ' 0C' + n(-a * 0.45) + ' ' + n(-bb * 1.1) + ' ' + n(a * 0.45) + ' ' + n(-bb * 1.1) + ' ' + n(a) + ' 0C' + n(a * 0.45) + ' ' + n(bb) + ' ' + n(-a * 0.45) + ' ' + n(bb) + ' ' + n(-a) + ' 0Z" fill="' + lobeFill + '"/>';
        // Combed strands: darker ones low in the lobe, a light sheen high up.
        [[-0.5, '#b07a2a', 0.45], [-0.2, '#c88a30', 0.35], [0.1, '#a8691c', 0.4], [0.35, '#94581a', 0.45], [0.6, '#7a4a12', 0.5]].forEach(([y, col, o]) => {
          g += '<path d="M' + n(-a * 0.92) + ' ' + n(y * bb * 0.4) + 'Q0 ' + n(y * bb - bb * 0.2) + ' ' + n(a * 0.92) + ' ' + n(y * bb * 0.4) + '" fill="none" stroke="' + col + '" stroke-width=".45" opacity="' + o + '"/>';
        });
        g += '<path d="M' + n(-a * 0.6) + ' ' + n(-bb * 0.5) + 'Q0 ' + n(-bb * 0.95) + ' ' + n(a * 0.55) + ' ' + n(-bb * 0.45) + '" fill="none" stroke="#fffbe0" stroke-width="1.3" opacity=".85" stroke-linecap="round"/>' +
          '<path d="M' + n(-a * 0.2) + ' ' + n(-bb * 0.62) + 'Q' + n(a * 0.2) + ' ' + n(-bb * 0.8) + ' ' + n(a * 0.5) + ' ' + n(-bb * 0.5) + '" fill="none" stroke="#ffffff" stroke-width=".7" opacity=".7"/>' +
          '</g>';
        lobes += g;
        // Every few crossings a flower or leaf is tucked in, so the next lobe laps over it.
        if (i % 3 === 1 && d < END - 20) {
          const f = along(d + STEP * 0.7), r = (f.ang + 90 * side) * Math.PI / 180;
          lobes += '<g transform="translate(' + n(f.x + Math.cos(r) * w * 0.35) + ' ' + n(f.y + Math.sin(r) * w * 0.35) + ') scale(' + n(1.3 - 0.4 * (d / L)) + ')">' +
            flower(0, 0, kinds[fi % kinds.length], (fi * 47) % 360) + '</g>'; fi++;
        }
      }
      // The tie and the loose end, splayed into fine strands.
      const tail = along(END), tw = width(END);
      let end = '<g transform="translate(' + n(tail.x) + ' ' + n(tail.y) + ') rotate(' + n(tail.ang - 90) + ')">';
      for (let k = -4; k <= 4; k++) end += '<path d="M' + n(k * 1.1) + ' 0C' + n(k * 1.6) + ' 6 ' + n(k * 2.6) + ' 10 ' + n(k * 3.2 + 1) + ' 17" fill="none" stroke="' + (k % 2 ? '#d9a040' : '#f6d27a') + '" stroke-width="1.4" stroke-linecap="round"/>';
      end += '<rect x="' + n(-tw * 0.55) + '" y="-3" width="' + n(tw * 1.1) + '" height="4.4" rx="2" fill="#c2366a"/><path d="M' + n(tw * 0.5) + ' -1c4 -3 8 -1 8 2c-3 1 -6 1 -8 -2z" fill="#e85a8a"/></g>';
      // A few loose wisps lifting off the edges.
      const wisps = [30, 92, 150, 214, 268].map((d, k) => {
        const c = along(d), side = k % 2 ? 1 : -1, w = width(d), r = (c.ang + 90 * side) * Math.PI / 180;
        const x0 = c.x + Math.cos(r) * w * 0.9, y0 = c.y + Math.sin(r) * w * 0.9;
        return '<path d="M' + n(x0) + ' ' + n(y0) + 'q' + n(Math.cos(r) * 8 + 4) + ' ' + n(Math.sin(r) * 6 + 6) + ' ' + n(Math.cos(r) * 6 + 10) + ' ' + n(Math.sin(r) * 10 + 12) + '" fill="none" stroke="#f6d27a" stroke-width=".8" opacity=".8" stroke-linecap="round"/>';
      }).join('');
      const braid = glow('bglow', TX - 70, 270, 120, '#ffd98a', 0.16) +
        '<path d="' + ribbon + '" fill="#9a6420"/>' +
        lobes + end + wisps;
      // ---------- forest, mist, garden ----------
      const treeRow = (seed, y0, h, fill, o) => {
        const q = rng(seed); let d = '';
        for (let x = -10; x < W + 30; x += 14 + q() * 14) {
          const hh = h * (0.6 + q() * 0.6);
          d += q() > 0.45
            ? 'M' + n(x - 12) + ' ' + y0 + 'L' + n(x) + ' ' + n(y0 - hh) + 'L' + n(x + 12) + ' ' + y0 + 'Z'
            : 'M' + n(x - 14) + ' ' + y0 + 'C' + n(x - 16) + ' ' + n(y0 - hh) + ' ' + n(x + 16) + ' ' + n(y0 - hh) + ' ' + n(x + 14) + ' ' + y0 + 'Z';
        }
        return '<path d="' + d + 'M-10 ' + y0 + 'H' + (W + 30) + 'V' + (y0 + 60) + 'H-10Z" fill="' + fill + '" opacity="' + o + '"/>';
      };
      const mist = (y, o) => '<path d="M-10 ' + y + 'C100 ' + (y + 8) + ' 200 ' + (y - 10) + ' 300 ' + (y + 8) + 'S460 ' + (y - 8) + ' 560 ' + y + 'V' + (y + 22) + 'C400 ' + (y + 30) + ' 200 ' + (y + 14) + ' -10 ' + (y + 24) + 'Z" fill="#f4e4ff" opacity="' + o + '"/>';
      // Far mountains, for depth behind the forest.
      const peaks = '<path d="M-10 330L60 276L120 300L190 240L260 292L320 256L380 300L440 262L530 310V340H-10Z" fill="#4a2c80" opacity=".45"/>' +
        '<path d="M190 240L206 256L196 254L184 264ZM320 256L334 270L322 268Z" fill="#e8d8ff" opacity=".35"/>';
      const bell = (x, y, s, lean) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + lean + ') scale(' + s + ')">' +
        '<path d="M0 0C-2 -20 2 -40 0 -58" fill="none" stroke="#3f8a4a" stroke-width="2.4"/>' +
        [[-1, -54, -30], [1, -42, 30], [-1, -30, -26], [1, -18, 28]].map(([side, by, a]) =>
          '<g transform="translate(' + side * 2 + ' ' + by + ') rotate(' + a + ')"><path d="M0 0V5" stroke="#3f8a4a" stroke-width="2"/>' +
          '<path d="M-6 5C-6 15 -4 19 -7 22H7C4 19 6 15 6 5Z" fill="' + lin('bell' + x, [[0, '#d8c8ff'], [1, '#6a4ad8']]) + '"/></g>').join('') + '</g>';
      const wall = '<path d="M300 440V392H520V440Z" fill="' + lin('gw', [[0, '#4a3a7a'], [1, '#1c0f3a']]) + '"/>' +
        '<path d="M300 392H520" stroke="#7a6ab0" stroke-width="3"/>' +
        '<path d="M300 404H520M300 418H520M320 392V404M350 404V418M380 392V404M410 404V418M500 392V404M470 404V418" stroke="' + ink + '" stroke-width="1.4" opacity=".5"/>';
      const flies = scatter(91, 26, (x, y, q) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.2 + q() * 1.6) + '" fill="#fff4a0" opacity="' + n(0.5 + q() * 0.5) + '"/>', 250, W, 290, 410);
      return sky + stars(31, 70, 120, W, 0, 240) + moon +
        sparkle(262, 140, 7) + sparkle(392, 40, 6) + sparkle(506, 190, 7) + sparkle(300, 214, 5) +
        peaks + treeRow(301, 330, 70, '#3a2470', 0.65) + mist(318, 0.14) +
        treeRow(302, 360, 60, '#2a1658', 0.85) + mist(350, 0.16) +
        tower + windowEl +
        treeRow(303, 400, 46, '#1c0c3e', 1) + mist(388, 0.18) +
        wall + braid +
        bell(312, 420, 0.95, -6) + bell(338, 426, 0.8, 8) + bell(362, 418, 0.9, -3) + bell(486, 410, 1, -5) + bell(508, 422, 0.8, 10) + bell(400, 428, 0.7, 4) +
        flies + ground('M0 440V428C120 422 260 430 380 426S480 424 520 426V440Z', '#0e0628');
    },
    },
    emblems: {
      'Rapunzel': '<path d="M14 18h14v26H14z" fill="currentColor" fill-opacity=".18"/><path d="M14 18h14v26H14z"/><path d="M11 18L21 3l10 15z" fill="currentColor" fill-opacity=".18"/><path d="M11 18L21 3l10 15z"/><path d="M18 27v-3a3 3 0 0 1 6 0v3z"/><path d="M24 27c6 3 2 8 8 11s4 6 10 6"/><path d="M14 33h14M14 39h14"/><path d="M40 8l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" stroke="none"/>',
    },
  };
}
