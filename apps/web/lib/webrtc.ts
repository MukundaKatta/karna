import { getWSClient, type WSClient, type WSMessageHandler } from "./ws";

export type RTCSignalType = "rtc.offer" | "rtc.answer" | "rtc.ice-candidate" | "rtc.hangup";

type RTCSignalMessage = {
  id?: string;
  type: RTCSignalType;
  timestamp?: number;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

type RTCSignalDescription = {
  type: "offer" | "answer";
  sdp: string;
};

type RTCSignalCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type RTCPeerConnectionLike = {
  onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  connectionState?: string;
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): void;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate?: RTCIceCandidateInit): Promise<void>;
  close(): void;
};

type PeerConnectionFactory = () => RTCPeerConnectionLike;
type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export type WebRTCSessionState =
  | "idle"
  | "requesting-media"
  | "negotiating"
  | "connected"
  | "ended"
  | "error";

export class WebRTCVoiceSession {
  private ws: WSClient;
  private createPeerConnection: PeerConnectionFactory;
  private getUserMedia: GetUserMedia;
  private peerConnection: RTCPeerConnectionLike | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private targetChannelId: string | null = null;
  private state: WebRTCSessionState = "idle";
  private stateHandlers = new Set<(state: WebRTCSessionState) => void>();
  private remoteStreamHandlers = new Set<(stream: MediaStream) => void>();
  private unsubscribeMessage: (() => void) | null = null;

  constructor(options?: {
    wsClient?: WSClient;
    peerConnectionFactory?: PeerConnectionFactory;
    getUserMedia?: GetUserMedia;
  }) {
    this.ws = options?.wsClient ?? getWSClient();
    this.createPeerConnection =
      options?.peerConnectionFactory ??
      (() => new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }));
    this.getUserMedia =
      options?.getUserMedia ??
      ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  }

  get currentState(): WebRTCSessionState {
    return this.state;
  }

  get currentTargetChannelId(): string | null {
    return this.targetChannelId;
  }

  onStateChange(handler: (state: WebRTCSessionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onRemoteStream(handler: (stream: MediaStream) => void): () => void {
    this.remoteStreamHandlers.add(handler);
    return () => this.remoteStreamHandlers.delete(handler);
  }

  async startCall(targetChannelId: string): Promise<void> {
    this.targetChannelId = targetChannelId;
    this.setState("requesting-media");
    await this.ensurePeerConnection();

    const offer = await this.peerConnection!.createOffer();
    await this.peerConnection!.setLocalDescription(offer);
    this.setState("negotiating");

    this.sendSignal("rtc.offer", {
      targetChannelId,
      description: {
        type: "offer",
        sdp: offer.sdp ?? "",
      },
    });
  }

  async handleSignal(message: RTCSignalMessage): Promise<void> {
    const payload = message.payload ?? {};

    switch (message.type) {
      case "rtc.offer":
        await this.handleOffer(payload);
        break;
      case "rtc.answer":
        await this.handleAnswer(payload);
        break;
      case "rtc.ice-candidate":
        await this.handleIceCandidate(payload);
        break;
      case "rtc.hangup":
        this.endCall(false);
        break;
    }
  }

  listen(): void {
    if (this.unsubscribeMessage) return;

    const handler: WSMessageHandler = (data) => {
      const message = data as RTCSignalMessage;
      if (!message?.type || !message.type.startsWith("rtc.")) return;
      void this.handleSignal(message);
    };

    this.unsubscribeMessage = this.ws.onMessage(handler);
  }

  endCall(notifyPeer = true): void {
    if (notifyPeer && this.targetChannelId) {
      this.sendSignal("rtc.hangup", {
        targetChannelId: this.targetChannelId,
      });
    }

    this.peerConnection?.close();
    this.peerConnection = null;
    this.remoteStream = null;
    this.targetChannelId = null;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.setState("ended");
  }

  destroy(): void {
    this.endCall(false);
    this.unsubscribeMessage?.();
    this.unsubscribeMessage = null;
    this.stateHandlers.clear();
    this.remoteStreamHandlers.clear();
  }

  private async handleOffer(payload: Record<string, unknown>): Promise<void> {
    const targetChannelId = payload.sourceChannelId;
    const description = payload.description as RTCSignalDescription | undefined;

    if (typeof targetChannelId !== "string" || !description?.sdp) {
      throw new Error("Invalid RTC offer payload");
    }

    this.targetChannelId = targetChannelId;
    this.setState("requesting-media");
    await this.ensurePeerConnection();
    await this.peerConnection!.setRemoteDescription(description);

    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);
    this.setState("negotiating");

    this.sendSignal("rtc.answer", {
      targetChannelId,
      description: {
        type: "answer",
        sdp: answer.sdp ?? "",
      },
    });
  }

  private async handleAnswer(payload: Record<string, unknown>): Promise<void> {
    const description = payload.description as RTCSignalDescription | undefined;
    if (!description?.sdp || !this.peerConnection) {
      throw new Error("Invalid RTC answer payload");
    }

    await this.peerConnection.setRemoteDescription(description);
    this.setState("connected");
  }

  private async handleIceCandidate(payload: Record<string, unknown>): Promise<void> {
    const candidate = payload.candidate as RTCSignalCandidate | undefined;
    if (!candidate?.candidate || !this.peerConnection) return;

    await this.peerConnection.addIceCandidate(candidate);
  }

  private async ensurePeerConnection(): Promise<void> {
    if (this.peerConnection) return;

    this.localStream = await this.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });

    const peer = this.createPeerConnection();

    this.localStream.getTracks().forEach((track) => {
      peer.addTrack(track, this.localStream!);
    });

    peer.onicecandidate = (event) => {
      if (!event.candidate || !this.targetChannelId) return;
      this.sendSignal("rtc.ice-candidate", {
        targetChannelId: this.targetChannelId,
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        },
      });
    };

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      this.remoteStream = stream;
      this.remoteStreamHandlers.forEach((handler) => handler(stream));
      this.setState("connected");
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        this.setState("connected");
      } else if (
        peer.connectionState === "disconnected" ||
        peer.connectionState === "failed" ||
        peer.connectionState === "closed"
      ) {
        this.setState("ended");
      }
    };

    this.peerConnection = peer;
  }

  private sendSignal(type: RTCSignalType, payload: Record<string, unknown>): void {
    this.ws.send({
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      sessionId: this.ws.currentSessionId ?? undefined,
      payload,
    });
  }

  private setState(state: WebRTCSessionState): void {
    this.state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }
}

let webRTCVoiceSessionInstance: WebRTCVoiceSession | null = null;

export function getWebRTCVoiceSession(): WebRTCVoiceSession {
  if (!webRTCVoiceSessionInstance) {
    webRTCVoiceSessionInstance = new WebRTCVoiceSession();
  }

  return webRTCVoiceSessionInstance;
}
