export function groupByKey<T>(
  items: readonly T[],
  getKey: (item: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

export function latestValueByKey<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  getValue: (item: T) => string,
  include: (item: T) => boolean = () => true
): Map<string, string> {
  const latestValues = new Map<string, string>();

  for (const item of items) {
    if (!include(item)) continue;

    const key = getKey(item);
    const value = getValue(item);
    const current = latestValues.get(key);
    if (!current || value > current) latestValues.set(key, value);
  }

  return latestValues;
}
