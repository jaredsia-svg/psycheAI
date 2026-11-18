// Reserve scenes, batch A: Joan of Arc, Athena, Belle, Alice, Cinderella.
// Drawn from the public-domain stories' own things (a banner, an owl, a rose,
// a pocket watch, a glass slipper), never a likeness or a later film's look.
export default function (h) {
  const { W, n, lin, rad, glow, tint, ground, starPath, stars, sparkle, scatter } = h;

  // A fleur-de-lis around the origin, about 24 tall.
  const fleur = (x, y, s, fill) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '">' +
    '<path d="M0 -14C5 -9 6 -3 2 3H-2C-6 -3 -5 -9 0 -14Z"/>' +
    '<path d="M-2 3C-6 -2 -12 -3 -13 2C-14 7 -9 9 -6 6C-7 4 -6 2 -4 3Z"/>' +
    '<path d="M2 3C6 -2 12 -3 13 2C14 7 9 9 6 6C7 4 6 2 4 3Z"/>' +
    '<rect x="-6" y="3" width="12" height="3" rx="1.2"/><path d="M-2 6H2L1 12H-1Z"/></g>';

  // A rose head around the origin, petals spiralling in.
  const rose = (x, y, s, dark, mid, light) => '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
    '<path d="M-30 4C-34 -18 -16 -32 0 -30C18 -32 34 -16 30 4C26 24 12 32 0 32C-12 32 -26 24 -30 4Z" fill="' + dark + '"/>' +
    '<path d="M-24 0C-24 -16 -10 -24 2 -22C16 -22 26 -10 22 4C18 18 8 24 -2 24C-14 22 -22 14 -24 0Z" fill="' + mid + '"/>' +
    '<path d="M-14 -2C-14 -12 -4 -16 4 -14C12 -12 16 -4 12 4C8 12 0 14 -6 12C-12 10 -14 6 -14 -2Z" fill="' + dark + '" opacity=".55"/>' +
    '<path d="M-8 -2C-6 -8 2 -10 6 -6C10 -2 8 4 2 6C-4 6 -8 2 -8 -2Z" fill="' + light + '"/>' +
    '<path d="M-2 -2C0 -5 4 -4 4 -1" fill="none" stroke="' + dark + '" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M-24 -4C-18 -20 -2 -24 10 -18" fill="none" stroke="' + light + '" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>' +
    '<path d="M16 -22C26 -16 30 -6 28 4" fill="none" stroke="' + light + '" stroke-width="2" stroke-linecap="round" opacity=".4"/></g>';

  const leaf = (x, y, a, s, fill) => '<path transform="translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + s + ')" d="M0 0C6 -10 18 -12 26 -8C20 0 10 4 0 0Z" fill="' + fill + '"/>';

  return {
    scenes: {
      // A white banner sown with gold fleurs-de-lis streaming from a lance,
      // a sword planted before the towers of Orléans as the sun comes up.
      'Joan of Arc': () => {
        const cloth = lin('cloth', [[0, '#ffffff'], [1, '#e9dcf5']], 0, 0, 1, 1);
        const gold = lin('gold', [[0, '#fff0b0'], [1, '#e0a12e']]);
        const banner = 'M330 70C370 52 404 84 442 70S500 52 516 62L506 156C486 146 462 162 432 170S372 160 336 176Z';
        const tower = (x, base, w, hgt, roof) => '<rect x="' + x + '" y="' + (base - hgt) + '" width="' + w + '" height="' + hgt + '"/>' +
          '<path d="M' + (x - 4) + ' ' + (base - hgt) + 'L' + (x + w / 2) + ' ' + (base - hgt - roof) + 'L' + (x + w + 4) + ' ' + (base - hgt) + 'Z"/>';
        return tint('#ffb07a', '#6a2a8a', 0.55) + stars(501, 18, 140, W, 0, 90) +
          glow('sun', 400, 250, 200, '#ffe2a6', 0.8) +
          '<circle cx="400" cy="262" r="62" fill="' + lin('disc', [[0, '#fff6d8'], [1, '#ffb86a']]) + '"/>' +
          '<g fill="#fff" opacity=".22"><path d="M400 262L240 60L270 54ZM400 262L520 120V160ZM400 262L180 220V246Z"/></g>' +
          // the towers and bridge of Orléans, far off
          '<g fill="#4a1a5e" opacity=".85">' + tower(250, 360, 26, 64, 30) + tower(292, 360, 18, 40, 22) + tower(452, 360, 30, 80, 34) + tower(494, 360, 22, 52, 26) +
            '<rect x="236" y="330" width="290" height="30"/></g>' +
          '<g fill="#ffd27a" opacity=".6"><rect x="259" y="310" width="4" height="7"/><rect x="463" y="300" width="4" height="7"/><rect x="503" y="324" width="4" height="7"/></g>' +
          '<path d="M232 372C262 352 292 352 322 372M322 372C352 352 382 352 412 372M412 372C442 352 472 352 502 372" fill="none" stroke="#4a1a5e" stroke-width="10"/>' +
          '<rect x="220" y="372" width="300" height="20" fill="' + lin('river', [[0, '#ffb07a', 0.6], [1, '#6a2a8a', 0.8]]) + '"/>' +
          // the lance and banner
          '<path d="M332 410L322 40" stroke="#5a2e14" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M322 40L314 22L322 8L330 22Z" fill="' + gold + '" stroke="#fff" stroke-width="2"/>' +
          '<path d="' + banner + '" fill="' + cloth + '" stroke="#fff" stroke-width="2"/>' +
          '<path d="M340 160C372 148 400 156 432 150" fill="none" stroke="#c9b4e0" stroke-width="3" opacity=".7"/>' +
          fleur(368, 106, 1, gold) + fleur(420, 112, 0.95, gold) + fleur(476, 96, 0.9, gold) + fleur(396, 146, 0.7, gold) + fleur(452, 146, 0.7, gold) +
          '<path d="' + banner + '" fill="none" stroke="#e0a12e" stroke-width="3" opacity=".55"/>' +
          // the sword, planted in the ground
          '<g transform="translate(456 392) rotate(4)">' +
            '<path d="M-6 0V-120L0 -134L6 -120V0Z" fill="' + lin('blade', [[0, '#ffffff'], [0.5, '#f1eeff'], [0.5, '#c9c0ee'], [1, '#e9e4ff']], 0, 0, 1, 0) + '" stroke="#fff" stroke-width="1.5"/>' +
            '<rect x="-26" y="-124" width="52" height="9" rx="4.5" fill="' + gold + '" stroke="#7a4a10" stroke-width="1.5"/>' +
            '<rect x="-4.5" y="-152" width="9" height="28" rx="3" fill="#6a2a1a"/>' +
            '<circle cx="0" cy="-158" r="8" fill="' + gold + '" stroke="#7a4a10" stroke-width="1.5"/></g>' +
          ground('M0 440V392C110 380 220 396 330 388S460 380 520 386V440Z', '#2a0b3d') +
          '<g fill="#2a0b3d">' + [240, 262, 286, 500].map(x => '<path d="M' + x + ' 392l3 -14l3 14z"/>').join('') + '</g>' +
          scatter(502, 10, (x, y, r) => '<path d="M' + x + ' ' + y + 'q4 -4 8 0q4 -4 8 0" fill="none" stroke="#4a1a5e" stroke-width="1.8" opacity="' + n(0.5 + r() * 0.4) + '"/>', 160, 300, 40, 200) +
          sparkle(300, 196, 8) + sparkle(498, 220, 7);
      },

      // An owl on an olive branch before the full moon, a temple on the hill
      // below, a round shield and spear resting against its steps.
      'Athena': () => {
        const marble = lin('marble', [[0, '#f6f0ff'], [1, '#b9a6dc']]);
        const cols = [0, 1, 2, 3, 4, 5].map(i => {
          const x = 300 + i * 34;
          return '<rect x="' + x + '" y="308" width="16" height="66" fill="' + marble + '"/><rect x="' + (x - 3) + '" y="304" width="22" height="6" fill="#e9e0fa"/>';
        }).join('');
        const owlBody = lin('owl', [[0, '#c9a27a'], [1, '#6e4a2e']]);
        const olive = (x, y) => '<ellipse cx="' + x + '" cy="' + y + '" rx="5" ry="6.5" fill="#3a2a5a"/><ellipse cx="' + (x - 1.5) + '" cy="' + (y - 2) + '" rx="1.6" ry="2" fill="#fff" opacity=".45"/>';
        return tint('#3b2a8a', '#c4508f', 0.55) + stars(511, 44, 120, W, 0, 220) +
          glow('moon', 400, 128, 170, '#fff4d6', 0.6) +
          '<circle cx="400" cy="128" r="84" fill="' + rad('moonf', [[0, '#fffaf0'], [1, '#e8dcc0']], 0.4, 0.35) + '"/>' +
          '<circle cx="372" cy="108" r="10" fill="#d8ccb0" opacity=".5"/><circle cx="430" cy="160" r="7" fill="#d8ccb0" opacity=".5"/>' +
          // the hill and temple
          '<path d="M150 440V392C240 360 330 372 400 366S500 356 520 360V440Z" fill="#4a1a6a"/>' +
          '<g opacity=".95"><path d="M286 304L384 266L482 304Z" fill="' + marble + '" stroke="#fff" stroke-width="2"/>' +
            '<path d="M384 274L344 294H424Z" fill="#b9a6dc" opacity=".7"/>' +
            '<rect x="284" y="300" width="200" height="6" fill="#fff"/>' + cols +
            '<rect x="282" y="374" width="204" height="7" fill="#e9e0fa"/><rect x="274" y="381" width="220" height="7" fill="#cfc0ec"/></g>' +
          // shield and spear against the steps
          '<path d="M246 400L276 150" stroke="#6a3a1a" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M276 150L270 126L284 132Z" fill="#e0c060" stroke="#fff" stroke-width="1.5"/>' +
          '<circle cx="262" cy="372" r="34" fill="' + lin('shield', [[0, '#ffe39a'], [1, '#c9861f']]) + '" stroke="#fff" stroke-width="3"/>' +
          '<circle cx="262" cy="372" r="24" fill="none" stroke="#8a5a1a" stroke-width="2.4"/>' +
          '<path d="' + starPath(8, 13, 6) + '" transform="translate(262 372)" fill="#8a5a1a" opacity=".55"/>' +
          // the olive branch and the owl on it
          '<path d="M230 238C300 222 380 226 470 206C490 202 506 196 520 188" fill="none" stroke="#5a3a24" stroke-width="7" stroke-linecap="round"/>' +
          leaf(262, 232, -20, 1, '#7ab06a') + leaf(296, 226, 160, 0.9, '#5a9a52') + leaf(312, 230, -30, 0.9, '#8ac27a') +
          leaf(460, 208, 150, 1, '#5a9a52') + leaf(480, 202, -40, 0.9, '#8ac27a') + leaf(500, 194, 170, 0.8, '#7ab06a') +
          olive(284, 244) + olive(474, 218) + olive(494, 212) +
          '<g transform="translate(390 176)">' +
            '<path d="M-38 30C-44 -4 -34 -40 -24 -52L-14 -40C-6 -44 6 -44 14 -40L24 -52C34 -40 44 -4 38 30C30 52 -30 52 -38 30Z" fill="' + owlBody + '" stroke="#fff" stroke-width="2.5"/>' +
            '<path d="M-26 0C-22 24 -12 40 0 42C12 40 22 24 26 0C18 10 -18 10 -26 0Z" fill="#f4e2c4" opacity=".9"/>' +
            '<g fill="none" stroke="#a07a54" stroke-width="2" stroke-linecap="round"><path d="M-10 18q3 3 6 0M4 18q3 3 6 0M-6 28q3 3 6 0M2 30q3 3 6 0"/></g>' +
            '<circle cx="-15" cy="-18" r="14" fill="#fff8e6"/><circle cx="15" cy="-18" r="14" fill="#fff8e6"/>' +
            '<circle cx="-15" cy="-18" r="8" fill="#f0b030"/><circle cx="15" cy="-18" r="8" fill="#f0b030"/>' +
            '<circle cx="-15" cy="-18" r="4.5" fill="#2a1a10"/><circle cx="15" cy="-18" r="4.5" fill="#2a1a10"/>' +
            '<circle cx="-13" cy="-20" r="1.6" fill="#fff"/><circle cx="17" cy="-20" r="1.6" fill="#fff"/>' +
            '<path d="M-4 -8L0 2L4 -8Z" fill="#e0a12e"/>' +
            '<path d="M-38 6C-48 20 -46 36 -36 44M38 6C48 20 46 36 36 44" fill="none" stroke="#5a3a24" stroke-width="3" stroke-linecap="round"/>' +
            '<path d="M-14 48l-3 8M-8 48v9M8 48v9M14 48l3 8" stroke="#e0a12e" stroke-width="3" stroke-linecap="round"/></g>' +
          sparkle(486, 290, 8) + sparkle(250, 80, 7) + sparkle(500, 70, 6);
      },

      // A single red rose, the one the merchant picked, glowing over a
      // moonlit castle in a winter wood, a gold ring at its foot.
      'Belle': () => {
        const stone = lin('stone', [[0, '#4a2a6a'], [1, '#1c0f3a']]);
        const keep = (x, base, w, hgt) => '<rect x="' + x + '" y="' + (base - hgt) + '" width="' + w + '" height="' + hgt + '"/>' +
          Array.from({ length: Math.floor(w / 8) }, (_, i) => '<rect x="' + (x + i * 8) + '" y="' + (base - hgt - 6) + '" width="5" height="6"/>').join('');
        return tint('#2b2d7a', '#c4508f', 0.55) + stars(521, 40, 120, W, 0, 200) +
          glow('g', 392, 150, 170, '#ffc2d6', 0.75) +
          // the castle, square and old, with lit windows
          '<g fill="' + stone + '">' + keep(268, 380, 40, 90) + keep(306, 380, 120, 60) + keep(424, 380, 46, 120) + keep(468, 380, 52, 74) + '</g>' +
          '<g fill="#ffd27a" opacity=".8"><rect x="282" y="316" width="6" height="10" rx="3"/><rect x="438" y="290" width="6" height="10" rx="3"/><rect x="452" y="320" width="6" height="10" rx="3"/><rect x="340" y="344" width="8" height="12" rx="4"/><rect x="488" y="330" width="6" height="10" rx="3"/></g>' +
          '<path d="M354 380V362A12 12 0 0 1 378 362V380Z" fill="#ffcf7a" opacity=".9"/>' +
          // snowy wood
          '<g fill="#1c0f3a">' + [[236, 392, 40], [252, 396, 56], [500, 396, 46]].map(([x, b, hh]) => '<path d="M' + x + ' ' + (b - hh) + 'L' + (x + 14) + ' ' + b + 'H' + (x - 14) + 'Z"/>').join('') + '</g>' +
          ground('M0 440V388C120 374 240 392 360 382S470 374 520 380V440Z', '#e9e0fa') +
          ground('M0 440V404C130 394 260 410 380 400S480 396 520 400V440Z', '#b9a6dc') +
          // the rose, stem and leaves
          '<path d="M392 300C386 260 400 230 392 200" fill="none" stroke="#3a7a3a" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="M390 262l-8 -4M394 232l8 -4" stroke="#3a7a3a" stroke-width="3" stroke-linecap="round"/>' +
          leaf(392, 268, 200, 1.3, '#4e9a4a') + leaf(394, 240, -20, 1.2, '#6ab45a') +
          rose(392, 150, 1.9, '#9a0e3a', '#e0305e', '#ff9ab8') +
          '<path d="M374 106C372 94 380 86 390 84" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>' +
          scatter(522, 6, (x, y, r) => '<path transform="translate(' + x + ' ' + y + ') rotate(' + n(r() * 360) + ')" d="M0 0C4 -6 10 -6 12 -2C8 2 4 4 0 0Z" fill="#ff6a8a" opacity=".8"/>', 300, 500, 200, 300) +
          // the ring
          '<g transform="translate(452 236)"><ellipse rx="16" ry="11" fill="none" stroke="' + lin('ring', [[0, '#fff0b0'], [1, '#d8941e']]) + '" stroke-width="5"/>' +
            '<path d="M-6 -12L0 -22L6 -12Z" fill="#c9f3ff" stroke="#fff" stroke-width="1.5"/></g>' +
          sparkle(462, 212, 7) + sparkle(470, 70, 10) + sparkle(300, 110, 7) +
          scatter(523, 30, (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(1.2 + r() * 2) + '" fill="#fff" opacity="' + n(0.4 + r() * 0.5) + '"/>', 150, W, 0, 380);
      },

      // A gold pocket watch, open and late, tumbling down the rabbit hole
      // with playing cards, a teacup and a little bottle tied with a label.
      'Alice': () => {
        const gold = lin('gold', [[0, '#fff0b0'], [1, '#d8941e']]);
        const card = (x, y, a, suit, red) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ')">' +
          '<rect x="-17" y="-24" width="34" height="48" rx="4" fill="#fffaf4" stroke="#fff" stroke-width="1.5"/>' +
          '<rect x="-13" y="-20" width="26" height="40" rx="2" fill="none" stroke="' + (red ? '#e0305e' : '#2a1a40') + '" stroke-width="1" opacity=".4"/>' +
          '<path d="' + suit + '" fill="' + (red ? '#e0305e' : '#2a1a40') + '"/></g>';
        const heart = 'M0 8C-8 2 -10 -4 -6 -7C-3 -9 0 -6 0 -4C0 -6 3 -9 6 -7C10 -4 8 2 0 8Z';
        const spade = 'M0 -9C-6 -2 -10 2 -7 6C-5 8 -2 7 0 5C-1 8 -2 9 -3 10H3C2 9 1 8 0 5C2 7 5 8 7 6C10 2 6 -2 0 -9Z';
        const diamond = 'M0 -9L7 0L0 9L-7 0Z';
        const ticks = Array.from({ length: 12 }, (_, i) => {
          const a = i * Math.PI / 6;
          return '<path d="M' + n(Math.sin(a) * 46) + ' ' + n(-Math.cos(a) * 46) + 'L' + n(Math.sin(a) * 54) + ' ' + n(-Math.cos(a) * 54) + '" stroke="#5a3a6a" stroke-width="' + (i % 3 ? 2 : 4) + '"/>';
        }).join('');
        return tint('#5fd0c0', '#4a1a7a', 0.5) + stars(531, 30, 120, W, 0, 200) +
          // the hole, a dark mouth with roots round it
          glow('g', 384, 150, 180, '#fff3c4', 0.7) +
          // the chain
          '<path d="M384 82C360 50 320 44 290 60" fill="none" stroke="' + gold + '" stroke-width="4" stroke-dasharray="6 3" stroke-linecap="round"/>' +
          // the watch
          '<g transform="translate(384 150) rotate(-12)">' +
            '<rect x="-9" y="-80" width="18" height="14" rx="4" fill="' + gold + '" stroke="#7a4a10" stroke-width="1.5"/>' +
            '<circle cy="-86" r="7" fill="none" stroke="' + gold + '" stroke-width="4"/>' +
            '<circle r="68" fill="' + gold + '" stroke="#fff" stroke-width="3"/>' +
            '<circle r="58" fill="#fffaf0"/>' + ticks +
            '<path d="M0 0L-18 -30" stroke="#2a1a40" stroke-width="5" stroke-linecap="round"/>' +
            '<path d="M0 0L36 -10" stroke="#2a1a40" stroke-width="3.5" stroke-linecap="round"/>' +
            '<circle r="5" fill="#e0305e"/>' +
            '<path d="M-40 -34A54 54 0 0 1 -6 -54" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/></g>' +
          card(262, 120, -24, heart, true) + card(490, 230, 18, spade, false) + card(300, 278, 12, diamond, true) + card(486, 70, -10, heart, true) +
          // the teacup
          '<g transform="translate(470 330) rotate(-14)">' +
            '<ellipse cx="0" cy="18" rx="30" ry="7" fill="#e9e0fa"/>' +
            '<path d="M-22 -10H22C22 10 12 18 0 18C-12 18 -22 10 -22 -10Z" fill="#fff" stroke="#e9e0fa" stroke-width="1.5"/>' +
            '<path d="M22 -4C34 -6 34 10 18 10" fill="none" stroke="#fff" stroke-width="4"/>' +
            '<ellipse cx="0" cy="-10" rx="22" ry="5" fill="#c97a4a"/>' +
            '<path d="M-14 2C-8 6 8 6 14 2" fill="none" stroke="#ff8ab8" stroke-width="3"/></g>' +
          // the bottle with its label
          '<g transform="translate(258 352) rotate(16)">' +
            '<path d="M-6 -30V-20C-16 -14 -18 -4 -18 6V22H18V6C18 -4 16 -14 6 -20V-30Z" fill="' + lin('glass', [[0, '#c9f3ff', 0.9], [1, '#7ab8ff', 0.7]]) + '" stroke="#fff" stroke-width="2"/>' +
            '<path d="M-18 6H18V22H-18Z" fill="#c49bff" opacity=".7"/>' +
            '<rect x="-8" y="-38" width="16" height="9" rx="2" fill="#a0522d"/>' +
            '<path d="M8 -26C20 -26 26 -20 30 -12" fill="none" stroke="#fff" stroke-width="1.5"/>' +
            '<rect x="22" y="-14" width="26" height="16" rx="2" fill="#fffaf4" transform="rotate(20 22 -14)"/>' +
            '<path d="M-12 -2C-12 -8 -8 -12 -4 -14" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".8"/></g>' +
          ground('M0 440V396C80 386 160 398 220 392C240 380 300 372 380 374S500 384 520 388V440Z', '#2a0b3d') +
          '<ellipse cx="380" cy="404" rx="120" ry="22" fill="' + rad('hole', [[0, '#0a0414'], [0.7, '#1a0a2a'], [1, '#3a1a4a']]) + '"/>' +
          '<path d="M260 404C300 384 460 384 500 404" fill="none" stroke="#6fc06a" stroke-width="4" opacity=".7"/>' +
          '<g fill="none" stroke="#5a2e14" stroke-width="3" stroke-linecap="round"><path d="M250 392c4 10 0 18 -6 22M300 382c2 12 -4 20 -10 24M470 386c-2 12 4 20 10 24"/></g>' +
          '<g fill="#6fc06a"><path d="M232 392l4 -14l4 14zM244 394l3 -10l3 10zM500 390l4 -14l4 14z"/></g>' +
          sparkle(460, 140, 9) + sparkle(250, 200, 7) + sparkle(330, 60, 6);
      },

      // A glass slipper left on the palace stair at midnight, the clock
      // above striking twelve, a pumpkin on the step beside it.
      'Cinderella': () => {
        const glass = lin('glass', [[0, '#ffffff', 0.95], [0.5, '#d6f0ff', 0.75], [1, '#9ec8ff', 0.6]], 0, 0, 1, 1);
        const ticks = Array.from({ length: 12 }, (_, i) => {
          const a = i * Math.PI / 6;
          return '<circle cx="' + n(Math.sin(a) * 50) + '" cy="' + n(-Math.cos(a) * 50) + '" r="' + (i % 3 ? 2.4 : 4) + '" fill="#5a3a6a"/>';
        }).join('');
        return tint('#2b2d7a', '#c4508f', 0.55) + stars(541, 50, 120, W, 0, 240) +
          glow('g', 396, 120, 160, '#e6eaff', 0.7) +
          // the clock face, both hands on twelve
          '<g transform="translate(396 122)">' +
            '<circle r="76" fill="' + lin('rim', [[0, '#fff0b0'], [1, '#d8941e']]) + '" stroke="#fff" stroke-width="3"/>' +
            '<circle r="64" fill="#fffaf4"/>' + ticks +
            '<path d="M0 6V-40" stroke="#2a1a40" stroke-width="6" stroke-linecap="round"/><path d="M0 6V-54" stroke="#2a1a40" stroke-width="3.5" stroke-linecap="round"/>' +
            '<circle r="6" fill="#d8941e"/>' +
            '<path d="M-48 -32A58 58 0 0 1 -12 -56" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/></g>' +
          '<g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"><path d="M296 74c-8 10-8 22 0 32M282 64c-12 16-12 36 0 52M496 74c8 10 8 22 0 32M510 64c12 16 12 36 0 52"/></g>' +
          // the stair
          '<g>' + [0, 1, 2, 3].map(i => '<rect x="' + (180 + i * 30) + '" y="' + (296 + i * 26) + '" width="' + (360 - i * 30) + '" height="26" fill="' + (i % 2 ? '#3a1a5e' : '#4a2a72') + '"/>' +
            '<rect x="' + (180 + i * 30) + '" y="' + (296 + i * 26) + '" width="' + (360 - i * 30) + '" height="3" fill="#c9b4e0" opacity=".5"/>').join('') + '</g>' +
          // the pumpkin
          '<g transform="translate(292 282)">' +
            '<ellipse cx="-14" cy="0" rx="18" ry="16" fill="#e07a1e"/><ellipse cx="14" cy="0" rx="18" ry="16" fill="#e07a1e"/>' +
            '<ellipse cx="0" cy="0" rx="16" ry="17" fill="' + lin('pump', [[0, '#ffb04a'], [1, '#d0601a']]) + '"/>' +
            '<path d="M0 -16C0 -24 4 -28 10 -30" fill="none" stroke="#4a7a2a" stroke-width="4" stroke-linecap="round"/>' +
            '<path d="M4 -24C10 -32 20 -30 22 -24C16 -20 8 -20 4 -24Z" fill="#6ab45a"/>' +
            '<path d="M-6 -8C-8 -4 -8 4 -6 8" stroke="#fff" stroke-width="2" opacity=".5" fill="none" stroke-linecap="round"/></g>' +
          // the slipper on the step
          glow('sl', 436, 280, 80, '#c9f3ff', 0.7) +
          '<g transform="translate(436 284) scale(1.2)">' +
            '<path d="M42 -4L46 22H40L34 0Z" fill="' + glass + '" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
            '<path d="M-58 14C-60 6 -54 0 -44 -2C-34 -4 -24 -6 -12 -2C0 2 12 0 22 -10C30 -18 38 -26 46 -22C50 -20 50 -14 48 -8L42 -2C30 6 10 16 -12 18C-30 20 -50 20 -58 14Z" fill="' + glass + '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>' +
            '<path d="M-12 -2C0 4 16 2 26 -8" fill="none" stroke="#9ec8ff" stroke-width="2" opacity=".8"/>' +
            '<path d="M-50 8C-40 2 -26 0 -16 4" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".9"/>' +
            '<path d="M30 -16C36 -22 42 -24 46 -20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".9"/></g>' +
          sparkle(476, 244, 10) + sparkle(396, 256, 6) + sparkle(496, 300, 6) + sparkle(270, 210, 8) +
          scatter(542, 18, (x, y, r) => sparkle(x, y, n(2 + r() * 3)), 220, W, 180, 300) +
          ground('M0 440V400C120 392 260 404 380 396S480 392 520 396V440Z', '#1c0f3a');
      },
    },

    emblems: {
      // A banner with a fleur-de-lis on a lance.
      'Joan of Arc': '<path d="M12 44V4"/><path d="M12 6c8-4 14 4 22 0s8-2 10 0v18c-4-2-8 0-12 2s-12 2-20-2z" fill="currentColor" fill-opacity=".18"/><path d="M12 6c8-4 14 4 22 0s8-2 10 0v18c-4-2-8 0-12 2s-12 2-20-2z"/><path d="M27 9c3 3 3 6 1 9h-2c-2-3-2-6 1-9z" fill="currentColor" stroke="none"/><path d="M26 18c-2-3-6-3-6 0s3 3 4 2M28 18c2-3 6-3 6 0s-3 3-4 2"/><path d="M23 21h8"/><path d="M8 44h8"/>',
      // An owl.
      'Athena': '<path d="M11 40c-3-10-2-22 3-30l5 5c3-1 7-1 10 0l5-5c5 8 6 20 3 30-3 5-23 5-26 0z" fill="currentColor" fill-opacity=".18"/><path d="M11 40c-3-10-2-22 3-30l5 5c3-1 7-1 10 0l5-5c5 8 6 20 3 30-3 5-23 5-26 0z"/><circle cx="19" cy="21" r="4.5"/><circle cx="29" cy="21" r="4.5"/><circle cx="19" cy="21" r="1.4" fill="currentColor" stroke="none"/><circle cx="29" cy="21" r="1.4" fill="currentColor" stroke="none"/><path d="M22.5 26l1.5 3 1.5-3z"/><path d="M19 33q2 2 4 0M25 33q2 2 4 0"/><path d="M4 44h40"/>',
      // A rose on its stem.
      'Belle': '<path d="M14 15c0-6 5-10 10-10s10 4 10 10c0 7-5 11-10 11s-10-4-10-11z" fill="currentColor" fill-opacity=".18"/><path d="M14 15c0-6 5-10 10-10s10 4 10 10c0 7-5 11-10 11s-10-4-10-11z"/><path d="M19 15c0-3 2-5 5-5s5 2 5 5-2 5-5 5"/><path d="M24 13c1-1 2 0 2 1"/><path d="M24 26v18"/><path d="M24 36c-4-6-10-6-13-4 3 4 9 5 13 4zM24 32c4-5 9-5 12-3-3 4-8 4-12 3z" fill="currentColor" fill-opacity=".18"/><path d="M24 36c-4-6-10-6-13-4 3 4 9 5 13 4zM24 32c4-5 9-5 12-3-3 4-8 4-12 3z"/>',
      // A pocket watch on its chain.
      'Alice': '<circle cx="24" cy="27" r="16" fill="currentColor" fill-opacity=".18"/><circle cx="24" cy="27" r="16"/><circle cx="24" cy="27" r="12"/><path d="M24 27l-4-6M24 27h7"/><path d="M21 11h6v-3h-6z"/><circle cx="24" cy="5" r="2.5"/><path d="M24 17v1.5M34 27h-1.5M24 37v-1.5M14 27h1.5"/>',
      // A glass slipper.
      'Cinderella': '<path d="M36 26l3 16h-3l-5-14" fill="currentColor" fill-opacity=".18"/><path d="M36 26l3 16h-3l-5-14"/><path d="M3 38c-1-4 2-7 7-8 6-1 11-2 16-4 5-2 9-8 13-13 2-2 5-2 6 1l-1 6-6 6c-8 6-20 13-31 14-2 0-4 0-4-2z" fill="currentColor" fill-opacity=".18"/><path d="M3 38c-1-4 2-7 7-8 6-1 11-2 16-4 5-2 9-8 13-13 2-2 5-2 6 1l-1 6-6 6c-8 6-20 13-31 14-2 0-4 0-4-2z"/><path d="M8 34c4-2 8-2 11 0"/><path d="M14 6l1.3 3.2 3.2 1.3-3.2 1.3L14 15l-1.3-3.2-3.2-1.3 3.2-1.3zM30 4v4M28 6h4"/>',
    },
  };
}
