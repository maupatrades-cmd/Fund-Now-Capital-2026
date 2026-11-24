import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { MeetContext, type MeetContextValue } from "@/components/meet/meetContext";
import { useSession } from "@/lib/useSession";
import { useProfileRole } from "@/hooks/useProfileRole";
import { answerCall, endCall, getIceServers, startCall } from "@/hooks/useMeet";
import {
  MEET_PRESENCE_TOPIC, RING_TIMEOUT_MS, callTopic, formatDuration, isForMe, mediaErrorText, parseSignal,
  type SignalMessage,
} from "@/lib/meet/signal";
import {
  acceptAnswer, acceptOffer, addCandidate, createPeer, makeOffer, setOutgoingAudio, setOutgoingVideo, stopStream,
  type PeerHandle,
} from "@/lib/meet/peer";

// In-CRM calls (owner, 24 Nov 2026): one provider for the whole app. It keeps the online list (Realtime presence),
// rings the callee wherever they are in the CRM (postgres_changes on meet_calls, limited by RLS to their own rows), and
// runs the 1:1 call (WebRTC peer to peer; signalling on the private channel meet:call:<id>). Nothing is recorded.

type Phase = "calling" | "ringing" | "connecting" | "connected";
type ActiveCall = {
  id: string; otherId: string; otherName: string; video: boolean; role: "caller" | "callee"; phase: Phase;
  connectedAt?: number;
};
type Incoming = { id: string; callerId: string; callerName: string; video: boolean };

const MEET_ROLES = new Set(["owner", "administrator", "coordinator", "switchboard", "hr", "field_supervisor", "field_consultant",
  "partner", "contractor", "lead_referrer"]);

export function MeetProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const me = session?.user.id ?? null;
  const { data: role } = useProfileRole();
  const enabled = Boolean(me && role && MEET_ROLES.has(role));

  const [online, setOnline] = useState<Set<string>>(new Set());
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [tick, setTick] = useState(0);

  const activeRef = useRef<ActiveCall | null>(null);
  activeRef.current = active;
  const peerRef = useRef<PeerHandle | null>(null);
  // One connection per call even when several signalling messages arrive at once.
  const peerPromise = useRef<Promise<PeerHandle> | null>(null);
  const chanRef = useRef<RealtimeChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const localVideo = useRef<HTMLVideoElement | null>(null);

  // --- presence --------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || !me) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase.channel(MEET_PRESENCE_TOPIC, { config: { private: true, presence: { key: me } } });
      channel
        .on("presence", { event: "sync" }, () => setOnline(new Set(Object.keys(channel?.presenceState() ?? {}))))
        .subscribe((status) => { if (status === "SUBSCRIBED") void channel?.track({ at: Date.now() }); });
    })();
    return () => { cancelled = true; if (channel) void supabase.removeChannel(channel); };
  }, [enabled, me]);

  // --- teardown ------------------------------------------------------------------------------------------------------
  const cleanup = useCallback((message?: string) => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    peerPromise.current = null;
    stopStream(localRef.current);
    localRef.current = null;
    if (chanRef.current) void supabase.removeChannel(chanRef.current);
    chanRef.current = null;
    setActive(null);
    setMuted(false);
    setCameraOn(false);
    if (message) toast(message);
  }, []);

  const send = useCallback((msg: Omit<SignalMessage, "from">) => {
    if (!chanRef.current || !me) return;
    void chanRef.current.send({ type: "broadcast", event: "signal", payload: { ...msg, from: me } });
  }, [me]);

  const attachRemote = useCallback((stream: MediaStream) => {
    if (remoteAudio.current && remoteAudio.current.srcObject !== stream) remoteAudio.current.srcObject = stream;
    if (remoteVideo.current && remoteVideo.current.srcObject !== stream) remoteVideo.current.srcObject = stream;
  }, []);

  const newPeer = useCallback(async () => {
    const ice = await getIceServers();
    const handle = createPeer(ice, send, attachRemote, (state) => {
      if (state === "connected") setActive((a) => (a ? { ...a, phase: "connected", connectedAt: a.connectedAt ?? Date.now() } : a));
      if (state === "failed") {
        const a = activeRef.current;
        if (a) void endCall(a.id).catch(() => {});
        cleanup("The call dropped (network). Try again, or ask the Director to switch on the call relay.");
      }
    });
    peerRef.current = handle;
    return handle;
  }, [attachRemote, cleanup, send]);

  const ensurePeer = useCallback(() => {
    if (!peerPromise.current) peerPromise.current = newPeer();
    return peerPromise.current;
  }, [newPeer]);

  const localTracks = () => ({
    audio: localRef.current?.getAudioTracks()[0] ?? null,
    video: localRef.current?.getVideoTracks()[0] ?? null,
  });

  // --- signalling channel for one call -----------------------------------------------------------------------------
  const openCallChannel = useCallback(async (callId: string, onSubscribed?: () => void) => {
    await supabase.realtime.setAuth();
    const channel = supabase.channel(callTopic(callId), { config: { private: true, broadcast: { self: false } } });
    channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const msg = parseSignal(payload);
      const a = activeRef.current;
      if (!msg || !me || !a || a.id !== callId || !isForMe(msg, me) || msg.from !== a.otherId) return;
      try {
        if (msg.kind === "ready" && a.role === "caller") {
          if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
          setActive((x) => (x ? { ...x, phase: "connecting" } : x));
          const h = await ensurePeer();
          const { audio, video } = localTracks();
          send({ kind: "offer", sdp: await makeOffer(h, audio, video) });
        } else if (msg.kind === "offer" && msg.sdp) {
          const h = await ensurePeer();
          const { audio, video } = localTracks();
          send({ kind: "answer", sdp: await acceptOffer(h, msg.sdp, audio, video) });
        } else if (msg.kind === "answer" && msg.sdp && peerPromise.current) {
          await acceptAnswer(await peerPromise.current, msg.sdp);
        } else if (msg.kind === "ice") {
          await addCandidate(await ensurePeer(), msg.candidate);
        } else if (msg.kind === "hangup") {
          cleanup(`${a.otherName} ended the call`);
        }
      } catch {
        cleanup("The call could not be connected. Try again.");
      }
    });
    channel.subscribe((status) => { if (status === "SUBSCRIBED") onSubscribed?.(); });
    chanRef.current = channel;
  }, [cleanup, me, ensurePeer, send]);

  const getMedia = async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video });
    localRef.current = stream;
    setCameraOn(video && stream.getVideoTracks().length > 0);
    return stream;
  };

  // --- placing a call --------------------------------------------------------------------------------------------
  const call = useCallback(async (profileId: string, name: string, video = false) => {
    if (!enabled) { toast.error("Calls are not available for your account."); return; }
    if (activeRef.current) { toast.error("You are already in a call."); return; }
    try {
      await getMedia(video);
    } catch (e) {
      toast.error(mediaErrorText(e));
      return;
    }
    let id: string;
    try {
      id = await startCall(profileId, video);
    } catch (e) {
      stopStream(localRef.current);
      localRef.current = null;
      toast.error(e instanceof Error ? e.message : "Could not start the call");
      return;
    }
    setActive({ id, otherId: profileId, otherName: name, video, role: "caller", phase: "calling" });
    await openCallChannel(id);
    timeoutRef.current = window.setTimeout(() => {
      const a = activeRef.current;
      if (a && a.id === id && a.phase === "calling") {
        void endCall(id).catch(() => {});
        cleanup(`${name} did not answer. They will see a missed call.`);
      }
    }, RING_TIMEOUT_MS);
  }, [cleanup, enabled, openCallChannel]);

  // --- receiving a call ------------------------------------------------------------------------------------------
  const answer = useCallback(async () => {
    const inc = incoming;
    if (!inc) return;
    setIncoming(null);
    try {
      await getMedia(inc.video);
    } catch (e) {
      toast.error(mediaErrorText(e));
      void answerCall(inc.id, false).catch(() => {});
      return;
    }
    try {
      const status = await answerCall(inc.id, true);
      if (status !== "answered") { stopStream(localRef.current); localRef.current = null; toast("That call has already ended."); return; }
    } catch (e) {
      stopStream(localRef.current);
      localRef.current = null;
      toast.error(e instanceof Error ? e.message : "Could not answer the call");
      return;
    }
    setActive({ id: inc.id, otherId: inc.callerId, otherName: inc.callerName, video: inc.video, role: "callee", phase: "connecting" });
    await openCallChannel(inc.id, () => send({ kind: "ready" }));
  }, [incoming, openCallChannel, send]);

  const decline = useCallback(() => {
    if (!incoming) return;
    void answerCall(incoming.id, false).catch(() => {});
    setIncoming(null);
  }, [incoming]);

  useEffect(() => {
    if (!enabled || !me) return;
    const nameOf = async (id: string) => {
      const { data } = await supabase.rpc("meet_people", { p_query: null });
      return ((data as { profile_id: string; name: string }[] | null) ?? []).find((p) => p.profile_id === id)?.name ?? "Someone";
    };
    const channel = supabase
      .channel(`meet-calls:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "meet_calls", filter: `callee_id=eq.${me}` },
        async (p) => {
          const row = p.new as { id: string; caller_id: string; video: boolean; status: string; started_at: string };
          if (row.status !== "ringing" || Date.now() - new Date(row.started_at).getTime() > RING_TIMEOUT_MS) return;
          if (activeRef.current) { void answerCall(row.id, false).catch(() => {}); return; } // busy
          setIncoming({ id: row.id, callerId: row.caller_id, callerName: await nameOf(row.caller_id), video: row.video });
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meet_calls", filter: `callee_id=eq.${me}` },
        (p) => {
          const row = p.new as { id: string; status: string };
          if (row.status !== "ringing") setIncoming((inc) => (inc && inc.id === row.id ? null : inc));
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meet_calls", filter: `caller_id=eq.${me}` },
        (p) => {
          const row = p.new as { id: string; status: string };
          const a = activeRef.current;
          if (a && a.id === row.id && a.phase === "calling" && (row.status === "declined" || row.status === "missed")) {
            cleanup(row.status === "declined" ? `${a.otherName} declined the call` : `${a.otherName} did not answer`);
          }
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [cleanup, enabled, me]);

  // Ring-out: the callee's overlay disappears by itself after the ring timeout.
  useEffect(() => {
    if (!incoming) return;
    const t = window.setTimeout(() => setIncoming(null), RING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [incoming]);

  // Timer + device lists while in a call.
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    void navigator.mediaDevices?.enumerateDevices?.().then((all) => {
      setMics(all.filter((d) => d.kind === "audioinput"));
      setSpeakers(all.filter((d) => d.kind === "audiooutput"));
    });
    return () => window.clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = localRef.current;
  }, [cameraOn, active]);

  const hangUp = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    send({ kind: "hangup" });
    void endCall(a.id).catch(() => {});
    cleanup();
  }, [cleanup, send]);

  const toggleMute = () => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  };

  const toggleCamera = async () => {
    const stream = localRef.current;
    if (!stream) return;
    const current = stream.getVideoTracks()[0];
    if (current) {
      current.stop();
      stream.removeTrack(current);
      if (peerRef.current) await setOutgoingVideo(peerRef.current.pc, null);
      setCameraOn(false);
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0];
      stream.addTrack(track);
      if (peerRef.current) await setOutgoingVideo(peerRef.current.pc, track);
      setCameraOn(true);
    } catch (e) {
      toast.error(mediaErrorText(e));
    }
  };

  const chooseMic = async (deviceId: string) => {
    const stream = localRef.current;
    if (!stream) return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const track = fresh.getAudioTracks()[0];
      track.enabled = !muted;
      stream.getAudioTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      stream.addTrack(track);
      if (peerRef.current) await setOutgoingAudio(peerRef.current.pc, track);
    } catch (e) {
      toast.error(mediaErrorText(e));
    }
  };

  const chooseSpeaker = async (deviceId: string) => {
    const el = remoteAudio.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId) await el.setSinkId(deviceId).catch(() => toast.error("This browser cannot switch speakers."));
  };

  const value = useMemo<MeetContextValue>(() => ({ enabled, online, inCall: Boolean(active), call }), [enabled, online, active, call]);
  void tick;
  const elapsed = active?.connectedAt ? Math.floor((Date.now() - active.connectedAt) / 1000) : null;

  return (
    <MeetContext.Provider value={value}>
      {children}
      <audio ref={remoteAudio} autoPlay playsInline className="hidden" />
      {incoming ? (
        <div role="alertdialog" aria-label={`Incoming call from ${incoming.callerName}`}
          className="fixed inset-x-0 top-4 z-[100] mx-auto w-[min(26rem,calc(100%-2rem))] rounded-2xl bg-brand-navy p-4 text-white shadow-2xl">
          <p className="text-xs uppercase tracking-wide text-white/70">Incoming {incoming.video ? "video" : "voice"} call</p>
          <p className="mt-1 text-lg font-bold">{incoming.callerName}</p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => void answer()}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#5dba5d] font-semibold">
              <Phone className="h-4 w-4" aria-hidden="true" /> Answer
            </button>
            <button type="button" onClick={decline}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 font-semibold">
              <PhoneOff className="h-4 w-4" aria-hidden="true" /> Decline
            </button>
          </div>
        </div>
      ) : null}
      {active ? (
        <div role="dialog" aria-label={`Call with ${active.otherName}`}
          className="fixed bottom-4 right-4 z-[90] w-[min(22rem,calc(100%-2rem))] rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-slate-200">
          <div className={active.video || cameraOn ? "relative mb-2 aspect-video overflow-hidden rounded-xl bg-slate-900" : "hidden"}>
            <video ref={remoteVideo} autoPlay playsInline className="h-full w-full object-cover" />
            <video ref={localVideo} autoPlay playsInline muted
              className={cameraOn ? "absolute bottom-2 right-2 h-16 w-24 rounded-lg object-cover ring-2 ring-white" : "hidden"} />
          </div>
          <p className="font-semibold text-brand-navy">{active.otherName}</p>
          <p className="text-xs text-slate-500">
            {active.phase === "calling" ? "Calling…" : active.phase === "connecting" ? "Connecting…" : `Connected · ${formatDuration(elapsed)}`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleMute} aria-pressed={muted}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-brand-navy" aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => void toggleCamera()} aria-pressed={cameraOn}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-brand-navy" aria-label={cameraOn ? "Camera off" : "Camera on"}>
              {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
            <button type="button" onClick={hangUp}
              className="ml-auto flex h-10 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold text-white">
              <PhoneOff className="h-4 w-4" aria-hidden="true" /> Hang up
            </button>
          </div>
          {mics.length > 1 || speakers.length > 1 ? (
            <div className="mt-2 grid gap-1 text-xs">
              {mics.length > 1 ? (
                <label className="flex items-center gap-2">Microphone
                  <select className="min-w-0 flex-1 rounded border px-1 py-1" onChange={(e) => void chooseMic(e.target.value)}>
                    {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
                  </select>
                </label>
              ) : null}
              {speakers.length > 1 ? (
                <label className="flex items-center gap-2">Speaker
                  <select className="min-w-0 flex-1 rounded border px-1 py-1" onChange={(e) => void chooseSpeaker(e.target.value)}>
                    {speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </MeetContext.Provider>
  );
}
