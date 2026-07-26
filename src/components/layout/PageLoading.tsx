import { Skeleton } from "../ui/EmptyState";

/** Suspense fallback shown while a lazy-loaded route chunk downloads. */
export function PageLoading() {
  return (
    <div className="p-6 space-y-4" dir="rtl">
      <Skeleton className="h-8 w-52" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Skeleton className="h-20" rounded="lg" />
        <Skeleton className="h-20" rounded="lg" />
        <Skeleton className="h-20" rounded="lg" />
        <Skeleton className="h-20" rounded="lg" />
      </div>
      <Skeleton className="h-64" rounded="lg" />
    </div>
  );
}
