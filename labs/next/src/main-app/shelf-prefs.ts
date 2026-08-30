/**
 * How the library wall is laid out. The wall always carves three ribbon
 * niches; the only choice is how many bays each ribbon holds. Five is the
 * gallery reading; three gives each book more air and a larger cover.
 */
export type ShelfColumns = 3 | 5;

export type ShelfColumnsOption = {
  value: ShelfColumns;
  label: string;
  hint: string;
};

export const SHELF_COLUMN_OPTIONS: ReadonlyArray<ShelfColumnsOption> = [
  { value: 3, label: "Three", hint: "Fewer, larger books per ribbon." },
  { value: 5, label: "Five", hint: "The gallery wall." },
];

export const DEFAULT_SHELF_COLUMNS: ShelfColumns = 5;

/** Rows are fixed by the architecture: three ribbons, always. */
export const SHELF_ROWS = 3;

const COLUMNS_KEY = "kosmos-labs-shelf-columns";
export const SHELF_COLUMNS_EVENT = "kosmos-shelf-columns-changed";

function canStore() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function isShelfColumns(value: unknown): value is ShelfColumns {
  return value === 3 || value === 5;
}

export function readShelfColumns(): ShelfColumns {
  if (!canStore()) {
    return DEFAULT_SHELF_COLUMNS;
  }
  const stored = Number(window.localStorage.getItem(COLUMNS_KEY));
  return isShelfColumns(stored) ? stored : DEFAULT_SHELF_COLUMNS;
}

export function writeShelfColumns(columns: ShelfColumns): ShelfColumns {
  if (canStore()) {
    window.localStorage.setItem(COLUMNS_KEY, String(columns));
    window.dispatchEvent(new CustomEvent<ShelfColumns>(SHELF_COLUMNS_EVENT, { detail: columns }));
  }
  return columns;
}
