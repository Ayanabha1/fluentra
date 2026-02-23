import React, { useState, useRef, useCallback, useEffect, startTransition } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mic, MicOff, PhoneOff, Sun, Moon, ArrowLeft, MessageSquare, BookOpen, Target, Sparkles } from 'lucide-react';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import api from '@/utils/api';

// ─── The @google/genai SDK must be in your package.json ──────────────────────
// npm install @google/genai
import { GoogleGenAI } from '@google/genai';

// ─── Output audio: raw Int16 PCM → AudioBuffer ───────────────────────────────
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

// ─── Input audio: Float32 mic → Int16 blob for Gemini ────────────────────────
function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s * 32768;
  }
  return int16;
}

// ─────────────────────────────────────────────────────────────────────────────


// ─── Completed Session View ───────────────────────────────────────────────────
function ScoreRing({ value, max = 100, color = '#4ade80', size = 96 }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(1, (value || 0) / max);
  const dash = pct * circ;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-border/30" />
      <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 1s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  );
}

function CompletedView({ sessionData, transcript, navigate }) {
  const [activeTab, setActiveTab] = React.useState('summary');
  const score = sessionData?.metrics?.overall_score || 0;
  const grammar = sessionData?.metrics?.grammar_accuracy || 0;
  const wpm = sessionData?.metrics?.fluency_wpm || 0;

  const mistakes = sessionData?.extracted_mistakes?.length
    ? sessionData.extracted_mistakes
    : (sessionData?.analysis?.mistakes || []);

  const scoreColor = score >= 70 ? '#4ade80' : score >= 40 ? '#facc15' : '#f87171';

  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'mistakes', label: `Corrections${mistakes.length ? ` (${mistakes.length})` : ''}` },
    { id: 'vocab', label: 'Vocabulary' },
    { id: 'transcript', label: 'Transcript' },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Hero score band */}
      <div className="relative overflow-hidden border-b border-border/40"
        style={{ background: 'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--accent)/0.08) 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-8">
          {/* Big score ring */}
          <div className="relative flex-shrink-0">
            <ScoreRing value={score} color={scoreColor} size={120} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: scoreColor }}>{score}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">score</span>
            </div>
          </div>

          {/* Title + mini stats */}
          <div className="flex-1 text-center md:text-left">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Session Complete</p>
            <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: 'Fraunces, serif' }}>
              {score >= 80 ? 'Excellent work! 🌟' : score >= 60 ? 'Great effort! 💪' : score >= 40 ? 'Good start! 🌱' : 'Keep practising! 🎯'}
            </h1>
            <div className="flex flex-wrap justify-center md:justify-start gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{grammar}%</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Grammar</div>
              </div>
              <div className="w-px bg-border/50 hidden md:block" />
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{wpm}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">WPM</div>
              </div>
              <div className="w-px bg-border/50 hidden md:block" />
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{mistakes.length}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Corrections</div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 rounded-full text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
              data-testid="session-to-dashboard">
              Dashboard
            </button>
            <button onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-full text-sm font-medium border border-border/60 text-muted-foreground hover:border-border hover:text-foreground transition-colors"
              data-testid="session-reload-btn">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border/40 sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex gap-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.id
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* SUMMARY TAB */}
        {activeTab === 'summary' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-border/50 p-5 bg-card">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Session Summary</h3>
              <p className="text-sm leading-relaxed text-foreground">
                {sessionData?.analysis?.summary || sessionData?.metrics?.feedback?.[0] || 'Analysis in progress — refresh in a moment.'}
              </p>
              {sessionData?.analysis?.other_details && (
                <p className="text-sm text-muted-foreground mt-4 italic border-l-2 border-accent/40 pl-3">
                  {sessionData.analysis.other_details}
                </p>
              )}
            </div>
            {sessionData?.metrics?.feedback?.length > 0 && typeof sessionData.metrics.feedback[0] === 'string' && (
              <div className="rounded-xl border border-border/50 p-5 bg-card">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Tutor Feedback</h3>
                <ul className="space-y-2">
                  {sessionData.metrics.feedback.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm text-foreground">
                      <span className="text-accent mt-0.5 flex-shrink-0">✦</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* MISTAKES TAB */}
        {activeTab === 'mistakes' && (
          <div>
            {mistakes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-3">🎉</div>
                <p className="text-lg font-semibold mb-1" style={{ fontFamily: 'Fraunces, serif' }}>No corrections needed!</p>
                <p className="text-sm text-muted-foreground">Flawless session — your grammar was on point.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mistakes.map((m, i) => (
                  <div key={i} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                    <div className="flex items-start gap-3 p-4">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-destructive/10 text-destructive flex items-center justify-center text-xs font-bold mt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        {typeof m === 'string' ? (
                          <>
                            <p className="text-sm text-destructive line-through mb-1">{m.split('->')[0]?.trim()}</p>
                            <p className="text-sm text-green-500 font-medium">→ {m.split('->')[1]?.trim()}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-destructive line-through mb-1">{m.original}</p>
                            <p className="text-sm text-green-500 font-medium mb-2">→ {m.corrected}</p>
                            {m.explanation && (
                              <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">{m.explanation}</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VOCAB TAB */}
        {activeTab === 'vocab' && (
          <div>
            {sessionData?.analysis?.new_words?.length > 0 ? (
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Words from this session</p>
                <div className="flex flex-wrap gap-2">
                  {sessionData.analysis.new_words.map((w, i) => (
                    <span key={i}
                      className="px-4 py-2 rounded-full text-sm font-medium border border-accent/40 text-accent bg-accent/5 hover:bg-accent/15 transition-colors cursor-default">
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-muted-foreground">No new vocabulary recorded for this session.</p>
              </div>
            )}
          </div>
        )}

        {/* TRANSCRIPT TAB */}
        {activeTab === 'transcript' && (
          <div className="space-y-3">
            {transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">No transcript available.</p>
            ) : (
              transcript.map((t, i) => (
                <div key={i} className={`flex gap-3 ${t.speaker === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold uppercase
                    ${t.speaker === 'user' ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}>
                    {t.speaker === 'user' ? 'You' : 'AI'}
                  </div>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                    ${t.speaker === 'user'
                      ? 'bg-accent/10 text-foreground rounded-tr-sm'
                      : 'bg-muted/50 text-foreground rounded-tl-sm'}`}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SessionPage() {
  const { sessionId: paramId } = useParams();
  const [sessionId, setSessionId] = useState(paramId);
  const [sessionData, setSessionData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const transcriptRef = useRef([]); // always in sync, never stale in callbacks
  const setTranscriptSync = (updater) => {
    // Apply updater to ref immediately, then schedule React state sync
    transcriptRef.current = typeof updater === 'function'
      ? updater(transcriptRef.current)
      : updater;
    setTranscript([...transcriptRef.current]);
  };

  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(30);
  const [customDurationInput, setCustomDurationInput] = useState('');

  // Gemini Live direct session (replaces WebSocket relay)
  const geminiSessionRef = useRef(null);
  const streamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const isEndingRef = useRef(false);
  const voiceStateRef = useRef('idle');
  const mutedRef = useRef(false);
  const userTurnOpenRef = useRef(false); // true while user turn is open → append deltas
  const aiTurnOpenRef = useRef(false);   // true while AI turn is open → append deltas

  // Output audio
  const outputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
  );
  const outputGainRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);
  const transcriptEndRef = useRef(null);

  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    const ctx = outputAudioContextRef.current;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    outputGainRef.current = gain;
    nextStartTimeRef.current = ctx.currentTime;
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  useEffect(() => {
    if (!sessionId) { setStatus('ready'); return; }
    const loadSession = async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}`);
        setSessionData(res.data);
        if (res.data.status === 'completed') { setStatus('completed'); return; }
        setStatus('ready');
      } catch { setStatus('ready'); }
    };
    loadSession();
  }, [sessionId]);

  const buildSystemPrompt = () => {
    const type = sessionData?.session_type || 'speaking';
    const level = user?.cefr_level || 'B1';
    const nativeLang = user?.native_language || 'their native language';
    return `You are Fluentra, a friendly, encouraging English coach. You're conducting a ${type} session for a ${level} level student named ${user?.name || 'Student'}. Their native language is ${nativeLang}.

Session type: ${type}
Student level: ${level}
Goals: ${user?.learning_goals?.join(', ') || 'General improvement'}

Rules:
- Be warm, natural, and conversational — like a real human coach.
- Start with a brief friendly greeting and dive straight into practice.
- Correct grammar mistakes gently inline, then continue naturally.
- Never output asterisks, markdown, bracketed text, or internal reasoning.
- Keep responses concise — this is about THEIR speaking practice.`;
  };

  // Schedule incoming PCM audio from Gemini
  const playAudio = useCallback((data) => {
    const ctx = outputAudioContextRef.current;
    const gain = outputGainRef.current;
    if (!ctx || !gain || ctx.state === 'closed') return;

    // data is base64 string from SDK onmessage
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

    if (voiceStateRef.current !== 'speaking') {
      voiceStateRef.current = 'speaking';
      setVoiceState('speaking');
    }
  }, []);

  const startSession = async () => {
    setStatus('connecting');
    try {
      let sid = sessionId;
      if (!sid) {
        const res = await api.post('/sessions', { session_type: 'speaking', target_duration_minutes: sessionDuration });
        sid = res.data.id;
        setSessionId(sid);
        setSessionData(res.data);
      }

      await outputAudioContextRef.current.resume();
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      // STEP 1: Get ephemeral token from our backend (system prompt baked in server-side)
      const tokenRes = await api.post('/sessions/live-token', {
        session_id: sid,
        system_prompt: buildSystemPrompt(),
      });
      const { token, model } = tokenRes.data;

      // STEP 2: Connect DIRECTLY to Gemini using the ephemeral token
      // No relay. Audio flows: mic → Gemini → speakers with ZERO Python hops.
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });

      // FIX: onopen fires asynchronously but `session` const is in the temporal dead
      // zone until the await resolves. Solution: assign to ref immediately after
      // connect() resolves, then use the ref in onopen via a deferred open handler.
      let _onOpenCalled = false;
      const _pendingOpen = () => {
        // Called after geminiSessionRef.current is set (see below)
        setStatus('active');
        voiceStateRef.current = 'listening';
        setVoiceState('listening');
        startMicrophone(geminiSessionRef.current);
        geminiSessionRef.current.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Hello! I am ready to start.' }] }],
          turnComplete: true,
        });
      };

      const session = await ai.live.connect({
        model: model,
        config: {
          responseModalities: ['AUDIO'],
        },
        callbacks: {
          onopen: () => {
            // geminiSessionRef.current may not be set yet if onopen fires
            // synchronously. Mark it and let the post-connect block call _pendingOpen.
            _onOpenCalled = true;
            if (geminiSessionRef.current) _pendingOpen();
          },

          onmessage: (message) => {
            // ── Audio ──────────────────────────────────────────────────────
            const audioPart = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
            if (audioPart?.data) {
              playAudio(audioPart.data);
            }

            // ── Helpers (operate on ref directly — never stale) ────────────
            const appendToSpeaker = (speaker, text, isFinished) => {
              const cur = transcriptRef.current;
              let lastIndex = -1;
              for (let i = cur.length - 1; i >= 0; i--) {
                if (cur[i].speaker === speaker) { lastIndex = i; break; }
              }

              if (lastIndex !== -1 && !cur[lastIndex].final) {
                // Append delta to existing open bubble for this speaker
                setTranscriptSync(prev => {
                  const newPrev = [...prev];
                  const lastText = newPrev[lastIndex].text || '';
                  const sep = lastText.endsWith(' ') ? '' : ' ';
                  newPrev[lastIndex] = {
                    ...newPrev[lastIndex],
                    text: text ? lastText + sep + text : lastText,
                    final: !!isFinished
                  };
                  return newPrev;
                });
              } else {
                // Open new bubble for this speaker (only if there's text)
                if (text || isFinished) {
                  setTranscriptSync(prev => [...prev, { speaker, text: text || '', final: !!isFinished }]);
                }
              }
            };

            // ── AI output transcription (incremental deltas) ───────────────
            const outputTrans = message.serverContent?.outputTranscription;
            if (outputTrans) {
              appendToSpeaker('ai', outputTrans.text, outputTrans.finished);
            }

            // ── User input transcription (incremental deltas) ──────────────
            const inputTrans = message.serverContent?.inputTranscription;
            if (inputTrans) {
              appendToSpeaker('user', inputTrans.text, inputTrans.finished);
            }

            // ── Turn complete ──────────────────────────────────────────────
            if (message.serverContent?.turnComplete) {
              voiceStateRef.current = 'listening';
              setVoiceState('listening');
              setTranscriptSync(prev => {
                const newPrev = [...prev];
                // Finalize both the AI and User active bubbles when turn completes.
                let lastAiIndex = -1;
                for (let i = newPrev.length - 1; i >= 0; i--) {
                  if (newPrev[i].speaker === 'ai') { lastAiIndex = i; break; }
                }
                if (lastAiIndex !== -1 && !newPrev[lastAiIndex].final) {
                  newPrev[lastAiIndex] = { ...newPrev[lastAiIndex], final: true };
                }

                let lastUserIndex = -1;
                for (let i = newPrev.length - 1; i >= 0; i--) {
                  if (newPrev[i].speaker === 'user') { lastUserIndex = i; break; }
                }
                if (lastUserIndex !== -1 && !newPrev[lastUserIndex].final) {
                  newPrev[lastUserIndex] = { ...newPrev[lastUserIndex], final: true };
                }

                return newPrev;
              });
            }

            // ── Interrupted (user barged in mid-AI-response) ───────────────
            if (message.serverContent?.interrupted) {
              for (const src of sourcesRef.current) { try { src.stop(); } catch (_) { } }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              voiceStateRef.current = 'listening';
              setVoiceState('listening');

              setTranscriptSync(prev => {
                const newPrev = [...prev];
                let lastAiIndex = -1;
                for (let i = newPrev.length - 1; i >= 0; i--) {
                  if (newPrev[i].speaker === 'ai') { lastAiIndex = i; break; }
                }
                if (lastAiIndex !== -1 && !newPrev[lastAiIndex].final) {
                  newPrev[lastAiIndex] = { ...newPrev[lastAiIndex], final: true };
                }
                return newPrev;
              });
            }
          },

          onerror: (e) => {
            toast.error('Connection error: ' + e.message);
            setStatus('ready');
          },

          onclose: () => {
            if (voiceStateRef.current !== 'idle') {
              voiceStateRef.current = 'idle';
              setVoiceState('idle');
            }
          },
        },
      });

      // Assign ref immediately after connect resolves
      geminiSessionRef.current = session;
      // If onopen already fired before ref was set, call the deferred handler now
      if (_onOpenCalled) _pendingOpen();

    } catch (err) {
      console.error('Session start error:', err);
      toast.error('Failed to start session');
      setStatus('ready');
    }
  };

  const startMicrophone = async (session) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      streamRef.current = stream;

      // 256 samples = 16ms chunks — correct for direct Gemini connection (no relay jitter).
      // Gemini's VAD works best with small continuous chunks, not large batched ones.
      const inputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      sourceNodeRef.current = inputCtx.createMediaStreamSource(stream);
      scriptProcessorRef.current = inputCtx.createScriptProcessor(256, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (e) => {
        if (mutedRef.current || !session) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = float32ToInt16(float32);
        // Send directly to Gemini SDK — no backend hop
        session.sendRealtimeInput({
          media: {
            data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))),
            mimeType: 'audio/pcm;rate=16000',
          }
        });
      };

      sourceNodeRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputCtx.destination);
    } catch (err) {
      console.error('Mic error:', err);
      toast.error('Microphone access required');
      setStatus('ready');
    }
  };

  const sendText = () => {
    if (!textInput.trim() || !geminiSessionRef.current) return;
    geminiSessionRef.current.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: textInput }] }],
      turnComplete: true,
    });
    startTransition(() => {
      setTranscript(prev => [...prev, { speaker: 'user', text: textInput, final: true }]);
    });
    setTextInput('');
  };

  const endSession = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    // Close Gemini direct connection
    if (geminiSessionRef.current) {
      try { geminiSessionRef.current.close(); } catch (_) { }
      geminiSessionRef.current = null;
    }
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    for (const src of sourcesRef.current) { try { src.stop(); } catch (_) { } }
    sourcesRef.current.clear();
    setVoiceState('processing');
    setStatus('assessing');

    try {
      // Sanitize transcript: mark any unclosed partials as final, drop empty entries
      const cleanTranscript = transcript
        .filter(t => t.text && t.text.trim().length > 0)
        .map(t => ({ ...t, final: true }));
      await api.put(`/sessions/${sessionId}/complete`, { transcript: cleanTranscript, metrics: {} });

      // Artificial delay to make scoring feel comprehensive
      await new Promise(r => setTimeout(r, 3500));

      const scoreRes = await api.post(`/ai/score-session?session_id=${sessionId}`);
      setSessionData(prev => ({ ...prev, status: 'completed', transcript: cleanTranscript, ...scoreRes.data }));
      toast.success('Session completed and scored!');
    } catch {
      toast.error('Session saved but scoring failed. Retry later!');
      isEndingRef.current = false;
    } finally {
      setVoiceState('idle');
      setStatus('completed');
    }
  };

  useEffect(() => {
    let interval;
    if (status === 'active') {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => {
          const next = prev + 1;
          const sessionLimit = sessionData?.target_duration_minutes
            ? sessionData.target_duration_minutes * 60 : 30 * 60;
          const wrapUpTime = Math.floor(sessionLimit * 0.9);
          const hardStopTime = Math.floor(sessionLimit * 0.98);
          if (next === wrapUpTime && geminiSessionRef.current) {
            geminiSessionRef.current.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: 'SYSTEM: Please start wrapping up. Summarize what we covered, give relevant homework, and say a warm goodbye.' }] }],
              turnComplete: true,
            });
          }
          if (next >= hardStopTime) endSession();
          return next;
        });
      }, 1000);
    } else if (status !== 'connecting') {
      setSecondsElapsed(0);
    }
    return () => clearInterval(interval);
  }, [status, sessionData]);

  const currentLimitSeconds = sessionData?.target_duration_minutes
    ? sessionData.target_duration_minutes * 60 : 30 * 60;
  const remainingSeconds = Math.max(0, currentLimitSeconds - secondsElapsed);
  const isTimeLow = remainingSeconds < 60;

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="session-page">
      <div className="flex items-center justify-between p-4 border-b border-border/50 glass">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate('/dashboard')} data-testid="session-back">
            <ArrowLeft size={18} />
          </Button>
          <div className="flex items-center">
            <span className="font-semibold text-sm" style={{ fontFamily: 'Fraunces, serif' }}>
              {sessionData?.session_type ? `${sessionData.session_type.charAt(0).toUpperCase() + sessionData.session_type.slice(1)} Session` : 'Session'}
            </span>
            {sessionData && <Badge variant="outline" className="ml-2 text-[10px]">{user?.cefr_level}</Badge>}
            {status === 'active' && (
              <Badge variant={isTimeLow ? "destructive" : "secondary"} className="ml-2 text-[10px]">
                {Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, '0')}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>

      {(status === 'loading' || status === 'connecting' || status === 'assessing') && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <VoiceVisualizer state="processing" size="md" />
            <p className="mt-12 text-muted-foreground">{status === 'loading' ? 'Loading...' : status === 'connecting' ? 'Connecting...' : 'Analyzing performance...'}</p>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <VoiceVisualizer state="idle" size="md" />
            <h2 className="text-xl font-semibold mt-12 mb-3" style={{ fontFamily: 'Fraunces, serif' }}>Ready to Practice?</h2>
            <p className="text-sm text-muted-foreground mb-6">Connect with your AI tutor for a live conversation.</p>
            {!sessionId && (
              <div className="mb-8 max-w-sm mx-auto">
                <label className="text-xs font-medium text-muted-foreground mb-3 block uppercase tracking-wider">Session Duration</label>
                <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
                  {[10, 15, 20, 30].map(mins => (
                    <Button key={mins} size="sm" variant={sessionDuration === mins ? 'default' : 'outline'}
                      onClick={() => { setSessionDuration(mins); setCustomDurationInput(''); }}
                      className="rounded-full h-9 px-4">{mins} min</Button>
                  ))}
                  <div className="flex items-center">
                    <input type="number" placeholder="Custom" value={customDurationInput}
                      onChange={(e) => { setCustomDurationInput(e.target.value); if (e.target.value) setSessionDuration(parseInt(e.target.value) || 30); }}
                      className="w-20 h-9 rounded-l-full border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
                    <div className="h-9 px-3 flex items-center bg-muted border border-l-0 border-border rounded-r-full text-xs text-muted-foreground">min</div>
                  </div>
                </div>
              </div>
            )}
            <Button onClick={startSession} className="rounded-full px-10 py-5 bg-accent text-accent-foreground hover:bg-accent/90" data-testid="session-start-btn">
              <Mic size={18} className="mr-2" /> Start Session
            </Button>
          </div>
        </div>
      )}

      {status === 'active' && (
        <div className="flex-1 flex flex-col">
          <div className="flex-shrink-0 flex items-center justify-center py-12">
            <VoiceVisualizer state={voiceState} size="lg" />
          </div>
          <div className="flex-1 border-t border-border/50">
            <ScrollArea className="h-[300px] px-6 py-4">
              {transcript.map((t, i) => (
                <div key={i} className={`mb-3 ${t.speaker === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.speaker === 'user' ? 'You' : 'Tutor'}</span>
                  <p className={`text-sm mt-0.5 ${t.speaker === 'user' ? 'text-foreground' : 'text-muted-foreground'}`}>{t.text}</p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </ScrollArea>
          </div>
          <div className="border-t border-border/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <input value={textInput} onChange={e => setTextInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendText()}
                placeholder="Or type a message..." className="flex-1 bg-muted/50 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" data-testid="session-text-input" />
              <Button variant="ghost" size="icon" className="rounded-full" onClick={sendText} data-testid="session-send-text">
                <MessageSquare size={18} />
              </Button>
            </div>
            <div className="flex items-center justify-center gap-4">
              <Button variant="outline" size="icon" className="rounded-full w-12 h-12" onClick={() => setMuted(!muted)} data-testid="session-mute">
                {muted ? <MicOff size={20} className="text-destructive" /> : <Mic size={20} />}
              </Button>
              <Button className="rounded-full px-8 py-5 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={endSession} data-testid="session-end-btn">
                <PhoneOff size={18} className="mr-2" /> End Session
              </Button>
            </div>
          </div>
        </div>
      )}

      {status === 'completed' && (
        <CompletedView
          sessionData={sessionData}
          transcript={sessionData?.transcript || transcript}
          navigate={navigate}
        />
      )}
    </div>
  );
}