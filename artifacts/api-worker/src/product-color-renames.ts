// A color rename changes the display label, not the stock identity.
// Only explicit, unambiguous renames are allowed to reconcile inventory history.
export type ProductColorRename = { from: string; to: string };

type ColorNamed = { color: string };

export function validProductColorRenames(
  previous: readonly ColorNamed[],
  next: readonly ColorNamed[],
  renames: readonly ProductColorRename[],
): boolean {
  const previousColors = new Set(previous.map((item) => item.color));
  const nextColors = new Set(next.map((item) => item.color));
  const seenOld = new Set<string>();
  const seenNew = new Set<string>();

  for (const { from, to } of renames) {
    if (
      from === to ||
      !previousColors.has(from) ||
      !nextColors.has(to) ||
      previousColors.has(to) ||
      nextColors.has(from) ||
      seenOld.has(from) ||
      seenNew.has(to)
    ) {
      return false;
    }

    seenOld.add(from);
    seenNew.add(to);
  }

  return true;
}

export function priorVariantsWithRenamedColors<T extends ColorNamed>(
  previous: readonly T[],
  renames: readonly ProductColorRename[],
): T[] {
  const renamed = new Map(renames.map(({ from, to }) => [from, to]));
  return previous.map((item) => {
    const nextColor = renamed.get(item.color);
    return nextColor === undefined ? item : { ...item, color: nextColor };
  });
}

export function originalColorName(
  currentColor: string,
  renames: readonly ProductColorRename[],
): string {
  return renames.find((item) => item.to === currentColor)?.from ?? currentColor;
}
