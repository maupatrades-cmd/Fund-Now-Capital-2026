import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CallContext } from "@/components/calls/callContext";
import { Loader2, Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useProfileRole } from "@/hooks/useProfileRole";
import { fetchVoiceToken, prepareCall, useSetCallNote, type CallTarget } from "@/hooks/useCalls";

// Calls inside the CRM (owner, 23 Nov 2026): one call at a time, placed from the browser with Twilio Voice. The Twilio
// SDK (about 400 KB) is loaded only when the Director first presses Call. A small floating panel shows who is being
// called (masked number), a timer, Mute and Hang up; after the call it offers "Log this call".

type Phase = "connecting" | "ringing" | "in-call" | "ended";
type ActiveCall = {
  target: CallTarget; callTargetId: string; masked: string; phase: Phase; startedAt: number | null; muted: boolean;
};

// Minimal shapes of the Twilio SDK objects we use (the SDK is imported lazily).
type TwilioCall = {
  on: (event: string, fn: (...args: unknown[]) => void) => void; mute: (m: boolean) => void; disconnect: () => void;
};
type TwilioDevice = { connect: (o: { params: Record<string, string> }) => Promise<TwilioCall>; destroy: () => void };

function friendlyError(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: number };
  if (err?.name === "NotAllowedError" || /permission|microphone|getUserMedia/i.test(err?.message ?? "")) {
    return "Your browser blocked the microphone. Allow microphone access for this site and try again.";
  }
  if (err?.name === "NotFoundError") return "No microphone or headset was found. Plug in your headset and try again.";
  return err?.message || "The call could not be placed.";
}

export function CallProvider({ children }: { children: ReactNode }) {
  const role = useProfileRole();
  const canCall = role.data === "owner";
  const qc = useQueryClient();
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState("");
  const deviceRef = useRef<TwilioDevice | null>(null);
  const callRef = useRef<TwilioCall | null>(null);
  const setCallNote = useSetCallNote();

  useEffect(() => {
    if (active?.phase !== "in-call") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active?.phase]);

  const cleanup = useCallback(() => {
    callRef.current = null;
    deviceRef.current?.destroy();
    deviceRef.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const startCall = useCallback(async (target: CallTarget) => {
    if (!canCall) return;
    if (callRef.current) { toast.error("Finish the current call first"); return; }
    try {
      // Ask for the microphone first so a blocked microphone is explained before anything is dialled.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      const prepared = await prepareCall(target);
      setNote("");
      setActive({ target, callTargetId: prepared.call_target_id, masked: prepared.masked_number, phase: "connecting",
        startedAt: null, muted: false });
      const [{ Device }, token] = await Promise.all([import("@twilio/voice-sdk"), fetchVoiceToken()]);
      const device = new Device(token, { logLevel: "error" }) as unknown as TwilioDevice;
      deviceRef.current = device;
      const call = await device.connect({ params: { callTarget: prepared.call_target_id } });
      callRef.current = call;
      call.on("ringing", () => setActive((a) => (a ? { ...a, phase: "ringing" } : a)));
      call.on("accept", () => setActive((a) => (a ? { ...a, phase: "in-call", startedAt: Date.now() } : a)));
      const end = () => {
        setActive((a) => (a ? { ...a, phase: "ended" } : a));
        cleanup();
        qc.invalidateQueries({ queryKey: ["crm-calls"] });
      };
      call.on("disconnect", end);
      call.on("cancel", end);
      call.on("reject", end);
      call.on("error", (e) => { toast.error(friendlyError(e)); end(); });
    } catch (e) {
      cleanup();
      setActive(null);
      toast.error(friendlyError(e));
    }
  }, [canCall, cleanup, qc]);

  const hangUp = () => { callRef.current?.disconnect(); };
  const toggleMute = () => {
    if (!active) return;
    const next = !active.muted;
    callRef.current?.mute(next);
    setActive((a) => (a ? { ...a, muted: next } : a));
  };
  const close = () => { cleanup(); setActive(null); };
  const saveNote = async () => {
    if (!active || !note.trim()) { close(); return; }
    try {
      await setCallNote.mutateAsync({ callTargetId: active.callTargetId, note: note.trim() });
      toast.success("Call note saved");
      close();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const seconds = active?.startedAt ? Math.floor((now - active.startedAt) / 1000) : 0;
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <CallContext.Provider value={{ canCall, busy: Boolean(active), startCall }}>
      {children}
      {active ? (
        <div role="dialog" aria-label={`Call with ${active.target.name}`}
          className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl border border-border bg-white p-4 shadow-2xl print:hidden">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-brand-navy">{active.target.name}</p>
              <p className="text-xs text-muted-foreground">{active.masked}</p>
            </div>
            {active.phase === "ended" ? (
              <button type="button" onClick={close} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            ) : null}
          </div>
          {active.phase !== "ended" ? (
            <>
              <p className="mt-3 flex items-center gap-2 text-sm text-brand-navy">
                {active.phase === "in-call" ? <Phone className="h-4 w-4 text-green-600" aria-hidden="true" />
                  : <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {active.phase === "connecting" ? "Connecting…" : active.phase === "ringing" ? "Ringing…" : `In call · ${timer}`}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={toggleMute} disabled={active.phase !== "in-call"}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50">
                  {active.muted ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                  {active.muted ? "Unmute" : "Mute"}
                </button>
                <button type="button" onClick={hangUp}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700">
                  <PhoneOff className="h-4 w-4" aria-hidden="true" /> Hang up
                </button>
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-brand-navy">Call ended. Log this call?</p>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
                aria-label="What was discussed" placeholder="What was discussed, what happens next"
                className="w-full rounded-md border border-input px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveNote()} disabled={setCallNote.isPending}
                  className="flex-1 rounded-lg bg-brand-teal px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  Save note
                </button>
                <button type="button" onClick={close} className="rounded-lg border border-border px-3 py-2 text-sm text-brand-navy hover:bg-slate-50">
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </CallContext.Provider>
  );
}
