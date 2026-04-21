import { gatewayClient } from './gateway-client';

type ProtocolMessage = {
  type: string;
  id?: string;
  timestamp?: number;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

type SignalType = 'rtc.offer' | 'rtc.answer' | 'rtc.ice-candidate' | 'rtc.hangup';

type SessionDescription = {
  type: 'offer' | 'answer';
  sdp: string;
};

type IceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type PeerConnectionLike = {
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

type PeerFactory = () => PeerConnectionLike;
type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;
type GatewayLike = {
  send(message: ProtocolMessage): void;
  onMessage(handler: (message: ProtocolMessage) => void): () => void;
  getCurrentSessionId(): string | null;
};

export type MobileWebRTCState =
  | 'idle'
  | 'requesting-media'
  | 'negotiating'
  | 'connected'
  | 'ended'
  | 'error';

export class MobileWebRTCSession {
  private gateway: GatewayLike;
  private createPeerConnection: PeerFactory;
  private getUserMedia: GetUserMedia;
  private peerConnection: PeerConnectionLike | null = null;
  private localStream: MediaStream | null = null;
  private targetChannelId: string | null = null;
  private unsubscribeMessage: (() => void) | null = null;
  private state: MobileWebRTCState = 'idle';
  private stateHandlers = new Set<(state: MobileWebRTCState) => void>();
  private remoteStreamHandlers = new Set<(stream: MediaStream) => void>();

  constructor(options?: {
    gateway?: GatewayLike;
    peerConnectionFactory?: PeerFactory;
    getUserMedia?: GetUserMedia;
  }) {
    this.gateway = options?.gateway ?? gatewayClient;
    this.createPeerConnection =
      options?.peerConnectionFactory ??
      (() =>
        new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }) as unknown as PeerConnectionLike);
    this.getUserMedia =
      options?.getUserMedia ??
      ((constraints) => {
        const mediaDevices = globalThis.navigator?.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          throw new Error('Native WebRTC media support is not available');
        }
        return mediaDevices.getUserMedia(constraints);
      });
  }

  get currentState(): MobileWebRTCState {
    return this.state;
  }

  get currentTargetChannelId(): string | null {
    return this.targetChannelId;
  }

  isAvailable(): boolean {
    return (
      typeof globalThis.RTCPeerConnection === 'function' &&
      typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function'
    );
  }

  onStateChange(handler: (state: MobileWebRTCState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onRemoteStream(handler: (stream: MediaStream) => void): () => void {
    this.remoteStreamHandlers.add(handler);
    return () => this.remoteStreamHandlers.delete(handler);
  }

  listen(): void {
    if (this.unsubscribeMessage) return;

    this.unsubscribeMessage = this.gateway.onMessage((message) => {
      if (!message.type.startsWith('rtc.')) return;
      void this.handleSignal(message);
    });
  }

  async startCall(targetChannelId: string): Promise<void> {
    this.targetChannelId = targetChannelId;
    this.setState('requesting-media');
    await this.ensurePeerConnection();

    const offer = await this.peerConnection!.createOffer();
    await this.peerConnection!.setLocalDescription(offer);
    this.setState('negotiating');

    this.sendSignal('rtc.offer', {
      targetChannelId,
      description: {
        type: 'offer',
        sdp: offer.sdp ?? '',
      },
    });
  }

  async handleSignal(message: ProtocolMessage): Promise<void> {
    const payload = message.payload ?? {};

    switch (message.type) {
      case 'rtc.offer':
        await this.handleOffer(payload);
        break;
      case 'rtc.answer':
        await this.handleAnswer(payload);
        break;
      case 'rtc.ice-candidate':
        await this.handleIceCandidate(payload);
        break;
      case 'rtc.hangup':
        this.endCall(false);
        break;
      default:
        break;
    }
  }

  endCall(notifyPeer = true): void {
    if (notifyPeer && this.targetChannelId) {
      this.sendSignal('rtc.hangup', {
        targetChannelId: this.targetChannelId,
      });
    }

    this.peerConnection?.close();
    this.peerConnection = null;
    this.targetChannelId = null;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.setState('ended');
  }

  destroy(): void {
    this.endCall(false);
    this.unsubscribeMessage?.();
    this.unsubscribeMessage = null;
    this.stateHandlers.clear();
    this.remoteStreamHandlers.clear();
  }

  private async handleOffer(payload: Record<string, unknown>): Promise<void> {
    const sourceChannelId = payload.sourceChannelId;
    const description = payload.description as SessionDescription | undefined;

    if (typeof sourceChannelId !== 'string' || !description?.sdp) {
      throw new Error('Invalid RTC offer payload');
    }

    this.targetChannelId = sourceChannelId;
    this.setState('requesting-media');
    await this.ensurePeerConnection();
    await this.peerConnection!.setRemoteDescription(description);

    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);
    this.setState('negotiating');

    this.sendSignal('rtc.answer', {
      targetChannelId: sourceChannelId,
      description: {
        type: 'answer',
        sdp: answer.sdp ?? '',
      },
    });
  }

  private async handleAnswer(payload: Record<string, unknown>): Promise<void> {
    const description = payload.description as SessionDescription | undefined;
    if (!description?.sdp || !this.peerConnection) {
      throw new Error('Invalid RTC answer payload');
    }

    await this.peerConnection.setRemoteDescription(description);
    this.setState('connected');
  }

  private async handleIceCandidate(payload: Record<string, unknown>): Promise<void> {
    const candidate = payload.candidate as IceCandidate | undefined;
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

      this.sendSignal('rtc.ice-candidate', {
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
      this.remoteStreamHandlers.forEach((handler) => handler(stream));
      this.setState('connected');
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        this.setState('connected');
      } else if (
        peer.connectionState === 'disconnected' ||
        peer.connectionState === 'failed' ||
        peer.connectionState === 'closed'
      ) {
        this.setState('ended');
      }
    };

    this.peerConnection = peer;
  }

  private sendSignal(type: SignalType, payload: Record<string, unknown>): void {
    this.gateway.send({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      timestamp: Date.now(),
      sessionId: this.gateway.getCurrentSessionId() ?? undefined,
      payload,
    });
  }

  private setState(state: MobileWebRTCState): void {
    this.state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }
}

let mobileWebRTCSessionInstance: MobileWebRTCSession | null = null;

export function getMobileWebRTCSession(): MobileWebRTCSession {
  if (!mobileWebRTCSessionInstance) {
    mobileWebRTCSessionInstance = new MobileWebRTCSession();
  }

  return mobileWebRTCSessionInstance;
}
