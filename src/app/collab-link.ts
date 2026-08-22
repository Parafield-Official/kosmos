const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;

function waitForIce(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onChange = () => {
      if (connection.iceGatheringState === "complete") {
        connection.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

export function closeCollabLink(): void {
  channel?.close();
  peer?.close();
  channel = null;
  peer = null;
}

export async function createHostOffer(): Promise<string> {
  closeCollabLink();
  peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  channel = peer.createDataChannel("kosmos", { ordered: true });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIce(peer);
  return peer.localDescription?.sdp ?? "";
}

export async function acceptHostOffer(offerSdp: string): Promise<string> {
  closeCollabLink();
  peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
