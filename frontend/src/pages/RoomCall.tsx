import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Video,
  VideoOff,
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
    }
  | {
      type: "signal";
      room_id: string;
      from_user_id: string;
      signal_type: "offer" | "answer" | "ice-candidate" | "renegotiate-request";
      payload: any;
    }
  | { type: "error"; message?: string }
  | { type: "room_ended"; room_id: string };

type PeerTransceivers = {
  audio: RTCRtpTransceiver | null;
  video: RTCRtpTransceiver | null;
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
}: {
  stream: MediaStream;
  muted?: boolean;
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
      className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
      style={{ transform: "scaleX(-1)" }}
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
  const [videoBusy, setVideoBusy] = useState(false);
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const selfIDRef = useRef<string>("");
  const localStreamRef = useRef<MediaStream | null>(null);
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
  roomIDRef.current = roomId;

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
  }, [remoteStreams]);

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

  const updateSelfMediaState = useCallback((audio: boolean, video: boolean) => {
    setAudioEnabled(audio);
    setVideoEnabled(video);
    setSelfParticipant((prev) =>
      prev
        ? {
            ...prev,
            audio_enabled: audio,
            video_enabled: video,
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
        const localAudio = local.getAudioTracks()[0];
        if (localAudio) {
          void audioTransceiver.sender.replaceTrack(localAudio).catch(() => {});
        }
        const localVideo = local.getVideoTracks()[0];
        if (localVideo) {
          void videoTransceiver.sender.replaceTrack(localVideo).catch(() => {});
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
    [clearAudioSyncRetries, clearSyncRetries, preferH264ForVideo, removePeer, resumeRemoteAudioPlayback, rtcLog, sendWS]
  );

  const attachTrackToPeer = useCallback(
    async (peerID: string, track: MediaStreamTrack) => {
      const transceivers = peerTransceiversRef.current.get(peerID);
      const transceiver = track.kind === "audio" ? transceivers?.audio : transceivers?.video;
      if (transceiver) {
        if (transceiver.direction === "recvonly" || transceiver.direction === "inactive") {
          transceiver.direction = "sendrecv";
        }
        await transceiver.sender.replaceTrack(track).catch(() => {});
        return;
      }

      const pc = pcsRef.current.get(peerID);
      const local = localStreamRef.current;
      if (!pc || !local) return;
      pc.addTrack(track, local);
    },
    []
  );

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

  const leaveRoom = useCallback(() => {
    wsRef.current?.close();
    navigate("/rooms");
  }, [navigate]);

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
        updateSelfMediaState(false, false);

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
              updateSelfMediaState(frame.self.audio_enabled, frame.self.video_enabled);

              const next: Record<string, LiveRoomParticipant> = {};
              for (const peer of frame.participants || []) {
                if (!peer?.id || peer.id === frame.self.id) continue;
                next[peer.id] = peer;
              }
              setParticipants(next);
              setJoining(false);
              setLoading(false);

              Object.keys(next).forEach((peerID) => {
                startPeerNegotiation(peerID);
                if (next[peerID]?.audio_enabled) {
                  requestAudioSync(peerID);
                }
                if (next[peerID]?.video_enabled) {
                  requestVideoSync(peerID);
                }
              });
              break;
            }
            case "user_joined": {
              const peer = frame.participant;
              if (!peer?.id || peer.id === selfIDRef.current) break;
              setParticipants((prev) => ({ ...prev, [peer.id]: peer }));
              startPeerNegotiation(peer.id);
              if (peer.audio_enabled) {
                requestAudioSync(peer.id);
              }
              if (peer.video_enabled) {
                requestVideoSync(peer.id);
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
              removePeer(peerID);
              break;
            }
            case "participant_state_updated": {
              const peerID = frame.user_id;
              if (!peerID) break;
              if (peerID === selfIDRef.current) {
                updateSelfMediaState(frame.audio_enabled, frame.video_enabled);
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
                      },
                    }
                  : prev
              );
              // Ensure remote stream appears immediately when peer toggles media on.
              if (frame.audio_enabled) {
                requestAudioSync(peerID);
              } else {
                clearAudioSyncRetries(peerID);
              }
              if (frame.video_enabled) {
                requestVideoSync(peerID);
              } else if (frame.audio_enabled) {
                startPeerNegotiation(peerID);
              } else {
                clearSyncRetries(peerID);
              }
              break;
            }
            case "signal": {
              if (!frame.from_user_id) break;
              queueSignal(frame.from_user_id, frame.signal_type, frame.payload);
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
          }
        };

        socket.onerror = () => {
          socket?.close();
        };

        socket.onclose = () => {
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
      try {
        socket?.close();
      } catch {
        // noop
      }
      wsRef.current = null;
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
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [clearAudioSyncRetries, clearSyncRetries, mediaSupportError, navigate, queueSignal, removePeer, requestAudioSync, requestVideoSync, roomId, roomPassword, rtcLog, startPeerNegotiation, token, updateSelfMediaState]);

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

  const toggleAudio = async () => {
    const local = localStreamRef.current;
    if (!local) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(mediaSupportError());
      return;
    }

    let track = local.getAudioTracks()[0];
    if (!track || track.readyState === "ended") {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const newTrack = mic.getAudioTracks()[0];
        if (!newTrack) return;
        local.addTrack(newTrack);
        track = newTrack;
        for (const peerID of pcsRef.current.keys()) {
          await attachTrackToPeer(peerID, newTrack);
        }
      } catch {
        setError(t("rooms.load_error"));
        return;
      }
    }

    const next = !audioEnabled;
    rtcLog("toggle-audio", next);
    track.enabled = next;
    updateSelfMediaState(next, videoEnabled);
    sendWS({ type: "media_state", audio_enabled: next });

    if (next) {
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
      const existing = local.getVideoTracks()[0];
      if (existing) {
        const next = !existing.enabled;
        rtcLog("toggle-video-existing", next);
        existing.enabled = next;
        updateSelfMediaState(audioEnabled, next);
        sendWS({ type: "media_state", video_enabled: next });
        if (next) {
          await renegotiatePeersWithLocalOffer();
        }
      } else {
        rtcLog("toggle-video-new-track");
        const cam = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = cam.getVideoTracks()[0];
        if (!videoTrack) {
          throw new Error("camera_not_available");
        }
        local.addTrack(videoTrack);
        for (const peerID of pcsRef.current.keys()) {
          await attachTrackToPeer(peerID, videoTrack);
        }
        updateSelfMediaState(audioEnabled, true);
        sendWS({ type: "media_state", video_enabled: true });
        await renegotiatePeersWithLocalOffer();
      }
    } catch (e: any) {
      setError(e?.message || t("rooms.camera_error"));
    } finally {
      setVideoBusy(false);
    }
  };

  const localStream = localStreamRef.current;
  const peerList = Object.values(participants);

  return (
    <main
      data-page-root
      className="max-w-[672px] w-full mx-auto h-[var(--chat-mobile-vh,100dvh)] min-[871px]:h-auto py-3 min-[871px]:py-6 flex flex-col gap-3 page-fade"
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

      <ErrorMessage message={error} />

      {(loading || joining) && (
        <div className="card p-6 flex items-center justify-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{t("rooms.joining")}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2 auto-rows-[150px] sm:auto-rows-[180px]">
          <div className="relative rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
            {localStream && videoEnabled && localStream.getVideoTracks().some((t) => t.enabled) ? (
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
              </span>
            </div>
          </div>

          {peerList.map((peer) => {
            const stream = remoteStreams[peer.id];
            const showVideo = Boolean(stream && peer.video_enabled && stream.getVideoTracks().length > 0);
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
    </main>
  );
}
