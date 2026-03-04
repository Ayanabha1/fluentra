import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { API_URL } from '@/utils/api';

function createAudioBufferFromRaw(ctx, arrayBuffer) {
  const rawBytes = new Uint8Array(arrayBuffer);
  const numFrames = rawBytes.length / 2;
  const buffer = ctx.createBuffer(1, numFrames, 24000);
  const int16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, numFrames);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
  buffer.copyToChannel(float32, 0);
  return buffer;
}

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s * 32768;
  }
  return int16;
}

function safeStopAllSources(sourcesRef, nextStartTimeRef) {
  for (const source of sourcesRef.current.values()) {
    try { source.stop(); } catch (_) { }
  }
  sourcesRef.current.clear();
  nextStartTimeRef.current = 0;
}

export default function useGeminiLive() {
  const [connectionState, setConnectionState] = useState('idle'); // idle | connecting | active | closed | error
  const [voiceState, setVoiceState] = useState('idle'); // idle | listening | speaking
  const [muted, _setMuted] = useState(false);
  const mutedRef = useRef(false);

  const [transcript, setTranscript] = useState([]);
  const transcriptRef = useRef([]);

  const sessionRef = useRef(null);
  const isClosingRef = useRef(false);
  const clientRef = useRef(null);

  // Output audio (24kHz)
  const outputAudioContextRef = useRef(null);
  const outputGainRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);

  // Input audio (16kHz)
  const inputAudioContextRef = useRef(null);
  const streamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);

  const ensureOutputAudio = useCallback(() => {
    const existing = outputAudioContextRef.current;
    if (existing && existing.state !== 'closed' && outputGainRef.current) return;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor({ sampleRate: 24000 });
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    outputAudioContextRef.current = ctx;
    outputGainRef.current = gain;
    nextStartTimeRef.current = ctx.currentTime;
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

  const getCleanTranscript = useCallback(() => {
    return transcriptRef.current
      .filter(t => t?.text?.trim())
      .map(t => ({ ...t, final: true }));
  }, []);

  const playAudio = useCallback((data) => {
    const ctx = outputAudioContextRef.current;
    const gain = outputGainRef.current;
    if (!ctx || !gain || ctx.state === 'closed') return;

    const binaryStr = atob(data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const audioBuffer = createAudioBufferFromRaw(ctx, bytes.buffer);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(gain);

    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
    src.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;

    sourcesRef.current.add(src);
    src.addEventListener('ended', () => sourcesRef.current.delete(src));

    if (voiceState !== 'speaking') setVoiceState('speaking');
  }, [voiceState]);

  const stopMicrophone = useCallback(() => {
    try { scriptProcessorRef.current?.disconnect(); } catch (_) { }
    try { sourceNodeRef.current?.disconnect(); } catch (_) { }
    scriptProcessorRef.current = null;
    sourceNodeRef.current = null;

    try { inputAudioContextRef.current?.close(); } catch (_) { }
    inputAudioContextRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;

      const Ctor = window.AudioContext || window.webkitAudioContext;
      const inputCtx = new Ctor({ sampleRate: 16000 });
      inputAudioContextRef.current = inputCtx;

      sourceNodeRef.current = inputCtx.createMediaStreamSource(stream);
      scriptProcessorRef.current = inputCtx.createScriptProcessor(256, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (e) => {
        if (mutedRef.current || isClosingRef.current || !sessionRef.current) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = float32ToInt16(float32);
        const bytes = new Uint8Array(int16.buffer);

        let binary = '';
        const chunkSize = 1024;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }

        try {
          sessionRef.current.sendRealtimeInput({
            media: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' },
          });
        } catch (_) { }
      };

      sourceNodeRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputCtx.destination);
    } catch (err) {
      stopMicrophone();
      throw err;
    }
  }, [stopMicrophone]);

  const handleMessage = useCallback((message) => {
    const audioPart = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
    if (audioPart?.data) playAudio(audioPart.data);

    let changed = false;
    let cur = transcriptRef.current;

    const outputTranscript = message.serverContent?.outputTranscription?.text;
    if (outputTranscript) {
      const last = cur[cur.length - 1];
      if (last && last.speaker === 'ai' && !last.final) {
        const sep = last.text.endsWith(' ') ? '' : ' ';
        cur = [...cur.slice(0, -1), { ...last, text: last.text + sep + outputTranscript }];
      } else {
        const base = (last && !last.final) ? [...cur.slice(0, -1), { ...last, final: true }] : cur;
        cur = [...base, { speaker: 'ai', text: outputTranscript, final: false }];
      }
      changed = true;
    }

    const inputTranscript = message.serverContent?.inputTranscription?.text;
    if (inputTranscript) {
      const last = cur[cur.length - 1];
      if (last && last.speaker === 'user' && !last.final) {
        const sep = last.text.endsWith(' ') ? '' : ' ';
        cur = [...cur.slice(0, -1), { ...last, text: last.text + sep + inputTranscript }];
      } else {
        const base = (last && !last.final) ? [...cur.slice(0, -1), { ...last, final: true }] : cur;
        cur = [...base, { speaker: 'user', text: inputTranscript, final: false }];
      }
      changed = true;
    }

    if (message.serverContent?.turnComplete) {
      if (voiceState !== 'listening') setVoiceState('listening');
      const last = cur[cur.length - 1];
      if (last && !last.final) {
        cur = [...cur.slice(0, -1), { ...last, final: true }];
        changed = true;
      }
    }

    if (message.serverContent?.interrupted) {
      safeStopAllSources(sourcesRef, nextStartTimeRef);
      if (voiceState !== 'listening') setVoiceState('listening');
      const last = cur[cur.length - 1];
      if (last && !last.final) {
        cur = [...cur.slice(0, -1), { ...last, final: true }];
        changed = true;
      }
    }

    if (changed) {
      transcriptRef.current = cur;
      setTranscript(cur);
    }
  }, [playAudio, voiceState]);

  const sendText = useCallback((text, { role = 'user', turnComplete = true } = {}) => {
    if (!sessionRef.current) return;
    try {
      sessionRef.current.sendClientContent({
        turns: [{ role, parts: [{ text }] }],
        turnComplete,
      });
    } catch (_) { }
  }, []);

  const disconnect = useCallback(async ({ reason = 'user', onClose } = {}) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    const sess = sessionRef.current;
    sessionRef.current = null;

    // Reset client so next connect() gets a fresh one with a new token
    clientRef.current = null;

    stopMicrophone();
    safeStopAllSources(sourcesRef, nextStartTimeRef);

    try { sess?.disconnect(); } catch (_) { }

    setConnectionState('closed');
    setVoiceState('idle');
    onClose?.({ reason, transcript: getCleanTranscript() });
  }, [getCleanTranscript, stopMicrophone]);

  // ── Fetch ephemeral token from your backend ──────────────────────────────────
  const fetchEphemeralToken = useCallback(async ({ sessionId, systemPrompt, authToken }) => {
    const res = await fetch(`${API_URL}/sessions/live-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        system_prompt: systemPrompt || '',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Token fetch failed: ${res.status}`);
    }

    const data = await res.json();
    return data.token; // short-lived ephemeral token
  }, []);

  // ── Main connect ─────────────────────────────────────────────────────────────
  const connect = useCallback(async ({
    // Required for ephemeral token
    sessionId,
    authToken,
    systemPrompt = '',

    // Optional overrides
    model,                          // ignored — model is locked in the token server-side
    responseModalities = ['AUDIO'],
    config = {},
    resetTranscriptOnConnect = true,
    onConnected,
    onClose,
    onError,
  }) => {
    ensureOutputAudio();

    if (!sessionId || !authToken) {
      const err = new Error('sessionId and authToken are required to connect');
      onError?.(err);
      throw err;
    }

    if (resetTranscriptOnConnect) resetTranscript();

    isClosingRef.current = false;
    setConnectionState('connecting');
    setVoiceState('idle');

    try {
      await outputAudioContextRef.current.resume();
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      // Fetch short-lived token from backend (API key never leaves server)
      const ephemeralToken = await fetchEphemeralToken({ sessionId, systemPrompt, authToken });

      // Create a fresh GoogleGenAI client using the ephemeral token
      // Must specify v1alpha to match the API version the backend used when minting the token
      clientRef.current = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      let onOpenCalled = false;
      const pendingOpen = async () => {
        setConnectionState('active');
        setVoiceState('listening');
        await startMicrophone();
        onConnected?.({ sendText });
      };

      // NOTE: model + system_instruction are already baked into the token server-side.
      // Passing them again here would be ignored or cause an error — so we only
      // send responseModalities and any extra config overrides.
      const session = await clientRef.current.live.connect({
        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025', // must match what backend locked in token
        config: { responseModalities, ...config },
        callbacks: {
          onopen: () => {
            onOpenCalled = true;
            if (sessionRef.current) pendingOpen();
          },
          onmessage: handleMessage,
          onerror: (e) => {
            setConnectionState('error');
            onError?.(e);
          },
          onclose: () => {
            if (isClosingRef.current) return;
            disconnect({ reason: 'remote', onClose });
          },
        },
      });

      sessionRef.current = session;
      if (onOpenCalled) await pendingOpen();

      return session;
    } catch (err) {
      setConnectionState('error');
      try { await disconnect({ reason: 'error' }); } catch (_) { }
      onError?.(err);
      throw err;
    }
  }, [disconnect, ensureOutputAudio, fetchEphemeralToken, handleMessage, resetTranscript, sendText, startMicrophone]);

  useEffect(() => {
    ensureOutputAudio();
    return () => {
      disconnect({ reason: 'unmount' }).catch(() => { });
      try { outputAudioContextRef.current?.close(); } catch (_) { }
      outputAudioContextRef.current = null;
      outputGainRef.current = null;
    };
  }, [disconnect, ensureOutputAudio]);

  return {
    connectionState,
    voiceState,
    transcript,
    transcriptRef,
    muted,
    setMuted,
    resetTranscript,
    getCleanTranscript,
    connect,
    disconnect,
    sendText,
  };
}