// Reserve scenes, batch E: the Gingerbread Man, drawn from the folk tale's own
// things, never a likeness or a later film's look. (The Tin Man, drawn here
// first, went live in WALL-E's place: tools/art/tinman.mjs.)
export default function (h) {
  const { W, n, lin, rad, glow, tint, ground, stars, sparkle, scatter } = h;

  // A rounded tree for the dusk forest, around its foot.
  const tree = (x, y, s, fill) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '">' +
    '<rect x="-4" y="-40" width="8" height="40"/><circle cx="0" cy="-58" r="26"/><circle cx="-18" cy="-44" r="18"/><circle cx="18" cy="-46" r="19"/></g>';

  return {
    scenes: {
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
      // A gingerbread figure mid-run.
      'The Gingerbread Man': '<circle cx="24" cy="10" r="6" fill="currentColor" fill-opacity=".18"/><circle cx="24" cy="10" r="6"/><path d="M18 18h12l10-4c3-1 4 3 1 4l-9 5 2 9 6 8c2 2-1 5-3 3l-7-8-7 8c-2 2-5-1-3-3l6-8 2-9-9-5c-3-1-2-5 1-4z" fill="currentColor" fill-opacity=".18"/><path d="M18 18h12l10-4c3-1 4 3 1 4l-9 5 2 9 6 8c2 2-1 5-3 3l-7-8-7 8c-2 2-5-1-3-3l6-8 2-9-9-5c-3-1-2-5 1-4z"/><circle cx="24" cy="24" r="1.2" fill="currentColor" stroke="none"/><circle cx="24" cy="29" r="1.2" fill="currentColor" stroke="none"/>',
    },
  };
}
