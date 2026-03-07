/**
 * useGeminiLive — Low-latency rewrite
 *
 * Key latency fixes:
 *  1. INPUT: 320-sample ScriptProcessor = 20ms chunks at 16kHz.
 *     Google's own best-practices docs say send in 20-100ms chunks.
 *     Previous version sent 256ms chunks (4096 samples) — huge input delay.
 *     Original sent correct-size chunks but with the WRONG field name (`media`
 *     instead of `audio`), so Gemini silently dropped all mic audio.
 *
 *  2. OUTPUT: Play the FIRST audio chunk immediately — zero pre-buffering.
 *     Use a look-ahead clock (40ms) to schedule subsequent chunks gaplessly
 *     without any clock drift.
 *     On barge-in / interrupt, flush the queue in one synchronous call.
 *
 *  3. No stale closures: voiceState tracked via ref so handleMessage is stable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { API_URL } from '@/utils/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// 512 samples @ 16 kHz = 32 ms — smallest power-of-two valid for
// createScriptProcessor that still hits Google's recommended 20-100ms range.
// (320 is not a valid buffer size — must be a power of two between 256-16384)
const MIC_BUFFER_SIZE = 512;

// Look-ahead for output scheduling. 40 ms avoids glitches without adding
// perceptible delay before playback starts.
const SCHEDULE_AHEAD_SEC = 0.04;

// ─── Audio helpers ────────────────────────────────────────────────────────────

function base64ToFloat32(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
  return float32;
}

function float32ToBase64Pcm(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// ─── Gapless output scheduler ─────────────────────────────────────────────────
//
// Rules:
//  • First chunk in a turn: play at ctx.currentTime + SCHEDULE_AHEAD_SEC
//    (practically "now") — no buffering delay.
//  • Subsequent chunks: play right after the previous one ends.
//  • After flush(): nextTime resets to 0 so the next chunk plays immediately.

class AudioScheduler {
  constructor(ctx, mixDest) {
    this.ctx = ctx;
    this.nextTime = 0;
    this._sources = new Set();
    this._mixDest = mixDest || null; // MediaStreamDestination for recording
  }

  setMixDest(dest) { this._mixDest = dest; }

  enqueue(b64pcm) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;

    let float32;
    try { float32 = base64ToFloat32(b64pcm); }
    catch (_) { return; }

    const buf = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buf.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    // Also route to recording mix destination
    if (this._mixDest) {
      try { src.connect(this._mixDest); } catch (_) { }
    }

    const earliest = ctx.currentTime + SCHEDULE_AHEAD_SEC;
    const startAt = Math.max(this.nextTime, earliest);
    src.start(startAt);
    this.nextTime = startAt + buf.duration;

    this._sources.add(src);
    src.onended = () => this._sources.delete(src);
  }

  flush() {
    for (const src of this._sources) {
      try { src.stop(); } catch (_) { }
    }
    this._sources.clear();
    this.nextTime = 0; // reset → next chunk plays immediately
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export default function useGeminiLive() {
  // ── Public state ────────────────────────────────────────────────────────────
  const [connectionState, setConnectionState] = useState('idle');
  const [voiceState, setVoiceState] = useState('idle');
  const [muted, _setMuted] = useState(false);
  const [transcript, setTranscript] = useState([]);

  // ── Refs (stable across renders) ────────────────────────────────────────────
  const mutedRef = useRef(false);
  const transcriptRef = useRef([]);
  const voiceStateRef = useRef('idle');
  const sessionRef = useRef(null);
  const clientRef = useRef(null);
  const isClosingRef = useRef(false);

  // Output audio
  const outputCtxRef = useRef(null);
  const schedulerRef = useRef(null);

  // Input audio
  const inputCtxRef = useRef(null);
  const streamRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);

  // ── Recording ─────────────────────────────────────────────────────────────
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingBlobRef = useRef(null);
  const mixDestRef = useRef(null);
  const micSourceForMixRef = useRef(null);

  // ── Internal setters ─────────────────────────────────────────────────────────

  const _setVoiceState = useCallback((s) => {
    voiceStateRef.current = s;
    setVoiceState(s);
  }, []);

  const setMuted = useCallback((next) => {
    const val = typeof next === 'function' ? next(mutedRef.current) : !!next;
    mutedRef.current = val;
    _setMuted(val);
  }, []);

  const resetTranscript = useCallback(() => {
    transcriptRef.current = [];
    setTranscript([]);
  }, []);

  const getCleanTranscript = useCallback(() =>
    transcriptRef.current
      .filter(t => t?.text?.trim())
      .map(t => ({ ...t, final: true })),
    []);

  const getRecordingBlob = useCallback(() => recordingBlobRef.current, []);

  // ── Output audio ─────────────────────────────────────────────────────────────

  const ensureOutputAudio = useCallback(() => {
    const existing = outputCtxRef.current;
    if (existing && existing.state !== 'closed' && schedulerRef.current) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor({ sampleRate: OUTPUT_SAMPLE_RATE });
    outputCtxRef.current = ctx;

    // Create a mix destination for recording AI output audio
    try {
      mixDestRef.current = ctx.createMediaStreamDestination();
    } catch (_) { }

    schedulerRef.current = new AudioScheduler(ctx, mixDestRef.current);
  }, []);

  // ── Microphone ────────────────────────────────────────────────────────────────

  const stopMicrophone = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch (_) { }
    try { sourceRef.current?.disconnect(); } catch (_) { }
    try { inputCtxRef.current?.close(); } catch (_) { }
    try { micSourceForMixRef.current?.disconnect(); } catch (_) { }

    streamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current = sourceRef.current = inputCtxRef.current = streamRef.current = micSourceForMixRef.current = null;
  }, []);

  const startMicrophone = useCallback(async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const Ctor = window.AudioContext || window.webkitAudioContext;
      inputCtxRef.current = new Ctor({ sampleRate: INPUT_SAMPLE_RATE });
      sourceRef.current = inputCtxRef.current.createMediaStreamSource(streamRef.current);

      // 320 samples = 20 ms per onaudioprocess call — optimal chunk size
      processorRef.current = inputCtxRef.current.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);

      processorRef.current.onaudioprocess = (e) => {
        if (mutedRef.current || isClosingRef.current || !sessionRef.current) return;
        const b64 = float32ToBase64Pcm(e.inputBuffer.getChannelData(0));
        try {
          // ✓ Correct field name: `audio` (not deprecated `media` / `mediaChunks`)
          sessionRef.current.sendRealtimeInput({
            audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
          });
        } catch (_) { }
      };

      sourceRef.current.connect(processorRef.current);
      processorRef.current.connect(inputCtxRef.current.destination);

      // ── Start recording (mixed mic + AI stream) ───────────────────
      try {
        recordedChunksRef.current = [];
        recordingBlobRef.current = null;

        const mixDest = mixDestRef.current;
        if (!mixDest) throw new Error("No mix destination available");

        // Pipe microphone into the output context's mix destination (without sending to speakers)
        if (outputCtxRef.current) {
          const micMixSrc = outputCtxRef.current.createMediaStreamSource(streamRef.current);
          micMixSrc.connect(mixDest);
          micSourceForMixRef.current = micMixSrc;
        }

        // Record the mixed stream from the destination node (contains AI audio + mic audio)
        const combinedStream = mixDest.stream;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(combinedStream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          if (recordedChunksRef.current.length > 0) {
            recordingBlobRef.current = new Blob(recordedChunksRef.current, { type: mimeType });
          }
        };
        recorder.start(1000); // 1-second chunks
        recorderRef.current = recorder;
      } catch (recErr) {
        console.warn('[useGeminiLive] Recording init failed (non-fatal):', recErr);
      }
    } catch (err) {
      stopMicrophone();
      throw err;
    }
  }, [stopMicrophone]);

  // ── Message handler — stable (only depends on _setVoiceState which is memo'd)

  const handleMessage = useCallback((message) => {
    const sc = message?.serverContent;
    if (!sc) return;

    // 1. Audio output — schedule immediately, no pre-buffering
    for (const part of (sc.modelTurn?.parts ?? [])) {
      const data = part.inlineData?.data;
      if (data && schedulerRef.current) {
        schedulerRef.current.enqueue(data);
        if (voiceStateRef.current !== 'speaking') _setVoiceState('speaking');
      }
    }

    // 2. Transcripts
    let cur = transcriptRef.current;
    let changed = false;

    const aiText = sc.outputTranscription?.text;
    if (aiText) {
      const last = cur[cur.length - 1];
      if (last?.speaker === 'ai' && !last.final) {
        cur = [...cur.slice(0, -1), { ...last, text: last.text + (last.text.endsWith(' ') ? '' : ' ') + aiText }];
      } else {
        const base = last && !last.final ? [...cur.slice(0, -1), { ...last, final: true }] : cur;
        cur = [...base, { speaker: 'ai', text: aiText, final: false }];
      }
      changed = true;
    }

    const userText = sc.inputTranscription?.text;
    if (userText) {
      const last = cur[cur.length - 1];
      if (last?.speaker === 'user' && !last.final) {
        cur = [...cur.slice(0, -1), { ...last, text: last.text + (last.text.endsWith(' ') ? '' : ' ') + userText }];
      } else {
        const base = last && !last.final ? [...cur.slice(0, -1), { ...last, final: true }] : cur;
        cur = [...base, { speaker: 'user', text: userText, final: false }];
      }
      changed = true;
    }

    // 3. Turn complete
    if (sc.turnComplete) {
      if (voiceStateRef.current !== 'listening') _setVoiceState('listening');
      const last = cur[cur.length - 1];
      if (last && !last.final) { cur = [...cur.slice(0, -1), { ...last, final: true }]; changed = true; }
    }

    // 4. Interrupted — flush queued audio immediately so model stops mid-word
    if (sc.interrupted) {
      schedulerRef.current?.flush();
      if (voiceStateRef.current !== 'listening') _setVoiceState('listening');
      const last = cur[cur.length - 1];
      if (last && !last.final) { cur = [...cur.slice(0, -1), { ...last, final: true }]; changed = true; }
    }

    if (changed) {
      transcriptRef.current = cur;
      setTranscript(cur);
    }
  }, [_setVoiceState]);

  // ── sendText ──────────────────────────────────────────────────────────────────

  const sendText = useCallback((text, { role = 'user', turnComplete = true } = {}) => {
    if (!sessionRef.current) return;
    try {
      sessionRef.current.sendClientContent({ turns: [{ role, parts: [{ text }] }], turnComplete });
    } catch (_) { }
  }, []);

  // ── disconnect ────────────────────────────────────────────────────────────────

  const disconnect = useCallback(async ({ reason = 'user', onClose } = {}) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    // Stop recording before tearing down audio
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    } catch (_) { }
    recorderRef.current = null;

    const sess = sessionRef.current;
    sessionRef.current = clientRef.current = null;
    stopMicrophone();
    schedulerRef.current?.flush();
    try { sess?.disconnect(); } catch (_) { }
    setConnectionState('closed');
    _setVoiceState('idle');
    onClose?.({ reason, transcript: getCleanTranscript() });
  }, [_setVoiceState, getCleanTranscript, stopMicrophone]);

  // ── fetchEphemeralToken ───────────────────────────────────────────────────────

  const fetchEphemeralToken = useCallback(async ({ sessionId, systemPrompt, authToken }) => {
    const res = await fetch(`${API_URL}/sessions/live-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ session_id: sessionId, system_prompt: systemPrompt ?? '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `Token fetch failed: ${res.status}`);
    }
    return (await res.json()).token;
  }, []);

  // ── connect ───────────────────────────────────────────────────────────────────

  const connect = useCallback(async ({
    sessionId,
    authToken,
    systemPrompt = '',
    responseModalities = ['AUDIO'],
    config = {},
    resetTranscriptOnConnect = true,
    onConnected,
    onClose,
    onError,
  }) => {
    ensureOutputAudio();
    if (!sessionId || !authToken) {
      const err = new Error('sessionId and authToken are required');
      onError?.(err);
      throw err;
    }
    if (resetTranscriptOnConnect) resetTranscript();
    isClosingRef.current = false;
    setConnectionState('connecting');
    _setVoiceState('idle');

    try {
      await outputCtxRef.current?.resume();

      const ephemeralToken = await fetchEphemeralToken({ sessionId, systemPrompt, authToken });

      clientRef.current = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      let openFired = false;

      const afterOpen = async () => {
        setConnectionState('active');
        _setVoiceState('listening');
        await startMicrophone();
        onConnected?.({ sendText });
      };

      const session = await clientRef.current.live.connect({
        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
        config: { responseModalities, ...config },
        callbacks: {
          onopen: () => { openFired = true; if (sessionRef.current) afterOpen(); },
          onmessage: handleMessage,
          onerror: (e) => { setConnectionState('error'); onError?.(e); },
          onclose: () => { if (!isClosingRef.current) disconnect({ reason: 'remote', onClose }); },
        },
      });

      sessionRef.current = session;
      if (openFired) await afterOpen();
      return session;
    } catch (err) {
      setConnectionState('error');
      try { await disconnect({ reason: 'error' }); } catch (_) { }
      onError?.(err);
      throw err;
    }
  }, [_setVoiceState, disconnect, ensureOutputAudio, fetchEphemeralToken, handleMessage, resetTranscript, sendText, startMicrophone]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    ensureOutputAudio();
    return () => {
      disconnect({ reason: 'unmount' }).catch(() => { });
      try { outputCtxRef.current?.close(); } catch (_) { }
      outputCtxRef.current = schedulerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { connectionState, voiceState, transcript, transcriptRef, muted, setMuted, resetTranscript, getCleanTranscript, getRecordingBlob, connect, disconnect, sendText };
}