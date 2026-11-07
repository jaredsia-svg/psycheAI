// Odysseus as the Trojan Horse, his own plan (the Odyssey, the Aeneid): a
// powerful wooden war-horse towering at sunset over the
// walls of Troy, with the Greek fleet drawn up on the shining sea and the beach
// behind, men hauling it in by ropes (21 October 2026; it replaced a storm with
// the Cyclops). Loaded into SCENES by tools/character-art.mjs; the emblem is
// mirrored in EMBLEM_PATHS in docs/copy.js as 'horse'.
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, bez, starPath, rng, stars, sparkle, skyline, scatter } = h;
  return {
    scenes: {
    'Odysseus': () => {
      const ink = '#1e0c04';
      const body = lin('body', [[0, '#eab474'], [0.45, '#a6622a'], [1, '#341606']]);
      const neckF = lin('neck', [[0, '#3e1a08'], [0.5, '#a6622a'], [1, '#f2c486']], 0, 0, 1, 0);
      const limbF = lin('limb', [[0, '#2a1004'], [0.5, '#8e5020'], [1, '#dc9e5c']], 0, 0, 1, 0);
      const bronze = lin('bronze', [[0, '#ffe2a0'], [0.5, '#c88a3a'], [1, '#6a4010']]);
      const wall = lin('wall', [[0, '#5a3468'], [1, '#22102e']]);
      const seaF = lin('sea', [[0, '#ffd2a0'], [0.25, '#e48a8a'], [1, '#4a1c62']]);
      const torch = (x, y) => glow('t' + x, x, y, 30, '#ffb04a', 0.9) +
        '<path d="M' + x + ' ' + (y + 4) + 'V' + (y + 22) + '" stroke="#14061c" stroke-width="3"/>' +
        '<path d="M' + x + ' ' + (y - 12) + 'C' + (x - 7) + ' ' + (y - 2) + ' ' + (x - 5) + ' ' + (y + 5) + ' ' + x + ' ' + (y + 5) + 'C' + (x + 5) + ' ' + (y + 5) + ' ' + (x + 7) + ' ' + (y - 2) + ' ' + x + ' ' + (y - 12) + 'Z" fill="#ffd98a"/>';
      const merlons = (x0, x1, y, w = 12, gap = 22, hgt = 12) => { let d = ''; for (let x = x0; x < x1; x += gap) d += 'M' + x + ' ' + y + 'h' + w + 'v-' + hgt + 'h-' + w + 'z'; return d; };
      // A Greek warship: a long curved hull with a high curling stern and a
      // ram at the bow, a row of oars, and a square sail, striped or plain.
      const ship = (x, y, s, striped, o = 1) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" opacity="' + o + '">' +
        '<path d="M-44 -4C-30 6 24 8 40 0L52 -4L46 4C30 14 -26 14 -42 6C-50 2 -54 -10 -50 -20C-48 -12 -46 -8 -44 -4Z" fill="#2a1030"/>' +
        '<path d="M-44 -4C-30 6 24 8 40 0" fill="none" stroke="#ffcf9a" stroke-width="1.4" opacity=".7"/>' +
        '<g stroke="#2a1030" stroke-width="1.4">' + [-30, -20, -10, 0, 10, 20, 30].map(dx => '<path d="M' + dx + ' 6L' + (dx - 6) + ' 16"/>').join('') + '</g>' +
        '<path d="M0 2V-40" stroke="#2a1030" stroke-width="2"/><path d="M-20 -38H20" stroke="#2a1030" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M-18 -37H18L16 -8H-16Z" fill="#fbe8d0"/>' +
        (striped ? '<path d="M-10 -37H-3V-8H-10ZM3 -37H10V-8H3Z" fill="#c2366a"/>' : '<path d="M-18 -37H18L16 -8H-16Z" fill="#e8b890" opacity=".5"/>') +
        '<circle cx="38" cy="0" r="1.6" fill="#fff"/></g>';
      const wheel = (x, y, r) => '<g transform="translate(' + x + ' ' + y + ')"><circle r="' + r + '" fill="#3a1a08" stroke="' + ink + '" stroke-width="3"/>' +
        '<circle r="' + (r - 4) + '" fill="none" stroke="#8a5226" stroke-width="2"/>' +
        Array.from({ length: 8 }, (_, k) => '<path d="M0 0L0 ' + (-(r - 3)) + '" stroke="#7a4418" stroke-width="2.6" transform="rotate(' + k * 45 + ')"/>').join('') +
        '<circle r="5.5" fill="' + bronze + '" stroke="' + ink + '" stroke-width="1.6"/></g>';
      const stud = (x, y, r = 2.4) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + bronze + '" stroke="' + ink + '" stroke-width=".8"/>';
      const figure = (x, y, lean) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + lean + ')" fill="#12061a">' +
        '<circle cx="0" cy="-17" r="3.2"/><path d="M-3 -13H3L4 -2H-4Z"/><path d="M-4 -2L-7 8H-4L-1 0ZM4 -2L7 8H4L1 0Z"/><path d="M2 -11L12 -15" stroke="#12061a" stroke-width="2.2" stroke-linecap="round"/></g>';
      // A limb from a centre line and its widths: each point offset either
      // side along the normal, so joints bend smoothly.
      const limb = (pts, widths) => {
        const left = [], right = [];
        pts.forEach(([x, y], k) => {
          const [ax, ay] = pts[Math.max(0, k - 1)], [bx, by] = pts[Math.min(pts.length - 1, k + 1)];
          const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, w = widths[k] / 2;
          left.push([n(x - dy / len * w), n(y + dx / len * w)]); right.push([n(x + dy / len * w), n(y - dx / len * w)]);
        });
        const all = left.concat(right.reverse());
        return 'M' + all.map(p => p.join(' ')).join('L') + 'Z';
      };
      const leg = (pts, widths, joints, hoof) => '<path d="' + limb(pts, widths) + '" fill="' + limbF + '" stroke="' + ink + '" stroke-width="2.4" stroke-linejoin="round"/>' +
        joints.map(([x, y, r]) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + n(r * 0.8) + '" fill="#6a3612" stroke="' + ink + '" stroke-width="1.6"/>' +
          '<path d="M' + (x - r) + ' ' + (y + r) + 'H' + (x + r) + '" stroke="' + bronze + '" stroke-width="3.4"/>').join('') +
        '<path d="M' + (hoof[0] - 10) + ' ' + hoof[1] + 'H' + (hoof[0] + 10) + 'L' + (hoof[0] + 11) + ' ' + (hoof[1] + 13) + 'H' + (hoof[0] - 11) + 'Z" fill="#2a1206" stroke="' + ink + '" stroke-width="1.6"/>';
      // Mane: carved slats along the crest of the neck, leaning back.
      const crestCurve = [[446, 158], [432, 110], [450, 60], [484, 36]];
      const mane = [0.04, 0.13, 0.22, 0.31, 0.4, 0.49, 0.58, 0.67, 0.76, 0.85, 0.94].map((t, k) => {
        const [x, y] = bez(...crestCurve, t);
        const s = 0.85 + 0.4 * (1 - Math.abs(t - 0.4));
        const tr = 'translate(' + x + ' ' + y + ') rotate(' + n(-24 + t * 44) + ') scale(' + n(s) + ')';
        return '<path transform="' + tr + '" d="M3 -6C-8 -10 -20 -8 -27 2C-18 2 -8 5 3 7Z" fill="' + (k % 2 ? '#7a4216' : '#ac6a2e') + '" stroke="' + ink + '" stroke-width="1.6" stroke-linejoin="round"/>' +
          '<path transform="' + tr + '" d="M0 -3C-8 -5 -15 -4 -21 1" fill="none" stroke="#f4c890" stroke-width="1" opacity=".6"/>';
      }).join('');
      const rays = Array.from({ length: 11 }, (_, k) => '<path d="M440 60L' + n(440 + 420 * Math.cos((k * 17 - 175) * Math.PI / 180) - 14) + ' ' + n(60 + 420 * Math.sin((k * 17 - 175) * Math.PI / 180)) +
        'L' + n(440 + 420 * Math.cos((k * 17 - 170) * Math.PI / 180)) + ' ' + n(60 + 420 * Math.sin((k * 17 - 170) * Math.PI / 180)) + 'Z" fill="#fff0c8" opacity="' + (k % 2 ? '.07' : '.12') + '"/>').join('');
      return tint('#ffa060', '#3a1050', 0.68) + stars(331, 12, 120, W, 0, 80) +
        // The sky on fire behind the head: a halo and god-rays.
        glow('halo', 440, 60, 220, '#ffd08a', 0.85) + rays + glow('halo2', 440, 60, 80, '#fff4d8', 0.7) +
        // The sea at sunset, shining under the sun, and the fleet drawn up on it.
        '<path d="M0 236H520V336H0Z" fill="' + seaF + '"/>' +
        '<path d="M0 236H520" stroke="#fff0d0" stroke-width="2" opacity=".6"/>' +
        '<g fill="#fff4d8">' + [[420, 244, 60], [430, 254, 46], [414, 266, 54], [440, 278, 40], [424, 292, 50], [446, 306, 36]].map(([x, y, w]) => '<rect x="' + (x - w / 2) + '" y="' + y + '" width="' + w + '" height="2" rx="1" opacity=".55"/>').join('') + '</g>' +
        scatter(351, 26, (x, y, r) => '<rect x="' + x + '" y="' + y + '" width="' + n(6 + r() * 14) + '" height="1.4" fill="#fff0d8" opacity="' + n(0.2 + r() * 0.35) + '"/>', 130, W, 244, 330) +
        ship(176, 244, 0.32, false, 0.7) + ship(214, 246, 0.36, true, 0.7) + ship(256, 243, 0.3, false, 0.65) + ship(300, 246, 0.34, true, 0.7) + ship(498, 244, 0.32, false, 0.65) +
        ship(160, 266, 0.55, true, 0.85) + ship(236, 270, 0.6, false, 0.85) + ship(500, 268, 0.55, true, 0.85) +
        ship(196, 300, 0.9, false) + ship(474, 304, 0.95, true) +
        // The beach, ships drawn up on it.
        '<path d="M0 334C120 326 250 318 330 322S440 318 520 316V352H0Z" fill="' + lin('sand', [[0, '#e0a070'], [1, '#7a3e3a']]) + '"/>' +
        '<path d="M0 334C120 326 250 318 330 322S440 318 520 316" fill="none" stroke="#fff0d8" stroke-width="2" opacity=".5"/>' +
        ship(150, 334, 0.7, true) +
        // Troy's walls, low and to one side, with its tower, gate and torches.
        '<path d="M0 440V350H330V440Z" fill="' + wall + '"/><path d="' + merlons(0, 330, 350) + '" fill="#43245a"/>' +
        '<path d="M140 440V312H184V440Z" fill="#331a46"/><path d="' + merlons(140, 184, 312, 9, 16, 10) + '" fill="#331a46"/>' +
        '<g stroke="#12061c" stroke-width="1.4" opacity=".45"><path d="M0 374H330M0 398H330M0 422H330"/><path d="M130 350V374M220 374V398M260 350V374M300 398V422"/></g>' +
        '<path d="M214 440V398A24 24 0 0 1 262 398V440Z" fill="#12051c"/><path d="M214 398A24 24 0 0 1 262 398" fill="none" stroke="#6a4878" stroke-width="4"/>' +
        torch(162, 296) + torch(206, 334) + torch(300, 334) +
        ground('M0 440V412C120 406 250 416 370 410S480 406 520 408V440Z', '#16081e') +
        // ---- the horse ----
        // A powerful war-horse: a deep chest pushing forward, strong shoulders
        // and hindquarters shaped by curved plank panels, a tucked belly, a
        // thick crested neck, the head high, all four hooves planted.
        '<g transform="translate(-26 10) scale(.94)">' +
        '<ellipse cx="408" cy="410" rx="120" ry="9" fill="#0a0410" opacity=".6"/>' +
        // Heavy platform and wheels.
        '<path d="M296 362H520V384H296Z" fill="#4a2410" stroke="' + ink + '" stroke-width="3"/>' +
        '<path d="M296 368H520" stroke="#d89a58" stroke-width="1.4" opacity=".5"/>' +
        [312, 340, 476, 504].map(x => stud(x, 374, 2.8)).join('') +
        wheel(318, 394, 20) + wheel(370, 394, 20) + wheel(452, 394, 20) + wheel(502, 394, 20) +
        // Far legs, in shadow.
        '<g opacity=".8">' +
          leg([[346, 222], [340, 268], [348, 300], [346, 350]], [32, 22, 17, 16], [[346, 300, 8]], [344, 349]) +
          leg([[458, 230], [460, 290], [460, 350]], [28, 19, 17], [[458, 290, 8]], [458, 349]) +
        '</g>' +
        // Tail of hanging slats.
        '<g stroke="' + ink + '" stroke-width="1.6" stroke-linejoin="round"><path d="M310 166C292 188 286 228 292 270L300 267C296 230 302 196 316 174Z" fill="#6a3612"/>' +
          '<path d="M314 172C302 198 302 232 308 264L315 260C311 232 313 202 320 180Z" fill="#9a5a24"/></g>' +
        // Near hind leg: thigh, hock, cannon.
        leg([[328, 210], [318, 262], [330, 302], [326, 350]], [46, 28, 19, 17], [[328, 300, 9]], [324, 349]) +
        // The body.
        '<path d="M304 182C302 158 318 144 344 144C372 142 392 150 418 150C438 148 452 142 466 146C496 154 516 176 518 200C520 222 506 238 484 240C460 240 446 230 428 226C410 222 390 222 372 226C356 230 346 240 330 240C312 240 304 214 304 182Z" fill="' + body + '" stroke="' + ink + '" stroke-width="3" stroke-linejoin="round"/>' +
        // Curved plank panels: the shoulder and the hindquarter muscles.
        '<g fill="none" stroke="' + ink + '" stroke-width="1.6" opacity=".6"><path d="M452 150C440 180 444 214 470 238M470 150C462 180 468 210 494 234"/>' +
          '<path d="M372 148C362 176 360 206 372 226M346 146C318 160 314 206 330 238"/>' +
          '<path d="M376 172C400 170 420 172 446 176M378 200C400 198 424 200 444 204"/></g>' +
        '<g fill="none" stroke="#ffe0a8" stroke-width="2" opacity=".55" stroke-linecap="round"><path d="M484 162C500 174 508 190 508 206"/><path d="M330 154C318 168 314 190 318 208"/><path d="M470 158C462 178 464 198 474 214"/></g>' +
        // Bronze girth band, studs, and the hatch.
        '<path d="M430 150C426 180 426 206 430 228" fill="none" stroke="' + bronze + '" stroke-width="6"/>' +
        [162, 180, 198, 216].map(y => stud(429, y)).join('') +
        '<path d="M384 176H420V202H384Z" fill="#5a2c10" stroke="' + ink + '" stroke-width="2.2"/>' +
        '<path d="M387 189H417" stroke="' + ink + '" stroke-width="1.1" opacity=".6"/>' +
        '<path d="M384 180H392M384 198H392" stroke="' + bronze + '" stroke-width="3"/><circle cx="416" cy="189" r="2.4" fill="' + bronze + '"/>' +
        // Belly shadow, and the sunset's rim of light along the back.
        '<path d="M380 222C400 218 420 220 440 228L436 236C420 228 400 226 384 230Z" fill="#0e0408" opacity=".35"/>' +
        '<path d="M322 148C350 142 392 152 418 150C440 148 452 142 466 146" fill="none" stroke="#ffe2a8" stroke-width="3" opacity=".7" stroke-linecap="round"/>' +
        // Near foreleg, planted straight on the platform.
        leg([[490, 226], [494, 262], [496, 292], [496, 350]], [36, 24, 18, 16], [[496, 292, 9]], [496, 349]) +
        // The neck: thick, arched and crested.
        '<path d="M440 160C428 110 446 62 482 36L510 44C514 72 512 116 518 178C496 190 458 184 440 160Z" fill="' + neckF + '" stroke="' + ink + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<g stroke="' + ink + '" stroke-width="1.4" opacity=".55" fill="none"><path d="M440 142C460 148 488 148 514 140M438 114C458 120 484 120 510 112M446 86C464 92 486 92 510 84M462 60C478 64 494 64 508 58"/></g>' +
        '<path d="M466 66C462 96 466 130 476 160" fill="none" stroke="#ffe0a8" stroke-width="1.8" opacity=".5"/>' +
        // The head, held high: strong jaw, pricked ears, flared nostril.
        '<path d="M488 34L490 12L500 30Z" fill="#8a4e1e" stroke="' + ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M478 38L477 18L488 32Z" fill="#6a3612" stroke="' + ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M476 40C484 28 500 22 514 26C528 32 542 48 552 64C556 72 552 82 542 84L528 84C516 82 508 76 502 68C496 62 490 60 482 60Z" fill="' + neckF + '" stroke="' + ink + '" stroke-width="2.8" stroke-linejoin="round"/>' +
        '<path d="M486 58C494 70 506 74 516 74" fill="none" stroke="' + ink + '" stroke-width="1.6" opacity=".7"/>' +
        '<path d="M532 78C538 80 544 80 548 76" fill="none" stroke="' + ink + '" stroke-width="1.8"/><ellipse cx="544" cy="70" rx="2.6" ry="1.8" fill="' + ink + '"/>' +
        '<path d="M496 34C500 32 506 32 510 34" fill="none" stroke="' + ink + '" stroke-width="1.6"/>' +
        '<ellipse cx="505" cy="39" rx="3.6" ry="3" fill="#120408"/><circle cx="506.2" cy="38" r="1.1" fill="#ffd98a"/>' +
        '<path d="M496 48L530 64" stroke="' + bronze + '" stroke-width="3"/>' + stud(512, 56, 2) +
        // Rim of sunset light down the face, the throat and the chest.
        '<path d="M514 26C528 32 542 48 552 64M510 44C514 72 512 116 518 178C520 192 520 204 518 214" fill="none" stroke="#ffe2a8" stroke-width="2.8" opacity=".75" stroke-linecap="round"/>' +
        mane +
        // Ropes from its chest down to the men hauling it in.
        '<path d="M510 214C486 258 430 312 332 346" fill="none" stroke="#c8a070" stroke-width="2.2"/>' +
        '<path d="M506 226C486 272 450 324 386 352" fill="none" stroke="#c8a070" stroke-width="2"/>' +
        '<g transform="translate(0 0)">' + figure(334, 356, -14) + figure(352, 356, -12) + figure(388, 358, -16) + figure(404, 358, -10) + '</g>' +
        '</g>' +
        // Firelight from the torches on its near flank.
        glow('fire', 300, 260, 70, '#ff9a3a', 0.3) +
        // Embers and dust in the air.
        scatter(341, 46, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(0.8 + r() * 2.2) + '" fill="' + (r() > 0.45 ? '#ffb04a' : '#fff0c8') + '" opacity="' + n(0.3 + r() * 0.6) + '"/>', 170, W, 20, 360) +
        sparkle(300, 60, 8) + sparkle(372, 110, 5) + sparkle(250, 170, 6);
    },
    },
    emblems: { 'Odysseus': '<path d="M10 20c0-3 2-5 5-5h14l5-10h5l3 2-3 5-5 2-2 14H10z" fill="currentColor" fill-opacity=".18"/><path d="M10 20c0-3 2-5 5-5h14l5-10h5l3 2-3 5-5 2-2 14H10z"/><path d="M12 28v8M18 28v8M27 28v8M32 28v8"/><path d="M8 36h28"/><circle cx="12" cy="41" r="3"/><circle cx="32" cy="41" r="3"/><path d="M8 20l-3 8"/><path d="M18 19h8v6h-8z"/>' },
  };
}
