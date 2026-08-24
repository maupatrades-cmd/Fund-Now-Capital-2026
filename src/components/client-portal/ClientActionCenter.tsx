import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileSignature,
  FileUp,
  Loader2,
  MessageCircle,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useClientApplicationProgress } from "@/hooks/useClientApplicationProgress";
import { useClientFundingOfferWorkspace } from "@/hooks/useClientFundingOffers";
import { useClientMessageWorkspace } from "@/hooks/useClientPortalMessages";
import { supabase } from "@/lib/supabase";

type DocumentWorkspace = {
  deal_id: string | null;
  checklist: Array<{ document_type: string; requirement: "required" | "optional" }>;
  documents: Array<{
    document_type: string;
    is_current_version: boolean;
    verification_status: "unverified" | "accepted" | "rejected";
  }>;
};

type LegalReadiness = {
  id: string;
  status: "preparing" | "ready_to_sign" | "client_signed" | "awaiting_fnc_countersign" | "complete" | "declined" | "expired" | "superseded";
};

type Action = {
  key: string;
  title: string;
  detail: string;
  href: string;
  label: string;
  priority: number;
  icon: typeof FileUp;
  tone: string;
};

function useClientDocumentWorkspace() {
  return useQuery({
    queryKey: ["client-document-workspace"],
    queryFn: async (): Promise<DocumentWorkspace> => {
      const { data, error } = await supabase.rpc("client_portal_document_workspace");
      if (error) throw error;
      return data as DocumentWorkspace;
    },
  });
}

function useClientLegalReadiness() {
  return useQuery({
    queryKey: ["client-legal-readiness"],
    queryFn: async (): Promise<LegalReadiness[]> => {
      const { data, error } = await supabase
        .from("client_legal_document_readiness")
        .select("id,status")
        .neq("status", "superseded")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LegalReadiness[];
    },
  });
}

export default function ClientActionCenter() {
  const progress = useClientApplicationProgress();
  const documents = useClientDocumentWorkspace();
  const legal = useClientLegalReadiness();
  const offers = useClientFundingOfferWorkspace();
  const messages = useClientMessageWorkspace();

  const actions: Action[] = [];
  const currentDocuments = (documents.data?.documents ?? []).filter((document) => document.is_current_version);
  const documentByType = new Map(currentDocuments.map((document) => [document.document_type, document]));
  const requiredDocuments = (documents.data?.checklist ?? []).filter((item) => item.requirement === "required");
  const missingDocuments = requiredDocuments.filter((item) => documentByType.get(item.document_type)?.verification_status !== "accepted");
  const rejectedDocuments = missingDocuments.filter((item) => documentByType.get(item.document_type)?.verification_status === "rejected");

  if (!documents.isLoading && documents.data?.deal_id && missingDocuments.length > 0) {
    actions.push({
      key: "documents",
      title: rejectedDocuments.length ? "Replace documents needing attention" : "Complete your document checklist",
      detail: rejectedDocuments.length
        ? `${rejectedDocuments.length} document${rejectedDocuments.length === 1 ? "" : "s"} must be replaced before review can continue.`
        : `${missingDocuments.length} required document${missingDocuments.length === 1 ? "" : "s"} still need approval.`,
      href: "/client/documents",
      label: "Open checklist",
      priority: rejectedDocuments.length ? 100 : 90,
      icon: rejectedDocuments.length ? CircleAlert : FileUp,
      tone: rejectedDocuments.length ? "text-red-200 bg-red-300/10" : "text-amber-100 bg-amber-300/10",
    });
  }

  const readyToSign = (legal.data ?? []).filter((row) => row.status === "ready_to_sign").length;
  const legalAttention = (legal.data ?? []).filter((row) => row.status === "declined" || row.status === "expired").length;
  if (readyToSign || legalAttention) {
    actions.push({
      key: "legal",
      title: legalAttention ? "Legal documents need attention" : "Documents are ready for signature",
      detail: legalAttention
        ? `${legalAttention} legal document${legalAttention === 1 ? "" : "s"} require action from Fund Now Capital and you.`
        : `${readyToSign} approved document${readyToSign === 1 ? " is" : "s are"} ready to review and sign.`,
      href: "/client/legal-documents",
      label: "Review documents",
      priority: legalAttention ? 95 : 85,
      icon: FileSignature,
      tone: legalAttention ? "text-red-200 bg-red-300/10" : "text-[#9be7f7] bg-[#7fd4e8]/10",
    });
  }

  const undecidedOffers = (offers.data ?? []).filter((offer) => offer.decision === null).length;
  if (undecidedOffers) {
    actions.push({
      key: "offers",
      title: "A funding offer is waiting for you",
      detail: `Review ${undecidedOffers} published offer${undecidedOffers === 1 ? "" : "s"} and record your decision securely.`,
      href: "/client/offers",
      label: "Review offers",
      priority: 80,
      icon: WalletCards,
      tone: "text-[#a2eb80] bg-[#6ec144]/10",
    });
  }

  if (!progress.isLoading && !progress.data?.length) {
    actions.push({
      key: "application",
      title: "Tell us what your business needs",
      detail: "Start your application so Fund Now Capital can prepare the correct funding and paperwork path.",
      href: "/client/application",
      label: "Start application",
      priority: 70,
      icon: Sparkles,
      tone: "text-[#9be7f7] bg-[#2ca8a8]/10",
    });
  }

  const openThreads = (messages.data?.threads ?? []).filter((thread) => thread.status === "open").length;
  if (openThreads) {
    actions.push({
      key: "messages",
      title: "Keep the conversation moving",
      detail: `${openThreads} open conversation${openThreads === 1 ? "" : "s"} with the Fund Now Capital team.`,
      href: "/client/messages",
      label: "Open messages",
      priority: 40,
      icon: MessageCircle,
      tone: "text-white/75 bg-white/5",
    });
  }

  actions.sort((left, right) => right.priority - left.priority);
  const queries = [progress, documents, legal, offers, messages];
  const isLoading = queries.some((query) => query.isLoading);
  const failedCount = queries.filter((query) => query.isError).length;

  return (
    <section className="client-glass rounded-[28px] p-5 sm:p-8" aria-labelledby="client-next-actions-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#86d4cf]">Your next best steps</p>
          <h2 id="client-next-actions-heading" className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Action centre</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">The most important work across your application, paperwork and offers—prioritised in one place.</p>
        </div>
        {isLoading ? <span className="inline-flex items-center gap-2 text-xs font-bold text-white/45"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking your workspace</span> : null}
      </div>

      {failedCount ? (
        <p role="status" className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/8 p-4 text-xs leading-5 text-amber-100">
          Some live statuses are still loading. You can continue using every portal page while Fund Now Capital refreshes this summary.
        </p>
      ) : null}

      {!isLoading && actions.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-[#6ec144]/20 bg-[#6ec144]/8 px-5 py-9 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#6ec144]/15 text-[#a2eb80]"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></span>
          <p className="mt-4 font-extrabold">You are up to date</p>
          <p className="mt-2 max-w-md text-xs leading-5 text-white/45">There are no outstanding client actions right now. New requests will appear here automatically.</p>
        </div>
      ) : null}

      {actions.length ? (
        <ol className="mt-6 grid gap-3 lg:grid-cols-2">
          {actions.slice(0, 4).map((action, index) => {
            const Icon = action.icon;
            return (
              <li key={action.key}>
                <Link to={action.href} className="group flex h-full min-h-36 gap-4 rounded-2xl border border-white/9 bg-white/[0.035] p-4 transition hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6ec144] sm:p-5">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${action.tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Priority {index + 1}</span>
                    <span className="mt-1 font-extrabold text-white/90">{action.title}</span>
                    <span className="mt-2 text-xs leading-5 text-white/45">{action.detail}</span>
                    <span className="mt-auto inline-flex items-center gap-2 pt-4 text-xs font-extrabold text-[#a2eb80]">{action.label}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
