import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Mic, MicOff, PhoneOff, Sun, Moon, ArrowLeft } from 'lucide-react';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import api from '@/utils/api';
import { GoogleGenAI } from '@google/genai';

// ─── Audio helpers — copied verbatim from AssessmentPage ─────────────────────

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

// ─── Completed session UI ─────────────────────────────────────────────────────

function ScoreRing({ value, max = 100, color = '#4ade80', size = 120 }) {
  const r = 46;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(1, (value || 0) / max) * circ;
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
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${value || 0}%`, background: color }} />
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
            {analysis.encouraging_note
              ? <p className="text-sm text-muted-foreground mb-6 italic leading-relaxed max-w-2xl">{analysis.encouraging_note}</p>
              : analysis.summary
                ? <p className="text-sm text-white/50 mb-6 italic leading-relaxed max-w-2xl">{analysis.summary.split('. ')[0] + '.'}</p>
                : null}
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
                      const str = typeof s === 'string' ? s : JSON.stringify(s) || '';
                      const [title, ...rest] = str.split(':');
                      const desc = rest.join(':');
                      return (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="text-emerald-500 shrink-0 mt-0.5 text-lg leading-none">✦</span>
                          <div className="text-foreground/80 leading-relaxed font-light">
                            {desc ? <><strong className="text-foreground font-medium">{title}:</strong>{desc}</> : str}
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
                      const str = typeof a === 'string' ? a : JSON.stringify(a) || '';
                      const [title, ...rest] = str.split(':');
                      const desc = rest.join(':');
                      return (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="text-yellow-500 shrink-0 mt-0.5 text-lg leading-none">→</span>
                          <div className="text-foreground/80 leading-relaxed font-light">
                            {desc ? <><strong className="text-foreground font-medium">{title}:</strong>{desc}</> : str}
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
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Filler Words Used ({metrics.filler_word_count || 0} times)
                  </h3>
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
                  <RadarBar key={skill} label={skill.charAt(0).toUpperCase() + skill.slice(1)} value={val} color={skillColors[skill] || 'hsl(var(--accent))'} />
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
                            <p className="text-sm text-destructive line-through mb-1.5 opacity-80">{(m.split('->')[0] ?? '').trim()}</p>
                            <p className="text-sm text-emerald-500 font-medium tracking-wide">→ {(m.split('->')[1] ?? '').trim()}</p>
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
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed mt-4 ${t.speaker === 'user' ? 'bg-accent/15 text-foreground rounded-tr-sm border border-accent/10' : 'bg-background text-foreground rounded-tl-sm border border-border/40 shadow-sm'}`}>
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
// Audio engine = AssessmentPage's engine, copied exactly.
// Differences from AssessmentPage:
//   • sessionId comes from URL params (may already exist)
//   • CompletedView with 5 tabs instead of results card
//   • Session timer + duration picker
//   • Calls /ai/score-session instead of /sessions/:id/score-assessment

export default function SessionPage() {
  const { sessionId: paramId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // ── UI state ───────────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState(paramId);
  const [sessionData, setSessionData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [voiceState, setVoiceState] = useState('idle');
  const voiceStateRef = useRef('idle');
  const [transcript, setTranscript] = useState([]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(30);
  const [customDurationInput, setCustomDurationInput] = useState('');

  // ── Output audio — created once at top level, exactly like AssessmentPage ──
  const outputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
  );
  const outputGainRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);

  // ── Input audio — created fresh inside startMicrophone, like AssessmentPage
  const streamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);

  // ── Session refs ───────────────────────────────────────────────────────────
  const geminiSessionRef = useRef(null);
  const sessionIdRef = useRef(null);
  const transcriptRef = useRef([]);
  const isEndingRef = useRef(false);

  // ── Wire output gain once — same as AssessmentPage useEffect ──────────────
  useEffect(() => {
    const ctx = outputAudioContextRef.current;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    outputGainRef.current = gain;
    nextStartTimeRef.current = ctx.currentTime;
  }, []);

  // ── Load session ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!paramId) { setStatus('ready'); return; }
    api.get(`/sessions/${paramId}`)
      .then(res => {
        setSessionData(res.data);
        setStatus(res.data.status === 'completed' ? 'completed' : 'ready');
      })
      .catch(() => setStatus('ready'));
  }, [paramId]);

  // ── System prompt ──────────────────────────────────────────────────────────
  const buildSystemPrompt = () => {
    if (sessionData?.system_prompt) return sessionData.system_prompt;
    const type = sessionData?.session_type || 'speaking';
    const level = user?.cefr_level || 'B1';
    const native = user?.native_language || 'their native language';
    return `You are Fluentra, a friendly, encouraging English coach. You're conducting a ${type} session for a ${level} level student named ${user?.name || 'Student'}. Their native language is ${native}.
Session type: ${type} | Student level: ${level}
Goals: ${user?.learning_goals?.join(', ') || 'General improvement'}
Rules:
- Be warm, natural, and conversational — like a real human coach.
- Start with a brief friendly greeting and dive straight into practice.
- Correct grammar mistakes gently inline, then continue naturally.
- Keep the conversation open-ended. ALWAYS ask follow-up questions.
- Do NOT abruptly state the session is over.
- Before closing, ask if they have any other questions. End ONLY after they confirm.
- Never output asterisks, markdown, or internal reasoning.
- Keep responses concise — this is about THEIR speaking practice.`;
  };

  // ── playAudio — copied verbatim from AssessmentPage ───────────────────────
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

    if (voiceStateRef.current !== 'speaking') {
      voiceStateRef.current = 'speaking';
      setVoiceState('speaking');
    }
  }, []);

  // ── startMicrophone — copied verbatim from AssessmentPage ─────────────────
  const startMicrophone = async (sessionInstance) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      streamRef.current = stream;

      const inputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      sourceNodeRef.current = inputCtx.createMediaStreamSource(stream);
      scriptProcessorRef.current = inputCtx.createScriptProcessor(2048, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (e) => {
        if (mutedRef.current || isEndingRef.current || !sessionInstance) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = float32ToInt16(float32);
        const bytes = new Uint8Array(int16.buffer);

        let binary = '';
        const chunkSize = 1024;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }

        try {
          sessionInstance.sendRealtimeInput({
            media: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' }
          });
        } catch (err) {
          console.warn('sendRealtimeInput failed:', err);
        }
      };

      sourceNodeRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputCtx.destination);
    } catch (err) {
      console.error('[Mic]', err);
      toast.error('Microphone access denied. Please allow microphone access.');
      setStatus('ready');
    }
  };

  const stopMicrophone = () => {
    try { scriptProcessorRef.current?.disconnect(); } catch (_) { }
    try { sourceNodeRef.current?.disconnect(); } catch (_) { }
    scriptProcessorRef.current = null;
    sourceNodeRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // ── onmessage — same logic as AssessmentPage ──────────────────────────────
  const handleMessage = (message) => {
    const audioPart = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
    if (audioPart?.data) playAudio(audioPart.data);

    const outputTranscript = message.serverContent?.outputTranscription?.text;
    if (outputTranscript) {
      const cur = transcriptRef.current;
      const last = cur[cur.length - 1];
      if (last && last.speaker === 'ai' && !last.final) {
        const sep = last.text.endsWith(' ') ? '' : ' ';
        transcriptRef.current = [...cur.slice(0, -1), { ...last, text: last.text + sep + outputTranscript }];
      } else {
        const base = (last && !last.final) ? [...cur.slice(0, -1), { ...last, final: true }] : cur;
        transcriptRef.current = [...base, { speaker: 'ai', text: outputTranscript, final: false }];
      }
    }

    const inputTranscript = message.serverContent?.inputTranscription?.text;
    if (inputTranscript) {
      const cur = transcriptRef.current;
      const last = cur[cur.length - 1];
      if (last && last.speaker === 'user' && !last.final) {
        const sep = last.text.endsWith(' ') ? '' : ' ';
        transcriptRef.current = [...cur.slice(0, -1), { ...last, text: last.text + sep + inputTranscript }];
      } else {
        const base = (last && !last.final) ? [...cur.slice(0, -1), { ...last, final: true }] : cur;
        transcriptRef.current = [...base, { speaker: 'user', text: inputTranscript, final: false }];
      }
    }

    if (message.serverContent?.turnComplete) {
      voiceStateRef.current = 'listening';
      setVoiceState('listening');
      const cur = transcriptRef.current;
      const last = cur[cur.length - 1];
      if (last && !last.final) {
        transcriptRef.current = [...cur.slice(0, -1), { ...last, final: true }];
      }
    }

    if (message.serverContent?.interrupted) {
      for (const source of sourcesRef.current.values()) { try { source.stop(); } catch (_) { } }
      sourcesRef.current.clear();
      nextStartTimeRef.current = 0;
      voiceStateRef.current = 'listening';
      setVoiceState('listening');
      const cur = transcriptRef.current;
      const last = cur[cur.length - 1];
      if (last && !last.final) {
        transcriptRef.current = [...cur.slice(0, -1), { ...last, final: true }];
      }
    }
  };

  // ── finalizeSession ────────────────────────────────────────────────────────
  const finalizeSession = async (sid) => {
    if (!sid) { setStatus('ready'); return; }
    const clean = transcriptRef.current
      .filter(t => t?.text?.trim())
      .map(t => ({ ...t, final: true }));
    setTranscript(clean);
    setStatus('scoring');
    voiceStateRef.current = 'idle';
    setVoiceState('idle');
    try {
      await api.put(`/sessions/${sid}/complete`, { transcript: clean, metrics: {} });
    } catch (err) {
      console.error('[Finalize] /complete failed:', err);
    }
    try {
      await api.post('/ai/score-session', { session_id: sid, transcript: clean });
      const res = await api.get(`/sessions/${sid}`);
      setSessionData(res.data);
      setStatus('completed');
      toast.success('Session scored!');
    } catch (err) {
      console.error('[Finalize] /score-session failed:', err);
      try { const res = await api.get(`/sessions/${sid}`); setSessionData(res.data); } catch (_) { }
      setStatus('completed');
      toast.warning('Session saved — scoring failed. Refresh to retry.');
    }
  };

  // ── startSession — mirrors AssessmentPage's startAssessment ───────────────
  const startSession = async () => {
    setStatus('connecting');
    isEndingRef.current = false;
    transcriptRef.current = [];

    try {
      await outputAudioContextRef.current.resume();
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      let sid = sessionId;
      if (!sid) {
        const res = await api.post('/sessions', {
          session_type: sessionData?.session_type || 'speaking',
          plan_id: sessionData?.plan_id || null,
          plan_module_index: sessionData?.plan_module_index ?? null,
          plan_session_index: sessionData?.plan_session_index ?? null,
          plan_session_id: sessionData?.plan_session_id || null,
          system_prompt: buildSystemPrompt(),
          target_duration_minutes: sessionDuration,
        });
        sid = res.data.id;
        setSessionId(sid);
        setSessionData(res.data);
      }
      sessionIdRef.current = sid;

      const tokenRes = await api.post('/sessions/live-token', {
        session_id: sid,
        system_prompt: buildSystemPrompt(),
      });
      const { token, model } = tokenRes.data;

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });

      // Two-phase open — same pattern as AssessmentPage
      let _onOpenCalled = false;
      const _pendingOpen = () => {
        setStatus('active');
        voiceStateRef.current = 'listening';
        setVoiceState('listening');
        startMicrophone(geminiSessionRef.current);
      };

      const session = await ai.live.connect({
        model: model,
        config: { responseModalities: ['AUDIO'] },
        callbacks: {
          onopen: () => {
            _onOpenCalled = true;
            if (geminiSessionRef.current) _pendingOpen();
          },
          onmessage: handleMessage,
          onerror: (e) => {
            console.error('[Gemini] error:', e);
            toast.error('Connection error — please try again.');
            setStatus('ready');
          },
          onclose: () => {
            stopMicrophone();
            if (!isEndingRef.current) {
              isEndingRef.current = true;
              finalizeSession(sessionIdRef.current);
            }
          },
        },
      });

      geminiSessionRef.current = session;
      if (_onOpenCalled) _pendingOpen();

    } catch (err) {
      console.error('[Session] start error:', err);
      toast.error('Failed to start: ' + (err?.message || 'Unknown error'));
      setStatus('ready');
    }
  };

  // ── endSession ─────────────────────────────────────────────────────────────
  const endSession = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    if (geminiSessionRef.current) {
      try { geminiSessionRef.current.disconnect(); } catch (_) { }
    }
    stopMicrophone();
    for (const source of sourcesRef.current.values()) { try { source.stop(); } catch (_) { } }
    sourcesRef.current.clear();
    await finalizeSession(sessionIdRef.current);
  };

  // ── Session timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    let interval;
    if (status === 'active') {
      interval = setInterval(() => {
        setSecondsElapsed(prev => {
          const next = prev + 1;
          const limitSecs = (sessionData?.target_duration_minutes || sessionDuration) * 60;
          if (next === Math.floor(limitSecs * 0.9) && geminiSessionRef.current) {
            try {
              geminiSessionRef.current.sendClientContent({
                turns: [{ role: 'user', parts: [{ text: 'SYSTEM: Time is almost up. Please start wrapping up — summarize what was covered, give relevant homework, and say a warm goodbye.' }] }],
                turnComplete: true,
              });
            } catch (_) { }
          }
          if (next >= Math.floor(limitSecs * 0.98)) endSession();
          return next;
        });
      }, 1000);
    } else if (!['connecting', 'scoring'].includes(status)) {
      setSecondsElapsed(0);
    }
    return () => clearInterval(interval);
  }, [status, sessionData, sessionDuration]);

  const remainingSeconds = Math.max(0, (sessionData?.target_duration_minutes || sessionDuration) * 60 - secondsElapsed);
  const isTimeLow = remainingSeconds < 60;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="session-page">

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

      {status === 'scoring' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <VoiceVisualizer state="processing" size="md" />
            <p className="mt-12 text-muted-foreground font-medium">Scoring your session…</p>
            <p className="mt-2 text-xs text-muted-foreground/60">Analysing grammar, fluency and vocabulary</p>
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

      {status === 'active' && (
        <div className="flex-1 flex flex-col">
          <div className="flex-1 flex items-center justify-center">
            <VoiceVisualizer state={voiceState} size="lg" />
          </div>
          <div className="border-t border-border/50 p-6">
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className="rounded-full w-12 h-12"
                onClick={() => { setMuted(m => !m); mutedRef.current = !mutedRef.current; }}
                data-testid="session-mute"
              >
                {muted ? <MicOff size={20} className="text-destructive" /> : <Mic size={20} />}
              </Button>
              <Button
                className="rounded-full px-8 py-5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={endSession}
                data-testid="session-end-btn"
              >
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