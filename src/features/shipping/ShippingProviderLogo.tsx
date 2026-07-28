import { PackageCheck } from "lucide-react";
import type { ShippingProvider } from "../../types";
import { cn } from "../../lib/utils";
import { bostaLogo } from "../../assets/bosta-logo";

export function shippingProviderLogo(provider: ShippingProvider) {
  return provider.kind === "bosta" ? bostaLogo : provider.logoDataUrl;
}

export function ShippingProviderLogo({
  provider,
  className,
  fallbackClassName,
}: {
  provider: ShippingProvider;
  className?: string;
  fallbackClassName?: string;
}) {
  const source = shippingProviderLogo(provider);

  if (source) {
    return (
      <img
        src={source}
        alt={`شعار ${provider.name}`}
        className={cn("h-7 w-auto max-w-full object-contain", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs font-bold text-ink",
        fallbackClassName,
      )}
    >
      <PackageCheck className="h-4 w-4 text-brand-600" />
      {provider.name}
    </span>
  );
}
