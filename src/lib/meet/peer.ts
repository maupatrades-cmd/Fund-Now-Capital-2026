// WebRTC plumbing shared by 1:1 calls and meetings. Every connection always carries one audio and one video
// transceiver, so turning the camera on/off or sharing the screen is a track swap (replaceTrack) and never needs a new
// offer. Candidates that arrive before the remote description are queued.
import type { SignalMessage } from "@/lib/meet/signal";

export type PeerHandle = {
  pc: RTCPeerConnection;
  remote: MediaStream;
  pending: RTCIceCandidateInit[];
  close: () => void;
};

export function createPeer(
  iceServers: RTCIceServer[],
  send: (msg: Omit<SignalMessage, "from">) => void,
  onRemote: (stream: MediaStream) => void,
  onState: (state: RTCPeerConnectionState) => void,
): PeerHandle {
  const pc = new RTCPeerConnection({ iceServers });
  const remote = new MediaStream();
  pc.onicecandidate = (e) => send({ kind: "ice", candidate: e.candidate ? e.candidate.toJSON() : null });
  pc.ontrack = (e) => {
    if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
    onRemote(remote);
  };
  pc.onconnectionstatechange = () => onState(pc.connectionState);
  return { pc, remote, pending: [], close: () => { try { pc.close(); } catch { /* already closed */ } } };
}

// Put this browser's current audio/video (or nothing) on every transceiver and make them send+receive.
export async function attachLocal(pc: RTCPeerConnection, audio: MediaStreamTrack | null, video: MediaStreamTrack | null) {
  for (const t of pc.getTransceivers()) {
    const kind = t.receiver.track?.kind;
    if (kind === "audio") await t.sender.replaceTrack(audio);
    if (kind === "video") await t.sender.replaceTrack(video);
    t.direction = "sendrecv";
  }
}

export async function makeOffer(h: PeerHandle, audio: MediaStreamTrack | null, video: MediaStreamTrack | null) {
  if (h.pc.getTransceivers().length === 0) {
    h.pc.addTransceiver("audio", { direction: "sendrecv" });
    h.pc.addTransceiver("video", { direction: "sendrecv" });
  }
  await attachLocal(h.pc, audio, video);
  const offer = await h.pc.createOffer();
  await h.pc.setLocalDescription(offer);
  return h.pc.localDescription!.toJSON() as RTCSessionDescriptionInit;
}

export async function acceptOffer(h: PeerHandle, sdp: RTCSessionDescriptionInit, audio: MediaStreamTrack | null,
  video: MediaStreamTrack | null) {
  await h.pc.setRemoteDescription(sdp);
  await flushCandidates(h);
  await attachLocal(h.pc, audio, video);
  const answer = await h.pc.createAnswer();
  await h.pc.setLocalDescription(answer);
  return h.pc.localDescription!.toJSON() as RTCSessionDescriptionInit;
}

export async function acceptAnswer(h: PeerHandle, sdp: RTCSessionDescriptionInit) {
  if (h.pc.signalingState !== "have-local-offer") return;
  await h.pc.setRemoteDescription(sdp);
  await flushCandidates(h);
}

export async function addCandidate(h: PeerHandle, candidate: RTCIceCandidateInit | null | undefined) {
  if (!candidate) return;
  if (!h.pc.remoteDescription) { h.pending.push(candidate); return; }
  try { await h.pc.addIceCandidate(candidate); } catch { /* stale candidate: ignore */ }
}

async function flushCandidates(h: PeerHandle) {
  const queued = h.pending.splice(0);
  for (const c of queued) { try { await h.pc.addIceCandidate(c); } catch { /* ignore */ } }
}

// Swap the outgoing video (camera, screen or none) on a connection.
export async function setOutgoingVideo(pc: RTCPeerConnection, track: MediaStreamTrack | null) {
  for (const t of pc.getTransceivers()) if (t.receiver.track?.kind === "video") await t.sender.replaceTrack(track);
}
export async function setOutgoingAudio(pc: RTCPeerConnection, track: MediaStreamTrack | null) {
  for (const t of pc.getTransceivers()) if (t.receiver.track?.kind === "audio") await t.sender.replaceTrack(track);
}

export function stopStream(s: MediaStream | null | undefined) {
  s?.getTracks().forEach((t) => t.stop());
}
