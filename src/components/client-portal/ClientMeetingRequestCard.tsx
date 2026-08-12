import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Clock3, Loader2, Phone, Video, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useClientPortalIdentity } from "@/hooks/useClientPortalIdentity";

type RequestType = "funding_consultation" | "paperwork_review" | "presentation" | "phone_call";
type ContactMethod = "video" | "phone" | "in_person";
type RequestStatus = "pending" | "confirmed" | "completed" | "declined" | "cancelled";

type MeetingRequest = {
  id: string;
  request_type: RequestType;
  subject: string;
  notes: string | null;
  contact_method: ContactMethod;
  preferred_start: string;
  alternate_start: string | null;
  timezone: string;
  status: RequestStatus;
  scheduled_start: string | null;
  meeting_url: string | null;
  owner_response: string | null;
  created_at: string;
};

const requestTypeOptions: Array<{ value: RequestType; label: string }> = [
  { value: "funding_consultation", label: "Funding consultation" },
  { value: "paperwork_review", label: "Paperwork review" },
  { value: "presentation", label: "Funding presentation" },
  { value: "phone_call", label: "General call" },
];

const contactMethodOptions: Array<{ value: ContactMethod; label: string }> = [
  { value: "video", label: "Video call" },
  { value: "phone", label: "Phone call" },
  { value: "in_person", label: "In person" },
];

const statusStyle: Record<RequestStatus, string> = {
  pending: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  confirmed: "border-[#6ec144]/25 bg-[#6ec144]/12 text-[#a2eb80]",
  completed: "border-[#7fd4e8]/25 bg-[#7fd4e8]/10 text-[#9be2ee]",
  declined: "border-red-300/20 bg-red-300/10 text-red-100",
  cancelled: "border-white/10 bg-white/5 text-white/45",
};

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

function defaultMinimumTime() {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function ClientMeetingRequestCard() {
  const identity = useClientPortalIdentity();
  const queryClient = useQueryClient();
  const [requestType, setRequestType] = useState<RequestType>("funding_consultation");
  const [contactMethod, setContactMethod] = useState<ContactMethod>("video");
  const [subject, setSubject] = useState("Funding consultation");
  const [notes, setNotes] = useState("");
  const [preferredStart, setPreferredStart] = useState("");
  const [alternateStart, setAlternateStart] = useState("");
  const minimumTime = useMemo(defaultMinimumTime, []);

  const requests = useQuery({
    queryKey: ["client-meeting-requests", identity.data?.clientId],
    enabled: Boolean(identity.data?.clientId),
    staleTime: 30_000,
    queryFn: async (): Promise<MeetingRequest[]> => {
      const { data, error } = await supabase
        .from("client_meeting_requests")
        .select("id,request_type,subject,notes,contact_method,preferred_start,alternate_start,timezone,status,scheduled_start,meeting_url,owner_response,created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as MeetingRequest[];
    },
  });

  const createRequest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("client_create_meeting_request", {
        p_request_type: requestType,
        p_subject: subject.trim(),
        p_notes: notes.trim() || null,
        p_contact_method: contactMethod,
        p_preferred_start: new Date(preferredStart).toISOString(),
        p_alternate_start: alternateStart ? new Date(alternateStart).toISOString() : null,
        p_timezone: "Africa/Johannesburg",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotes("");
      setPreferredStart("");
      setAlternateStart("");
      await queryClient.invalidateQueries({ queryKey: ["client-meeting-requests"] });
      toast.success("Your meeting request was sent securely.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send the request."),
  });

  const cancelRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("client_cancel_meeting_request", {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-meeting-requests"] });
      toast.success("Meeting request cancelled.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not cancel the request."),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preferredStart || subject.trim().length < 3) return;
    if (alternateStart && alternateStart === preferredStart) {
      toast.error("Please choose a different alternate time.");
      return;
    }
    createRequest.mutate();
  }

  return (
    <article id="support" className="client-glass scroll-mt-28 rounded-[28px] p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#6ec144]/15 text-[#9ee67d]">
          <CalendarClock className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Request, then confirm
        </span>
      </div>
      <h2 className="mt-5 text-xl font-extrabold">Meet with the Fund Now Capital team</h2>
      <p className="mt-2 text-sm leading-6 text-white/48">
        Send two suitable times for a consultation, presentation or paperwork review. Your meeting is booked only after the Owner confirms it.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4" aria-label="Request a meeting">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-xs font-bold text-white/65">
            Purpose
            <select
              value={requestType}
              onChange={(event) => {
                const value = event.target.value as RequestType;
                setRequestType(value);
                setSubject(requestTypeOptions.find((option) => option.value === value)?.label ?? "Meeting request");
              }}
              className="min-h-11 w-full rounded-xl border border-white/12 bg-[#0a1d2a] px-3 text-sm text-white outline-none focus:border-[#6ec144]/60"
            >
              {requestTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-xs font-bold text-white/65">
            Preferred format
            <select
              value={contactMethod}
              onChange={(event) => setContactMethod(event.target.value as ContactMethod)}
              className="min-h-11 w-full rounded-xl border border-white/12 bg-[#0a1d2a] px-3 text-sm text-white outline-none focus:border-[#6ec144]/60"
            >
              {contactMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <label className="block space-y-2 text-xs font-bold text-white/65">
          Subject
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            minLength={3}
            maxLength={120}
            required
            className="min-h-11 w-full rounded-xl border border-white/12 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#6ec144]/60"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-xs font-bold text-white/65">
            First choice
            <input
              type="datetime-local"
              value={preferredStart}
              min={minimumTime}
              onChange={(event) => setPreferredStart(event.target.value)}
              required
              className="min-h-11 w-full rounded-xl border border-white/12 bg-[#0a1d2a] px-3 text-sm text-white outline-none focus:border-[#6ec144]/60"
            />
          </label>
          <label className="space-y-2 text-xs font-bold text-white/65">
            Alternate choice <span className="font-normal text-white/35">(optional)</span>
            <input
              type="datetime-local"
              value={alternateStart}
              min={minimumTime}
              onChange={(event) => setAlternateStart(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/12 bg-[#0a1d2a] px-3 text-sm text-white outline-none focus:border-[#6ec144]/60"
            />
          </label>
        </div>

        <label className="block space-y-2 text-xs font-bold text-white/65">
          What should we prepare? <span className="font-normal text-white/35">(optional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full resize-y rounded-xl border border-white/12 bg-white/5 px-3 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#6ec144]/60"
            placeholder="For example: review my purchase order documents"
          />
        </label>

        <button
          type="submit"
          disabled={createRequest.isPending || !preferredStart || subject.trim().length < 3}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6ec144] to-[#2ca8a8] px-4 text-sm font-extrabold text-[#06131d] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="h-4 w-4" aria-hidden="true" />}
          Send meeting request
        </button>
      </form>

      <div className="mt-7 border-t border-white/10 pt-5">
        <h3 className="text-sm font-extrabold">Your recent requests</h3>
        {requests.isLoading ? <p className="mt-3 text-xs text-white/40">Loading requestsâ€¦</p> : null}
        {requests.isError ? <p role="alert" className="mt-3 text-xs text-red-200">Your requests could not be loaded. Please try again.</p> : null}
        {!requests.isLoading && !requests.isError && (requests.data?.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs leading-5 text-white/40">No meeting requests yet.</p>
        ) : null}
        <div className="mt-3 space-y-3">
          {requests.data?.map((request) => {
            const confirmedTime = formatDateTime(request.scheduled_start);
            return (
              <section key={request.id} className="rounded-2xl border border-white/9 bg-white/[0.035] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">{request.subject}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
                      {request.contact_method === "phone" ? <Phone className="h-3.5 w-3.5" aria-hidden="true" /> : <Video className="h-3.5 w-3.5" aria-hidden="true" />}
                      {confirmedTime ? `Confirmed for ${confirmedTime}` : `Requested ${formatDateTime(request.preferred_start)}`}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] ${statusStyle[request.status]}`}>
                    {request.status}
                  </span>
                </div>
                {request.owner_response ? <p className="mt-3 rounded-xl bg-white/5 p-3 text-xs leading-5 text-white/60">{request.owner_response}</p> : null}
                {request.status === "confirmed" && request.meeting_url ? (
                  <a href={request.meeting_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-extrabold text-[#9ee67d] hover:text-white">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Join meeting
                  </a>
                ) : null}
                {request.status === "pending" ? (
                  <button
                    type="button"
                    disabled={cancelRequest.isPending}
                    onClick={() => cancelRequest.mutate(request.id)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white/45 hover:text-red-200 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel request
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>
        <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-white/35">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Times are shown in South Africa Standard Time. A pending request is not yet a confirmed appointment.
        </p>
      </div>
    </article>
  );
}
