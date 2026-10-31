// Four live scenes redrawn without their studios' signature designs (21
// October 2026): Wonder Woman keeps the tiara with a sapphire and laurel in
// place of the red star; Hiccup's dragon soars with no red tail fin, green
// eyes or blast; Simba is a grown lion sitting before a savanna sunrise, with
// no Pride Rock; Shrek is a treehouse in a great tree before a misty forest,
// with a moonlit pond. Loaded into SCENES by tools/character-art.mjs; the
// Shrek emblem is mirrored in EMBLEM_PATHS in docs/copy.js.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter } = h;
  return {
    scenes: {
  'Wonder Woman': () => {
      const gold = lin('gold', [[0, '#fff6c4'], [0.5, '#f0c050'], [1, '#b8781e']]);
      const sapphire = rad('sapph', [[0, '#e8f4ff'], [0.35, '#6aa8ff'], [1, '#1a3a9a']], 0.38, 0.32);
      // A laurel sprig either side of the gem, leaves along a gentle curve.
      const laurel = side => [0, 1, 2, 3].map(i => {
        const x = side * (30 + i * 15);
        const y = -6 - i * 4 + i * i * 1.4;
        return '<ellipse cx="' + x + '" cy="' + n(y) + '" rx="8" ry="3.6" transform="rotate(' + (side * (-28 + i * 10)) + ' ' + x + ' ' + n(y) + ')" fill="#fff4c0" stroke="#9a6014" stroke-width="1.2"/>';
      }).join('');
      return tint('#ffb84a', '#7a2a6a', 0.55) + stars(161, 24, 120, W, 0, 150) +
        '<g fill="#fff3c4" opacity=".22">' + [-60, -36, -12, 12, 36, 60].map(a => '<path d="M380 176L364 -40H396Z" transform="rotate(' + a + ' 380 176)"/>').join('') + '</g>' +
        glow('g', 380, 180, 200, '#ffe39a', 0.85) +
        '<path d="M0 440V380C120 372 260 386 380 380S490 376 520 378V440Z" fill="' + lin('sea', [[0, '#ff9a6a', 0.7], [1, '#5a1a3a']]) + '"/>' +
        '<g fill="#3a0f2a"><path d="M300 440L322 410H520V440Z"/><path d="M318 410H520V404H326ZM326 404H520V398H334Z"/>' +
          [342, 372, 402, 432, 462, 492].map(x => '<rect x="' + x + '" y="348" width="13" height="50"/>').join('') +
          '<path d="M330 338H520V348H330Z"/><path d="M322 338L428 310L534 338Z"/></g>' +
        '<g transform="translate(380 180) rotate(40)">' +
          '<path d="M-7 -150L0 -172L7 -150V60H-7Z" fill="' + lin('blade', [[0, '#ffffff'], [1, '#a8b0c8']], 0, 0, 1, 0) + '" stroke="#fff" stroke-width="2"/>' +
          '<path d="M0 -150V56" stroke="#8a94b0" stroke-width="1.6"/>' +
          '<path d="M-36 60H36L30 70H-30Z" fill="' + gold + '" stroke="#fff" stroke-width="2"/>' +
          '<rect x="-5" y="70" width="10" height="42" fill="#5a2a1a"/><path d="M-5 78h10M-5 88h10M-5 98h10" stroke="#c98a4a" stroke-width="2"/>' +
          '<circle cy="118" r="8" fill="' + gold + '" stroke="#fff" stroke-width="2"/></g>' +
        '<g transform="rotate(-12 380 182)" fill="none">' +
          '<ellipse cx="380" cy="182" rx="150" ry="52" stroke="#fff3b0" stroke-width="20" opacity=".22"/>' +
          '<ellipse cx="380" cy="182" rx="150" ry="52" stroke="#f0bf4a" stroke-width="6"/>' +
          '<ellipse cx="380" cy="182" rx="150" ry="52" stroke="#fff8d8" stroke-width="2.4" stroke-dasharray="7 7"/></g>' +
        '<g transform="translate(380 176) scale(1.1)">' +
          '<path d="M-120 26C-60 -8 60 -8 120 26L114 46C58 16 -58 16 -114 46Z" fill="' + gold + '" stroke="#7a4a10" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M-114 30C-58 0 58 0 114 30" stroke="#fffbe0" stroke-width="2.4" fill="none"/>' +
          '<path d="M-110 40C-56 12 56 12 110 40" stroke="#9a6014" stroke-width="2" fill="none" opacity=".7"/>' +
          '<path d="M-50 12L0 -64L50 12C30 6 -30 6 -50 12Z" fill="' + gold + '" stroke="#7a4a10" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M-36 8L0 -46L36 8" stroke="#9a6014" stroke-width="2" fill="none"/><path d="M-44 10L0 -58" stroke="#fffbe0" stroke-width="2" fill="none"/>' +
          '<g transform="translate(0 -14)"><circle r="30" fill="#7ab8ff" opacity=".28"/>' +
            '<path d="M0 -24L18 -8L12 18H-12L-18 -8Z" fill="' + sapphire + '" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>' +
            '<path d="M0 -24L6 -6L0 18M-18 -8H18M6 -6L12 18M-6 -6L-12 18M0 -24L-6 -6" fill="none" stroke="#dff0ff" stroke-width="1.2" opacity=".7"/>' +
            '<path d="M-6 -14L0 -20" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>' +
          '<g transform="translate(0 2)">' + laurel(1) + laurel(-1) + '</g></g>' +
        sparkle(480, 64, 13) + sparkle(270, 96, 9) + sparkle(470, 270, 7);
    },

    // A sleek black dragon soaring up across a full moon, head raised, wings
    // flung wide: a dragon of the sagas, with no eyes drawn, no red fin, no
    // blast and none of the film dragon's features.
    'Hiccup': () => {
      // Drawn heading straight up, then turned to climb across the moon.
      const head = 'M0 -176C5 -170 8 -160 9 -150L26 -138L10 -140C10 -132 9 -124 7 -118H-7C-9 -124 -10 -132 -10 -140L-26 -138L-9 -150C-8 -160 -5 -170 0 -176Z';
      const neckBody = 'M-7 -120C-9 -100 -12 -80 -16 -60C-22 -40 -22 -10 -16 20C-12 34 -8 44 -5 52H5C8 44 12 34 16 20C22 -10 22 -40 16 -60C12 -80 9 -100 7 -120Z';
      // One wing: a long leading edge swept up and out, scalloped trailing edge.
      const wing = 'M14 -58C60 -96 120 -132 214 -150C200 -132 190 -114 186 -96C170 -88 156 -74 150 -58C134 -54 120 -42 112 -28C96 -28 80 -18 70 -6C52 -8 34 0 18 12Z';
      const bones = '<path d="M14 -58L214 -150M120 -124L186 -96M90 -106L150 -58M64 -88L112 -28M40 -70L70 -6" stroke="#3a3f6a" stroke-width="2" fill="none" opacity=".8"/>';
      // The tail: a ribbon tapering along an S-curve to a spade tip.
      const curve = [[0, 50], [10, 110], [-40, 150], [-30, 230]];
      const along = t => {
        const p = bez(...curve, t);
        const q = bez(...curve, Math.min(1, t + 0.01));
        const r = bez(...curve, Math.max(0, t - 0.01));
        const len = Math.hypot(q[0] - r[0], q[1] - r[1]) || 1;
        const d = [(q[0] - r[0]) / len, (q[1] - r[1]) / len];
        return { p, d, nrm: [-d[1], d[0]] };
      };
      const at = (o, a, b) => n(o.p[0] + o.nrm[0] * a + o.d[0] * b) + ' ' + n(o.p[1] + o.nrm[1] * a + o.d[1] * b);
      const left = [];
      const right = [];
      for (let i = 0; i <= 30; i++) {
        const o = along(i / 30);
        const w = 7 * (1 - i / 30) + 1.4;
        left.push(at(o, w, 0));
        right.unshift(at(o, -w, 0));
      }
      const end = along(1);
      const spade = 'M' + at(end, 0, -6) + 'L' + at(end, 12, 6) + 'L' + at(end, 0, 22) + 'L' + at(end, -12, 6) + 'Z';
      const tail = 'M' + left.join('L') + 'L' + right.join('L') + 'Z' + spade;
      // Back legs tucked in flight, a spine ridge down the back.
      const legs = 'M-14 18L-30 40L-22 44L-8 28ZM14 18L30 40L22 44L8 28Z';
      let ridge = '';
      for (const y of [-100, -84, -68, -50, -32, -14, 4]) ridge += 'M-3 ' + y + 'L0 ' + (y - 10) + 'L3 ' + y + 'Z';
      const cloud = (x, y, rx, ry, fill, o) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" opacity="' + o + '"/><path d="M' + (x - rx * 0.7) + ' ' + n(y - ry * 0.7) + 'Q' + x + ' ' + n(y - ry * 1.1) + ' ' + (x + rx * 0.7) + ' ' + n(y - ry * 0.7) + '" stroke="#dfe8ff" stroke-width="2" fill="none" opacity="' + n(o * 0.6) + '"/>';
      const dark = '#090c1c';
      return tint('#1a2a5a', '#5a2a7a', 0.65) + stars(221, 50, 120, W, 0, 260) +
        glow('moonglow', 392, 180, 210, '#cfe0ff', 0.55) +
        '<circle cx="392" cy="180" r="122" fill="' + rad('moon', [[0, '#ffffff'], [1, '#c8d6f0']], 0.4, 0.35) + '"/>' +
        '<g fill="#a8b8d8" opacity=".35"><circle cx="350" cy="140" r="18"/><circle cx="436" cy="222" r="12"/><circle cx="440" cy="132" r="7"/></g>' +
        cloud(300, 300, 190, 16, '#4a5a8a', 0.8) + cloud(480, 110, 110, 12, '#5a6a9a', 0.6) + cloud(340, 332, 150, 10, '#3a4a7a', 0.7) +
        // Wind streaks behind the climb.
        '<g stroke="#e6eeff" stroke-width="2" stroke-linecap="round" opacity=".35"><path d="M300 330L340 290M318 352L352 316M480 330L452 300"/></g>' +
        '<g transform="translate(392 196) rotate(30) scale(.6)">' +
          '<g fill="' + dark + '" stroke="#9fb8e8" stroke-width="2" stroke-opacity=".5">' +
            '<path d="' + wing + '"/><path d="' + wing + '" transform="scale(-1 1)"/>' +
            '<path d="' + tail + '"/><path d="' + legs + '"/><path d="' + neckBody + '"/><path d="' + head + '"/></g>' +
          bones + '<g transform="scale(-1 1)">' + bones + '</g>' +
          '<path d="' + ridge + '" fill="' + dark + '"/></g>' +
        cloud(240, 372, 200, 14, '#2a3360', 0.85) + cloud(470, 386, 120, 10, '#232a55', 0.85) +
        '<g fill="#0c1230"><path d="M300 440V346L314 332L330 346V440Z"/><path d="M470 440V330L488 314L506 330V440Z"/></g>' +
        ground('M0 440V404C120 396 260 410 380 402S490 398 520 400V440Z', '#0a1028') +
        '<path d="M200 418c30-6 60 6 90 0s60-6 90 0 60 6 90 0" fill="none" stroke="#cfe0ff" stroke-width="2" opacity=".4"/>' +
        sparkle(488, 60, 9) + sparkle(270, 90, 7);
    },

    // A grown lion sitting upright and still on the open savanna, mane
    // flowing, silhouetted against the rising sun: a lion, not a cub and not
    // the film's, with no Pride Rock and no ledge.
    'Simba': () => {
      const ink = '#2b0d2f';
      const r = rng(318);
      // A regal adult lion sitting in profile, facing the sunrise: a smooth
      // body with a deep chest and straight front legs, a full round mane of
      // soft tufts, the muzzle and nose clear of it, a small round ear and
      // the tail raised behind with its tuft.
      const bodyPath = 'M-60 -132C-56 -100 -58 -70 -56 -50L-58 -10C-70 -8 -78 -4 -76 2L-38 4L-40 -30' +
        'C-34 -34 -28 -34 -22 -28L-26 -4C-34 -2 -34 4 -26 4L64 4C86 2 94 -30 84 -58C76 -80 58 -96 34 -106' +
        'C16 -114 2 -124 -8 -134C-26 -146 -48 -148 -60 -132Z';
      // The mane: overlapping round tufts on a soft ring, fuller at the back
      // and spilling down over the chest.
      let mane = '<ellipse cx="-26" cy="-160" rx="44" ry="52"/>';
      for (let k = 0; k < 34; k++) {
        const a = (k / 34) * Math.PI * 2;
        const back = Math.cos(a) > 0 ? 6 : 0;
        const low = Math.sin(a) > 0.3 ? 10 : 0;
        const rx = 42 + back + r() * 4;
        const ry = 50 + low + r() * 4;
        mane += '<circle cx="' + n(-26 + Math.cos(a) * rx) + '" cy="' + n(-160 + Math.sin(a) * ry) + '" r="' + n(13 + r() * 4) + '"/>';
      }
      // The head: brow, the long muzzle, nose and chin, clear of the mane.
      const headPath = 'M-50 -206C-62 -206 -76 -200 -88 -194L-102 -188C-108 -186 -110 -178 -106 -174L-104 -170' +
        'C-104 -164 -98 -160 -90 -160C-80 -158 -68 -160 -56 -164C-48 -170 -44 -186 -50 -206Z';
      const ear = '<path d="M-60 -206C-62 -218 -54 -226 -46 -222C-40 -218 -42 -208 -48 -204Z"/>' +
        '<path d="M-56 -208C-56 -216 -50 -220 -46 -217" fill="none" stroke="#ffcf8a" stroke-width="2" stroke-linecap="round" opacity=".75"/>';
      const tail = '<path d="M80 -24C98 -30 106 -50 98 -72" fill="none" stroke="' + ink + '" stroke-width="6" stroke-linecap="round"/>' +
        '<ellipse cx="96" cy="-80" rx="8" ry="12" transform="rotate(-14 96 -80)"/>';
      const parts = tail + '<path d="' + bodyPath + '"/>' + mane + '<path d="' + headPath + '"/>' + ear +
        // Light catching the edges: the far front leg, the haunch, the ear's
        // inner curve, the eye's brow and the nose.
        '<g fill="none" stroke="#6a3a5a" stroke-linecap="round" opacity=".65">' +
          '<path d="M-44 -60V-6M-22 -28C-10 -40 10 -52 40 -56" stroke-width="2.4"/>' +
          '<path d="M-78 -190C-74 -192 -70 -192 -66 -190" stroke-width="2"/>' +
          '<path d="M-104 -180C-100 -178 -96 -178 -94 -180" stroke-width="2"/></g>' +
        // Soft locks in the mane.
        '<g fill="none" stroke="#5a2a4a" stroke-width="2" stroke-linecap="round" opacity=".5">' +
          '<path d="M-20 -204C-4 -194 6 -176 6 -156M-10 -178C2 -164 6 -146 2 -128M-36 -146C-34 -130 -38 -118 -46 -108M4 -200C16 -186 22 -170 22 -152"/></g>';
      const mane2 = '';
      const flow = '';
      const strands = '';
      const acacia = (x, base, s) => '<g transform="translate(' + x + ' ' + base + ') scale(' + s + ')" fill="' + ink + '">' +
        '<path d="M-3 0V-46L-18 -64M3 -46L20 -66M0 -46V-62" stroke="' + ink + '" stroke-width="5" stroke-linecap="round" fill="none"/>' +
        '<path d="M-52 -64C-40 -80 40 -82 54 -66C40 -58 -40 -56 -52 -64Z"/><path d="M-30 -74C-18 -86 22 -86 32 -76C20 -70 -20 -68 -30 -74Z"/></g>';
      return tint('#ffb24a', '#7a2e7a', 0.55) +
        '<g fill="' + lin('rays', [[0, '#ffe7a0', 0.8], [1, '#ffb24a', 0]]) + '">' +
          [-64, -40, -16, 8, 32, 56].map(a => '<path d="M396 250L380 60L412 60Z" transform="rotate(' + a + ' 396 250)"/>').join('') + '</g>' +
        glow('sun', 396, 250, 200, '#ffd27a', 0.85) +
        '<circle cx="396" cy="250" r="116" fill="' + lin('disc', [[0, '#fff1b8'], [0.6, '#ffb54d'], [1, '#ff7a3d']]) + '"/>' +
        '<g fill="#7a2e7a" opacity=".28"><rect x="280" y="290" width="232" height="6"/><rect x="280" y="308" width="232" height="8"/><rect x="280" y="328" width="232" height="10"/></g>' +
        '<g fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"><path d="M300 100q8-6 16 0q8-6 16 0"/><path d="M336 74q6-5 12 0q6-5 12 0"/><path d="M478 110q6-5 12 0q6-5 12 0"/></g>' +
        '<path d="M0 440V352C90 344 200 352 290 346S430 336 520 342V440Z" fill="#5a1f4f" opacity=".75"/>' +
        acacia(258, 352, 0.85) +
        '<path d="M0 440V380C100 374 220 382 330 376S460 368 520 372V440Z" fill="' + ink + '"/>' +
        '<g fill="' + ink + '">' + scatter(313, 26, (x, y, rr) => '<path d="M' + x + ' 380l' + n(2 + rr() * 2) + ' -' + n(8 + rr() * 10) + ' ' + n(2 + rr() * 2) + ' ' + n(8 + rr() * 10) + 'Z"/>', 140, W, 0, 1) + '</g>' +
        '<g transform="translate(402 380) scale(1.04)" fill="' + ink + '">' +
          parts + '</g>' +
        '<path d="M330 374H520" stroke="#ffd27a" stroke-width="2" opacity=".45"/>' + sparkle(270, 150, 9);
    },

    // Night in an old forest: layers of trees fading into mist and moonlight,
    // one great tree in front with a treehouse built into it (warm windows, a
    // ladder, lanterns, fireflies) and a still pond at its foot holding the
    // moon. A treehouse, not a stump, and nothing from the swamp.
    'Shrek': () => {
      const r = rng(611);
      const bark = lin('bark', [[0, '#7a5a4a'], [0.55, '#4a2e30'], [1, '#24141e']], 0, 0, 1, 0);
      const plank = lin('plank', [[0, '#d8a06a'], [1, '#8a5232']]);
      const roofF = lin('roof', [[0, '#8a3a5a'], [1, '#4a1a3a']]);
      const water = lin('water', [[0, '#5a6aa8'], [1, '#1e1a44']]);
      // A rounded tree for the far layers: a trunk and a lumpy crown.
      const farTree = (x, base, h, w, fill) => '<path d="M' + n(x - 2) + ' ' + base + 'V' + n(base - h * 0.4) + 'h4V' + base + 'Z" fill="' + fill + '"/>' +
        [[0, -0.7, 0.5], [-0.32, -0.5, 0.36], [0.32, -0.52, 0.38], [0, -0.94, 0.34]].map(([dx, dy, rr]) =>
          '<circle cx="' + n(x + dx * w) + '" cy="' + n(base + dy * h) + '" r="' + n(rr * w) + '" fill="' + fill + '"/>').join('');
      const pine = (x, base, h, fill) => '<path d="M' + x + ' ' + n(base - h) + 'L' + n(x + h * 0.22) + ' ' + n(base - h * 0.55) + 'H' + n(x + h * 0.12) +
        'L' + n(x + h * 0.3) + ' ' + base + 'H' + n(x - h * 0.3) + 'L' + n(x - h * 0.12) + ' ' + n(base - h * 0.55) + 'H' + n(x - h * 0.22) + 'Z" fill="' + fill + '"/>';
      const row = (seed, base, minH, maxH, fill) => {
        const q = rng(seed);
        let out = '';
        for (let x = 110; x < 540; x += 26 + q() * 22) out += q() > 0.45 ? pine(n(x), base, n(minH + q() * (maxH - minH)), fill) : farTree(n(x), base, n(minH + q() * (maxH - minH)), n(34 + q() * 20), fill);
        return out;
      };
      const mist = (y, o, rx = 260, cx = 330) => '<ellipse cx="' + cx + '" cy="' + y + '" rx="' + rx + '" ry="12" fill="#e8ecff" opacity="' + o + '"/>';
      // The great tree's crown: clusters of leaves in three tones, lit from the moon.
      const clump = (x, y, rr) => {
        let out = '';
        const pts = [[0, 0, 1], [-0.7, 0.2, 0.75], [0.7, 0.15, 0.8], [-0.3, -0.5, 0.7], [0.35, -0.45, 0.72], [0, 0.45, 0.7]];
        for (const [dx, dy, k] of pts) out += '<circle cx="' + n(x + dx * rr) + '" cy="' + n(y + dy * rr) + '" r="' + n(rr * k) + '"/>';
        return out;
      };
      const crown = [[330, 128, 44], [392, 96, 56], [462, 118, 52], [506, 166, 40], [300, 182, 34], [430, 176, 46]];
      const crownShade = '<g fill="#1e3a3a">' + crown.map(([x, y, rr]) => clump(x, y + 8, rr)).join('') + '</g>';
      const crownMid = '<g fill="#2f5a4e">' + crown.map(([x, y, rr]) => clump(x, y, rr * 0.92)).join('') + '</g>';
      const crownLit = '<g fill="#4a7a5e" opacity=".8">' + crown.map(([x, y, rr]) => clump(x - rr * 0.18, y - rr * 0.22, rr * 0.62)).join('') + '</g>' +
        '<g fill="#86b884" opacity=".45">' + crown.map(([x, y, rr]) => clump(x - rr * 0.32, y - rr * 0.42, rr * 0.26)).join('') + '</g>';
      const leaves = scatter(612, 40, (x, y, q) => '<ellipse cx="' + x + '" cy="' + y + '" rx="5" ry="2.6" fill="#7ab87a" opacity="' + n(0.35 + q() * 0.4) + '" transform="rotate(' + n(q() * 180) + ' ' + x + ' ' + y + ')"/>', 290, 520, 60, 210);
      // A hut: plank walls, shingled roof, two warm windows, a door.
      const hut = (x, y, w, h, s = 1) => {
        const glowWin = (wx, wy, ww, wh) => glow('w' + x + wx, wx + ww / 2, wy + wh / 2, ww * 1.6, '#ffcf7a', 0.55) +
          '<rect x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '" rx="2" fill="' + lin('win' + x + wx, [[0, '#fff2c0'], [1, '#ffb24a']]) + '" stroke="#3a1a14" stroke-width="2"/>' +
          '<path d="M' + (wx + ww / 2) + ' ' + wy + 'V' + (wy + wh) + 'M' + wx + ' ' + (wy + wh / 2) + 'H' + (wx + ww) + '" stroke="#3a1a14" stroke-width="1.6"/>';
        let planks = '';
        for (let py = y - h + 8; py < y; py += 8) planks += 'M' + x + ' ' + py + 'H' + (x + w);
        let shingles = '';
        for (let k = 1; k < 4; k++) shingles += 'M' + n(x - 10 + k * 6) + ' ' + n(y - h - k * 9) + 'H' + n(x + w + 10 - k * 6);
        return '<g>' +
          '<rect x="' + x + '" y="' + (y - h) + '" width="' + w + '" height="' + h + '" fill="' + plank + '" stroke="#3a1a14" stroke-width="2"/>' +
          '<path d="' + planks + '" stroke="#7a4a2a" stroke-width="1.2" opacity=".7"/>' +
          '<path d="M' + (x - 14) + ' ' + (y - h + 2) + 'L' + (x + w / 2) + ' ' + (y - h - 36 * s) + 'L' + (x + w + 14) + ' ' + (y - h + 2) + 'Z" fill="' + roofF + '" stroke="#2a1020" stroke-width="2.4" stroke-linejoin="round"/>' +
          '<path d="' + shingles + '" stroke="#2a1020" stroke-width="1.4" opacity=".6"/>' +
          glowWin(x + 8, y - h + 10, 16 * s, 16 * s) + (w > 60 ? glowWin(x + w - 8 - 16 * s, y - h + 10, 16 * s, 16 * s) : '') +
          '<path d="M' + n(x + w / 2 - 8) + ' ' + y + 'V' + n(y - 20) + 'A8 8 0 0 1 ' + n(x + w / 2 + 8) + ' ' + n(y - 20) + 'V' + y + 'Z" fill="#5a2e22" stroke="#3a1a14" stroke-width="1.6"/>' +
          '</g>';
      };
      const lantern = (x, y, len) => '<path d="M' + x + ' ' + y + 'V' + (y + len) + '" stroke="#2a1626" stroke-width="1.6"/>' +
        glow('lan' + x, x, y + len + 7, 26, '#ffcf6a', 0.75) +
        '<path d="M' + (x - 5) + ' ' + (y + len) + 'h10l2 4v8l-2 3h-10l-2-3v-8z" fill="#ffe6a0" stroke="#3a1a14" stroke-width="1.6"/>' +
        '<path d="M' + (x - 4) + ' ' + (y + len) + 'L' + x + ' ' + (y + len - 4) + 'L' + (x + 4) + ' ' + (y + len) + '" fill="#3a1a14"/>';
      return tint('#24405a', '#4a2462', 0.62) + stars(613, 30, 120, W, 0, 150) +
        glow('moonglow', 318, 74, 170, '#e8f0ff', 0.55) +
        '<circle cx="318" cy="74" r="34" fill="' + rad('moonf', [[0, '#ffffff'], [1, '#dfe6ff']], 0.4, 0.35) + '"/>' +
        // The forest behind, in layers that fade into the mist.
        '<g opacity=".45">' + row(621, 330, 90, 150, '#5a6a92') + '</g>' + mist(320, 0.22) +
        '<g opacity=".75">' + row(622, 350, 80, 130, '#33405e') + '</g>' + mist(344, 0.2) +
        '<g>' + row(623, 372, 70, 110, '#1c2440') + '</g>' + mist(366, 0.18, 300) +
        // The great tree: roots, a thick trunk, two boughs into the crown.
        '<path d="M392 412C398 380 402 340 400 300C398 262 386 226 360 196L374 188C396 210 410 238 418 266C426 234 446 206 478 186L488 196C462 222 446 256 442 292C438 340 446 384 456 412Z" fill="' + bark + '"/>' +
        '<path d="M366 412C380 404 390 396 396 384M478 412C466 404 456 396 450 384M344 414C368 410 384 406 398 398M494 414C474 410 460 404 448 396" fill="none" stroke="#3a2028" stroke-width="9" stroke-linecap="round"/>' +
        '<g fill="none" stroke="#1e0e18" stroke-width="2.2" stroke-linecap="round" opacity=".55"><path d="M408 404C410 360 410 320 406 286M424 404C424 366 428 328 432 300M416 250C412 236 404 222 394 210M434 254C442 236 454 222 466 210"/></g>' +
        '<g fill="none" stroke="#b08a7a" stroke-width="1.6" stroke-linecap="round" opacity=".35"><path d="M444 400C442 360 444 330 448 300M398 360C400 340 400 320 398 300"/></g>' +
        '<ellipse cx="420" cy="340" rx="6" ry="9" fill="#1e0e18" opacity=".7"/>' +
        crownShade + crownMid + crownLit + leaves +
        // The main hut on its platform, wrapped round the trunk, and a ladder.
        '<rect x="346" y="262" width="150" height="9" rx="2" fill="' + plank + '" stroke="#3a1a14" stroke-width="2"/>' +
        '<path d="M356 271L386 300M486 271L452 300" stroke="#3a1a14" stroke-width="5" stroke-linecap="round"/>' +
        '<g stroke="#a87448" stroke-width="2.4"><path d="M346 262V246M496 262V246M346 248H372M470 248H496"/></g>' +
        hut(372, 262, 98, 52, 1.1) +
        '<g stroke="#d8a06a" stroke-width="3" stroke-linecap="round"><path d="M352 272L340 412M368 272L358 412"/>' +
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(k => '<path d="M' + n(351 - k * 0.86) + ' ' + (282 + k * 10) + 'H' + n(367 - k * 0.72) + '"/>').join('') + '</g>' +
        // A small lookout up in the crown on the right bough.
        '<rect x="436" y="178" width="58" height="7" rx="2" fill="' + plank + '" stroke="#3a1a14" stroke-width="2"/>' +
        hut(446, 178, 40, 30, 0.75) +
        lantern(354, 271, 18) + lantern(492, 271, 22) + lantern(440, 185, 14) +
        // The pond at the tree's foot: the moon in it, lily pads, reeds, mist.
        '<ellipse cx="312" cy="400" rx="104" ry="20" fill="' + water + '"/>' +
        '<ellipse cx="312" cy="392" rx="96" ry="5" fill="#cfe0ff" opacity=".22"/>' +
        '<ellipse cx="318" cy="398" rx="18" ry="5" fill="#f4f6ff" opacity=".8"/><path d="M296 405h44M304 410h28" stroke="#f4f6ff" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>' +
        [[246, 402, 12], [282, 410, 9], [374, 406, 9]].map(([x, y, rr]) => '<path d="M' + x + ' ' + y + 'm' + rr + ' 0a' + rr + ' ' + n(rr * 0.38) + ' 0 1 1 -' + n(rr * 0.32) + ' -' + n(rr * 0.3) + 'L' + x + ' ' + y + 'Z" fill="#4a8a5a"/>').join('') +
        '<g fill="#ffd0e4"><circle cx="284" cy="408" r="3.2"/><circle cx="247" cy="400" r="2.6"/></g>' +
        '<g stroke="#2a3a2a" stroke-width="2.4" stroke-linecap="round">' + [214, 222, 230, 404, 412].map((x, k) => '<path d="M' + x + ' 410V' + (366 + k * 4) + '"/>').join('') + '</g>' +
        '<g fill="#5a3a2a">' + [214, 230, 412].map((x, k) => '<rect x="' + (x - 3) + '" y="' + (368 + k * 6) + '" width="6" height="16" rx="3"/>').join('') + '</g>' +
        mist(390, 0.22, 140, 300) + mist(382, 0.14, 110, 360) +
        ground('M0 440V424C120 418 240 430 360 424S480 420 520 422V440Z', '#140c22') +
        scatter(614, 12, (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="1.8" fill="#f0ff9a"/><circle cx="' + x + '" cy="' + y + '" r="5" fill="#f0ff9a" opacity=".2"/>', 280, 515, 200, 380) +
        sparkle(300, 60, 7) + sparkle(506, 250, 6);
    },
  },
  emblems: {
    // A treehouse in a great tree, in place of the onion.
    'Shrek': '<path d="M20 46c1-6 2-12 2-18-3-4-7-6-12-6M28 46c-1-6-2-12-2-18 3-4 7-6 12-6"/><path d="M8 18c0-8 7-13 16-13s16 5 16 13c0 5-6 8-16 8S8 23 8 18z" fill="currentColor" fill-opacity=".18"/><path d="M8 18c0-8 7-13 16-13s16 5 16 13c0 5-6 8-16 8S8 23 8 18z"/><path d="M15 34h18v-8H15z" fill="currentColor" fill-opacity=".3"/><path d="M15 34h18v-8H15z"/><path d="M13 26l11-6 11 6"/><path d="M20 30h3"/><path d="M33 34v10M36 36v10M33 38h3M33 42h3"/><path d="M4 46h40"/>',
  },
  };
}
