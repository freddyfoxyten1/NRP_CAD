import { SimpleLoading } from "@/components/shared/LoadingProgress";

export default function RouteFallback() {
  return <SimpleLoading label="Loading…" minHeightClass="min-h-screen" />;
}
