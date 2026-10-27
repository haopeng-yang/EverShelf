import { addItem, addTag } from '../src/models/actions';
import { BackupError, backupFileName, createBackup, parseBackup } from '../src/models/backup';
import { createDefaultState } from '../src/models/defaults';
import { shelfReducer } from '../src/models/shelfReducer';
import type { ShelfState } from '../src/models/types';

function sampleState(): ShelfState {
  let state = createDefaultState();
  state = shelfReducer(state, addItem(state.shelves[0], 'Dune', 'file:///covers/dune.jpg'));
  state = shelfReducer(state, addItem(state.shelves[1], 'Alien'));
  return shelfReducer(state, addTag(state.items[0].id, 'Age Restricted', 'Recommended 15+'));
}

const COVER = 'data:image/jpeg;base64,AAAA';

describe('backup', () => {
  it('round-trips shelves, items, tags and covers', () => {
    const state = sampleState();
    const dune = state.items[0];
    const file = createBackup(state, new Map([[dune.id, COVER]]), new Date('2026-10-27T10:00:00Z'));
    const parsed = parseBackup(JSON.stringify(file));

    expect(parsed.state.shelves).toEqual(state.shelves);
    expect(parsed.state.items).toEqual(state.items.map((i) => ({ ...i, coverUri: null })));
    expect(parsed.covers).toEqual(new Map([[dune.id, COVER]]));
    expect(file.exportedAt).toBe('2026-10-27T10:00:00.000Z');
    expect(JSON.stringify(file)).not.toContain('file:///');
  });

  it('rejects files that are not EverShelf backups', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"hello": 1}')).toThrow('not an EverShelf backup');
    expect(() => parseBackup('{"app":"EverShelf","version":99,"shelves":[],"items":[]}')).toThrow('newer version');
  });

  it('rejects damaged contents with a readable message', () => {
    const file = createBackup(sampleState(), new Map(), new Date());
    const orphan = { ...file, shelves: file.shelves.slice(1) };
    expect(() => parseBackup(JSON.stringify(orphan))).toThrow('the shelf of item 1 is missing');
    const badTag = { ...file, items: [{ ...file.items[0], tags: [{ id: 1 }] }] };
    expect(() => parseBackup(JSON.stringify(badTag))).toThrow('a tag on item 1');
    expect(() => parseBackup(JSON.stringify(badTag))).toThrow(
      expect.objectContaining({ code: 'badTag', params: { n: 1 } }),
    );
  });

  it('ignores covers that are not images', () => {
    const state = sampleState();
    const file = createBackup(state, new Map([[state.items[0].id, 'javascript:alert(1)']]), new Date());
    expect(parseBackup(JSON.stringify(file)).covers.size).toBe(0);
  });

  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('evershelf-backup-2026-01-05.json');
  });
});
