import { describe, expect, it, vi } from "vitest";
import { WebRTCVoiceSession } from "../../apps/web/lib/webrtc.js";

function createTrack(id: string) {
  return {
    id,
    stop: vi.fn(),
  };
}

function createStream(trackIds: string[]) {
  const tracks = trackIds.map((id) => createTrack(id));
  return {
    tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function createPeerConnectionStub() {
  const state = {
    localDescription: null as RTCSessionDescriptionInit | null,
    remoteDescription: null as RTCSessionDescriptionInit | null,
    tracks: [] as Array<{ track: MediaStreamTrack; stream: MediaStream }>,
    addedCandidates: [] as RTCIceCandidateInit[],
  };

  const peer = {
    onicecandidate: null as ((event: { candidate: RTCIceCandidateInit | null }) => void) | null,
    ontrack: null as ((event: { streams: MediaStream[] }) => void) | null,
    onconnectionstatechange: null as (() => void) | null,
    connectionState: "new",
    addTrack: vi.fn((track: MediaStreamTrack, stream: MediaStream) => {
      state.tracks.push({ track, stream });
    }),
    createOffer: vi.fn().mockResolvedValue({
      type: "offer",
      sdp: "offer-sdp",
    } satisfies RTCSessionDescriptionInit),
    createAnswer: vi.fn().mockResolvedValue({
      type: "answer",
      sdp: "answer-sdp",
    } satisfies RTCSessionDescriptionInit),
    setLocalDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
      state.localDescription = description;
    }),
    setRemoteDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
      state.remoteDescription = description;
    }),
    addIceCandidate: vi.fn(async (candidate?: RTCIceCandidateInit) => {
      if (candidate) state.addedCandidates.push(candidate);
    }),
    close: vi.fn(() => {
      peer.connectionState = "closed";
    }),
  };

  return { peer, state };
}

describe("WebRTCVoiceSession", () => {
  it("starts a call by creating an offer and sending rtc.offer", async () => {
    const sent: unknown[] = [];
    const wsClient = {
      currentSessionId: "session-1",
      send: vi.fn((message: unknown) => {
        sent.push(message);
      }),
      onMessage: vi.fn(() => () => {}),
    };
    const stream = createStream(["track-1"]);
    const { peer, state } = createPeerConnectionStub();
    const session = new WebRTCVoiceSession({
      wsClient: wsClient as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(stream),
    });

    await session.startCall("mobile-peer");

    expect(peer.addTrack).toHaveBeenCalledTimes(1);
    expect(state.tracks[0]?.stream).toBe(stream);
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(peer.setLocalDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "offer-sdp",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "rtc.offer",
      sessionId: "session-1",
      payload: {
        targetChannelId: "mobile-peer",
        description: {
          type: "offer",
          sdp: "offer-sdp",
        },
      },
    });
    expect(session.currentTargetChannelId).toBe("mobile-peer");
  });

  it("answers an incoming offer and sends rtc.answer back to the caller", async () => {
    const sent: unknown[] = [];
    const wsClient = {
      currentSessionId: "session-2",
      send: vi.fn((message: unknown) => {
        sent.push(message);
      }),
      onMessage: vi.fn(() => () => {}),
    };
    const stream = createStream(["track-2"]);
    const { peer } = createPeerConnectionStub();
    const session = new WebRTCVoiceSession({
      wsClient: wsClient as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(stream),
    });

    await session.handleSignal({
      type: "rtc.offer",
      payload: {
        sourceChannelId: "web-peer",
        description: {
          type: "offer",
          sdp: "remote-offer",
        },
      },
    });

    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "remote-offer",
    });
    expect(peer.createAnswer).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject({
      type: "rtc.answer",
      sessionId: "session-2",
      payload: {
        targetChannelId: "web-peer",
        description: {
          type: "answer",
          sdp: "answer-sdp",
        },
      },
    });
    expect(session.currentTargetChannelId).toBe("web-peer");
  });

  it("adds remote ICE candidates to the peer connection", async () => {
    const { peer } = createPeerConnectionStub();
    const session = new WebRTCVoiceSession({
      wsClient: {
        currentSessionId: "session-3",
        send: vi.fn(),
        onMessage: vi.fn(() => () => {}),
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(createStream(["track-3"])),
    });

    await session.startCall("mobile-peer");
    await session.handleSignal({
      type: "rtc.ice-candidate",
      payload: {
        candidate: {
          candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      },
    });

    expect(peer.addIceCandidate).toHaveBeenCalledWith({
      candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });
  });

  it("forwards local ICE candidates over the signaling channel", async () => {
    const sent: unknown[] = [];
    const { peer } = createPeerConnectionStub();
    const session = new WebRTCVoiceSession({
      wsClient: {
        currentSessionId: "session-4",
        send: vi.fn((message: unknown) => {
          sent.push(message);
        }),
        onMessage: vi.fn(() => () => {}),
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(createStream(["track-4"])),
    });

    await session.startCall("mobile-peer");
    peer.onicecandidate?.({
      candidate: {
        candidate: "candidate:2 1 UDP 2122260223 192.0.2.5 54401 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "abc",
      },
    });

    expect(sent.at(-1)).toMatchObject({
      type: "rtc.ice-candidate",
      payload: {
        targetChannelId: "mobile-peer",
        candidate: {
          candidate: "candidate:2 1 UDP 2122260223 192.0.2.5 54401 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "abc",
        },
      },
    });
  });

  it("subscribes to WebSocket rtc messages through listen()", async () => {
    let messageHandler: ((message: unknown) => void) | null = null;
    const sent: unknown[] = [];
    const wsClient = {
      currentSessionId: "session-5",
      send: vi.fn((message: unknown) => {
        sent.push(message);
      }),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {
          messageHandler = null;
        };
      }),
    };
    const session = new WebRTCVoiceSession({
      wsClient: wsClient as never,
      peerConnectionFactory: () => createPeerConnectionStub().peer as never,
      getUserMedia: vi.fn().mockResolvedValue(createStream(["track-5"])),
    });

    session.listen();
    messageHandler?.({
      type: "rtc.offer",
      payload: {
        sourceChannelId: "voice-peer",
        description: {
          type: "offer",
          sdp: "offer-from-signal",
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wsClient.onMessage).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject({
      type: "rtc.answer",
      payload: {
        targetChannelId: "voice-peer",
      },
    });
  });

  it("sends rtc.hangup and stops local tracks when ending a call", async () => {
    const sent: unknown[] = [];
    const stream = createStream(["track-6"]);
    const { peer } = createPeerConnectionStub();
    const session = new WebRTCVoiceSession({
      wsClient: {
        currentSessionId: "session-6",
        send: vi.fn((message: unknown) => {
          sent.push(message);
        }),
        onMessage: vi.fn(() => () => {}),
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(stream),
    });

    await session.startCall("mobile-peer");
    session.endCall();

    expect(sent.at(-1)).toMatchObject({
      type: "rtc.hangup",
      payload: {
        targetChannelId: "mobile-peer",
      },
    });
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect((stream as unknown as { tracks: Array<{ stop: ReturnType<typeof vi.fn> }> }).tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(session.currentState).toBe("ended");
  });

  it("emits remote streams and transitions to connected when a track arrives", async () => {
    const remoteStream = createStream(["remote-track-1"]);
    const { peer } = createPeerConnectionStub();
    const session = new WebRTCVoiceSession({
      wsClient: {
        currentSessionId: "session-7",
        send: vi.fn(),
        onMessage: vi.fn(() => () => {}),
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(createStream(["track-7"])),
    });

    const states: string[] = [];
    const receivedStreams: MediaStream[] = [];
    session.onStateChange((state) => {
      states.push(state);
    });
    session.onRemoteStream((stream) => {
      receivedStreams.push(stream);
    });

    await session.startCall("mobile-peer");
    peer.ontrack?.({ streams: [remoteStream] });

    expect(receivedStreams).toEqual([remoteStream]);
    expect(session.currentState).toBe("connected");
    expect(states).toContain("connected");
  });
});
