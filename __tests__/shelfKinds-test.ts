import { canHold, fileKindOfBook, inferShelfKind, isShelfKind } from '../src/models/shelfKinds';

describe('canHold', () => {
  it('only lets files onto a shelf of the same kind', () => {
    expect(canHold('novel', 'novel')).toBe(true);
    expect(canHold('novel', 'comic')).toBe(false);
    expect(canHold('comic', 'music')).toBe(false);
    expect(canHold('music', 'music')).toBe(true);
    expect(canHold('collection', 'novel')).toBe(false);
  });

  it('lets manual entries onto every shelf', () => {
    for (const kind of ['collection', 'novel', 'comic', 'music'] as const) expect(canHold(kind, null)).toBe(true);
  });
});

describe('inferShelfKind', () => {
  it('knows empty built-in shelves by their id', () => {
    expect(inferShelfKind('books', [])).toBe('novel');
    expect(inferShelfKind('manga', [])).toBe('comic');
    expect(inferShelfKind('movies', [])).toBe('collection');
    expect(inferShelfKind('anime', [])).toBe('collection');
  });

  it('makes an empty shelf of the user’s own a collection', () => {
    expect(inferShelfKind('a1b2c3', [])).toBe('collection');
  });

  it('picks the kind most files on the shelf have', () => {
    expect(inferShelfKind('a1b2c3', ['comic'])).toBe('comic');
    expect(inferShelfKind('a1b2c3', ['novel', 'comic', 'comic'])).toBe('comic');
    expect(inferShelfKind('movies', ['novel'])).toBe('novel');
    expect(inferShelfKind('manga', ['novel', 'novel', 'comic'])).toBe('novel');
  });

  it('breaks a tie with the built-in kind, or else novels first', () => {
    expect(inferShelfKind('manga', ['novel', 'comic'])).toBe('comic');
    expect(inferShelfKind('books', ['comic', 'novel'])).toBe('novel');
    expect(inferShelfKind('a1b2c3', ['comic', 'novel'])).toBe('novel');
    expect(inferShelfKind('a1b2c3', ['music', 'comic'])).toBe('comic');
  });
});

describe('helpers', () => {
  it('knows which values are shelf kinds', () => {
    expect(isShelfKind('music')).toBe(true);
    expect(isShelfKind('hologram')).toBe(false);
    expect(isShelfKind(undefined)).toBe(false);
  });

  it('calls a text book a novel', () => {
    expect(fileKindOfBook('text')).toBe('novel');
    expect(fileKindOfBook('comic')).toBe('comic');
  });
});
