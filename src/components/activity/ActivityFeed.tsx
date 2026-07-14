import { useEntityActivity } from "@/hooks/useActivity";
import { ActivityList } from "@/components/activity/ActivityList";

// Entity-scoped activity (deal detail + client detail). Shows the entity's own
// events plus related ones (a deal's submissions; a client's deals + contacts).
export function ActivityFeed({ entityId }: { entityId: string }) {
  const { data, isLoading, isError, error } = useEntityActivity(entityId);

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-brand-navy">Activity</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          Couldn't load activity: {(error as Error)?.message}
        </p>
      ) : (
        <ActivityList rows={data ?? []} />
      )}
    </div>
  );
}
