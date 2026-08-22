/**
 * Public STUN first. If main mints Cloudflare TURN, hotel / hotspot
 * can fall through to the locker. iceTransportPolicy stays "all".
 * The long-lived TURN key never lives in the renderer.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const ICE_GATHER_MS = 12_000;
const ICE_CONNECT_MS = 20_000;
const REACH_FAIL = "Couldn't reach them. Check the invite wasn't cut off, then try again.";

let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let connectionWatch: (() => void) | null = null;

function waitForIce(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (connection.iceGatheringState === "complete") {
        finish();
      }
    };
    const timer = setTimeout(finish, ICE_GATHER_MS);
    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

export function closeCollabLink(): void {
  connectionWatch?.();
  connectionWatch = null;
  channel?.close();
  peer?.close();
  channel = null;
  peer = null;
}

export async function createHostOffer(iceServers: RTCIceServer[] = ICE_SERVERS): Promise<string> {
  closeCollabLink();
  peer = new RTCPeerConnection({ iceServers });
  channel = peer.createDataChannel("kosmos", { ordered: true });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIce(peer);
  return peer.localDescription?.sdp ?? "";
}

export async function acceptHostOffer(offerSdp: string, iceServers: RTCIceServer[] = ICE_SERVERS): Promise<string> {
  closeCollabLink();
  peer = new RTCPeerConnection({ iceServers });
  await peer.setRemoteDescription({ type: "offer", sdp: offerSdp });
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await waitForIce(peer);
  return peer.localDescription?.sdp ?? "";
}

export async function acceptGuestAnswer(answerSdp: string): Promise<void> {
  if (!peer) {
    throw new Error("Create an invite first");
  }
  await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

export function watchCollabConnection(onFailed: (message: string) => void): void {
  if (!peer) {
    return;
  }
  connectionWatch?.();
  const connection = peer;
  const onState = () => {
    const state = connection.iceConnectionState;
    if (state === "failed") {
      onFailed(REACH_FAIL);
    }
  };
  const timer = setTimeout(() => {
    const state = connection.iceConnectionState;
    if (state !== "connected" && state !== "completed") {
      onFailed(REACH_FAIL);
    }
  }, ICE_CONNECT_MS);
  connection.addEventListener("iceconnectionstatechange", onState);
  connectionWatch = () => {
    clearTimeout(timer);
    connection.removeEventListener("iceconnectionstatechange", onState);
  };
}

export function bindCollabChannel(handlers: {
  onOpen: () => void;
  onMessage: (text: string) => void;
  onClose: () => void;
}): void {
  if (!peer) {
    throw new Error("No connection is open");
  }
  const attach = (dataChannel: RTCDataChannel) => {
    channel = dataChannel;
    dataChannel.onopen = () => handlers.onOpen();
    dataChannel.onmessage = (event) => handlers.onMessage(String(event.data));
    dataChannel.onclose = () => handlers.onClose();
  };
  if (channel) {
    attach(channel);
    if (channel.readyState === "open") {
      handlers.onOpen();
    }
  }
  peer.ondatachannel = (event) => attach(event.channel);
}

export function sendCollabFrame(text: string): void {
  if (channel?.readyState === "open") {
    channel.send(text);
  }
}
