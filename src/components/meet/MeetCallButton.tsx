import { Phone, Video } from "lucide-react";
import { useMeet } from "@/components/meet/meetContext";

// "Call" next to a person (owner, 24 Nov 2026). Shows a green dot when they are online in the CRM. The database decides
// whether the call is allowed (meet_can_contact); this button only hides itself when calls are off for the viewer.
export function MeetCallButton({ profileId, name, compact }: { profileId: string; name: string; compact?: boolean }) {
  const { enabled, online, call, inCall } = useMeet();
  if (!enabled) return null;
  const isOnline = online.has(profileId);
  return (
    <span className="inline-flex items-center gap-1">
      <span title={isOnline ? "Online in the CRM" : "Offline"} aria-label={isOnline ? "Online" : "Offline"}
        className={`h-2 w-2 rounded-full ${isOnline ? "bg-[#5dba5d]" : "bg-slate-300"}`} />
      <button type="button" disabled={inCall} onClick={() => void call(profileId, name, false)}
        className="inline-flex items-center gap-1 rounded-lg border border-brand-teal/40 px-2 py-1 text-xs font-semibold text-brand-teal hover:bg-brand-teal/10 disabled:opacity-50"
        aria-label={`Call ${name} in the CRM`}>
        <Phone className="h-3.5 w-3.5" aria-hidden="true" />{compact ? null : " Call"}
      </button>
      {compact ? null : (
        <button type="button" disabled={inCall} onClick={() => void call(profileId, name, true)}
          className="inline-flex items-center rounded-lg border border-brand-teal/40 px-2 py-1 text-xs text-brand-teal hover:bg-brand-teal/10 disabled:opacity-50"
          aria-label={`Video call ${name}`}>
          <Video className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
