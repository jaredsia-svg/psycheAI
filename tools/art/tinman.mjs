// The Tin Woodman, as W. W. Denslow drew him for Baum's 1900 book (public
// domain): riveted tin cylinders, a funnel for a cap, jointed limbs, his axe at
// his side. He stands on the yellow brick road at twilight with the red velvet
// heart the Wizard gives him glowing in his hands, a dark pine forest around and
// the Emerald City far and small on the horizon (21 October 2026; he took
// WALL-E's place). Nothing from the 1939 film. Loaded into SCENES by
// tools/character-art.mjs; the emblem is mirrored in EMBLEM_PATHS in
// docs/copy.js as 'tinheart'.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter } = h;
  return {
    scenes: {
    'The Tin Man': () => {
      const sky = lin('sky', [[0, '#170f3a'], [0.45, '#5a2a78'], [0.75, '#c8587e'], [1, '#ffb070']]);
      const tin = lin('tin', [[0, '#ffffff'], [0.35, '#d8dcef'], [0.6, '#8d93b4'], [1, '#4a4e70']], 0, 0, 1, 1);
      const tinDark = lin('tind', [[0, '#b8bcd8'], [1, '#3a3e5c']], 0, 0, 1, 0);
      const velvet = rad('velvet', [[0, '#ff7a8a'], [0.45, '#d6203c'], [1, '#6a0618']], 0.38, 0.32);
      const road = lin('road', [[0, '#c98a1c'], [0.5, '#ffd257'], [1, '#ffe9a0']], 0, 1, 0, 0);
      const wood = lin('wood', [[0, '#8a5226'], [1, '#3a1a08']], 0, 0, 1, 0);
      // A tall dark pine: a trunk and tiers of drooping, jagged boughs.
      const tree = (x, base, hgt, w, fill, seed) => {
        const r = rng(seed);
        let tiers = '';
        for (let k = 0; k < 6; k++) {
          const top = base - hgt * (0.22 + k * 0.13) - hgt * 0.16, bot = base - hgt * (0.12 + k * 0.13);
          const half = w * (1 - k * 0.14) * (0.9 + r() * 0.2);
          tiers += '<path d="M' + x + ' ' + n(top) + 'L' + n(x + half * 0.5) + ' ' + n(bot - (bot - top) * 0.35) + 'L' + n(x + half * 0.35) + ' ' + n(bot - (bot - top) * 0.3) +
            'L' + n(x + half) + ' ' + n(bot) + 'Q' + x + ' ' + n(bot - 6) + ' ' + n(x - half) + ' ' + n(bot) + 'L' + n(x - half * 0.35) + ' ' + n(bot - (bot - top) * 0.3) +
            'L' + n(x - half * 0.5) + ' ' + n(bot - (bot - top) * 0.35) + 'Z"/>';
        }
        return '<g fill="' + fill + '"><path d="M' + n(x - w * 0.08) + ' ' + base + 'V' + n(base - hgt * 0.3) + 'H' + n(x + w * 0.08) + 'V' + base + 'Z"/>' + tiers +
          '<path d="M' + x + ' ' + n(base - hgt * 1.02) + 'L' + n(x + 3) + ' ' + n(base - hgt * 0.86) + 'H' + n(x - 3) + 'Z"/></g>';
      };
      // The road, from the foreground up to the city: two edges along a curve.
      const mid = [[392, 444], [330, 392], [470, 338], [474, 300]];
      const along = (t, half) => {
        const p = bez(mid[0], mid[1], mid[2], mid[3], t);
        return [n(p[0] - half), p[1], n(p[0] + half), p[1]];
      };
      let left = '', right = '', bricks = '';
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, half = 64 * (1 - t) ** 1.3 + 2;
        const [lx, y, rx] = along(t, half);
        left += (i ? 'L' : 'M') + lx + ' ' + y;
        right = 'L' + rx + ' ' + y + right;
        if (i < 22 && i % 2 === 0) bricks += '<path d="M' + lx + ' ' + y + 'H' + rx + '" stroke="#a8661a" stroke-width="' + n(1.6 * (1 - t) + 0.4) + '" opacity=".75"/>';
        if (i < 20 && i % 2 === 0) {
          const t2 = (i + 1) / 24, [lx2, y2, rx2] = along(t2, 64 * (1 - t2) ** 1.3 + 2);
          const k = i % 4 ? [0.25, 0.75] : [0.5];
          k.forEach(f => { bricks += '<path d="M' + n(lx + (rx - lx) * f) + ' ' + y + 'L' + n(lx2 + (rx2 - lx2) * f) + ' ' + y2 + '" stroke="#a8661a" stroke-width="' + n(1.4 * (1 - t) + 0.3) + '" opacity=".6"/>'; });
        }
      }
      const roadPath = left + right + 'Z';
      // The Emerald City, far off: a cluster of thin green spires.
      const spire = (x, base, hgt, w) => '<path d="M' + (x - w) + ' ' + base + 'V' + n(base - hgt * 0.7) + 'L' + x + ' ' + n(base - hgt) + 'L' + (x + w) + ' ' + n(base - hgt * 0.7) + 'V' + base + 'Z"/>';
      const city = '<g fill="' + lin('emerald', [[0, '#c8ffd6'], [1, '#2a9a62']]) + '">' +
        [[456, 9, 2.4], [462, 16, 2.8], [468, 22, 3.2], [474, 14, 2.6], [480, 19, 3], [486, 11, 2.4], [491, 7, 2]].map(([x, hh, w]) => spire(x, 302, hh, w)).join('') + '</g>';
      // The oil can: a tin body, a long spout raised, a ring handle.
      const oilCan = '<g transform="translate(470 396) rotate(-8)">' +
        '<path d="M14 -16L46 -50" stroke="' + tinDark + '" stroke-width="5" stroke-linecap="round"/><path d="M14 -16L46 -50" stroke="#fff" stroke-width="1.2" opacity=".7"/>' +
        '<path d="M-20 -14C-20 -26 20 -26 20 -14V14C20 22 -20 22 -20 14Z" fill="' + tin + '" stroke="#2a2c48" stroke-width="2"/>' +
        '<ellipse cx="0" cy="-14" rx="20" ry="6" fill="#e8ebff" stroke="#2a2c48" stroke-width="2"/>' +
        '<path d="M-6 -20C-6 -30 6 -30 6 -20" fill="none" stroke="#2a2c48" stroke-width="2"/><circle cx="0" cy="-30" r="3" fill="' + tin + '" stroke="#2a2c48" stroke-width="1.4"/>' +
        '<path d="M20 -6C34 -6 34 12 20 12" fill="none" stroke="' + tinDark + '" stroke-width="4"/>' +
        '<path d="M-20 0H20M-20 8H20" stroke="#2a2c48" stroke-width="1" opacity=".4"/>' +
        '<path d="M-13 -10V12" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".75"/>' +
        '<circle cx="47" cy="-51" r="2.4" fill="#ffe08a"/></g>';
      // The axe, leaning on a stump: a long handle and a bright tin head.
      const axe = '<g transform="translate(320 330) rotate(-14)">' +
        '<path d="M-4 -96H4L5 90H-5Z" fill="' + wood + '" stroke="#1e0c04" stroke-width="1.6"/>' +
        '<path d="M-3 -60V80" stroke="#c98a4a" stroke-width="1.2" opacity=".6"/>' +
        '<path d="M-6 -98H6V-80H-6Z" fill="' + tinDark + '" stroke="#1e1e34" stroke-width="1.4"/>' +
        '<path d="M5 -98C22 -104 40 -112 46 -116C52 -98 52 -74 46 -58C38 -64 22 -74 5 -80Z" fill="' + tin + '" stroke="#1e1e34" stroke-width="2"/>' +
        '<path d="M44 -112C49 -96 49 -76 44 -62" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M-5 -96C-14 -98 -20 -92 -20 -88C-14 -86 -8 -86 -5 -84Z" fill="' + tinDark + '" stroke="#1e1e34" stroke-width="1.4"/>' +
        '<path d="M12 -94L36 -104" stroke="#fff" stroke-width="2" opacity=".55" stroke-linecap="round"/></g>';
      const stump = '<path d="M300 424V400C300 392 342 392 342 400V424Z" fill="' + wood + '" stroke="#1e0c04" stroke-width="2"/>' +
        '<ellipse cx="321" cy="400" rx="21" ry="6" fill="#c98a4a" stroke="#1e0c04" stroke-width="2"/>' +
        '<ellipse cx="321" cy="400" rx="11" ry="3" fill="none" stroke="#7a4418" stroke-width="1.2"/>';
      // The heart: plump red velvet with a gold stitched edge, hung on a silk thread.
      const heartD = 'M0 34C-30 12 -52 -6 -52 -28C-52 -46 -38 -58 -22 -58C-12 -58 -4 -52 0 -44C4 -52 12 -58 22 -58C38 -58 52 -46 52 -28C52 -6 30 12 0 34Z';
      const heart = '<g transform="translate(404 150)">' +
        '<path d="M0 -150V-48" stroke="#ffe7b0" stroke-width="1.6" opacity=".8"/>' +
        '<path d="' + heartD + '" fill="' + velvet + '"/>' +
        '<path d="' + heartD + '" fill="none" stroke="#ffd36e" stroke-width="2.4" stroke-dasharray="5 4" transform="scale(.86) translate(0 -3)"/>' +
        '<path d="' + heartD + '" fill="none" stroke="#3a0210" stroke-width="2.4"/>' +
        '<path d="M-36 -40C-32 -50 -20 -52 -14 -46" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>' +
        '<ellipse cx="-24" cy="-30" rx="9" ry="5" fill="#fff" opacity=".22" transform="rotate(-30 -24 -30)"/>' +
        '<path d="M-4 -46C-2 -50 2 -50 4 -46" fill="none" stroke="#ffd36e" stroke-width="2"/></g>';
      const rays = '<g fill="#fff4d0" opacity=".16">' + Array.from({ length: 16 }, (_, i) =>
        '<path d="M422 232L413 0H431Z" transform="rotate(' + (i * 22.5 + 6) + ' 422 232)"/>').join('') + '</g>';
      // The Tin Woodman as Denslow drew him for the 1900 book: riveted tin
      // cylinders, a funnel for a cap, jointed limbs, his axe at his side. He
      // stands on the road in the dusk, the velvet heart glowing in his hands.
      const metal = name => lin(name, [[0, '#3e4266'], [0.18, '#8a90b4'], [0.42, '#eef0ff'], [0.55, '#c4c8e2'], [0.85, '#6a6e92'], [1, '#ffd9b0']], 0, 0, 1, 0);
      const M = metal('m1'), M2 = metal('m2');
      const edge = '#1e2038';
      const cyl = (x, y, w, hh, f = M, rx = 4) => '<rect x="' + n(x - w / 2) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(hh) + '" rx="' + rx + '" fill="' + f + '" stroke="' + edge + '" stroke-width="2"/>';
      const band = (x, y, w) => '<rect x="' + n(x - w / 2 - 2) + '" y="' + n(y - 3) + '" width="' + n(w + 4) + '" height="7" rx="3" fill="' + M2 + '" stroke="' + edge + '" stroke-width="1.6"/>';
      const rivets = (x0, x1, y, step = 9) => { let o = ''; for (let x = x0; x <= x1; x += step) o += '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="1.5" fill="#f4f6ff" stroke="' + edge + '" stroke-width=".7"/>'; return o; };
      // A limb from a to b: a tin tube with rounded ends.
      const limb = (a, b, w) => '<path d="M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1] + '" stroke="' + edge + '" stroke-width="' + (w + 4) + '" stroke-linecap="round"/>' +
        '<path d="M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1] + '" stroke="' + lin('l' + a[0] + a[1], [[0, '#5a5e84'], [0.5, '#e8ebff'], [1, '#7a7ea4']], 0, 0, 1, 0) + '" stroke-width="' + w + '" stroke-linecap="round"/>';
      const joint = (x, y, r = 6) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + M2 + '" stroke="' + edge + '" stroke-width="1.6"/><circle cx="' + x + '" cy="' + y + '" r="1.6" fill="' + edge + '"/>';
      const heartS = 'M0 17C-15 6 -26 -3 -26 -14C-26 -23 -19 -29 -11 -29C-6 -29 -2 -26 0 -22C2 -26 6 -29 11 -29C19 -29 26 -23 26 -14C26 -3 15 6 0 17Z';
      const woodman = '<g transform="translate(414 408)">' +
        // Shadow on the road.
        '<ellipse cx="0" cy="2" rx="62" ry="9" fill="#5a2a10" opacity=".45"/>' +
        // The axe, its head resting on the road, the handle up in his right hand.
        '<path d="M-58 -2L-50 -150" stroke="#2a1206" stroke-width="9" stroke-linecap="round"/><path d="M-58 -2L-50 -150" stroke="' + wood + '" stroke-width="6" stroke-linecap="round"/>' +
        '<g transform="translate(-58 -10) rotate(-4)"><path d="M0 -6C-14 -10 -30 -14 -40 -12C-46 -2 -46 12 -40 22C-30 22 -14 16 0 8Z" fill="' + tin + '" stroke="' + edge + '" stroke-width="2"/>' +
          '<path d="M-38 -9C-43 0 -43 11 -38 19" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><rect x="-3" y="-8" width="9" height="18" rx="2" fill="' + tinDark + '" stroke="' + edge + '" stroke-width="1.4"/></g>' +
        // Legs: tubes with knee joints and round tin boots.
        limb([-15, -112], [-17, -60], 18) + limb([-17, -60], [-16, -14], 17) + joint(-17, -60) +
        limb([15, -112], [17, -60], 18) + limb([17, -60], [16, -14], 17) + joint(17, -60) +
        '<path d="M-32 -2C-34 -14 -24 -20 -14 -20H-6V-2Z" fill="' + M + '" stroke="' + edge + '" stroke-width="2"/>' +
        '<path d="M32 -2C34 -14 24 -20 14 -20H6V-2Z" fill="' + M + '" stroke="' + edge + '" stroke-width="2"/>' +
        // Hips and the barrel of his body, riveted, with seams.
        cyl(0, -124, 56, 16, M2, 6) +
        '<path d="M-38 -128C-42 -160 -42 -196 -36 -222H36C42 -196 42 -160 38 -128Z" fill="' + M + '" stroke="' + edge + '" stroke-width="2.4"/>' +
        band(0, -128, 76) + band(0, -220, 72) + rivets(-30, 30, -205) + rivets(-32, 32, -142) +
        '<path d="M0 -216V-132" stroke="' + edge + '" stroke-width="1.2" opacity=".5"/>' +
        '<path d="M-24 -214C-28 -186 -28 -160 -24 -136" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>' +
        '<path d="M37 -216C41 -190 41 -158 37 -132" stroke="#ffd09a" stroke-width="3" stroke-linecap="round" opacity=".8"/>' +
        // The right arm down to the axe handle; the left arm across, cradling the heart.
        limb([-36, -212], [-50, -176], 15) + limb([-50, -176], [-52, -140], 14) + joint(-50, -176, 5.5) +
        '<circle cx="-52" cy="-136" r="8" fill="' + M2 + '" stroke="' + edge + '" stroke-width="1.6"/>' +
        // Neck and head: a tin can with a rounded jaw, a funnel for a cap.
        cyl(0, -234, 16, 16, M2, 3) +
        '<path d="M-24 -290V-246C-24 -236 24 -236 24 -246V-290Z" fill="' + M + '" stroke="' + edge + '" stroke-width="2.4"/>' +
        band(0, -290, 50) + rivets(-18, 18, -280, 9) +
        '<path d="M-17 -284C-19 -270 -19 -258 -16 -248" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/>' +
        // A kind, simple face: two eyes and a small smile.
        '<circle cx="-8" cy="-272" r="2.6" fill="#1e2038"/><circle cx="9" cy="-272" r="2.6" fill="#1e2038"/>' +
        '<path d="M-6 -258C-2 -254 4 -254 8 -258" fill="none" stroke="#1e2038" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M-30 -292L-6 -326H6L30 -292Z" fill="' + M + '" stroke="' + edge + '" stroke-width="2.4"/>' +
        '<path d="M-6 -326V-344H6V-326" fill="' + M2 + '" stroke="' + edge + '" stroke-width="2"/>' +
        '<path d="M-20 -296L-4 -322" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>' +
        // The heart he holds at his chest, glowing.
        glow('held', 8, -176, 90, '#ff7a6a', 0.8) + glow('heldc', 8, -176, 30, '#ffe0c0', 0.7) +
        '<g transform="translate(8 -176)"><path d="' + heartS + '" fill="' + velvet + '" stroke="#3a0210" stroke-width="2"/>' +
          '<path d="' + heartS + '" fill="none" stroke="#ffd36e" stroke-width="1.6" stroke-dasharray="3.5 3" transform="scale(.84) translate(0 -2)"/>' +
          '<path d="M-17 -19C-15 -24 -9 -25 -6 -22" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".75"/></g>' +
        limb([36, -212], [48, -178], 15) + limb([48, -178], [26, -168], 14) + joint(48, -178, 5.5) +
        '<circle cx="22" cy="-166" r="8" fill="' + M2 + '" stroke="' + edge + '" stroke-width="1.6"/>' +
        '<circle cx="-8" cy="-162" r="7" fill="' + M2 + '" stroke="' + edge + '" stroke-width="1.6"/>' +
      '</g>';
      return '<rect width="' + W + '" height="' + H + '" fill="' + sky + '" opacity=".85"/>' +
        stars(611, 70, 140, W, 0, 220) +
        // A thin crescent high on the left of the art.
        '<path d="M312 30A26 26 0 1 0 334 76A21 21 0 0 1 312 30Z" fill="#fff6dc" opacity=".9"/>' +
        // Sunset glow on the horizon behind the far city.
        glow('dusk', 474, 300, 150, '#ffcf8a', 0.75) +
        glow('emglow', 474, 292, 40, '#9dffc4', 0.6) + city +
        // Far hills and the forest, two rows, leaving the road's clearing open.
        '<path d="M150 312C230 296 330 306 420 300S500 294 520 298V330H150Z" fill="#4a2060" opacity=".85"/>' +
        [[170, 332, 130, 24, 1], [214, 328, 160, 26, 2], [262, 334, 140, 22, 3], [304, 336, 110, 18, 10], [418, 338, 100, 16, 5], [516, 334, 150, 24, 4]].map(([x, b, hh, w, sd]) => tree(x, b, hh, w, '#3a1652', 900 + sd)).join('') +
        '<path d="M120 440V340C220 330 300 344 360 338S470 330 520 334V440Z" fill="#24092e"/>' +
        '<path d="' + roadPath + '" fill="' + road + '"/>' + bricks +
        '<path d="' + roadPath + '" fill="' + lin('roadfade', [[0, '#24092e', 0], [0.75, '#24092e', 0], [1, '#24092e', 0.5]], 0, 1, 0, 0) + '"/>' +
        [[150, 440, 250, 40, 6], [236, 440, 220, 34, 7], [520, 444, 260, 34, 8]].map(([x, b, hh, w, sd]) => tree(x, b, hh, w, '#160620', 920 + sd)).join('') +
        oilCan +
        // The heart and its light, over everything.
        glow('hglow', 422, 232, 190, '#ff7a6a', 0.5) + rays + woodman +
        sparkle(482, 110, 9) + sparkle(352, 150, 7) + sparkle(492, 210, 6) + sparkle(372, 70, 5) + sparkle(470, 330, 6, '#fff4c0') + sparkle(500, 270, 5, '#c8ffd6') +
        // Fireflies and glints in the dusk.
        scatter(613, 34, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(0.8 + r() * 1.8) + '" fill="' + (r() > 0.5 ? '#ffe9a0' : '#c8ffd6') + '" opacity="' + n(0.35 + r() * 0.55) + '"/>', 180, W, 200, 420);
    },
    },
    emblems: { 'The Tin Man': '<path d="M24 40C12 32 6 25 6 17c0-6 4-10 9-10 4 0 7 3 9 6 2-3 5-6 9-6 5 0 9 4 9 10 0 8-6 15-18 23z" fill="currentColor" fill-opacity=".18"/><path d="M24 40C12 32 6 25 6 17c0-6 4-10 9-10 4 0 7 3 9 6 2-3 5-6 9-6 5 0 9 4 9 10 0 8-6 15-18 23z"/><path d="M24 2v5"/><path d="M36 30l8 14"/><path d="M38 33c3-3 7-3 8 0-3 1-5 3-6 5z" fill="currentColor" fill-opacity=".45"/>' },
  };
}
