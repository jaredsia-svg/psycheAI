// Streaming-ish ZIP reader for Instagram data exports.
//
// Instagram exports are large (often >1 GB with media) but the parts we care
// about are the JSON files, which are a tiny fraction of that. So instead of
// inflating the whole archive we read the central directory, pick out the
// entries we want by name, and inflate only those — using the browser's native
// DecompressionStream so no compression library needs to be shipped.
(function (root) {
  'use strict';

  const SIG_EOCD = 0x06054b50;
  const SIG_EOCD64 = 0x06064b50;
  const SIG_EOCD64_LOC = 0x07064b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;

  const utf8 = new TextDecoder('utf-8');

  class ZipError extends Error {}

  // A Blob-backed random-access reader. Slices are read lazily so we never
  // hold the whole archive in memory.
  class BlobSource {
    constructor(blob) {
      this.blob = blob;
      this.size = blob.size;
    }
    async read(start, end) {
      const from = Math.max(0, start);
      const to = Math.min(this.size, end);
      if (to <= from) return new Uint8Array(0);
      const buf = await this.blob.slice(from, to).arrayBuffer();
      return new Uint8Array(buf);
    }
  }

  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  // 64-bit little-endian read. ZIP64 sizes are well below 2^53 in practice,
  // so returning a Number is safe and keeps the arithmetic simple.
  function readU64(dv, off) {
    const lo = dv.getUint32(off, true);
    const hi = dv.getUint32(off + 4, true);
    return hi * 0x100000000 + lo;
  }

  function findSignatureBackwards(bytes, sig) {
    const dv = view(bytes);
    for (let i = bytes.length - 4; i >= 0; i--) {
      if (dv.getUint32(i, true) === sig) return i;
    }
    return -1;
  }

  async function locateCentralDirectory(source) {
    // The end-of-central-directory record sits in the last 22 bytes plus an
    // optional comment of up to 64 KiB.
    const tailLen = Math.min(source.size, 0x10000 + 22);
    const tail = await source.read(source.size - tailLen, source.size);
    const eocdPos = findSignatureBackwards(tail, SIG_EOCD);
    if (eocdPos < 0) throw new ZipError('Not a ZIP file (no end-of-central-directory record).');

    const dv = view(tail);
    let entries = dv.getUint16(eocdPos + 10, true);
    let cdSize = dv.getUint32(eocdPos + 12, true);
    let cdOffset = dv.getUint32(eocdPos + 16, true);

    const needsZip64 = entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
    if (needsZip64) {
      const locPos = findSignatureBackwards(tail.subarray(0, eocdPos), SIG_EOCD64_LOC);
      if (locPos < 0) throw new ZipError('ZIP64 archive is missing its locator record.');
      const zip64Offset = readU64(dv, locPos + 8);
      const rec = await source.read(zip64Offset, zip64Offset + 56);
      const rdv = view(rec);
      if (rdv.getUint32(0, true) !== SIG_EOCD64) throw new ZipError('Bad ZIP64 end-of-central-directory record.');
      entries = readU64(rdv, 32);
      cdSize = readU64(rdv, 40);
      cdOffset = readU64(rdv, 48);
    }
    return { entries, cdSize, cdOffset };
  }

  // ZIP64 stores oversized values in an extra field rather than the fixed
  // header slots, which are left as 0xffffffff sentinels.
  function applyZip64Extra(entry, extra) {
    const dv = view(extra);
    let off = 0;
    while (off + 4 <= extra.length) {
      const id = dv.getUint16(off, true);
      const len = dv.getUint16(off + 2, true);
      if (id === 0x0001) {
        let p = off + 4;
        if (entry.uncompressedSize === 0xffffffff && p + 8 <= off + 4 + len) { entry.uncompressedSize = readU64(dv, p); p += 8; }
        if (entry.compressedSize === 0xffffffff && p + 8 <= off + 4 + len) { entry.compressedSize = readU64(dv, p); p += 8; }
        if (entry.headerOffset === 0xffffffff && p + 8 <= off + 4 + len) { entry.headerOffset = readU64(dv, p); p += 8; }
        break;
      }
      off += 4 + len;
    }
  }

  async function readCentralDirectory(source) {
    const { cdSize, cdOffset } = await locateCentralDirectory(source);
    const cd = await source.read(cdOffset, cdOffset + cdSize);
    const dv = view(cd);
    const entries = [];
    let off = 0;
    while (off + 46 <= cd.length && dv.getUint32(off, true) === SIG_CENTRAL) {
      const flags = dv.getUint16(off + 8, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const nameBytes = cd.subarray(off + 46, off + 46 + nameLen);
      const entry = {
        // Bit 11 promises UTF-8; in practice Instagram writes UTF-8 either
        // way, and UTF-8 decoding is harmless for pure-ASCII names.
        name: utf8.decode(nameBytes),
        method: dv.getUint16(off + 10, true),
        compressedSize: dv.getUint32(off + 20, true),
        uncompressedSize: dv.getUint32(off + 24, true),
        headerOffset: dv.getUint32(off + 42, true),
        utf8Name: (flags & 0x800) !== 0,
      };
      if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff || entry.headerOffset === 0xffffffff) {
        applyZip64Extra(entry, cd.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen));
      }
      if (!entry.name.endsWith('/')) entries.push(entry);
      off += 46 + nameLen + extraLen + commentLen;
    }
    if (!entries.length) throw new ZipError('The ZIP file appears to be empty.');
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof root.DecompressionStream !== 'function') {
      throw new ZipError('This browser cannot decompress ZIP files. Try Chrome, Edge, Safari 16.4+ or Firefox 113+.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // Reads one entry's bytes. The central directory records where the local
  // header starts, but the payload sits after a variable-length name+extra
  // block that only the local header knows the size of.
  async function readEntry(source, entry) {
    const head = await source.read(entry.headerOffset, entry.headerOffset + 30);
    const hdv = view(head);
    if (head.length < 30 || hdv.getUint32(0, true) !== SIG_LOCAL) {
      throw new ZipError('Corrupt ZIP entry: ' + entry.name);
    }
    const dataStart = entry.headerOffset + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
    const raw = await source.read(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRaw(raw);
    throw new ZipError('Unsupported compression method ' + entry.method + ' in ' + entry.name);
  }

  /**
   * Opens an archive and returns a handle for reading selected entries.
   * @param {Blob|File} blob
   */
  async function open(blob) {
    const source = new BlobSource(blob);
    const entries = await readCentralDirectory(source);
    return {
      entries,
      /** Entries whose path matches a predicate. */
      filter(fn) { return entries.filter(fn); },
      /** Raw bytes of one entry. */
      bytes(entry) { return readEntry(source, entry); },
      /** Text of one entry, decoded as UTF-8. */
      async text(entry) { return utf8.decode(await readEntry(source, entry)); },
      /** Parsed JSON of one entry, or null when it does not parse. */
      async json(entry) {
        try {
          return JSON.parse(utf8.decode(await readEntry(source, entry)));
        } catch (e) {
          return null;
        }
      },
    };
  }

  root.KindredZip = { open, ZipError };
})(typeof window !== 'undefined' ? window : globalThis);
