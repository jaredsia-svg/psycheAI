// Reserve scenes, batch E: the Tin Man and the Gingerbread Man. Drawn from the
// public-domain stories' own things (Baum's 1900 book: the tin axe, the oil can,
// the heart the Wizard gives; the folk tale's runaway biscuit), never a
// likeness or a later film's look.
export default function (h) {
  const { W, n, lin, rad, glow, tint, ground, stars, sparkle, scatter } = h;

  // A rounded tree for the dusk forest, around its foot.
  const tree = (x, y, s, fill) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '">' +
    '<rect x="-4" y="-40" width="8" height="40"/><circle cx="0" cy="-58" r="26"/><circle cx="-18" cy="-44" r="18"/><circle cx="18" cy="-46" r="19"/></g>';

  return {
    scenes: {
      // The heart the Wizard gave him, red velvet and glowing, over a gleaming
      // tin axe and an oil can, in the forest by the yellow road at dusk.
      'The Tin Man': () => {
        const tin = lin('tin', [[0, '#f4f6ff'], [0.45, '#b8c0d8'], [0.55, '#8a92ae'], [1, '#d8def0']], 0, 0, 1, 0);
        const tinV = lin('tinv', [[0, '#f4f6ff'], [0.5, '#a8b0cc'], [1, '#6a7290']]);
        const velvet = rad('velvet', [[0, '#ff6a7a'], [0.6, '#d0203a'], [1, '#8a0c22']], 0.4, 0.35);
        const road = lin('road', [[0, '#ffd86a'], [1, '#d89a2a']]);
        const heart = 'M0 22C-26 4 -40 -10 -40 -26C-40 -40 -30 -48 -18 -48C-8 -48 -2 -42 0 -36C2 -42 8 -48 18 -48C30 -48 40 -40 40 -26C40 -10 26 4 0 22Z';
        return tint('#3a1a5a', '#c4508f', 0.6) + stars(511, 30, 120, W, 0, 170) +
          // The forest: a far row in the haze, a nearer row darker.
          '<g opacity=".45">' + [150, 200, 250, 300, 350, 410, 460, 510].map((x, i) => tree(x, 330 + (i % 2) * 8, 0.9 + (i % 3) * 0.15, '#4a2a6a')).join('') + '</g>' +
          '<g opacity=".85">' + tree(180, 372, 1.3, '#2a0f40') + tree(260, 360, 1.05, '#2a0f40') + tree(500, 366, 1.25, '#2a0f40') + '</g>' +
          // The yellow road, winding off into the trees.
          '<path d="M520 440V404C470 396 430 384 400 368C376 356 356 350 330 348L300 350C330 356 352 366 372 380C404 400 452 420 470 440Z" fill="' + road + '"/>' +
          '<g stroke="#b9781e" stroke-width="1.6" opacity=".45"><path d="M330 352L336 348M356 360L364 356M384 374L394 370M418 392L430 386M456 410L470 402"/></g>' +
          // The heart, glowing.
          glow('hglow', 404, 124, 150, '#ff8a9a', 0.8) +
          '<g transform="translate(404 134) scale(1.25)">' +
            '<path d="' + heart + '" fill="' + velvet + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
            '<path d="M-26 -30C-24 -38 -14 -42 -6 -36" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/>' +
            '<g fill="#ffd0d8" opacity=".55">' + [[-14, -10], [10, -18], [20, -4], [-2, 6], [-24, -18]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="1.6"/>').join('') + '</g>' +
            // The silk it hangs from.
            '<path d="M0 -36V-78" stroke="#ffe0a0" stroke-width="2" opacity=".8"/></g>' +
          // The axe, leaning, its tin head catching the light.
          '<g transform="translate(330 290) rotate(-18)">' +
            '<rect x="-5" y="-110" width="10" height="150" rx="4" fill="' + lin('haft', [[0, '#c9894a'], [1, '#6a3a1a']], 0, 0, 1, 0) + '" stroke="#3a1a0a" stroke-width="2"/>' +
            // A woodman's axe: one broad, curved blade.
            '<path d="M4 -112L22 -116C34 -126 52 -124 58 -112C62 -98 60 -82 54 -70C44 -76 30 -80 22 -78L4 -82Z" fill="' + tin + '" stroke="#4a4f6a" stroke-width="2.4" stroke-linejoin="round"/>' +
            '<rect x="-8" y="-114" width="14" height="34" rx="3" fill="' + tinV + '" stroke="#4a4f6a" stroke-width="2.4"/>' +
            '<path d="M50 -118C58 -106 58 -88 52 -76" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/></g>' +
          // The oil can, its long spout lifted.
          '<g transform="translate(470 330)">' +
            '<path d="M-26 0C-26 -22 -18 -32 0 -32C18 -32 26 -22 26 0V18C26 24 20 28 14 28H-14C-20 28 -26 24 -26 18Z" fill="' + tinV + '" stroke="#4a4f6a" stroke-width="2.4"/>' +
            '<path d="M-10 -32V-40H10V-32" fill="' + tinV + '" stroke="#4a4f6a" stroke-width="2.4"/>' +
            '<path d="M-22 -8L-74 -52" stroke="#6a7290" stroke-width="6" stroke-linecap="round"/><path d="M-22 -8L-74 -52" stroke="#d8def0" stroke-width="2.4" stroke-linecap="round"/>' +
            '<path d="M26 -16C42 -16 46 4 30 10" fill="none" stroke="#4a4f6a" stroke-width="5" stroke-linecap="round"/>' +
            '<path d="M-14 -22C-12 -26 -6 -28 0 -28" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>' +
            '<circle cx="-78" cy="-48" r="3.4" fill="#ffd86a"/></g>' +
          ground('M0 440V412C110 402 230 418 340 410S470 404 520 408V440Z', '#1c0a2e') +
          sparkle(300, 70, 8) + sparkle(486, 210, 9) + sparkle(460, 60, 6) + sparkle(352, 196, 5);
      },

      // The runaway biscuit mid-run down a country lane, past the cottage with
      // its oven chimney smoking, toward the river: "Run, run, as fast as you can!"
      'The Gingerbread Man': () => {
        const ginger = lin('ginger', [[0, '#e8a45a'], [1, '#a85a24']], 0, 0, 1, 1);
        const lane = lin('lane', [[0, '#f0c890'], [1, '#c8945a']]);
        const icing = '#fff';
        return tint('#ffb070', '#c4508f', 0.55) + glow('sun', 420, 120, 190, '#ffe0a0', 0.8) +
          '<circle cx="420" cy="120" r="56" fill="' + lin('sunf', [[0, '#fff4d0'], [1, '#ffc46a']]) + '"/>' +
          // Hills and the river.
          '<path d="M0 440V320C90 300 190 316 280 304S440 290 520 300V440Z" fill="#7aa85a"/>' +
          '<path d="M380 316C420 312 470 314 520 318V340C470 334 420 334 380 330Z" fill="' + lin('river', [[0, '#9adcff'], [1, '#4a8ad0']], 0, 0, 1, 0) + '"/>' +
          '<path d="M400 322H440M470 326H500" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>' +
          // The cottage behind, its oven chimney smoking.
          '<g transform="translate(296 300)">' +
            '<rect x="-30" y="-34" width="60" height="38" fill="#fff4e4"/><path d="M-38 -32L0 -62L38 -32Z" fill="#c2366a"/>' +
            '<rect x="14" y="-66" width="10" height="22" fill="#8a4a3a"/><rect x="-6" y="-20" width="12" height="24" rx="2" fill="#8a4a3a"/>' +
            '<rect x="-24" y="-24" width="12" height="10" fill="#ffd86a"/></g>' +
          '<path d="M315 230C306 214 324 206 314 190S326 170 318 156" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".45"/>' +
          // The lane, sweeping out toward the river.
          '<path d="M180 440C230 400 300 370 360 352C400 340 430 334 470 332L476 340C440 344 410 352 380 364C320 388 270 414 250 440Z" fill="' + lane + '"/>' +
          // The runner, in mid-stride, arms flung out.
          '<g transform="translate(380 236) rotate(8)">' +
            '<g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"><path d="M-74 -10H-46M-82 10H-50M-70 30H-44"/></g>' +
            '<path d="M0 -60C14 -60 22 -50 22 -38C22 -30 18 -24 12 -20L40 -30C50 -33 56 -20 46 -14L16 -2L22 30L40 54C46 62 34 70 28 62L6 36L-14 60C-20 68 -32 60 -26 52L-10 28L-14 -2L-42 -14C-52 -20 -46 -33 -36 -30L-12 -20C-18 -24 -22 -30 -22 -38C-22 -50 -14 -60 0 -60Z" fill="' + ginger + '" stroke="#7a3a14" stroke-width="2.4" stroke-linejoin="round"/>' +
            // Icing: the wavy trim on the arms and legs, the eyes, the smile, the buttons.
            '<g fill="none" stroke="' + icing + '" stroke-width="3" stroke-linecap="round"><path d="M34 -26l3 4 3-4 3 4M-34 -26l-3 4 -3-4 -3 4M30 56l4 -3 2 4 4 -3M-20 56l-4 -3 -2 4 -4 -3"/>' +
              '<path d="M-8 -32C-4 -27 4 -27 8 -32"/></g>' +
            '<g fill="' + icing + '"><circle cx="-7" cy="-42" r="3.2"/><circle cx="7" cy="-42" r="3.2"/><circle cx="2" cy="-4" r="3.4"/><circle cx="3" cy="10" r="3.4"/></g>' +
            '<g fill="#ff5a7a"><circle cx="-12" cy="-34" r="2.6" opacity=".6"/><circle cx="12" cy="-34" r="2.6" opacity=".6"/></g></g>' +
          // Crumbs flying from his heels.
          scatter(611, 10, (x, y, r) => '<rect x="' + x + '" y="' + y + '" width="' + n(3 + r() * 3) + '" height="' + n(3 + r() * 3) + '" rx="1" fill="#c8823a" opacity=".85" transform="rotate(' + n(r() * 90) + ' ' + x + ' ' + y + ')"/>', 300, 360, 280, 330) +
          ground('M0 440V418C110 410 230 424 340 416S470 410 520 414V440Z', '#3a1a2a') +
          sparkle(470, 220, 8) + sparkle(320, 160, 6) + sparkle(500, 60, 7);
      },
    },

    emblems: {
      // A heart with a little tin axe.
      'The Tin Man': '<path d="M24 40C12 32 6 25 6 17c0-6 4-10 9-10 4 0 7 3 9 6 2-3 5-6 9-6 5 0 9 4 9 10 0 8-6 15-18 23z" fill="currentColor" fill-opacity=".18"/><path d="M24 40C12 32 6 25 6 17c0-6 4-10 9-10 4 0 7 3 9 6 2-3 5-6 9-6 5 0 9 4 9 10 0 8-6 15-18 23z"/><path d="M36 30l8 14"/><path d="M38 33c3-3 7-3 8 0-3 1-5 3-6 5z" fill="currentColor" fill-opacity=".45"/>',
      // A gingerbread figure mid-run.
      'The Gingerbread Man': '<circle cx="24" cy="10" r="6" fill="currentColor" fill-opacity=".18"/><circle cx="24" cy="10" r="6"/><path d="M18 18h12l10-4c3-1 4 3 1 4l-9 5 2 9 6 8c2 2-1 5-3 3l-7-8-7 8c-2 2-5-1-3-3l6-8 2-9-9-5c-3-1-2-5 1-4z" fill="currentColor" fill-opacity=".18"/><path d="M18 18h12l10-4c3-1 4 3 1 4l-9 5 2 9 6 8c2 2-1 5-3 3l-7-8-7 8c-2 2-5-1-3-3l6-8 2-9-9-5c-3-1-2-5 1-4z"/><circle cx="24" cy="24" r="1.2" fill="currentColor" stroke="none"/><circle cx="24" cy="29" r="1.2" fill="currentColor" stroke="none"/>',
    },
  };
}
