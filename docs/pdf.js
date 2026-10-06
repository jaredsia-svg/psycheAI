// A small PDF writer, and the report layout built on top of it.
//
// This replaces print-to-PDF. The browser's print dialog produced a decent
// document but the user never controlled it: page size, margins, headers and
// the "do you want backgrounds?" checkbox all belonged to the browser, and on
// mobile it frequently offered no PDF destination at all. So the report is
// typeset here instead.
//
// No PDF library is bundled. A text report needs the base-14 fonts, filled
// rectangles and lines, which is a few hundred lines of PDF operators — far
// less than any library, and the text stays real text rather than a canvas
// rasterised into a fuzzy image. Everything is written uncompressed: it costs
// about 80KB on a twelve-page report and makes the output greppable, which the
// test suite relies on.
(function (root) {
  'use strict';

  // ---------- font metrics ----------
  //
  // Adobe's base-14 widths, in 1/1000 em, for code points 32-126. Wrapping is
  // impossible without them, and asking canvas to measure is no good: the
  // viewer renders with its own Helvetica, not whatever the page substitutes.
  const WIDTHS = {
    normal: ('278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
      '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 ' +
      '667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 ' +
      '278 278 278 469 556 333 ' +
      '556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 ' +
      '334 260 334 584').split(' ').map(Number),
    bold: ('278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
      '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 ' +
      '722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 ' +
      '333 278 333 584 556 333 ' +
      '556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 ' +
      '389 280 389 584').split(' ').map(Number),
  };

  // Characters outside Latin-1 that WinAnsi still has a slot for. Without this
  // the model's curly quotes and dashes would come out as question marks.
  const WINANSI = {
    '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133,
    '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138,
    '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146,
    '“': 147, '”': 148, '•': 149, '–': 150, '—': 151,
    '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156,
    'ž': 158, 'Ÿ': 159,
  };

  // Widths for those extra slots, plus the ones Latin-1 does not share with
  // ASCII. Anything still unknown falls back to the un-accented letter, which
  // is exactly right: an acute accent adds no width.
  const EXTRA_WIDTHS = {
    normal: { 128: 556, 133: 1000, 145: 222, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000, 153: 1000, 160: 278, 173: 333 },
    bold: { 128: 556, 133: 1000, 145: 278, 146: 278, 147: 500, 148: 500, 149: 350, 150: 556, 151: 1000, 153: 1000, 160: 278, 173: 333 },
  };

  const ASCII_FALLBACK = {
    '→': '->', '←': '<-', '↑': '^', '↓': 'v', '⇒': '=>', '↔': '<->',
    '≈': '~', '≤': '<=', '≥': '>=', '×': 'x', '−': '-', '‐': '-', '‑': '-',
  };

  /** Unicode text → a WinAnsi byte string, one character per byte. */
  function toWinAnsi(text) {
    let out = '';
    for (const ch of String(text === null || text === undefined ? '' : text)) {
      const code = ch.codePointAt(0);
      if (code === 10 || code === 13) { out += ' '; continue; }
      if (code >= 32 && code <= 126) { out += ch; continue; }
      if (WINANSI[ch] !== undefined) { out += String.fromCharCode(WINANSI[ch]); continue; }
      if (code >= 160 && code <= 255) { out += ch; continue; }
      // Arrows have no WinAnsi slot, and dropping one silently turns "E/I → E"
      // into "E/I E". Substitute rather than lose the character.
      if (ASCII_FALLBACK[ch] !== undefined) { out += ASCII_FALLBACK[ch]; continue; }
      // Strip the accent and keep the letter if that is all it takes.
      const bare = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (bare.length === 1 && bare.codePointAt(0) < 127) { out += bare; continue; }
      // Emoji and anything else with no slot are dropped rather than drawn as
      // a black box. The essence icon is decoration; its noun carries the point.
    }
    return out;
  }

  function charWidth(code, bold) {
    const key = bold ? 'bold' : 'normal';
    if (code >= 32 && code <= 126) return WIDTHS[key][code - 32];
    if (EXTRA_WIDTHS[key][code] !== undefined) return EXTRA_WIDTHS[key][code];
    if (code >= 192 && code <= 255) return WIDTHS[key][(code >= 224 ? 'a' : 'A').charCodeAt(0) - 32];
    return WIDTHS[key]['e'.charCodeAt(0) - 32];
  }

  /** Width of already-encoded WinAnsi text at a given size. */
  function measure(encoded, size, bold, tracking) {
    let total = 0;
    for (let i = 0; i < encoded.length; i++) total += charWidth(encoded.charCodeAt(i), bold);
    return (total * size) / 1000 + (tracking || 0) * encoded.length;
  }

  // ---------- the document ----------

  const PAGE = { width: 595.28, height: 841.89 };
  const MARGIN = 54;
  const COLUMN = PAGE.width - MARGIN * 2;

  const INK = [0.141, 0.102, 0.180];
  const SOFT = [0.42, 0.376, 0.463];
  const ACCENT = [0.482, 0.247, 0.627];
  const ACCENT_2 = [0.820, 0.278, 0.478];
  const LINE = [0.906, 0.875, 0.925];
  const WASH = [0.953, 0.914, 0.973];
  const PAPER = [0.980, 0.969, 0.984];
  const WHITE = [1, 1, 1];
  // The page colours its strengths and weaknesses headings; so does this.
  const GOOD = [0.184, 0.490, 0.357];
  const WARN = [0.604, 0.357, 0.071];

  const num = n => (Math.round(n * 1000) / 1000).toString();
  /** A colour `t` of the way from `a` to `b`. */
  const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

  function Doc() {
    this.pages = [];
    this.buffer = null;
    this.y = 0;
    this.pageNumber = 0;
  }

  Doc.prototype.newPage = function (options) {
    const settings = options || {};
    this.buffer = [];
    this.pages.push({ content: this.buffer, plain: Boolean(settings.plain) });
    this.pageNumber = this.pages.length;
    if (!settings.bare) {
      // A wash rather than white: it matches the app and stops a long report
      // from reading like a tax form.
      this.rect(0, 0, PAGE.width, PAGE.height, PAPER);
    }
    this.y = settings.top === undefined ? MARGIN + 24 : settings.top;
    return this;
  };

  Doc.prototype.op = function (line) {
    this.buffer.push(line);
    return this;
  };

  Doc.prototype.setFill = function (color) {
    return this.op(num(color[0]) + ' ' + num(color[1]) + ' ' + num(color[2]) + ' rg');
  };

  Doc.prototype.setStroke = function (color) {
    return this.op(num(color[0]) + ' ' + num(color[1]) + ' ' + num(color[2]) + ' RG');
  };

  /** Rectangle, measured from the top of the page down. */
  Doc.prototype.rect = function (x, top, width, height, color) {
    this.setFill(color);
    return this.op(num(x) + ' ' + num(PAGE.height - top - height) + ' ' +
      num(width) + ' ' + num(height) + ' re f');
  };

  Doc.prototype.roundRect = function (x, top, width, height, radius, color) {
    this.setFill(color);
    this.roundRectPath(x, top, width, height, radius);
    return this.op('f');
  };

  /** The path of a rounded rectangle, for a fill or a clip to finish. */
  Doc.prototype.roundRectPath = function (x, top, width, height, radius) {
    const r = Math.min(radius, height / 2, width / 2);
    const bottom = PAGE.height - top - height;
    const right = x + width;
    const topY = PAGE.height - top;
    const k = r * 0.5523;
    this.op(num(x + r) + ' ' + num(bottom) + ' m');
    this.op(num(right - r) + ' ' + num(bottom) + ' l');
    this.op(num(right - r + k) + ' ' + num(bottom) + ' ' + num(right) + ' ' + num(bottom + r - k) + ' ' + num(right) + ' ' + num(bottom + r) + ' c');
    this.op(num(right) + ' ' + num(topY - r) + ' l');
    this.op(num(right) + ' ' + num(topY - r + k) + ' ' + num(right - r + k) + ' ' + num(topY) + ' ' + num(right - r) + ' ' + num(topY) + ' c');
    this.op(num(x + r) + ' ' + num(topY) + ' l');
    this.op(num(x + r - k) + ' ' + num(topY) + ' ' + num(x) + ' ' + num(topY - r + k) + ' ' + num(x) + ' ' + num(topY - r) + ' c');
    this.op(num(x) + ' ' + num(bottom + r) + ' l');
    this.op(num(x) + ' ' + num(bottom + r - k) + ' ' + num(x + r - k) + ' ' + num(bottom) + ' ' + num(x + r) + ' ' + num(bottom) + ' c');
    return this.op('h');
  };

  /** A circle, centred at (cx, cy) measured from the top of the page. */
  Doc.prototype.circle = function (cx, cy, r, color) {
    return this.roundRect(cx - r, cy - r, r * 2, r * 2, r, color);
  };

  /**
   * A rounded box filled with a left-to-right blend of two colours. PDF
   * shadings would need their own objects; thin slices under a rounded clip
   * look the same in print. `decorate`, if given, draws inside the same clip —
   * the soft circles the story card has over its top-right corner.
   */
  Doc.prototype.gradientBox = function (x, top, width, height, radius, from, to, decorate) {
    this.op('q');
    this.roundRectPath(x, top, width, height, radius);
    this.op('W n');
    const slices = Math.max(24, Math.ceil(width / 5));
    for (let i = 0; i < slices; i++) {
      this.rect(x + width * i / slices, top, width / slices + 0.6, height, mix(from, to, i / (slices - 1)));
    }
    if (decorate) decorate();
    return this.op('Q');
  };

  /**
   * Strokes SVG path data — the brand mark, which is the only artwork here.
   *
   * PDF has no arc operator, so the elliptical arcs in the mark are converted to
   * cubic béziers: endpoint parameterisation to centre parameterisation, split
   * into quarter-turns or less, then one bézier per piece. Only the subset of
   * the path grammar the mark uses is implemented (M, L, H, V, C, A, Z, and
   * their relative forms), because a general SVG renderer is not the job.
   */
  Doc.prototype.svgPaths = function (mark, options) {
    const settings = options || {};
    const scale = settings.size / mark.viewBox;
    const originX = settings.x;
    const originTop = settings.top;
    const px = x => originX + x * scale;
    const py = y => PAGE.height - (originTop + y * scale);

    this.setStroke(settings.color || INK);
    // Round caps and joins, as the SVG asks for; without them the open strokes
    // end in blunt squares and the mark looks like a different drawing.
    this.op(num(mark.strokeWidth * scale) + ' w 1 J 1 j');
    for (const data of mark.paths) this.tracePath(data, px, py);
    this.op('S');

    // The centre dot is filled rather than stroked, so it cannot ride along in
    // `paths` — everything there goes through one pen and one stroke. Drawn as
    // four beziers because the PDF operator set has no circle primitive.
    if (mark.dot) {
      const k = 0.5522847498307936;
      const cx = px(mark.dot.cx);
      const cy = py(mark.dot.cy);
      const r = mark.dot.r * scale;
      this.setFill(settings.color || INK);
      this.op(num(cx - r) + ' ' + num(cy) + ' m');
      this.op(num(cx - r) + ' ' + num(cy + r * k) + ' ' + num(cx - r * k) + ' ' + num(cy + r) + ' ' + num(cx) + ' ' + num(cy + r) + ' c');
      this.op(num(cx + r * k) + ' ' + num(cy + r) + ' ' + num(cx + r) + ' ' + num(cy + r * k) + ' ' + num(cx + r) + ' ' + num(cy) + ' c');
      this.op(num(cx + r) + ' ' + num(cy - r * k) + ' ' + num(cx + r * k) + ' ' + num(cy - r) + ' ' + num(cx) + ' ' + num(cy - r) + ' c');
      this.op(num(cx - r * k) + ' ' + num(cy - r) + ' ' + num(cx - r) + ' ' + num(cy - r * k) + ' ' + num(cx - r) + ' ' + num(cy) + ' c');
      this.op('f');
    }
    return this;
  };

  /**
   * Path data → PDF path operators, through `px`/`py` to page coordinates.
   * The subset the brand mark and the character emblems use: M, L, H, V, C,
   * S, Q, A and Z, each absolute or relative. Q becomes the cubic it is
   * equal to; S reflects the previous curve's second handle.
   */
  Doc.prototype.tracePath = function (data, px, py) {
    let cursorX = 0;
    let cursorY = 0;
    let startX = 0;
    let startY = 0;
    let handle = null;
    const curve = points => {
      this.op(points.map(p => num(px(p[0])) + ' ' + num(py(p[1]))).join(' ') + ' c');
    };
    const commands = data.match(/[MmLlHhVvCcSsQqAaZz][^MmLlHhVvCcSsQqAaZz]*/g) || [];
    for (const chunk of commands) {
      const code = chunk[0];
      const relative = code === code.toLowerCase();
      const numbers = (chunk.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      const letter = code.toUpperCase();

      if (letter === 'Z') {
        this.op('h');
        cursorX = startX;
        cursorY = startY;
        handle = null;
        continue;
      }
      // Each command takes a fixed number of arguments and may repeat them.
      const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 }[letter];
      for (let i = 0; i + arity <= numbers.length; i += arity) {
        const args = numbers.slice(i, i + arity);
        const base = relative ? [cursorX, cursorY] : [0, 0];
        let nextHandle = null;
        if (letter === 'M' || letter === 'L') {
          const x = base[0] + args[0];
          const y = base[1] + args[1];
          // A repeated M means a line, per the SVG spec.
          this.op(num(px(x)) + ' ' + num(py(y)) + (letter === 'M' && i === 0 ? ' m' : ' l'));
          if (letter === 'M' && i === 0) { startX = x; startY = y; }
          cursorX = x;
          cursorY = y;
        } else if (letter === 'H' || letter === 'V') {
          const x = letter === 'H' ? (relative ? cursorX + args[0] : args[0]) : cursorX;
          const y = letter === 'V' ? (relative ? cursorY + args[0] : args[0]) : cursorY;
          this.op(num(px(x)) + ' ' + num(py(y)) + ' l');
          cursorX = x;
          cursorY = y;
        } else if (letter === 'C' || letter === 'S') {
          const given = [];
          for (let k = 0; k < args.length; k += 2) given.push([base[0] + args[k], base[1] + args[k + 1]]);
          const first = letter === 'C' ? given.shift()
            : (handle ? [2 * cursorX - handle[0], 2 * cursorY - handle[1]] : [cursorX, cursorY]);
          const points = [first, given[0], given[1]];
          curve(points);
          nextHandle = points[1];
          cursorX = points[2][0];
          cursorY = points[2][1];
        } else if (letter === 'Q') {
          const q = [base[0] + args[0], base[1] + args[1]];
          const end = [base[0] + args[2], base[1] + args[3]];
          curve([[cursorX + (q[0] - cursorX) * 2 / 3, cursorY + (q[1] - cursorY) * 2 / 3],
            [end[0] + (q[0] - end[0]) * 2 / 3, end[1] + (q[1] - end[1]) * 2 / 3], end]);
          cursorX = end[0];
          cursorY = end[1];
        } else if (letter === 'A') {
          const endX = relative ? cursorX + args[5] : args[5];
          const endY = relative ? cursorY + args[6] : args[6];
          for (const piece of arcToBeziers(cursorX, cursorY, args[0], args[1],
            args[2] * Math.PI / 180, args[3], args[4], endX, endY)) curve(piece);
          cursorX = endX;
          cursorY = endY;
        }
        handle = nextHandle;
      }
    }
    return this;
  };

  /**
   * A character's emblem, from the same SVG markup the page draws: each
   * path, circle and ellipse in order, stroked unless it says not to and
   * filled where it asks to be, a translucent fill mixed against `paper`.
   */
  Doc.prototype.emblem = function (markup, options) {
    const o = options || {};
    const scale = o.size / 48;
    const px = x => o.x + x * scale;
    const py = y => PAGE.height - (o.top + y * scale);
    const color = o.color || ACCENT;
    const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : null; };
    for (const tag of String(markup || '').match(/<(path|circle|ellipse)\b[^>]*>/g) || []) {
      let data = attr(tag, 'd');
      if (!data) {
        const cx = Number(attr(tag, 'cx'));
        const cy = Number(attr(tag, 'cy'));
        const rx = Number(attr(tag, 'r') || attr(tag, 'rx'));
        const ry = Number(attr(tag, 'r') || attr(tag, 'ry'));
        if (!rx || !ry) continue;
        data = 'M' + (cx - rx) + ' ' + cy + 'A' + rx + ' ' + ry + ' 0 1 0 ' + (cx + rx) + ' ' + cy +
          'A' + rx + ' ' + ry + ' 0 1 0 ' + (cx - rx) + ' ' + cy + 'Z';
      }
      const fills = attr(tag, 'fill') === 'currentColor';
      const strokes = attr(tag, 'stroke') !== 'none';
      if (fills) {
        const opacity = attr(tag, 'fill-opacity');
        this.setFill(opacity === null ? color : mix(o.paper || WHITE, color, Number(opacity)));
        this.tracePath(data, px, py);
        this.op('f');
      }
      if (strokes) {
        this.setStroke(color);
        this.op(num(2.4 * scale) + ' w 1 J 1 j');
        this.tracePath(data, px, py);
        this.op('S');
      }
    }
    return this;
  };

  /** One SVG elliptical arc → a list of cubic béziers, each three points. */
  function arcToBeziers(x1, y1, rxInput, ryInput, phi, largeArc, sweep, x2, y2) {
    let rx = Math.abs(rxInput);
    let ry = Math.abs(ryInput);
    if (!rx || !ry || (x1 === x2 && y1 === y2)) return [];
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    // Scale the radii up if they are too small to span the two endpoints.
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const grow = Math.sqrt(lambda);
      rx *= grow;
      ry *= grow;
    }

    const rxs = rx * rx;
    const rys = ry * ry;
    const numerator = rxs * rys - rxs * y1p * y1p - rys * x1p * x1p;
    const denominator = rxs * y1p * y1p + rys * x1p * x1p;
    const factor = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numerator / denominator));
    const cxp = factor * (rx * y1p) / ry;
    const cyp = factor * -(ry * x1p) / rx;
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    const start = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
    let sweepAngle = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - start;
    if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
    if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

    // A bézier approximates at most a quarter turn well, so split accordingly.
    const pieces = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
    const step = sweepAngle / pieces;
    const handle = (4 / 3) * Math.tan(step / 4);
    const at = angle => [
      cx + rx * cosPhi * Math.cos(angle) - ry * sinPhi * Math.sin(angle),
      cy + rx * sinPhi * Math.cos(angle) + ry * cosPhi * Math.sin(angle),
    ];
    const slope = angle => [
      -rx * cosPhi * Math.sin(angle) - ry * sinPhi * Math.cos(angle),
      -rx * sinPhi * Math.sin(angle) + ry * cosPhi * Math.cos(angle),
    ];

    const curves = [];
    for (let piece = 0; piece < pieces; piece++) {
      const from = start + piece * step;
      const to = from + step;
      const p0 = at(from);
      const p3 = at(to);
      const d0 = slope(from);
      const d3 = slope(to);
      curves.push([
        [p0[0] + handle * d0[0], p0[1] + handle * d0[1]],
        [p3[0] - handle * d3[0], p3[1] - handle * d3[1]],
        p3,
      ]);
    }
    return curves;
  }

  Doc.prototype.hairline = function (top, from, to, color) {
    this.setStroke(color || LINE);
    return this.op('0.7 w ' + num(from) + ' ' + num(PAGE.height - top) + ' m ' +
      num(to) + ' ' + num(PAGE.height - top) + ' l S');
  };

  /**
   * One line of text at a baseline measured from the top of the page.
   * Everything else in the layout is built out of this.
   */
  Doc.prototype.draw = function (encoded, x, baselineTop, style) {
    if (!encoded) return this;
    const size = style.size;
    this.setFill(style.color || INK);
    const font = style.bold ? '/F2' : (style.italic ? '/F3' : '/F1');
    this.op('BT');
    if (style.tracking) this.op(num(style.tracking) + ' Tc');
    this.op(font + ' ' + num(size) + ' Tf');
    this.op(num(x) + ' ' + num(PAGE.height - baselineTop) + ' Td');
    this.op('(' + encoded.replace(/([\\()])/g, '\\$1') + ') Tj');
    if (style.tracking) this.op('0 Tc');
    return this.op('ET');
  };

  /** Greedy wrap of already-encoded text. */
  function wrap(encoded, width, style) {
    const words = encoded.split(' ').filter(w => w.length);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (line && measure(candidate, style.size, style.bold, style.tracking) > width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  // ---------- report layout ----------
  //
  // This mirrors the profile page section for section, in the same order, with
  // the same titles, sub-lines and empty-state wording — all of which come from
  // copy.js so the two renderings cannot drift. The screen's cards become rules
  // and whitespace, and its emoji section glyphs are dropped (Helvetica has no
  // slot for them), but nothing is added and nothing is left out.

  // Resolved at build time rather than at load: copy.js and this file are two
  // separate script tags and nothing guarantees which lands first.
  let Copy = null;
  let TEXT = null;
  let TRAIT_LABELS = null;
  let MODE_LABELS = null;

  function bindCopy() {
    Copy = root.PsycheCopy;
    TEXT = Copy.TEXT;
    TRAIT_LABELS = Copy.TRAIT_LABELS;
    MODE_LABELS = Copy.MODE_LABELS;
  }

  function Report(doc, meta) {
    this.doc = doc;
    this.meta = meta;
    // Filled by sectionTitle as each one is laid out, and read back by
    // coverContents once the whole report exists. Collected rather than
    // declared up front so the list cannot claim a section the reader did not
    // pay for, or miss one added later — it is a record of what printed.
    this.contents = [];
    // The column text is set in. A box narrows it for whatever it holds, so
    // the same helpers lay out full width and inside a card alike.
    this.x = MARGIN;
    this.w = COLUMN;
  }

  Report.prototype.space = function (amount) {
    this.doc.y += amount;
    return this;
  };

  /** Start a new page when the next block will not fit. */
  Report.prototype.need = function (height) {
    if (this.doc.y + height > PAGE.height - MARGIN - 26) this.page();
    return this;
  };

  /**
   * Draws a block so that it starts on the page it ends on. It is drawn once;
   * if that spilled over a page break, everything it drew is taken back and it
   * is drawn again from the top of a fresh page. A heading drawn inside the
   * same block goes with it, so no heading is left at the foot of a page with
   * its first content overleaf. A block that started at the top of a page
   * stays where it is — a fresh page would not hold it either.
   */
  Report.prototype.keep = function (draw) {
    const doc = this.doc;
    const top = MARGIN + 34;
    const bottom = PAGE.height - MARGIN - 26;
    const before = { pages: doc.pages.length, length: doc.buffer.length, y: doc.y, contents: this.contents.length };
    const outerTitled = this.titled;
    this.titled = false;
    draw();
    const titled = this.titled;
    this.titled = outerTitled || titled;
    if (doc.pages.length === before.pages || before.y <= top + 6) return this;
    // How it broke: the room it had on its first page, and what ran over.
    const room = bottom - before.y;
    const spilled = doc.pages.length - before.pages;
    const tail = doc.y - top;
    const height = room + (spilled - 1) * (bottom - top) + tail;
    // Taller than a page, it has to break somewhere: leave it.
    if (height > bottom - top) return this;
    // A card that breaks with a fair share on each side stays as it fell —
    // its card continues overleaf (see `boxed`). A heading must keep a third
    // of a page of its own content under it, and no scrap is left on either side.
    if (room >= (titled ? 200 : 120) && tail >= 90) return this;
    doc.pages.length = before.pages;
    doc.buffer = doc.pages[before.pages - 1].content;
    doc.buffer.length = before.length;
    doc.pageNumber = before.pages;
    doc.y = before.y;
    this.contents.length = before.contents;
    this.page();
    this.titled = false;
    draw();
    this.titled = outerTitled || this.titled;
    return this;
  };

  /**
   * Draws a block inside a card: the column narrows by the padding, the block
   * is drawn, and the card is slipped in underneath it at the height it came
   * to. `bar` colours the card's left edge, `top` its top edge. A block that
   * ran onto another page is left without its card rather than given half of
   * one — `keep` around it stops that happening at all.
   */
  Report.prototype.boxed = function (draw, options) {
    const o = options || {};
    const doc = this.doc;
    const pad = o.pad === undefined ? 12 : o.pad;
    const edge = o.bar ? 3.5 : 0;
    const radius = o.radius || 10;
    const box = { x: this.x, w: this.w, top: doc.y, page: doc.pageNumber, at: doc.buffer.length };
    this.x += pad + edge;
    this.w -= pad * 2 + edge;
    doc.y += o.padTop === undefined ? pad : o.padTop;
    draw();
    this.x = box.x;
    this.w = box.w;
    doc.y += pad;
    // The card, slipped in under what it holds — one piece per page the
    // block touched, so a card that ran over a break continues overleaf.
    for (let n = box.page; n <= doc.pageNumber; n++) {
      const first = n === box.page;
      const last = n === doc.pageNumber;
      const top = first ? box.top : MARGIN + 34 - pad;
      const height = (last ? doc.y : PAGE.height - MARGIN - 20) - top;
      const content = doc.buffer;
      doc.buffer = [];
      if (o.shadow) doc.roundRect(box.x + 1, top + 2.5, box.w, height, radius, LINE);
      if (o.bar) doc.roundRect(box.x, top, box.w, height, radius, o.bar);
      const strip = first && o.top ? 3.5 : 0;
      if (strip) doc.roundRect(box.x, top, box.w, height, radius, o.top);
      doc.roundRect(box.x + edge, top + strip, box.w - edge, height - strip, radius, o.fill || WHITE);
      const card = doc.buffer;
      doc.buffer = content;
      const page = doc.pages[n - 1];
      page.content.splice(first ? box.at : (page.bodyAt || 0), 0, ...card);
    }
    doc.y += o.gap === undefined ? 8 : o.gap;
    return this;
  };

  Report.prototype.page = function () {
    this.doc.newPage();
    // Running head, so a printed page found on its own still says whose it is
    // and where it came from: the lockup on the left, the subject's name on the
    // right. The mark and wordmark keep the cover's proportions — the cover
    // offsets its wordmark by 26 against a 19pt mark, so a 13pt mark here takes
    // 18 — and the wordmark sits on the same baseline as the name opposite it.
    this.doc.svgPaths(Copy.BRAND_MARK, { x: MARGIN, top: MARGIN - 9, size: 13, color: ACCENT });
    this.doc.draw(toWinAnsi('PsycheAI'), MARGIN + 18, MARGIN, { size: 9, bold: true, color: ACCENT });
    // The structured layout adds the date, so a loose page says when as well
    // as whose. The classic report passes no date and prints as it always did.
    const who = toWinAnsi(this.meta.name + (this.meta.date ? '  ·  ' + this.meta.date : ''));
    const width = measure(who, 8, false);
    this.doc.draw(who, PAGE.width - MARGIN - width, MARGIN, { size: 8, color: SOFT });
    this.doc.hairline(MARGIN + 6, MARGIN, PAGE.width - MARGIN);
    this.doc.y = MARGIN + 34;
    // Where a card continued from the page before slips in, under the text.
    this.doc.pages[this.doc.pages.length - 1].bodyAt = this.doc.buffer.length;
    return this;
  };

  /**
   * Body text. Handles blank-line-separated paragraphs, and will break across
   * a page boundary mid-paragraph rather than leaving a hole.
   */
  Report.prototype.body = function (text, options) {
    const settings = options || {};
    const style = {
      size: settings.size || 10,
      bold: Boolean(settings.bold),
      italic: Boolean(settings.italic),
      color: settings.color || INK,
    };
    const leading = settings.leading || style.size * 1.5;
    const x = settings.x === undefined ? this.x : settings.x;
    const width = settings.width === undefined ? this.w : settings.width;
    const paragraphs = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    paragraphs.forEach((paragraph, index) => {
      if (index) this.space(leading * 0.45);
      for (const line of wrap(toWinAnsi(paragraph), width, style)) {
        this.need(leading);
        this.doc.draw(line, x, this.doc.y + style.size * 0.82, style);
        this.doc.y += leading;
      }
    });
    return this;
  };

  Report.prototype.fineprint = function (text) {
    if (!text) return this;
    this.space(4);
    return this.body(text, { size: 8.6, color: SOFT, leading: 12.4 });
  };

  Report.prototype.muted = function (text) {
    return this.body(text, { size: 9.8, color: SOFT, leading: 14 });
  };

  /** A small tracked-out label, the typographic workhorse of the whole thing. */
  Report.prototype.eyebrow = function (text, color) {
    this.need(16);
    this.doc.draw(toWinAnsi(String(text).toUpperCase()), this.x, this.doc.y + 8,
      { size: 7.5, bold: true, color: color || ACCENT_2, tracking: 1.2 });
    this.doc.y += 15;
    return this;
  };

  /** A section head: the page's card-head, minus the glyph. */
  Report.prototype.sectionTitle = function (title, sub) {
    // Keep a title with the first real block of what follows, not merely with
    // its own sub-line. At 130 the reserve covered the title, the rule and the
    // sub and nothing else, so "Big Five" and its "0-100, where 50 is average"
    // line sat alone at the foot of a page with the first trait overleaf —
    // technically satisfied and visibly a widow. The tallest opening block in
    // the report is a Big Five trait at 84, hence the reserve here.
    this.need(this.titleReserve || (sub ? 214 : 184));
    this.titled = true;
    // Recorded after `need`, never before: the reserve above is what decides
    // which page this title lands on, so asking earlier would file half the
    // sections under the page they were nearly on.
    if (!this.partsOnly) this.contents.push({ title: String(title), page: this.doc.pageNumber });
    this.space(14);
    const style = { size: 18, bold: true, color: INK };
    for (const line of wrap(toWinAnsi(title), COLUMN, style)) {
      this.doc.draw(line, MARGIN, this.doc.y + 14, style);
      this.doc.y += 23;
    }
    this.space(3);
    this.doc.hairline(this.doc.y, MARGIN, MARGIN + 46, ACCENT);
    this.doc.hairline(this.doc.y, MARGIN + 46, PAGE.width - MARGIN, LINE);
    this.space(11);
    if (sub) {
      this.body(sub, { size: 9.4, color: SOFT, leading: 13.4 });
      this.space(5);
    }
    return this;
  };

  /** A heading inside a section — the page's h3. */
  Report.prototype.h3 = function (text, color) {
    const style = { size: 11.5, bold: true, color: color || INK };
    // Wrapped, because "Attachment: " carries the model's phrase for the style
    // and that is not always short.
    const lines = wrap(toWinAnsi(text), this.w, style);
    this.titled = true;
    this.need(26 + lines.length * 17);
    this.space(9);
    for (const line of lines) {
      this.doc.draw(line, this.x, this.doc.y + 9, style);
      this.doc.y += 17;
    }
    return this;
  };

  /** A ticked list item — the page's `ul.ticks`. */
  Report.prototype.bullet = function (text) {
    const style = { size: 10, color: INK };
    const lines = wrap(toWinAnsi(text), COLUMN - 16, style);
    lines.forEach((line, index) => {
      this.need(15);
      if (!index) this.doc.rect(MARGIN + 3, this.doc.y + 5.5, 3.2, 3.2, ACCENT_2);
      this.doc.draw(line, MARGIN + 16, this.doc.y + 8.2, style);
      this.doc.y += 15;
    });
    return this;
  };

  /** Title-and-detail pair: the page's definition lists. */
  Report.prototype.point = function (title, detail, options) {
    const o = options || {};
    const style = { size: o.size || 10.5, bold: true, color: INK };
    // These titles are not always a few words: an activity observation is a
    // full sentence, and an unwrapped one ran off the side of the page.
    const lines = wrap(toWinAnsi(title), this.w - 20, style);
    this.need(26 + lines.length * 15);
    this.space(3);
    if (o.bar !== false) this.doc.rect(this.x, this.doc.y, 2.5, lines.length * 15 - 3, o.bar || ACCENT);
    const indent = o.bar === false ? 0 : 10;
    for (const line of lines) {
      this.doc.draw(line, this.x + indent, this.doc.y + 8.5, style);
      this.doc.y += 15;
    }
    if (detail) this.body(detail, { x: this.x + indent, width: this.w - indent, size: o.detailSize || 9.8, color: o.detailColor || SOFT, leading: o.detailLeading || 14 });
    this.space(4);
    return this;
  };

  Report.prototype.points = function (items) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return this.muted(TEXT.pointsEmpty);
    for (const item of values) this.point(item.title, item.detail);
    return this;
  };

  /** A 0-100 bar with its label and number, as the trait rows are on screen. */
  Report.prototype.bar = function (label, score) {
    this.need(30);
    const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const readout = toWinAnsi(String(value));
    const readoutWidth = measure(readout, 9.5, true);
    this.doc.draw(toWinAnsi(label), MARGIN, this.doc.y + 8, { size: 10.5, bold: true, color: INK });
    this.doc.draw(readout, PAGE.width - MARGIN - readoutWidth, this.doc.y + 8,
      { size: 9.5, bold: true, color: ACCENT });
    const track = this.doc.y + 14;
    this.doc.roundRect(MARGIN, track, COLUMN, 5, 2.5, LINE);
    if (value > 0) this.doc.roundRect(MARGIN, track, Math.max(5, COLUMN * value / 100), 5, 2.5, ACCENT);
    this.doc.y += 26;
    return this;
  };

  /**
   * The page's pill rows — trait evidence, the signals an attachment read came
   * from, the card's interests. Short ones pack side by side; one too long for
   * the column gets its own box with the text wrapped inside, which is what the
   * flex row does on screen.
   */
  Report.prototype.tags = function (items, options) {
    const settings = options || {};
    // `small` is supporting evidence: a size down from the text it supports,
    // so the finding reads first and the proof under it reads as proof.
    const size = settings.small ? 7.6 : (settings.size || 9);
    const chipH = settings.small ? 13.5 : 16;
    const step = chipH + (settings.small ? 3.5 : 4);
    const fill = settings.fill || WASH;
    const ink = settings.color || SOFT;
    const left = settings.x === undefined ? this.x : settings.x;
    const width = settings.width === undefined ? this.w : settings.width;
    const list = (items || []).map(item => toWinAnsi(item)).filter(Boolean);
    if (!list.length) return this;
    let x = left;
    let rowOpen = false;
    for (const item of list) {
      const chipWidth = measure(item, size, false) + (settings.small ? 13 : 16);
      if (chipWidth > width) {
        // Too wide to be a chip: close the row and give it a wrapped box.
        if (rowOpen) { this.doc.y += step; rowOpen = false; x = left; }
        const style = { size, color: ink };
        const leading = settings.small ? 10.6 : 12.6;
        const lines = wrap(item, width - 20, style);
        const height = lines.length * leading + (settings.small ? 7 : 10);
        this.need(height + 4);
        this.doc.roundRect(left, this.doc.y, width, height, 6, fill);
        let inner = this.doc.y + (settings.small ? 3.5 : 5);
        for (const line of lines) {
          this.doc.draw(line, left + (settings.small ? 7 : 10), inner + size, style);
          inner += leading;
        }
        this.doc.y += height + 4;
        continue;
      }
      if (!rowOpen) { this.need(step + 4); rowOpen = true; }
      if (x > left && x + chipWidth > left + width) {
        this.doc.y += step;
        this.need(step + 4);
        x = left;
      }
      this.doc.roundRect(x, this.doc.y, chipWidth, chipH, chipH / 2, fill);
      this.doc.draw(item, x + (settings.small ? 6.5 : 8), this.doc.y + (settings.small ? 9.4 : 11.4), { size, color: ink });
      x += chipWidth + (settings.small ? 4 : 5);
    }
    if (rowOpen) this.doc.y += step;
    this.space(4);
    return this;
  };

  /** One of the page's tiles: a title, an optional pill, detail, evidence. */
  Report.prototype.tile = function (title, pill, detail, evidence) {
    const titleStyle = { size: 10.8, bold: true, color: INK };
    const detailStyle = { size: 9.8, color: INK };
    const evidenceStyle = { size: this.small ? 8 : 8.8, color: SOFT };
    const label = pill ? toWinAnsi(pill) : '';
    const labelWidth = label ? measure(label, 8, true, 0.6) + 12 : 0;
    const titleLines = wrap(toWinAnsi(title), COLUMN - 28 - labelWidth, titleStyle);
    const detailLines = detail ? wrap(toWinAnsi(detail), COLUMN - 28, detailStyle) : [];
    const evidenceLines = evidence ? wrap(toWinAnsi(evidence), COLUMN - 28, evidenceStyle) : [];
    const evidenceLeading = this.small ? 11.4 : 12.4;
    const height = 12 + titleLines.length * 15 + detailLines.length * 14 +
      (evidenceLines.length ? 4 + evidenceLines.length * evidenceLeading : 0) + 12;

    this.need(height + 8);
    this.doc.roundRect(MARGIN, this.doc.y, COLUMN, height, 10, WHITE);
    this.doc.rect(MARGIN, this.doc.y, 2.5, height, ACCENT);
    let inner = this.doc.y + 10;
    if (label) {
      this.doc.draw(label, PAGE.width - MARGIN - 14 - (labelWidth - 12), inner + 8,
        { size: 8, bold: true, color: ACCENT, tracking: 0.6 });
    }
    for (const line of titleLines) {
      this.doc.draw(line, MARGIN + 14, inner + 9, titleStyle);
      inner += 15;
    }
    for (const line of detailLines) {
      this.doc.draw(line, MARGIN + 14, inner + 9, detailStyle);
      inner += 14;
    }
    if (evidenceLines.length) {
      inner += 4;
      for (const line of evidenceLines) {
        this.doc.draw(line, MARGIN + 14, inner + 8, evidenceStyle);
        inner += evidenceLeading;
      }
    }
    this.doc.y += height + 8;
    return this;
  };

  /**
   * One MBTI axis: the lettered square, the pole it beat, the reasoning, and
   * what it looks like in their week. `counterEvidence` is a legacy field —
   * the tempering lives inside `why` now — kept so a report saved while it was
   * separate still lays out with all its text.
   */
  Report.prototype.axis = function (letter, pole, strength, why, inPractice, counterEvidence, options) {
    const structured = Boolean(options && options.structured);
    const nameStyle = { size: 11.5, bold: true, color: INK };
    const whyStyle = { size: 9.8, color: INK, leading: 14 };
    this.need(76);
    this.space(6);
    const top = this.doc.y;
    const glyph = toWinAnsi(String(letter || '?'));
    this.doc.roundRect(this.x, top, 28, 28, 7, ACCENT);
    const glyphWidth = measure(glyph, 14, true);
    this.doc.draw(glyph, this.x + (28 - glyphWidth) / 2, top + 19, { size: 14, bold: true, color: WHITE });

    const textLeft = this.x + 40;
    const textWidth = this.w - 40;
    if (strength && structured) {
      // How firmly, in a pill: the firmer the letter, the stronger the fill.
      const label = toWinAnsi(String(strength).toLowerCase());
      const width = measure(label, 8, true) + 16;
      const firm = String(strength).toLowerCase() === 'clear';
      this.doc.roundRect(this.x + this.w - width, top, width, 15, 7.5, firm ? ACCENT : mix(ACCENT, WHITE, 0.85));
      this.doc.draw(label, this.x + this.w - width + 8, top + 10.3, { size: 8, bold: true, color: firm ? WHITE : ACCENT });
    } else if (strength) {
      const label = toWinAnsi(strength);
      const width = measure(label, 8, true, 0.8);
      this.doc.draw(label, this.x + this.w - width, top + 9,
        { size: 8, bold: true, color: ACCENT, tracking: 0.8 });
    }
    this.doc.draw(toWinAnsi(pole.name), textLeft, top + 10, nameStyle);
    let cursor = top + 14;
    if (pole.against) {
      this.doc.draw(toWinAnsi(TEXT.mbtiOver + pole.against), textLeft, cursor + 12,
        { size: 9, color: SOFT });
      cursor += 14;
    }
    this.doc.y = cursor + 6;
    if (why) this.body(why, { x: textLeft, width: textWidth, size: whyStyle.size, leading: whyStyle.leading });
    // Only a report saved before the tempering was merged into `why` still
    // carries this separately; set in the same style rather than as an aside,
    // since it is the second half of one analysis.
    if (counterEvidence) {
      this.body(counterEvidence,
        { x: textLeft, width: textWidth, size: whyStyle.size, leading: whyStyle.leading });
    }
    if (inPractice && structured) {
      // What the letter looks like in their week, set off as a quote: a bar
      // down its side, a size up from an aside and in the letter's colour.
      this.space(6);
      const start = this.doc.y;
      const page = this.doc.pageNumber;
      this.body(inPractice, { x: textLeft + 10, width: textWidth - 10, size: 9.4, italic: true, color: ACCENT, leading: 13.4 });
      if (this.doc.pageNumber === page) this.doc.roundRect(textLeft, start + 1, 2.5, this.doc.y - start - 3, 1.25, mix(ACCENT, WHITE, 0.55));
    } else if (inPractice) {
      this.space(3);
      this.body(inPractice, { x: textLeft, width: textWidth, size: this.small ? 8.5 : 9.4, color: SOFT, leading: this.small ? 12.2 : 13.4 });
    }
    this.space(3);
    return this;
  };

  // The four MBTI pairs in their usual order, the first of each on the left.
  const MBTI_PAIRS = [['E', 'I'], ['N', 'S'], ['T', 'F'], ['J', 'P']];
  // How far from the middle a letter's marker sits, by how firmly it was picked.
  const MBTI_LEAN = { slight: 0.28, moderate: 0.6, clear: 0.9 };

  /**
   * The structured report's type, at a glance: the four letters at a reading
   * size with the type's nickname and confidence on the left, and on the
   * right each pair as a short spectrum, its marker leaning to the letter
   * picked and as far as it was picked — the letters themselves left to the
   * cards below rather than set at display size over the section.
   */
  Report.prototype.mbtiType = function (mbti, letters) {
    const doc = this.doc;
    const picked = {};
    for (const l of letters || []) if (l && l.choice) picked[l.choice] = l;
    const rows = MBTI_PAIRS.map(pair => ({ pair, letter: picked[pair[0]] || picked[pair[1]] })).filter(row => row.letter);
    this.need(110);
    this.boxed(() => {
      const top = doc.y;
      const L = this.x;
      const leftW = 132;
      doc.draw(toWinAnsi('YOUR TYPE'), L, top + 8, { size: 7.2, bold: true, color: SOFT, tracking: 1.3 });
      doc.draw(toWinAnsi(String(mbti.type || '')), L, top + 36, { size: 26, bold: true, color: ACCENT, tracking: 1.5 });
      let y = top + 52;
      if (mbti.nickname) { doc.draw(toWinAnsi(mbti.nickname), L, y, { size: 10, bold: true, color: INK }); y += 14; }
      if (mbti.confidence) doc.draw(toWinAnsi(TEXT.mbtiConfidence + mbti.confidence), L, y, { size: 8.4, color: SOFT });
      // The spectra, beside it.
      const R = L + leftW + 14;
      const RW = this.w - leftW - 14;
      const nameW = 64;
      const trackL = R + nameW + 8;
      const trackW = RW - 2 * (nameW + 8);
      const rowH = 20;
      const first = top + 6 + Math.max(0, (72 - rows.length * rowH) / 2);
      rows.forEach(({ pair, letter }, i) => {
        const cy = first + i * rowH + 8;
        const leftName = toWinAnsi((Copy.MBTI_POLES[pair[0]] || {}).name || pair[0]);
        const rightName = toWinAnsi((Copy.MBTI_POLES[pair[1]] || {}).name || pair[1]);
        const onLeft = letter.choice === pair[0];
        const style = chosen => ({ size: 8.2, bold: chosen, color: chosen ? ACCENT : SOFT });
        doc.draw(leftName, trackL - 8 - measure(leftName, 8.2, onLeft), cy + 3, style(onLeft));
        doc.draw(rightName, trackL + trackW + 8, cy + 3, style(!onLeft));
        doc.roundRect(trackL, cy - 2.5, trackW, 5, 2.5, mix(LINE, WHITE, 0.2));
        const mid = trackL + trackW / 2;
        doc.rect(mid - 0.4, cy - 4.5, 0.8, 9, mix(SOFT, WHITE, 0.45));
        const lean = MBTI_LEAN[String(letter.strength || '').toLowerCase()] || 0.6;
        const at = mid + (onLeft ? -1 : 1) * lean * trackW / 2;
        doc.roundRect(Math.min(mid, at), cy - 2.5, Math.abs(at - mid), 5, 2.5, mix(ACCENT, WHITE, 0.55));
        doc.circle(at, cy, 5.2, WHITE);
        doc.circle(at, cy, 4, ACCENT);
      });
      // As tall as the taller of the two columns, and no taller.
      doc.y = Math.max(y + 4, first + rows.length * rowH - 2);
    }, { fill: WASH, pad: 14 });
    return this;
  };

  /** One behaviour facet: its fixed label, the model's headline, the detail. */
  Report.prototype.facet = function (label, headline, detail) {
    this.need(60);
    this.space(6);
    this.doc.draw(toWinAnsi(String(label).toUpperCase()), MARGIN, this.doc.y + 8,
      { size: 7.2, bold: true, color: ACCENT_2, tracking: 1.1 });
    this.doc.y += 14;
    if (headline) {
      const style = { size: 11.2, bold: true, color: INK };
      for (const line of wrap(toWinAnsi(headline), COLUMN, style)) {
        this.need(16);
        this.doc.draw(line, MARGIN, this.doc.y + 9, style);
        this.doc.y += 16;
      }
    }
    if (detail) this.body(detail, { size: 9.8, leading: 14 });
    this.space(4);
    return this;
  };

  /** A tinted box: the page's callout, and its fineprint caveats. */
  Report.prototype.note = function (text, label) {
    const encoded = toWinAnsi(text);
    const style = { size: 9.2, color: SOFT, italic: true };
    const lines = wrap(encoded, COLUMN - 44, style);
    const height = lines.length * 13 + (label ? 14 : 0) + 18;
    this.need(height + 6);
    this.doc.roundRect(MARGIN, this.doc.y, COLUMN, height, 8, WASH);
    this.doc.rect(MARGIN, this.doc.y, 2.5, height, ACCENT_2);
    let cursor = this.doc.y + 9;
    if (label) {
      this.doc.draw(toWinAnsi(String(label).toUpperCase()), MARGIN + 16, cursor + 7,
        { size: 7.5, bold: true, color: ACCENT_2, tracking: 1.1 });
      cursor += 14;
    }
    for (const line of lines) {
      this.doc.draw(line, MARGIN + 16, cursor + 9, style);
      cursor += 13;
    }
    this.doc.y += height + 10;
    return this;
  };

  /** The match history table, minus the screen's "Open" link column. */
  Report.prototype.matchTable = function (history) {
    const columns = [
      { label: TEXT.matchWith, width: COLUMN * 0.34 },
      { label: TEXT.matchBasis, width: COLUMN * 0.3 },
      { label: TEXT.matchScore, width: COLUMN * 0.16 },
      { label: TEXT.matchWhen, width: COLUMN * 0.2 },
    ];
    this.need(48);
    this.space(4);
    let x = MARGIN;
    for (const column of columns) {
      this.doc.draw(toWinAnsi(String(column.label).toUpperCase()), x, this.doc.y + 8,
        { size: 7.2, bold: true, color: SOFT, tracking: 1 });
      x += column.width;
    }
    this.doc.y += 13;
    this.doc.hairline(this.doc.y, MARGIN, PAGE.width - MARGIN);
    this.doc.y += 4;
    for (const entry of history) {
      this.need(22);
      const mode = entry.mode || (entry.report && entry.report.mode) || 'romantic';
      const score = Math.round(Number(entry.report && entry.report.score) || 0);
      const cells = [
        { text: entry.withName || '', bold: true, color: INK },
        { text: MODE_LABELS[mode] || mode, color: SOFT },
        { text: String(score), bold: true, color: ACCENT },
        { text: entry.when ? new Date(entry.when).toLocaleDateString() : '', color: SOFT },
      ];
      x = MARGIN;
      cells.forEach((cell, index) => {
        const style = { size: 9.6, bold: Boolean(cell.bold), color: cell.color };
        const line = wrap(toWinAnsi(cell.text), columns[index].width - 8, style)[0];
        this.doc.draw(line, x, this.doc.y + 9, style);
        x += columns[index].width;
      });
      this.doc.y += 17;
      this.doc.hairline(this.doc.y - 4, MARGIN, PAGE.width - MARGIN);
    }
    this.space(8);
    return this;
  };

  // ---------- the cover ----------
  //
  // The band carried the brand, the title and a line of provenance, and then
  // roughly 70pt of empty purple where a headline used to be — the first page
  // of a paid report opened on dead space and a section heading. It is a real
  // cover now: the same summary card the reader sees on screen, printed at the
  // top of page one, with the report starting on page two.
  //
  // The card is the one object in this product people actually share, so it is
  // the right thing for the document to open on — and the only page in the PDF
  // that a reader might screenshot rather than read.

  /**
   * A labelled column inside the card: the small tracked caps, then its lines.
   * Returns the height it will take, so the caller can size a row from the
   * tallest column before anything is drawn.
   */
  function cardColumn(doc, x, top, width, label, lines, options) {
    const settings = options || {};
    const style = settings.style || { size: 9.6, bold: true, color: INK };
    const leading = settings.leading || 12.6;
    const lead = settings.lead || '';
    const leadHeight = lead ? 14 : 0;
    if (doc) {
      doc.draw(toWinAnsi(String(label).toUpperCase()), x, top + 7,
        { size: 6.8, bold: true, color: settings.labelColor || SOFT, tracking: 1 });
      if (lead) doc.draw(lead, x, top + 20, { size: 11.5, bold: true, color: INK });
      let cursor = top + 20 + leadHeight;
      for (const line of lines) {
        doc.draw(line, x, cursor, style);
        cursor += leading;
      }
    }
    return 20 + leadHeight + lines.length * leading;
  }

  function psycheCard(doc, report, card, top, structured) {
    const essence = report.essence || {};
    // `noun` is what this field was called before it held a character, so a
    // profile saved before that change still prints a name here.
    const name = essence.character || essence.noun || '';
    const franchise = essence.franchise || '';
    // The same four sentences the on-screen card shows. `cardBlurb()` in
    // app.js has two further fallbacks for reports written before
    // `cardHighlights` existed, but both of them stitch text out of fields
    // this file would have to re-derive; `card.summary` is the shaped card's
    // own line and is never empty, so it is the one fallback kept here.
    const fullBlurb = String(report.cardHighlights || card.summary || '').trim();
    // The structured card's write-up is two sentences on why they are like the
    // character; a report written before that keeps its first two, as the
    // story card on the page does.
    const blurb = structured
      ? (fullBlurb.match(/[^.!?]+[.!?]+["'’”)]*(\s+|$)/g) || [fullBlurb]).slice(0, 2).join('').trim()
      : fullBlurb;
    const mbti = report.mbti || {};
    const enneagram = report.enneagram || {};
    const five = report.bigFive || {};
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const confidence = Number((card || {}).confidence);

    const padX = 22;
    const innerW = COLUMN - padX * 2;

    // ---- measure the head before drawing it, so its panel can be filled first
    //
    // The card was a purple slab with a magenta wedge across its foot, which is
    // exactly what the band above it is. Two of them stacked read as one
    // continuous block of colour with a page title floating in it, and the
    // card — the thing actually worth looking at — lost any identity of its
    // own.
    //
    // So it is paper now and the band keeps the colour. The contrast does the
    // work the repetition was undoing: a saturated masthead, then a light card
    // lifted off the page beneath it. The accent survives as detailing rather
    // than as a fill — a rule across the top, the character's name set in it,
    // the eyebrow in the second brand colour — which is quieter and, on a page
    // that is otherwise all text, considerably better looking.
    const nameStyle = { size: 26, bold: true, color: ACCENT };
    const franchiseStyle = { size: 9.8, color: SOFT };
    const blurbStyle = { size: 9.8, color: INK };
    const blurbLeading = 14.6;
    // Room kept clear on the right for the confidence pill, so a long character
    // name cannot run underneath it.
    const nameLines = wrap(toWinAnsi(name), innerW - 72, nameStyle);
    // Capped rather than trusted: `cardHighlights` is four sentences by schema,
    // but a model that ignored that must not push the card off the page.
    const blurbLines = wrap(toWinAnsi(blurb), innerW, blurbStyle).slice(0, 9);
    const heroH = 30 + 14 + nameLines.length * 30 + (franchise ? 15 : 0) +
      (blurbLines.length ? 10 + blurbLines.length * blurbLeading : 0) + 16;

    // ---- measure the three rows underneath it ----
    const letters = (mbti.letters || []).map(l => toWinAnsi(structured
      ? String(l.choice || '') + '  ' + ((Copy.MBTI_POLES[l.choice] || {}).name || '') + (l.strength ? ' · ' + l.strength : '')
      : String(l.choice || '') + '  ' + String(l.strength || '')));
    const enneagramBadge = enneagram.type && !structured
      ? String(enneagram.type) + (enneagram.wing ? 'w' + enneagram.wing : '') : '';
    // The structured layout has no Enneagram: its column holds the signature
    // patterns, numbered as the report numbers them.
    const patternLines = structured
      ? (Array.isArray(report.patterns) ? report.patterns : [])
        .filter(p => p && /^p[1-3]$/.test(p.id) && p.name)
        .sort((a, b) => a.id.localeCompare(b.id))
        .flatMap(p => wrap(toWinAnsi(p.id.replace('p', '') + '  ' + p.name), innerW / 2 - 12, { size: 9, bold: true }))
      : [];
    // Extraversion is the E of the type beside it, so the structured card
    // leaves it out of the Big Five, as the story card does.
    const fiveRows = Object.keys(TRAIT_LABELS)
      .filter(key => five[key] && !(structured && key === 'extraversion'))
      .map(key => toWinAnsi(TRAIT_LABELS[key] + '  ' + Math.round(Number(five[key].score) || 0)));

    const third = innerW / 3;
    const titles = (rows, limit) => (rows || []).slice(0, limit)
      .map(r => (r && (r.title || r.name || r.value || r.belief)) || '').filter(Boolean);
    const wrapCell = (text, width, style) =>
      text ? wrap(toWinAnsi(text), width - 10, style || { size: 9.6, color: INK }) : [];

    const smallStyle = { size: 9, color: INK };
    // The four-letter type leads its own column in bold, with the per-axis
    // strengths under it in plain — the same split the on-screen card makes,
    // where the code is the finding and the strengths are how firmly each
    // letter was picked. Drawn as a `lead` rather than as another line, so the
    // two weights cannot be confused for one list.
    const typeCell = { label: TEXT.cardType, lead: mbti.type && !structured ? toWinAnsi(mbti.type) : '',
      lines: letters, style: { size: structured ? 9 : 9.2, color: INK }, leading: 12 };
    const fiveCell = { label: TEXT.cardBigFive, lines: fiveRows, style: { size: 9, color: INK }, leading: structured ? 12 : 11.6 };
    // Structured: the story card's rows — the patterns beside what motivates
    // them, then the type beside the Big Five.
    const motiveKeys = (() => {
      const known = Copy.STRUCTURED.motivators;
      const named = (report.topMotivators || []).filter(key => known[key]);
      if (named.length) return named.slice(0, 3);
      return ((report.motivators && report.motivators.scores) || []).filter(row => row && known[row.value])
        .slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(row => row.value);
    })();
    const motiveLines = motiveKeys.flatMap((key, i) =>
      wrap(toWinAnsi((i + 1) + '  ' + Copy.STRUCTURED.motivators[key].label), innerW / 2 - 12, { size: 9, bold: true }));
    const leadCells = structured
      ? [{ label: TEXT.cardPatterns, lines: patternLines, style: { size: 9, bold: true, color: INK }, leading: 12 },
        { label: Copy.STRUCTURED.titles.motivators, lines: motiveLines, style: { size: 9, bold: true, color: INK }, leading: 12 }]
      : [];
    const statCells = structured
      ? [typeCell, fiveCell]
      : [typeCell, { label: TEXT.cardEnneagram, lead: enneagramBadge ? toWinAnsi(enneagramBadge) : '',
        lines: [enneagram.nickname && toWinAnsi(enneagram.nickname)].filter(Boolean) }, fiveCell];
    // Structured: values and beliefs as one "what you stand for", beside what
    // they are into — the story card's two panels.
    const chipCells = structured
      ? [{ label: Copy.STRUCTURED.cardStandFor, style: smallStyle,
        lines: wrapCell(titles(report.values, 3).concat(titles(report.beliefs, 1)).slice(0, 4).join(' · '), innerW / 2, smallStyle) },
      { label: Copy.STRUCTURED.cardInto, style: smallStyle,
        lines: wrapCell(titles(report.interests, 3).join(' · '), innerW / 2, smallStyle) }]
      : [
        { label: TEXT.cardValues, lines: wrapCell(titles(report.values, 3).join(' · '), third, smallStyle), style: smallStyle },
        { label: TEXT.cardBeliefs, lines: wrapCell(titles(report.beliefs, 2).join(' · '), third, smallStyle), style: smallStyle },
        { label: TEXT.cardInterests, lines: wrapCell(titles(report.interests, 3).join(' · '), third, smallStyle), style: smallStyle },
      ];
    const chipWidth = innerW / chipCells.length;
    const loveNames = side => (side || []).slice(0, 2).map(l => l && l.language).filter(Boolean).join(' · ');
    const half = innerW / 2;
    const loveCells = [
      { label: TEXT.cardLoveIn, lines: wrapCell(loveNames(love.receiving), half, smallStyle), style: smallStyle },
      { label: TEXT.cardLoveOut, lines: wrapCell(loveNames(love.giving), half, smallStyle), style: smallStyle },
    ];

    const rowHeight = cells => Math.max(...cells.map(c =>
      cardColumn(null, 0, 0, 0, c.label, c.lines, c)));
    const leadH = leadCells.some(c => c.lines.length) ? rowHeight(leadCells) + 14 : 0;
    const statH = rowHeight(statCells) + 14;
    const chipH = chipCells.some(c => c.lines.length) ? rowHeight(chipCells) + 14 : 0;
    const loveH = loveCells.some(c => c.lines.length) ? rowHeight(loveCells) + 14 : 0;
    const bodyH = 8 + (leadH ? leadH + 1 : 0) + statH + (chipH ? chipH + 1 : 0) + (loveH ? loveH + 1 : 0) + 8;
    const totalH = heroH + bodyH;

    // ---- draw: shadow, card, accent rule, then all the text ----
    //
    // A soft offset rectangle behind the card, which is the whole of the
    // "lifted off the page" effect — this writer has no shadow operator, and
    // three points of tint peeking out below the white does the job in print
    // as well as a real one would.
    doc.roundRect(MARGIN + 1, top + 3, COLUMN, totalH, 16, LINE);
    doc.roundRect(MARGIN, top, COLUMN, totalH, 16, WHITE);
    // The accent as a rule across the top rather than a slab behind
    // everything: drawn as a rounded rect so it follows the card's own top
    // corners, then cut back to five points with the card colour. A plain rect
    // would square the corners off against the rounded card and leave two
    // small notches of paper at the ends.
    doc.roundRect(MARGIN, top, COLUMN, 16, 16, ACCENT);
    doc.rect(MARGIN, top + 5, COLUMN, 11, WHITE);

    const x = MARGIN + padX;
    // The second brand colour, used once. It appears nowhere else on this page
    // except in the band's wedge, which is what keeps the two related without
    // the card copying the band outright.
    doc.draw(toWinAnsi(String(TEXT.essenceLabel).toUpperCase()), x, top + 32,
      { size: 6.8, bold: true, color: ACCENT_2, tracking: 1.1 });
    if (Number.isFinite(confidence) && confidence > 0) {
      // A pill rather than bare text: on paper the figure needs something to
      // sit in, or it reads as a stray number in the corner.
      const score = toWinAnsi(Math.round(confidence) + '/100');
      const width = measure(score, 9.4, true);
      const pillW = width + 18;
      doc.roundRect(MARGIN + COLUMN - padX - pillW, top + 20, pillW, 19, 9.5, WASH);
      doc.draw(score, MARGIN + COLUMN - padX - pillW + 9, top + 33,
        { size: 9.4, bold: true, color: ACCENT });
    }
    let cursor = top + 40;
    for (const line of nameLines) {
      doc.draw(line, x, cursor + 22, nameStyle);
      cursor += 30;
    }
    if (franchise) {
      doc.draw(toWinAnsi(franchise), x, cursor + 18, franchiseStyle);
      cursor += 15;
    }
    cursor += 10;
    for (const line of blurbLines) {
      doc.draw(line, x, cursor + 16, blurbStyle);
      cursor += blurbLeading;
    }
    // Separates the head from the rows the way the rows separate from each
    // other, so the card is one system of hairlines rather than a coloured
    // block sitting on top of a list.
    doc.hairline(top + heroH - 1, x, MARGIN + COLUMN - padX);

    let rowTop = top + heroH + 8;
    if (leadH) {
      leadCells.forEach((cell, i) => cardColumn(doc, x + i * innerW / 2, rowTop, innerW / 2, cell.label, cell.lines, cell));
      rowTop += leadH;
      doc.hairline(rowTop - 7, x, MARGIN + COLUMN - padX);
    }
    const statWidth = innerW / statCells.length;
    statCells.forEach((cell, i) => cardColumn(doc, x + i * statWidth, rowTop, statWidth, cell.label, cell.lines, cell));
    rowTop += statH;
    if (chipH) {
      doc.hairline(rowTop - 7, x, MARGIN + COLUMN - padX);
      chipCells.forEach((cell, i) => cardColumn(doc, x + i * chipWidth, rowTop, chipWidth, cell.label, cell.lines, cell));
      rowTop += chipH;
    }
    if (loveH) {
      doc.hairline(rowTop - 7, x, MARGIN + COLUMN - padX);
      loveCells.forEach((cell, i) => cardColumn(doc, x + i * half, rowTop, half, cell.label, cell.lines, cell));
      rowTop += loveH;
    }
    return top + totalH;
  }

  /**
   * The cover's contents list, drawn onto page one *after* the whole report
   * has been laid out.
   *
   * It has to be last, because the page numbers do not exist until the pages
   * do — and it has to be on page one, which was finished long before. Both
   * are satisfied by pointing the document's op buffer back at page one's own
   * array for the duration: `Doc.op` appends to `this.buffer` and nothing else
   * caches it, so swapping it is enough to write into a finished page. Drawn
   * at absolute coordinates rather than through `doc.y`, which by now belongs
   * to the last page.
   *
   * Skipped rather than squeezed when the card leaves no room — a long
   * character name and a full four-sentence blurb can push it down — because a
   * contents list colliding with the colophon is worse than no contents list.
   */
  function coverContents(doc, out, cardBottom) {
    const rows = out.contents;
    if (!rows.length) return;
    const rowHeight = 16.5;
    // 24 rather than 32. The card grew when it became a paper panel — bigger
    // name, roomier blurb leading — and the list, which only draws when it
    // fits above the colophon, was missing the guard below by about three
    // points and silently not drawing at all. The gap is the cheapest thing on
    // the page to give back, and there is more than enough clearance beneath
    // the list either way.
    const top = cardBottom + 24;
    // Two columns past six entries. A full report runs to a dozen sections,
    // and a single column of those is taller than the space the card leaves —
    // the list simply never drew. Splitting it halves the height and fills the
    // foot of the cover rather than stacking down past the colophon.
    const columns = rows.length > 6 ? 2 : 1;
    const perColumn = Math.ceil(rows.length / columns);
    const columnWidth = COLUMN / columns;
    const needed = 22 + perColumn * rowHeight;
    if (top + needed > PAGE.height - MARGIN - 26) return;

    const saved = doc.buffer;
    doc.buffer = doc.pages[0].content;
    doc.draw(toWinAnsi(String(TEXT.pdfContents).toUpperCase()), MARGIN, top,
      { size: 6.8, bold: true, color: SOFT, tracking: 1.1 });
    doc.hairline(top + 8, MARGIN, PAGE.width - MARGIN);
    rows.forEach((row, index) => {
      const column = Math.floor(index / perColumn);
      const x = MARGIN + column * columnWidth;
      // The number sits at the end of its own column, not the page, or the
      // left column's figures would be stranded mid-page against nothing.
      const rightEdge = x + columnWidth - (column === columns - 1 ? 0 : 18);
      const y = top + 22 + (index % perColumn) * rowHeight + 8;
      const page = toWinAnsi(String(row.page));
      const pageWidth = measure(page, 9, false);
      const titleStyle = { size: 9.6, color: INK };
      // Trimmed to what is left after the page number, so a long section name
      // cannot run through the digit beside it.
      const title = wrap(toWinAnsi(row.title), rightEdge - x - pageWidth - 10, titleStyle)[0];
      doc.draw(title, x, y, titleStyle);
      doc.draw(page, rightEdge - pageWidth, y, { size: 9, color: SOFT });
    });
    doc.buffer = saved;
  }

  function cover(doc, report, card, meta) {
    doc.newPage({ bare: true, top: 0 });
    doc.rect(0, 0, PAGE.width, PAGE.height, PAPER);
    const bandHeight = 150;
    doc.rect(0, 0, PAGE.width, bandHeight, ACCENT);
    // A second, darker wedge so the band is not a flat slab of colour.
    doc.setFill(ACCENT_2);
    doc.op('0 ' + num(PAGE.height - bandHeight) + ' m ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight) + ' l ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight + 30) + ' l 0 ' +
      num(PAGE.height - bandHeight) + ' l f');

    // The brand lockup, as the nav and the printed letterhead have it: the mark
    // with the wordmark beside it.
    doc.svgPaths(Copy.BRAND_MARK, { x: MARGIN, top: 42, size: 19, color: WHITE });
    // Mixed case, no tracking: the same wordmark style the nav uses, not the
    // tracked-caps treatment print letterheads default to.
    doc.draw(toWinAnsi('PsycheAI'), MARGIN + 26, 57, { size: 13, bold: true, color: WHITE });

    // The title, and nothing under it. The card's one-line headline used to sit
    // here in italics, and it read as a claim the cover was making about the
    // person before they had read a word of the evidence.
    const title = (card.name || 'Your') + '’s psyche';
    const titleStyle = { size: 27, bold: true, color: WHITE };
    let y = 104;
    for (const line of wrap(toWinAnsi(title), COLUMN - 20, titleStyle)) {
      doc.draw(line, MARGIN, y, titleStyle);
      y += 31;
    }

    const cardBottom = psycheCard(doc, report, card, bandHeight + 24, meta.layout === 'structured');

    // The provenance line sits at the foot of the cover rather than under the
    // band: it is what the page was printed from, which is a colophon, and it
    // reads as one down there instead of as a subtitle.
    const confidence = report.confidence || {};
    const stamp = ['Generated ' + (meta.date || ''),
      Math.round(Number(confidence.score) || 0) + '/100 confidence']
      .filter(Boolean).join('  ·  ');
    doc.draw(toWinAnsi(stamp), MARGIN, PAGE.height - MARGIN, { size: 8.8, color: SOFT });
    return cardBottom;
  }

  // ---------- sections that were paid for ----------

  /**
   * Paywalled sections, and the whole rule for how they reach the PDF: a
   * section in this table prints if and only if `meta.unlocked` carries its
   * key, which the app fills from what the reader has actually bought. No
   * payment, no key, no section — and nothing else in `build()` has to know a
   * paywall exists.
   *
   * Four sections live here — the wellness read, the attachment read, the
   * ideal-partner read and the career coaching — and one US$5 unlock fills
   * all four. The roast used to be one of them; it is free now, printed
   * unconditionally from `source.bonus` alongside the other free sections
   * below rather than gated through this table — see "9a. The roast" further
   * down for why it still needs its own consent reasoning even off the
   * paywall.
   *
   * Adding a paywalled section later means adding an entry here and a key in
   * `unlockedSections()` in docs/app.js. Do not reach for `source.<field>` in
   * `build()` for paid content — a paid section read off the report object
   * would print for anyone whose stored profile happened to contain it.
   */
  const PAID_SECTIONS = [{
    // `facet()` takes the band where a behaviour facet takes a headline — and
    // no `bar()`, deliberately: the page draws no progress bar for these
    // dimensions and neither does the PDF, because a filled bar under
    // "Emotional processing" would read as a measurement this section does
    // not make. See the wellness schema comment in lib/prompts.js.
    //
    // The caveat prints with the section rather than being left on screen,
    // for the same reason the roast's does.
    key: 'wellness',
    render(out, wellness, opts) {
      out.sectionTitle((opts && opts.title) || TEXT.wellness, (opts && opts.sub) || TEXT.wellnessSub);
      for (const [label, key] of Copy.WELLNESS_FACETS) {
        const part = wellness[key];
        if (!part) continue;
        out.facet(label, part.band, part.reading);
        out.tags(part.evidence);
      }
      if (wellness.overall) {
        out.h3(TEXT.wellnessOverall);
        out.body(wellness.overall, { size: 10, leading: 14.6 });
      }
      out.h3(TEXT.wellnessSuggestions);
      out.points(wellness.suggestions);
      out.space(4);
      out.body(TEXT.wellnessCaveat, { size: 8.4, leading: 12, color: SOFT });
    },
  }, {
    key: 'attachment',
    render(out, attachment, opts) {
      out.sectionTitle(TEXT.attachment, (opts && opts.sub) || TEXT.attachmentSub);
      out.h3(TEXT.attachmentPrefix + (attachment.style || ''));
      if (attachment.why) out.body(attachment.why, { size: 9.9, leading: 14.4 });
      if ((attachment.derivedFrom || []).length) {
        out.eyebrow(TEXT.readFrom, SOFT);
        out.tags(attachment.derivedFrom);
      }
      if ((attachment.implications || []).length) {
        out.eyebrow(TEXT.attachmentPractice, SOFT);
        out.points(attachment.implications);
      }
      if (attachment.caveat) out.fineprint(attachment.caveat);
    },
  }, {
    // Argues directly off the attachment read immediately above, both on
    // the page and here — see docs/app.js's idealPartnerBodyHtml.
    key: 'idealPartner',
    render(out, idealPartner, opts) {
      out.sectionTitle(TEXT.idealPartner, (opts && opts.sub) || TEXT.idealPartnerSub);
      out.h3(TEXT.idealPartnerNeeds);
      out.points(idealPartner.needs);
      out.h3(TEXT.idealPartnerCarefulOf);
      out.points(idealPartner.carefulOf);
      if (idealPartner.summary) {
        out.h3(TEXT.idealPartnerSummary);
        out.body(idealPartner.summary, { size: 10, leading: 15 });
      }
    },
  }, {
    // The coach's read, distinct from "At work" above. The horizon leads each
    // action here the way the pill does on the page, so the thing that can be
    // started this week is still the thing read first.
    key: 'careerAssessment',
    render(out, coaching, opts) {
      if (opts && opts.bodyOnly) {
        out.h3(TEXT.careerAssessment, ACCENT);
      } else {
        out.sectionTitle(TEXT.careerAssessment, (opts && opts.sub) || TEXT.careerAssessmentSub);
      }
      if (coaching.situation) {
        out.h3(TEXT.careerSituation);
        out.body(coaching.situation, { size: 10, leading: 15 });
      }
      if (coaching.edge) {
        out.h3(TEXT.careerEdge, ACCENT);
        out.h3(coaching.edge.headline);
        if (coaching.edge.detail) out.body(coaching.edge.detail, { size: 10, leading: 15 });
        out.tags(coaching.edge.evidence);
      }
      for (const [label, facet] of [[TEXT.careerUnderused, coaching.underused],
        [TEXT.careerHoldingBack, coaching.holdingBack]]) {
        if (!facet) continue;
        out.facet(label, facet.headline, facet.detail);
      }
      out.h3(TEXT.careerActions);
      const actions = (coaching.actions || []).filter(Boolean);
      const horizons = Object.keys(TEXT.careerHorizons);
      const ordered = horizons.flatMap(h => actions.filter(a => a.horizon === h))
        .concat(actions.filter(a => !horizons.includes(a.horizon)));
      for (const action of ordered) {
        const label = TEXT.careerHorizons[action.horizon];
        out.point((label ? label + '  ·  ' : '') + action.title, action.detail);
      }
    },
  }];

  // Free, printed unconditionally from `source.bonus` — see "9a. The roast"
  // in `build()` below. Kept as its own function rather than folded into
  // PAID_SECTIONS: it is read straight off the report object, not off
  // `meta.unlocked`, which is exactly the shortcut the comment above
  // PAID_SECTIONS warns against for anything paid.
  function renderRoast(out, roast, options) {
    if (options && options.structured) return renderStructuredRoast(out, roast);
    out.sectionTitle(TEXT.bonus, TEXT.bonusSub);
    out.fineprint(TEXT.bonusCaveat);
    if (roast.harsh) {
      out.h3(TEXT.bonusHarsh);
      out.body(roast.harsh, { size: 10, leading: 15 });
    }
    if (roast.advice) {
      out.h3(TEXT.bonusAdvice);
      out.body(roast.advice, { size: 10, leading: 15 });
    }
  }

  /**
   * The structured report's roast: the caveat as a tinted note rather than
   * fineprint, then each half in a card of its own — the unkind read edged in
   * pink under a large open quote, the honest friend's advice edged in green.
   */
  function renderStructuredRoast(out, roast) {
    const doc = out.doc;
    out.sectionTitle(TEXT.bonus, TEXT.bonusSub);
    out.note(TEXT.bonusCaveat);
    const half = (label, text, color) => out.boxed(() => {
      const top = doc.y;
      // A large open quote in the card's corner, faint, as the half's mark.
      doc.draw(toWinAnsi('“'), out.x + out.w - 26, top + 34, { size: 46, bold: true, color: mix(color, WHITE, 0.78) });
      doc.draw(toWinAnsi(label.toUpperCase()), out.x, top + 9, { size: 7.8, bold: true, color, tracking: 1.2 });
      doc.y = top + 20;
      out.body(text, { size: 10.2, leading: 15.6, width: out.w - 30 });
    }, { bar: color, pad: 16, padTop: 14, gap: 12 });
    if (roast.harsh) half(TEXT.bonusHarsh, roast.harsh, ACCENT_2);
    if (roast.advice) half(TEXT.bonusAdvice, roast.advice, GOOD);
  }

  // ---------- the report ----------

  function build(report, card, meta) {
    bindCopy();
    // The structured layout's own build, for a report that carries its
    // writing. A card-only profile prints the same offer page either way.
    if (meta && meta.layout === 'structured' && !meta.cardOnly) return buildStructured(report, card, meta);
    const source = report || {};
    const who = card || {};
    const stamp = meta || {};
    const doc = new Doc();
    const out = new Report(doc, { name: who.name || 'Your profile' });

    // Page one is the card and nothing else. The report proper starts on page
    // two, under the running head, so the cover stays a cover — a page that
    // ends mid-section would not be one.
    const cardBottom = cover(doc, source, who, stamp);
    out.page();

    // The written report, sections 1 to 9a. A free profile has the card and
    // none of this — the explanations are what the unlock buys, and the server
    // never wrote them — so its PDF says what the unlock adds instead of
    // printing a run of empty headings.
    const writeExplanations = () => {
      // 1. Who you are — essence, the headline findings, then the summary.
      out.sectionTitle(TEXT.whoYouAre);
      const essence = source.essence || {};
      // `noun` is the name this field had before it held a character, so a
      // profile saved before that change still prints.
      const essenceName = essence.character || essence.noun;
      if (essenceName) {
        out.eyebrow(TEXT.essenceLabel);
        const nameStyle = { size: 23, bold: true, color: ACCENT };
        const franchiseStyle = { size: 10, color: SOFT };
        const franchise = essence.franchise ? toWinAnsi(essence.franchise) : '';
        const lines = wrap(toWinAnsi(essenceName), COLUMN, nameStyle);

        // The franchise trails the last line of the name, but only if it fits
        // there. A name whose last line nearly fills the column would otherwise
        // push it straight past the right margin — "Nick Wilde and Judy Hopps of
        // Zootopia" runs 48pt over. When it will not fit, it takes its own line.
        const lastWidth = measure(lines[lines.length - 1], nameStyle.size, true);
        const franchiseWidth = franchise ? measure(franchise, franchiseStyle.size, false) : 0;
        const franchiseFitsBeside = franchise && lastWidth + 9 + franchiseWidth <= COLUMN;

        lines.forEach((line, index) => {
          out.need(30);
          doc.draw(line, MARGIN, doc.y + 18, nameStyle);
          if (franchiseFitsBeside && index === lines.length - 1) {
            doc.draw(franchise, MARGIN + lastWidth + 9, doc.y + 18, franchiseStyle);
          }
          doc.y += 28;
        });
        if (franchise && !franchiseFitsBeside) {
          out.need(16);
          doc.draw(franchise, MARGIN, doc.y + 8, franchiseStyle);
          doc.y += 15;
        }
        out.space(2);
        if (essence.why) out.body(essence.why, { size: 10.2, leading: 15 });
        out.space(8);
      }
      // The glance strip — type, highest trait, lowest trait, enneagram — used to
      // sit here. It came off the profile page a while ago because the psyche
      // card above it already carried all four, and repeating them a few
      // centimetres below was the same facts twice. The PDF kept its copy on the
      // grounds that it had no card in front of it. It does now: page one is that
      // card. So the same reasoning applies and the strip goes, leaving the
      // essence to run straight into the summary.
      if (source.summary) out.body(source.summary, { size: 10.6, leading: 16 });

      // 2. Big Five.
      const five = source.bigFive || {};
      out.sectionTitle(TEXT.bigFive, TEXT.bigFiveSub);
      for (const key of Object.keys(TRAIT_LABELS)) {
        const trait = five[key];
        if (!trait) continue;
        out.need(84);
        out.bar(TRAIT_LABELS[key] + ' · ' + (trait.band || ''), trait.score);
        if (trait.reading) out.body(trait.reading, { size: 9.9, leading: 14.4 });
        out.tags(trait.evidence);
        out.space(4);
      }

      // 3. MBTI.
      const mbti = source.mbti;
      if (mbti) {
        out.sectionTitle(TEXT.mbtiPrefix + (mbti.type || '') + (mbti.nickname ? '  ' + mbti.nickname : ''),
          TEXT.mbtiConfidence + (mbti.confidence || ''));
        for (const letter of mbti.letters || []) {
          out.axis(letter.choice, Copy.axisLabel(letter.choice, letter.axis),
            letter.strength, letter.why, letter.inPractice, letter.counterEvidence);
        }
        out.fineprint(mbti.caveat);
      }

      // 4. Enneagram — a short second lens beside MBTI, not a wall of its own.
      const enneagram = source.enneagram;
      if (enneagram) {
        const badge = (enneagram.type || '') + (enneagram.wing ? 'w' + enneagram.wing : '');
        out.sectionTitle(TEXT.enneagramPrefix + badge + (enneagram.nickname ? '  ' + enneagram.nickname : ''),
          TEXT.mbtiConfidence + (enneagram.confidence || ''));
        if (enneagram.why) out.body(enneagram.why, { size: 10.2, leading: 15 });
        out.fineprint(enneagram.caveat);
      }

    // Page/PDF parity for the trajectory chip — see trajectoryPill in app.js.
    // The PDF's tile takes one pill, so the two are joined rather than stacked:
    // "core · Dormant since 2019". Falls back to the intensity alone on a report
    // written before these fields existed.
    const trajectoryTag = item => {
      const trajectory = String((item && item.trajectory) || '').trim();
      if (!trajectory) return '';
      const year = String((item && item.lastSeen) || '').trim();
      const label = (TEXT.trajectoryLabels && TEXT.trajectoryLabels[trajectory]) || trajectory;
      const stale = trajectory === 'dormant' || trajectory === 'declining' || trajectory === 'phasic';
      return stale && /^\d{4}$/.test(year) ? label + ' ' + year : label;
    };
    const tilePill = (item, intensity) => {
      const tag = trajectoryTag(item);
      if (!intensity) return tag;
      return tag ? intensity + ' · ' + tag : intensity;
    };

      // 5. Interests.
      out.sectionTitle(TEXT.interests);
      const interests = source.interests || [];
      if (interests.length) {
        for (const item of interests) out.tile(item.name, tilePill(item, item.intensity), item.detail, item.evidence);
      } else {
        out.muted(TEXT.interestsEmpty);
      }

      // 6. Values and beliefs, together, as the page groups them.
      out.sectionTitle(TEXT.valuesBeliefs, TEXT.valuesBeliefsSub);
      out.h3(TEXT.values);
      const values = source.values || [];
      if (values.length) {
        for (const item of values) out.tile(item.value, tilePill(item, ''), item.detail, item.evidence);
      } else {
        out.muted(TEXT.valuesEmpty);
      }
      out.h3(TEXT.beliefs);
      const beliefs = source.beliefs || [];
      if (beliefs.length) {
        for (const item of beliefs) {
          out.tile(item.belief, item.confidence ? item.confidence + TEXT.confidenceSuffix : '',
            item.detail, item.evidence);
        }
      } else {
        out.muted(TEXT.beliefsEmpty);
      }

      // 7. In relationships.
      const relationship = source.relationship;
      if (relationship) {
        out.sectionTitle(TEXT.relationships);
        out.h3(TEXT.strengths, GOOD);
        out.points(relationship.strengths);
        out.h3(TEXT.weaknesses, WARN);
        out.points(relationship.weaknesses);

        // The attachment read used to print here, inside "In relationships".
        // It is its own section further down now, matching the page.
        const love = relationship.loveLanguages;
        if (love) {
          const columns = [
            [TEXT.loveReceiving, TEXT.loveReceivingBlurb, love.receiving],
            [TEXT.loveGiving, TEXT.loveGivingBlurb, love.giving],
          ].filter(entry => (entry[2] || []).some(item => item && item.language));
          if (columns.length) {
            out.h3(TEXT.loveHead);
            for (const [title, blurb, list] of columns) {
              out.h3(title);
              out.muted(blurb);
              for (const item of list.filter(entry => entry && entry.language)) {
                out.point(item.language + (item.strength ? '  ·  ' + item.strength : ''), item.inPractice);
                if (item.why) {
                  out.body(item.why, { x: MARGIN + 10, width: COLUMN - 10, size: 9.2, color: SOFT, leading: 13.2 });
                  out.space(4);
                }
              }
            }
            out.fineprint(love.caveat);
          }
        }
      }

      // 8. At work.
      const career = source.career;
      if (career) {
        out.sectionTitle(TEXT.work);
        out.h3(TEXT.strengths, GOOD);
        out.points(career.strengths);
        out.h3(TEXT.weaknesses, WARN);
        out.points(career.weaknesses);
        out.h3(TEXT.howYouWork);
        if (career.workStyle) out.body(career.workStyle, { size: 10, leading: 15 });
        // "Where you would thrive" printed a list of ideal environments here.
        // It was cut from both renderings together.
        out.h3(TEXT.holdBack);
        if (career.watchOuts) out.body(career.watchOuts, { size: 10, leading: 15 });
      }

      // 9. Instagram behaviour. After the personality sections, because it is the
      // evidence underneath them rather than another verdict.
      const activity = source.activity;
      if (activity) {
        out.sectionTitle(TEXT.activity);
        for (const [label, key] of Copy.ACTIVITY_FACETS) {
          const part = activity[key];
          if (!part) continue;
          out.facet(label, part.headline, part.detail);
        }
      }

      // 9a. The roast. Free, printed unconditionally, right after the digital
      // footprint it draws on — matching the page, which puts it there for
      // the same reason. Unlike the paid sections below, there is no gate to
      // check: on screen it sits behind a cover the reader clicks through,
      // and a PDF has no cover, so the print simply carries what the reader
      // already has, the same way every other free section here does.
      if (source.bonus) renderRoast(out, source.bonus);
    };
    if (stamp.cardOnly) {
      out.sectionTitle(TEXT.fullReportTitle);
      out.body(TEXT.fullReportPdf, { size: 10.4, leading: 15.4 });
    } else {
      writeExplanations();
    }

    // 9b. Whatever was bought, in the position it holds on the page — after
    // the behaviour read, before matches and the confidence close. The list is
    // `PAID_SECTIONS`; see the note there for why this is a table rather than
    // an `if` per section, and why a paid section is read from `meta` rather
    // than off the report object.
    const unlocked = stamp.unlocked || {};
    for (const section of PAID_SECTIONS) {
      if (unlocked[section.key]) section.render(out, unlocked[section.key]);
    }

    // 10. Matches, when this device has any.
    const history = (stamp.history || []).filter(entry => entry && entry.report);
    if (history.length) {
      out.sectionTitle(TEXT.matches);
      out.matchTable(history);
    }

    // 11. Confidence closes the report, as it does on the page.
    const confidence = source.confidence || {};
    out.sectionTitle(TEXT.trust, TEXT.trustSub);
    const score = Math.max(0, Math.min(100, Math.round(Number(confidence.score) || 0)));
    out.need(40);
    doc.roundRect(MARGIN, doc.y, COLUMN, 7, 3.5, LINE);
    if (score > 0) doc.roundRect(MARGIN, doc.y, Math.max(7, COLUMN * score / 100), 7, 3.5, ACCENT);
    doc.y += 18;
    out.body(TEXT.trustScore + score + '/100 (' + (confidence.level || '') + ').',
      { size: 10.4, bold: true, leading: 15 });
    if (confidence.rationale) out.body(confidence.rationale, { size: 10, leading: 15 });

    out.fineprint('Analysed by ' + (stamp.model || 'the model') + ' on ' + (stamp.date || '') + '.');
    // A second line only once the paid sections are actually in this file \u2014
    // guarded on both fields together, the same way the page is, so a report
    // that unlocked before this pair existed prints the one line it always
    // had rather than a line naming a model with no date, or vice versa.
    if (stamp.premiumModel && stamp.premiumDate) {
      out.fineprint('Full premium report written by ' + stamp.premiumModel + ' on ' + stamp.premiumDate + '.');
    }

    // Last, because it is the only block whose content depends on the whole
    // document already existing \u2014 see coverContents for how it reaches back
    // onto page one.
    coverContents(doc, out, cardBottom);

    return serialise(doc, (who.name || 'Your') + '\u2019s psyche',
      'Personality analysis from an Instagram data export');
  }

  // ---------- the structured report layout ----------
  //
  // The same document the page draws in its structured layout, in the same
  // order and the same words: the overview with the signature patterns, four
  // numbered parts, a short line under a section title only where the title
  // needs one, the Big Five on spectrums, the motivators chart, relationships
  // and work each as one section, the development plan with every action on
  // one plan, the pressure points, then the evidence page and the roast.
  // Chosen by `meta.layout`; the classic build above is untouched.

  /** One Big Five trait on a spectrum, the page's .bipolar. */
  Report.prototype.bipolar = function (label, score, poles, band) {
    this.need(52);
    const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const readout = toWinAnsi(String(value));
    const L = this.x;
    const W = this.w;
    this.doc.draw(toWinAnsi(label), L, this.doc.y + 9, { size: 11, bold: true, color: INK });
    // The score in a pill, so the number is the first thing the eye lands on.
    const pillW = measure(readout, 10, true) + 16;
    this.doc.roundRect(L + W - pillW, this.doc.y - 1, pillW, 16, 8, ACCENT);
    this.doc.draw(readout, L + W - pillW + 8, this.doc.y + 10.5, { size: 10, bold: true, color: WHITE });
    const track = this.doc.y + 22;
    const x = v => L + W * v / 100;
    this.doc.roundRect(L, track, W, 8, 4, mix(LINE, WHITE, 0.45));
    this.doc.rect(x(band[0]), track, W * (band[1] - band[0]) / 100, 8, mix(ACCENT, WHITE, 0.8));
    this.doc.setStroke(SOFT);
    this.doc.op('0.7 w ' + num(x(50)) + ' ' + num(PAGE.height - track + 2) + ' m ' +
      num(x(50)) + ' ' + num(PAGE.height - track - 10) + ' l S');
    this.doc.circle(x(value), track + 4, 6.5, WHITE);
    this.doc.circle(x(value), track + 4, 5, ACCENT);
    const left = toWinAnsi(poles[0] || '');
    const right = toWinAnsi(poles[1] || '');
    this.doc.draw(left, L, track + 19, { size: 7.4, color: SOFT });
    this.doc.draw(right, L + W - measure(right, 7.4, false), track + 19, { size: 7.4, color: SOFT });
    this.doc.y = track + 27;
    return this;
  };

  /** A coloured bar with a label, for the motivators chart. */
  Report.prototype.motiveRow = function (label, meaning, score, color, line) {
    this.need(40);
    const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const labelWidth = 140;
    const barLeft = this.x + labelWidth;
    const barWidth = this.w - labelWidth - 30;
    this.doc.draw(toWinAnsi(label), this.x, this.doc.y + 9, { size: 10, bold: true, color: INK });
    this.doc.draw(toWinAnsi(meaning), this.x, this.doc.y + 20, { size: 7.4, color: SOFT });
    this.doc.roundRect(barLeft, this.doc.y + 5, barWidth, 7, 3.5, mix(color, WHITE, 0.85));
    if (value > 0) this.doc.roundRect(barLeft, this.doc.y + 5, Math.max(7, barWidth * value / 100), 7, 3.5, color);
    const readout = toWinAnsi(String(value));
    this.doc.draw(readout, this.x + this.w - measure(readout, 9.5, true), this.doc.y + 11.5,
      { size: 9.5, bold: true, color });
    this.doc.y += 25;
    if (line) this.body(line, { size: 8.4, color: SOFT, leading: 11.8 });
    this.space(5);
    return this;
  };

  /** A small labelled line: "CONNECTS TO  1 The quiet organiser · 3 ...". */
  Report.prototype.labelled = function (label, text, options) {
    if (!text) return this;
    const settings = options || {};
    const labelText = toWinAnsi(String(label).toUpperCase());
    const labelWidth = measure(labelText, 7, true, 1) + 8;
    const style = { size: settings.size || 9, color: settings.color || SOFT, italic: Boolean(settings.italic) };
    const lines = wrap(toWinAnsi(text), this.w - labelWidth - (settings.indent || 0), style);
    this.need(14 * lines.length + 4);
    const x = this.x + (settings.indent || 0);
    this.doc.draw(labelText, x, this.doc.y + 8, { size: 7, bold: true, color: settings.labelColor || SOFT, tracking: 1 });
    lines.forEach((line, index) => {
      if (index) this.need(13);
      this.doc.draw(line, x + labelWidth, this.doc.y + 8, style);
      this.doc.y += 13;
    });
    this.space(2);
    return this;
  };

  /**
   * A part divider — its numeral and title, as the page's part heading has —
   * recorded in the cover's contents in place of sections.
   */
  Report.prototype.part = function (part, numeral, options) {
    // Every part opens a page of its own; the appendix follows on where there is room.
    if (options && options.flow) this.titled = true;
    else if (this.doc.y > MARGIN + 40) this.page();
    this.contents.push({ title: (numeral ? numeral + '  ' : '') + part.title, page: this.doc.pageNumber });
    this.space(22);
    this.doc.rect(MARGIN, this.doc.y, COLUMN, 2, ACCENT);
    this.space(12);
    const numStyle = { size: 30, bold: true, color: ACCENT };
    const titleStyle = { size: 22, bold: true, color: INK };
    const number = numeral ? toWinAnsi(numeral) : '';
    const numberWidth = number ? measure(number, 30, true) + 12 : 0;
    const lines = wrap(toWinAnsi(part.title), COLUMN - numberWidth, titleStyle);
    const top = this.doc.y;
    if (number) this.doc.draw(number, MARGIN, top + 28, numStyle);
    lines.forEach((line, i) => this.doc.draw(line, MARGIN + numberWidth, top + 25 + i * 26, titleStyle));
    this.doc.y = top + Math.max(36, 10 + lines.length * 26);
    this.space(4);
    return this;
  };

  // ---------- structured layout: boxed blocks ----------
  //
  // Rows of text laid out once at a width, so a box can be measured before it
  // is drawn and kept whole on one page. A row is { text, style, leading,
  // before, indent, bullet, right }: `right` is a small label drawn at the
  // right edge of the row's first line, `bullet` a dot before it.
  const GOOD_WASH = [0.910, 0.965, 0.937];
  const WARN_WASH = [0.992, 0.949, 0.902];
  const T_TITLE = { size: 10.6, bold: true, color: INK };
  const T_BODY = { size: 9.6, color: INK };
  const T_SOFT = { size: 8.3, color: SOFT };
  const T_LABEL = { size: 7, bold: true, color: SOFT, tracking: 1 };
  const PINK_WASH = mix(ACCENT_2, WHITE, 0.9);

  /** A wellbeing band's colours: its ink, and the wash its card is filled with. */
  function bandTone(band) {
    return {
      steady: { ink: GOOD, wash: GOOD_WASH },
      mixed: { ink: WARN, wash: WARN_WASH },
      'under strain': { ink: ACCENT_2, wash: PINK_WASH },
    }[band] || { ink: SOFT, wash: WHITE };
  }

  /**
   * A small label and a row of pills — "Shows up in" and the sections it
   * names, set as tags in the accent rather than as a sentence of commas.
   */
  Report.prototype.pills = function (label, items, options) {
    const o = options || {};
    const list = (items || []).filter(Boolean).map(item => toWinAnsi(item));
    if (!list.length) return this;
    const labelText = toWinAnsi(String(label).toUpperCase());
    const labelW = measure(labelText, 6.6, true, 1) + 8;
    const size = 7.4;
    const h = 13;
    this.need(h + 6);
    this.doc.draw(labelText, this.x, this.doc.y + 9, { size: 6.6, bold: true, color: o.labelColor || SOFT, tracking: 1 });
    let x = this.x + labelW;
    for (const item of list) {
      const w = measure(item, size, true) + 12;
      if (x > this.x + labelW && x + w > this.x + this.w) {
        this.doc.y += h + 3;
        this.need(h + 3);
        x = this.x + labelW;
      }
      this.doc.roundRect(x, this.doc.y, w, h, h / 2, o.fill || ACCENT);
      this.doc.draw(item, x + 6, this.doc.y + 9.1, { size, bold: true, color: o.color || WHITE });
      x += w + 4;
    }
    this.doc.y += h + 4;
    return this;
  };

  // (blockWidth, below, is read when a block is drawn, not when it is laid out.)
  function layoutRows(rows, width) {
    const laid = [];
    let height = 0;
    for (const row of rows) {
      if (!row || !row.text) continue;
      height += row.before || 0;
      const indent = (row.indent || 0) + (row.bullet ? 11 : 0);
      const rightWidth = row.right ? measure(toWinAnsi(row.right), 7, true, 0.8) + 10 : 0;
      const lines = wrap(toWinAnsi(row.text), width - indent - rightWidth, row.style);
      const leading = row.leading || row.style.size * 1.42;
      laid.push({ row, lines, top: height, indent, leading });
      height += lines.length * leading;
    }
    return {
      height,
      draw(doc, x, top) {
        for (const item of laid) {
          const { row, lines, indent, leading } = item;
          if (row.bullet) doc.roundRect(x + (row.indent || 0) + 1, top + item.top + leading * 0.5 - 2, 4, 4, 2, row.bullet);
          lines.forEach((line, i) => doc.draw(line, x + indent, top + item.top + i * leading + row.style.size * 0.9, row.style));
          if (row.right) {
            const label = toWinAnsi(row.right.toUpperCase());
            doc.draw(label, x + blockWidth - measure(label, 7, true, 0.8), top + item.top + row.style.size * 0.9,
              { size: 7, bold: true, color: row.rightColor || ACCENT, tracking: 0.8 });
          }
        }
      },
    };
  }
  // The width a row's right-hand label is aligned against; set by whoever
  // draws the block, since one layout can be drawn in a column of any width.
  let blockWidth = COLUMN;

  /** A subsection heading inside a section: a short bar of colour and the title. */
  Report.prototype.subhead = function (text, color) {
    this.titled = true;
    const style = { size: 12.4, bold: true, color: INK };
    const lines = wrap(toWinAnsi(text), COLUMN - 14, style);
    this.need(48 + lines.length * 16);
    this.space(14);
    this.doc.roundRect(MARGIN, this.doc.y + 1, 4, 13, 2, color || ACCENT);
    for (const line of lines) {
      this.doc.draw(line, MARGIN + 12, this.doc.y + 11.5, style);
      this.doc.y += 16;
    }
    this.space(6);
    return this;
  };

  /**
   * A box of rows, kept whole on one page: a tinted fill, a coloured bar down
   * its left edge, an optional small label over its rows. Taller than a page
   * and it is set as plain rows instead, rather than clipped.
   */
  Report.prototype.panel = function (rows, options) {
    const o = options || {};
    const pad = 12;
    const inner = COLUMN - pad * 2 - 4;
    const body = layoutRows(rows, inner);
    const labelH = o.label ? 15 : 0;
    const height = body.height + labelH + pad * 2;
    if (height > PAGE.height - MARGIN * 2 - 80) {
      for (const row of rows) if (row && row.text) this.body(row.text, { size: row.style.size, bold: row.style.bold, italic: row.style.italic, color: row.style.color });
      return this;
    }
    this.need(height + 8);
    const top = this.doc.y;
    this.doc.roundRect(MARGIN, top, COLUMN, height, 9, o.fill || WASH);
    this.doc.rect(MARGIN, top + 4, 3, height - 8, o.bar || ACCENT);
    if (o.label) {
      this.doc.draw(toWinAnsi(String(o.label).toUpperCase()), MARGIN + pad + 4, top + pad + 7,
        { size: 7, bold: true, color: o.bar || ACCENT, tracking: 1.1 });
    }
    blockWidth = inner;
    body.draw(this.doc, MARGIN + pad + 4, top + pad + labelH);
    blockWidth = COLUMN;
    this.doc.y = top + height + 8;
    return this;
  };

  /**
   * Two boxes side by side, each with a title in its own colour over a rule
   * of that colour — the page's two-column splits, on paper. Each side is
   * { title, color, fill, rows }. Too tall for a page together, and they are
   * set one above the other instead.
   */
  Report.prototype.pairedPanels = function (left, right) {
    const gap = 12;
    const pad = 11;
    const width = (COLUMN - gap) / 2;
    const inner = width - pad * 2;
    const sides = [left, right].filter(side => side && (side.rows || []).some(row => row && row.text));
    if (!sides.length) return this;
    const laid = sides.map(side => ({ side, body: layoutRows(side.rows, inner) }));
    const titleH = 24;
    const height = Math.max(...laid.map(l => l.body.height)) + titleH + pad * 2;
    if (sides.length === 1 || height > PAGE.height - MARGIN * 2 - 80) {
      for (const side of sides) this.panel(side.rows, { label: side.title, bar: side.color, fill: side.fill });
      return this;
    }
    this.need(height + 8);
    const top = this.doc.y;
    laid.forEach(({ side, body }, i) => {
      const x = MARGIN + i * (width + gap);
      this.doc.roundRect(x, top, width, height, 9, side.fill || WHITE);
      this.doc.roundRect(x, top, width, 4, 2, side.color || ACCENT);
      this.doc.draw(toWinAnsi(side.title), x + pad, top + pad + 10, { size: 10.4, bold: true, color: side.color || ACCENT });
      blockWidth = inner;
      body.draw(this.doc, x + pad, top + pad + titleH);
      blockWidth = COLUMN;
    });
    this.doc.y = top + height + 8;
    return this;
  };

  /** A wellbeing dimension: its label and its band on one line, then the read. */
  Report.prototype.facetBand = function (label, band, reading) {
    this.need(58);
    this.space(8);
    const text = toWinAnsi(String(label).toUpperCase());
    const labelStyle = { size: 7.6, bold: true, color: ACCENT_2, tracking: 1.1 };
    const tone = bandTone(band);
    this.doc.draw(text, this.x, this.doc.y + 9, Object.assign({}, labelStyle, { color: tone.ink === SOFT ? ACCENT_2 : tone.ink }));
    if (band) {
      const word = toWinAnsi(band);
      const x = this.x + measure(text, 7.6, true, 1.1) + 10;
      const w = measure(word, 8, true) + 14;
      this.doc.roundRect(x, this.doc.y, w, 13, 6.5, tone.ink);
      this.doc.draw(word, x + 7, this.doc.y + 9.4, { size: 8, bold: true, color: WHITE });
    }
    this.doc.y += 18;
    if (reading) this.body(reading, { size: 9.6, leading: 13.8 });
    return this;
  };

  /**
   * One pressure point as a card: the strength and what it turns into, the
   * level meter, a bar from "at its best" to "overused" with a marker at how
   * far their data already shows it, then the read, the early signs, the
   * counter-move and the question — the page's gauge card, on paper.
   */
  Report.prototype.pressureCard = function (item, labels) {
    const doc = this.doc;
    const label = text => {
      this.need(30);
      this.space(7);
      doc.draw(toWinAnsi(String(text).toUpperCase()), this.x, doc.y + 7, T_LABEL);
      doc.y += 12;
    };
    this.boxed(() => {
      const headStyle = { size: 11.2, bold: true, color: INK };
      const head = wrap(toWinAnsi(item.strength + '  ->  ' + (item.overused || '')), this.w - 120, headStyle);
      this.need(head.length * 15 + 60);
      const top = doc.y;
      head.forEach((line, i) => doc.draw(line, this.x, top + 10 + i * 15, headStyle));
      levelMeter(doc, this.x + this.w, top, item.level, labels.level);
      // The bar: green at its best, warm where it costs, and a marker at the level.
      const barTop = top + head.length * 15 + 6;
      const segments = 24;
      for (let i = 0; i < segments; i++) {
        doc.rect(this.x + this.w * i / segments, barTop, this.w / segments + 0.4, 4, mix(GOOD, WARN, i / (segments - 1)));
      }
      const reach = { mild: 0.3, moderate: 0.58, marked: 0.86 }[item.level];
      if (reach) {
        doc.circle(this.x + this.w * reach, barTop + 2, 5, WHITE);
        doc.circle(this.x + this.w * reach, barTop + 2, 3.5, INK);
      }
      doc.draw(toWinAnsi(labels.atBest), this.x, barTop + 14, { size: 7, color: SOFT });
      const over = toWinAnsi(labels.overused);
      doc.draw(over, this.x + this.w - measure(over, 7, false), barTop + 14, { size: 7, color: SOFT });
      doc.y = barTop + 22;
      if (item.detail) this.body(item.detail, { size: 9.6, leading: 13.8 });
      const signs = (item.earlySigns || []).filter(Boolean);
      if (signs.length) {
        label(labels.earlySigns);
        for (const sign of signs) {
          wrap(toWinAnsi(sign), this.w - 11, T_BODY).forEach((line, i) => {
            this.need(14);
            if (!i) doc.circle(this.x + 2.5, doc.y + 6.2, 2, WARN);
            doc.draw(line, this.x + 11, doc.y + 9.4, T_BODY);
            doc.y += 13.4;
          });
        }
      }
      if (item.mitigation) { label(labels.counterMove); this.body(item.mitigation, { size: 9.6, leading: 13.6 }); }
      if (item.question) { label(labels.reflect); this.body(item.question, { size: 9.6, italic: true, leading: 13.6 }); }
      doc.y -= 2;
    }, { bar: WARN, pad: 13, gap: 10 });
    return this;
  };

  /** The three-step level meter beside a pressure point. */
  function levelMeter(doc, right, top, level, label) {
    const levels = ['mild', 'moderate', 'marked'];
    const at = levels.indexOf(level);
    if (at < 0) return;
    const word = toWinAnsi(label);
    const wordWidth = measure(word, 8, true);
    let x = right - wordWidth - 6 - 3 * 15;
    for (let i = 0; i < 3; i++) {
      doc.roundRect(x, top + 2, 12, 5, 1.5, i <= at ? WARN : LINE);
      x += 15;
    }
    doc.draw(word, right - wordWidth, top + 8, { size: 8, bold: true, color: WARN });
  }

  // ---------- the structured cover ----------
  //
  // The on-screen story card, on paper: a gradient band with the title, and
  // the card lifted over its foot — the character in a gradient block of its
  // own with its emblem, then the patterns, motivators, type, Big Five,
  // values, interests and love languages each in a small tinted panel, as the
  // card on the page sets them. The contents list goes under it.

  const BAND_FROM = [0.204, 0.106, 0.302];
  const SHORT_TRAITS = { openness: 'Openness', conscientiousness: 'Conscientious', extraversion: 'Extraversion',
    agreeableness: 'Agreeable', neuroticism: 'Sensitivity' };

  /** The three motivators the card names: the model's own pick, else the top scores. */
  function topMotivatorKeys(report) {
    const known = Copy.STRUCTURED.motivators;
    const named = (report.topMotivators || []).filter(key => known[key]);
    if (named.length) return named.slice(0, 3);
    return ((report.motivators && report.motivators.scores) || []).filter(row => row && known[row.value])
      .slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(row => row.value);
  }

  /** The emblem in a white disc, or the character's initial where there is none. */
  function emblemDisc(doc, cx, cy, r, character, color) {
    doc.circle(cx, cy, r, WHITE);
    const key = Copy.CHARACTER_EMBLEMS && Copy.CHARACTER_EMBLEMS[String(character || '').trim()];
    const markup = key && Copy.EMBLEM_PATHS[key];
    if (markup) {
      const size = r * 1.25;
      doc.emblem(markup, { x: cx - size / 2, top: cy - size / 2, size, color: color || ACCENT });
    } else if (character) {
      const letter = toWinAnsi(String(character).trim().charAt(0).toUpperCase());
      const size = r * 1.05;
      doc.draw(letter, cx - measure(letter, size, true) / 2, cy + size * 0.36, { size, bold: true, color: color || ACCENT });
    }
  }

  /** Pills that wrap inside a panel; returns the height they take, drawing only when given a doc. */
  function chipRun(doc, items, x, top, width, style) {
    const h = 13.5;
    let cx = x;
    let y = top;
    let any = false;
    for (const raw of items) {
      const text = toWinAnsi(raw);
      if (!text) continue;
      const lines = wrap(text, width - 12, style);
      if (lines.length > 1) {
        if (any && cx > x) { y += h + 3.5; cx = x; }
        const boxH = lines.length * 10.4 + 5;
        if (doc) {
          doc.roundRect(x, y, width, boxH, 6, style.fill);
          lines.forEach((line, i) => doc.draw(line, x + 6, y + 10 + i * 10.4, style));
        }
        y += boxH + 3.5;
        cx = x;
        any = false;
        continue;
      }
      const w = measure(text, style.size, style.bold) + 12;
      if (cx > x && cx + w > x + width) { y += h + 3.5; cx = x; }
      if (doc) {
        doc.roundRect(cx, y, w, h, h / 2, style.fill);
        doc.draw(text, cx + 6, y + 9.4, style);
      }
      cx += w + 4;
      any = true;
    }
    return (any ? y + h : y) - top;
  }

  function storyCover(doc, report, card, meta) {
    const S = Copy.STRUCTURED;
    const essence = report.essence || {};
    const name = essence.character || essence.noun || '';
    const franchise = essence.franchise || '';
    const fullBlurb = String(report.cardHighlights || card.summary || '').trim();
    const blurb = (fullBlurb.match(/[^.!?]+[.!?]+["'’”)]*(\s+|$)/g) || [fullBlurb]).slice(0, 2).join('').trim();
    const headline = String((card && card.headline) || (report.card && report.card.headline) || '').trim();
    const mbti = report.mbti || {};
    const five = report.bigFive || {};
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const confidence = Math.round(Number((report.confidence || {}).score || (card || {}).confidence) || 0);

    doc.newPage({ bare: true, top: 0 });
    doc.rect(0, 0, PAGE.width, PAGE.height, PAPER);

    // ---- the band ----
    const bandH = 178;
    // Deep plum into the accent: darker than the character block on the card,
    // so the card's own gradient is the brightest thing on the page.
    doc.gradientBox(0, 0, PAGE.width, bandH, 0, BAND_FROM, ACCENT, () => {
      doc.circle(PAGE.width - 30, 18, 112, mix(ACCENT, WHITE, 0.1));
      doc.circle(PAGE.width - 168, bandH - 12, 46, mix(mix(BAND_FROM, ACCENT, 0.6), WHITE, 0.08));
      doc.circle(36, bandH + 30, 70, mix(BAND_FROM, WHITE, 0.07));
    });
    doc.svgPaths(Copy.BRAND_MARK, { x: MARGIN, top: 38, size: 19, color: WHITE });
    doc.draw(toWinAnsi('PsycheAI'), MARGIN + 26, 53, { size: 13, bold: true, color: WHITE });
    const titleStyle = { size: 28, bold: true, color: WHITE };
    let y = 94;
    for (const line of wrap(toWinAnsi((card.name || 'Your') + '’s psyche'), COLUMN - 20, titleStyle).slice(0, 2)) {
      doc.draw(line, MARGIN, y, titleStyle);
      y += 31;
    }
    // Provenance under the title, where a reader looks for when and from what.
    const stamp = ['Generated ' + (meta.date || ''), confidence + '/100 confidence']
      .join('  ·  ');
    doc.draw(toWinAnsi(stamp), MARGIN, y - 8, { size: 8.8, color: mix(WHITE, ACCENT, 0.18) });

    // ---- measure the card ----
    const pad = 16;
    const innerW = COLUMN - pad * 2;
    const heroPad = 14;
    const heroW = innerW - heroPad * 2;
    const nameStyle = { size: 25, bold: true, color: WHITE };
    const textX = 66;
    const nameLines = wrap(toWinAnsi(name), heroW - textX - 70, nameStyle).slice(0, 2);
    const headStyle = { size: 11.4, bold: true, italic: true, color: WHITE };
    const headLines = headline ? wrap(toWinAnsi(headline), heroW, headStyle).slice(0, 2) : [];
    const blurbStyle = { size: 8.9, color: mix(WHITE, ACCENT, 0.06) };
    const blurbLines = blurb ? wrap(toWinAnsi(blurb), heroW, blurbStyle).slice(0, 5) : [];
    const nameBlockH = Math.max(50, 20 + nameLines.length * 27 + (franchise ? 12 : 0));
    const heroH = heroPad + 12 + nameBlockH + (headLines.length ? 8 + headLines.length * 15 : 0) +
      (blurbLines.length ? 5 + blurbLines.length * 12.2 : 0) + heroPad;

    const gap = 8;
    const colW = (innerW - gap) / 2;
    const pPad = 9;
    const pInner = colW - pPad * 2;
    const rowStyle = { size: 8.8, bold: true, color: INK };
    const chipStyle = { size: 7.6, bold: true, color: ACCENT, fill: mix(ACCENT, WHITE, 0.86) };
    const titles = (rows, limit) => (rows || []).slice(0, limit)
      .map(r => (r && (r.title || r.name || r.value || r.belief)) || '').filter(Boolean);

    const patterns = (Array.isArray(report.patterns) ? report.patterns : [])
      .filter(p => p && /^p[1-3]$/.test(p.id) && p.name).sort((a, b) => a.id.localeCompare(b.id));
    const numbered = (list, filled) => ({
      height: list.reduce((h, text) => h + Math.max(1, wrap(toWinAnsi(text), pInner - 20, rowStyle).length) * 11 + 5, 0) - 5,
      draw(x, top) {
        let cy = top;
        list.forEach((text, i) => {
          const lines = wrap(toWinAnsi(text), pInner - 20, rowStyle);
          doc.circle(x + 6.5, cy + 6, 6.5, filled ? ACCENT : mix(ACCENT, WHITE, 0.85));
          const n = toWinAnsi(String(i + 1));
          doc.draw(n, x + 6.5 - measure(n, 7.6, true) / 2, cy + 8.8, { size: 7.6, bold: true, color: filled ? WHITE : ACCENT });
          lines.forEach((line, k) => doc.draw(line, x + 20, cy + 9 + k * 11, rowStyle));
          cy += Math.max(1, lines.length) * 11 + 5;
        });
      },
    });
    const motives = topMotivatorKeys(report).map(key => S.motivators[key].label);
    const letters = (mbti.letters || []).filter(l => l && l.choice);
    const traitKeys = Object.keys(TRAIT_LABELS).filter(key => five[key] && key !== 'extraversion');
    const panels = [
      { label: TEXT.cardPatterns, color: ACCENT, block: numbered(patterns.map(p => p.name), true) },
      { label: S.titles.motivators, color: ACCENT_2, block: numbered(motives, false) },
      { label: TEXT.cardType, color: WARN, block: {
        height: letters.length * 13.5 - 2,
        draw(x, top) {
          letters.forEach((l, i) => {
            const cy = top + i * 13.5;
            doc.draw(toWinAnsi(l.choice), x, cy + 9, { size: 9, bold: true, color: ACCENT });
            doc.draw(toWinAnsi((Copy.MBTI_POLES[l.choice] || {}).name || ''), x + 13, cy + 9, { size: 8.8, color: INK });
            // How firmly the letter was picked, in words, as on the page's card.
            if (l.strength) {
              const word = toWinAnsi(String(l.strength));
              const w = measure(word, 6.8, true) + 10;
              const clear = l.strength === 'clear';
              doc.roundRect(x + pInner - w, cy + 0.5, w, 11, 5.5, clear ? ACCENT : mix(ACCENT, WHITE, l.strength === 'slight' ? 0.9 : 0.82));
              doc.draw(word, x + pInner - w + 5, cy + 8.6, { size: 6.8, bold: true, color: clear ? WHITE : (l.strength === 'slight' ? SOFT : ACCENT) });
            }
          });
        },
      } },
      { label: TEXT.cardBigFive, color: GOOD, block: {
        height: traitKeys.length * 13.5 - 2,
        draw(x, top) {
          traitKeys.forEach((key, i) => {
            const cy = top + i * 13.5;
            const value = Math.max(0, Math.min(100, Math.round(Number(five[key].score) || 0)));
            doc.draw(toWinAnsi(SHORT_TRAITS[key]), x, cy + 9, { size: 8.6, color: INK });
            const barX = x + 74;
            const barW = pInner - 74 - 22;
            doc.roundRect(barX, cy + 4, barW, 4.5, 2.25, mix(LINE, WHITE, 0.2));
            if (value) doc.roundRect(barX, cy + 4, Math.max(4.5, barW * value / 100), 4.5, 2.25, ACCENT);
            const v = toWinAnsi(String(value));
            doc.draw(v, x + pInner - measure(v, 8.6, true), cy + 9, { size: 8.6, bold: true, color: INK });
          });
        },
      } },
    ];
    const valueItems = titles(report.values, 3).concat(titles(report.beliefs, 1)).slice(0, 4);
    const interestItems = titles(report.interests, 3);
    if (valueItems.length || interestItems.length) {
      panels.push({ label: S.cardStandFor, color: ACCENT, block: {
        height: chipRun(null, valueItems, 0, 0, pInner, chipStyle),
        draw: (x, top) => chipRun(doc, valueItems, x, top, pInner, chipStyle) } });
      panels.push({ label: S.cardInto, color: ACCENT_2, block: {
        height: chipRun(null, interestItems, 0, 0, pInner, chipStyle),
        draw: (x, top) => chipRun(doc, interestItems, x, top, pInner, chipStyle) } });
    }
    const loveNames = side => (side || []).slice(0, 2).map(l => l && l.language).filter(Boolean);
    const loveIn = loveNames(love.receiving);
    const loveOut = loveNames(love.giving);
    if (loveIn.length || loveOut.length) {
      const list = items => ({
        height: Math.max(1, items.length) * 12.5 - 2,
        draw(x, top) {
          items.forEach((text, i) => {
            doc.circle(x + 2.5, top + i * 12.5 + 5.6, 2.2, ACCENT_2);
            doc.draw(toWinAnsi(text), x + 10, top + i * 12.5 + 8.6, { size: 8.8, color: INK });
          });
        },
      });
      panels.push({ label: TEXT.cardLoveIn, color: ACCENT_2, block: list(loveIn) });
      panels.push({ label: TEXT.cardLoveOut, color: ACCENT, block: list(loveOut) });
    }
    const labelH = 16;
    const rows = [];
    for (let i = 0; i < panels.length; i += 2) rows.push(panels.slice(i, i + 2));
    const rowHeights = rows.map(row => Math.max(...row.map(p => p.block.height)) + labelH + pPad * 2);
    const gridH = rowHeights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
    const footH = 24;
    const cardTop = 136;
    const cardH = pad + heroH + 12 + gridH + footH;

    // ---- draw the card ----
    doc.roundRect(MARGIN + 1, cardTop + 4, COLUMN, cardH, 18, mix(LINE, ACCENT, 0.12));
    doc.roundRect(MARGIN, cardTop, COLUMN, cardH, 18, WHITE);
    const x0 = MARGIN + pad;
    const heroTop = cardTop + pad;
    doc.gradientBox(x0, heroTop, innerW, heroH, 13, ACCENT, ACCENT_2, () => {
      doc.circle(x0 + innerW - 24, heroTop + 6, 50, mix(ACCENT_2, WHITE, 0.16));
      doc.circle(x0 + innerW + 6, heroTop + 78, 34, mix(ACCENT_2, WHITE, 0.1));
    });
    const hx = x0 + heroPad;
    let hy = heroTop + heroPad;
    doc.draw(toWinAnsi(String(TEXT.essenceLabel).toUpperCase()), hx, hy + 6, { size: 7, bold: true, color: WHITE, tracking: 1.6 });
    if (confidence > 0) {
      const score = toWinAnsi(confidence + '/100');
      const w = measure(score, 9, true) + 18;
      doc.roundRect(x0 + innerW - heroPad - w, hy - 3, w, 18, 9, WHITE);
      doc.draw(score, x0 + innerW - heroPad - w + 9, hy + 9.3, { size: 9, bold: true, color: ACCENT });
    }
    hy += 12;
    emblemDisc(doc, hx + 24, hy + 25, 24, name);
    nameLines.forEach((line, i) => doc.draw(line, hx + textX, hy + 26 + i * 27, nameStyle));
    if (franchise) {
      doc.draw(toWinAnsi(franchise.toUpperCase()), hx + textX, hy + 26 + (nameLines.length - 1) * 27 + 15,
        { size: 7.4, bold: true, color: mix(WHITE, ACCENT, 0.2), tracking: 1.4 });
    }
    hy += nameBlockH;
    if (headLines.length) {
      hy += 8;
      headLines.forEach(line => { doc.draw(line, hx, hy + 10, headStyle); hy += 15; });
    }
    if (blurbLines.length) {
      hy += 5;
      blurbLines.forEach(line => { doc.draw(line, hx, hy + 8.5, blurbStyle); hy += 12.2; });
    }

    let rowTop = heroTop + heroH + 12;
    rows.forEach((row, r) => {
      row.forEach((panel, c) => {
        const px = x0 + c * (colW + gap);
        doc.roundRect(px, rowTop, colW, rowHeights[r], 11, mix(WASH, WHITE, 0.4));
        doc.draw(toWinAnsi(String(panel.label).toUpperCase()), px + pPad, rowTop + pPad + 8.3,
          { size: 6.6, bold: true, color: SOFT, tracking: 1.1 });
        panel.block.draw(px + pPad, rowTop + pPad + labelH);
      });
      rowTop += rowHeights[r] + gap;
    });
    const foot = toWinAnsi(String(S.pdfCardFoot).toUpperCase());
    doc.draw(foot, MARGIN + (COLUMN - measure(foot, 6.2, false, 1)) / 2, cardTop + cardH - 9,
      { size: 6.2, color: SOFT, tracking: 1 });
    return cardTop + cardH;
  }

  /**
   * The cover's contents, drawn last (page numbers only exist once the pages
   * do) into page one's own op buffer: the parts with their numerals in
   * accent tiles, then the evidence page and the roast. Skipped rather than
   * squeezed when the card leaves no room.
   */
  function storyContents(doc, out, cardBottom) {
    const rows = out.contents;
    if (!rows.length) return;
    const rowH = 17.5;
    const columns = 2;
    const perColumn = Math.ceil(rows.length / columns);
    const top = cardBottom + 20;
    if (top + 16 + perColumn * rowH > PAGE.height - 30) return;
    const colW = (COLUMN - 20) / columns;
    const saved = doc.buffer;
    doc.buffer = doc.pages[0].content;
    doc.draw(toWinAnsi(String(TEXT.pdfContents).toUpperCase()), MARGIN, top + 6,
      { size: 6.8, bold: true, color: ACCENT_2, tracking: 1.4 });
    rows.forEach((row, index) => {
      const column = Math.floor(index / perColumn);
      const x = MARGIN + column * (colW + 20);
      const y = top + 14 + (index % perColumn) * rowH;
      const match = String(row.title).match(/^(\d\d)\s+(.*)$/);
      // Parts by numeral in the accent; the appendix by an A in the second colour.
      const mark = toWinAnsi(match ? match[1] : row.mark || '');
      doc.roundRect(x, y, 19, 14, 4, match ? ACCENT : mix(ACCENT_2, WHITE, 0.8));
      if (mark) doc.draw(mark, x + 9.5 - measure(mark, 7.4, true) / 2, y + 9.8, { size: 7.4, bold: true, color: match ? WHITE : ACCENT_2 });
      const page = toWinAnsi(String(row.page));
      const pageW = measure(page, 8.6, true);
      const titleStyle = { size: 9.4, color: INK };
      const title = wrap(toWinAnsi(match ? match[2] : row.title), colW - 28 - pageW - 10, titleStyle)[0];
      doc.draw(title, x + 27, y + 10, titleStyle);
      doc.hairline(y + 17, x + 27, x + colW, mix(LINE, WHITE, 0.3));
      doc.draw(page, x + colW - pageW, y + 10, { size: 8.6, bold: true, color: ACCENT });
    });
    doc.buffer = saved;
  }

  /**
   * The overview's opening: the headline in a gradient block, the character
   * beside its emblem in a tinted card, and the four facts as tiles — a page
   * with some shape to it rather than a run of grey under a run of black.
   */
  function overviewOpening(out, source, who) {
    const S = Copy.STRUCTURED;
    const G = S.pdfGlance;
    const doc = out.doc;
    const headline = String((source.card && source.card.headline) || who.headline || '').trim();
    if (headline) {
      const style = { size: 15, bold: true, color: WHITE };
      const lines = wrap(toWinAnsi(headline), COLUMN - 44, style);
      const h = 22 + 14 + lines.length * 19 + 14;
      out.need(h + 10);
      const top = doc.y;
      doc.gradientBox(MARGIN, top, COLUMN, h, 13, ACCENT, ACCENT_2, () => {
        doc.circle(MARGIN + COLUMN - 20, top + 4, 44, mix(ACCENT_2, WHITE, 0.15));
        doc.circle(MARGIN + COLUMN - 86, top + h + 6, 22, mix(ACCENT_2, WHITE, 0.1));
      });
      doc.draw(toWinAnsi(String(G.headline).toUpperCase()), MARGIN + 22, top + 24,
        { size: 7, bold: true, color: mix(WHITE, ACCENT, 0.15), tracking: 1.6 });
      lines.forEach((line, i) => doc.draw(line, MARGIN + 22, top + 46 + i * 19, style));
      doc.y = top + h + 10;
    }
    const essence = source.essence || {};
    const name = essence.character || essence.noun;
    if (name) {
      out.keep(() => out.boxed(() => {
        const top = doc.y;
        doc.circle(out.x + 27, top + 27, 27, mix(ACCENT, WHITE, 0.82));
        emblemDisc(doc, out.x + 27, top + 27, 22, name);
        const saved = { x: out.x, w: out.w };
        out.x += 68;
        out.w -= 68;
        out.eyebrow(TEXT.essenceLabel);
        const nameStyle = { size: 20, bold: true, color: ACCENT };
        for (const line of wrap(toWinAnsi(name), out.w, nameStyle)) {
          doc.draw(line, out.x, doc.y + 15, nameStyle);
          doc.y += 23;
        }
        if (essence.franchise) {
          doc.draw(toWinAnsi(String(essence.franchise).toUpperCase()), out.x, doc.y + 6,
            { size: 7.4, bold: true, color: SOFT, tracking: 1.3 });
          doc.y += 12;
        }
        doc.y = Math.max(doc.y + 4, top + 60);
        if (essence.why) out.body(essence.why, { size: 9.8, leading: 14.4 });
        out.x = saved.x;
        out.w = saved.w;
      }, { fill: WASH, bar: ACCENT, pad: 14 }));
    }
    // Four facts as tiles.
    const five = source.bigFive || {};
    const topTrait = Object.keys(TRAIT_LABELS).filter(key => five[key])
      .sort((a, b) => (Number(five[b].score) || 0) - (Number(five[a].score) || 0))[0];
    const drive = topMotivatorKeys(source)[0];
    const confidence = Math.round(Number((source.confidence || {}).score) || 0);
    const tiles = [
      source.mbti && source.mbti.type && { label: G.type, value: source.mbti.type, color: ACCENT },
      drive && { label: G.drive, value: S.motivators[drive].label, color: ACCENT_2 },
      topTrait && { label: G.trait, value: String(Math.round(Number(five[topTrait].score) || 0)), note: TRAIT_LABELS[topTrait], color: GOOD },
      confidence > 0 && { label: G.confidence, value: confidence + '/100', note: (source.confidence || {}).level || '', color: WARN },
    ].filter(Boolean);
    if (tiles.length) {
      const gap = 8;
      const w = (COLUMN - gap * (tiles.length - 1)) / tiles.length;
      const valueStyle = { size: 12.5, bold: true };
      const laid = tiles.map(t => wrap(toWinAnsi(t.value), w - 20, valueStyle).slice(0, 2));
      const noteStyle = { size: 8.2, color: INK };
      const notes = tiles.map(t => (t.note ? wrap(toWinAnsi(t.note), w - 20, noteStyle)[0] : ''));
      const h = 32 + Math.max(...laid.map((l, i) => l.length * 15 + (notes[i] ? 11 : 0)));
      out.need(h + 12);
      const top = doc.y + 2;
      tiles.forEach((t, i) => {
        const x = MARGIN + i * (w + gap);
        doc.roundRect(x, top, w, h, 10, t.color);
        doc.roundRect(x, top + 3.5, w, h - 3.5, 10, WHITE);
        doc.draw(toWinAnsi(String(t.label).toUpperCase()), x + 10, top + 18, { size: 6.4, bold: true, color: SOFT, tracking: 1 });
        laid[i].forEach((line, k) => doc.draw(line, x + 10, top + 36 + k * 15, Object.assign({ color: t.color }, valueStyle)));
        if (notes[i]) doc.draw(notes[i], x + 10, top + 36 + laid[i].length * 15 - 2, noteStyle);
      });
      doc.y = top + h + 14;
    }
  }

  function buildStructured(report, card, meta) {
    const S = Copy.STRUCTURED;
    const source = report || {};
    const who = card || {};
    const stamp = meta || {};
    const doc = new Doc();
    const out = new Report(doc, { name: who.name || 'Your profile', date: stamp.date || '' });
    out.partsOnly = true;
    const def = key => S.definitions[key];
    // A section on its own, outside the parts — listed in the contents itself.
    const standalone = (title, sub) => {
      out.partsOnly = false;
      out.sectionTitle(title, sub);
      out.partsOnly = true;
    };

    const patterns = (Array.isArray(source.patterns) ? source.patterns : [])
      .filter(p => p && /^p[1-3]$/.test(p.id) && p.name)
      .sort((a, b) => a.id.localeCompare(b.id));
    const byId = Object.fromEntries(patterns.map(p => [p.id, p]));
    const chip = p => p.id.replace('p', '') + '  ' + p.name;
    const sectionNames = keys => (keys || []).map(key => S.sectionNames[key]).filter(Boolean)
      .filter((name, i, all) => all.indexOf(name) === i);
    const unlocked = stamp.unlocked || {};
    const numeral = key => String(['overview', 'who', 'drives', 'connect', 'together', 'appendix'].indexOf(key)).padStart(2, '0');

    const cardBottom = storyCover(doc, source, who, stamp);
    // Supporting text a size down; section titles kept with their first block
    // by `keep` rather than by a fixed reserve.
    out.small = true;
    out.titleReserve = 90;
    const inset = (by, draw) => {
      out.x += by;
      out.w -= by;
      draw();
      out.x -= by;
      out.w += by;
    };
    const evidence = (items, fill) => out.tags(items, { small: true, fill: fill || mix(WASH, WHITE, 0.35) });

    // 00: the summary and the signature patterns.
    out.page();
    out.part(S.parts.overview, numeral('overview'));
    out.sectionTitle(S.titles.summary, def('summary'));
    overviewOpening(out, source, who);
    const paragraphs = String(source.summary || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
    paragraphs.forEach((text, i) => {
      if (i) out.space(5);
      // The first paragraph leads, a size up; the rest read as its detail.
      out.body(text, i ? { size: 10.2, leading: 15.4 } : { size: 11.4, leading: 17 });
    });
    patterns.forEach((p, i) => out.keep(() => {
      if (!i) out.sectionTitle(S.titles.patterns, def('patterns'));
      out.boxed(() => {
        const top = doc.y;
        doc.circle(out.x + 11, top + 11, 11, ACCENT);
        const n = toWinAnsi(p.id.replace('p', ''));
        doc.draw(n, out.x + 11 - measure(n, 10.5, true) / 2, top + 14.8, { size: 10.5, bold: true, color: WHITE });
        inset(32, () => {
          const nameStyle = { size: 12.6, bold: true, color: INK };
          doc.y = top + 1;
          for (const line of wrap(toWinAnsi(p.name), out.w, nameStyle)) {
            doc.draw(line, out.x, doc.y + 12, nameStyle);
            doc.y += 17;
          }
          out.body(p.line, { size: 10, leading: 14.4 });
          out.space(5);
          evidence(p.evidence);
          const where = sectionNames(p.showsUpIn);
          if (where.length) { out.space(1); out.pills(S.showsUpIn, where); }
        });
      }, { bar: ACCENT, pad: 13 });
    }));

    // 01: who you are. MBTI first, then the Big Five, then wellbeing.
    out.part(S.parts.who, numeral('who'));
    const mbti = source.mbti;
    if (mbti) {
      const axes = (mbti.letters || []).filter(Boolean);
      const axisCard = letter => out.boxed(() =>
        out.axis(letter.choice, Copy.axisLabel(letter.choice, letter.axis), letter.strength, letter.why, letter.inPractice, null, { structured: true }),
      { padTop: 6 });
      out.keep(() => {
        out.sectionTitle('MBTI', def('mbti'));
        if (mbti.type) out.mbtiType(mbti, axes);
        if (axes[0]) axisCard(axes[0]);
      });
      axes.slice(1).forEach(letter => out.keep(() => axisCard(letter)));
    }
    const five = source.bigFive || {};
    Object.keys(TRAIT_LABELS).filter(key => five[key]).forEach((key, i) => out.keep(() => {
      if (!i) out.sectionTitle(TEXT.bigFive, def('bigFive'));
      const trait = five[key];
      out.boxed(() => {
        out.bipolar(TRAIT_LABELS[key] + (trait.band ? ' · ' + trait.band : ''), trait.score, S.poles[key] || [], S.typicalBand);
        if (trait.reading) out.body(trait.reading, { size: 9.6, leading: 14 });
        out.space(5);
        evidence(trait.evidence);
      });
    }));
    const wellness = unlocked.wellness;
    if (wellness) {
      Copy.WELLNESS_FACETS.filter(([, key]) => wellness[key]).forEach(([label, key], i) => out.keep(() => {
        if (!i) out.sectionTitle(S.titles.wellness, def('wellness'));
        const facet = wellness[key];
        const tone = bandTone(facet.band);
        out.boxed(() => {
          out.facetBand(label, facet.band, facet.reading);
          out.space(5);
          evidence(facet.evidence, WHITE);
          if (facet.confidence) out.body(TEXT.wellnessConfidence + facet.confidence, { size: 7.8, color: SOFT, leading: 11 });
        }, { fill: tone.wash, bar: tone.ink, padTop: 4 });
      }));
      if (wellness.overall) out.note(wellness.overall, TEXT.wellnessOverall);
      out.fineprint(S.wellnessNote);
    }

    // 02: what drives you.
    out.part(S.parts.drives, numeral('drives'));
    const motives = {};
    for (const row of ((source.motivators || {}).scores) || []) {
      if (row && S.motivators[row.value]) motives[row.value] = row;
    }
    if (Object.keys(motives).length) {
      const colours = { openness: ACCENT_2, enhancement: WARN, conservation: GOOD, transcendence: ACCENT };
      const groups = Object.keys(S.motivatorGroups)
        .map(group => ({ group, rows: Object.keys(S.motivators).filter(key => S.motivators[key].group === group && motives[key]) }))
        .filter(g => g.rows.length);
      groups.forEach(({ group, rows }, i) => out.keep(() => {
        if (!i) {
          out.sectionTitle(S.titles.motivators, def('motivators'));
          if (source.motivators.reading) out.note(source.motivators.reading);
        }
        out.boxed(() => {
          doc.draw(toWinAnsi(S.motivatorGroups[group].toUpperCase()), out.x, doc.y + 8,
            { size: 7.4, bold: true, color: colours[group], tracking: 1.2 });
          doc.y += 16;
          for (const key of rows) {
            out.motiveRow(S.motivators[key].label, S.motivators[key].meaning, motives[key].score, colours[group], motives[key].line);
          }
          doc.y -= 5;
        }, { top: colours[group], padTop: 13 });
      }));
    }
    const trend = item => {
      const trajectory = String((item && item.trajectory) || '').trim();
      const year = String((item && item.lastSeen) || '').trim();
      const label = trajectory ? ((TEXT.trajectoryLabels && TEXT.trajectoryLabels[trajectory]) || trajectory) : '';
      const stale = trajectory === 'dormant' || trajectory === 'declining' || trajectory === 'phasic';
      return label && stale && /^\d{4}$/.test(year) ? label + ' ' + year : label;
    };
    const interests = source.interests || [];
    if (interests.length) {
      interests.forEach((item, i) => out.keep(() => {
        if (!i) out.sectionTitle(TEXT.interests, def('interests'));
        out.tile(item.name, [item.intensity, trend(item)].filter(Boolean).join(' · '), item.detail, item.evidence);
      }));
    } else {
      out.sectionTitle(TEXT.interests, def('interests'));
      out.muted(TEXT.interestsEmpty);
    }
    // Values and beliefs as one list, drawn alike, as on the page: no
    // subsections and no tag saying which list the model filed each under.
    const values = (source.values || []).filter(item => item && item.value);
    const words = text => String(text || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
    const valueWords = new Set(values.flatMap(item => words(item.value)));
    const beliefs = (source.beliefs || []).filter(item => item && item.belief &&
      !(words(item.belief).length && words(item.belief).every(w => valueWords.has(w))));
    // Four at most — three values and one belief — as on the page.
    const standFor = values.slice(0, 3).map(item => [item.value, trend(item), item.detail, item.evidence])
      .concat(beliefs.slice(0, 1).map(item => [item.belief, '', item.detail, item.evidence]));
    if (standFor.length) {
      standFor.forEach((args, i) => out.keep(() => {
        if (!i) out.sectionTitle(TEXT.valuesBeliefs, def('values'));
        out.tile(...args);
      }));
    } else {
      out.sectionTitle(TEXT.valuesBeliefs, def('values'));
      out.muted(TEXT.valuesEmpty);
    }

    // 03: how you connect and work.
    out.part(S.parts.connect, numeral('connect'));
    const relationship = source.relationship || {};
    const attachment = unlocked.attachment;
    const idealPartner = unlocked.idealPartner;
    // Love languages first, then attachment, what they bring and where it
    // gets hard, and who suits them — one section, as on the page, each part
    // under its own subheading and set in boxes rather than as a run of text.
    const loveRows = list => (list || []).filter(entry => entry && entry.language).flatMap((item, i) => [
      { text: item.language, style: T_TITLE, leading: 14, before: i ? 9 : 0, right: item.strength || '' },
      item.inPractice && { text: item.inPractice, style: T_BODY, leading: 13.2, before: 2 },
      item.why && { text: item.why, style: T_SOFT, leading: 11.6, before: 3 },
    ]).filter(Boolean);
    const love = relationship.loveLanguages;
    out.keep(() => {
      out.sectionTitle(TEXT.relationships, def('relationships'));
      if (love && ((love.receiving || []).length || (love.giving || []).length)) {
        out.subhead(TEXT.loveHead);
        out.pairedPanels(
          { title: TEXT.loveReceiving, color: ACCENT, fill: WASH, rows: loveRows(love.receiving) },
          { title: TEXT.loveGiving, color: ACCENT_2, fill: WASH, rows: loveRows(love.giving) });
        out.fineprint(S.touchNote);
      }
    });
    if (attachment) {
      out.keep(() => {
        out.subhead(S.howYouAttach);
        out.panel([
          attachment.style && { text: attachment.style, style: { size: 12, bold: true, color: ACCENT }, leading: 16 },
          attachment.styleTone && { text: attachment.styleTone, style: { size: 10, bold: true, color: INK }, leading: 14, before: 4 },
          attachment.why && { text: attachment.why, style: T_BODY, leading: 13.8, before: 6 },
        ], { fill: WASH, bar: ACCENT });
        evidence(attachment.derivedFrom);
      });
      const practice = (attachment.implications || []).filter(item => item && item.title);
      if (practice.length) {
        out.keep(() => {
          out.eyebrow(S.inPractice, SOFT);
          out.panel(practice.flatMap((item, i) => [
            { text: item.title, style: T_TITLE, leading: 14, before: i ? 8 : 0 },
            item.detail && { text: item.detail, style: T_BODY, leading: 13.2, before: 2 },
          ]).filter(Boolean), { fill: WHITE, bar: ACCENT_2 });
        });
      }
    }
    const pointRows = list => (list || []).filter(item => item && item.title).flatMap((item, i) => [
      { text: item.title, style: T_TITLE, leading: 14, before: i ? 9 : 0 },
      item.detail && { text: item.detail, style: T_BODY, leading: 13.2, before: 2 },
    ]).filter(Boolean);
    out.space(10);
    out.pairedPanels(
      { title: S.whatYouBring, color: GOOD, fill: GOOD_WASH, rows: pointRows(relationship.strengths) },
      { title: S.whereItGetsHard, color: WARN, fill: WARN_WASH, rows: pointRows(relationship.weaknesses) });
    if (idealPartner) {
      out.keep(() => {
        out.subhead(S.whoSuitsYou);
        if (idealPartner.summary) {
          out.panel([{ text: idealPartner.summary, style: { size: 11, bold: true, italic: true, color: INK }, leading: 15.5 }],
            { fill: WASH, bar: ACCENT });
        }
        out.pairedPanels(
          { title: TEXT.idealPartnerNeeds, color: GOOD, fill: GOOD_WASH, rows: pointRows(idealPartner.needs) },
          { title: TEXT.idealPartnerCarefulOf, color: WARN, fill: WARN_WASH, rows: pointRows(idealPartner.carefulOf) });
      });
    }
    // How you work: the description and the coach's read as one section —
    // the edge in a box of its own, then what sets them apart beside what
    // holds them back. The actions are on the plan.
    const career = source.career || {};
    const coaching = unlocked.careerAssessment;
    out.keep(() => {
      out.sectionTitle(S.titles.work, def('work'));
      for (const text of [career.workStyle, coaching && coaching.situation].filter(Boolean)) {
        out.body(text, { size: 10, leading: 15 });
        out.space(4);
      }
      if (coaching && coaching.edge) {
        out.panel([
          { text: coaching.edge.headline, style: { size: 12, bold: true, color: INK }, leading: 16 },
          coaching.edge.detail && { text: coaching.edge.detail, style: T_BODY, leading: 13.8, before: 4 },
        ], { fill: WASH, bar: ACCENT, label: TEXT.careerEdge });
        evidence(coaching.edge.evidence);
      }
    });
    const strengths = (career.strengths || []).concat(coaching && coaching.underused
      ? [{ title: S.notYetUsing + coaching.underused.headline, detail: coaching.underused.detail }] : []);
    const holding = [].concat(
      coaching && coaching.holdingBack ? [{ title: coaching.holdingBack.headline, detail: coaching.holdingBack.detail }] : [],
      career.weaknesses || [],
      career.watchOuts ? [{ title: S.whereItGoesWrong, detail: career.watchOuts }] : []);
    out.space(4);
    out.pairedPanels(
      { title: coaching && coaching.edge ? S.otherStrengths : TEXT.strengths, color: GOOD, fill: GOOD_WASH, rows: pointRows(strengths) },
      { title: S.whatHoldsYouBack, color: WARN, fill: WARN_WASH, rows: pointRows(holding) });

    // 04: putting it together.
    out.part(S.parts.together, numeral('together'));
    const development = source.development || {};
    const buildOn = (development.buildOn || []).filter(item => item && item.title);
    const develop = (development.develop || []).filter(item => item && item.title);
    if (buildOn.length || develop.length) {
      const devCard = (item, i, list, head, color, wash) => out.keep(() => {
        if (!i && head === S.titles.buildOn) out.sectionTitle(S.titles.development, def('development'));
        if (!i) out.h3(head, color);
        if (!i) out.space(4);
        out.boxed(() => {
          out.point(item.title, item.detail, { bar: false, size: 11, detailColor: INK, detailSize: 9.6, detailLeading: 13.8 });
          if (item.reflect) {
            out.space(2);
            out.labelled(S.reflect, item.reflect, { italic: true, color: INK, size: 9.4, labelColor: color });
          }
          doc.y -= 4;
        }, { fill: wash, bar: color });
      });
      buildOn.forEach((item, i) => devCard(item, i, buildOn, S.titles.buildOn, GOOD, GOOD_WASH));
      if (!buildOn.length) out.sectionTitle(S.titles.development, def('development'));
      develop.forEach((item, i) => devCard(item, i, develop, S.titles.develop, WARN, WARN_WASH));
      // Every action in the report on one plan, a row per step: the develop
      // areas', the work coaching's and the wellbeing suggestions'.
      const actions = develop.flatMap(item => (item.actions || []).filter(a => a && a.step)
        .map(a => ({ horizon: a.horizon, step: a.step, from: item.title })))
        .concat(((coaching && coaching.actions) || []).filter(a => a && a.title)
          .map(a => ({ horizon: a.horizon, step: a.title, detail: a.detail, from: S.fromWork })))
        .concat(((wellness && wellness.suggestions) || []).filter(a => a && a.title)
          .map(a => ({ horizon: 'this week', step: a.title, detail: a.detail, from: S.fromWellbeing })));
      const horizons = Object.keys(TEXT.careerHorizons);
      const groups = horizons.map((horizon, i) => ({ horizon,
        here: actions.filter(a => a.horizon === horizon || (i === 0 && !horizons.includes(a.horizon))) }))
        .filter(g => g.here.length);
      // As on the page: each horizon named in a column on the left, and its
      // steps beside it as cards with a box to tick.
      const labelW = 96;
      groups.forEach((g, gi) => g.here.forEach((action, i) => out.keep(() => {
        if (!gi && !i) out.h3(S.titles.plan);
        if (!i) {
          out.space(gi ? 10 : 4);
          if (gi) doc.hairline(doc.y - 6, MARGIN, MARGIN + COLUMN, mix(LINE, WHITE, 0.2));
          doc.circle(MARGIN + 4, doc.y + 9, 4, ACCENT);
          doc.draw(toWinAnsi(TEXT.careerHorizons[g.horizon]), MARGIN + 14, doc.y + 12.5, { size: 10, bold: true, color: INK });
        }
        inset(labelW, () => out.boxed(() => planStep(out, action), { pad: 10, gap: 6, radius: 9 }));
      })));
    }
    const pressure = (source.pressurePoints || []).filter(item => item && item.strength);
    pressure.forEach((item, i) => out.keep(() => {
      if (!i) out.sectionTitle(S.titles.pressurePoints, def('pressurePoints'));
      out.pressureCard(item, {
        earlySigns: S.earlySigns, counterMove: S.counterMove, reflect: S.reflect,
        level: S.levelLabels[item.level] || '', atBest: S.atBest,
        overused: S.overusedPrefix + (item.overused || ''),
      });
    }));

    // The appendix: Evidence and method on a page of its own after the
    // parts, then the roast alone on the last page.
    const confidence = source.confidence || {};
    const score = Math.max(0, Math.min(100, Math.round(Number(confidence.score) || 0)));
    out.keep(() => {
      out.part(S.parts.appendix, numeral('appendix'), { flow: true });
      out.sectionTitle(S.titles.method, def('method'));
      out.boxed(() => {
        doc.roundRect(out.x, doc.y, out.w, 7, 3.5, mix(LINE, WHITE, 0.3));
        if (score > 0) doc.roundRect(out.x, doc.y, Math.max(7, out.w * score / 100), 7, 3.5, ACCENT);
        doc.y += 18;
        out.body(TEXT.trustScore + score + '/100 (' + (confidence.level || '') + ').', { size: 10.4, bold: true, leading: 15 });
        if (confidence.rationale) out.body(confidence.rationale, { size: 9.8, leading: 14.4 });
      }, { bar: ACCENT });
    });
    const readFrom = (stamp.counted || []).length ? stamp.counted : (confidence.basedOn || []);
    if (readFrom.length) {
      out.keep(() => {
        out.eyebrow(TEXT.confidenceBasedOn, SOFT);
        out.tags(readFrom, { small: true });
      });
    }
    out.fineprint('Analysed by ' + (stamp.model || 'the model') + ' on ' + (stamp.date || '') + '.');
    if (stamp.premiumModel && stamp.premiumDate) {
      out.fineprint('Full premium report written by ' + stamp.premiumModel + ' on ' + stamp.premiumDate + '.');
    }
    if (source.bonus) {
      out.page();
      out.eyebrow(numeral('appendix') + '  ' + S.parts.appendix.title, ACCENT_2);
      renderRoast(out, source.bonus, { structured: true });
    }

    storyContents(doc, out, cardBottom);
    return serialise(doc, (who.name || 'Your') + '’s psyche',
      'Personality analysis from an Instagram data export');
  }

  /**
   * One step of the plan: a box to tick, the step, its detail a size down,
   * and where it came from as a tag.
   */
  function planStep(out, action) {
    const doc = out.doc;
    const top = doc.y;
    doc.roundRect(out.x, top + 1, 12, 12, 3, mix(ACCENT, WHITE, 0.45));
    doc.roundRect(out.x + 1.3, top + 2.3, 9.4, 9.4, 2.2, WHITE);
    const saved = { x: out.x, w: out.w };
    out.x += 22;
    out.w -= 22;
    const style = { size: 10.2, bold: true, color: INK };
    for (const line of wrap(toWinAnsi(action.step), out.w, style)) {
      out.need(15);
      doc.draw(line, out.x, doc.y + 10, style);
      doc.y += 14.5;
    }
    if (action.detail) out.body(action.detail, { size: 9, color: SOFT, leading: 12.8 });
    if (action.from) { out.space(2); planSource(out, action.from); doc.y -= 4; }
    out.x = saved.x;
    out.w = saved.w;
  }

  /** A plan step's source, as a small bent arrow and a tag in the accent. */
  function planSource(out, from) {
    const doc = out.doc;
    out.need(18);
    const text = toWinAnsi(from);
    const x = out.x;
    const top = doc.y + 2;
    doc.setStroke(ACCENT);
    doc.op('0.9 w 1 J 1 j');
    doc.tracePath('M0 0V5H6M4 3L6 5L4 7', v => x + v, v => PAGE.height - (top + 1 + v));
    doc.op('S');
    const w = measure(text, 7.4, true) + 12;
    doc.roundRect(x + 10, top, w, 13, 6.5, mix(ACCENT, WHITE, 0.86));
    doc.draw(text, x + 16, top + 9.1, { size: 7.4, bold: true, color: ACCENT });
    doc.y += 18;
  }

  // ---------- serialisation ----------

  // ---------- the compatibility report ----------

  /**
   * The cover for a comparison. Same band and lockup as the profile's, but the
   * subject is a pair rather than a person, and the number that belongs in the
   * band is the score rather than a confidence figure.
   */
  function compatCover(doc, report, meta) {
    doc.newPage({ bare: true, top: 0 });
    doc.rect(0, 0, PAGE.width, PAGE.height, PAPER);
    const bandHeight = 176;
    doc.rect(0, 0, PAGE.width, bandHeight, ACCENT);
    doc.setFill(ACCENT_2);
    doc.op('0 ' + num(PAGE.height - bandHeight) + ' m ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight) + ' l ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight + 34) + ' l 0 ' +
      num(PAGE.height - bandHeight) + ' l f');

    doc.svgPaths(Copy.BRAND_MARK, { x: MARGIN, top: 42, size: 19, color: WHITE });
    doc.draw(toWinAnsi('PsycheAI'), MARGIN + 26, 57, { size: 13, bold: true, color: WHITE });

    const title = meta.a + ' & ' + meta.b;
    const titleStyle = { size: 27, bold: true, color: WHITE };
    let y = 96;
    for (const line of wrap(toWinAnsi(title), COLUMN - 20, titleStyle)) {
      doc.draw(line, MARGIN, y, titleStyle);
      y += 31;
    }
    // The basis, and for a work run the side of it, because "Professional /
    // work" alone does not say whether the reader manages this person.
    const basis = [meta.modeLabel, meta.stanceLabel].filter(Boolean).join('  ·  ');
    if (basis) {
      const style = { size: 11.5, italic: true, color: WHITE };
      for (const line of wrap(toWinAnsi(basis), COLUMN - 30, style).slice(0, 2)) {
        doc.draw(line, MARGIN, y + 2, style);
        y += 15;
      }
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)));
    const stamp = ['Generated ' + (meta.date || ''), report.band, score + '/100']
      .filter(Boolean).join('  ·  ');
    doc.draw(toWinAnsi(stamp), MARGIN, bandHeight + 26, { size: 8.8, color: SOFT });
    doc.y = bandHeight + 40;
  }

  /**
   * A comparison as a PDF, section for section with what the report page shows
   * and in the same order. Every heading comes from copy.js for the same
   * reason the profile's do: two renderings of one document that drift the
   * moment the strings are written twice.
   */
  function buildCompatibility(report, meta) {
    bindCopy();
    const source = report || {};
    const stamp = meta || {};
    const a = stamp.a || 'You';
    const b = stamp.b || 'Them';
    const doc = new Doc();
    const out = new Report(doc, { name: a + ' & ' + b });

    compatCover(doc, source, stamp);

    // 1. The verdict, under the score the cover already carries.
    out.sectionTitle((stamp.modeLabel || '') + TEXT.compatSuffix, source.band);
    if (source.verdict) out.body(source.verdict);

    // 2. Where it holds and where it does not — the same bars the Big Five
    // uses on the profile side, for the same reason.
    const dimensions = (source.dimensions || []).filter(d => d && d.name);
    if (dimensions.length) {
      out.sectionTitle(TEXT.compatDimensions, TEXT.compatDimensionsSub);
      for (const item of dimensions) {
        out.bar(item.name, item.score);
        if (item.reading) out.body(item.reading, { size: 9.8, color: SOFT, leading: 14 });
        out.tags(item.evidence);
      }
    }

    // 3. The short version.
    out.sectionTitle(TEXT.compatShort);
    if (source.biggestUpside) { out.h3(TEXT.compatUpside, GOOD); out.body(source.biggestUpside); }
    if (source.biggestRisk) { out.h3(TEXT.compatRisk, WARN); out.body(source.biggestRisk); }
    if ((source.sharedGround || []).length) {
      out.h3(TEXT.compatCommon);
      out.tags(source.sharedGround);
    }

    // 4 and 5. What works, what will rub — each claim with its evidence, which
    // is the whole point of the citation field.
    for (const [title, items, colour] of [
      [TEXT.compatWorks, source.strengths, GOOD],
      [TEXT.compatRubs, source.frictions, WARN],
    ]) {
      out.sectionTitle(title);
      const list = (items || []).filter(Boolean);
      if (!list.length) { out.muted(TEXT.pointsEmpty); continue; }
      for (const item of list) {
        out.point(item.title, item.detail);
        out.tags(item.evidence, { x: MARGIN + 10, width: COLUMN - 10, size: 8.5 });
      }
      // Referenced so the colour is not an unused binding if the loop changes.
      void colour;
    }

    // 6. The playbook, whose heading belongs to the stance rather than the
    // basis on a work run.
    const play = source.howToPartner || {};
    out.sectionTitle(stamp.heading || '');
    if ((play.forA || []).length) {
      out.h3(TEXT.compatFor + a);
      for (const line of play.forA) out.bullet(line);
    }
    if ((play.forB || []).length) {
      out.h3(TEXT.compatFor + b);
      for (const line of play.forB) out.bullet(line);
    }
    if ((play.together || []).length) {
      out.h3(TEXT.compatBoth);
      for (const line of play.together) out.bullet(line);
    }

    // 7. Conversation starters.
    if ((source.conversationStarters || []).length) {
      out.sectionTitle(TEXT.compatTalk);
      for (const line of source.conversationStarters) out.bullet(line);
    }

    if (source.caveats) out.fineprint(source.caveats);
    out.fineprint('Analysed by ' + (stamp.model || 'the model') + ' on ' + (stamp.date || '') + '.');

    return serialise(doc, a + ' & ' + b + ' — compatibility report',
      'Compatibility report from two PsycheAI profiles');
  }

  function serialise(doc, docTitle, subject) {
    // Page numbers go on last, because now the total is known. The cover is
    // deliberately left clean.
    doc.pages.forEach((page, index) => {
      if (!index) return;
      const label = toWinAnsi('Page ' + (index + 1) + ' of ' + doc.pages.length);
      const width = measure(label, 8, false);
      const saved = doc.buffer;
      doc.buffer = page.content;
      doc.draw(label, (PAGE.width - width) / 2, PAGE.height - MARGIN + 12, { size: 8, color: SOFT });
      doc.buffer = saved;
    });

    const objects = [];
    const add = body => {
      objects.push(body);
      return objects.length;
    };

    // Reserve 1 and 2 for the catalogue and the page tree.
    add('');
    add('');
    const helvetica = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const oblique = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
    const resources = '<< /Font << /F1 ' + helvetica + ' 0 R /F2 ' + bold +
      ' 0 R /F3 ' + oblique + ' 0 R >> >>';

    const pageIds = [];
    for (const page of doc.pages) {
      const stream = page.content.join('\n');
      const contentId = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      pageIds.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(PAGE.width) + ' ' +
        num(PAGE.height) + '] /Resources ' + resources + ' /Contents ' + contentId + ' 0 R >>'));
    }

    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') +
      '] /Count ' + pageIds.length + ' >>';

    const info = add('<< /Title (' + toWinAnsi(docTitle).replace(/([\\()])/g, '\\$1') +
      ') /Author (PsycheAI) /Creator (PsycheAI) /Subject (' +
      toWinAnsi(subject).replace(/([\\()])/g, '\\$1') + ') >>');

    let file = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(file.length);
      file += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });

    const xref = file.length;
    file += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for (const offset of offsets) {
      file += String(offset).padStart(10, '0') + ' 00000 n \n';
    }
    file += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info ' + info +
      ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';

    const bytes = new Uint8Array(file.length);
    for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  root.PsychePDF = { build, buildCompatibility, toWinAnsi, measure };
})(typeof window !== 'undefined' ? window : globalThis);
