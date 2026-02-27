import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Mic, MicOff, PhoneOff, Sun, Moon, AlertCircle } from 'lucide-react';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import api from '@/utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI } from '@google/genai';

// ─── Audio helpers ────────────────────────────────────────────────────────────

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

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGES = [
  { name: 'Warm-Up', desc: "Let's get to know each other", duration: 2 },
  { name: 'Description', desc: 'Paint a picture with words', duration: 3 },
  { name: 'Opinion', desc: 'What do you think?', duration: 3 },
  { name: 'Storytelling', desc: 'Bring a story to life', duration: 4 },
];

const SYSTEM_PROMPT = `You are Fluentra, a warm and encouraging English tutor conducting an initial language assessment. Your goal is to evaluate the student's English level through natural conversation.

Conduct 4 stages:

1. WARM-UP (2 min): 
   Start by saying exactly: "Welcome to your English assessment! I'm Fluentra, and I'll be chatting with you today to understand your English level. Don't worry — this is just a friendly conversation, not a test! Let's start simple. Could you tell me your name, what you do, and one hobby you enjoy?"

2. DESCRIPTION (3 min):
   Transition by saying exactly: "Now, let's move on to description." Then immediately continue with: "In this part, I'd like you to describe something in detail — really paint a picture with your words. Close your eyes for a moment and think of your absolute favorite place in the world. It could be a beach, your childhood bedroom, a cozy café... anywhere. Now describe it to me — what do you see, hear, and feel when you're there?"

3. OPINION (3 min):
   Transition by saying exactly: "Next, I'd like your opinion on something." Then immediately continue with: "This is your chance to share what you really think, and there's no right or wrong answer. Here's the statement: 'Technology makes people less social.' Do you agree or disagree? Tell me why — I want to hear your reasoning."

4. STORYTELLING (4 min):
   Transition by saying exactly: "For our final part, let's do some storytelling." Then immediately continue with: "I'll give you the start of a story, and you continue it however you like — be as creative as you want! Here it is: 'A woman found a mysterious letter in her mailbox one morning...' What happens next? The story is all yours!"

Rules:
- Be warm and encouraging. React naturally to what they say before moving on.
- If they struggle, simplify and offer gentle prompts.
- If they make a grammar or vocabulary mistake, correct it gently inline — do not wait.
- DO NOT output any internal thoughts, plans, or bracketed instructions. Speak ONLY what the user should hear.
- After all 4 stages, say warmly: "You've done wonderfully today — thank you so much for taking the time! I have everything I need to put together your personalized learning plan. The assessment is now complete."
- Keep your own responses concise — this is about THEIR speaking.`;

// ─── Main component ───────────────────────────────────────────────────────────

export default function AssessmentPage() {
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('intro');
  const [voiceState, setVoiceState] = useState('idle');
  const voiceStateRef = useRef('idle');
  const [transcript, setTranscript] = useState([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [scores, setScores] = useState(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [error, setError] = useState(null);
  const [stageJustChanged, setStageJustChanged] = useState(false);
  const [scoringStep, setScoringStep] = useState('');

  const geminiSessionRef = useRef(null);
  const transcriptRef = useRef([]);
  const streamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const isEndingRef = useRef(false);
  const transcriptEndRef = useRef(null);

  // Output audio — created once
  const outputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
  );
  const outputGainRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);

  const { user, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

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

  // Stage detection
  useEffect(() => {
    if (status !== 'active' || transcript.length === 0) return;

    const fullAiText = transcript
      .filter(t => t.speaker === 'ai')
      .map(t => t.text.toLowerCase())
      .join(' ');

    let newStage = stageIndex;
    if (fullAiText.includes("final part, let's do some storytelling") || fullAiText.includes("mysterious letter")) {
      newStage = 3;
    } else if (fullAiText.includes("next, i'd like your opinion") || fullAiText.includes("technology makes people less social")) {
      newStage = 2;
    } else if (fullAiText.includes("let's move on to description") || fullAiText.includes("favorite place")) {
      newStage = 1;
    }

    if (newStage !== stageIndex) {
      setStageIndex(newStage);
      setStageJustChanged(true);
      setTimeout(() => setStageJustChanged(false), 2000);
    }

    if (
      (fullAiText.includes('assessment is now complete') || fullAiText.includes('assessment complete')) &&
      !isEndingRef.current
    ) {
      setTimeout(() => endAssessment(), 2500);
    }
  }, [transcript, status, stageIndex]);

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
          console.warn('Realtime send failed:', err);
        }
      };

      sourceNodeRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputCtx.destination);
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access.');
      setStatus('intro');
    }
  };

  const startAssessment = async () => {
    setStatus('connecting');
    setError(null);
    try {
      await outputAudioContextRef.current.resume();
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      let sid = sessionId;
      if (!sid) {
        const res = await api.post('/sessions', { session_type: 'assessment' });
        sid = res.data.id;
        setSessionId(sid);
      }

      const tokenRes = await api.post('/sessions/live-token', {
        session_id: sid,
        system_prompt: SYSTEM_PROMPT,
      });
      const { token, model } = tokenRes.data;

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });

      let _onOpenCalled = false;
      const _pendingOpen = () => {
        setStatus('active');
        voiceStateRef.current = 'listening';
        setVoiceState('listening');
        startMicrophone(geminiSessionRef.current);
        geminiSessionRef.current.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Hello! I am ready to start my assessment.' }] }],
          turnComplete: true,
        });
      };

      const session = await ai.live.connect({
        model: model,
        config: { responseModalities: ['AUDIO'] },
        callbacks: {
          onopen: () => {
            _onOpenCalled = true;
            if (geminiSessionRef.current) _pendingOpen();
          },
          onmessage: (message) => {
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
              setTranscript([...transcriptRef.current]);
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
              setTranscript([...transcriptRef.current]);
            }

            if (message.serverContent?.turnComplete) {
              voiceStateRef.current = 'listening';
              setVoiceState('listening');
              const cur = transcriptRef.current;
              const last = cur[cur.length - 1];
              if (last && !last.final) {
                transcriptRef.current = [...cur.slice(0, -1), { ...last, final: true }];
                setTranscript([...transcriptRef.current]);
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
                setTranscript([...transcriptRef.current]);
              }
            }
          },
          onclose: () => {
            if (status === 'active') { voiceStateRef.current = 'idle'; setVoiceState('idle'); }
          },
          onerror: (err) => {
            console.error('Gemini error:', err);
            setError('Connection error. Please try again.');
            setStatus('intro');
          }
        }
      });

      geminiSessionRef.current = session;
      if (_onOpenCalled) _pendingOpen();

    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to create session');
      setStatus('intro');
    }
  };

  const endAssessment = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    if (geminiSessionRef.current) { try { geminiSessionRef.current.disconnect(); } catch (_) { } }
    try { scriptProcessorRef.current?.disconnect(); } catch (_) { }
    try { sourceNodeRef.current?.disconnect(); } catch (_) { }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    for (const source of sourcesRef.current.values()) { try { source.stop(); } catch (_) { } }
    sourcesRef.current.clear();

    setStatus('scoring');
    voiceStateRef.current = 'idle';
    setVoiceState('idle');

    try {
      const cleanTranscript = transcriptRef.current
        .filter(t => t.text && t.text.trim().length > 0)
        .map(t => ({ ...t, final: true }));

      setScoringStep('Storing session...');
      await api.put(`/sessions/${sessionId}/complete`, { transcript: cleanTranscript, metrics: {} });

      setScoringStep('Assessing your English...');
      const res = await api.post(`/sessions/${sessionId}/score-assessment`, { transcript: cleanTranscript });

      // ── FIX: normalise field names from the API response ─────────────────
      // The score-assessment endpoint returns its own schema (fluency_score,
      // grammar_score, areas_to_improve etc.). Map them to a consistent shape
      // so the results UI never shows wrong values.
      const raw = res.data;
      const normalised = {
        // Scores (already correct in the API response)
        fluency_score: raw.fluency_score ?? 0,
        grammar_score: raw.grammar_score ?? 0,
        vocabulary_score: raw.vocabulary_score ?? 0,
        confidence_score: raw.confidence_score ?? 0,
        weighted_score: raw.weighted_score ?? 0,
        cefr_level: raw.cefr_level ?? 'B1',
        // Arrays — handle both field name variants defensively
        strengths: raw.strengths ?? [],
        areas_to_improve: raw.areas_to_improve ?? raw.areas_for_improvement ?? [],
        detailed_feedback: raw.detailed_feedback ?? '',
      };
      setScores(normalised);

      setScoringStep('Creating your learning plan...');
      await api.post('/learning-plan/generate');

      setScoringStep('Finalizing...');
      const me = await api.get('/auth/me');
      updateUser(me.data);
      setStatus('done');
    } catch (err) {
      toast.error('Scoring failed, but your session was saved');
      setStatus('done');
      setScores({
        cefr_level: 'B1', weighted_score: 50,
        fluency_score: 5, grammar_score: 5, vocabulary_score: 5, confidence_score: 5,
        strengths: ['Good effort'], areas_to_improve: ['Keep practicing'],
        detailed_feedback: 'Assessment recorded.',
      });
    }
  };

  // ─── Results screen ───────────────────────────────────────────────────────
  if (status === 'done' && scores) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4" data-testid="assessment-results">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
          <Card className="border-border/50">
            <CardContent className="p-8 text-center">
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: 'spring' }}
                className="w-24 h-24 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-6"
              >
                <span className="text-4xl font-bold text-accent" style={{ fontFamily: 'JetBrains Mono' }}>
                  {scores.cefr_level}
                </span>
              </motion.div>

              <h2 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Assessment Complete!</h2>
              <p className="text-muted-foreground mb-6">
                Your English level: <span className="font-bold text-foreground">{scores.cefr_level}</span>
              </p>

              {/* Score grid — all four metrics from the API response */}
              <div className="grid grid-cols-2 gap-3 mb-6 text-left">
                {[
                  { label: 'Fluency', val: scores.fluency_score },
                  { label: 'Grammar', val: scores.grammar_score },
                  { label: 'Vocabulary', val: scores.vocabulary_score },
                  { label: 'Confidence', val: scores.confidence_score },
                ].map((s, idx) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + idx * 0.1 }}
                    className="bg-muted/50 rounded-xl p-4"
                  >
                    <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
                    <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{s.val}/10</div>
                  </motion.div>
                ))}
              </div>

              {/* Overall score */}
              <div className="mb-4 bg-accent/10 rounded-xl p-4 text-center">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Overall Score</div>
                <div className="text-3xl font-bold text-accent" style={{ fontFamily: 'JetBrains Mono' }}>
                  {scores.weighted_score}<span className="text-lg text-muted-foreground">/100</span>
                </div>
              </div>

              {/* Strengths */}
              {scores.strengths?.length > 0 && (
                <div className="text-left mb-4 bg-green-500/10 rounded-xl p-4">
                  <div className="text-sm font-medium mb-2 text-green-500">✓ Strengths</div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {scores.strengths.map((s, i) => (
                      <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Areas to improve */}
              {scores.areas_to_improve?.length > 0 && (
                <div className="text-left mb-4 bg-accent/10 rounded-xl p-4">
                  <div className="text-sm font-medium mb-2 text-accent">→ Areas to Improve</div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {scores.areas_to_improve.map((s, i) => (
                      <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Detailed feedback */}
              {scores.detailed_feedback && (
                <div className="text-left mb-6 bg-muted/30 rounded-xl p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tutor Feedback</div>
                  <p className="text-sm text-foreground/80 leading-relaxed">{scores.detailed_feedback}</p>
                </div>
              )}

              <Button
                onClick={() => navigate('/dashboard')}
                className="w-full rounded-full py-5 text-base bg-accent text-accent-foreground hover:bg-accent/90"
                data-testid="go-to-dashboard"
              >
                Go to Dashboard →
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ─── Main UI ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="assessment-page">
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm" style={{ fontFamily: 'Fraunces, serif' }}>F</span>
          </div>
          <span className="font-semibold" style={{ fontFamily: 'Fraunces, serif' }}>Assessment</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>

      {status === 'intro' && (
        <div className="flex-1 flex items-center justify-center px-4">
          <Card className="w-full max-w-lg border-border/50">
            <CardContent className="p-8 text-center">
              <VoiceVisualizer state="idle" size="md" />
              <h2 className="text-2xl font-semibold mt-12 mb-3" style={{ fontFamily: 'Fraunces, serif' }}>Ready for Your Assessment?</h2>
              <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
                You'll have a natural conversation with Fluentra across 4 parts — warm-up, description, opinion, and storytelling. It takes about 10–15 minutes.
              </p>
              <p className="text-xs text-muted-foreground mb-6">Find a quiet spot and make sure your microphone is ready.</p>
              {error && (
                <div className="flex items-center gap-2 text-destructive text-sm mb-4 bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle size={14} />{error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 mb-6">
                {STAGES.map((s, i) => (
                  <div key={i} className="bg-muted/40 rounded-xl p-3 text-left">
                    <div className="text-xs font-medium text-foreground">{i + 1}. {s.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.desc} · {s.duration} min</div>
                  </div>
                ))}
              </div>
              <Button onClick={startAssessment} className="rounded-full px-10 py-5 text-base bg-accent text-accent-foreground hover:bg-accent/90" data-testid="start-assessment-btn">
                <Mic size={18} className="mr-2" /> Start Assessment
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {(status === 'connecting' || status === 'scoring') && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <VoiceVisualizer state="processing" size="md" />
            <p className="mt-12 text-muted-foreground">
              {status === 'connecting' ? 'Connecting to your tutor...' : (scoringStep || 'Analyzing your performance...')}
            </p>
          </div>
        </div>
      )}

      {status === 'active' && (
        <div className="flex-1 flex flex-col">

          {/* Stage progress */}
          <div className="px-5 pt-4 pb-3 border-b border-border/50">
            <div className="flex gap-2 mb-3">
              {STAGES.map((s, i) => (
                <div key={i} className="flex-1 relative">
                  <motion.div
                    className={`h-1.5 rounded-full ${i <= stageIndex ? 'bg-accent' : 'bg-border'}`}
                    initial={false}
                    animate={{ scaleX: i <= stageIndex ? 1 : 0, originX: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                  {i > stageIndex && <div className="h-1.5 rounded-full bg-border absolute inset-0" />}
                </div>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={stageIndex}
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-3"
              >
                <div className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/15 text-accent">
                  Stage {stageIndex + 1} of {STAGES.length}
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{STAGES[stageIndex].name}</span>
                  <span className="text-xs text-muted-foreground ml-2">· {STAGES[stageIndex].desc}</span>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Visualiser */}
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <VoiceVisualizer state={voiceState} size="lg" />
          </div>

          {/* Transcript */}
          <div className="border-t border-border/50">
            <ScrollArea className="h-44 px-6 py-4">
              {transcript.map((t, i) => (
                <div key={i} className={`mb-3 ${t.speaker === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t.speaker === 'user' ? 'You' : 'Tutor'}
                  </span>
                  <p className={`text-sm mt-0.5 ${t.speaker === 'user' ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {t.text}
                  </p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </ScrollArea>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 p-4 border-t border-border/50">
            <Button
              variant="outline" size="icon" className="rounded-full w-12 h-12"
              onClick={() => { setMuted(!muted); mutedRef.current = !muted; }}
              data-testid="mute-toggle"
            >
              {muted ? <MicOff size={20} className="text-destructive" /> : <Mic size={20} />}
            </Button>
            <Button
              className="rounded-full px-8 py-5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={endAssessment}
              data-testid="end-assessment-btn"
            >
              <PhoneOff size={18} className="mr-2" /> End Assessment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}