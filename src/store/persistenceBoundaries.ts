/**
 * Collections in this list own their durable writes outside React's normal
 * state flush. They may intentionally be absent from memory after startup.
 * A generic state snapshot must never replace them with their unloaded
 * fallback value.
 */
const DIRECT_PERSISTENCE_KEYS = new Set(["stockMovements"]);

export function stateOwnedPersistenceEntries(
  state: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => !DIRECT_PERSISTENCE_KEYS.has(key)),
  );
}
