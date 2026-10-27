import { filterItems, sortItems } from '../src/models/query';
import type { Item } from '../src/models/types';

function item(id: string, title: string, tags: [string, string][], createdAt: number, updatedAt = createdAt): Item {
  return {
    id,
    shelfId: 'books',
    title,
    coverUri: null,
    tags: tags.map(([name, value], i) => ({ id: `${id}-${i}`, name, value })),
    createdAt,
    updatedAt,
  };
}

const dune = item('dune', 'Dune', [['Author', 'Frank Herbert'], ['Age Restricted', 'Recommended 15+']], 1, 10);
const hobbit = item('hobbit', 'The Hobbit', [['Author', 'J. R. R. Tolkien']], 2, 5);
const book2 = item('b2', 'Book 2', [['Notes', 'second']], 3);
const book10 = item('b10', 'book 10', [], 4);
const all = [dune, hobbit, book2, book10];
const ids = (items: Item[]) => items.map((i) => i.id);

describe('filterItems', () => {
  it('returns everything for an empty query', () => {
    expect(filterItems(all, '   ')).toBe(all);
  });

  it('matches every word against title, tag names and values, ignoring case', () => {
    expect(ids(filterItems(all, 'HERBERT'))).toEqual(['dune']);
    expect(ids(filterItems(all, 'dune frank'))).toEqual(['dune']);
    expect(ids(filterItems(all, 'author'))).toEqual(['dune', 'hobbit']);
    expect(ids(filterItems(all, 'dune tolkien'))).toEqual([]);
  });

  it('supports "tag: value" searches', () => {
    expect(ids(filterItems(all, 'age restricted: 15'))).toEqual(['dune']);
    expect(ids(filterItems(all, 'age: 18'))).toEqual([]);
    expect(ids(filterItems(all, 'author:'))).toEqual(['dune', 'hobbit']);
    expect(ids(filterItems(all, 'title: hobbit'))).toEqual(['hobbit']);
  });
});

describe('sortItems', () => {
  it('sorts by added date, title and edit date without changing the input', () => {
    expect(ids(sortItems(all, 'newest'))).toEqual(['b10', 'b2', 'hobbit', 'dune']);
    expect(ids(sortItems(all, 'oldest'))).toEqual(['dune', 'hobbit', 'b2', 'b10']);
    expect(ids(sortItems(all, 'titleAsc'))).toEqual(['b2', 'b10', 'dune', 'hobbit']);
    expect(ids(sortItems(all, 'titleDesc'))).toEqual(['hobbit', 'dune', 'b10', 'b2']);
    expect(ids(sortItems(all, 'updated'))).toEqual(['dune', 'hobbit', 'b10', 'b2']);
    expect(ids(all)).toEqual(['dune', 'hobbit', 'b2', 'b10']);
  });
});
