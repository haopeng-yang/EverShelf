import { strFromU8, unzipSync } from 'fflate';

import type { ParsedChapter } from './parseTxt';

// Reads an .epub file into a title, author, description, cover and chapters.
// An EPUB is a zip holding XHTML pages, an OPF file (metadata, the list of
// files, and the "spine": the reading order) and a table of contents. Pure
// functions, so they can be tested without a phone.
//
// Formatting is not kept: each chapter becomes plain paragraphs, one per line,
// the same as a .txt import.

export interface ParsedEpub {
  title: string;
  author: string;
  description: string;
  chapters: ParsedChapter[];
  cover: { bytes: Uint8Array; extension: string } | null;
}

export type EpubErrorCode = 'notEpub' | 'drm' | 'noText';

export class EpubError extends Error {
  constructor(readonly code: EpubErrorCode) {
    super(`EPUB error: ${code}`);
  }
}

const TEXT_FILE = /\.(?:xml|opf|ncx|xhtml|html|htm)$/i;
/** Encryption that only hides embedded fonts; the text is still readable. */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string;
}

export function parseEpub(bytes: Uint8Array): ParsedEpub {
  // Unzip only the text files at first; images and fonts can be large.
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => TEXT_FILE.test(file.name) });
  } catch {
    throw new EpubError('notEpub');
  }
  const read = (path: string): string | null => (files[path] ? strFromU8(files[path]) : null);

  const container = read('META-INF/container.xml');
  const opfPath = container && attributes(findTag(container, 'rootfile') ?? '')['full-path'];
  const opf = opfPath ? read(opfPath) : null;
  if (!opfPath || !opf) throw new EpubError('notEpub');
  if (isDrmProtected(read('META-INF/encryption.xml'))) throw new EpubError('drm');

  const opfDir = directoryOf(opfPath);
  const manifest = new Map<string, ManifestItem>();
  for (const tag of findTags(opf, 'item')) {
    const a = attributes(tag);
    if (!a.id || !a.href) continue;
    manifest.set(a.id, {
      id: a.id,
      path: resolvePath(opfDir, a.href),
      mediaType: a['media-type'] ?? '',
      properties: a.properties ?? '',
    });
  }

  const titles = tableOfContents(opf, manifest, read);
  const chapters: ParsedChapter[] = [];
  for (const tag of findTags(opf, 'itemref')) {
    const a = attributes(tag);
    const item = a.idref ? manifest.get(a.idref) : undefined;
    if (!item || a.linear === 'no' || !/html/i.test(item.mediaType)) continue;
    const html = read(item.path);
    if (!html) continue;
    const paragraphs = htmlToParagraphs(html);
    const title = titles.get(item.path) ?? '';
    // Many books split a long chapter over several files; only the first is in
    // the table of contents, so the rest are joined onto it.
    if (!title && titles.size > 0 && chapters.length > 0) {
      const previous = chapters[chapters.length - 1];
      previous.text = [previous.text, ...paragraphs].filter(Boolean).join('\n');
      continue;
    }
    const heading = title || firstHeading(html);
    // The page usually repeats its heading as the first line; don't show it twice.
    if (heading && paragraphs[0] === heading) paragraphs.shift();
    if (paragraphs.length === 0 && !title) continue; // e.g. a cover page with only an image
    chapters.push({ title: heading, text: paragraphs.join('\n') });
  }
  if (chapters.every((c) => c.text === '')) throw new EpubError('noText');

  return {
    title: metadataText(opf, 'title'),
    author: metadataTexts(opf, 'creator').join(', '),
    description: htmlToParagraphs(decodeEntities(metadataText(opf, 'description', false))).join('\n'),
    chapters,
    cover: readCover(bytes, opf, manifest),
  };
}

/** Chapter titles from the EPUB 3 nav page or the EPUB 2 toc.ncx, by file path. */
function tableOfContents(
  opf: string,
  manifest: Map<string, ManifestItem>,
  read: (path: string) => string | null,
): Map<string, string> {
  const titles = new Map<string, string>();
  const add = (baseDir: string, href: string, title: string) => {
    const path = resolvePath(baseDir, href);
    if (title && !titles.has(path)) titles.set(path, title);
  };

  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'));
  const navHtml = nav && read(nav.path);
  const tocNav = navHtml && /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(navHtml);
  if (nav && tocNav) {
    for (const link of tocNav[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attributes(`<a ${link[1]}>`).href;
      if (href) add(directoryOf(nav.path), href, cleanText(link[2]));
    }
    if (titles.size > 0) return titles;
  }

  const spine = findTag(opf, 'spine');
  const ncxId = spine ? attributes(spine).toc : undefined;
  const ncx =
    (ncxId && manifest.get(ncxId)) ||
    [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
  const ncxXml = ncx && read(ncx.path);
  if (ncx && ncxXml) {
    const points = /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\b([^>]*)>/gi;
    for (const point of ncxXml.matchAll(points)) {
      const src = attributes(`<content ${point[2]}>`).src;
      if (src) add(directoryOf(ncx.path), src, cleanText(point[1]));
    }
  }
  return titles;
}

function readCover(bytes: Uint8Array, opf: string, manifest: Map<string, ManifestItem>): ParsedEpub['cover'] {
  const items = [...manifest.values()];
  // EPUB 3 marks the cover in the manifest; EPUB 2 uses <meta name="cover" content="id">.
  const coverMeta = findTags(opf, 'meta').find((tag) => attributes(tag).name === 'cover');
  const cover =
    items.find((item) => item.properties.split(/\s+/).includes('cover-image')) ??
    (coverMeta ? manifest.get(attributes(coverMeta).content ?? '') : undefined);
  if (!cover || !cover.mediaType.startsWith('image/')) return null;
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[
    cover.mediaType
  ];
  if (!extension) return null;
  try {
    const file = unzipSync(bytes, { filter: (f) => f.name === cover.path })[cover.path];
    return file ? { bytes: file, extension } : null;
  } catch {
    return null;
  }
}

function isDrmProtected(encryptionXml: string | null): boolean {
  if (!encryptionXml) return false;
  return findTags(encryptionXml, 'EncryptionMethod').some((tag) => {
    const algorithm = attributes(tag).Algorithm ?? '';
    return !FONT_OBFUSCATION.includes(algorithm);
  });
}

/**
 * Turns an XHTML page into plain paragraphs: block elements and <br> become
 * line breaks, every other tag is dropped, and entities are decoded.
 */
export function htmlToParagraphs(html: string): string[] {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/?(?:p|div|h[1-6]|li|blockquote|tr|section|article|header|footer|pre|hr|dd|dt|figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line !== '');
}

function firstHeading(html: string): string {
  const match = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
  return match ? cleanText(match[1]) : '';
}

/** Text inside a tag, with nested tags removed, entities decoded and spaces collapsed. */
function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Contents of every <dc:name> metadata element (dc: prefix optional). */
function metadataTexts(opf: string, name: string, clean = true): string[] {
  const pattern = new RegExp(String.raw`<(?:dc:)?${name}\b[^>]*>([\s\S]*?)</(?:dc:)?${name}>`, 'gi');
  return [...opf.matchAll(pattern)].map((m) => (clean ? cleanText(m[1]) : m[1])).filter(Boolean);
}

function metadataText(opf: string, name: string, clean = true): string {
  return metadataTexts(opf, name, clean)[0] ?? '';
}

/** Opening tags named `name`, with or without a namespace prefix (e.g. <opf:item>). */
function findTags(xml: string, name: string): string[] {
  const local = name.includes(':') ? name : String.raw`(?:\w+:)?${name}`;
  return xml.match(new RegExp(String.raw`<${local}\b[^>]*>`, 'gi')) ?? [];
}

function findTag(xml: string, name: string): string | undefined {
  return findTags(xml, name)[0];
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return result;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
}

/** Resolves an href inside the zip, relative to baseDir, dropping any #fragment. */
export function resolvePath(baseDir: string, href: string): string {
  let decoded = href.split('#')[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep it as written.
  }
  const parts: string[] = [];
  for (const part of (baseDir + decoded).split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}
