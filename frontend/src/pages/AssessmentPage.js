import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Mic, MicOff, PhoneOff, Sun, Moon, AlertCircle } from 'lucide-react';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const STAGES = [
  { name: 'Warm-Up', desc: 'Simple personal questions', duration: 2 },
  { name: 'Description', desc: 'Describe what you see', duration: 3 },
  { name: 'Opinion', desc: 'Share your perspective', duration: 3 },
  { name: 'Storytelling', desc: 'Continue a story', duration: 4 },
];

const SYSTEM_PROMPT = `You are Fluentra, a warm and encouraging English tutor conducting an initial language assessment. Your goal is to evaluate the student's English level through natural conversation.

Conduct 4 stages:
1. WARM-UP (2 min): Ask their name, what they do, and a hobby. Be friendly and welcoming.
2. PICTURE DESCRIPTION (3 min): Ask them to describe their favorite place or a memorable scene in detail.
3. OPINION (3 min): Present the statement "Technology makes people less social" and ask them to agree or disagree with reasons.
4. STORYTELLING (4 min): Say "A woman found a mysterious letter in her mailbox one morning..." and ask them to continue the story.

Rules:
- Transition naturally between stages. Don't announce "Stage 2" etc.
- Be encouraging. React to what they say.
- If they struggle, simplify your language and offer gentle prompts.
- Note grammar errors mentally but don't correct during assessment.
- After all 4 stages, warmly thank them and say the assessment is complete.
- Keep your responses concise - this is about THEIR speaking.`;

export default function AssessmentPage() {
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('intro'); // intro, connecting, active, scoring, done
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [scores, setScores] = useState(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const processorRef = useRef(null);
  const playQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const transcriptEndRef = useRef(null);
  const { user, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const scrollToBottom = () => transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [transcript]);

  const startAssessment = async () => {
    setStatus('connecting');
    setError(null);
    try {
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
      } else if (msg.type === 'audio') {
        playAudioChunk(msg.data);
        setVoiceState('speaking');
      } else if (msg.type === 'transcript') {
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.speaker === msg.speaker && !last.final) {
            return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + msg.data }];
          }
          return [...prev, { speaker: msg.speaker, text: msg.data, final: false }];
        });
        // Estimate stage from transcript length
        const totalLen = transcript.length;
        if (totalLen > 12) setStageIndex(3);
        else if (totalLen > 8) setStageIndex(2);
        else if (totalLen > 4) setStageIndex(1);
      } else if (msg.type === 'turn_complete') {
        setVoiceState('listening');
        setTranscript(prev => {
          if (prev.length === 0) return prev;
          return [...prev.slice(0, -1), { ...prev[prev.length - 1], final: true }];
        });
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      processorRef.current = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
      source.connect(processorRef.current);
      processorRef.current.connect(audioCtxRef.current.destination);

      processorRef.current.onaudioprocess = (e) => {
        if (muted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
        }
        const b64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
      };
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access.');
      setStatus('intro');
    }
  };

  const playAudioChunk = useCallback((b64Data) => {
    playQueueRef.current.push(b64Data);
    if (!isPlayingRef.current) processPlayQueue();
  }, []);

  const processPlayQueue = async () => {
    if (playQueueRef.current.length === 0) { isPlayingRef.current = false; return; }
    isPlayingRef.current = true;
    const b64 = playQueueRef.current.shift();
    try {
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const pcm16 = new Int16Array(arr.buffer);
      const ctx = new AudioContext({ sampleRate: 24000 });
      const buffer = ctx.createBuffer(1, pcm16.length, 24000);
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) channelData[i] = pcm16[i] / 32768;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => { ctx.close(); processPlayQueue(); };
      source.start();
    } catch {
      processPlayQueue();
    }
  };

  const endAssessment = async () => {
    // Close WebSocket
    if (wsRef.current) { wsRef.current.send(JSON.stringify({ type: 'end' })); wsRef.current.close(); }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (processorRef.current) processorRef.current.disconnect();
    if (audioCtxRef.current) audioCtxRef.current.close();

    setStatus('scoring');
    setVoiceState('idle');

    try {
      // Save transcript
      await api.put(`/sessions/${sessionId}/complete`, { transcript, metrics: {} });
      // Score assessment
      const res = await api.post(`/sessions/${sessionId}/score-assessment`);
      setScores(res.data);
      // Generate learning plan
      await api.post('/learning-plan/generate');
      // Refresh user
      const me = await api.get('/auth/me');
      updateUser(me.data);
      setStatus('done');
    } catch (err) {
      toast.error('Scoring failed, but your session was saved');
      setStatus('done');
      setScores({ cefr_level: 'B1', weighted_score: 50, strengths: ['Good effort'], areas_to_improve: ['Keep practicing'], detailed_feedback: 'Assessment recorded.' });
    }
  };

  if (status === 'done' && scores) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4" data-testid="assessment-results">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="w-full max-w-lg border-border/50">
            <CardContent className="p-8 text-center">
              <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-6">
                <span className="text-3xl font-bold text-accent" style={{ fontFamily: 'JetBrains Mono' }}>{scores.cefr_level}</span>
              </div>
              <h2 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Assessment Complete!</h2>
              <p className="text-muted-foreground mb-6">Your English level: <span className="font-bold text-foreground">{scores.cefr_level}</span></p>

              <div className="grid grid-cols-2 gap-4 mb-6 text-left">
                {[{ label: 'Fluency', val: scores.fluency_score }, { label: 'Grammar', val: scores.grammar_score }, { label: 'Vocabulary', val: scores.vocabulary_score }, { label: 'Confidence', val: scores.confidence_score }].map(s => (
                  <div key={s.label} className="bg-muted/50 rounded-xl p-4">
                    <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
                    <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{s.val}/10</div>
                  </div>
                ))}
              </div>

              {scores.strengths && (
                <div className="text-left mb-4">
                  <div className="text-sm font-medium mb-2 text-green-600">Strengths</div>
                  <ul className="text-sm text-muted-foreground space-y-1">{scores.strengths.map((s, i) => <li key={i}>+ {s}</li>)}</ul>
                </div>
              )}
              {scores.areas_to_improve && (
                <div className="text-left mb-6">
                  <div className="text-sm font-medium mb-2 text-accent">Areas to Improve</div>
                  <ul className="text-sm text-muted-foreground space-y-1">{scores.areas_to_improve.map((s, i) => <li key={i}>- {s}</li>)}</ul>
                </div>
              )}

              <Button onClick={() => navigate('/dashboard')} className="w-full rounded-full py-5 text-base bg-accent text-accent-foreground hover:bg-accent/90" data-testid="go-to-dashboard">
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="assessment-page">
      {/* Header */}
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
                You'll have a natural conversation with your AI tutor. It takes about 10-15 minutes and covers four parts: warm-up, description, opinion, and storytelling.
              </p>
              <p className="text-xs text-muted-foreground mb-6">Make sure you're in a quiet place with your microphone ready.</p>
              {error && <div className="flex items-center gap-2 text-destructive text-sm mb-4"><AlertCircle size={14} />{error}</div>}
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
            <p className="mt-12 text-muted-foreground">{status === 'connecting' ? 'Connecting to your tutor...' : 'Analyzing your performance...'}</p>
          </div>
        </div>
      )}

      {status === 'active' && (
        <div className="flex-1 flex flex-col">
          {/* Stage progress */}
          <div className="px-6 py-3 border-b border-border/50">
            <div className="flex items-center gap-2 mb-2">
              {STAGES.map((s, i) => (
                <div key={i} className="flex-1">
                  <div className={`h-1 rounded-full ${i <= stageIndex ? 'bg-accent' : 'bg-border'}`} />
                  <div className={`text-[10px] mt-1 ${i === stageIndex ? 'text-accent font-medium' : 'text-muted-foreground'}`}>{s.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Voice area */}
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <VoiceVisualizer state={voiceState} size="lg" />
          </div>

          {/* Transcript */}
          <div className="border-t border-border/50">
            <ScrollArea className="h-48 px-6 py-4">
              {transcript.map((t, i) => (
                <div key={i} className={`mb-3 ${t.speaker === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.speaker === 'user' ? 'You' : 'Tutor'}</span>
                  <p className={`text-sm mt-0.5 ${t.speaker === 'user' ? 'text-foreground' : 'text-muted-foreground'}`}>{t.text}</p>
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
            <Button className="rounded-full px-8 py-5 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={endAssessment} data-testid="end-assessment-btn">
              <PhoneOff size={18} className="mr-2" /> End Assessment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
