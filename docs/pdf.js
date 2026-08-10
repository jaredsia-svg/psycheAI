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
    const r = Math.min(radius, height / 2, width / 2);
    const bottom = PAGE.height - top - height;
    const right = x + width;
    const topY = PAGE.height - top;
    const k = r * 0.5523;
    this.setFill(color);
    this.op(num(x + r) + ' ' + num(bottom) + ' m');
    this.op(num(right - r) + ' ' + num(bottom) + ' l');
    this.op(num(right - r + k) + ' ' + num(bottom) + ' ' + num(right) + ' ' + num(bottom + r - k) + ' ' + num(right) + ' ' + num(bottom + r) + ' c');
    this.op(num(right) + ' ' + num(topY - r) + ' l');
    this.op(num(right) + ' ' + num(topY - r + k) + ' ' + num(right - r + k) + ' ' + num(topY) + ' ' + num(right - r) + ' ' + num(topY) + ' c');
    this.op(num(x + r) + ' ' + num(topY) + ' l');
    this.op(num(x + r - k) + ' ' + num(topY) + ' ' + num(x) + ' ' + num(topY - r + k) + ' ' + num(x) + ' ' + num(topY - r) + ' c');
    this.op(num(x) + ' ' + num(bottom + r) + ' l');
    this.op(num(x) + ' ' + num(bottom + r - k) + ' ' + num(x + r - k) + ' ' + num(bottom) + ' ' + num(x + r) + ' ' + num(bottom) + ' c');
    return this.op('f');
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

    for (const data of mark.paths) {
      let cursorX = 0;
      let cursorY = 0;
      let startX = 0;
      let startY = 0;
      const commands = data.match(/[MmLlHhVvCcAaZz][^MmLlHhVvCcAaZz]*/g) || [];
      for (const chunk of commands) {
        const code = chunk[0];
        const relative = code === code.toLowerCase();
        const numbers = (chunk.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
        const letter = code.toUpperCase();

        if (letter === 'Z') {
          this.op('h');
          cursorX = startX;
          cursorY = startY;
          continue;
        }
        // Each command takes a fixed number of arguments and may repeat them.
        const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, A: 7 }[letter];
        for (let i = 0; i + arity <= numbers.length; i += arity) {
          const args = numbers.slice(i, i + arity);
          if (letter === 'M' || letter === 'L') {
            const x = relative ? cursorX + args[0] : args[0];
            const y = relative ? cursorY + args[1] : args[1];
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
          } else if (letter === 'C') {
            const base = relative ? [cursorX, cursorY] : [0, 0];
            const points = [];
            for (let k = 0; k < 6; k += 2) {
              points.push([base[0] + args[k], base[1] + args[k + 1]]);
            }
            this.op(points.map(p => num(px(p[0])) + ' ' + num(py(p[1]))).join(' ') + ' c');
            cursorX = points[2][0];
            cursorY = points[2][1];
          } else if (letter === 'A') {
            const endX = relative ? cursorX + args[5] : args[5];
            const endY = relative ? cursorY + args[6] : args[6];
            for (const curve of arcToBeziers(cursorX, cursorY, args[0], args[1],
              args[2] * Math.PI / 180, args[3], args[4], endX, endY)) {
              this.op(curve.map(p => num(px(p[0])) + ' ' + num(py(p[1]))).join(' ') + ' c');
            }
            cursorX = endX;
            cursorY = endY;
          }
        }
      }
    }
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

  Report.prototype.page = function () {
    this.doc.newPage();
    // Running head, so a printed page found on its own still says whose it is
    // and where it came from: the lockup on the left, the subject's name on the
    // right. The mark and wordmark keep the cover's proportions — the cover
    // offsets its wordmark by 26 against a 19pt mark, so a 13pt mark here takes
    // 18 — and the wordmark sits on the same baseline as the name opposite it.
    this.doc.svgPaths(Copy.BRAND_MARK, { x: MARGIN, top: MARGIN - 9, size: 13, color: ACCENT });
    this.doc.draw(toWinAnsi('PsycheAI'), MARGIN + 18, MARGIN, { size: 9, bold: true, color: ACCENT });
    const who = toWinAnsi(this.meta.name);
    const width = measure(who, 8, false);
    this.doc.draw(who, PAGE.width - MARGIN - width, MARGIN, { size: 8, color: SOFT });
    this.doc.hairline(MARGIN + 6, MARGIN, PAGE.width - MARGIN);
    this.doc.y = MARGIN + 34;
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
    const x = settings.x === undefined ? MARGIN : settings.x;
    const width = settings.width === undefined ? COLUMN : settings.width;
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
    this.doc.draw(toWinAnsi(String(text).toUpperCase()), MARGIN, this.doc.y + 8,
      { size: 7.5, bold: true, color: color || ACCENT_2, tracking: 1.2 });
    this.doc.y += 15;
    return this;
  };

  /** A section head: the page's card-head, minus the glyph. */
  Report.prototype.sectionTitle = function (title, sub) {
    // Keep a title with at least a couple of lines of what follows.
    this.need(sub ? 130 : 100);
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
    const lines = wrap(toWinAnsi(text), COLUMN, style);
    this.need(26 + lines.length * 17);
    this.space(9);
    for (const line of lines) {
      this.doc.draw(line, MARGIN, this.doc.y + 9, style);
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
  Report.prototype.point = function (title, detail) {
    const style = { size: 10.5, bold: true, color: INK };
    // These titles are not always a few words: an activity observation is a
    // full sentence, and an unwrapped one ran off the side of the page.
    const lines = wrap(toWinAnsi(title), COLUMN - 20, style);
    this.need(26 + lines.length * 15);
    this.space(3);
    this.doc.rect(MARGIN, this.doc.y, 2.5, lines.length * 15 - 3, ACCENT);
    for (const line of lines) {
      this.doc.draw(line, MARGIN + 10, this.doc.y + 8.5, style);
      this.doc.y += 15;
    }
    if (detail) this.body(detail, { x: MARGIN + 10, width: COLUMN - 10, size: 9.8, color: SOFT, leading: 14 });
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
    const size = settings.size || 9;
    const left = settings.x === undefined ? MARGIN : settings.x;
    const width = settings.width === undefined ? COLUMN : settings.width;
    const list = (items || []).map(item => toWinAnsi(item)).filter(Boolean);
    if (!list.length) return this;
    let x = left;
    let rowOpen = false;
    for (const item of list) {
      const chipWidth = measure(item, size, false) + 16;
      if (chipWidth > width) {
        // Too wide to be a chip: close the row and give it a wrapped box.
        if (rowOpen) { this.doc.y += 20; rowOpen = false; x = left; }
        const style = { size, color: SOFT };
        const lines = wrap(item, width - 20, style);
        const height = lines.length * 12.6 + 10;
        this.need(height + 4);
        this.doc.roundRect(left, this.doc.y, width, height, 6, WASH);
        let inner = this.doc.y + 5;
        for (const line of lines) {
          this.doc.draw(line, left + 10, inner + 9, style);
          inner += 12.6;
        }
        this.doc.y += height + 4;
        continue;
      }
      if (!rowOpen) { this.need(24); rowOpen = true; }
      if (x > left && x + chipWidth > left + width) {
        this.doc.y += 20;
        this.need(24);
        x = left;
      }
      this.doc.roundRect(x, this.doc.y, chipWidth, 16, 8, WASH);
      this.doc.draw(item, x + 8, this.doc.y + 11.4, { size, color: SOFT });
      x += chipWidth + 5;
    }
    if (rowOpen) this.doc.y += 20;
    this.space(4);
    return this;
  };

  /** One of the page's tiles: a title, an optional pill, detail, evidence. */
  Report.prototype.tile = function (title, pill, detail, evidence) {
    const titleStyle = { size: 10.8, bold: true, color: INK };
    const detailStyle = { size: 9.8, color: INK };
    const evidenceStyle = { size: 8.8, color: SOFT };
    const label = pill ? toWinAnsi(pill) : '';
    const labelWidth = label ? measure(label, 8, true, 0.6) + 12 : 0;
    const titleLines = wrap(toWinAnsi(title), COLUMN - 28 - labelWidth, titleStyle);
    const detailLines = detail ? wrap(toWinAnsi(detail), COLUMN - 28, detailStyle) : [];
    const evidenceLines = evidence ? wrap(toWinAnsi(evidence), COLUMN - 28, evidenceStyle) : [];
    const height = 12 + titleLines.length * 15 + detailLines.length * 14 +
      (evidenceLines.length ? 4 + evidenceLines.length * 12.4 : 0) + 12;

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
        inner += 12.4;
      }
    }
    this.doc.y += height + 8;
    return this;
  };

  /**
   * The headline findings strip under the essence, ruled top and bottom.
   *
   * The row height is measured, not assumed. "Openness to experience" and
   * "Leans Anxious-Preoccupied" both wrap to two lines in a quarter-width
   * column, and a fixed height pushed their notes through the bottom rule.
   */
  Report.prototype.glance = function (items) {
    if (!items.length) return this;
    const columns = Math.min(items.length, 4);
    const gutter = 12;
    const cellWidth = COLUMN / columns;
    const textWidth = cellWidth - gutter;
    const valueStyle = { size: 10.4, bold: true, color: INK };
    const valueLeading = 12.4;

    // Wrap every cell first, so the tallest one sets the height of the row.
    // Notes wrap too: the note under "Type" is the MBTI nickname, and a long
    // one ran straight across the neighbouring column.
    const noteStyle = { size: 8.4, color: SOFT };
    const noteLeading = 11;
    const cells = items.map(item => ({
      label: toWinAnsi(String(item.label).toUpperCase()),
      lines: wrap(toWinAnsi(item.value), textWidth, valueStyle),
      notes: item.note ? wrap(toWinAnsi(item.note), textWidth, noteStyle).slice(0, 2) : [],
    }));
    const rowCount = Math.ceil(cells.length / columns);
    const rowHeights = [];
    const rowValueLines = [];
    for (let row = 0; row < rowCount; row++) {
      const inRow = cells.slice(row * columns, row * columns + columns);
      const tallest = Math.max(...inRow.map(cell => cell.lines.length));
      const notes = Math.max(0, ...inRow.map(cell => cell.notes.length));
      rowValueLines.push(tallest);
      rowHeights.push(20 + tallest * valueLeading + (notes ? notes * noteLeading + 2 : 0) + 8);
    }
    const total = rowHeights.reduce((sum, height) => sum + height, 0);

    this.need(total + 20);
    this.space(4);
    this.doc.hairline(this.doc.y, MARGIN, PAGE.width - MARGIN);
    this.doc.y += 9;
    const top = this.doc.y;

    cells.forEach((cell, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = MARGIN + column * cellWidth;
      const y = top + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0);
      this.doc.draw(cell.label, x, y + 7, { size: 7.2, bold: true, color: SOFT, tracking: 1 });
      let cursor = y + 20;
      for (const line of cell.lines) {
        this.doc.draw(line, x, cursor, valueStyle);
        cursor += valueLeading;
      }
      // Notes start on a shared baseline per row, so they line up across
      // columns even when one value wrapped and its neighbour did not.
      let noteCursor = y + 20 + rowValueLines[row] * valueLeading;
      for (const line of cell.notes) {
        this.doc.draw(line, x, noteCursor, noteStyle);
        noteCursor += noteLeading;
      }
    });

    this.doc.y = top + total;
    this.doc.hairline(this.doc.y, MARGIN, PAGE.width - MARGIN);
    this.space(12);
    return this;
  };

  /** One MBTI axis: the lettered square, the pole it beat, and the reasoning. */
  Report.prototype.axis = function (letter, pole, strength, why, inPractice) {
    const nameStyle = { size: 11.5, bold: true, color: INK };
    const whyStyle = { size: 9.8, color: INK, leading: 14 };
    this.need(76);
    this.space(6);
    const top = this.doc.y;
    const glyph = toWinAnsi(String(letter || '?'));
    this.doc.roundRect(MARGIN, top, 28, 28, 7, ACCENT);
    const glyphWidth = measure(glyph, 14, true);
    this.doc.draw(glyph, MARGIN + (28 - glyphWidth) / 2, top + 19, { size: 14, bold: true, color: WHITE });

    const textLeft = MARGIN + 40;
    const textWidth = COLUMN - 40;
    if (strength) {
      const label = toWinAnsi(strength);
      const width = measure(label, 8, true, 0.8);
      this.doc.draw(label, PAGE.width - MARGIN - width, top + 9,
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
    if (inPractice) this.body(inPractice, { x: textLeft, width: textWidth, size: 9.4, color: SOFT, leading: 13.4 });
    this.space(3);
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

  // ---------- the letterhead ----------
  //
  // The page's own printed letterhead: the brand, whose report this is, and the
  // line of provenance. Content starts underneath it rather than on a separate
  // cover, exactly as the printed page flows.

  function letterhead(doc, report, card, meta) {
    doc.newPage({ bare: true, top: 0 });
    doc.rect(0, 0, PAGE.width, PAGE.height, PAPER);
    const bandHeight = 176;
    doc.rect(0, 0, PAGE.width, bandHeight, ACCENT);
    // A second, darker wedge so the band is not a flat slab of colour.
    doc.setFill(ACCENT_2);
    doc.op('0 ' + num(PAGE.height - bandHeight) + ' m ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight) + ' l ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight + 34) + ' l 0 ' +
      num(PAGE.height - bandHeight) + ' l f');

    // The brand lockup, as the nav and the printed letterhead have it: the mark
    // with the wordmark beside it.
    doc.svgPaths(Copy.BRAND_MARK, { x: MARGIN, top: 42, size: 19, color: WHITE });
    // Mixed case, no tracking: the same wordmark style the nav uses, not the
    // tracked-caps treatment print letterheads default to.
    doc.draw(toWinAnsi('PsycheAI'), MARGIN + 26, 57, { size: 13, bold: true, color: WHITE });

    // The title, and nothing under it. The card's one-line headline used to sit
    // here in italics, and it read as a claim the cover was making about the
    // person before they had read a word of the evidence — "High-energy tech
    // investor, macro thinker, and social catalyst" under their own name. The
    // band keeps its height, so the space below simply stays empty; the
    // provenance line and the first section are positioned off `bandHeight`
    // rather than off this block, and do not move up to fill it.
    const title = (card.name || 'Your') + '’s personality analysis';
    const titleStyle = { size: 27, bold: true, color: WHITE };
    let y = 96;
    for (const line of wrap(toWinAnsi(title), COLUMN - 20, titleStyle)) {
      doc.draw(line, MARGIN, y, titleStyle);
      y += 31;
    }

    // The same provenance line the printed page carries.
    const confidence = report.confidence || {};
    const stamp = ['Generated ' + (meta.date || ''), 'from an Instagram data export',
      Math.round(Number(confidence.score) || 0) + '/100 confidence']
      .filter(Boolean).join('  ·  ');
    doc.draw(toWinAnsi(stamp), MARGIN, bandHeight + 26, { size: 8.8, color: SOFT });
    doc.y = bandHeight + 40;
  }

  // ---------- the report ----------

  function build(report, card, meta) {
    bindCopy();
    const source = report || {};
    const who = card || {};
    const stamp = meta || {};
    const doc = new Doc();
    const out = new Report(doc, { name: who.name || 'Your profile' });

    letterhead(doc, source, who, stamp);

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
    out.glance(Copy.glanceItems(source));
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
          letter.strength, letter.why, letter.inPractice);
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

    // 5. Interests.
    out.sectionTitle(TEXT.interests);
    const interests = source.interests || [];
    if (interests.length) {
      for (const item of interests) out.tile(item.name, item.intensity, item.detail, item.evidence);
    } else {
      out.muted(TEXT.interestsEmpty);
    }

    // 6. Values and beliefs, together, as the page groups them.
    out.sectionTitle(TEXT.valuesBeliefs, TEXT.valuesBeliefsSub);
    out.h3(TEXT.values);
    const values = source.values || [];
    if (values.length) {
      for (const item of values) out.tile(item.value, '', item.detail, item.evidence);
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

      const attachment = relationship.attachment;
      if (attachment) {
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
        out.fineprint(attachment.caveat);
      }

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
      out.h3(TEXT.thrive);
      for (const item of (career.environments || []).filter(Boolean)) out.bullet(item);
      out.h3(TEXT.holdBack);
      if (career.watchOuts) out.body(career.watchOuts, { size: 10, leading: 15 });
    }

    // 9. Instagram behaviour. After the personality sections, because it is the
    // evidence underneath them rather than another verdict.
    const activity = source.activity;
    if (activity) {
      out.sectionTitle(TEXT.activity, activity.summary);
      for (const [label, key] of Copy.ACTIVITY_FACETS) {
        const part = activity[key];
        if (!part) continue;
        out.facet(label, part.headline, part.detail);
      }
      // What they take in is not one of the facets above: it carries a list of
      // accounts and a second reading, so it runs on its own underneath, the
      // same shape it takes on screen.
      const diet = activity.diet;
      if (diet) {
        out.facet(TEXT.diet, diet.headline, diet.detail);
        const accounts = (diet.topAccounts || []).filter(Boolean);
        if (accounts.length) {
          out.h3(TEXT.dietAccounts);
          out.muted(TEXT.dietAccountsSub);
          for (const item of accounts) out.tile(item.account, item.kind, item.share, item.why);
        }
        if (diet.algorithmRead) {
          out.h3(TEXT.dietAlgorithm);
          out.body(diet.algorithmRead);
        }
      }
      const recommendations = (activity.recommendations || []).filter(Boolean);
      const antiRecommendations = (activity.antiRecommendations || []).filter(Boolean);
      if (recommendations.length || antiRecommendations.length) {
        out.h3(TEXT.recommendations, GOOD);
        out.points(recommendations);
        out.h3(TEXT.antiRecommendations, WARN);
        out.muted(TEXT.antiRecommendationsSub);
        out.points(antiRecommendations);
      }
      out.fineprint(activity.blindSpots);
    }

    // The bonus section, which the page keeps behind a cover. There is no
    // clicking in a PDF, so the caveat carries the warning on its own and goes
    // above the writing rather than after it — this is a file people keep and
    // reopen, and a reader landing on it cold should meet the caveat first.
    const bonus = source.bonus;
    if (bonus) {
      out.sectionTitle(TEXT.bonus, TEXT.bonusSub);
      out.note(TEXT.bonusCaveat);
      out.h3(TEXT.bonusHarsh);
      out.body(bonus.harsh);
      out.h3(TEXT.bonusAdvice);
      out.body(bonus.advice);
      out.h3(TEXT.bonusTrajectory);
      out.body(bonus.trajectory);
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

    return serialise(doc, (who.name || 'Your') + '\u2019s personality analysis',
      'Personality analysis from an Instagram data export');
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
