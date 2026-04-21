import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/mobile/lib/gateway-client.js", () => ({
  gatewayClient: {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    getCurrentSessionId: () => null,
  },
}));

import { MobileWebRTCSession } from "../../apps/mobile/lib/webrtc.js";

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
    addedCandidates: [] as RTCIceCandidateInit[],
    tracks: [] as Array<{ track: MediaStreamTrack; stream: MediaStream }>,
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
      sdp: "mobile-offer",
    } satisfies RTCSessionDescriptionInit),
    createAnswer: vi.fn().mockResolvedValue({
      type: "answer",
      sdp: "mobile-answer",
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

describe("MobileWebRTCSession", () => {
  it("starts a call and sends rtc.offer through the gateway client", async () => {
    const sent: unknown[] = [];
    const stream = createStream(["mobile-track-1"]);
    const { peer, state } = createPeerConnectionStub();
    const session = new MobileWebRTCSession({
      gateway: {
        send: vi.fn((message: unknown) => {
          sent.push(message);
        }),
        onMessage: vi.fn(() => () => {}),
        getCurrentSessionId: () => "session-mobile-1",
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(stream),
    });

    await session.startCall("web-peer");

    expect(peer.addTrack).toHaveBeenCalledTimes(1);
    expect(state.tracks[0]?.stream).toBe(stream);
    expect(sent[0]).toMatchObject({
      type: "rtc.offer",
      sessionId: "session-mobile-1",
      payload: {
        targetChannelId: "web-peer",
        description: {
          type: "offer",
          sdp: "mobile-offer",
        },
      },
    });
  });

  it("answers an incoming offer and sends rtc.answer", async () => {
    const sent: unknown[] = [];
    const { peer } = createPeerConnectionStub();
    const session = new MobileWebRTCSession({
      gateway: {
        send: vi.fn((message: unknown) => {
          sent.push(message);
        }),
        onMessage: vi.fn(() => () => {}),
        getCurrentSessionId: () => "session-mobile-2",
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(createStream(["mobile-track-2"])),
    });

    await session.handleSignal({
      type: "rtc.offer",
      payload: {
        sourceChannelId: "web-peer",
        description: {
          type: "offer",
          sdp: "offer-from-web",
        },
      },
    });

    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "offer-from-web",
    });
    expect(sent[0]).toMatchObject({
      type: "rtc.answer",
      payload: {
        targetChannelId: "web-peer",
        description: {
          type: "answer",
          sdp: "mobile-answer",
        },
      },
    });
  });

  it("subscribes to gateway rtc messages through listen()", async () => {
    let messageHandler: ((message: unknown) => void) | null = null;
    const sent: unknown[] = [];
    const session = new MobileWebRTCSession({
      gateway: {
        send: vi.fn((message: unknown) => {
          sent.push(message);
        }),
        onMessage: vi.fn((handler: (message: unknown) => void) => {
          messageHandler = handler;
          return () => {
            messageHandler = null;
          };
        }),
        getCurrentSessionId: () => "session-mobile-3",
      } as never,
      peerConnectionFactory: () => createPeerConnectionStub().peer as never,
      getUserMedia: vi.fn().mockResolvedValue(createStream(["mobile-track-3"])),
    });

    session.listen();
    messageHandler?.({
      type: "rtc.offer",
      payload: {
        sourceChannelId: "web-peer",
        description: {
          type: "offer",
          sdp: "offer-through-gateway",
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent[0]).toMatchObject({
      type: "rtc.answer",
      payload: {
        targetChannelId: "web-peer",
      },
    });
  });

  it("sends rtc.hangup and stops tracks when ending a call", async () => {
    const sent: unknown[] = [];
    const stream = createStream(["mobile-track-4"]);
    const { peer } = createPeerConnectionStub();
    const session = new MobileWebRTCSession({
      gateway: {
        send: vi.fn((message: unknown) => {
          sent.push(message);
        }),
        onMessage: vi.fn(() => () => {}),
        getCurrentSessionId: () => "session-mobile-4",
      } as never,
      peerConnectionFactory: () => peer as never,
      getUserMedia: vi.fn().mockResolvedValue(stream),
    });

    await session.startCall("web-peer");
    session.endCall();

    expect(sent.at(-1)).toMatchObject({
      type: "rtc.hangup",
      payload: {
        targetChannelId: "web-peer",
      },
    });
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect((stream as unknown as { tracks: Array<{ stop: ReturnType<typeof vi.fn> }> }).tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(session.currentState).toBe("ended");
  });
});
