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
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  );
}

function RadarBar({ label, value, color = 'hsl(var(--accent))' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs text-muted-foreground text-right shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-border/30 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${value || 0}%`, background: color }} />
      </div>
      <div className="w-8 text-xs font-mono text-right shrink-0">{value || 0}</div>
    </div>
  );
}

function CompletedView({ sessionData, transcript, navigate }) {
  const [activeTab, setActiveTab] = React.useState('summary');
  const metrics = sessionData?.metrics || {};
  const analysis = sessionData?.analysis || {};
  const score = metrics.overall_score || 0;
  const mistakes = sessionData?.extracted_mistakes?.length
    ? sessionData.extracted_mistakes
    : [];

  const scoreColor = score >= 70 ? '#4ade80' : score >= 40 ? '#facc15' : '#f87171';

  const skillBreakdown = metrics.skill_breakdown || {
    grammar: metrics.grammar_accuracy || 0,
    vocabulary: metrics.vocabulary_score || 0,
    fluency: metrics.fluency_wpm ? Math.min(100, Math.round(metrics.fluency_wpm / 1.5)) : 0,
    confidence: metrics.confidence_score || 0,
    listening: 0,
    coherence: 0,
  };

  const skillColors = {
    grammar: '#60a5fa',
    vocabulary: '#a78bfa',
    fluency: '#34d399',
    confidence: '#f59e0b',
    listening: '#f472b6',
    coherence: '#fb923c',
  };

  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'skills', label: 'Skills' },
    { id: 'mistakes', label: `Corrections${mistakes.length ? ` (${mistakes.length})` : ''}` },
    { id: 'homework', label: 'Homework' },
    { id: 'transcript', label: 'Transcript' },
  ];

  const hwTypeIcon = { writing: '✍️', speaking: '🗣️', reading: '📖', grammar: '📝', vocabulary: '📚' };

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/40"
        style={{ background: 'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--accent)/0.08) 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center gap-8">
          <div className="relative flex-shrink-0">
            <ScoreRing value={score} color={scoreColor} size={120} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: scoreColor }}>{score}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">score</span>
            </div>
          </div>
          <div className="flex-1 text-center md:text-left">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Session Complete</p>
            <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'Fraunces, serif' }}>
              {score >= 80 ? 'Excellent work! 🌟' : score >= 60 ? 'Great effort! 💪' : score >= 40 ? 'Good start! 🌱' : 'Keep practising! 🎯'}
            </h1>
            {analysis.encouraging_note && (
              <p className="text-sm text-muted-foreground mb-3 italic">{analysis.encouraging_note}</p>
            )}
            <div className="flex flex-wrap justify-center md:justify-start gap-5 mt-2">
              {[
                { label: 'Grammar', val: `${metrics.grammar_accuracy || 0}%` },
                { label: 'WPM', val: metrics.fluency_wpm || 0 },
                { label: 'Confidence', val: `${metrics.confidence_score || 0}%` },
                { label: 'Corrections', val: mistakes.length },
              ].map(({ label, val }) => (
                <div key={label} className="text-center">
                  <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{val}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 rounded-full text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
              data-testid="session-to-dashboard">Dashboard</button>
            <button onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-full text-sm font-medium border border-border/60 text-muted-foreground hover:border-border hover:text-foreground transition-colors"
              data-testid="session-reload-btn">Refresh</button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border/40 sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex gap-0 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* SUMMARY TAB */}
        {activeTab === 'summary' && (
          <div className="space-y-4">
            {/* Summary card */}
            <div className="rounded-xl border border-border/50 p-5 bg-card">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Session Summary</h3>
              <p className="text-sm leading-relaxed">{analysis.summary || 'Analysis in progress — refresh in a moment.'}</p>
              {analysis.conversation_topics?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {analysis.conversation_topics.map((t, i) => (
                    <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">{t}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Strengths + Areas side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border/50 p-5 bg-card">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">✅ Strengths</h3>
                <ul className="space-y-2">
                  {(analysis.strengths || []).length > 0
                    ? analysis.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="text-green-500 shrink-0 mt-0.5">✦</span>
                        <span>{s}</span>
                      </li>
                    ))
                    : <li className="text-sm text-muted-foreground">Refresh to load strengths.</li>}
                </ul>
              </div>
              <div className="rounded-xl border border-border/50 p-5 bg-card">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">📈 Areas to Improve</h3>
                <ul className="space-y-2">
                  {(analysis.areas_for_improvement || []).length > 0
                    ? analysis.areas_for_improvement.map((a, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="text-amber-400 shrink-0 mt-0.5">→</span>
                        <span>{a}</span>
                      </li>
                    ))
                    : <li className="text-sm text-muted-foreground">Refresh to load areas.</li>}
                </ul>
              </div>
            </div>

            {/* Next session focus */}
            {analysis.next_session_focus && (
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 flex items-start gap-3">
                <span className="text-2xl shrink-0">🎯</span>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Next Session Focus</p>
                  <p className="text-sm font-medium">{analysis.next_session_focus}</p>
                </div>
              </div>
            )}

            {/* Filler words */}
            {(analysis.filler_words_used || []).length > 0 && (
              <div className="rounded-xl border border-border/50 p-5 bg-card">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">🗣️ Filler Words Used ({metrics.filler_word_count || 0} times)</h3>
                <div className="flex flex-wrap gap-2">
                  {analysis.filler_words_used.map((w, i) => (
                    <span key={i} className="px-3 py-1 text-sm rounded-full bg-destructive/10 text-destructive border border-destructive/20">"{w}"</span>
                  ))}
                </div>
              </div>
            )}

            {/* New vocabulary */}
            {(analysis.new_words || []).length > 0 && (
              <div className="rounded-xl border border-border/50 p-5 bg-card">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">📚 Vocabulary from This Session</h3>
                <div className="flex flex-wrap gap-2">
                  {analysis.new_words.map((w, i) => (
                    <span key={i} className="px-4 py-1.5 text-sm rounded-full border border-accent/40 text-accent bg-accent/5 hover:bg-accent/15 transition-colors cursor-default">{w}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SKILLS TAB */}
        {activeTab === 'skills' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 p-5 bg-card">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-5">Skill Breakdown</h3>
              <div className="space-y-4">
                {Object.entries(skillBreakdown).map(([skill, val]) => (
                  <RadarBar key={skill} label={skill.charAt(0).toUpperCase() + skill.slice(1)}
                    value={val} color={skillColors[skill] || 'hsl(var(--accent))'} />
                ))}
              </div>
            </div>

            {/* Score cards grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Overall Score', val: score, suffix: '/100', color: scoreColor },
                { label: 'Grammar', val: metrics.grammar_accuracy, suffix: '%' },
                { label: 'Speaking Speed', val: metrics.fluency_wpm, suffix: ' wpm' },
                { label: 'Confidence', val: metrics.confidence_score, suffix: '%' },
                { label: 'Vocabulary', val: metrics.vocabulary_score, suffix: '%' },
                { label: 'Pronunciation', val: metrics.pronunciation_score, suffix: '%' },
              ].map(({ label, val, suffix, color }) => (
                <div key={label} className="rounded-xl border border-border/50 bg-card p-4 text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
                  <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: color || undefined }}>
                    {val || 0}{suffix}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CORRECTIONS TAB */}
        {activeTab === 'mistakes' && (
          <div>
            {mistakes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-3">🎉</div>
                <p className="text-lg font-semibold mb-1" style={{ fontFamily: 'Fraunces, serif' }}>No corrections needed!</p>
                <p className="text-sm text-muted-foreground">Flawless grammar — well done.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mistakes.map((m, i) => (
                  <div key={i} className="rounded-xl border border-border/50 bg-card p-4">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-destructive/10 text-destructive flex items-center justify-center text-xs font-bold mt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        {typeof m === 'string' ? (
                          <>
                            <p className="text-sm text-destructive line-through mb-1">{m.split('->')[0]?.trim()}</p>
                            <p className="text-sm text-green-500 font-medium">→ {m.split('->')[1]?.trim()}</p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="text-sm text-destructive line-through">{m.original}</p>
                              {m.severity && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium ${m.severity === 'major' ? 'bg-destructive/15 text-destructive' : m.severity === 'moderate' ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground'}`}>{m.severity}</span>
                              )}
                            </div>
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

        {/* HOMEWORK TAB */}
        {activeTab === 'homework' && (
          <div>
            {(analysis.homework || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-sm text-muted-foreground">No homework assigned for this session.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {analysis.homework.map((hw, i) => (
                  <div key={i} className="rounded-xl border border-border/50 bg-card p-5">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl shrink-0">{hwTypeIcon[hw.type] || '📝'}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-sm font-semibold">{hw.title}</h4>
                          {hw.estimated_minutes && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">~{hw.estimated_minutes} min</span>
                          )}
                          {hw.type && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{hw.type}</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{hw.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
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
                  <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold uppercase ${t.speaker === 'user' ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}>
                    {t.speaker === 'user' ? 'You' : 'AI'}
                  </div>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${t.speaker === 'user' ? 'bg-accent/10 text-foreground rounded-tr-sm' : 'bg-muted/50 text-foreground rounded-tl-sm'}`}>
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
  const transcriptRef = useRef([]); // always in sync — mutate directly, then call setTranscript

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

  // Debounced scroll — smooth scroll on every delta causes browser jank during audio
  const scrollDebounceRef = useRef(null);
  useEffect(() => {
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = setTimeout(() => {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, 150);
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
    // Plan sessions have a system_prompt stored in the session doc (written by curriculum AI).
    // Always prefer this — it's been tailored to the student's level and progress.
    if (sessionData?.system_prompt) return sessionData.system_prompt;

    // Generic fallback for ad-hoc sessions (not from a plan)
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

  // Schedule incoming PCM audio from Gemini — mirrors audio-orb's decodeAudioData
  // Must be async because the decode step (Int16→Float32→AudioBuffer) returns a Promise
  const playAudio = useCallback(async (data) => {
    const ctx = outputAudioContextRef.current;
    const gain = outputGainRef.current;
    if (!ctx || !gain || ctx.state === 'closed') return;

    // Decode base64 → Uint8Array (mirrors audio-orb's decode())
    const binaryStr = atob(data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // Build AudioBuffer from raw Int16 PCM — same logic as audio-orb's decodeAudioData()
    const dataInt16 = new Int16Array(bytes.buffer);
    const dataFloat32 = new Float32Array(dataInt16.length);
    for (let i = 0; i < dataInt16.length; i++) dataFloat32[i] = dataInt16[i] / 32768.0;
    const audioBuffer = ctx.createBuffer(1, dataFloat32.length, 24000);
    audioBuffer.copyToChannel(dataFloat32, 0);

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
        const res = await api.post('/sessions', {
          session_type: 'speaking',
          target_duration_minutes: sessionDuration,
        });
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
        setStatus('active');
        voiceStateRef.current = 'listening';
        setVoiceState('listening');
        // Start mic first so the audio output context is resumed and ready
        // BEFORE the AI starts speaking — prevents the first audio chunk being dropped.
        startMicrophone(geminiSessionRef.current);
        // Kick off the AI's opening greeting. The system_prompt tells it exactly
        // how to greet — this just signals "your turn to speak first".
        geminiSessionRef.current.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Hello, please start the session.' }] }],
          turnComplete: true,
        });
      };

      const session = await ai.live.connect({
        model: model,
        config: {
          responseModalities: ['AUDIO'],
          // ── Enable live transcription for both speakers ─────────────────
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            // geminiSessionRef.current may not be set yet if onopen fires
            // synchronously. Mark it and let the post-connect block call _pendingOpen.
            _onOpenCalled = true;
            if (geminiSessionRef.current) _pendingOpen();
          },

          onmessage: async (message) => {
            // ── Audio ──────────────────────────────────────────────────────
            const audioPart = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
            if (audioPart?.data) {
              playAudio(audioPart.data);
            }

            // ── AI output transcription (incremental deltas) ───────────────
            const outputTranscript = message.serverContent?.outputTranscription?.text;
            if (outputTranscript) {
              // Always read ref fresh — never use closure-captured values
              const cur = transcriptRef.current;
              const last = cur[cur.length - 1];
              if (last && last.speaker === 'ai' && !last.final) {
                // Same AI turn still open — append delta
                // Don't add space if: last char is space OR delta starts with space/punctuation
                const needsSep = last.text.length > 0
                  && !last.text.endsWith(' ')
                  && !outputTranscript.startsWith(' ')
                  && !outputTranscript.startsWith(',')
                  && !outputTranscript.startsWith('.');
                const sep = needsSep ? ' ' : '';
                transcriptRef.current = [
                  ...cur.slice(0, -1),
                  { ...last, text: last.text + sep + outputTranscript }
                ];
              } else {
                // New AI turn — close any open user bubble first
                const base = (last && !last.final)
                  ? [...cur.slice(0, -1), { ...last, final: true }]
                  : cur;
                transcriptRef.current = [...base, { speaker: 'ai', text: outputTranscript, final: false }];
              }
              aiTurnOpenRef.current = true;
              userTurnOpenRef.current = false;
              setTranscript([...transcriptRef.current]);
            }

            // ── User input transcription (incremental deltas) ──────────────
            const inputTranscript = message.serverContent?.inputTranscription?.text;
            if (inputTranscript) {
              // Always read ref fresh
              const cur = transcriptRef.current;
              const last = cur[cur.length - 1];
              if (last && last.speaker === 'user' && !last.final) {
                // Same user turn still open — append delta
                const needsSep = last.text.length > 0
                  && !last.text.endsWith(' ')
                  && !inputTranscript.startsWith(' ')
                  && !inputTranscript.startsWith(',')
                  && !inputTranscript.startsWith('.');
                const sep = needsSep ? ' ' : '';
                transcriptRef.current = [
                  ...cur.slice(0, -1),
                  { ...last, text: last.text + sep + inputTranscript }
                ];
              } else {
                // New user turn — close any open AI bubble first
                const base = (last && !last.final)
                  ? [...cur.slice(0, -1), { ...last, final: true }]
                  : cur;
                transcriptRef.current = [...base, { speaker: 'user', text: inputTranscript, final: false }];
              }
              userTurnOpenRef.current = true;
              aiTurnOpenRef.current = false;
              setTranscript([...transcriptRef.current]);
            }

            // ── Turn complete ──────────────────────────────────────────────
            if (message.serverContent?.turnComplete) {
              aiTurnOpenRef.current = false;
              userTurnOpenRef.current = false;
              voiceStateRef.current = 'listening';
              setVoiceState('listening');
              const cur = transcriptRef.current;
              if (cur.length && !cur[cur.length - 1].final) {
                transcriptRef.current = [
                  ...cur.slice(0, -1),
                  { ...cur[cur.length - 1], final: true }
                ];
                setTranscript([...transcriptRef.current]);
              }
            }

            // ── Interrupted (user barged in mid-AI-response) ───────────────
            if (message.serverContent?.interrupted) {
              aiTurnOpenRef.current = false;
              userTurnOpenRef.current = false;
              for (const src of sourcesRef.current) { try { src.stop(); } catch (_) { } }
              sourcesRef.current.clear();
              // Mirror audio-orb: reset to 0 (not currentTime)
              nextStartTimeRef.current = 0;
              voiceStateRef.current = 'listening';
              setVoiceState('listening');
              const cur = transcriptRef.current;
              const last = cur[cur.length - 1];
              if (last && !last.final) {
                transcriptRef.current = [...cur.slice(0, -1), { ...last, final: true }];
                setTranscript([...transcriptRef.current]);
              }
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
      // Match audio-orb: {audio: true} — no echoCancellation/noiseSuppression/autoGainControl
      // Browser audio processing can fight with Gemini's VAD causing false triggers
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;

      const inputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      sourceNodeRef.current = inputCtx.createMediaStreamSource(stream);

      // Match audio-orb: bufferSize = 256
      const bufferSize = 256;
      scriptProcessorRef.current = inputCtx.createScriptProcessor(bufferSize, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (e) => {
        if (mutedRef.current || !session) return;
        const pcmData = e.inputBuffer.getChannelData(0);

        // Float32 → Int16 (matches audio-orb's createBlob)
        const int16 = float32ToInt16(pcmData);
        const bytes = new Uint8Array(int16.buffer);

        // Base64 encode — char-by-char like audio-orb's encode() function
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }

        session.sendRealtimeInput({
          media: {
            data: btoa(binary),
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
    transcriptRef.current = [...transcriptRef.current, { speaker: 'user', text: textInput, final: true }];
    setTranscript([...transcriptRef.current]);
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

    try {
      // Sanitize transcript: mark any unclosed partials as final, drop empty entries
      const cleanTranscript = transcript
        .filter(t => t.text && t.text.trim().length > 0)
        .map(t => ({ ...t, final: true }));
      await api.put(`/sessions/${sessionId}/complete`, { transcript: cleanTranscript, metrics: {} });
      await api.post(`/ai/score-session?session_id=${sessionId}`);
      // Fetch the full session from DB — this gives us analysis, metrics,
      // AND extracted_mistakes (joined from mistakes collection) all in one shot.
      const fullSession = await api.get(`/sessions/${sessionId}`);
      setSessionData(fullSession.data);
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

      {(status === 'loading' || status === 'connecting') && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <VoiceVisualizer state="processing" size="md" />
            <p className="mt-12 text-muted-foreground">{status === 'loading' ? 'Loading...' : 'Connecting...'}</p>
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