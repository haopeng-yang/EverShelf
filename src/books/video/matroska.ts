// Reads the start of a Matroska (.mkv) or WebM file: the EBML header's
// DocType, and the Segment's Info (length, title) and Tracks (picture size,
// whether there is a video track). Muxers put these before the first
// Cluster, so a few KB from the start are enough; the frames are never read.

const EBML = 0x1a45dfa3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMESTAMP_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TITLE = 0x7ba9;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const CLUSTER = 0x1f43b675;

export interface MatroskaInfo {
  /** 'webm' or 'matroska' (or whatever the file says). */
  docType: string;
  durationMs: number | null;
  title: string;
  width: number | null;
  height: number | null;
  /** Whether the Tracks element was found at all, so hasVideo can be trusted. */
  sawTracks: boolean;
  hasVideo: boolean;
}

/** True if the bytes start with an EBML header, as every Matroska and WebM file does. */
export function isMatroska(head: Uint8Array): boolean {
  return head.length >= 4 && readId(head, 0)?.id === EBML;
}

interface Element {
  id: number;
  /** Where the contents start, and where they end (clamped to the bytes read). */
  start: number;
  end: number;
  /** False when the element runs past the bytes read. */
  complete: boolean;
}

/** An element ID: its first byte's leading zeros say how many bytes it has, and the marker bit stays in. */
function readId(bytes: Uint8Array, at: number): { id: number; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length > 4 || at + length > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + bytes[at + i];
  return { id, length };
}

/** An element size: like an ID, but the marker bit is dropped. All ones means "unknown" (null). */
function readSize(bytes: Uint8Array, at: number): { size: number | null; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (at + length > bytes.length) return null;
  let size = first & (0xff >> length);
  let allOnes = size === 0xff >> length;
  for (let i = 1; i < length; i++) {
    size = size * 256 + bytes[at + i];
    if (bytes[at + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : size, length };
}

function elementsIn(bytes: Uint8Array, from: number, to: number): Element[] {
  const elements: Element[] = [];
  let at = from;
  while (at < to) {
    const id = readId(bytes, at);
    const size = id && readSize(bytes, at + id.length);
    if (!id || !size) break;
    const start = at + id.length + size.length;
    const end = size.size === null ? to : start + size.size;
    elements.push({ id: id.id, start, end: Math.min(end, to), complete: end <= to });
    if (id.id === CLUSTER || end > to) break;
    at = end;
  }
  return elements;
}

function uint(bytes: Uint8Array, e: Element): number {
  let n = 0;
  for (let i = e.start; i < e.end; i++) n = n * 256 + bytes[i];
  return n;
}

function float(bytes: Uint8Array, e: Element): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset + e.start, e.end - e.start);
  if (e.end - e.start === 4) return view.getFloat32(0);
  if (e.end - e.start === 8) return view.getFloat64(0);
  return null;
}

function text(bytes: Uint8Array, e: Element): string {
  // Strings may be padded with zero bytes.
  return new TextDecoder().decode(bytes.subarray(e.start, e.end)).replace(/\0+$/, '').trim();
}

/** Reads what it can from the first bytes of a Matroska file. Null if it isn't one. */
export function parseMatroska(bytes: Uint8Array): MatroskaInfo | null {
  const top = elementsIn(bytes, 0, bytes.length);
  const header = top.find((e) => e.id === EBML);
  if (!header || top[0] !== header) return null;
  const docTypeElement = elementsIn(bytes, header.start, header.end).find((e) => e.id === DOC_TYPE);
  const info: MatroskaInfo = {
    docType: docTypeElement ? text(bytes, docTypeElement) : 'matroska',
    durationMs: null,
    title: '',
    width: null,
    height: null,
    sawTracks: false,
    hasVideo: false,
  };

  const segment = top.find((e) => e.id === SEGMENT);
  if (!segment) return info;
  for (const child of elementsIn(bytes, segment.start, segment.end)) {
    if (child.id === INFO) {
      let scale = 1_000_000;
      let duration: number | null = null;
      for (const e of elementsIn(bytes, child.start, child.end)) {
        if (!e.complete) continue;
        if (e.id === TIMESTAMP_SCALE) scale = uint(bytes, e) || scale;
        if (e.id === DURATION) duration = float(bytes, e);
        if (e.id === TITLE) info.title = text(bytes, e);
      }
      // Duration is in TimestampScale units, which are nanoseconds each.
      if (duration !== null && duration > 0) info.durationMs = Math.round((duration * scale) / 1_000_000);
    }
    if (child.id === TRACKS) {
      info.sawTracks = child.complete;
      for (const entry of elementsIn(bytes, child.start, child.end).filter((e) => e.id === TRACK_ENTRY)) {
        const fields = elementsIn(bytes, entry.start, entry.end);
        const type = fields.find((e) => e.id === TRACK_TYPE);
        if (!type || uint(bytes, type) !== 1) continue;
        info.hasVideo = true;
        const video = fields.find((e) => e.id === VIDEO);
        if (video && info.width === null) {
          for (const e of elementsIn(bytes, video.start, video.end)) {
            if (e.id === PIXEL_WIDTH) info.width = uint(bytes, e) || null;
            if (e.id === PIXEL_HEIGHT) info.height = uint(bytes, e) || null;
          }
        }
      }
    }
  }
  return info;
}
