import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import AssetDetailClient from "./asset-detail-client";

function AssetDetailFallback() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4 pt-4">
      <Skeleton className="h-9 w-9 rounded-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export default function AssetDetailPage() {
  return (
    <Suspense fallback={<AssetDetailFallback />}>
      <AssetDetailClient />
    </Suspense>
  );
}
