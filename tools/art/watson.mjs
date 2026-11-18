// Live (21 October 2026), loaded into SCENES by tools/character-art.mjs: Dr Watson redrawn as a cinematic Victorian study at night.
// A tall bay window onto rain and gaslit fog under the moon, firelight from
// the hearth, and on the desk in lamplight the doctor's Gladstone bag with a
// stethoscope over it, the open casebook and its pen, and a pocket watch
// (Conan Doyle, public domain; no figure, nothing from any adaptation).
export default function (h) {
  const { W, H, n, lin, rad, glow, tint, ground, rng, stars, sparkle, scatter } = h;
  return {
    scenes: {
      'Dr Watson': () => {
        const ink = '#1a0a14';
        const wallF = lin('wall', [[0, '#3a1844'], [1, '#160818']]);
        const sky = lin('sky', [[0, '#1c1a52'], [0.6, '#4a3a8a'], [1, '#8a6aa8']]);
        const curtain = lin('curtain', [[0, '#5a1838'], [0.5, '#9a2a5a'], [1, '#4a1030']], 0, 0, 1, 0);
        const frame = lin('frame', [[0, '#6a3a2a'], [1, '#2a1208']], 0, 0, 1, 0);
        const desk = lin('desk', [[0, '#8a4a22'], [0.15, '#5a2a12'], [1, '#22100a']]);
        const leather = lin('leather', [[0, '#c2703a'], [0.45, '#7a3418'], [1, '#2e1006']]);
        const brass = lin('brass', [[0, '#fff0b8'], [0.5, '#e0a43a'], [1, '#7a4a10']]);
        const page = lin('page', [[0, '#fffaf0'], [1, '#ecd8b4']], 0, 0, 1, 0);
        const r = rng(91);
        // Outside the glass: the moon, London's roofs and chimneys in fog, gas lamps.
        let roofs = '';
        for (let x = 330; x < 504; x += 18 + Math.floor(r() * 14)) {
          const top = 170 + r() * 34;
          roofs += 'M' + x + ' 252V' + n(top) + 'h' + n(6 + r() * 8) + 'v-' + n(6 + r() * 10) + 'h4v' + n(6 + r() * 10) + 'h' + n(6 + r() * 8) + 'V252Z';
        }
        const lampPost = x => glow('gl' + x, x, 196, 18, '#ffd98a', 0.9) +
          '<path d="M' + x + ' 252V200" stroke="#120a2a" stroke-width="2"/><rect x="' + (x - 3) + '" y="192" width="6" height="8" rx="1" fill="#ffe7a8"/>';
        const rain = scatter(93, 46, (x, y, rr) => '<path d="M' + x + ' ' + y + 'l-2 ' + n(8 + rr() * 10) + '" stroke="#dcd4ff" stroke-width="1" opacity="' + n(0.25 + rr() * 0.35) + '"/>', 334, 500, 30, 250);
        const drops = scatter(94, 8, (x, y, rr) => '<ellipse cx="' + x + '" cy="' + y + '" rx="1" ry="1.8" fill="#fff" opacity="' + n(0.3 + rr() * 0.3) + '"/>', 336, 498, 40, 244);
        const window = '<clipPath id="{id}-glass"><path d="M336 252V82A80 66 0 0 1 496 82V252Z"/></clipPath>' +
          '<g clip-path="url(#{id}-glass)">' +
            '<rect x="330" y="10" width="172" height="250" fill="' + sky + '"/>' +
            glow('moonglow', 446, 92, 90, '#f4eaff', 0.75) +
            '<circle cx="446" cy="92" r="30" fill="' + rad('moon', [[0, '#fffdf4'], [1, '#e2d8f4']], 0.4, 0.35) + '"/>' +
            '<circle cx="436" cy="84" r="5" fill="#d4c8e8" opacity=".6"/><circle cx="456" cy="102" r="4" fill="#d4c8e8" opacity=".5"/>' +
            stars(95, 14, 340, 494, 30, 150) +
            '<path d="' + roofs + '" fill="#241a4a"/>' +
            '<g fill="#ffd98a" opacity=".8">' + [[352, 214], [384, 206], [418, 222], [462, 210], [484, 226]].map(([x, y]) => '<rect x="' + x + '" y="' + y + '" width="4" height="5"/>').join('') + '</g>' +
            lampPost(372) + lampPost(470) +
            '<rect x="330" y="200" width="172" height="60" fill="' + lin('fog', [[0, '#c8b8f0', 0], [1, '#c8b8f0', 0.55]]) + '"/>' +
            rain + drops +
          '</g>';
        const mullions = '<g fill="none" stroke="' + frame + '" stroke-width="7">' +
            '<path d="M336 252V82A80 66 0 0 1 496 82V252Z"/><path d="M416 18V252M336 150H496"/></g>' +
          '<path d="M339 250V84A77 63 0 0 1 493 84" fill="none" stroke="#c88a5a" stroke-width="1.6" opacity=".55"/>';
        const curtains = '<path d="M300 0H346C340 60 338 150 344 236C346 250 330 262 316 258C306 180 302 90 300 0Z" fill="' + curtain + '"/>' +
          '<path d="M520 0H486C492 60 494 150 488 236C486 250 502 262 520 258Z" fill="' + curtain + '"/>' +
          '<g stroke="#2a0818" stroke-width="2" opacity=".5" fill="none"><path d="M314 10C316 90 318 170 322 250M330 6C330 90 330 170 334 248M500 10C498 90 498 170 500 250"/></g>' +
          '<path d="M296 4H524" stroke="' + brass + '" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M318 160C326 168 336 168 342 160" fill="none" stroke="' + brass + '" stroke-width="3"/>';
        // Firelight from the hearth just out of frame, on the left.
        const fire = glow('fire', 210, 380, 190, '#ff9a3a', 0.55) + glow('fire2', 250, 420, 110, '#ffcf6a', 0.5);
        // The desk.
        const deskTop = '<path d="M120 342L520 322V440H110Z" fill="' + desk + '"/>' +
          '<path d="M120 342L520 322" stroke="#d48a4a" stroke-width="2.4" opacity=".7"/>';
        // The oil lamp: brass base, glass chimney and its glow, the room's light.
        const lamp = glow('lampglow', 318, 250, 150, '#ffcf72', 0.8) + glow('lampcore', 318, 254, 40, '#fff2c4', 0.9) +
          '<g transform="translate(318 0)">' +
            '<path d="M-20 334C-20 322 -10 316 0 316S20 322 20 334Z" fill="' + brass + '" stroke="' + ink + '" stroke-width="1.6"/>' +
            '<path d="M-4 316V296H4V316Z" fill="' + brass + '"/>' +
            '<ellipse cx="0" cy="292" rx="16" ry="12" fill="' + rad('font', [[0, '#ffe2a0'], [1, '#b0601a']], 0.4, 0.35) + '" stroke="' + ink + '" stroke-width="1.4"/>' +
            '<path d="M-7 282C-12 270 -12 252 -6 236H6C12 252 12 270 7 282Z" fill="#fff6dc" opacity=".55" stroke="#fff" stroke-width="1"/>' +
            '<path d="M0 270C-5 262 -3 254 0 248C3 254 5 262 0 270Z" fill="#ffd36a"/>' +
            '<path d="M-2 266C-4 260 -2 256 0 252C2 256 4 260 2 266Z" fill="#fff"/>' +
          '</g>';
        // The casebook, open, written in, with its fountain pen.
        const book = '<g transform="translate(372 344) rotate(-4)">' +
            '<path d="M-48 -8C-30 -14 -12 -14 0 -6C12 -14 30 -14 48 -8L50 6C30 0 12 0 0 8C-12 0 -30 0 -50 6Z" fill="#5a1a1a"/>' +
            '<path d="M-46 -12C-30 -18 -12 -18 0 -10C12 -18 30 -18 46 -12V2C30 -4 12 -4 0 4C-12 -4 -30 -4 -46 2Z" fill="' + page + '" stroke="#8a5a3a" stroke-width="1.2"/>' +
            '<path d="M0 -10V4" stroke="#a07a5a" stroke-width="1.2"/>' +
            '<g fill="none" stroke="#3a2a5a" stroke-width="1" opacity=".75" stroke-linecap="round">' +
              [-9, -5, -1].map((dy, i) => '<path d="M-40 ' + dy + 'c3 -2 5 1 8 -1s5 1 8 -1s5 2 8 0s5 1 8 -1"/>' +
                '<path d="M6 ' + (dy - 1) + 'c3 -2 5 1 8 -1s5 1 8 -1s5 2 8 0' + (i < 2 ? 's5 1 8 -1' : '') + '"/>').join('') + '</g>' +
          '</g>' +
          '<g transform="translate(402 334) rotate(-28)"><rect x="-2.6" y="-30" width="5.2" height="36" rx="2.6" fill="#1a0a2a"/>' +
            '<rect x="-2.8" y="-12" width="5.6" height="3" fill="' + brass + '"/><path d="M-2 6L0 13L2 6Z" fill="' + brass + '"/></g>';
        // The pocket watch, open, its chain trailing.
        const watch = '<g transform="translate(498 356) scale(.9)">' +
            '<path d="M-2 -14C-14 -24 -30 -20 -34 -10" fill="none" stroke="' + brass + '" stroke-width="2" stroke-dasharray="2.6 1.6"/>' +
            '<circle r="13" fill="' + brass + '" stroke="' + ink + '" stroke-width="1.4"/><circle r="10" fill="#fffaf0"/>' +
            '<g stroke="#3a2a3a" stroke-width="1"><path d="M0 -8V-6.5M8 0H6.5M0 8V6.5M-8 0H-6.5"/></g>' +
            '<path d="M0 0V-6M0 0L4 2.5" stroke="#1a0a1a" stroke-width="1.4" stroke-linecap="round"/>' +
            '<rect x="-2.4" y="-18" width="4.8" height="5" rx="1.4" fill="' + brass + '"/></g>';
        // The hero: the Gladstone bag, worn leather, brass frame and clasps, the stethoscope over it.
        const bag = '<g transform="translate(452 294) scale(.9)">' +
            '<path d="M-26 -42C-26 -64 26 -64 26 -42" fill="none" stroke="#2a0e04" stroke-width="9" stroke-linecap="round"/>' +
            '<path d="M-26 -42C-26 -64 26 -64 26 -42" fill="none" stroke="#a05a2a" stroke-width="3" stroke-linecap="round" opacity=".7"/>' +
            '<path d="M-58 -30L-48 -40H48L58 -30L64 40C64 50 58 54 48 54H-48C-58 54 -64 50 -64 40Z" fill="' + leather + '" stroke="' + ink + '" stroke-width="2.4" stroke-linejoin="round"/>' +
            '<path d="M-48 -40C-30 -50 30 -50 48 -40" fill="none" stroke="' + ink + '" stroke-width="2"/>' +
            '<path d="M-60 -32H60" stroke="' + brass + '" stroke-width="6" stroke-linecap="round"/>' +
            '<path d="M-60 -32H60" stroke="#fff4c8" stroke-width="1.4" opacity=".7"/>' +
            '<rect x="-10" y="-30" width="20" height="14" rx="3" fill="' + brass + '" stroke="' + ink + '" stroke-width="1.4"/>' +
            '<circle cx="0" cy="-23" r="2.2" fill="' + ink + '"/>' +
            '<rect x="-52" y="-30" width="9" height="16" rx="2" fill="' + brass + '" stroke="' + ink + '" stroke-width="1.2"/>' +
            '<rect x="43" y="-30" width="9" height="16" rx="2" fill="' + brass + '" stroke="' + ink + '" stroke-width="1.2"/>' +
            '<g fill="none" stroke="#ffd9a0" stroke-width="1.4" stroke-dasharray="3.4 2.6" opacity=".55"><path d="M-56 -8H56M-58 44H58M-50 -8V44M50 -8V44"/></g>' +
            '<path d="M-54 -10C-40 -14 -38 6 -44 30" fill="none" stroke="#ffdcb0" stroke-width="3" opacity=".35" stroke-linecap="round"/>' +
            '<g fill="' + brass + '">' + [[-58, 50], [58, 50], [-58, -6], [58, -6]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="2.4"/>').join('') + '</g>' +
            // The stethoscope: tubing over the top and down the front, chest piece and earpieces.
            '<path d="M-40 -34C-46 -10 -30 8 -14 4C2 0 6 18 0 34" fill="none" stroke="#1a1a22" stroke-width="4" stroke-linecap="round"/>' +
            '<path d="M-40 -34C-46 -10 -30 8 -14 4C2 0 6 18 0 34" fill="none" stroke="#6a6a7a" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>' +
            '<path d="M-40 -34C-38 -46 -30 -50 -22 -50M-40 -34C-46 -44 -54 -46 -60 -42" fill="none" stroke="#1a1a22" stroke-width="3" stroke-linecap="round"/>' +
            '<circle cx="-22" cy="-50" r="2.4" fill="#d8d8e0"/><circle cx="-60" cy="-42" r="2.4" fill="#d8d8e0"/>' +
            '<circle cx="0" cy="38" r="8" fill="' + rad('chest', [[0, '#ffffff'], [1, '#9a9aaa']], 0.4, 0.35) + '" stroke="' + ink + '" stroke-width="1.4"/>' +
            '<circle cx="0" cy="38" r="3.4" fill="none" stroke="#5a5a6a" stroke-width="1"/>' +
          '</g>' +
          // Lamplight catching the near side of the bag.
          '<path d="M396 272C392 294 392 318 398 338" fill="none" stroke="#ffcf8a" stroke-width="3" opacity=".45" stroke-linecap="round"/>';
        const shadow = '<ellipse cx="452" cy="344" rx="64" ry="6" fill="#0e0408" opacity=".55"/>';
        const motes = scatter(97, 26, (x, y, rr) => '<circle cx="' + x + '" cy="' + y + '" r="' + n(0.6 + rr() * 1.4) + '" fill="#ffe2a0" opacity="' + n(0.25 + rr() * 0.45) + '"/>', 250, 420, 150, 330);
        return '<rect width="' + W + '" height="' + H + '" fill="' + wallF + '"/>' +
          tint('#2a1450', '#3a1020', 0.35) +
          // Wainscot panels on the study wall.
          fire + window + mullions + curtains +
          '<path d="M330 252H502V262H330Z" fill="' + frame + '"/><path d="M326 262H506" stroke="#d48a4a" stroke-width="2" opacity=".6"/>' +
          deskTop + lamp + shadow + bag + book + watch + motes +
          sparkle(300, 70, 7, '#ffe8c0') + sparkle(510, 300, 6) +
          ground('M0 440V404C120 396 260 412 380 404S480 398 520 402V440Z', '#0e0408');
      },
    },
    emblems: {
      'Dr Watson': '<path d="M6 18h36l3 20c0 3-2 5-5 5H8c-3 0-5-2-5-5z" fill="currentColor" fill-opacity=".18"/><path d="M6 18h36l3 20c0 3-2 5-5 5H8c-3 0-5-2-5-5z"/><path d="M16 18v-5c0-4 3-6 8-6s8 2 8 6v5"/><path d="M4 18c6-4 34-4 40 0"/><path d="M12 22c-2 8 4 12 10 10s8 4 6 10"/><circle cx="28" cy="42" r="2.6"/>',
    },
  };
}
