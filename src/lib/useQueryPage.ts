import { useEffect, useState } from "react";

export interface QueryPageResult<T> {
  rows: T[];
  total: number;
  totals: { total: number; paid: number; remaining: number };
  loading: boolean;
  error: string | null;
  queryMs?: number;
  payloadBytes?: number;
  facets?: Record<string, number>;
}

const EMPTY_TOTALS = { total: 0, paid: 0, remaining: 0 };

export function useQueryPage<T>(
  entity: string,
  input: Record<string, unknown>,
  enabled = true,
): QueryPageResult<T> {
  const [result, setResult] = useState<QueryPageResult<T>>({
    rows: [], total: 0, totals: EMPTY_TOTALS, loading: enabled, error: null,
  });
  const key = JSON.stringify(input);
  useEffect(() => {
    const api = window.desktopAPI?.query;
    if (!enabled || !api) {
      setResult((current) => ({ ...current, loading: false }));
      return;
    }
    let active = true;
    setResult((current) => ({ ...current, loading: true, error: null }));
    void api.page(entity, input).then((response) => {
      if (!active) return;
      if (!response.ok) {
        setResult({ rows: [], total: 0, totals: EMPTY_TOTALS, loading: false, error: response.error || "query_failed" });
        return;
      }
      setResult({
        rows: (response.rows || []) as T[],
        total: response.total || 0,
        totals: response.totals || EMPTY_TOTALS,
        loading: false,
        error: null,
        queryMs: response.queryMs,
        payloadBytes: response.payloadBytes,
        facets: response.facets,
      });
    });
    return () => { active = false; };
    // `key` is the stable value identity; callers often construct `input` inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, enabled, key]);
  return result;
}
