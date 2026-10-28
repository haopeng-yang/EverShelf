import { strToU8, zipSync } from 'fflate';

import { EpubError, htmlToParagraphs, parseEpub, resolvePath } from '../src/books/parseEpub';

// Builds small EPUBs in memory with made-up text, so no real book files are needed.

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function page(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p { color: red }</style></head>
<body>${body}</body></html>`;
}

interface BuildOptions {
  manifest: string;
  spine: string;
  files: Record<string, string | Uint8Array>;
  metadata?: string;
  spineToc?: string;
  extra?: Record<string, string>;
}

function buildEpub({ manifest, spine, files, metadata, spineToc, extra }: BuildOptions): Uint8Array {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${metadata ?? '<dc:title>The Glass Harbour</dc:title><dc:creator>Mira Holt</dc:creator>'}
  </metadata>
  <manifest>${manifest}</manifest>
  <spine${spineToc ? ` toc="${spineToc}"` : ''}>${spine}</spine>
</package>`;
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(opf),
  };
  for (const [path, content] of Object.entries({ ...files, ...extra })) {
    entries[path] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(entries);
}

const NAV = page(`<nav epub:type="toc"><ol>
  <li><a href="text/ch1.xhtml">Chapter One: Arrival</a></li>
  <li><a href="text/ch2.xhtml#start">Chapter Two</a></li>
</ol></nav>`);

describe('parseEpub', () => {
  it('reads metadata, the cover and chapters in spine order with nav titles', () => {
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const book = parseEpub(
      buildEpub({
        metadata: `<dc:title>The Glass Harbour</dc:title><dc:creator>Mira Holt</dc:creator><dc:creator>Ade Park</dc:creator>
          <dc:description>&lt;p&gt;A quiet story &amp;amp; a storm.&lt;/p&gt;</dc:description>`,
        manifest: `
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
          <item id="coverpage" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
          <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c1b" href="text/ch1_split.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>`,
        spine: `<itemref idref="coverpage"/><itemref idref="c1"/><itemref idref="c1b"/><itemref idref="c2"/>`,
        files: {
          'OEBPS/nav.xhtml': NAV,
          'OEBPS/images/cover.jpg': coverBytes,
          'OEBPS/text/cover.xhtml': page('<img src="../images/cover.jpg"/>'),
          'OEBPS/text/ch1.xhtml': page('<h1>Chapter One: Arrival</h1><p>The ferry was\n late.</p><p>Gulls&nbsp;circled.</p>'),
          'OEBPS/text/ch1_split.xhtml': page('<p>Night came.</p>'),
          'OEBPS/text/ch2.xhtml': page('<h2 id="start">Chapter Two</h2><p>Morning.<br/>Rain.</p>'),
        },
      }),
    );
    expect(book.title).toBe('The Glass Harbour');
    expect(book.author).toBe('Mira Holt, Ade Park');
    expect(book.description).toBe('A quiet story & a storm.');
    expect(book.cover).toEqual({ bytes: coverBytes, extension: 'jpg' });
    expect(book.chapters).toEqual([
      { title: 'Chapter One: Arrival', text: 'The ferry was late.\nGulls circled.\nNight came.' },
      { title: 'Chapter Two', text: 'Morning.\nRain.' },
    ]);
  });

  it('uses an EPUB 2 toc.ncx and an EPUB 2 cover meta', () => {
    const book = parseEpub(
      buildEpub({
        metadata: '<dc:title>Small Hours</dc:title><meta name="cover" content="img"/>',
        spineToc: 'ncx',
        manifest: `
          <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
          <item id="img" href="cover.png" media-type="image/png"/>
          <item id="a" href="a.html" media-type="application/xhtml+xml"/>
          <item id="b" href="b%20two.html" media-type="application/xhtml+xml"/>`,
        spine: '<itemref idref="a"/><itemref idref="b"/>',
        files: {
          'OEBPS/toc.ncx': `<ncx><navMap>
            <navPoint id="p1"><navLabel><text>第一章 出发</text></navLabel><content src="a.html"/></navPoint>
            <navPoint id="p2"><navLabel><text>第二章</text></navLabel><content src="b%20two.html"/></navPoint>
          </navMap></ncx>`,
          'OEBPS/cover.png': new Uint8Array([0x89, 0x50]),
          'OEBPS/a.html': page('<p>他们出发了。</p>'),
          'OEBPS/b two.html': page('<p>他们到了。</p>'),
        },
      }),
    );
    expect(book.title).toBe('Small Hours');
    expect(book.author).toBe('');
    expect(book.cover?.extension).toBe('png');
    expect(book.chapters).toEqual([
      { title: '第一章 出发', text: '他们出发了。' },
      { title: '第二章', text: '他们到了。' },
    ]);
  });

  it('falls back to page headings when there is no table of contents', () => {
    const book = parseEpub(
      buildEpub({
        manifest: `<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
          <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
          <item id="skip" href="ad.xhtml" media-type="application/xhtml+xml"/>`,
        spine: '<itemref idref="a"/><itemref idref="skip" linear="no"/><itemref idref="b"/>',
        files: {
          'OEBPS/a.xhtml': page('<h1>Before</h1><p>One.</p>'),
          'OEBPS/b.xhtml': page('<p>Two.</p>'),
          'OEBPS/ad.xhtml': page('<p>Not in the reading order.</p>'),
        },
      }),
    );
    expect(book.chapters).toEqual([
      { title: 'Before', text: 'One.' },
      { title: '', text: 'Two.' },
    ]);
  });

  it('rejects files that are not EPUBs, are DRM-protected, or have no text', () => {
    const code = (bytes: Uint8Array) => {
      try {
        parseEpub(bytes);
        return 'ok';
      } catch (error) {
        return error instanceof EpubError ? error.code : String(error);
      }
    };
    expect(code(strToU8('just some text'))).toBe('notEpub');
    expect(code(zipSync({ 'a.txt': strToU8('hi') }))).toBe('notEpub');

    const simple = {
      manifest: '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="a"/>',
      files: { 'OEBPS/a.xhtml': page('<p>Text.</p>') },
    };
    const encryption = (algorithm: string) => ({
      'META-INF/encryption.xml': `<encryption><EncryptedData><EncryptionMethod Algorithm="${algorithm}"/></EncryptedData></encryption>`,
    });
    expect(code(buildEpub({ ...simple, extra: encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc') }))).toBe('drm');
    expect(code(buildEpub({ ...simple, extra: encryption('http://www.idpf.org/2008/embedding') }))).toBe('ok');
    expect(code(buildEpub({ ...simple, files: { 'OEBPS/a.xhtml': page('<img src="x.png"/>') } }))).toBe('noText');
  });
});

describe('htmlToParagraphs', () => {
  it('turns blocks into paragraphs and decodes entities', () => {
    expect(
      htmlToParagraphs(
        '<body><div><p>A &amp; B &#8212; &#x4F60;</p><script>x()</script><!-- note --><p>  </p><blockquote>Quote</blockquote></div></body>',
      ),
    ).toEqual(['A & B — 你', 'Quote']);
  });
});

describe('resolvePath', () => {
  it('resolves relative links inside the zip', () => {
    expect(resolvePath('OEBPS/text/', '../images/a%20b.jpg#x')).toBe('OEBPS/images/a b.jpg');
    expect(resolvePath('', './ch1.xhtml')).toBe('ch1.xhtml');
  });
});
