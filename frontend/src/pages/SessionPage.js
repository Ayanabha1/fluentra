import { useState, useRef, useCallback, useEffect } from 'react';
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

// ─── Audio helpers (ported directly from friend's utils.ts) ──────────────────

function decodeBase64ToBytes(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

// KEY FIX: friend uses data.length / 2 / numChannels for numFrames (Int16 = 2 bytes)
// and copyToChannel() — not a manual loop into getChannelData()
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
  for (let i = 0; i < pcmData.length; i++) {
    int16[i] = pcmData[i] * 32768; // matches friend's createBlob exactly
  }
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const { sessionId: paramId } = useParams();
  const [sessionId, setSessionId] = useState(paramId);
  const [sessionData, setSessionData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(30);
  const [customDurationInput, setCustomDurationInput] = useState('');

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const isEndingRef = useRef(false);

  // KEY FIX #1: Both AudioContexts created ONCE at component init — never recreated.
  // Friend creates them as class fields (top-level), guaranteeing they're always ready.
  const inputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
  );
  const outputAudioContextRef = useRef(
    new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
  );

  // KEY FIX #2: Persistent GainNode wired to destination once.
  // Friend: outputNode.connect(outputAudioContext.destination) in constructor.
  const outputGainRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);
  const transcriptEndRef = useRef(null);

  const { user } = useAuth();
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
    return `You are Fluentra, a friendly, encouraging, and supportive English coach who genuinely wants the student to succeed. You're conducting a ${type} session for a ${level} level student named ${user?.name || 'Student'}. Their native language is ${nativeLang}.

Session type: ${type}
Student level: ${level}
Goals: ${user?.learning_goals?.join(', ') || 'General improvement'}

Rules:
- Behave exactly like a real human English coach who is genuinely rooting for them! Be extremely friendly.
- START the conversation with a warm greeting in ${nativeLang} (if it's not "Other" or English), welcoming them and explaining what you'll do today.
- PUSH the user gently to speak ONLY in English for the rest of the session.
- If they make a grammar or vocabulary mistake: correct it gently inline. If they seem to be STRUGGLING to understand or say something, briefly use ${nativeLang} to explain the correction or concept, but then immediately switch back to English to ask a follow-up question. 
- Otherwise, keep speaking strictly in English!
- DO NOT output any internal thoughts, plans, or bracketed instructions (like **Thinking** or *Refining*). Speak ONLY what the user should hear out loud.
- Adapt your vocabulary to their level.
- Keep the conversation natural. Keep responses relatively concise - this is about THEIR practice.`;
  };

  // KEY FIX #3: Audio handled INLINE per chunk — no queue, no isPlaying flag.
  // Friend's onmessage directly decodes + schedules. This is the correct pattern.
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

  const startSession = async () => {
    setStatus('connecting');
    try {
      if (!sessionId) {
        const res = await api.post('/sessions', { session_type: 'speaking', target_duration_minutes: sessionDuration });
        setSessionId(res.data.id);
        setSessionData(res.data);
      }

      await inputAudioContextRef.current.resume();
      await outputAudioContextRef.current.resume();
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      const backendUrl = process.env.REACT_APP_BACKEND_URL;
      const wsUrl = backendUrl.replace('https', 'wss').replace('http', 'ws') + '/api/ws/session';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ system_prompt: buildSystemPrompt(), session_id: sessionId }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') {
          setStatus('active');
          setVoiceState('listening');
          startMicrophone();
          ws.send(JSON.stringify({ type: 'text', data: 'Hello! I am ready to start.' }));
        }
        else if (msg.type === 'audio') {
          handleIncomingAudio(msg.data);
          setVoiceState('speaking');
        }
        else if (msg.type === 'transcript') {
          setTranscript(prev => {
            const last = prev[prev.length - 1];
            if (last && last.speaker === msg.speaker && !last.final) {
              return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + msg.data }];
            }
            return [...prev, { speaker: msg.speaker, text: msg.data, final: false }];
          });
        }
        else if (msg.type === 'turn_complete') {
          setVoiceState('listening');
          setTranscript(prev => prev.length
            ? [...prev.slice(0, -1), { ...prev[prev.length - 1], final: true }]
            : prev
          );
        }
        else if (msg.type === 'interrupted') {
          for (const source of sourcesRef.current.values()) {
            try { source.stop(); } catch (e) { }
            sourcesRef.current.delete(source);
          }
          nextStartTimeRef.current = 0;
          setVoiceState('listening');
        }
        else if (msg.type === 'error') { toast.error(msg.message); setStatus('ready'); }
      };

      ws.onerror = () => { toast.error('Connection error'); setStatus('ready'); };
      ws.onclose = () => { if (status === 'active') setVoiceState('idle'); };
    } catch (err) {
      toast.error('Failed to start session');
      setStatus('ready');
    }
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

      // KEY FIX #4: bufferSize=256 not 1024 — 16ms chunks vs 64ms = faster Gemini VAD
      const bufferSize = 256;
      scriptProcessorRef.current = inputCtx.createScriptProcessor(bufferSize, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (e) => {
        if (muted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const pcmData = e.inputBuffer.getChannelData(0);
        // Send ALL audio — Gemini has its own VAD, no client-side silence filter needed
        const b64 = float32ToBase64Pcm(pcmData);
        wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
      };

      sourceNodeRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputCtx.destination); // keeps processor alive
    } catch {
      toast.error('Microphone access required');
      setStatus('ready');
    }
  };

  const sendText = () => {
    if (!textInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'text', data: textInput }));
    setTranscript(prev => [...prev, { speaker: 'user', text: textInput, final: true }]);
    setTextInput('');
  };

  const endSession = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    if (wsRef.current) { wsRef.current.send(JSON.stringify({ type: 'end' })); wsRef.current.close(); }
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    for (const source of sourcesRef.current.values()) { try { source.stop(); } catch (e) { } }
    sourcesRef.current.clear();
    setVoiceState('processing'); // Visual feedback that we're calculating scores!

    try {
      await api.put(`/sessions/${sessionId}/complete`, { transcript, metrics: {} });
      const scoreRes = await api.post(`/ai/score-session?session_id=${sessionId}`);

      // Update session data immediately with new score layout!
      setSessionData(prev => ({
        ...prev,
        status: 'completed',
        ...scoreRes.data
      }));
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
            ? sessionData.target_duration_minutes * 60
            : (user?.session_duration_minutes ? user.session_duration_minutes * 60 : 30 * 60);
          const wrapUpTime = Math.floor(sessionLimit * 0.9);
          const hardStopTime = Math.floor(sessionLimit * 0.98);
          if (next === wrapUpTime && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'text', data: 'SYSTEM MESSAGE: We have reached 90% of the session time limits. Please start wrapping up the session now. Provide a brief summary of what we covered, assign me some relevant homework to practice, and say a warm goodbye.' }));
          }
          if (next >= hardStopTime) endSession();
          return next;
        });
      }, 1000);
    } else if (status !== 'connecting') {
      setSecondsElapsed(0);
    }
    return () => clearInterval(interval);
  }, [status, user, sessionData]);

  const currentLimitSeconds = sessionData?.target_duration_minutes
    ? sessionData.target_duration_minutes * 60
    : (user?.session_duration_minutes ? user.session_duration_minutes * 60 : 30 * 60);
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
                    <Button
                      key={mins}
                      size="sm"
                      variant={sessionDuration === mins ? 'default' : 'outline'}
                      onClick={() => { setSessionDuration(mins); setCustomDurationInput(''); }}
                      className="rounded-full h-9 px-4"
                    >
                      {mins} min
                    </Button>
                  ))}
                  <div className="flex items-center">
                    <input
                      type="number"
                      placeholder="Custom"
                      value={customDurationInput}
                      onChange={(e) => {
                        setCustomDurationInput(e.target.value);
                        if (e.target.value) setSessionDuration(parseInt(e.target.value) || 30);
                      }}
                      className="w-20 h-9 rounded-l-full border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
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
                <div key={i} className={`mb-3 animate-float-up ${t.speaker === 'user' ? 'text-right' : 'text-left'}`}>
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
        <div className="flex-1 p-6 overflow-y-auto w-full max-w-5xl mx-auto">
          <div className="text-center mb-8 mt-4">
            <h2 className="text-3xl font-bold mb-2 text-primary" style={{ fontFamily: 'Fraunces, serif' }}>Session Complete!</h2>
            <p className="text-muted-foreground">Here is the breakdown of your practice session.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="border-border/50 bg-accent/5">
              <CardContent className="p-6 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Overall Score</div>
                <div className="text-4xl font-bold text-accent" style={{ fontFamily: 'JetBrains Mono' }}>{sessionData?.metrics?.overall_score || '--'}</div>
                <div className="text-sm text-muted-foreground mt-2">out of 100</div>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-6 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Grammar Accuracy</div>
                <div className="text-4xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{sessionData?.metrics?.grammar_accuracy || '--'}%</div>
                <div className="text-sm text-muted-foreground mt-2">correct usage</div>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-6 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Fluency & Vocabulary</div>
                <div className="text-4xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{sessionData?.metrics?.fluency_wpm || '--'} <span className="text-xl">wpm</span></div>
                <div className="text-sm text-muted-foreground mt-2">speaking pace</div>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-border/50 h-full">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><BookOpen size={18} className="text-primary" /> Summary & Details</h3>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {sessionData?.analysis?.summary || sessionData?.metrics?.feedback?.[0] || 'No summary available yet. Please refresh in a moment.'}
                </p>
                {sessionData?.analysis?.other_details && (
                  <p className="text-sm text-muted-foreground mt-4 italic border-l-2 border-primary/30 pl-3">"{sessionData.analysis.other_details}"</p>
                )}
              </CardContent>
            </Card>
            <Card className="border-border/50 h-full flex flex-col">
              <CardContent className="p-6 flex-1">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Target size={18} className="text-destructive" /> Mistakes & Corrections</h3>
                {sessionData?.extracted_mistakes?.length > 0 || sessionData?.analysis?.mistakes?.length > 0 ? (
                  <ul className="space-y-4">
                    {(sessionData?.extracted_mistakes?.length ? sessionData.extracted_mistakes : (sessionData?.analysis?.mistakes || [])).map((m, i) => (
                      <li key={i} className="text-sm bg-muted/30 p-3 rounded-lg border border-border/50">
                        {typeof m === 'string' ? (
                          <div className="flex flex-col gap-1">
                            <div className="text-destructive font-medium line-through">{m.split('->')[0] || m}</div>
                            <div className="text-green-600 font-medium">➔ {m.split('->')[1] || ''}</div>
                          </div>
                        ) : (
                          <div className="flex items-start flex-col gap-1">
                            <span className="text-destructive font-medium line-through">{m.original || ''}</span>
                            <span className="text-green-600 font-medium">➔ {m.corrected || ''}</span>
                            {m.explanation && <span className="text-muted-foreground text-xs mt-1 bg-background px-2 py-1 rounded w-full border border-border/50">{m.explanation}</span>}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="h-full flex items-center justify-center min-h-[100px]">
                    <p className="text-sm text-muted-foreground text-center">No major mistakes marked! Keep it up. &#x1F389;</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-border/50 md:col-span-2">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Sparkles size={18} className="text-accent" /> New Vocabulary & Tutor Feedback</h3>
                {sessionData?.analysis?.new_words?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {sessionData.analysis.new_words.map((w, i) => (
                      <Badge key={i} variant="secondary" className="px-3 py-1 font-medium bg-accent/10 hover:bg-accent/20 text-accent transition-colors">{w}</Badge>
                    ))}
                  </div>
                )}
                {sessionData?.metrics?.feedback?.length > 0 && typeof sessionData.metrics.feedback[0] === 'string' && (
                  <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                    {sessionData.metrics.feedback.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="flex gap-4 justify-center mt-10 mb-8 border-t border-border/50 pt-8">
            <Button onClick={() => navigate('/dashboard')} className="rounded-full px-8 py-6 shadow-md hover:shadow-xl transition-all" data-testid="session-to-dashboard">Return to Dashboard</Button>
            <Button onClick={() => window.location.reload()} variant="outline" className="rounded-full px-8 py-6" data-testid="session-reload-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v6h6" /></svg>
              Refresh Analysis
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}