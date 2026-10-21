// Live (21 October 2026), loaded into SCENES by tools/character-art.mjs: Mulan from the Ballad of Mulan, which has her buy a fine
// horse in the markets and ride to war in her father's place. A lone rider in
// silhouette, no face, galloping along a ridge against a huge moon, spear
// couched forward with a red pennant, cape streaming; plum blossom framing the
// sky, petals swirling on the wind, blossom trees on the slopes, misty ranges
// receding into the distance with the Great Wall winding over them. Nothing
// from any film. Built like the reserve, for preview.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, rng, stars, sparkle, scatter } = h;

  const blossom = (x, y, s, c = '#ffb3cf', core = '#ff5f8f') => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
    [0, 72, 144, 216, 288].map(a => '<ellipse cx="0" cy="-5.6" rx="4" ry="5.8" fill="' + c + '" transform="rotate(' + a + ')"/>').join('') +
    '<circle r="2.8" fill="' + core + '"/><circle r="1.2" fill="#ffe08a"/></g>';
  const bud = (x, y, s) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(2.6 * s) + '" fill="#ff7aa6"/>';
  // A petal adrift, turned and tinted.
  const petal = (x, y, a, s, o, c = '#ffc2d8') => '<path transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')" d="M0 -4C3 -4 4 0 0 4C-4 0 -3 -4 0 -4Z" fill="' + c + '" opacity="' + o + '"/>';

  // A tapered limb: segments thinning from the body to the hoof.
  const limb = (pts, widths, color) => pts.slice(1).map((p, i) => '<path d="M' + pts[i][0] + ' ' + pts[i][1] + 'L' + p[0] + ' ' + p[1] + '" stroke="' + color + '" stroke-width="' + widths[i] + '" stroke-linecap="round" fill="none"/>').join('');
  const hoof = ([x, y], a, color) => '<path transform="translate(' + x + ' ' + y + ') rotate(' + a + ')" d="M-4 -2H4L5 3H-5Z" fill="' + color + '"/>';

  // The horse at the gallop, facing right, in the phase where the lead foreleg
  // reaches to land, the other folds under, one hind leg drives off behind and
  // the other swings through beneath. Origin on the ground below the barrel.
  const horse = (dark, far) =>
    // Far legs first, a shade lighter, for depth.
    limb([[114, -60], [128, -36], [112, -22], [104, -26]], [11, 8, 6], far) + hoof([104, -26], 70, far) +
    limb([[40, -60], [32, -34], [48, -16], [56, -10]], [14, 8, 6], far) + hoof([56, -10], -20, far) +
    '<g fill="' + dark + '">' +
      // Tail streaming back.
      '<path d="M6 -84C-12 -92 -36 -88 -58 -70C-48 -71 -41 -69 -35 -71C-46 -59 -51 -46 -52 -34C-38 -50 -21 -66 0 -72Z"/>' +
      '<path d="M2 -80C-16 -78 -30 -70 -40 -58C-30 -62 -18 -66 -4 -68Z" opacity=".7"/>' +
      // Hindquarter, barrel, shoulder and chest.
      '<path d="M4 -86C10 -101 32 -104 46 -94C53 -82 49 -64 37 -56C24 -53 8 -60 1 -71C-1 -77 0 -82 4 -86Z"/>' +
      '<path d="M12 -80C32 -100 102 -102 124 -90C135 -83 137 -66 128 -57C109 -49 50 -49 26 -55C14 -59 6 -69 12 -80Z"/>' +
      '<path d="M104 -94C123 -97 137 -84 139 -69C139 -58 131 -51 120 -53C111 -64 104 -79 104 -94Z"/>' +
      // The arched neck, the head stretched forward, the ears pricked.
      '<path d="M94 -92C103 -121 122 -141 143 -150L160 -139C153 -123 145 -102 139 -68Z"/>' +
      '<path d="M139 -148C147 -157 162 -155 172 -144C182 -134 190 -124 195 -115C197 -109 193 -104 186 -105C177 -106 169 -108 162 -111C156 -113 152 -119 150 -126C146 -134 141 -140 139 -148Z"/>' +
      '<path d="M142 -150L144 -165L150 -152ZM148 -152L155 -164L157 -150Z"/>' +
      // The mane, flying back off the crest, kept short of the rider.
      '<path d="M143 -149C132 -153 122 -147 114 -137C110 -131 106 -125 100 -121C108 -127 114 -135 120 -143C126 -151 134 -155 146 -155Z"/>' +
      '<path d="M134 -146C126 -151 117 -150 110 -144C117 -145 123 -144 129 -140Z"/>' +
    '</g>' +
    // Moonlit modelling: shoulder, hindquarter, neck and jaw, so the muscle reads.
    (dark === '#ffd98a' ? '' : '<g fill="none" stroke="#ffd98a" stroke-linecap="round" opacity=".38" stroke-width="1.6">' +
      '<path d="M108 -90C119 -83 126 -71 124 -59"/><path d="M14 -94C30 -97 42 -88 44 -74"/>' +
      '<path d="M108 -117C116 -110 124 -101 129 -92"/><path d="M151 -126C157 -118 168 -112 182 -110"/>' +
      '<path d="M60 -96C76 -99 92 -98 102 -94"/></g>') +
    // Near legs: the lead foreleg reaching, the hind leg driving off.
    limb([[124, -60], [148, -46], [168, -36], [175, -32]], [13, 8, 6], dark) + hoof([176, -31], -30, dark) +
    limb([[28, -62], [10, -38], [-12, -20], [-20, -16]], [16, 9, 6], dark) + hoof([-21, -15], 60, dark);

  // The rider, sitting tall enough in the saddle that moonlight shows between
  // her and the horse's neck: a slim waist with a sash, the cape off her
  // shoulders, a round helmet with a short spike and a neck guard, one arm
  // raising the spear clear of the horse's head, the other on the reins. A
  // warmer silhouette with its own rim of light, so she reads apart.
  const rider = (fill, rimmed) => {
    const shape =
      '<path d="M76 -106C74 -118 80 -126 84 -132C88 -141 93 -150 101 -158L115 -152C111 -144 105 -136 100 -128C98 -122 99 -114 97 -106Z"/>' +
      '<path d="M108 -156L112 -161L116 -158L112 -153Z"/>' +
      '<circle cx="117" cy="-166" r="8.2"/>' +
      '<path d="M106.5 -166C106.5 -181 127.5 -181 127.5 -166Z"/><path d="M108 -167L102 -156L111 -159Z"/>';
    const strokes = (c, extra) =>
      limb([[88, -108], [106, -94], [100, -78]], [8 + extra, 6 + extra], c) +
      limb([[111, -152], [124, -158], [134, -169]], [6.5 + extra, 5.5 + extra], c) +
      limb([[105, -148], [118, -134], [130, -128]], [5.5 + extra, 4.5 + extra], c) +
      '<path d="M117 -180V-188M105 -165H129" stroke="' + c + '" stroke-width="' + (2.6 + extra) + '" stroke-linecap="round"/>';
    if (rimmed) return '<g fill="' + fill + '" stroke="' + fill + '" stroke-width="3.4" stroke-linejoin="round">' + shape + '</g>' + strokes(fill, 3.4);
    return '<g fill="' + fill + '">' + shape + '</g>' + strokes(fill, 0) +
      // The reins, from her hand to the bit.
      '<path d="M130 -128C146 -122 160 -116 176 -112" stroke="#ffd98a" stroke-width=".9" fill="none" opacity=".55"/>';
  };
  // The spear, held forward and up in the leading hand at one clean angle.
  const SPEAR = 'M66 -117L188 -210.6';
  const spear = (color, w) => '<path d="' + SPEAR + '" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round"/>';
  // Warm wood with a dark edge and a lit side, so it reads on the moon and on the sky.
  const shaft = () => spear('#24081f', 6.4) + spear('#b8743a', 3.6) +
    '<path d="M68 -119.5L186 -213.1" stroke="#ffd9a0" stroke-width="1.1" stroke-linecap="round" opacity=".85"/>';
  // At the end: a leaf-shaped steel head with a glint, a collar, a red tassel,
  // and the pennant just below, streaming back. Drawn along the shaft's angle.
  const spearEnd = blade => '<g transform="translate(188 -210.6) rotate(-37.5)">' +
    '<path d="M-6 -2C-18 -15 -36 -8 -54 -20L-44 -10L-56 -2C-38 2 -22 2 -6 2Z" fill="#e0304f"/>' +
    '<path d="M-6 -2C-18 -15 -36 -8 -54 -20" fill="none" stroke="#ff8aa8" stroke-width="1" opacity=".8"/>' +
    '<path d="M1 1C-2 7 -8 11 -14 10C-10 7 -6 5 -3 2Z" fill="#e0304f"/><path d="M0 2C0 8 -4 13 -9 14C-6 10 -3 6 -1 2Z" fill="#c2183a"/>' +
    '<rect x="-3" y="-3.2" width="5" height="6.4" rx="1.2" fill="#e9b04a" stroke="#24081f" stroke-width="1"/>' +
    '<path d="M2 0C8 -6 20 -6 34 0C20 6 8 6 2 0Z" fill="' + blade + '" stroke="#24081f" stroke-width="1.2"/>' +
    '<path d="M4 0H30" stroke="#ffffff" stroke-width="1" opacity=".8"/>' +
    '<path d="M34 -6L35.6 -1.6L40 0L35.6 1.6L34 6L32.4 1.6L28 0L32.4 -1.6Z" fill="#fff"/></g>';

  return {
    scenes: {
      'Mulan': () => {
        const moonFill = rad('moon', [[0, '#fffaf0'], [0.62, '#ffe8b8'], [1, '#f6c97e']], 0.42, 0.38);
        const blade = lin('blade', [[0, '#ffffff'], [1, '#cfc6f2']], 0, 0, 1, 0);
        // Four ranges, paler and pinker as they recede.
        const range = (d, top, bottom, o = 1) => '<path d="' + d + '" fill="' + lin('r' + top.slice(1), [[0, top, o], [1, bottom, o]]) + '"/>';
        const mist = (y, o, amp = 10) => '<path d="M0 ' + y + 'C110 ' + (y - amp) + ' 200 ' + (y + amp) + ' 300 ' + (y - amp * 0.4) + 'S460 ' + (y + amp * 0.6) + ' 520 ' + y +
          'V' + (y + 26) + 'C420 ' + (y + 20) + ' 300 ' + (y + 30) + ' 200 ' + (y + 22) + 'S60 ' + (y + 28) + ' 0 ' + (y + 24) + 'Z" fill="#ffe4f2" opacity="' + o + '"/>';
        // The Great Wall winding over the far ridges, towers at intervals.
        const wallSegs = [[[150, 300], [190, 282], [222, 300], [256, 288]], [[256, 288], [290, 276], [318, 292], [352, 280]], [[352, 280], [384, 270], [410, 286], [446, 276]]];
        let wallLine = 'M150 300'; let merlons = ''; let towers = '';
        wallSegs.forEach((s, k) => {
          wallLine += 'C' + s[1].join(' ') + ' ' + s[2].join(' ') + ' ' + s[3].join(' ');
          for (let t = 0.04; t < 1; t += 0.12) { const [x, y] = bez(...s, t); merlons += '<rect x="' + n(x - 1.6) + '" y="' + n(y - 4.6) + '" width="3.2" height="3.4"/>'; }
          const [tx, ty] = bez(...s, 0.55); towers += '<path d="M' + n(tx - 5) + ' ' + n(ty + 1) + 'V' + n(ty - 12) + 'H' + n(tx + 5) + 'V' + n(ty + 1) + 'Z"/><path d="M' + n(tx - 7) + ' ' + n(ty - 11) + 'H' + n(tx + 7) + 'L' + n(tx + 4) + ' ' + n(ty - 16) + 'H' + n(tx - 4) + 'Z"/>';
        });
        const wall = '<g opacity=".82"><path d="' + wallLine + '" fill="none" stroke="#6a2c88" stroke-width="3.4"/><g fill="#6a2c88">' + merlons + towers + '</g></g>';
        // Blossom trees on the slopes.
        const tree = (x, y, s, seed) => {
          const r = rng(seed); let crown = '';
          for (let i = 0; i < 9; i++) crown += '<circle cx="' + n(x + (r() - 0.5) * 26 * s) + '" cy="' + n(y - 18 * s - r() * 14 * s) + '" r="' + n((6 + r() * 5) * s) + '" fill="' + ['#ff9cc2', '#ffc2d8', '#f47aa8'][i % 3] + '" opacity=".92"/>';
          return '<path d="M' + x + ' ' + y + 'C' + (x - 1) + ' ' + n(y - 8 * s) + ' ' + (x + 2) + ' ' + n(y - 14 * s) + ' ' + x + ' ' + n(y - 20 * s) + '" stroke="#3a0d2a" stroke-width="' + n(2.6 * s) + '" fill="none"/>' + crown;
        };
        // The rider group, drawn twice: a gold outline under the dark fill gives the moonlit rim.
        // Tail tip to spear tip spans x 330 to 514, clear of the card's write-up.
        const at = inner => '<g transform="translate(369 304) scale(.67)">' + inner + '</g>';
        const sil = '#170520'; const farSil = '#36124a';
        const rim = '<g stroke="#ffd98a" stroke-width="5" stroke-linejoin="round" fill="#ffd98a" opacity=".9">' +
          horse('#ffd98a', '#ffd98a') + spear('#ffd98a', 7.5) + '</g>';
        const riderTone = '#3a1550';
        // Petals swirling on the wind round the rider, in a loose arc.
        const r = rng(911);
        let swirl = '';
        for (let i = 0; i < 26; i++) {
          const t = i / 26; const ang = -0.6 + t * 4.2; const rad = 70 + t * 70 + (r() - 0.5) * 24;
          const x = n(410 + Math.cos(ang) * rad * 1.25); const y = n(196 + Math.sin(ang) * rad * 0.62);
          if (x < 250 || x > 520 || y < 10 || y > 420) continue;
          swirl += petal(x, y, n(r() * 360), n(0.8 + r() * 0.9), n(0.5 + r() * 0.45), ['#ffc2d8', '#ffd9e6', '#ff9cc2'][i % 3]);
        }
        return tint('#3a1460', '#d24f86', 0.55) + stars(311, 50, 120, W, 0, 220) +
          glow('halo', 410, 182, 240, '#ffcf9a', 0.55) + glow('g2', 410, 182, 160, '#ffe7b8', 0.7) +
          '<circle cx="410" cy="182" r="112" fill="' + moonFill + '"/>' +
          '<g fill="#e8c48a" opacity=".32"><circle cx="380" cy="150" r="15"/><circle cx="444" cy="212" r="11"/><circle cx="436" cy="140" r="6"/><circle cx="386" cy="222" r="8"/></g>' +
          // Receding ranges with the valleys' mist between them.
          range('M120 440V262L160 236L192 252L236 214L276 246L318 222L356 244L400 208L446 240L486 220L520 234V440Z', '#b06ab8', '#7a3a9a', 0.55) +
          mist(246, 0.2, 8) +
          range('M120 440V292L170 262L210 284L250 256L296 286L340 262L380 284L428 256L470 282L520 266V440Z', '#8a4aa8', '#5a2378', 0.75) +
          wall + mist(282, 0.18, 10) +
          range('M120 440V330C170 312 214 300 254 310C300 320 336 302 376 296C420 290 470 304 520 298V440Z', '#5c2078', '#3a1352', 0.92) +
          tree(176, 326, 0.9, 41) + tree(214, 316, 0.7, 42) + tree(484, 304, 0.8, 43) +
          mist(312, 0.16, 8) +
          // The near ridge the rider gallops along.
          '<path d="M120 440V378C190 362 250 340 312 322C352 312 392 312 432 316C470 320 498 314 520 310V440Z" fill="' + lin('near', [[0, '#200830'], [1, '#12031c']]) + '"/>' +
          '<path d="M290 326C330 314 380 312 432 316C470 320 498 314 520 310" fill="none" stroke="#ffd98a" stroke-width="1.6" opacity=".4"/>' +
          tree(150, 384, 1.1, 44) + tree(504, 326, 0.9, 45) +
          // Petals behind the rider, then the rider: rim, far legs, silhouette, red cape, tassel, pennant, spearhead.
          swirl +
          at(rim) +
          at(horse(sil, farSil) +
            // Cape and sash behind her, then her own rim and her warmer silhouette.
            '<path d="M104 -156C82 -166 58 -162 34 -174C42 -160 48 -150 42 -140C60 -142 76 -134 90 -136Z" fill="#9a1f45"/>' +
            '<path d="M104 -156C82 -166 58 -162 34 -174" fill="none" stroke="#ff8aa8" stroke-width="1.3" opacity=".75"/>' +
            '<path d="M84 -126C72 -128 62 -122 52 -126C60 -120 66 -116 74 -118C78 -119 82 -121 84 -122Z" fill="#e0304f"/>' +
            rider('#ffd98a', true) + rider(riderTone, false) +
            '<path d="M82 -128L100 -125L99 -120L81 -122Z" fill="#e0304f"/><path d="M82 -128L100 -125" stroke="#ffd98a" stroke-width=".9"/>' +
            spear('#ffd98a', 9.2) + shaft() +
            '<path d="M117 -188C111 -194 104 -194 100 -189C105 -189 110 -187 115 -183Z" fill="#e0304f"/><circle cx="117" cy="-188" r="2.6" fill="#e0304f"/>' +
            spearEnd(blade)) +
          sparkle(486, 104, 9) + sparkle(306, 122, 6) + sparkle(500, 250, 5) + sparkle(336, 64, 5) +
          // Plum blossom framing the top and the right edge.
          '<g fill="none" stroke="#3a0d2a" stroke-linecap="round">' +
            '<path d="M520 30C488 36 462 30 436 42C418 50 400 46 380 56C364 64 344 60 326 70" stroke-width="4.4"/>' +
            '<path d="M462 34C466 22 478 14 490 10M412 48C410 36 400 28 388 26M380 56C378 70 368 80 356 84" stroke-width="2.6"/>' +
            '<path d="M520 64C514 78 513 92 508 104" stroke-width="3.6"/>' +
          '</g>' +
          blossom(330, 68, 0.9) + blossom(356, 84, 0.8, '#ffd0e0') + blossom(382, 56, 1.1) + blossom(388, 26, 0.8, '#ffd0e0') +
          blossom(414, 46, 0.9, '#ffd0e0') + blossom(440, 40, 1.2) + blossom(466, 30, 0.9) + blossom(490, 10, 0.9, '#ffd0e0') + blossom(504, 34, 1.1) +
          blossom(514, 76, 0.9, '#ffd0e0') + blossom(507, 102, 1) +
          bud(348, 62, 1) + bud(400, 36, 1) + bud(452, 26, 0.9) + bud(476, 22, 1) + bud(518, 90, 0.8) +
          scatter(321, 12, (x, y, rr) => petal(x, y, n(rr() * 360), n(0.7 + rr() * 0.6), n(0.35 + rr() * 0.4)), 140, 300, 40, 380) +
          ground('M0 440V422C140 414 300 428 420 420S500 416 520 418V440Z', '#0e0216');
      },
    },
  };
}
