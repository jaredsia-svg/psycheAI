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
    // Running head, so a printed page found on its own still says whose it is.
    this.doc.draw(toWinAnsi('PsycheAI'), MARGIN, MARGIN, { size: 8, bold: true, color: ACCENT, tracking: 1.1 });
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

  /** A small tracked-out label, the typographic workhorse of the whole thing. */
  Report.prototype.eyebrow = function (text, color) {
    this.need(16);
    this.doc.draw(toWinAnsi(String(text).toUpperCase()), MARGIN, this.doc.y + 8,
      { size: 7.5, bold: true, color: color || ACCENT_2, tracking: 1.2 });
    this.doc.y += 15;
    return this;
  };

  Report.prototype.sectionTitle = function (title, kicker) {
    // Keep a title with at least a couple of lines of what follows.
    this.need(96);
    this.space(6);
    if (kicker) this.eyebrow(kicker);
    const style = { size: 19, bold: true, color: INK };
    for (const line of wrap(toWinAnsi(title), COLUMN, style)) {
      this.doc.draw(line, MARGIN, this.doc.y + 15, style);
      this.doc.y += 24;
    }
    this.space(4);
    this.doc.hairline(this.doc.y, MARGIN, MARGIN + 46, ACCENT);
    this.doc.hairline(this.doc.y, MARGIN + 46, PAGE.width - MARGIN, LINE);
    this.space(16);
    return this;
  };

  Report.prototype.subheading = function (text, trailing) {
    this.need(34);
    this.space(4);
    const style = { size: 11.5, bold: true, color: INK };
    const encoded = toWinAnsi(text);
    for (const line of wrap(encoded, COLUMN - 90, style)) {
      this.doc.draw(line, MARGIN, this.doc.y + 9, style);
      this.doc.y += 15;
    }
    if (trailing) {
      const label = toWinAnsi(trailing);
      // Measured with the same tracking it is drawn with, or the right edge
      // creeps past the margin by a point per character.
      const width = measure(label, 8, true, 0.8);
      this.doc.draw(label, PAGE.width - MARGIN - width, this.doc.y - 6,
        { size: 8, bold: true, color: ACCENT, tracking: 0.8 });
    }
    this.space(3);
    return this;
  };

  Report.prototype.bullet = function (text, options) {
    const settings = options || {};
    const style = { size: 10, color: settings.color || INK };
    const indent = MARGIN + 14;
    const lines = wrap(toWinAnsi(text), COLUMN - 14, style);
    lines.forEach((line, index) => {
      this.need(15);
      if (!index) this.doc.rect(MARGIN + 3, this.doc.y + 5.5, 3.2, 3.2, ACCENT_2);
      this.doc.draw(line, indent, this.doc.y + 8.2, style);
      this.doc.y += 15;
    });
    return this;
  };

  /** Title-and-detail pair, used for every strengths/weaknesses style list. */
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

  /** A 0-100 bar. The Big Five section is mostly this. */
  Report.prototype.bar = function (label, score, band) {
    this.need(30);
    const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    this.doc.draw(toWinAnsi(label), MARGIN, this.doc.y + 8, { size: 10.5, bold: true, color: INK });
    const readout = toWinAnsi(value + (band ? '  ·  ' + band : ''));
    const width = measure(readout, 9, false);
    this.doc.draw(readout, PAGE.width - MARGIN - width, this.doc.y + 8, { size: 9, color: SOFT });
    const track = this.doc.y + 14;
    this.doc.roundRect(MARGIN, track, COLUMN, 5, 2.5, LINE);
    if (value > 0) this.doc.roundRect(MARGIN, track, Math.max(5, COLUMN * value / 100), 5, 2.5, ACCENT);
    this.doc.y += 26;
    return this;
  };

  /** Chips for short labels: interests, environments, love languages. */
  Report.prototype.chips = function (items) {
    const list = (items || []).map(item => toWinAnsi(item)).filter(Boolean);
    if (!list.length) return this;
    const size = 9.5;
    let x = MARGIN;
    this.need(24);
    for (let item of list) {
      // A chip is one line by construction, so an over-long label has to be
      // cut rather than allowed to run off the page.
      // The ellipsis is appended already-encoded: these strings are WinAnsi
      // bytes by this point, and a raw U+2026 would not survive serialisation.
      while (item.length > 4 && measure(item, size, false) + 18 > COLUMN) {
        item = item.slice(0, -2) + String.fromCharCode(133);
      }
      const width = measure(item, size, false) + 18;
      if (x > MARGIN && x + width > MARGIN + COLUMN) {
        this.doc.y += 22;
        this.need(24);
        x = MARGIN;
      }
      this.doc.roundRect(x, this.doc.y, width, 17, 8.5, WASH);
      this.doc.draw(item, x + 9, this.doc.y + 12, { size, color: ACCENT });
      x += width + 6;
    }
    this.doc.y += 26;
    return this;
  };

  /** A tinted box for caveats — the report makes a lot of honest hedges. */
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

  Report.prototype.evidence = function (items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return this;
    this.doc.draw(toWinAnsi('Evidence'), MARGIN + 10, this.doc.y + 8,
      { size: 7.5, bold: true, color: SOFT, tracking: 1.1 });
    this.doc.y += 13;
    for (const item of list) {
      this.body('— ' + item, { x: MARGIN + 10, width: COLUMN - 10, size: 9.2, color: SOFT, leading: 13 });
    }
    this.space(4);
    return this;
  };

  // ---------- the cover ----------

  function cover(doc, report, card, meta, sections) {
    doc.newPage({ bare: true, top: 0 });
    doc.rect(0, 0, PAGE.width, PAGE.height, PAPER);
    const bandHeight = 268;
    doc.rect(0, 0, PAGE.width, bandHeight, ACCENT);
    // A second, darker wedge so the band is not a flat slab of colour.
    doc.setFill(ACCENT_2);
    doc.op('0 ' + num(PAGE.height - bandHeight) + ' m ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight) + ' l ' +
      num(PAGE.width) + ' ' + num(PAGE.height - bandHeight + 46) + ' l 0 ' +
      num(PAGE.height - bandHeight) + ' l f');

    doc.draw(toWinAnsi('PSYCHEAI'), MARGIN, 68, { size: 10, bold: true, color: WHITE, tracking: 3 });

    const title = (card.name || 'Your') + '’s personality analysis';
    const titleStyle = { size: 31, bold: true, color: WHITE };
    let y = 116;
    for (const line of wrap(toWinAnsi(title), COLUMN - 30, titleStyle)) {
      doc.draw(line, MARGIN, y, titleStyle);
      y += 36;
    }

    if (card.headline) {
      const style = { size: 12.5, italic: true, color: WHITE };
      y += 6;
      for (const line of wrap(toWinAnsi(card.headline), COLUMN - 40, style)) {
        doc.draw(line, MARGIN, y, style);
        y += 17;
      }
    }

    // The essence noun is the thing they quote back at their friends, so it
    // gets the cover card rather than being buried in the body.
    const essence = report.essence || {};
    let cursor = bandHeight + 34;
    if (essence.noun) {
      const nounStyle = { size: 24, bold: true, color: ACCENT };
      const whyStyle = { size: 10.4, color: INK };
      const nounLines = wrap(toWinAnsi(essence.noun), COLUMN - 56, nounStyle);
      const whyLines = wrap(toWinAnsi(essence.why || ''), COLUMN - 56, whyStyle);
      const height = 28 + nounLines.length * 28 + whyLines.length * 15 + 22;
      doc.roundRect(MARGIN, cursor, COLUMN, height, 14, WHITE);
      doc.rect(MARGIN, cursor, COLUMN, 3, ACCENT);
      let inner = cursor + 26;
      doc.draw(toWinAnsi('IN A WORD'), MARGIN + 28, inner, { size: 7.5, bold: true, color: ACCENT_2, tracking: 1.2 });
      inner += 12;
      for (const line of nounLines) {
        doc.draw(line, MARGIN + 28, inner + 18, nounStyle);
        inner += 28;
      }
      inner += 6;
      for (const line of whyLines) {
        doc.draw(line, MARGIN + 28, inner + 8, whyStyle);
        inner += 15;
      }
      cursor += height + 26;
    }

    // Confidence, on the cover, because it frames everything after it.
    const confidence = report.confidence || {};
    const score = Math.max(0, Math.min(100, Math.round(Number(confidence.score) || 0)));
    doc.draw(toWinAnsi('CONFIDENCE IN THIS READING'), MARGIN, cursor + 8,
      { size: 7.5, bold: true, color: SOFT, tracking: 1.2 });
    const readout = toWinAnsi(score + ' / 100' + (confidence.level ? '  ·  ' + confidence.level : ''));
    const readoutWidth = measure(readout, 10, true);
    doc.draw(readout, PAGE.width - MARGIN - readoutWidth, cursor + 8, { size: 10, bold: true, color: ACCENT });
    cursor += 16;
    doc.roundRect(MARGIN, cursor, COLUMN, 6, 3, LINE);
    if (score > 0) doc.roundRect(MARGIN, cursor, Math.max(6, COLUMN * score / 100), 6, 3, ACCENT);
    cursor += 20;
    if (confidence.rationale) {
      const style = { size: 9.6, color: SOFT };
      for (const line of wrap(toWinAnsi(confidence.rationale), COLUMN, style)) {
        doc.draw(line, MARGIN, cursor + 8, style);
        cursor += 13.5;
      }
    }

    // Footer block: provenance, then the disclaimer that has to travel with it.
    const footTop = PAGE.height - MARGIN - 74;

    // Contents, if the cover has room for it. Short mock profiles leave a hole
    // in the middle of the page otherwise, and a report this long benefits from
    // saying up front what is in it.
    const roomLeft = footTop - cursor - 34;
    if (sections.length && roomLeft > 116) {
      cursor += 26;
      doc.hairline(cursor, MARGIN, MARGIN + 46, ACCENT);
      cursor += 16;
      doc.draw(toWinAnsi('WHAT IS INSIDE'), MARGIN, cursor + 8,
        { size: 7.5, bold: true, color: SOFT, tracking: 1.2 });
      cursor += 20;
      const half = Math.ceil(sections.length / 2);
      sections.forEach((name, index) => {
        const column = index < half ? 0 : 1;
        const row = index - column * half;
        const x = MARGIN + column * (COLUMN / 2);
        const y = cursor + row * 15;
        doc.draw(toWinAnsi(String(index + 1)), x, y + 8, { size: 8.5, bold: true, color: ACCENT_2 });
        doc.draw(toWinAnsi(name), x + 16, y + 8, { size: 9.6, color: INK });
      });
      cursor += half * 15;
    }
    doc.hairline(footTop, MARGIN, PAGE.width - MARGIN);
    const stamp = [meta.date, meta.model ? 'model ' + meta.model : ''].filter(Boolean).join('  ·  ');
    doc.draw(toWinAnsi(stamp), MARGIN, footTop + 16, { size: 8.5, color: SOFT });
    const disclaimer = 'PsycheAI is a self-knowledge and conversation tool, not a psychometric ' +
      'instrument and not a background check. Everything here is inferred from one Instagram data ' +
      'export by a language model, which says how confident it is and can be wrong.';
    let footY = footTop + 30;
    for (const line of wrap(toWinAnsi(disclaimer), COLUMN, { size: 8.2 })) {
      doc.draw(line, MARGIN, footY + 7, { size: 8.2, color: SOFT });
      footY += 11;
    }
  }

  // ---------- the body ----------

  const TRAITS = [
    ['openness', 'Openness'],
    ['conscientiousness', 'Conscientiousness'],
    ['extraversion', 'Extraversion'],
    ['agreeableness', 'Agreeableness'],
    ['neuroticism', 'Neuroticism'],
  ];

  const ACTIVITY_PARTS = [
    ['posting', 'What they post'],
    ['rhythm', 'When they post'],
    ['trajectory', 'How it changed'],
    ['engagement', 'Outward or inward'],
    ['attention', 'Where attention goes'],
  ];

  function build(report, card, meta) {
    const doc = new Doc();
    const out = new Report(doc, { name: card.name || 'Your profile' });

    // Worked out before the cover is drawn, because the cover lists them.
    const has = value => Boolean(value && (!Array.isArray(value) || value.length));
    const sections = [
      ['The portrait', has(report.summary)],
      ['The five traits', has(report.bigFive)],
      ['The type', has(report.mbti)],
      ['How they use Instagram', has(report.activity)],
      ['What holds their attention', has(report.interests)],
      ['What they care about', has(report.values)],
      ['What they seem to believe', has(report.beliefs)],
      ['Close relationships', has(report.relationship)],
      ['Work', has(report.career)],
    ].filter(entry => entry[1]).map(entry => entry[0]);

    cover(doc, report, card, meta, sections);

    // ---- the portrait ----
    out.page();
    out.sectionTitle('The portrait', 'Overview');
    out.body(report.summary, { size: 10.8, leading: 16.5 });

    // ---- big five ----
    const five = report.bigFive || {};
    out.space(12);
    out.sectionTitle('The five traits', 'Big Five');
    for (const [key, label] of TRAITS) {
      const trait = five[key];
      if (!trait) continue;
      out.need(80);
      out.bar(label, trait.score, trait.band);
      if (trait.reading) out.body(trait.reading, { size: 9.9, color: INK, leading: 14.4 });
      out.evidence(trait.evidence);
      out.space(6);
    }

    // ---- mbti ----
    const mbti = report.mbti;
    if (mbti) {
      out.space(10);
      out.sectionTitle('The type', 'MBTI');
      out.need(60);
      const type = toWinAnsi(mbti.type || 'Uncertain');
      doc.roundRect(MARGIN, doc.y, 96, 42, 10, ACCENT);
      const typeWidth = measure(type, 21, true);
      doc.draw(type, MARGIN + (96 - typeWidth) / 2, doc.y + 29, { size: 21, bold: true, color: WHITE });
      if (mbti.nickname) {
        doc.draw(toWinAnsi(mbti.nickname), MARGIN + 112, doc.y + 20, { size: 13, bold: true, color: INK });
      }
      if (mbti.confidence) {
        doc.draw(toWinAnsi(mbti.confidence + ' confidence'), MARGIN + 112, doc.y + 36,
          { size: 9, color: SOFT });
      }
      doc.y += 56;
      for (const letter of mbti.letters || []) {
        out.subheading((letter.axis || '') + ':  ' + (letter.choice || ''), letter.strength);
        if (letter.why) out.body(letter.why, { size: 9.9, leading: 14.4 });
        if (letter.inPractice) out.body('In practice: ' + letter.inPractice, { size: 9.5, color: SOFT, leading: 13.5 });
        out.space(5);
      }
      if (mbti.caveat) out.note(mbti.caveat, 'Take with salt');
    }

    // ---- activity ----
    const activity = report.activity;
    if (activity) {
      out.space(10);
      out.sectionTitle('How they use Instagram', 'Behaviour');
      if (activity.summary) out.body(activity.summary, { size: 10.4, leading: 15.6 });
      out.space(8);
      for (const [key, label] of ACTIVITY_PARTS) {
        const part = activity[key];
        if (!part) continue;
        out.subheading(part.headline || label, label);
        if (part.detail) out.body(part.detail, { size: 9.9, leading: 14.4 });
        out.space(5);
      }
      const implications = activity.implications || [];
      if (implications.length) {
        out.space(6);
        out.eyebrow('What it suggests');
        for (const item of implications) {
          out.point(item.observation, item.implication);
        }
      }
      if (activity.blindSpots) out.note(activity.blindSpots, 'What this cannot see');
    }

    // ---- interests ----
    const interests = report.interests || [];
    if (interests.length) {
      out.space(10);
      out.sectionTitle('What holds their attention', 'Interests');
      out.chips(interests.map(item => item.name));
      for (const item of interests) {
        out.subheading(item.name, item.intensity);
        if (item.detail) out.body(item.detail, { size: 9.9, leading: 14.4 });
        if (item.evidence) out.evidence([item.evidence]);
        out.space(4);
      }
    }

    // ---- values ----
    const values = report.values || [];
    if (values.length) {
      out.space(10);
      out.sectionTitle('What they care about', 'Values');
      for (const item of values) {
        out.subheading(item.value);
        if (item.detail) out.body(item.detail, { size: 9.9, leading: 14.4 });
        if (item.evidence) out.evidence([item.evidence]);
        out.space(4);
      }
    }

    // ---- beliefs ----
    const beliefs = report.beliefs || [];
    if (beliefs.length) {
      out.space(10);
      out.sectionTitle('What they seem to believe', 'Beliefs');
      for (const item of beliefs) {
        out.subheading(item.belief, item.confidence ? item.confidence + ' confidence' : '');
        if (item.detail) out.body(item.detail, { size: 9.9, leading: 14.4 });
        if (item.evidence) out.evidence([item.evidence]);
        out.space(4);
      }
    }

    // ---- relationship ----
    const relationship = report.relationship;
    if (relationship) {
      out.space(10);
      out.sectionTitle('Close relationships', 'Relationship');
      const strengths = relationship.strengths || [];
      if (strengths.length) {
        out.eyebrow('Strengths');
        for (const item of strengths) out.point(item.title, item.detail);
        out.space(6);
      }
      const weaknesses = relationship.weaknesses || [];
      if (weaknesses.length) {
        out.eyebrow('Where it gets harder');
        for (const item of weaknesses) out.point(item.title, item.detail);
        out.space(6);
      }

      const attachment = relationship.attachment;
      if (attachment) {
        out.subheading('Attachment: ' + (attachment.style || 'unclear'));
        if (attachment.why) out.body(attachment.why, { size: 9.9, leading: 14.4 });
        if ((attachment.derivedFrom || []).length) out.evidence(attachment.derivedFrom);
        for (const item of attachment.implications || []) out.point(item.title, item.detail);
        if (attachment.caveat) out.note(attachment.caveat, 'Take with salt');
      }

      const love = relationship.loveLanguages;
      if (love) {
        out.space(8);
        out.subheading('Love languages');
        for (const [key, label] of [['receiving', 'Wants to receive'], ['giving', 'Tends to give']]) {
          const list = love[key] || [];
          if (!list.length) continue;
          out.eyebrow(label);
          // No chip row here: every language is spelled out immediately below,
          // so chips would just say the same words twice.
          for (const item of list) {
            out.point(item.language + (item.strength ? '  ·  ' + item.strength : ''), item.why);
            if (item.inPractice) out.body('In practice: ' + item.inPractice,
              { x: MARGIN + 10, width: COLUMN - 10, size: 9.5, color: SOFT, leading: 13.5 });
            out.space(4);
          }
        }
        if (love.caveat) out.note(love.caveat, 'Take with salt');
      }
    }

    // ---- career ----
    const career = report.career;
    if (career) {
      out.space(10);
      out.sectionTitle('Work', 'Career');
      if (career.workStyle) out.body(career.workStyle, { size: 10.4, leading: 15.6 });
      out.space(8);
      const strengths = career.strengths || [];
      if (strengths.length) {
        out.eyebrow('Strengths');
        for (const item of strengths) out.point(item.title, item.detail);
        out.space(6);
      }
      const weaknesses = career.weaknesses || [];
      if (weaknesses.length) {
        out.eyebrow('Watch for');
        for (const item of weaknesses) out.point(item.title, item.detail);
        out.space(6);
      }
      if ((career.environments || []).length) {
        out.eyebrow('Where they would do well');
        out.chips(career.environments);
      }
      if (career.watchOuts) out.note(career.watchOuts, 'What could hold them back');
    }

    // ---- closing ----
    out.space(14);
    out.need(120);
    out.sectionTitle('How to hold this', 'Small print');
    out.body('This report is one language model’s reading of one Instagram data export. It is a ' +
      'starting point for thinking and talking about yourself, not a measurement. Where it says it ' +
      'is uncertain, it means it. Where it is wrong, the interesting question is usually which part ' +
      'of the data misled it.', { size: 10, leading: 15 });
    out.space(6);
    out.body('Nothing here was uploaded anywhere permanent. Your export was read in your browser, ' +
      'and the profile lives in this device’s local storage until you delete it.',
      { size: 10, leading: 15 });

    return serialise(doc, meta, card);
  }

  // ---------- serialisation ----------

  function serialise(doc, meta, card) {
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

    const title = (card.name || 'Your') + '’s personality analysis';
    const info = add('<< /Title (' + toWinAnsi(title).replace(/([\\()])/g, '\\$1') +
      ') /Author (PsycheAI) /Creator (PsycheAI) /Subject (Personality analysis from an Instagram data export) >>');

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

  root.PsychePDF = { build, toWinAnsi, measure };
})(typeof window !== 'undefined' ? window : globalThis);
