// In-CRM calls and meetings (owner, 24 Nov 2026): pure helpers shared by the call panel and the meeting room, kept free
// of React and Supabase so the node tests can load them. WebRTC signalling messages travel over PRIVATE Supabase Realtime
// broadcast channels; the database (meet_can_use_topic) decides who may join each topic.

export const MEET_PRESENCE_TOPIC = "meet:presence";
export const RING_TIMEOUT_MS = 45_000;
export const MEETING_CAP = 8;

export const callTopic = (callId: string) => `meet:call:${callId}`;
export const roomTopic = (meetingId: string) => `meet:room:${meetingId}`;

// Public STUN works on most networks; a TURN relay (optional, from the meet-ice-servers function) covers strict ones.
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export type SignalKind = "ready" | "offer" | "answer" | "ice" | "hangup" | "media";
export type SignalMessage = {
  kind: SignalKind;
  from: string;
  to?: string | null;              // a meeting message aimed at one peer; null/absent = everyone in the call/room
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
  media?: { audio: boolean; video: boolean; screen: boolean };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly string[] = ["ready", "offer", "answer", "ice", "hangup", "media"];

// A broadcast payload is untrusted input from another browser: accept only the shapes this app sends.
export function parseSignal(payload: unknown): SignalMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.kind !== "string" || !KINDS.includes(p.kind)) return null;
  if (typeof p.from !== "string" || !UUID.test(p.from)) return null;
  if (p.to != null && (typeof p.to !== "string" || !UUID.test(p.to))) return null;
  const msg: SignalMessage = { kind: p.kind as SignalKind, from: p.from, to: (p.to as string | undefined) ?? null };
  if (p.kind === "offer" || p.kind === "answer") {
    const sdp = p.sdp as Record<string, unknown> | undefined;
    if (!sdp || (sdp.type !== "offer" && sdp.type !== "answer") || typeof sdp.sdp !== "string" || sdp.sdp.length > 200_000) return null;
    if (sdp.type !== p.kind) return null;
    msg.sdp = { type: sdp.type, sdp: sdp.sdp };
  }
  if (p.kind === "ice") {
    if (p.candidate === null) msg.candidate = null;
    else {
      const c = p.candidate as Record<string, unknown> | undefined;
      if (!c || typeof c.candidate !== "string" || c.candidate.length > 2_000) return null;
      msg.candidate = {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === "string" ? c.sdpMid : null,
        sdpMLineIndex: typeof c.sdpMLineIndex === "number" ? c.sdpMLineIndex : null,
      };
    }
  }
  if (p.kind === "media") {
    const m = p.media as Record<string, unknown> | undefined;
    if (!m || typeof m.audio !== "boolean" || typeof m.video !== "boolean" || typeof m.screen !== "boolean") return null;
    msg.media = { audio: m.audio, video: m.video, screen: m.screen };
  }
  return msg;
}

// Is this message for me? (meeting messages can be aimed at one peer)
export const isForMe = (msg: SignalMessage, me: string) => msg.from !== me && (!msg.to || msg.to === me);

// In a meeting every pair of browsers connects once: the one with the smaller id makes the offer, so two people never
// offer to each other at the same time.
export const shouldOffer = (me: string, other: string) => me < other;

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

// Plain-language reasons for camera / microphone failures.
export function mediaErrorText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Your browser blocked the microphone or camera. Click the lock icon next to the address, allow them, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone or camera was found. Plug in a headset or check your device.";
  if (name === "NotReadableError") return "Your microphone or camera is in use by another app (for example Teams or Zoom). Close it and try again.";
  return "Could not start your microphone or camera.";
}
