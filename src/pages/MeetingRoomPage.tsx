import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Mic, MicOff, MonitorUp, PhoneOff, Users, Video, VideoOff, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { endMeeting, getIceServers, joinMeeting, leaveMeeting, useMeetMine } from "@/hooks/useMeet";
import { MEETING_CAP, isForMe, mediaErrorText, parseSignal, roomTopic, shouldOffer, type SignalMessage } from "@/lib/meet/signal";
import {
  acceptAnswer, acceptOffer, addCandidate, createPeer, makeOffer, setOutgoingVideo, stopStream, type PeerHandle,
} from "@/lib/meet/peer";

// A CRM meeting room (owner, 24 Nov 2026): every browser connects to every other one (mesh), so a room holds up to 8
// people; bigger meetings would need a media server. Signalling on the private channel meet:room:<id>, which only the
// host and the invitees may join (meet_can_use_topic). Nothing is recorded.

type Tile = { id: string; stream: MediaStream };

function VideoTile({ stream, name, muted, mirror }: { stream: MediaStream | null; name: string; muted?: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  const hasVideo = Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live" && t.enabled));
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800">
      <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""} ${hasVideo ? "" : "opacity-0"}`} />
      {!hasVideo ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-teal text-2xl font-bold text-white">
            {name.slice(0, 1).toUpperCase()}
          </span>
        </div>
      ) : null}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{name}</span>
    </div>
  );
}

export default function MeetingRoomPage() {
  const { meetingId = "" } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const me = session?.user.id ?? "";
  const mine = useMeetMine();
  const meeting = mine.data?.meetings.find((m) => m.id === meetingId);
  const names = new Map((meeting?.participants ?? []).map((p) => [p.profile_id, p.name]));

  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [title, setTitle] = useState("Meeting");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [showPeople, setShowPeople] = useState(false);

  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const peers = useRef(new Map<string, Promise<PeerHandle>>());
  const chanRef = useRef<RealtimeChannel | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const send = useCallback((msg: Omit<SignalMessage, "from">) => {
    void chanRef.current?.send({ type: "broadcast", event: "signal", payload: { ...msg, from: me } });
  }, [me]);

  const dropPeer = useCallback(async (id: string) => {
    const p = peers.current.get(id);
    peers.current.delete(id);
    if (p) (await p).close();
    setTiles((t) => t.filter((x) => x.id !== id));
  }, []);

  const outgoingVideo = () => screenRef.current ?? localRef.current?.getVideoTracks()[0] ?? null;

  const ensurePeer = useCallback((other: string) => {
    let p = peers.current.get(other);
    if (!p) {
      p = getIceServers().then((ice) =>
        createPeer(ice, (m) => send({ ...m, to: other }),
          (stream) => setTiles((t) => (t.some((x) => x.id === other) ? t.map((x) => (x.id === other ? { id: other, stream } : x)) : [...t, { id: other, stream }])),
          (state) => { if (state === "failed" || state === "closed") void dropPeer(other); }));
      peers.current.set(other, p);
    }
    return p;
  }, [dropPeer, send]);

  const leave = useCallback(async (endForAll = false) => {
    if (endForAll) {
      try { await endMeeting(meetingId); send({ kind: "hangup" }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not end the meeting"); return; }
    } else {
      void leaveMeeting(meetingId).catch(() => {});
    }
    for (const id of [...peers.current.keys()]) await dropPeer(id);
    stopStream(localRef.current);
    screenRef.current?.stop();
    if (chanRef.current) void supabase.removeChannel(chanRef.current);
    chanRef.current = null;
    navigate(-1);
  }, [dropPeer, meetingId, navigate, send]);

  useEffect(() => {
    if (!me || !meetingId) return;
    let cancelled = false;
    const peerMap = peers.current;
    (async () => {
      try {
        const info = await joinMeeting(meetingId);
        setIsHost(info.is_host);
        setTitle(info.title);
      } catch (e) {
        setError(e instanceof Error ? e.message : "You cannot join this meeting");
        return;
      }
      try {
        localRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: true });
      } catch {
        try {
          localRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          setCameraOn(false);
        } catch (e) {
          setError(mediaErrorText(e));
          void leaveMeeting(meetingId).catch(() => {});
          return;
        }
      }
      if (cancelled) { stopStream(localRef.current); return; }
      setLocalStream(localRef.current);
      await supabase.realtime.setAuth();
      const channel = supabase.channel(roomTopic(meetingId), { config: { private: true, broadcast: { self: false }, presence: { key: me } } });
      channel
        .on("presence", { event: "sync" }, () => {
          const here = new Set(Object.keys(channel.presenceState()));
          if (here.size > MEETING_CAP) toast.error(`This room holds up to ${MEETING_CAP} people.`);
          for (const other of here) {
            if (other === me || peers.current.has(other) || !shouldOffer(me, other)) continue;
            void ensurePeer(other).then(async (h) => {
              const audio = localRef.current?.getAudioTracks()[0] ?? null;
              send({ kind: "offer", to: other, sdp: await makeOffer(h, audio, outgoingVideo()) });
            });
          }
          for (const id of [...peers.current.keys()]) if (!here.has(id)) void dropPeer(id);
        })
        .on("broadcast", { event: "signal" }, async ({ payload }) => {
          const msg = parseSignal(payload);
          if (!msg || !isForMe(msg, me)) return;
          try {
            if (msg.kind === "offer" && msg.sdp) {
              const h = await ensurePeer(msg.from);
              const audio = localRef.current?.getAudioTracks()[0] ?? null;
              send({ kind: "answer", to: msg.from, sdp: await acceptOffer(h, msg.sdp, audio, outgoingVideo()) });
            } else if (msg.kind === "answer" && msg.sdp && peers.current.has(msg.from)) {
              await acceptAnswer(await peers.current.get(msg.from)!, msg.sdp);
            } else if (msg.kind === "ice") {
              await addCandidate(await ensurePeer(msg.from), msg.candidate);
            } else if (msg.kind === "hangup" && !msg.to) {
              toast("The host ended the meeting.");
              await leave(false);
            }
          } catch { /* one peer failing must not break the room */ }
        })
        .subscribe((status) => { if (status === "SUBSCRIBED") void channel.track({ at: Date.now() }); });
      chanRef.current = channel;
      setJoined(true);
    })();
    return () => {
      cancelled = true;
      for (const p of peerMap.values()) void p.then((h) => h.close());
      peerMap.clear();
      stopStream(localRef.current);
      screenRef.current?.stop();
      if (chanRef.current) void supabase.removeChannel(chanRef.current);
      chanRef.current = null;
      void leaveMeeting(meetingId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, meetingId]);

  const toggleMute = () => {
    const t = localRef.current?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    setMuted(!t.enabled);
  };

  const toggleCamera = async () => {
    const stream = localRef.current;
    if (!stream) return;
    const cam = stream.getVideoTracks()[0];
    if (cam) {
      cam.stop();
      stream.removeTrack(cam);
      setCameraOn(false);
    } else {
      try {
        const fresh = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
        stream.addTrack(fresh);
        setCameraOn(true);
      } catch (e) { toast.error(mediaErrorText(e)); return; }
    }
    if (!screenRef.current) for (const p of peers.current.values()) await setOutgoingVideo((await p).pc, stream.getVideoTracks()[0] ?? null);
    setLocalStream(new MediaStream(stream.getTracks()));
  };

  const toggleShare = async () => {
    if (screenRef.current) {
      screenRef.current.stop();
      screenRef.current = null;
      setSharing(false);
      for (const p of peers.current.values()) await setOutgoingVideo((await p).pc, localRef.current?.getVideoTracks()[0] ?? null);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      screenRef.current = track;
      setSharing(true);
      track.onended = () => { if (screenRef.current === track) void toggleShare(); };
      for (const p of peers.current.values()) await setOutgoingVideo((await p).pc, track);
    } catch {
      toast.error("Screen sharing was cancelled or is not allowed in this browser.");
    }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-white">
        <div className="max-w-md rounded-2xl bg-slate-800 p-6 text-center">
          <XCircle className="mx-auto h-10 w-10 text-red-400" aria-hidden="true" />
          <p className="mt-3 font-semibold">{error}</p>
          <button type="button" onClick={() => navigate(-1)} className="mt-5 rounded-xl bg-brand-teal px-5 py-2 font-semibold">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-xs text-white/60">{joined ? `${tiles.length + 1} in the room · up to ${MEETING_CAP}` : "Joining…"}</p>
        </div>
        <button type="button" onClick={() => setShowPeople((v) => !v)} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm">
          <Users className="h-4 w-4" aria-hidden="true" /> People
        </button>
      </header>
      <div className="flex flex-1 gap-3 px-4 pb-24">
        <div className={`grid flex-1 content-start gap-3 ${tiles.length === 0 ? "grid-cols-1 sm:max-w-2xl sm:mx-auto" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          <VideoTile stream={localStream} name={`You${sharing ? " (sharing screen)" : ""}`} muted mirror={!sharing} />
          {tiles.map((t) => <VideoTile key={t.id} stream={t.stream} name={names.get(t.id) ?? "Participant"} />)}
          {joined && tiles.length === 0 ? <p className="text-center text-sm text-white/60">Waiting for others to join…</p> : null}
        </div>
        {showPeople ? (
          <aside className="hidden w-60 shrink-0 rounded-xl bg-white/5 p-3 text-sm sm:block">
            <p className="mb-2 font-semibold">Invited</p>
            <ul className="space-y-1">
              {(meeting?.participants ?? []).map((p) => (
                <li key={p.profile_id} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${p.profile_id === me || tiles.some((t) => t.id === p.profile_id) ? "bg-[#5dba5d]" : "bg-slate-500"}`} />
                  <span className="truncate">{p.name}{p.is_host ? " (host)" : ""}</span>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
      <footer className="fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-3 bg-slate-950/90 px-4 py-3">
        <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">{muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>
        <button type="button" onClick={() => void toggleCamera()} aria-pressed={cameraOn} aria-label={cameraOn ? "Camera off" : "Camera on"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">{cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</button>
        <button type="button" onClick={() => void toggleShare()} aria-pressed={sharing} aria-label={sharing ? "Stop sharing" : "Share screen"}
          className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm ${sharing ? "bg-brand-teal" : "bg-white/10"}`}>
          <MonitorUp className="h-5 w-5" aria-hidden="true" /> <span className="hidden sm:inline">{sharing ? "Stop sharing" : "Share screen"}</span>
        </button>
        <button type="button" onClick={() => void leave(false)} className="flex h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold">
          <PhoneOff className="h-5 w-5" aria-hidden="true" /> Leave
        </button>
        {isHost ? (
          <button type="button" onClick={() => { if (window.confirm("End the meeting for everyone?")) void leave(true); }}
            className="h-11 rounded-full border border-red-400 px-4 text-sm font-semibold text-red-300">End for all</button>
        ) : null}
      </footer>
    </div>
  );
}
