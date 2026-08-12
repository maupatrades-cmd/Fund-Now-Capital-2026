import { Check, Clock3, FileSearch, Loader2, RefreshCw } from "lucide-react";
import {
  type ClientApplicationProgress as Application,
  type ClientProgressStatus,
  useClientApplicationProgress,
} from "@/hooks/useClientApplicationProgress";

const steps: Array<{ status: Exclude<ClientProgressStatus, "closed">; label: string; detail: string }> = [
  { status: "received", label: "Received", detail: "Your application is safely with Fund Now Capital." },
  { status: "documents", label: "Documents", detail: "We are collecting and checking the required paperwork." },
  { status: "review", label: "Readiness review", detail: "Your application package is being prepared." },
  { status: "funding_review", label: "Funding review", detail: "Your funding application is under consideration." },
  { status: "decision", label: "Decision", detail: "An outcome or offer is being prepared for you." },
  { status: "finalising", label: "Final checks", detail: "Contracts and final verification are in progress." },
  { status: "funded", label: "Funded", detail: "Your funding journey is complete." },
];

const dateFormatter = new Intl.DateTimeFormat("en-ZA", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function statusIndex(status: ClientProgressStatus) {
  if (status === "closed") return -1;
  return steps.findIndex((step) => step.status === status);
}

function ApplicationCard({ application }: { application: Application }) {
  const currentIndex = statusIndex(application.currentStatus);
  const eventDates = new Map(application.timeline.map((event) => [event.status, event.occurredAt]));
  const closed = application.currentStatus === "closed";

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#86d4cf]">{application.dealReference}</p>
          <h3 className="mt-1 text-lg font-extrabold">{application.productLabel}</h3>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
          Updated {dateFormatter.format(new Date(application.lastProgressAt))}
        </div>
      </div>

      {closed ? (
        <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/8 p-4">
          <p className="font-bold text-amber-100">This application is closed.</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/65">Contact the Fund Now Capital team if you want to discuss another funding route.</p>
        </div>
      ) : (
        <ol className="mt-5 grid gap-1 lg:grid-cols-7" aria-label={`${application.dealReference} progress`}>
          {steps.map((step, index) => {
            const reached = index <= currentIndex;
            const current = index === currentIndex;
            const occurredAt = eventDates.get(step.status);
            return (
              <li key={step.status} className="relative flex gap-3 rounded-xl p-2 lg:block lg:px-1 lg:text-center">
                {index < steps.length - 1 ? (
                  <span className={`absolute left-[25px] top-10 h-[calc(100%-1.25rem)] w-px lg:left-1/2 lg:top-[25px] lg:h-px lg:w-full ${index < currentIndex ? "bg-[#6ec144]" : "bg-white/10"}`} aria-hidden="true" />
                ) : null}
                <span className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-extrabold lg:mx-auto ${
                  current
                    ? "client-pulse border-[#6ec144]/70 bg-[#6ec144]/20 text-[#b8f39c]"
                    : reached
                      ? "border-[#6ec144] bg-[#6ec144] text-[#06131d]"
                      : "border-white/12 bg-[#102633] text-white/30"
                }`}>
                  {reached && !current ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
                </span>
                <div className="relative z-10 pb-3 lg:mt-3 lg:pb-0">
                  <p className={`text-xs font-extrabold ${reached ? "text-white" : "text-white/38"}`}>{step.label}</p>
                  <p className="mt-1 text-[10px] leading-4 text-white/35 lg:hidden">{step.detail}</p>
                  {occurredAt ? <p className="mt-1 text-[10px] text-[#86d4cf]">{dateFormatter.format(new Date(occurredAt))}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!closed && currentIndex >= 0 ? (
        <div className="mt-5 flex gap-3 rounded-2xl border border-[#7fd4e8]/15 bg-[#7fd4e8]/6 p-4">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-[#7fd4e8]" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">{steps[currentIndex].label}</p>
            <p className="mt-1 text-xs leading-5 text-white/48">{steps[currentIndex].detail}</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function ClientApplicationProgress() {
  const query = useClientApplicationProgress();

  if (query.isLoading) {
    return <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your progress…</div>;
  }

  if (query.isError) {
    return (
      <div role="alert" className="rounded-2xl border border-red-300/20 bg-red-300/8 p-5">
        <p className="font-bold text-red-100">We couldn’t load your application progress.</p>
        <button type="button" onClick={() => void query.refetch()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/5">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  if (!query.data?.length) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/12 px-5 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-[#7fd4e8]"><FileSearch className="h-5 w-5" aria-hidden="true" /></span>
        <p className="mt-4 font-extrabold">No active application yet</p>
        <p className="mt-2 max-w-md text-xs leading-5 text-white/45">Once your application is submitted, its progress will appear here automatically.</p>
      </div>
    );
  }

  return <div className="space-y-4">{query.data.map((application) => <ApplicationCard key={application.dealId} application={application} />)}</div>;
}
