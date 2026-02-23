import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Maximize,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  RefreshCw,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";

import { api, type LiveRoom, type LiveRoomParticipant } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { useI18n } from "../i18n";

type RoomSocketEvent =
  | {
      type: "ready";
      room: LiveRoom;
      self: LiveRoomParticipant;
      participants: LiveRoomParticipant[];
    }
  | {
      type: "user_joined";
      room_id: string;
      participant: LiveRoomParticipant;
    }
  | {
      type: "user_left";
      room_id: string;
      user_id: string;
    }
  | {
      type: "participant_state_updated";
      room_id: string;
      user_id: string;
      audio_enabled: boolean;
      video_enabled: boolean;
      screen_enabled: boolean;
    }
  | {
      type: "signal";
      room_id: string;
      from_user_id: string;
      signal_type: "offer" | "answer" | "ice-candidate" | "renegotiate-request";
      payload: any;
    }
  | { type: "error"; message?: string }
  | { type: "room_ended"; room_id: string }
  | { type: "ping"; ts?: number }
  | { type: "pong"; ts?: number };

type PeerTransceivers = {
  audio: RTCRtpTransceiver | null;
  video: RTCRtpTransceiver | null;
};

type StreamQualityTier = "low" | "high";
type StreamQualityMode = "auto" | StreamQualityTier;

type BrowserNetworkInformation = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

const getBrowserNetworkInformation = (): BrowserNetworkInformation | null => {
  const nav = navigator as Navigator & {
    connection?: BrowserNetworkInformation;
    mozConnection?: BrowserNetworkInformation;
    webkitConnection?: BrowserNetworkInformation;
  };
  return nav.connection || nav.mozConnection || nav.webkitConnection || null;
};

const resolveStreamQualityTier = (
  connection: BrowserNetworkInformation | null
): StreamQualityTier => {
  if (!connection) return "low";

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  const downlink = Number(connection.downlink || 0);
  const rtt = Number(connection.rtt || 0);

  if (connection.saveData) return "low";
  if (effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") return "low";
  if (Number.isFinite(downlink) && downlink > 0 && downlink < 3) return "low";
  if (Number.isFinite(rtt) && rtt > 0 && rtt > 250) return "low";

  const fastType = effectiveType === "4g" || effectiveType === "5g";
  const goodDownlink = Number.isFinite(downlink) && downlink >= 8;
  const goodRtt = !Number.isFinite(rtt) || rtt <= 120;
  if ((fastType || goodDownlink) && goodRtt) return "high";

  return "low";
};

const roomWSURL = (roomID: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/rooms/${encodeURIComponent(roomID)}/ws`;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

function VideoView({
  stream,
  muted,
  mirror = true,
  fitClassName = "object-cover",
}: {
  stream: MediaStream;
  muted?: boolean;
  mirror?: boolean;
  fitClassName?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;

    const tryPlay = () => {
      void el.play().catch(() => {
        // Safari/Chrome may delay autoplay until metadata/first frame.
      });
    };
    tryPlay();
    el.addEventListener("loadedmetadata", tryPlay);
    el.addEventListener("canplay", tryPlay);

    return () => {
      el.removeEventListener("loadedmetadata", tryPlay);
      el.removeEventListener("canplay", tryPlay);
      if (el.srcObject === stream) {
        el.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={Boolean(muted)}
      className={`absolute inset-0 w-full h-full ${fitClassName} ${mirror ? "scale-x-[-1]" : ""}`}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

function AudioView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;

    const tryPlay = () => {
      void el.play().catch(() => {
        // Autoplay may be blocked until first user interaction.
      });
    };

    tryPlay();
    el.addEventListener("loadedmetadata", tryPlay);
    el.addEventListener("canplay", tryPlay);

    return () => {
      el.removeEventListener("loadedmetadata", tryPlay);
      el.removeEventListener("canplay", tryPlay);
      if (el.srcObject === stream) {
        el.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <audio
      ref={ref}
      data-room-remote-audio="1"
      autoPlay
      playsInline
      className="absolute w-0 h-0 opacity-0 pointer-events-none"
    />
  );
}

export default function RoomCallPage() {
  const { t } = useI18n();
  const { roomId = "" } = useParams();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const initialRoomPassword =
    typeof (location.state as any)?.roomPassword === "string"
      ? String((location.state as any).roomPassword).trim()
      : "";

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [roomPassword, setRoomPassword] = useState(initialRoomPassword);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [selfParticipant, setSelfParticipant] = useState<LiveRoomParticipant | null>(null);
  const [participants, setParticipants] = useState<Record<string, LiveRoomParticipant>>({});
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [screenBusy, setScreenBusy] = useState(false);
  const [cameraFlipBusy, setCameraFlipBusy] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("user");
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [autoStreamQualityTier, setAutoStreamQualityTier] = useState<StreamQualityTier>(() =>
    resolveStreamQualityTier(getBrowserNetworkInformation())
  );
  const [streamQualityMode, setStreamQualityMode] = useState<StreamQualityMode>("auto");
  const [expandedScreenOwner, setExpandedScreenOwner] = useState<string | null>(null);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [fullscreenPan, setFullscreenPan] = useState({ x: 0, y: 0 });
  const effectiveStreamQualityTier: StreamQualityTier =
    streamQualityMode === "auto" ? autoStreamQualityTier : streamQualityMode;

  const wsRef = useRef<WebSocket | null>(null);
  const selfIDRef = useRef<string>("");
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const participantsRef = useRef<Record<string, LiveRoomParticipant>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerTransceiversRef = useRef<Map<string, PeerTransceivers>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const queuedOfferRef = useRef<Map<string, boolean>>(new Map());
  const syncRetryTimersRef = useRef<Map<string, number[]>>(new Map());
  const audioSyncRetryTimersRef = useRef<Map<string, number[]>>(new Map());
  const ignoreOfferRef = useRef<Map<string, boolean>>(new Map());
  const isSettingRemoteAnswerPendingRef = useRef<Map<string, boolean>>(new Map());
  const signalQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const makeOfferFnRef = useRef<(peerID: string) => Promise<void>>(async () => {});
  const rtcDebugRef = useRef(false);
  const roomIDRef = useRef(roomId);
  const updateSelfMediaStateRef = useRef<(audio: boolean, video: boolean, screen: boolean) => void>(
    () => {}
  );
  const startPeerNegotiationRef = useRef<(peerID: string) => void>(() => {});
  const requestAudioSyncRef = useRef<(peerID: string) => void>(() => {});
  const requestVideoSyncRef = useRef<(peerID: string) => void>(() => {});
  const clearAudioSyncRetriesRef = useRef<(peerID: string) => void>(() => {});
  const clearSyncRetriesRef = useRef<(peerID: string) => void>(() => {});
  const queueSignalRef = useRef<(peerID: string, signalType: string, payload: any) => void>(() => {});
  const removePeerRef = useRef<(peerID: string) => void>(() => {});
  const fullscreenViewportRef = useRef<HTMLDivElement | null>(null);
  const fullscreenZoomRef = useRef(1);
  const fullscreenPanRef = useRef({ x: 0, y: 0 });
  const suppressNextViewportTapCloseRef = useRef(false);
  const landscapeSessionRef = useRef(false);
  const streamQualityTierRef = useRef<StreamQualityTier>(effectiveStreamQualityTier);
  const cameraFacingModeRef = useRef<"user" | "environment">(cameraFacingMode);
  const touchStateRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startPanX: number;
    startPanY: number;
    startX: number;
    startY: number;
    startDistance: number;
    startZoom: number;
    startCenterX: number;
    startCenterY: number;
  }>({
    mode: "none",
    startPanX: 0,
    startPanY: 0,
    startX: 0,
    startY: 0,
    startDistance: 0,
    startZoom: 1,
    startCenterX: 0,
    startCenterY: 0,
  });
  roomIDRef.current = roomId;

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
  }, [remoteStreams]);

  useEffect(() => {
    fullscreenZoomRef.current = fullscreenZoom;
  }, [fullscreenZoom]);

  useEffect(() => {
    fullscreenPanRef.current = fullscreenPan;
  }, [fullscreenPan]);

  useEffect(() => {
    localScreenStreamRef.current = localScreenStream;
  }, [localScreenStream]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      rtcDebugRef.current =
        params.get("rtc_debug") === "1" || window.localStorage.getItem("rtc_debug") === "1";
    } catch {
      rtcDebugRef.current = false;
    }
  }, []);

  const rtcLog = useCallback((...args: any[]) => {
    if (!rtcDebugRef.current) return;
    console.debug("[rtc]", roomIDRef.current, ...args);
  }, []);

  useEffect(() => {
    streamQualityTierRef.current = effectiveStreamQualityTier;
    rtcLog("stream-quality-tier", effectiveStreamQualityTier, {
      mode: streamQualityMode,
      auto: autoStreamQualityTier,
    });
  }, [autoStreamQualityTier, effectiveStreamQualityTier, rtcLog, streamQualityMode]);

  useEffect(() => {
    const connection = getBrowserNetworkInformation();
    if (!connection) return;

    const syncTier = () => {
      setAutoStreamQualityTier(resolveStreamQualityTier(connection));
    };

    syncTier();
    if (typeof connection.addEventListener === "function") {
      const onChange = () => syncTier();
      connection.addEventListener("change", onChange);
      return () => {
        connection.removeEventListener?.("change", onChange);
      };
    }
  }, []);

  const mediaSupportError = useCallback(() => {
    if (!window.isSecureContext) {
      return t("rooms.media_https_required");
    }
    return t("rooms.media_not_supported");
  }, [t]);
  const isSafariBrowser = useMemo(() => {
    const ua = window.navigator.userAgent;
    return /safari/i.test(ua) && !/chrome|chromium|crios|edg|opr|android/i.test(ua);
  }, []);
  const isMobileDevice = useMemo(() => {
    const ua = window.navigator.userAgent;
    return /android|iphone|ipad|ipod/i.test(ua);
  }, []);

  useEffect(() => {
    cameraFacingModeRef.current = cameraFacingMode;
  }, [cameraFacingMode]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;

    const refreshDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const videoInputs = devices.filter((device) => device.kind === "videoinput");
        setCanFlipCamera(videoInputs.length > 1);
      } catch {
        if (!cancelled) {
          setCanFlipCamera(false);
        }
      }
    };

    void refreshDevices();
    if (typeof navigator.mediaDevices.addEventListener === "function") {
      navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
      return () => {
        cancelled = true;
        navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [videoEnabled]);

  useEffect(() => {
    const nextPassword =
      typeof (location.state as any)?.roomPassword === "string"
        ? String((location.state as any).roomPassword).trim()
        : "";
    setRoomPassword(nextPassword);
  }, [location.state, roomId]);

  const participantCount = useMemo(() => {
    const others = Object.keys(participants).length;
    return Math.max(1, others + (selfParticipant ? 1 : 0));
  }, [participants, selfParticipant]);

  const clampFullscreenPan = useCallback((x: number, y: number, zoom: number) => {
    if (zoom <= 1) return { x: 0, y: 0 };
    const viewport = fullscreenViewportRef.current;
    if (!viewport) return { x, y };
    const maxX = ((zoom - 1) * viewport.clientWidth) / 2;
    const maxY = ((zoom - 1) * viewport.clientHeight) / 2;
    const nextX = Math.max(-maxX, Math.min(maxX, x));
    const nextY = Math.max(-maxY, Math.min(maxY, y));
    return { x: nextX, y: nextY };
  }, []);

  const sendWS = useCallback((payload: any) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const frameType = String(payload?.type || "");
    const signalType = String(payload?.signal_type || "");
    if (frameType === "signal") {
      rtcLog("ws->signal", signalType, payload?.target_user_id || "");
    }
    socket.send(JSON.stringify(payload));
  }, [rtcLog]);

  const leaveRoomSocket = useCallback((reason: string) => {
    const socket = wsRef.current;
    if (!socket) return;
    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
    rtcLog("ws-leave", reason);
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave", reason }));
      }
    } catch {
      // noop
    }
    try {
      socket.close();
    } catch {
      // noop
    }
  }, [rtcLog]);

  const updateSelfMediaState = useCallback((audio: boolean, video: boolean, screen: boolean) => {
    setAudioEnabled(audio);
    setVideoEnabled(video);
    setScreenEnabled(screen);
    setSelfParticipant((prev) =>
      prev
        ? {
            ...prev,
            audio_enabled: audio,
            video_enabled: video,
            screen_enabled: screen,
          }
        : prev
    );
  }, []);

  const clearSyncRetries = useCallback((peerID: string) => {
    const ids = syncRetryTimersRef.current.get(peerID) || [];
    for (const id of ids) {
      window.clearTimeout(id);
    }
    syncRetryTimersRef.current.delete(peerID);
  }, []);
  const clearAudioSyncRetries = useCallback((peerID: string) => {
    const ids = audioSyncRetryTimersRef.current.get(peerID) || [];
    for (const id of ids) {
      window.clearTimeout(id);
    }
    audioSyncRetryTimersRef.current.delete(peerID);
  }, []);

  const resumeRemoteAudioPlayback = useCallback(
    (reason: string) => {
      const els = Array.from(
        document.querySelectorAll<HTMLAudioElement>('audio[data-room-remote-audio="1"]')
      );
      if (els.length === 0) {
        setAudioUnlockRequired(false);
        return;
      }
      for (const el of els) {
        const stream = el.srcObject as MediaStream | null;
        const hasAudio = Boolean(
          stream && stream.getAudioTracks().some((track) => track.readyState !== "ended")
        );
        if (!hasAudio) continue;
        el.muted = false;
        el.volume = 1;
        void el.play().catch((err) => {
          rtcLog("audio-play-blocked", reason, String(err?.name || err));
        });
      }

      window.setTimeout(() => {
        const stillBlocked = els.some((el) => {
          const stream = el.srcObject as MediaStream | null;
          const hasAudio = Boolean(
            stream && stream.getAudioTracks().some((track) => track.readyState !== "ended")
          );
          return hasAudio && el.paused;
        });
        setAudioUnlockRequired(isSafariBrowser && stillBlocked);
      }, 120);
    },
    [isSafariBrowser, rtcLog]
  );

  const removePeer = useCallback((peerID: string) => {
    const pc = pcsRef.current.get(peerID);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onsignalingstatechange = null;
        pc.onnegotiationneeded = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        // ignore close errors
      }
      pcsRef.current.delete(peerID);
    }
    peerTransceiversRef.current.delete(peerID);
    pendingIceRef.current.delete(peerID);
    makingOfferRef.current.delete(peerID);
    queuedOfferRef.current.delete(peerID);
    ignoreOfferRef.current.delete(peerID);
    isSettingRemoteAnswerPendingRef.current.delete(peerID);
    signalQueueRef.current.delete(peerID);
    clearSyncRetries(peerID);
    clearAudioSyncRetries(peerID);
    setRemoteStreams((prev) => {
      if (!prev[peerID]) return prev;
      const next = { ...prev };
      delete next[peerID];
      return next;
    });
  }, [clearAudioSyncRetries, clearSyncRetries]);

  const isPolitePeer = useCallback((peerID: string) => {
    const selfID = selfIDRef.current;
    if (!selfID || !peerID) return true;
    // Deterministic role split for glare resolution:
    // lexicographically larger user ID is polite.
    return selfID > peerID;
  }, []);

  const preferH264ForVideo = useCallback((pc: RTCPeerConnection) => {
    try {
      const senderAny = RTCRtpSender as any;
      if (!senderAny || typeof senderAny.getCapabilities !== "function") return;
      const caps = senderAny.getCapabilities("video");
      const codecs: RTCRtpCodecCapability[] = Array.isArray(caps?.codecs) ? caps.codecs : [];
      if (codecs.length === 0) return;

      const h264 = codecs.filter(
        (c) => String(c?.mimeType || "").toLowerCase() === "video/h264"
      );
      if (h264.length === 0) return;

      for (const tr of pc.getTransceivers()) {
        const kind = tr.sender.track?.kind || tr.receiver.track?.kind;
        if (kind !== "video") continue;
        if (typeof tr.setCodecPreferences === "function") {
          tr.setCodecPreferences(h264);
        }
      }
    } catch {
      // Browser-specific codec APIs may be unavailable.
    }
  }, []);

  const ensurePeerConnection = useCallback(
    (peerID: string) => {
      const existing = pcsRef.current.get(peerID);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcsRef.current.set(peerID, pc);

      const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
      const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      peerTransceiversRef.current.set(peerID, {
        audio: audioTransceiver,
        video: videoTransceiver,
      });

      const local = localStreamRef.current;
      if (local) {
        const screenAudio =
          screenEnabled && screenAudioTrackRef.current?.readyState !== "ended"
            ? screenAudioTrackRef.current
            : null;
        const micAudio =
          audioEnabled && micTrackRef.current?.readyState !== "ended"
            ? micTrackRef.current
            : null;
        const outgoingAudioTrack = screenAudio || micAudio || null;
        void audioTransceiver.sender.replaceTrack(outgoingAudioTrack).catch(() => {});
        const outgoingVideoTrack =
          screenTrackRef.current || (videoEnabled ? cameraTrackRef.current : null);
        if (outgoingVideoTrack) {
          void videoTransceiver.sender.replaceTrack(outgoingVideoTrack).catch(() => {});
        } else {
          void videoTransceiver.sender.replaceTrack(null).catch(() => {});
        }
      }

      preferH264ForVideo(pc);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendWS({
          type: "signal",
          target_user_id: peerID,
          signal_type: "ice-candidate",
          payload: event.candidate.toJSON(),
        });
      };

      pc.ontrack = (event) => {
        const track = event.track;
        rtcLog("ontrack", peerID, track.kind, track.id);

        setRemoteStreams((prev) => {
          const existingStream = prev[peerID] ?? new MediaStream();
          const hasTrack = (id: string) => existingStream.getTracks().some((t) => t.id === id);

          if (!hasTrack(track.id)) {
            existingStream.addTrack(track);
          }

          const incomingStream = event.streams?.[0];
          if (incomingStream) {
            for (const incomingTrack of incomingStream.getTracks()) {
              if (!hasTrack(incomingTrack.id)) {
                existingStream.addTrack(incomingTrack);
              }
            }
          }

          return { ...prev, [peerID]: existingStream };
        });

        track.onended = () => {
          rtcLog("track-ended", peerID, track.kind, track.id);
          setRemoteStreams((prev) => {
            const existingStream = prev[peerID];
            if (!existingStream) return prev;
            try {
              existingStream.removeTrack(track);
            } catch {
              // noop
            }
            if (existingStream.getTracks().length === 0) {
              const next = { ...prev };
              delete next[peerID];
              return next;
            }
            return { ...prev, [peerID]: existingStream };
          });
        };
        if (track.kind === "video") {
          clearSyncRetries(peerID);
        }
        if (track.kind === "audio") {
          clearAudioSyncRetries(peerID);
          track.onunmute = () => {
            rtcLog("audio-unmute", peerID, track.id);
            resumeRemoteAudioPlayback("audio-unmute");
          };
          track.onmute = () => {
            rtcLog("audio-mute", peerID, track.id);
          };
          window.setTimeout(() => {
            resumeRemoteAudioPlayback("audio-track");
          }, 0);
        }
      };

      pc.onsignalingstatechange = () => {
        if (pc.signalingState !== "stable") return;
        if (queuedOfferRef.current.get(peerID) !== true) return;
        void makeOfferFnRef.current(peerID).catch(() => {});
      };

      pc.onnegotiationneeded = () => {
        void makeOfferFnRef.current(peerID).catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "failed" || state === "closed") {
          removePeer(peerID);
        }
      };

      return pc;
    },
    [
      clearAudioSyncRetries,
      clearSyncRetries,
      preferH264ForVideo,
      removePeer,
      resumeRemoteAudioPlayback,
      rtcLog,
      sendWS,
      audioEnabled,
      screenEnabled,
      videoEnabled,
    ]
  );

  const attachTrackToPeer = useCallback(
    async (
      peerID: string,
      track: MediaStreamTrack | null,
      kindOverride?: "audio" | "video"
    ) => {
      const transceivers = peerTransceiversRef.current.get(peerID);
      const targetKind = kindOverride || track?.kind || "video";
      const transceiver =
        targetKind === "audio"
          ? transceivers?.audio
          : transceivers?.video;
      if (transceiver) {
        if (transceiver.direction === "recvonly" || transceiver.direction === "inactive") {
          transceiver.direction = "sendrecv";
        }
        await transceiver.sender.replaceTrack(track).catch(() => {});
        return;
      }

      if (!track) return;
      const pc = pcsRef.current.get(peerID);
      const local = localStreamRef.current;
      if (!pc || !local) return;
      pc.addTrack(track, local);
    },
    []
  );

  const getScreenVideoConstraints = useCallback(() => {
    const highQuality = streamQualityTierRef.current === "high";
    return {
      frameRate: { ideal: 30, max: 30 },
      width: { ideal: highQuality ? 1920 : 1728, max: 1920 },
      height: { ideal: highQuality ? 1080 : 972, max: 1080 },
    };
  }, []);

  const getCameraVideoConstraints = useCallback((
    facingMode: "user" | "environment" = cameraFacingModeRef.current,
    forceExactFacing = false
  ) => {
    const highQuality = streamQualityTierRef.current === "high";
    return {
      frameRate: { ideal: highQuality ? 30 : 24, max: highQuality ? 30 : 24 },
      width: { ideal: highQuality ? 1920 : 960, max: 1920 },
      height: { ideal: highQuality ? 1080 : 540, max: 1080 },
      facingMode: forceExactFacing ? { exact: facingMode } : facingMode,
    };
  }, []);

  const tuneVideoSender = useCallback(async (peerID: string, isScreenShare: boolean) => {
    const transceiver = peerTransceiversRef.current.get(peerID)?.video;
    const sender = transceiver?.sender;
    if (!sender) return;
    try {
      const highQuality = streamQualityTierRef.current === "high";
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      const encoding = params.encodings[0];
      if (isScreenShare) {
        // Prefer smoother motion for screen-share (anime/video playback).
        encoding.maxFramerate = 30;
        encoding.maxBitrate = highQuality ? 7_500_000 : 3_600_000;
        encoding.scaleResolutionDownBy = highQuality ? 1 : 1.1;
      } else {
        encoding.maxFramerate = highQuality ? 30 : 24;
        encoding.maxBitrate = highQuality ? 4_500_000 : 2_000_000;
        if (typeof encoding.scaleResolutionDownBy === "number" && encoding.scaleResolutionDownBy < 1) {
          encoding.scaleResolutionDownBy = 1;
        }
      }
      params.degradationPreference = isScreenShare ? "maintain-framerate" : "balanced";
      await sender.setParameters(params);
    } catch {
      // Some browsers ignore/limit sender parameter changes.
    }
  }, []);

  const applyOutgoingVideoTrack = useCallback(
    async (track: MediaStreamTrack | null, options?: { isScreenShare?: boolean }) => {
      const isScreenShare = Boolean(options?.isScreenShare);
      for (const peerID of pcsRef.current.keys()) {
        await attachTrackToPeer(peerID, track);
        await tuneVideoSender(peerID, isScreenShare);
      }
    },
    [attachTrackToPeer, tuneVideoSender]
  );

  const applyOutgoingAudioTrack = useCallback(
    async (track: MediaStreamTrack | null) => {
      for (const peerID of pcsRef.current.keys()) {
        await attachTrackToPeer(peerID, track, "audio");
      }
    },
    [attachTrackToPeer]
  );

  useEffect(() => {
    const isScreenShareTrackActive = Boolean(
      screenEnabled && screenTrackRef.current?.readyState !== "ended"
    );
    for (const peerID of pcsRef.current.keys()) {
      void tuneVideoSender(peerID, isScreenShareTrackActive);
    }

    const screenTrack = screenTrackRef.current;
    if (screenTrack && screenTrack.readyState !== "ended") {
      void screenTrack.applyConstraints(getScreenVideoConstraints()).catch(() => {});
    }

    const cameraTrack = cameraTrackRef.current;
    if (cameraTrack && cameraTrack.readyState !== "ended") {
      void cameraTrack.applyConstraints(getCameraVideoConstraints()).catch(() => {});
    }
  }, [
    effectiveStreamQualityTier,
    getCameraVideoConstraints,
    getScreenVideoConstraints,
    screenEnabled,
    tuneVideoSender,
  ]);

  const flushPendingIce = useCallback((peerID: string) => {
    const pc = pcsRef.current.get(peerID);
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIceRef.current.get(peerID);
    if (!queued || queued.length === 0) return;
    pendingIceRef.current.delete(peerID);
    queued.forEach((candidate) => {
      void pc.addIceCandidate(candidate).catch(() => {});
    });
  }, []);

  const makeOffer = useCallback(
    async (peerID: string) => {
      const pc = ensurePeerConnection(peerID);
      const busy =
        makingOfferRef.current.get(peerID) === true ||
        isSettingRemoteAnswerPendingRef.current.get(peerID) === true;
      if (pc.signalingState !== "stable" || busy) {
        rtcLog("queue-offer", peerID, pc.signalingState, { busy });
        queuedOfferRef.current.set(peerID, true);
        return;
      }
      queuedOfferRef.current.delete(peerID);
      preferH264ForVideo(pc);
      makingOfferRef.current.set(peerID, true);
      try {
        rtcLog("make-offer", peerID);
        await pc.setLocalDescription();
        sendWS({
          type: "signal",
          target_user_id: peerID,
          signal_type: "offer",
          payload: pc.localDescription,
        });
      } finally {
        makingOfferRef.current.set(peerID, false);
        if (queuedOfferRef.current.get(peerID) === true && pc.signalingState === "stable") {
          queuedOfferRef.current.delete(peerID);
          rtcLog("flush-queued-offer", peerID);
          void makeOfferFnRef.current(peerID).catch(() => {});
        }
      }
    },
    [ensurePeerConnection, preferH264ForVideo, rtcLog, sendWS]
  );

  useEffect(() => {
    makeOfferFnRef.current = makeOffer;
  }, [makeOffer]);

  const startPeerNegotiation = useCallback(
    (peerID: string) => {
      if (!peerID || peerID === selfIDRef.current) return;
      ensurePeerConnection(peerID);
      void makeOffer(peerID).catch(() => {});
    },
    [ensurePeerConnection, makeOffer]
  );

  const requestVideoSync = useCallback(
    (peerID: string) => {
      if (!peerID || peerID === selfIDRef.current) return;
      clearSyncRetries(peerID);
      const delays = [0, 400, 1200, 2600];
      const ids: number[] = [];
      for (const delay of delays) {
        const id = window.setTimeout(() => {
          const peer = participantsRef.current[peerID];
          if (!peer?.video_enabled) {
            clearSyncRetries(peerID);
            return;
          }
          const stream = remoteStreamsRef.current[peerID];
          const hasVideo = Boolean(
            stream && stream.getVideoTracks().some((t) => t.readyState !== "ended")
          );
          if (hasVideo) {
            clearSyncRetries(peerID);
            return;
          }
          rtcLog("video-sync retry", peerID, { delay });
          void makeOfferFnRef.current(peerID).catch(() => {});
        }, delay);
        ids.push(id);
      }
      syncRetryTimersRef.current.set(peerID, ids);
    },
    [clearSyncRetries, rtcLog]
  );
  const requestAudioSync = useCallback(
    (peerID: string) => {
      if (!peerID || peerID === selfIDRef.current) return;
      clearAudioSyncRetries(peerID);
      const delays = [0, 400, 1200, 2600];
      const ids: number[] = [];
      for (const delay of delays) {
        const id = window.setTimeout(() => {
          const peer = participantsRef.current[peerID];
          if (!peer?.audio_enabled) {
            clearAudioSyncRetries(peerID);
            return;
          }
          const stream = remoteStreamsRef.current[peerID];
          const hasAudio = Boolean(
            stream && stream.getAudioTracks().some((t) => t.readyState !== "ended")
          );
          if (hasAudio) {
            clearAudioSyncRetries(peerID);
            resumeRemoteAudioPlayback("audio-sync-ready");
            return;
          }
          rtcLog("audio-sync retry", peerID, { delay });
          void makeOfferFnRef.current(peerID).catch(() => {});
        }, delay);
        ids.push(id);
      }
      audioSyncRetryTimersRef.current.set(peerID, ids);
    },
    [clearAudioSyncRetries, resumeRemoteAudioPlayback, rtcLog]
  );

  const handleSignal = useCallback(
    async (fromUserID: string, signalType: string, payload: any) => {
      const pc = ensurePeerConnection(fromUserID);
      rtcLog("signal<-", signalType, fromUserID, pc.signalingState);
      if (signalType === "offer") {
        const makingOffer = makingOfferRef.current.get(fromUserID) === true;
        const srdAnswerPending = isSettingRemoteAnswerPendingRef.current.get(fromUserID) === true;
        const isStable =
          pc.signalingState === "stable" ||
          (pc.signalingState === "have-local-offer" && srdAnswerPending);
        const ignoreOffer =
          !isPolitePeer(fromUserID) && (makingOffer || !isStable);
        ignoreOfferRef.current.set(fromUserID, ignoreOffer);
        if (ignoreOffer) return;

        isSettingRemoteAnswerPendingRef.current.set(fromUserID, false);
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        preferH264ForVideo(pc);
        flushPendingIce(fromUserID);
        await pc.setLocalDescription();
        sendWS({
          type: "signal",
          target_user_id: fromUserID,
          signal_type: "answer",
          payload: pc.localDescription,
        });
        return;
      }
      if (signalType === "answer") {
        isSettingRemoteAnswerPendingRef.current.set(fromUserID, true);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
        } finally {
          isSettingRemoteAnswerPendingRef.current.set(fromUserID, false);
        }
        flushPendingIce(fromUserID);
        return;
      }
      if (signalType === "ice-candidate") {
        let candidate: RTCIceCandidateInit | null = null;
        if (!payload) return;
        if (typeof payload === "object") {
          if (
            "candidate" in payload &&
            (typeof (payload as any).candidate === "string" ||
              (payload as any).candidate === null)
          ) {
            // Normal case: payload is RTCIceCandidateInit object.
            candidate = payload as RTCIceCandidateInit;
          } else if ("candidate" in payload && typeof (payload as any).candidate === "object") {
            // Defensive fallback for nested shapes.
            candidate = (payload as any).candidate as RTCIceCandidateInit;
          }
        }
        if (!candidate) return;
        if (!pc.remoteDescription) {
          const queued = pendingIceRef.current.get(fromUserID) || [];
          queued.push(candidate);
          pendingIceRef.current.set(fromUserID, queued);
          return;
        }
        await pc.addIceCandidate(candidate).catch((err) => {
          if (ignoreOfferRef.current.get(fromUserID) === true) return;
          throw err;
        });
        return;
      }
      if (signalType === "renegotiate-request") {
        rtcLog("renegotiate-request", fromUserID);
        await makeOffer(fromUserID);
      }
    },
    [ensurePeerConnection, flushPendingIce, isPolitePeer, makeOffer, preferH264ForVideo, rtcLog, sendWS]
  );

  const queueSignal = useCallback(
    (fromUserID: string, signalType: string, payload: any) => {
      const prev = signalQueueRef.current.get(fromUserID) ?? Promise.resolve();
      let next: Promise<void>;
      next = prev
        .catch(() => {})
        .then(() => handleSignal(fromUserID, signalType, payload))
        .catch((err) => {
          rtcLog("signal-handle-error", fromUserID, signalType, String(err?.message || err));
        })
        .finally(() => {
          if (signalQueueRef.current.get(fromUserID) === next) {
            signalQueueRef.current.delete(fromUserID);
          }
        });
      signalQueueRef.current.set(fromUserID, next);
    },
    [handleSignal, rtcLog]
  );

  useEffect(() => {
    updateSelfMediaStateRef.current = updateSelfMediaState;
    startPeerNegotiationRef.current = startPeerNegotiation;
    requestAudioSyncRef.current = requestAudioSync;
    requestVideoSyncRef.current = requestVideoSync;
    clearAudioSyncRetriesRef.current = clearAudioSyncRetries;
    clearSyncRetriesRef.current = clearSyncRetries;
    queueSignalRef.current = queueSignal;
    removePeerRef.current = removePeer;
  }, [
    clearAudioSyncRetries,
    clearSyncRetries,
    queueSignal,
    removePeer,
    requestAudioSync,
    requestVideoSync,
    startPeerNegotiation,
    updateSelfMediaState,
  ]);

  const renegotiatePeersWithLocalOffer = useCallback(async () => {
    const peerIDs = Array.from(pcsRef.current.keys());
    for (const peerID of peerIDs) {
      if (!peerID || peerID === selfIDRef.current) continue;
      try {
        await makeOffer(peerID);
      } catch {
        // ignore per-peer renegotiation errors
      }
    }
  }, [makeOffer]);

  const applyQualityProfileNow = useCallback(
    async (mode: StreamQualityMode) => {
      const nextTier: StreamQualityTier = mode === "auto" ? autoStreamQualityTier : mode;
      streamQualityTierRef.current = nextTier;

      const isScreenShareTrackActive = Boolean(
        screenEnabled && screenTrackRef.current?.readyState !== "ended"
      );
      for (const peerID of pcsRef.current.keys()) {
        await tuneVideoSender(peerID, isScreenShareTrackActive);
      }

      const screenTrack = screenTrackRef.current;
      if (screenTrack && screenTrack.readyState !== "ended") {
        await screenTrack.applyConstraints(getScreenVideoConstraints()).catch(() => {});
      }

      const cameraTrack = cameraTrackRef.current;
      if (cameraTrack && cameraTrack.readyState !== "ended") {
        await cameraTrack.applyConstraints(getCameraVideoConstraints()).catch(() => {});
      }

      await renegotiatePeersWithLocalOffer();
    },
    [
      autoStreamQualityTier,
      getCameraVideoConstraints,
      getScreenVideoConstraints,
      renegotiatePeersWithLocalOffer,
      screenEnabled,
      tuneVideoSender,
    ]
  );

  const leaveRoom = useCallback(() => {
    if (landscapeSessionRef.current) {
      landscapeSessionRef.current = false;
      try {
        const orientation: any = (window.screen as any)?.orientation;
        if (orientation && typeof orientation.unlock === "function") {
          orientation.unlock();
        }
      } catch {
        // noop
      }
      try {
        if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
          void document.exitFullscreen();
        }
      } catch {
        // noop
      }
      try {
        const docAny = document as any;
        if (typeof docAny.webkitExitFullscreen === "function") {
          docAny.webkitExitFullscreen();
        } else if (typeof docAny.webkitCancelFullScreen === "function") {
          docAny.webkitCancelFullScreen();
        }
        const videoEl = fullscreenViewportRef.current?.querySelector("video") as any;
        if (videoEl) {
          if (typeof videoEl.webkitExitFullscreen === "function") {
            videoEl.webkitExitFullscreen();
          } else if (typeof videoEl.webkitExitFullScreen === "function") {
            videoEl.webkitExitFullScreen();
          }
        }
      } catch {
        // noop
      }
    }
    leaveRoomSocket("leave-button");
    navigate("/rooms");
  }, [leaveRoomSocket, navigate]);

  const copyInvite = useCallback(async () => {
    const link = `${window.location.origin}/rooms/${encodeURIComponent(roomIDRef.current)}`;
    try {
      await navigator.clipboard.writeText(link);
      setError(t("rooms.link_copied"));
    } catch {
      setError(t("rooms.link_copy_error"));
    }
  }, [t]);

  useEffect(() => {
    if (!token || !roomId) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: number | null = null;

    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const boot = async () => {
      setLoading(true);
      setError("");
      try {
        const info = await api.liveRoomById(roomId, token);
        if (cancelled) return;
        setRoom(info);

        let local: MediaStream;
        const canUseGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);
        if (!canUseGetUserMedia) {
          setError(mediaSupportError());
          local = new MediaStream();
        } else {
          try {
            local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch (err: any) {
            rtcLog("getUserMedia(a/v) failed", String(err?.name || err));
            setError(mediaSupportError());
            local = new MediaStream();
          }
        }

        if (cancelled) {
          local.getTracks().forEach((t) => t.stop());
          return;
        }
        // Start with mic/camera off for all participants.
        local.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
        local.getVideoTracks().forEach((t) => {
          t.enabled = false;
        });
        localStreamRef.current = local;
        micTrackRef.current = local.getAudioTracks()[0] || null;
        cameraTrackRef.current = null;
        screenTrackRef.current = null;
        screenAudioTrackRef.current = null;
        setLocalScreenStream(null);
        updateSelfMediaStateRef.current(false, false, false);

        setJoining(true);
        socket = new WebSocket(roomWSURL(roomId));
        wsRef.current = socket;

        socket.onopen = () => {
          socket?.send(
            JSON.stringify({
              type: "auth",
              token,
              room_password: roomPassword || undefined,
            })
          );
          stopHeartbeat();
          heartbeatTimer = window.setInterval(() => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            try {
              ws.send(
                JSON.stringify({
                  type: "ping",
                  ts: Date.now(),
                })
              );
            } catch {
              // noop
            }
          }, 20_000);
        };

        socket.onmessage = (event) => {
          let frame: RoomSocketEvent | null = null;
          try {
            frame = JSON.parse(String(event.data)) as RoomSocketEvent;
          } catch {
            return;
          }
          if (!frame) return;
          rtcLog("ws<-", frame.type);

          switch (frame.type) {
            case "ready": {
              setRoom(frame.room);
              setSelfParticipant(frame.self);
              selfIDRef.current = frame.self.id;
              const local = localStreamRef.current;
              if (local) {
                local.getAudioTracks().forEach((t) => {
                  t.enabled = frame.self.audio_enabled;
                });
                local.getVideoTracks().forEach((t) => {
                  t.enabled = frame.self.video_enabled;
                });
              }
              updateSelfMediaStateRef.current(
                frame.self.audio_enabled,
                frame.self.video_enabled,
                Boolean(frame.self.screen_enabled)
              );

              const next: Record<string, LiveRoomParticipant> = {};
              for (const peer of frame.participants || []) {
                if (!peer?.id || peer.id === frame.self.id) continue;
                next[peer.id] = peer;
              }
              setParticipants(next);
              setJoining(false);
              setLoading(false);

              Object.keys(next).forEach((peerID) => {
                startPeerNegotiationRef.current(peerID);
                if (next[peerID]?.audio_enabled) {
                  requestAudioSyncRef.current(peerID);
                }
                if (next[peerID]?.video_enabled) {
                  requestVideoSyncRef.current(peerID);
                }
              });
              break;
            }
            case "user_joined": {
              const peer = frame.participant;
              if (!peer?.id || peer.id === selfIDRef.current) break;
              setParticipants((prev) => ({ ...prev, [peer.id]: peer }));
              startPeerNegotiationRef.current(peer.id);
              if (peer.audio_enabled) {
                requestAudioSyncRef.current(peer.id);
              }
              if (peer.video_enabled) {
                requestVideoSyncRef.current(peer.id);
              }
              break;
            }
            case "user_left": {
              const peerID = frame.user_id;
              if (!peerID) break;
              setParticipants((prev) => {
                if (!prev[peerID]) return prev;
                const next = { ...prev };
                delete next[peerID];
                return next;
              });
              removePeerRef.current(peerID);
              break;
            }
            case "participant_state_updated": {
              const peerID = frame.user_id;
              if (!peerID) break;
              if (peerID === selfIDRef.current) {
                updateSelfMediaStateRef.current(
                  frame.audio_enabled,
                  frame.video_enabled,
                  Boolean(frame.screen_enabled)
                );
                break;
              }
              setParticipants((prev) =>
                prev[peerID]
                  ? {
                      ...prev,
                      [peerID]: {
                        ...prev[peerID],
                        audio_enabled: frame.audio_enabled,
                        video_enabled: frame.video_enabled,
                        screen_enabled: Boolean(frame.screen_enabled),
                      },
                    }
                  : prev
              );
              // Ensure remote stream appears immediately when peer toggles media on.
              if (frame.audio_enabled) {
                requestAudioSyncRef.current(peerID);
              } else {
                clearAudioSyncRetriesRef.current(peerID);
              }
              if (frame.video_enabled) {
                requestVideoSyncRef.current(peerID);
              } else if (frame.audio_enabled) {
                startPeerNegotiationRef.current(peerID);
              } else {
                clearSyncRetriesRef.current(peerID);
              }
              break;
            }
            case "signal": {
              if (!frame.from_user_id) break;
              queueSignalRef.current(frame.from_user_id, frame.signal_type, frame.payload);
              break;
            }
            case "room_ended": {
              setError(t("rooms.call_ended"));
              break;
            }
            case "error": {
              const wsError = String(frame.message || "").trim().toLowerCase();
              if (wsError === "room_password_required" || wsError === "room_password_invalid") {
                const backError =
                  wsError === "room_password_invalid"
                    ? t("rooms.password_invalid")
                    : t("rooms.password_required");
                navigate("/rooms", { replace: true, state: { roomsError: backError } });
                break;
              }
              if (
                wsError === "room_not_found" ||
                wsError === "room not found"
              ) {
                navigate("/rooms", { replace: true });
                break;
              }
              if (frame.message) setError(frame.message);
              break;
            }
            case "ping": {
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(
                    JSON.stringify({
                      type: "pong",
                      ts: frame.ts ?? Date.now(),
                    })
                  );
                } catch {
                  // noop
                }
              }
              break;
            }
            case "pong":
              break;
          }
        };

        socket.onerror = () => {
          stopHeartbeat();
          socket?.close();
        };

        socket.onclose = () => {
          stopHeartbeat();
          if (wsRef.current === socket) {
            wsRef.current = null;
          }
          if (cancelled) return;
          setJoining(false);
        };
      } catch (e: any) {
        if (cancelled) return;
        if (e?.status === 404) {
          navigate("/rooms", { replace: true });
          return;
        }
        setError(e?.message || t("rooms.load_error"));
        setLoading(false);
      }
    };

    void boot();

    return () => {
      cancelled = true;
      stopHeartbeat();
      try {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "leave", reason: "component-unmount" }));
        }
      } catch {
        // noop
      }
      try {
        socket?.close();
      } catch {
        // noop
      }
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      for (const pc of pcsRef.current.values()) {
        try {
          pc.close();
        } catch {
          // noop
        }
      }
      pcsRef.current.clear();
      peerTransceiversRef.current.clear();
      pendingIceRef.current.clear();
      makingOfferRef.current.clear();
      queuedOfferRef.current.clear();
      for (const ids of syncRetryTimersRef.current.values()) {
        for (const id of ids) {
          window.clearTimeout(id);
        }
      }
      syncRetryTimersRef.current.clear();
      for (const ids of audioSyncRetryTimersRef.current.values()) {
        for (const id of ids) {
          window.clearTimeout(id);
        }
      }
      audioSyncRetryTimersRef.current.clear();
      ignoreOfferRef.current.clear();
      isSettingRemoteAnswerPendingRef.current.clear();
      signalQueueRef.current.clear();
      if (screenTrackRef.current) {
        screenTrackRef.current.onended = null;
        screenTrackRef.current.stop();
      }
      screenTrackRef.current = null;
      if (screenAudioTrackRef.current) {
        screenAudioTrackRef.current.onended = null;
        try {
          screenAudioTrackRef.current.stop();
        } catch {
          // noop
        }
      }
      screenAudioTrackRef.current = null;
      micTrackRef.current = null;
      cameraTrackRef.current = null;
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [mediaSupportError, navigate, roomId, roomPassword, rtcLog, t, token]);

  useEffect(() => {
    const onUserGesture = () => {
      resumeRemoteAudioPlayback("user-gesture");
    };
    window.addEventListener("pointerdown", onUserGesture, { passive: true });
    window.addEventListener("touchstart", onUserGesture, { passive: true });
    window.addEventListener("keydown", onUserGesture);
    return () => {
      window.removeEventListener("pointerdown", onUserGesture);
      window.removeEventListener("touchstart", onUserGesture);
      window.removeEventListener("keydown", onUserGesture);
    };
  }, [resumeRemoteAudioPlayback]);

  useEffect(() => {
    resumeRemoteAudioPlayback("streams-updated");
  }, [remoteStreams, resumeRemoteAudioPlayback]);

  useEffect(() => {
    const closeRoomSocket = (reason: string) => {
      leaveRoomSocket(reason);
    };

    const onBeforeUnload = () => closeRoomSocket("beforeunload");

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [leaveRoomSocket]);

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
    };
  }, []);

  const exitLandscapeMode = useCallback(async () => {
    if (!landscapeSessionRef.current) return;
    landscapeSessionRef.current = false;
    try {
      const orientation: any = (window.screen as any)?.orientation;
      if (orientation && typeof orientation.unlock === "function") {
        orientation.unlock();
      }
    } catch {
      // noop
    }
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
      }
    } catch {
      // noop
    }
    try {
      const docAny = document as any;
      if (typeof docAny.webkitExitFullscreen === "function") {
        docAny.webkitExitFullscreen();
      } else if (typeof docAny.webkitCancelFullScreen === "function") {
        docAny.webkitCancelFullScreen();
      }
      const videoEl = fullscreenViewportRef.current?.querySelector("video") as any;
      if (videoEl) {
        if (typeof videoEl.webkitExitFullscreen === "function") {
          videoEl.webkitExitFullscreen();
        } else if (typeof videoEl.webkitExitFullScreen === "function") {
          videoEl.webkitExitFullScreen();
        }
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    return () => {
      void exitLandscapeMode();
    };
  }, [exitLandscapeMode]);

  const openLandscapeMode = useCallback(async () => {
    landscapeSessionRef.current = true;
    const videoEl = fullscreenViewportRef.current?.querySelector("video") as any;
    if (videoEl) {
      try {
        if (typeof videoEl.play === "function") {
          await videoEl.play();
        }
      } catch {
        // noop
      }
      try {
        if (typeof videoEl.webkitEnterFullscreen === "function") {
          videoEl.webkitEnterFullscreen();
          return;
        }
        if (typeof videoEl.webkitEnterFullScreen === "function") {
          videoEl.webkitEnterFullScreen();
          return;
        }
      } catch {
        // noop
      }
      try {
        if (!document.fullscreenElement && typeof videoEl.requestFullscreen === "function") {
          await videoEl.requestFullscreen();
          return;
        }
      } catch {
        // noop
      }
    }
    const root: any = document.documentElement;

    try {
      if (!document.fullscreenElement && typeof root.requestFullscreen === "function") {
        await root.requestFullscreen();
      }
    } catch {
      // noop
    }

    try {
      const orientation: any = (window.screen as any)?.orientation;
      if (orientation && typeof orientation.lock === "function") {
        await orientation.lock("landscape");
      }
    } catch {
      // noop
    }
  }, []);

  const toggleAudio = async () => {
    const local = localStreamRef.current;
    if (!local) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(mediaSupportError());
      return;
    }

    let track = micTrackRef.current;
    if (!track || track.readyState === "ended") {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const newTrack = mic.getAudioTracks()[0];
        if (!newTrack) return;
        local.addTrack(newTrack);
        track = newTrack;
        micTrackRef.current = newTrack;
      } catch {
        setError(t("rooms.load_error"));
        return;
      }
    }

    if (!track) return;
    const next = !audioEnabled;
    rtcLog("toggle-audio", next);
    track.enabled = next;
    updateSelfMediaState(next, videoEnabled, screenEnabled);
    const screenAudio =
      screenEnabled && screenAudioTrackRef.current?.readyState !== "ended"
        ? screenAudioTrackRef.current
        : null;
    const outgoingAudioTrack = screenAudio || (next ? track : null);
    await applyOutgoingAudioTrack(outgoingAudioTrack);
    sendWS({ type: "media_state", audio_enabled: Boolean(outgoingAudioTrack) });

    if (!screenAudio) {
      await renegotiatePeersWithLocalOffer();
    }
  };

  const toggleVideo = async () => {
    if (videoBusy) return;
    const local = localStreamRef.current;
    if (!local) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(mediaSupportError());
      return;
    }
    setVideoBusy(true);
    try {
      let cameraTrack = cameraTrackRef.current;
      if (!cameraTrack || cameraTrack.readyState === "ended") {
        rtcLog("toggle-video-new-track");
        const cam = await navigator.mediaDevices.getUserMedia({
          video: getCameraVideoConstraints(cameraFacingModeRef.current, false),
        });
        const newTrack = cam.getVideoTracks()[0];
        if (!newTrack) {
          throw new Error("camera_not_available");
        }
        try {
          await newTrack.applyConstraints(getCameraVideoConstraints());
        } catch {
          // Some cameras ignore detailed constraints.
        }
        local.addTrack(newTrack);
        cameraTrackRef.current = newTrack;
        cameraTrack = newTrack;
      }

      if (!cameraTrack) {
        throw new Error("camera_not_available");
      }

      const next = !videoEnabled;
      rtcLog("toggle-video", next);
      cameraTrack.enabled = next;
      updateSelfMediaState(audioEnabled, next, screenEnabled);
      sendWS({ type: "media_state", video_enabled: next });

      if (!screenEnabled) {
        await applyOutgoingVideoTrack(next ? cameraTrack : null, { isScreenShare: false });
        await renegotiatePeersWithLocalOffer();
      }
    } catch (e: any) {
      setError(e?.message || t("rooms.camera_error"));
    } finally {
      setVideoBusy(false);
    }
  };

  const switchCameraFacing = async () => {
    if (cameraFlipBusy || videoBusy) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(mediaSupportError());
      return;
    }

    const nextFacing: "user" | "environment" =
      cameraFacingModeRef.current === "user" ? "environment" : "user";

    if (!videoEnabled) {
      setCameraFacingMode(nextFacing);
      return;
    }

    const local = localStreamRef.current;
    if (!local) return;

    setCameraFlipBusy(true);
    try {
      let cam: MediaStream;
      try {
        cam = await navigator.mediaDevices.getUserMedia({
          video: getCameraVideoConstraints(nextFacing, true),
        });
      } catch {
        cam = await navigator.mediaDevices.getUserMedia({
          video: getCameraVideoConstraints(nextFacing, false),
        });
      }

      const newTrack = cam.getVideoTracks()[0];
      if (!newTrack) {
        throw new Error("camera_not_available");
      }

      const prevTrack = cameraTrackRef.current;
      newTrack.enabled = videoEnabled;
      local.addTrack(newTrack);
      cameraTrackRef.current = newTrack;
      setCameraFacingMode(nextFacing);

      if (prevTrack) {
        try {
          local.removeTrack(prevTrack);
        } catch {
          // noop
        }
        try {
          prevTrack.stop();
        } catch {
          // noop
        }
      }

      if (!screenEnabled) {
        await applyOutgoingVideoTrack(videoEnabled ? newTrack : null, { isScreenShare: false });
        await renegotiatePeersWithLocalOffer();
      }
    } catch (e: any) {
      setError(e?.message || t("rooms.camera_flip_error"));
    } finally {
      setCameraFlipBusy(false);
    }
  };

  const stopScreenShare = useCallback(
    async (reason: "manual" | "ended" = "manual") => {
      const screenTrack = screenTrackRef.current;
      const active = screenEnabled || Boolean(screenTrack);
      if (!active) return;

      if (screenTrack) {
        screenTrack.onended = null;
        try {
          screenTrack.stop();
        } catch {
          // noop
        }
      }
      screenTrackRef.current = null;
      const screenAudioTrack = screenAudioTrackRef.current;
      if (screenAudioTrack) {
        screenAudioTrack.onended = null;
        try {
          screenAudioTrack.stop();
        } catch {
          // noop
        }
      }
      screenAudioTrackRef.current = null;
      setLocalScreenStream((prev) => {
        if (prev) {
          prev.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {
              // noop
            }
          });
        }
        return null;
      });

      const fallbackAudio =
        audioEnabled && micTrackRef.current?.readyState !== "ended"
          ? micTrackRef.current
          : null;
      await applyOutgoingAudioTrack(fallbackAudio);
      const fallbackCamera = videoEnabled ? cameraTrackRef.current : null;
      await applyOutgoingVideoTrack(fallbackCamera, { isScreenShare: false });
      updateSelfMediaState(audioEnabled, videoEnabled, false);
      sendWS({
        type: "media_state",
        screen_enabled: false,
        audio_enabled: Boolean(fallbackAudio),
      });
      if (reason !== "ended" || fallbackCamera) {
        await renegotiatePeersWithLocalOffer();
      }
    },
    [
      applyOutgoingVideoTrack,
      applyOutgoingAudioTrack,
      audioEnabled,
      renegotiatePeersWithLocalOffer,
      screenEnabled,
      sendWS,
      updateSelfMediaState,
      videoEnabled,
    ]
  );

  const toggleScreenShare = useCallback(async () => {
    if (screenBusy) return;
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
    };
    const legacyGetDisplayMedia = (navigator as Navigator & {
      getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
    }).getDisplayMedia;
    const getDisplayMedia =
      (typeof mediaDevices?.getDisplayMedia === "function"
        ? mediaDevices.getDisplayMedia.bind(mediaDevices)
        : typeof legacyGetDisplayMedia === "function"
          ? legacyGetDisplayMedia.bind(navigator)
          : null) as ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | null;

    if (!getDisplayMedia) {
      setError(t("rooms.screen_not_supported"));
      return;
    }

    if (screenEnabled) {
      await stopScreenShare("manual");
      return;
    }

    setScreenBusy(true);
    try {
      const displayOptions: any = isMobileDevice
        ? {
            video: {
              frameRate: { ideal: 30, max: 30 },
            },
            audio: false,
          }
        : {
            video: getScreenVideoConstraints(),
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              suppressLocalAudioPlayback: false,
            },
            // Keep audio hint, but do not force tab surface:
            // browser picker should still allow choosing tab/window/screen.
            systemAudio: "include",
          };

      const stream = await getDisplayMedia(displayOptions);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        throw new Error(t("rooms.screen_error"));
      }
      const screenAudioTrack = stream.getAudioTracks()[0] || null;
      if (screenAudioTrack) {
        screenAudioTrack.enabled = true;
      }
      try {
        track.contentHint = "motion";
      } catch {
        // contentHint is optional across browsers.
      }
      try {
        await track.applyConstraints(getScreenVideoConstraints());
      } catch {
        // Some browsers ignore advanced frame-rate constraints.
      }
      if (screenAudioTrack) {
        try {
          screenAudioTrack.contentHint = "music";
        } catch {
          // Optional API.
        }
      }

      screenTrackRef.current = track;
      screenAudioTrackRef.current = screenAudioTrack;
      setLocalScreenStream(new MediaStream([track]));
      track.onended = () => {
        void stopScreenShare("ended");
      };
      if (screenAudioTrack) {
        screenAudioTrack.onended = () => {
          if (!screenEnabled) return;
          if (screenAudioTrackRef.current?.id !== screenAudioTrack.id) return;
          screenAudioTrackRef.current = null;
          const fallbackAudio =
            audioEnabled && micTrackRef.current?.readyState !== "ended"
              ? micTrackRef.current
              : null;
          void applyOutgoingAudioTrack(fallbackAudio);
          sendWS({
            type: "media_state",
            screen_enabled: true,
            audio_enabled: Boolean(fallbackAudio),
          });
        };
      }

      await applyOutgoingVideoTrack(track, { isScreenShare: true });
      const outgoingAudioTrack = screenAudioTrack || (audioEnabled ? micTrackRef.current : null);
      await applyOutgoingAudioTrack(
        outgoingAudioTrack && outgoingAudioTrack.readyState !== "ended"
          ? outgoingAudioTrack
          : null
      );
      updateSelfMediaState(audioEnabled, videoEnabled, true);
      sendWS({
        type: "media_state",
        screen_enabled: true,
        audio_enabled: Boolean(outgoingAudioTrack && outgoingAudioTrack.readyState !== "ended"),
      });
      await renegotiatePeersWithLocalOffer();
    } catch (err: any) {
      setError(err?.message || t("rooms.screen_error"));
    } finally {
      setScreenBusy(false);
    }
  }, [
    getScreenVideoConstraints,
    applyOutgoingVideoTrack,
    applyOutgoingAudioTrack,
    audioEnabled,
    isMobileDevice,
    renegotiatePeersWithLocalOffer,
    screenBusy,
    screenEnabled,
    sendWS,
    stopScreenShare,
    t,
    updateSelfMediaState,
    videoEnabled,
  ]);

  const localStream = localStreamRef.current;
  const peerList = Object.values(participants);
  const localVideoTrack = cameraTrackRef.current;
  const showLocalCamera =
    Boolean(localStream) &&
    videoEnabled &&
    !screenEnabled &&
    Boolean(localVideoTrack && localVideoTrack.enabled && localVideoTrack.readyState !== "ended");

  const activeScreenShares = useMemo(() => {
    const shares: Array<{ ownerID: string; ownerName: string; stream: MediaStream; isLocal: boolean }> = [];
    if (screenEnabled && localScreenStream) {
      shares.push({
        ownerID: selfParticipant?.id || "local",
        ownerName: selfParticipant?.full_name || t("rooms.you"),
        stream: localScreenStream,
        isLocal: true,
      });
    }
    for (const peer of peerList) {
      const stream = remoteStreams[peer.id];
      if (!stream || !peer.screen_enabled) continue;
      const hasVideo = stream.getVideoTracks().some((track) => track.readyState !== "ended");
      if (!hasVideo) continue;
      shares.push({
        ownerID: peer.id,
        ownerName: peer.full_name || peer.username,
        stream,
        isLocal: false,
      });
    }
    return shares;
  }, [localScreenStream, peerList, remoteStreams, screenEnabled, selfParticipant?.full_name, selfParticipant?.id, t]);

  const expandedScreenShare = useMemo(() => {
    if (!expandedScreenOwner) return null;
    return activeScreenShares.find((item) => item.ownerID === expandedScreenOwner) || null;
  }, [activeScreenShares, expandedScreenOwner]);

  useEffect(() => {
    if (!expandedScreenOwner) return;
    if (expandedScreenShare) return;
    setExpandedScreenOwner(null);
  }, [expandedScreenOwner, expandedScreenShare]);

  useEffect(() => {
    if (!expandedScreenOwner) {
      setFullscreenZoom(1);
      setFullscreenPan({ x: 0, y: 0 });
      touchStateRef.current.mode = "none";
      suppressNextViewportTapCloseRef.current = false;
      return;
    }
    setFullscreenZoom(1);
    setFullscreenPan({ x: 0, y: 0 });
    touchStateRef.current.mode = "none";
    suppressNextViewportTapCloseRef.current = false;
  }, [expandedScreenOwner]);

  const handleFullscreenTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const touches = event.touches;
      if (touches.length === 2) {
        event.preventDefault();
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        touchStateRef.current = {
          mode: "pinch",
          startPanX: fullscreenPanRef.current.x,
          startPanY: fullscreenPanRef.current.y,
          startX: 0,
          startY: 0,
          startDistance: Math.hypot(dx, dy),
          startZoom: fullscreenZoomRef.current,
          startCenterX: (touches[0].clientX + touches[1].clientX) / 2,
          startCenterY: (touches[0].clientY + touches[1].clientY) / 2,
        };
        return;
      }
      if (touches.length === 1 && fullscreenZoomRef.current > 1.001) {
        event.preventDefault();
        touchStateRef.current = {
          mode: "pan",
          startPanX: fullscreenPanRef.current.x,
          startPanY: fullscreenPanRef.current.y,
          startX: touches[0].clientX,
          startY: touches[0].clientY,
          startDistance: 0,
          startZoom: fullscreenZoomRef.current,
          startCenterX: 0,
          startCenterY: 0,
        };
      }
    },
    []
  );

  const handleFullscreenTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      let state = touchStateRef.current;
      const touches = event.touches;
      if (touches.length === 2 && state.mode !== "pinch") {
        event.preventDefault();
        event.stopPropagation();
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        touchStateRef.current = {
          mode: "pinch",
          startPanX: fullscreenPanRef.current.x,
          startPanY: fullscreenPanRef.current.y,
          startX: 0,
          startY: 0,
          startDistance: Math.hypot(dx, dy),
          startZoom: fullscreenZoomRef.current,
          startCenterX: (touches[0].clientX + touches[1].clientX) / 2,
          startCenterY: (touches[0].clientY + touches[1].clientY) / 2,
        };
        state = touchStateRef.current;
      }
      if (state.mode === "pinch" && touches.length === 2) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextViewportTapCloseRef.current = true;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        const distance = Math.hypot(dx, dy);
        const ratio = state.startDistance > 0 ? distance / state.startDistance : 1;
        const nextZoom = Math.max(1, Math.min(4, state.startZoom * ratio));
        const centerX = (touches[0].clientX + touches[1].clientX) / 2;
        const centerY = (touches[0].clientY + touches[1].clientY) / 2;
        const viewport = fullscreenViewportRef.current;
        let nextPan = { x: 0, y: 0 };
        if (viewport) {
          const rect = viewport.getBoundingClientRect();
          const centerScreenX = rect.left + rect.width / 2;
          const centerScreenY = rect.top + rect.height / 2;
          const safeStartZoom = Math.max(0.001, state.startZoom);
          const contentX = (state.startCenterX - centerScreenX - state.startPanX) / safeStartZoom;
          const contentY = (state.startCenterY - centerScreenY - state.startPanY) / safeStartZoom;
          const targetPanX = centerX - centerScreenX - contentX * nextZoom;
          const targetPanY = centerY - centerScreenY - contentY * nextZoom;
          nextPan = clampFullscreenPan(targetPanX, targetPanY, nextZoom);
        } else {
          const dragX = centerX - state.startCenterX;
          const dragY = centerY - state.startCenterY;
          nextPan = clampFullscreenPan(
            state.startPanX + dragX,
            state.startPanY + dragY,
            nextZoom
          );
        }
        setFullscreenZoom(nextZoom);
        setFullscreenPan(nextPan);
        return;
      }
      if (state.mode === "pan" && touches.length === 1) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextViewportTapCloseRef.current = true;
        const dx = touches[0].clientX - state.startX;
        const dy = touches[0].clientY - state.startY;
        const nextPan = clampFullscreenPan(
          state.startPanX + dx,
          state.startPanY + dy,
          fullscreenZoomRef.current
        );
        setFullscreenPan(nextPan);
      }
    },
    [clampFullscreenPan]
  );

  const handleFullscreenTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touches = event.touches;
    if (touches.length === 1 && fullscreenZoomRef.current > 1.001) {
      touchStateRef.current = {
        mode: "pan",
        startPanX: fullscreenPanRef.current.x,
        startPanY: fullscreenPanRef.current.y,
        startX: touches[0].clientX,
        startY: touches[0].clientY,
        startDistance: 0,
        startZoom: fullscreenZoomRef.current,
        startCenterX: 0,
        startCenterY: 0,
      };
      return;
    }
    touchStateRef.current.mode = "none";
  }, []);

  return (
    <main
      data-page-root
      className="max-w-[672px] w-full mx-auto h-[var(--chat-mobile-vh,100dvh)] py-3 flex min-h-0 flex-col gap-3 overflow-hidden page-fade"
    >
      <div className="card p-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/rooms")}
          className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 grid place-items-center"
          aria-label={t("rooms.back")}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold truncate">{room?.title || t("rooms.default_title")}</p>
          <p className="text-xs text-white/60 inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            <span>{participantCount}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={copyInvite}
          className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 grid place-items-center"
          aria-label={t("rooms.copy_link")}
          title={t("rooms.copy_link")}
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>

      <div className="card p-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-white/55">
          {t("rooms.quality_label")}
        </span>
        <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
          {(["auto", "high", "low"] as StreamQualityMode[]).map((mode) => {
            const active = streamQualityMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (streamQualityMode === mode) return;
                  setStreamQualityMode(mode);
                  void applyQualityProfileNow(mode);
                }}
                className={`px-2.5 py-1 text-xs rounded-lg transition ${
                  active
                    ? "bg-sky-500/25 text-sky-100 border border-sky-300/35"
                    : "text-white/70 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
                aria-label={t(`rooms.quality_${mode}`)}
                title={t(`rooms.quality_${mode}`)}
              >
                {t(`rooms.quality_${mode}`)}
              </button>
            );
          })}
        </div>
      </div>
      {streamQualityMode === "auto" ? (
        <p className="px-1 text-[11px] text-white/50">
          {t("rooms.quality_now")}: {t(`rooms.quality_${effectiveStreamQualityTier}`)}
        </p>
      ) : null}

      <ErrorMessage message={error} />

      {(loading || joining) && (
        <div className="card p-6 flex items-center justify-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{t("rooms.joining")}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {activeScreenShares.length > 0 ? (
          <div className="mb-2 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-white/55">{t("rooms.screen_share_active")}</p>
            <div className="grid grid-cols-1 gap-2">
              {activeScreenShares.map((share) => (
                <button
                  key={share.ownerID}
                  type="button"
                  onClick={() => setExpandedScreenOwner(share.ownerID)}
                  className="relative h-[180px] sm:h-[240px] overflow-hidden rounded-2xl border border-sky-300/35 bg-black/40 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60"
                >
                  <VideoView stream={share.stream} muted mirror={false} fitClassName="object-contain" />
                  <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/35 bg-sky-500/20 px-2 py-0.5 text-xs text-sky-100">
                      <MonitorUp className="w-3 h-3" />
                      <span className="truncate">{share.ownerName}</span>
                    </span>
                    <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white/80">
                      {t("rooms.screen_open_full")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 auto-rows-[150px] sm:auto-rows-[180px]">
          <div className="relative rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
            {showLocalCamera && localStream ? (
              <VideoView stream={localStream} muted />
            ) : (
              <div className="absolute inset-0 grid place-items-center">
                <AvatarCircle
                  src={selfParticipant?.avatar_url}
                  fallback={selfParticipant?.full_name || selfParticipant?.username || "You"}
                  className="w-14 h-14 text-base font-semibold"
                />
              </div>
            )}
            <div className="absolute left-2 right-2 bottom-2 flex items-center justify-between gap-2">
              <p className="text-xs text-white truncate inline-flex items-center gap-[3px]">
                <span>{selfParticipant?.full_name || t("rooms.you")}</span>
                {selfParticipant?.is_verified ? <VerifiedBadge /> : null}
              </p>
              <span className="inline-flex items-center gap-1 text-[11px] text-white/70">
                {audioEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                {videoEnabled ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                {screenEnabled ? <MonitorUp className="w-3 h-3" /> : null}
              </span>
            </div>
          </div>

          {peerList.map((peer) => {
            const stream = remoteStreams[peer.id];
            const showVideo = Boolean(
              stream &&
                peer.video_enabled &&
                !peer.screen_enabled &&
                stream.getVideoTracks().some((track) => track.readyState !== "ended")
            );
            return (
              <div
                key={peer.id}
                className="relative rounded-2xl border border-white/10 bg-black/40 overflow-hidden"
              >
                {stream ? <AudioView stream={stream} /> : null}
                {showVideo && stream ? (
                  <VideoView stream={stream} muted />
                ) : (
                  <div className="absolute inset-0 grid place-items-center">
                    <AvatarCircle
                      src={peer.avatar_url}
                      fallback={peer.full_name || peer.username}
                      className="w-14 h-14 text-base font-semibold"
                    />
                  </div>
                )}
                <div className="absolute left-2 right-2 bottom-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-white truncate inline-flex items-center gap-[3px]">
                    <span>{peer.full_name}</span>
                    {peer.is_verified ? <VerifiedBadge /> : null}
                  </p>
                  <span className="inline-flex items-center gap-1 text-[11px] text-white/70">
                    {peer.audio_enabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                    {peer.video_enabled ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                    {peer.screen_enabled ? <MonitorUp className="w-3 h-3" /> : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {audioUnlockRequired ? (
        <div className="px-1">
          <button
            type="button"
            onClick={() => resumeRemoteAudioPlayback("manual-unlock")}
            className="w-full rounded-xl border border-amber-300/35 bg-amber-500/20 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/30 transition"
          >
            {t("rooms.enable_sound")}
          </button>
        </div>
      ) : null}

      <div className="card p-3 flex items-center justify-center gap-3 mb-[calc(env(safe-area-inset-bottom)+0.25rem)]">
        <button
          type="button"
          onClick={toggleAudio}
          className={`w-11 h-11 rounded-full border grid place-items-center transition ${
            audioEnabled
              ? "border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
              : "border-amber-300/35 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
          }`}
          aria-label={audioEnabled ? t("rooms.mic_off") : t("rooms.mic_on")}
          title={audioEnabled ? t("rooms.mic_off") : t("rooms.mic_on")}
        >
          {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={toggleVideo}
          disabled={videoBusy}
          className={`w-11 h-11 rounded-full border grid place-items-center transition disabled:opacity-60 ${
            videoEnabled
              ? "border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
              : "border-sky-300/35 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
          }`}
          aria-label={videoEnabled ? t("rooms.camera_off") : t("rooms.camera_on")}
          title={videoEnabled ? t("rooms.camera_off") : t("rooms.camera_on")}
        >
          {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        {canFlipCamera ? (
          <button
            type="button"
            onClick={switchCameraFacing}
            disabled={videoBusy || screenBusy || cameraFlipBusy}
            className="w-11 h-11 rounded-full border border-white/15 bg-white/5 text-white/85 hover:bg-white/10 grid place-items-center transition disabled:opacity-60"
            aria-label={t("rooms.camera_flip")}
            title={t("rooms.camera_flip")}
          >
            <RefreshCw className={`w-5 h-5 ${cameraFlipBusy ? "animate-spin" : ""}`} />
          </button>
        ) : null}

        <button
          type="button"
          onClick={toggleScreenShare}
          disabled={screenBusy}
          className={`w-11 h-11 rounded-full border grid place-items-center transition disabled:opacity-60 ${
            screenEnabled
              ? "border-sky-300/35 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
              : "border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
          }`}
          aria-label={screenEnabled ? t("rooms.screen_off") : t("rooms.screen_on")}
          title={screenEnabled ? t("rooms.screen_off") : t("rooms.screen_on")}
        >
          <MonitorUp className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={leaveRoom}
          className="w-11 h-11 rounded-full border border-red-400/45 bg-red-500/20 text-red-100 hover:bg-red-500/30 grid place-items-center"
          aria-label={t("rooms.leave")}
          title={t("rooms.leave")}
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>

      {expandedScreenShare ? (
        <div
          className="fixed inset-0 z-[90] bg-black/95 p-3 sm:p-5 flex flex-col gap-3"
          onClick={() => setExpandedScreenOwner(null)}
        >
          <div className="flex items-center justify-between" onClick={(event) => event.stopPropagation()}>
            <p className="text-white/90 text-sm inline-flex items-center gap-2">
              <MonitorUp className="w-4 h-4 text-sky-300" />
              <span className="truncate">{expandedScreenShare.ownerName}</span>
            </p>
            <button
              type="button"
              onClick={() => setExpandedScreenOwner(null)}
              className="w-10 h-10 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/90 grid place-items-center"
              aria-label={t("rooms.screen_close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div
            ref={fullscreenViewportRef}
            className="relative min-h-0 flex-1 rounded-2xl border border-white/15 overflow-hidden bg-black touch-none"
            onClick={(event) => {
              event.stopPropagation();
              if (suppressNextViewportTapCloseRef.current) {
                suppressNextViewportTapCloseRef.current = false;
                return;
              }
              if (fullscreenZoom <= 1.01) {
                setExpandedScreenOwner(null);
              }
            }}
            onTouchStart={handleFullscreenTouchStart}
            onTouchMove={handleFullscreenTouchMove}
            onTouchEnd={handleFullscreenTouchEnd}
            onTouchCancel={handleFullscreenTouchEnd}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void openLandscapeMode();
              }}
              className="absolute top-2 right-2 z-20 w-10 h-10 rounded-full border border-indigo-300/35 bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/35 grid place-items-center"
              aria-label={t("rooms.screen_open_full")}
              title={t("rooms.screen_open_full")}
            >
              <Maximize className="w-5 h-5" />
            </button>
            <div
              className="absolute inset-0 will-change-transform"
              style={{
                transform: `translate3d(${fullscreenPan.x}px, ${fullscreenPan.y}px, 0) scale(${fullscreenZoom})`,
                transformOrigin: "center center",
              }}
            >
              <VideoView
                stream={expandedScreenShare.stream}
                muted
                mirror={false}
                fitClassName="object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
