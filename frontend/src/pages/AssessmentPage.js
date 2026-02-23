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

// ─── Audio helpers (from friend's utils.ts) ───────────────────────────────────

function decodeBase64ToBytes(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function createAudioBuffer(ctx, rawBytes) {
  const numChannels = 1;
  const sampleRate = 24000;
  const numFrames = rawBytes.length / 2 / numChannels;
  const buffer = ctx.createBuffer(numChannels, numFrames, sampleRate);
  const dataInt16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, numFrames);
  const dataFloat32 = new Float32Array(dataInt16.length);
  for (let i = 0; i < dataInt16.length; i++) {
    dataFloat32[i] = dataInt16[i] / 32768.0;
  }
  buffer.copyToChannel(dataFloat32, 0);
  return buffer;
}

function float32ToBase64Pcm(pcmData) {
  const int16 = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) int16[i] = pcmData[i] * 32768;
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────────────────────

const STAGES = [
  {
    name: 'Warm-Up',
    desc: "Let's get to know each other",
    duration: 2,
    color: 'from-blue-500/20 to-blue-600/20',
    accent: 'text-blue-400',
  },
  {
    name: 'Description',
    desc: 'Paint a picture with words',
    duration: 3,
    color: 'from-purple-500/20 to-purple-600/20',
    accent: 'text-purple-400',
  },
  {
    name: 'Opinion',
    desc: 'What do you think?',
    duration: 3,
    color: 'from-amber-500/20 to-amber-600/20',
    accent: 'text-amber-400',
  },
  {
    name: 'Storytelling',
    desc: 'Bring a story to life',
    duration: 4,
    color: 'from-green-500/20 to-green-600/20',
    accent: 'text-green-400',
  },
];

// FIX #2: Richer stage transition prompts in the system prompt
// Each stage transition tells the AI to give context, not just announce the name.
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

export default function AssessmentPage() {
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('intro');
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [scores, setScores] = useState(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  const [stageJustChanged, setStageJustChanged] = useState(false);

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const isEndingRef = useRef(false);

  // Audio contexts created once — never recreated
  const inputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
  );
  const outputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
  );
  const outputGainRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);
  const transcriptEndRef = useRef(null);

  const { user, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Wire up gain node once on mount
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

  // FIX #3: Stage detection drives progress bar + FIX #4: "complete" triggers endAssessment
  useEffect(() => {
    if (status !== 'active' || transcript.length === 0) return;

    const fullAiText = transcript
      .filter((t) => t.speaker === 'ai')
      .map((t) => t.text.toLowerCase())
      .join(' ');

    // Stage advancement — update stageIndex which drives the progress bar
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
      // Flash the stage card
      setStageJustChanged(true);
      setTimeout(() => setStageJustChanged(false), 2000);
    }

    // FIX #4: Auto-end when AI says the completion phrase
    if (
      (fullAiText.includes('assessment is now complete') || fullAiText.includes('assessment complete')) &&
      !isEndingRef.current
    ) {
      // Small delay so the AI finishes speaking
      setTimeout(() => endAssessment(), 2500);
    }
  }, [transcript, status, stageIndex]);

  const handleIncomingAudio = useCallback((b64Data) => {
    const ctx = outputAudioContextRef.current;
    const gain = outputGainRef.current;
    if (!ctx || !gain || ctx.state === 'closed') return;

    const rawBytes = decodeBase64ToBytes(b64Data);
    const audioBuffer = createAudioBuffer(ctx, rawBytes);

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(gain);

    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
    src.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;

    sourcesRef.current.add(src);
    src.addEventListener('ended', () => sourcesRef.current.delete(src));
  }, []);

  const startAssessment = async () => {
    setStatus('connecting');
    setError(null);
    try {
      await inputAudioContextRef.current.resume();
      await outputAudioContextRef.current.resume();
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      const res = await api.post('/sessions', { session_type: 'assessment' });
      setSessionId(res.data.id);
      await connectWebSocket(res.data.id);
    } catch (err) {
      setError('Failed to create session');
      setStatus('intro');
    }
  };

  const connectWebSocket = async (sid) => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL;
    const wsUrl = backendUrl.replace('https', 'wss').replace('http', 'ws') + '/api/ws/session';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ system_prompt: SYSTEM_PROMPT, session_id: sid }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') {
        setStatus('active');
        setVoiceState('listening');
        startMicrophone();
        ws.send(JSON.stringify({ type: 'text', data: 'Hello! I am ready to start my assessment.' }));
      } else if (msg.type === 'audio') {
        handleIncomingAudio(msg.data);
        setVoiceState('speaking');
      } else if (msg.type === 'transcript') {
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.speaker === msg.speaker && !last.final) {
            return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + msg.data }];
          }
          return [...prev, { speaker: msg.speaker, text: msg.data, final: false }];
        });
      } else if (msg.type === 'turn_complete') {
        setVoiceState('listening');
        setTranscript(prev =>
          prev.length ? [...prev.slice(0, -1), { ...prev[prev.length - 1], final: true }] : prev
        );
      } else if (msg.type === 'interrupted') {
        for (const source of sourcesRef.current.values()) {
          try { source.stop(); } catch (e) { }
          sourcesRef.current.delete(source);
        }
        nextStartTimeRef.current = 0;
        setVoiceState('listening');
      } else if (msg.type === 'error') {
        setError(msg.message);
        setStatus('intro');
      }
    };

    ws.onerror = () => { setError('Connection error. Please try again.'); setStatus('intro'); };
    ws.onclose = () => { if (status === 'active') setVoiceState('idle'); };
  };

  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      streamRef.current = stream;

      const inputCtx = inputAudioContextRef.current;
      sourceNodeRef.current = inputCtx.createMediaStreamSource(stream);
      // bufferSize=256 for lower latency (from friend's demo)
      scriptProcessorRef.current = inputCtx.createScriptProcessor(256, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (e) => {
        if (muted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const pcmData = e.inputBuffer.getChannelData(0);
        wsRef.current.send(JSON.stringify({ type: 'audio', data: float32ToBase64Pcm(pcmData) }));
      };

      sourceNodeRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputCtx.destination);
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access.');
      setStatus('intro');
    }
  };

  const endAssessment = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    if (wsRef.current) { wsRef.current.send(JSON.stringify({ type: 'end' })); wsRef.current.close(); }
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    for (const source of sourcesRef.current.values()) { try { source.stop(); } catch (e) { } }
    sourcesRef.current.clear();

    setStatus('scoring');
    setVoiceState('idle');

    try {
      await api.put(`/sessions/${sessionId}/complete`, { transcript, metrics: {} });
      const res = await api.post(`/sessions/${sessionId}/score-assessment`);
      setScores(res.data);
      await api.post('/learning-plan/generate');
      const me = await api.get('/auth/me');
      updateUser(me.data);
      setStatus('done');
    } catch (err) {
      toast.error('Scoring failed, but your session was saved');
      setStatus('done');
      setScores({ cefr_level: 'B1', weighted_score: 50, fluency_score: 5, grammar_score: 5, vocabulary_score: 5, confidence_score: 5, strengths: ['Good effort'], areas_to_improve: ['Keep practicing'], detailed_feedback: 'Assessment recorded.' });
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
                <span className="text-4xl font-bold text-accent" style={{ fontFamily: 'JetBrains Mono' }}>{scores.cefr_level}</span>
              </motion.div>
              <h2 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Assessment Complete!</h2>
              <p className="text-muted-foreground mb-6">Your English level: <span className="font-bold text-foreground">{scores.cefr_level}</span></p>

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

              {scores.strengths?.length > 0 && (
                <div className="text-left mb-4 bg-green-500/10 rounded-xl p-4">
                  <div className="text-sm font-medium mb-2 text-green-500">✓ Strengths</div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {scores.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {scores.areas_to_improve?.length > 0 && (
                <div className="text-left mb-6 bg-accent/10 rounded-xl p-4">
                  <div className="text-sm font-medium mb-2 text-accent">→ Areas to Improve</div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {scores.areas_to_improve.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}

              <Button onClick={() => navigate('/dashboard')} className="w-full rounded-full py-5 text-base bg-accent text-accent-foreground hover:bg-accent/90" data-testid="go-to-dashboard">
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
              {/* Stage preview */}
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
              {status === 'connecting' ? 'Connecting to your tutor...' : 'Analyzing your performance...'}
            </p>
          </div>
        </div>
      )}

      {status === 'active' && (
        <div className="flex-1 flex flex-col">

          {/* FIX #3: Stage progress bar — driven by stageIndex state */}
          <div className="px-5 pt-4 pb-3 border-b border-border/50">
            <div className="flex gap-2 mb-3">
              {STAGES.map((s, i) => (
                <div key={i} className="flex-1 relative">
                  <motion.div
                    className={`h-1.5 rounded-full ${i < stageIndex ? 'bg-accent' : i === stageIndex ? 'bg-accent' : 'bg-border'}`}
                    initial={false}
                    animate={{ scaleX: i <= stageIndex ? 1 : 0, originX: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                  {i > stageIndex && <div className="h-1.5 rounded-full bg-border absolute inset-0" />}
                </div>
              ))}
            </div>

            {/* Animated stage card */}
            <AnimatePresence mode="wait">
              <motion.div
                key={stageIndex}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-3"
              >
                <div className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/15 text-accent`}>
                  Stage {stageIndex + 1} of {STAGES.length}
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{STAGES[stageIndex].name}</span>
                  <span className="text-xs text-muted-foreground ml-2">· {STAGES[stageIndex].desc}</span>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Voice visualizer */}
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <VoiceVisualizer state={voiceState} size="lg" />
            <p className="text-xs text-muted-foreground mt-4">
              {voiceState === 'speaking' ? 'Tutor is speaking...' : voiceState === 'listening' ? 'Listening...' : ''}
            </p>
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
            <Button variant="outline" size="icon" className="rounded-full w-12 h-12" onClick={() => setMuted(!muted)} data-testid="mute-toggle">
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