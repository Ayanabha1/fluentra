import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mic, MicOff, PhoneOff, Sun, Moon, ArrowLeft, MessageSquare } from 'lucide-react';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import api from '@/utils/api';
import { GoogleGenAI } from '@google/genai';

// ─── Audio helpers ────────────────────────────────────────────────────────────

function encode(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const buffer = ctx.createBuffer(
    numChannels,
    data.length / 2 / numChannels,
    sampleRate,
  );
  const dataInt16 = new Int16Array(data.buffer);
  const l = dataInt16.length;
  const dataFloat32 = new Float32Array(l);
  for (let i = 0; i < l; i++) dataFloat32[i] = dataInt16[i] / 32768.0;
  if (numChannels === 0) {
    buffer.copyToChannel(dataFloat32, 0);
  } else {
    for (let i = 0; i < numChannels; i++) {
      const channel = dataFloat32.filter((_, index) => index % numChannels === i);
      buffer.copyToChannel(channel, i);
    }
  }
  return buffer;
}

// ─── UI Sub-components ────────────────────────────────────────────────────────

function ScoreRing({ value, max = 100, color = '#4ade80', size = 120 }) {
  const r = 46;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(1, (value || 0) / max);
  const dash = pct * circ;
  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-border/40" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <span className="text-3xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#ffffff' }}>{value}</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.15em] mt-0.5 text-white/70">score</span>
      </div>
    </div>
  );
}

function RadarBar({ label, value, color = 'hsl(var(--accent))' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs font-medium text-muted-foreground text-right shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-border/40 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${value || 0}%`, background: color }} />
      </div>
      <div className="w-8 text-xs font-mono font-medium text-right shrink-0">{value || 0}</div>
    </div>
  );
}

function CompletedView({ sessionData, transcript, navigate }) {
  const [activeTab, setActiveTab] = React.useState('summary');
  const metrics = sessionData?.metrics || {};
  const analysis = sessionData?.analysis || {};
  const score = metrics.overall_score || 0;
  const mistakes = sessionData?.extracted_mistakes?.length ? sessionData.extracted_mistakes : [];
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
    grammar: '#60a5fa', vocabulary: '#a78bfa', fluency: '#34d399',
    confidence: '#f59e0b', listening: '#f472b6', coherence: '#fb923c',
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
      <div className="relative border-b border-border/20 bg-card/20">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center md:items-start gap-8">
          <div className="flex-shrink-0">
            <ScoreRing value={score} color={scoreColor} size={140} />
          </div>
          <div className="flex-1 text-center md:text-left pt-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Session Complete</p>
            <h1 className="text-3xl font-bold mb-3 tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
              {score >= 80 ? 'Excellent work! 🌟' : score >= 60 ? 'Great effort! 💪' : score >= 40 ? 'Good start! 🌱' : 'Keep practising! 🎯'}
            </h1>
            {analysis.encouraging_note ? (
              <p className="text-sm text-muted-foreground mb-6 italic leading-relaxed max-w-2xl">{analysis.encouraging_note}</p>
            ) : analysis.summary ? (
              <p className="text-sm text-white/50 mb-6 italic leading-relaxed max-w-2xl">{analysis.summary.split('. ')[0] + '.'}</p>
            ) : null}
            <div className="flex flex-wrap justify-center md:justify-start gap-8 mt-2">
              {[
                { label: 'Grammar', val: `${metrics.grammar_accuracy || 0}%` },
                { label: 'WPM', val: metrics.fluency_wpm || 0 },
                { label: 'Confidence', val: `${metrics.confidence_score || 0}%` },
                { label: 'Corrections', val: mistakes.length },
              ].map(({ label, val }) => (
                <div key={label} className="text-center md:text-left">
                  <div className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{val}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 flex-shrink-0 pt-2 min-w-[140px]">
            <button onClick={() => navigate('/dashboard')}
              className="w-full px-5 py-2.5 rounded-full text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
              data-testid="session-to-dashboard">Dashboard</button>
            <button onClick={() => window.location.reload()}
              className="w-full px-5 py-2.5 rounded-full text-sm font-medium border border-border/40 text-muted-foreground hover:border-border hover:text-foreground transition-colors bg-card/40"
              data-testid="session-reload-btn">Refresh</button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border/20 sticky top-0 z-10 bg-background/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 flex gap-8 overflow-x-auto no-scrollbar">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {activeTab === 'summary' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border/30 p-6 bg-card/30">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-4">Session Summary</h3>
              <p className="text-sm leading-relaxed text-foreground/90">{analysis.summary || 'Analysis in progress — refresh in a moment.'}</p>
              {analysis.conversation_topics?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-5">
                  {analysis.conversation_topics.map((t, i) => (
                    <span key={i} className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent/90 border border-accent/20">{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-border/30 p-6 bg-card/30">
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-green-500 text-sm">✅</span>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Strengths</h3>
                </div>
                <ul className="space-y-4">
                  {(analysis.strengths || []).length > 0
                    ? analysis.strengths.map((s, i) => {
                      const [title, ...rest] = s.split(':');
                      const desc = rest.join(':');
                      return (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="text-emerald-500 shrink-0 mt-0.5 text-lg leading-none">✦</span>
                          <div className="text-foreground/80 leading-relaxed font-light">
                            {desc ? <><strong className="text-foreground font-medium">{title}:</strong>{desc}</> : s}
                          </div>
                        </li>
                      );
                    })
                    : <li className="text-sm text-foreground/60 italic font-light">Refresh to load strengths.</li>}
                </ul>
              </div>
              <div className="rounded-2xl border border-border/30 p-6 bg-card/30">
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-red-400 text-sm">📈</span>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Areas to Improve</h3>
                </div>
                <ul className="space-y-4">
                  {(analysis.areas_for_improvement || []).length > 0
                    ? analysis.areas_for_improvement.map((a, i) => {
                      const [title, ...rest] = a.split(':');
                      const desc = rest.join(':');
                      return (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="text-yellow-500 shrink-0 mt-0.5 text-lg leading-none">→</span>
                          <div className="text-foreground/80 leading-relaxed font-light">
                            {desc ? <><strong className="text-foreground font-medium">{title}:</strong>{desc}</> : a}
                          </div>
                        </li>
                      );
                    })
                    : <li className="text-sm text-foreground/60 italic font-light">Refresh to load areas.</li>}
                </ul>
              </div>
            </div>
            {analysis.next_session_focus && (
              <div className="rounded-2xl border border-border/30 bg-card/30 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xl leading-none">🎯</span>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Next Session Focus</h3>
                </div>
                <p className="text-sm text-foreground/90 font-medium leading-relaxed">{analysis.next_session_focus}</p>
              </div>
            )}
            {(analysis.filler_words_used || []).length > 0 && (
              <div className="rounded-2xl border border-border/30 p-6 bg-card/30">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xl leading-none">🗣️</span>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Filler Words Used ({metrics.filler_word_count || 0} times)</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  {analysis.filler_words_used.map((w, i) => (
                    <span key={i} className="px-5 py-1.5 text-sm rounded-full bg-destructive/10 text-destructive/80 border border-destructive/20">{w}</span>
                  ))}
                </div>
              </div>
            )}
            {(analysis.new_words || []).length > 0 && (
              <div className="rounded-2xl border border-border/30 p-6 bg-card/30">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xl leading-none">📚</span>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Vocabulary from This Session</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  {analysis.new_words.map((w, i) => (
                    <span key={i} className="px-5 py-1.5 text-sm rounded-full border border-accent/30 text-accent/80 bg-accent/10 hover:bg-accent/20 transition-colors cursor-default">{w}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border/30 p-6 bg-card/30">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-6">Skill Breakdown</h3>
              <div className="space-y-5">
                {Object.entries(skillBreakdown).map(([skill, val]) => (
                  <RadarBar key={skill} label={skill.charAt(0).toUpperCase() + skill.slice(1)}
                    value={val} color={skillColors[skill] || 'hsl(var(--accent))'} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Overall Score', val: score, suffix: '/100', color: scoreColor },
                { label: 'Grammar', val: metrics.grammar_accuracy, suffix: '%' },
                { label: 'Speaking Speed', val: metrics.fluency_wpm, suffix: ' wpm' },
                { label: 'Confidence', val: metrics.confidence_score, suffix: '%' },
                { label: 'Vocabulary', val: metrics.vocabulary_score, suffix: '%' },
                { label: 'Pronunciation', val: metrics.pronunciation_score, suffix: '%' },
              ].map(({ label, val, suffix, color }) => (
                <div key={label} className="rounded-2xl border border-border/30 bg-card/30 p-5 text-center">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mb-2">{label}</div>
                  <div className="text-3xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: color || undefined }}>
                    {val || 0}<span className="text-lg text-muted-foreground ml-0.5">{suffix}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'mistakes' && (
          <div>
            {mistakes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center bg-card/20 rounded-2xl border border-border/20">
                <div className="text-5xl mb-4">🎉</div>
                <p className="text-xl font-semibold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>No corrections needed!</p>
                <p className="text-sm text-muted-foreground">Flawless grammar — well done.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {mistakes.map((m, i) => (
                  <div key={i} className="rounded-2xl border border-border/30 bg-card/30 p-5">
                    <div className="flex items-start gap-4">
                      <span className="shrink-0 w-7 h-7 rounded-full bg-destructive/10 text-destructive flex items-center justify-center text-xs font-bold mt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        {typeof m === 'string' ? (
                          <>
                            <p className="text-sm text-destructive line-through mb-1.5 opacity-80">{m.split('->')[0]?.trim()}</p>
                            <p className="text-sm text-emerald-500 font-medium tracking-wide">→ {m.split('->')[1]?.trim()}</p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 flex-wrap mb-1.5">
                              <p className="text-sm text-destructive line-through opacity-80">{m.original}</p>
                              {m.severity && (
                                <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-[0.1em] font-bold ${m.severity === 'major' ? 'bg-destructive/20 text-destructive' : m.severity === 'moderate' ? 'bg-amber-500/20 text-amber-500' : 'bg-muted text-muted-foreground'}`}>{m.severity}</span>
                              )}
                            </div>
                            <p className="text-sm text-emerald-500 font-medium tracking-wide mb-3">→ {m.corrected}</p>
                            {m.explanation && (
                              <p className="text-xs text-muted-foreground/80 bg-background/50 rounded-xl px-4 py-3 leading-relaxed border border-border/20">{m.explanation}</p>
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

        {activeTab === 'homework' && (
          <div>
            {(analysis.homework || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center bg-card/20 rounded-2xl border border-border/20">
                <div className="text-5xl mb-4">📭</div>
                <p className="text-sm text-muted-foreground font-medium">No homework assigned for this session.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {analysis.homework.map((hw, i) => (
                  <div key={i} className="rounded-2xl border border-border/30 bg-card/30 p-6">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl shrink-0 mt-1">{hwTypeIcon[hw.type] || '📝'}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h4 className="text-base font-semibold">{hw.title}</h4>
                          {hw.estimated_minutes && (
                            <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-accent/15 text-accent border border-accent/20 tracking-[0.05em]">{hw.estimated_minutes} min</span>
                          )}
                          {hw.type && (
                            <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-muted text-muted-foreground tracking-[0.05em]">{hw.type}</span>
                          )}
                        </div>
                        <p className="text-sm text-foreground/80 leading-relaxed font-light">{hw.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'transcript' && (
          <div className="space-y-4 bg-card/30 border border-border/30 rounded-2xl p-6">
            {transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No transcript available.</p>
            ) : (
              transcript.map((t, i) => (
                <div key={i} className={`flex gap-4 ${t.speaker === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold uppercase ${t.speaker === 'user' ? 'bg-accent/20 text-accent ring-1 ring-accent/30' : 'bg-muted text-muted-foreground ring-1 ring-border/50'}`}>
                    {t.speaker === 'user' ? 'You' : 'AI'}
                  </div>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed ${t.speaker === 'user' ? 'bg-accent/15 text-foreground rounded-tr-sm border border-accent/10' : 'bg-background text-foreground rounded-tl-sm border border-border/40 shadow-sm'}`}>
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

// ─── Main SessionPage ─────────────────────────────────────────────────────────

export default function SessionPage() {
  const { sessionId: paramId } = useParams();
  const [sessionId, setSessionId] = useState(paramId);
  const [sessionData, setSessionData] = useState(null);
  // status: loading | ready | connecting | active | scoring | completed
  const [status, setStatus] = useState('loading');
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const transcriptRef = useRef([]);

  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(30);
  const [customDurationInput, setCustomDurationInput] = useState('');

  // Refs
  const geminiSessionRef = useRef(null);
  const isEndingRef = useRef(false);
  const voiceStateRef = useRef('idle');
  const mutedRef = useRef(false);
  const sessionIdRef = useRef(null);

  // Audio playback
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const nextStartTime = useRef(0);
  const sources = useRef(new Set());

  // Web Audio API — created once, never recreated
  const inputAudioContext = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
  ).current;
  const outputAudioContext = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
  ).current;

  // Mic nodes
  const mediaStream = useRef(null);
  const sourceNode = useRef(null);
  const scriptProcessorNode = useRef(null);
  const outputNode = useRef(null);

  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Wire output gain node once
  useEffect(() => {
    const gain = outputAudioContext.createGain();
    gain.connect(outputAudioContext.destination);
    outputNode.current = gain;
    nextStartTime.current = outputAudioContext.currentTime;
  }, []);

  // Load session if sessionId in URL
  useEffect(() => {
    if (!sessionId) {
      setStatus(prev => (['connecting', 'active', 'scoring'].includes(prev) ? prev : 'ready'));
      return;
    }
    const load = async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}`);
        setSessionData(res.data);
        if (res.data.status === 'completed') { setStatus('completed'); return; }
        setStatus(prev => (['active', 'connecting', 'scoring', 'saving'].includes(prev) ? prev : 'ready'));
      } catch {
        setStatus(prev => (['active', 'connecting', 'scoring', 'saving'].includes(prev) ? prev : 'ready'));
      }
    };
    load();
  }, [sessionId]);

  const buildSystemPrompt = () => {
    if (sessionData?.system_prompt) return sessionData.system_prompt;
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
- Keep the conversation completely open-ended. ALWAYS ask follow-up questions.
- Do NOT abruptly state that the session or conversation is over.
- Before closing the session, ask if they have any other questions. End ONLY after they confirm they are done.
- Never output asterisks, markdown, bracketed text, or internal reasoning.
- Keep responses concise — this is about THEIR speaking practice.`;
  };

  // ── Audio playback queue ──────────────────────────────────────────────────
  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0) return;
    const audioBuffer = audioQueueRef.current.shift();
    const source = outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputNode.current);

    const now = outputAudioContext.currentTime;
    if (nextStartTime.current < now) nextStartTime.current = now;

    if (!isPlayingRef.current) {
      console.log(`[Time Log] AI started talking at: ${new Date().toISOString()} (${Date.now()})`);
    }

    source.start(nextStartTime.current);
    nextStartTime.current += audioBuffer.duration;
    sources.current.add(source);
    isPlayingRef.current = true;

    source.addEventListener('ended', () => {
      sources.current.delete(source);
      if (sources.current.size === 0 && audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        if (voiceStateRef.current !== 'listening') {
          voiceStateRef.current = 'listening';
          setVoiceState('listening');
        }
      }
    });

    playNextInQueue(); // schedule all buffered chunks immediately
  };

  // ── Handle Gemini SDK messages ────────────────────────────────────────────
  const handleGeminiMessage = (msg) => {
    const sc = msg.serverContent;
    if (!sc) return;

    // Audio output chunks
    if (sc.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData?.data) {
          const bytes = decode(part.inlineData.data);
          if (bytes.length === 0) continue;
          try {
            const buf = decodeAudioData(bytes, outputAudioContext, 24000, 1);
            audioQueueRef.current.push(buf);
            if (voiceStateRef.current !== 'speaking') {
              voiceStateRef.current = 'speaking';
              setVoiceState('speaking');
            }
            playNextInQueue();
          } catch (e) { console.error('Audio decode error', e); }
        }
      }
    }

    // AI speech transcription (partial)
    if (sc.outputTranscription?.text) {
      const text = sc.outputTranscription.text;
      const arr = transcriptRef.current;
      const last = arr[arr.length - 1];
      if (last && last.speaker === 'ai' && !last.final) {
        last.text += (last.text.endsWith(' ') || text.startsWith(' ') ? '' : ' ') + text;
      } else {
        if (last && !last.final) last.final = true;
        arr.push({ speaker: 'ai', text, final: false });
      }
    }

    // User speech transcription (partial)
    if (sc.inputTranscription?.text) {
      const text = sc.inputTranscription.text;
      const arr = transcriptRef.current;
      const last = arr[arr.length - 1];
      if (last && last.speaker === 'user' && !last.final) {
        last.text += (last.text.endsWith(' ') || text.startsWith(' ') ? '' : ' ') + text;
      } else {
        if (last && !last.final) last.final = true;
        arr.push({ speaker: 'user', text, final: false });
      }
    }

    // Turn complete — finalize last transcript entry
    if (sc.turnComplete) {
      const last = transcriptRef.current[transcriptRef.current.length - 1];
      if (last && !last.final) last.final = true;
    }

    // Barge-in / interrupted — clear audio queue immediately
    if (sc.interrupted) {
      audioQueueRef.current = [];
      for (const src of sources.current.values()) { try { src.stop(); } catch (_) { } }
      sources.current.clear();
      nextStartTime.current = outputAudioContext.currentTime;
      isPlayingRef.current = false;
      voiceStateRef.current = 'listening';
      setVoiceState('listening');
    }
  };

  // ── Start mic recording, send audio directly to Gemini SDK ───────────────
  const startRecording = async (geminiSession) => {
    inputAudioContext.resume();
    try {
      mediaStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      sourceNode.current = inputAudioContext.createMediaStreamSource(mediaStream.current);

      if (!inputAudioContext.audioWorkletAdded) {
        const workletCode = `
          class PCMRecorder extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs[0];
              if (!input || input.length === 0) return true;
              const pcmData = input[0];
              if (!pcmData || pcmData.length === 0) return true;
              const int16 = new Int16Array(pcmData.length);
              for (let i = 0; i < pcmData.length; i++) {
                let s = Math.max(-1, Math.min(1, pcmData[i]));
                int16[i] = s < 0 ? s * 32768 : s * 32767;
              }
              this.port.postMessage(int16);
              return true;
            }
          }
          if (typeof registerProcessor !== 'undefined') {
            registerProcessor('pcm-recorder', PCMRecorder);
          }
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        try {
          await inputAudioContext.audioWorklet.addModule(URL.createObjectURL(blob));
          inputAudioContext.audioWorkletAdded = true;
        } catch (e) {
          console.warn('Worklet may already be registered:', e);
        }
      }

      scriptProcessorNode.current = new AudioWorkletNode(inputAudioContext, 'pcm-recorder', {
        numberOfOutputs: 0,
      });

      // ── KEY CHANGE: send PCM directly to Gemini SDK, no WebSocket relay ──
      let silenceFrames = 0;
      let isSpeakingLocal = false;
      const ENERGY_THRESHOLD = 500;

      scriptProcessorNode.current.port.onmessage = (e) => {
        if (mutedRef.current || !geminiSession) return;

        const pcmData = new Int16Array(e.data.buffer);
        let maxEnergy = 0;
        for (let i = 0; i < pcmData.length; i++) {
          if (Math.abs(pcmData[i]) > maxEnergy) maxEnergy = Math.abs(pcmData[i]);
        }

        if (maxEnergy > ENERGY_THRESHOLD) {
          if (!isSpeakingLocal) isSpeakingLocal = true;
          silenceFrames = 0;
        } else {
          if (isSpeakingLocal) {
            silenceFrames++;
            // ~30 frames * 8ms = ~240ms of silence
            if (silenceFrames > 30) {
              console.log(`[Time Log] User ended speaking at: ${new Date().toISOString()} (${Date.now()})`);
              isSpeakingLocal = false;
            }
          }
        }

        try {
          geminiSession.sendRealtimeInput({
            audio: {
              data: encode(new Uint8Array(e.data.buffer)),
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch (_) {
          // Session may have closed; ignore
        }
      };

      sourceNode.current.connect(scriptProcessorNode.current);
    } catch (err) {
      console.error('Mic error:', err);
      toast.error('Microphone access required');
      setStatus('ready');
    }
  };

  const stopRecording = () => {
    if (scriptProcessorNode.current && sourceNode.current) {
      try { scriptProcessorNode.current.disconnect(); } catch (_) { }
      try { sourceNode.current.disconnect(); } catch (_) { }
    }
    scriptProcessorNode.current = null;
    sourceNode.current = null;
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach(t => t.stop());
      mediaStream.current = null;
    }
  };

  // ── Finalize: call /complete then /score-session with same transcript ─────
  const finalizeSession = async (sid) => {
    if (!sid) {
      setStatus('ready');
      return;
    }

    const cleanTranscript = transcriptRef.current
      .filter(t => t?.text && t.text.trim().length > 0)
      .map(t => ({ ...t, final: true }));

    setTranscript(cleanTranscript);
    setStatus('scoring');
    setVoiceState('processing');

    // ── 1. Mark session complete ──────────────────────────────────────────
    try {
      await api.put(`/sessions/${sid}/complete`, {
        transcript: cleanTranscript,
        metrics: {},
      });
      console.log('[Finalize] /complete ✓');
    } catch (err) {
      console.error('[Finalize] /complete failed:', err);
      // Non-fatal — continue to scoring
    }

    // ── 2. Score session (sends same transcript to Gemini for analysis) ───
    try {
      await api.post('/ai/score-session', {
        session_id: sid,
        transcript: cleanTranscript,
      });
      console.log('[Finalize] /score-session ✓');

      // ── 3. Fetch the fully-enriched session doc ───────────────────────
      const res = await api.get(`/sessions/${sid}`);
      setSessionData(res.data);
      setStatus('completed');
      setVoiceState('idle');
      toast.success('Session scored!');
    } catch (err) {
      console.error('[Finalize] /score-session failed:', err);
      // Graceful degradation: still show completed view without scores
      try {
        const res = await api.get(`/sessions/${sid}`);
        setSessionData(res.data);
      } catch (_) { }
      setStatus('completed');
      setVoiceState('idle');
      toast.warning('Session saved, but scoring failed. Refresh to retry.');
    }
  };

  // ── Start session: ephemeral token → direct Gemini connection ────────────
  const startSession = async () => {
    setStatus('connecting');
    isEndingRef.current = false;

    try {
      await outputAudioContext.resume();

      // Step 1: Create session doc on backend (stores system_prompt, plan info, etc.)
      let sid = sessionId;
      if (!sid) {
        const createRes = await api.post('/sessions', {
          session_type: sessionData?.session_type || 'speaking',
          plan_id: sessionData?.plan_id || null,
          plan_module_index: sessionData?.plan_module_index ?? null,
          plan_session_index: sessionData?.plan_session_index ?? null,
          plan_session_id: sessionData?.plan_session_id || null,
          system_prompt: buildSystemPrompt(),
          target_duration_minutes: sessionDuration,
        });
        sid = createRes.data.id;
        setSessionId(sid);
        sessionIdRef.current = sid;
        setSessionData(createRes.data);
      } else {
        sessionIdRef.current = sid;
      }

      // Step 2: Mint ephemeral token — backend bakes system_prompt into the token's
      // live_connect_constraints, so the prompt never round-trips through Python during the call.
      const tokenRes = await api.post('/sessions/live-token', {
        session_id: sid,
        system_prompt: buildSystemPrompt(),
      });
      const { token: ephemeralToken } = tokenRes.data;
      console.log('[Session] Ephemeral token minted ✓');

      // Step 3: Connect DIRECTLY to Gemini — audio goes browser ↔ Gemini, zero relay
      // NOTE: ephemeral tokens require v1alpha
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      const geminiSession = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 20,
              silenceDurationMs: 150,
            },
          },
        },
        callbacks: {
          onopen: () => {
            console.log('[Gemini] Connection open ✓');
            setStatus('active');
            voiceStateRef.current = 'listening';
            setVoiceState('listening');
            // Defer by one tick so ai.live.connect() resolves and
            // geminiSessionRef.current is assigned before we use it —
            // fixes "Cannot access 'geminiSession' before initialization" (TDZ)
            setTimeout(() => startRecording(geminiSessionRef.current), 0);
          },
          onmessage: (msg) => handleGeminiMessage(msg),
          onerror: (e) => {
            console.error('[Gemini] Error:', e);
            toast.error('Connection error — please try again.');
            setStatus('ready');
          },
          onclose: () => {
            console.log('[Gemini] Connection closed');
            if (voiceStateRef.current !== 'idle') {
              voiceStateRef.current = 'idle';
              setVoiceState('idle');
            }
            // Guard: only finalize if endSession() hasn't already done so
            if (!isEndingRef.current) {
              isEndingRef.current = true;
              finalizeSession(sessionIdRef.current);
            }
          },
        },
      });

      geminiSessionRef.current = geminiSession;
      console.log('[Session] Direct Gemini connection active ✓');

    } catch (err) {
      console.error('[Session] Start error:', err);
      toast.error('Failed to start: ' + (err?.message || 'Unknown error'));
      setStatus('ready');
    }
  };

  // ── Send typed text ───────────────────────────────────────────────────────
  const sendText = () => {
    if (!textInput.trim() || !geminiSessionRef.current) return;
    try {
      geminiSessionRef.current.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: textInput }] }],
        turnComplete: true,
      });
      transcriptRef.current.push({ speaker: 'user', text: textInput, final: true });
    } catch (err) {
      console.error('sendText error:', err);
    }
    setTextInput('');
  };

  // ── End session (user clicks End button) ─────────────────────────────────
  const endSession = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;   // prevent onclose from double-finalizing

    stopRecording();

    audioQueueRef.current = [];
    for (const src of sources.current) { try { src.stop(); } catch (_) { } }
    sources.current.clear();
    isPlayingRef.current = false;

    if (geminiSessionRef.current) {
      try { geminiSessionRef.current.close(); } catch (_) { }
      geminiSessionRef.current = null;
    }

    // Call finalize directly — don't wait for onclose
    await finalizeSession(sessionIdRef.current);
  };

  // ── Session timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    let interval;
    if (status === 'active') {
      interval = setInterval(() => {
        setSecondsElapsed(prev => {
          const next = prev + 1;
          const limitSecs = (sessionData?.target_duration_minutes || sessionDuration) * 60;
          const wrapUpAt = Math.floor(limitSecs * 0.9);
          const hardStopAt = Math.floor(limitSecs * 0.98);

          if (next === wrapUpAt && geminiSessionRef.current) {
            try {
              geminiSessionRef.current.sendClientContent({
                turns: [{
                  role: 'user',
                  parts: [{ text: 'SYSTEM: Time is almost up. Please start wrapping up — summarize what was covered, give relevant homework, and say a warm goodbye.' }],
                }],
                turnComplete: true,
              });
            } catch (_) { }
          }

          if (next >= hardStopAt) endSession();
          return next;
        });
      }, 1000);
    } else if (!['connecting', 'scoring'].includes(status)) {
      setSecondsElapsed(0);
    }
    return () => clearInterval(interval);
  }, [status, sessionData, sessionDuration]);

  const currentLimitSeconds = (sessionData?.target_duration_minutes || sessionDuration) * 60;
  const remainingSeconds = Math.max(0, currentLimitSeconds - secondsElapsed);
  const isTimeLow = remainingSeconds < 60;

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="session-page">

      {/* ── Header ── */}
      <div className="flex items-center justify-between p-4 border-b border-border/50 glass">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate('/dashboard')} data-testid="session-back">
            <ArrowLeft size={18} />
          </Button>
          <div className="flex items-center">
            <span className="font-semibold text-sm" style={{ fontFamily: 'Fraunces, serif' }}>
              {sessionData?.session_type
                ? `${sessionData.session_type.charAt(0).toUpperCase() + sessionData.session_type.slice(1)} Session`
                : 'Session'}
            </span>
            {sessionData && <Badge variant="outline" className="ml-2 text-[10px]">{user?.cefr_level}</Badge>}
            {status === 'active' && (
              <Badge variant={isTimeLow ? 'destructive' : 'secondary'} className="ml-2 text-[10px]">
                {Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, '0')}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>

      {/* ── Loading / Connecting ── */}
      {(status === 'loading' || status === 'connecting') && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <VoiceVisualizer state="processing" size="md" />
            <p className="mt-12 text-muted-foreground">
              {status === 'loading' ? 'Loading…' : 'Connecting to Fluentra…'}
            </p>
          </div>
        </div>
      )}

      {/* ── Scoring ── */}
      {status === 'scoring' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <VoiceVisualizer state="processing" size="md" />
            <p className="mt-12 text-muted-foreground font-medium">Scoring your session…</p>
            <p className="mt-2 text-xs text-muted-foreground/60">Analysing grammar, fluency and vocabulary</p>
          </div>
        </div>
      )}

      {/* ── Ready ── */}
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
                    <Button key={mins} size="sm"
                      variant={sessionDuration === mins && !customDurationInput ? 'default' : 'outline'}
                      onClick={() => { setSessionDuration(mins); setCustomDurationInput(''); }}
                      className="rounded-full h-9 px-4">{mins} min</Button>
                  ))}
                  <div className="flex items-center">
                    <input type="number" placeholder="Custom" value={customDurationInput}
                      onChange={e => {
                        setCustomDurationInput(e.target.value);
                        if (e.target.value) setSessionDuration(parseInt(e.target.value) || 30);
                      }}
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

      {/* ── Active ── */}
      {status === 'active' && (
        <div className="flex-1 flex flex-col">
          <div className="flex-shrink-0 flex items-center justify-center py-12">
            <VoiceVisualizer state={voiceState} size="lg" />
          </div>
          <div className="flex-1 border-t border-border/50 flex items-center justify-center">
            <p className="text-xs text-muted-foreground/60 italic">Transcript will be available after the session</p>
          </div>
          <div className="border-t border-border/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <input
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendText()}
                placeholder="Or type a message…"
                className="flex-1 bg-muted/50 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="session-text-input"
              />
              <Button variant="ghost" size="icon" className="rounded-full" onClick={sendText} data-testid="session-send-text">
                <MessageSquare size={18} />
              </Button>
            </div>
            <div className="flex items-center justify-center gap-4">
              <Button variant="outline" size="icon" className="rounded-full w-12 h-12" onClick={() => setMuted(m => !m)} data-testid="session-mute">
                {muted ? <MicOff size={20} className="text-destructive" /> : <Mic size={20} />}
              </Button>
              <Button className="rounded-full px-8 py-5 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={endSession} data-testid="session-end-btn">
                <PhoneOff size={18} className="mr-2" /> End Session
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Completed ── */}
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