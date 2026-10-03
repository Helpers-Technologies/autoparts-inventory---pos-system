/**
 * Collections in this list own their durable writes outside React's normal
 * state flush. They may intentionally be absent from memory after startup.
 * A generic state snapshot must never replace them with their unloaded
 * fallback value.
 */
const DIRECT_PERSISTENCE_KEYS = new Set(["stockMovements", "mobileStockOpReceipts"]);

const AUXILIARY_PERSISTENCE_KEYS = new Set([
  "customerVehicles", "warrantyClaims", "branches", "branchStocks",
  "stockTransfers", "priceTiers",
]);
type PersistenceReader = (state: Readonly<Record<string, unknown>>) => Record<string, unknown>;
const auxiliaryOwners = new Map<symbol, PersistenceReader>();

export function hasAuxiliaryPersistenceOwners(): boolean {
  return auxiliaryOwners.size > 0;
}

/** Register only a hydrated owner's live snapshot; unregister on session loss. */
export function registerAuxiliaryPersistenceOwner(read: PersistenceReader): () => void {
  const owner = Symbol("auxiliary-persistence-owner");
  auxiliaryOwners.set(owner, read);
  return () => { auxiliaryOwners.delete(owner); };
}

/** Include other state owners in the same awaited graceful-close transaction. */
export function shutdownPersistenceEntries(
  state: Record<string, unknown>,
  omittedKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const auxiliary: Record<string, unknown> = {};
  for (const read of auxiliaryOwners.values()) {
    for (const [key, value] of Object.entries(read(state))) {
      if (AUXILIARY_PERSISTENCE_KEYS.has(key)) auxiliary[key] = value;
    }
  }
  return { ...auxiliary, ...stateOwnedPersistenceEntries(state, omittedKeys) };
}

export function stateOwnedPersistenceEntries(
  state: Record<string, unknown>,
  omittedKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => !DIRECT_PERSISTENCE_KEYS.has(key) && !omittedKeys.has(key),
    ),
  );
}
