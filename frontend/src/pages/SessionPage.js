import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Mic, MicOff, PhoneOff, Sun, Moon, ArrowLeft, MessageSquare } from 'lucide-react';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import api from '@/utils/api';

export default function SessionPage() {
  const { sessionId: paramId } = useParams();
  const [sessionId, setSessionId] = useState(paramId);
  const [sessionData, setSessionData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const processorRef = useRef(null);
  const playQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const transcriptEndRef = useRef(null);
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [transcript]);

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
    return `You are Fluentra, a friendly and patient English tutor. You're conducting a ${type} session for a ${level} level student named ${user?.name || 'Student'}.

Session type: ${type}
Student level: ${level}
Goals: ${user?.learning_goals?.join(', ') || 'General improvement'}

Rules:
- Keep the conversation natural and encouraging.
- If they make a grammar mistake, correct it gently inline: "Great point! Just a note - we say '...' instead of '...'. Anyway, what else..."
- Adapt your vocabulary to their level.
- For vocabulary sessions: introduce new words in context, ask them to use each word in a sentence.
- For grammar sessions: focus on specific grammar points with practice exercises.
- For speaking sessions: use roleplay, opinion questions, or discussions.
- Keep responses concise - this is about THEIR practice.`;
  };

  const startSession = async () => {
    setStatus('connecting');
    try {
      if (!sessionId) {
        const res = await api.post('/sessions', { session_type: 'speaking' });
        setSessionId(res.data.id);
        setSessionData(res.data);
      }
      const backendUrl = process.env.REACT_APP_BACKEND_URL;
      const wsUrl = backendUrl.replace('https', 'wss').replace('http', 'ws') + '/api/ws/session';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ system_prompt: buildSystemPrompt(), session_id: sessionId }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') { setStatus('active'); setVoiceState('listening'); startMicrophone(); }
        else if (msg.type === 'audio') { playAudioChunk(msg.data); setVoiceState('speaking'); }
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
          setTranscript(prev => prev.length ? [...prev.slice(0, -1), { ...prev[prev.length - 1], final: true }] : prev);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      processorRef.current = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
      source.connect(processorRef.current);
      processorRef.current.connect(audioCtxRef.current.destination);
      processorRef.current.onaudioprocess = (e) => {
        if (muted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) pcm16[i] = Math.max(-32768, Math.min(32767, input[i] * 32767));
        const b64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
      };
    } catch { toast.error('Microphone access required'); setStatus('ready'); }
  };

  const playAudioChunk = useCallback((b64Data) => {
    playQueueRef.current.push(b64Data);
    if (!isPlayingRef.current) processPlayQueue();
  }, []);

  const processPlayQueue = async () => {
    if (!playQueueRef.current.length) { isPlayingRef.current = false; return; }
    isPlayingRef.current = true;
    const b64 = playQueueRef.current.shift();
    try {
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const pcm16 = new Int16Array(arr.buffer);
      const ctx = new AudioContext({ sampleRate: 24000 });
      const buffer = ctx.createBuffer(1, pcm16.length, 24000);
      const cd = buffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) cd[i] = pcm16[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => { ctx.close(); processPlayQueue(); };
      src.start();
    } catch { processPlayQueue(); }
  };

  const sendText = () => {
    if (!textInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'text', data: textInput }));
    setTranscript(prev => [...prev, { speaker: 'user', text: textInput, final: true }]);
    setTextInput('');
  };

  const endSession = async () => {
    if (wsRef.current) { wsRef.current.send(JSON.stringify({ type: 'end' })); wsRef.current.close(); }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (processorRef.current) processorRef.current.disconnect();
    if (audioCtxRef.current) audioCtxRef.current.close();
    setVoiceState('idle');
    setStatus('completed');
    try {
      await api.put(`/sessions/${sessionId}/complete`, { transcript, metrics: {} });
      await api.post(`/ai/score-session?session_id=${sessionId}`);
      toast.success('Session completed and scored!');
    } catch { toast.success('Session saved!'); }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="session-page">
      <div className="flex items-center justify-between p-4 border-b border-border/50 glass">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate('/dashboard')} data-testid="session-back">
            <ArrowLeft size={18} />
          </Button>
          <div>
            <span className="font-semibold text-sm" style={{ fontFamily: 'Fraunces, serif' }}>
              {sessionData?.session_type ? `${sessionData.session_type.charAt(0).toUpperCase() + sessionData.session_type.slice(1)} Session` : 'Session'}
            </span>
            {sessionData && <Badge variant="outline" className="ml-2 text-[10px]">{user?.cefr_level}</Badge>}
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
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-green-600">&#10003;</span>
            </div>
            <h2 className="text-xl font-semibold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Session Complete</h2>
            <p className="text-sm text-muted-foreground mb-6">Great work! Your session has been saved and scored.</p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate('/dashboard')} className="rounded-full" data-testid="session-to-dashboard">Back to Dashboard</Button>
              <Button onClick={() => navigate('/progress')} variant="outline" className="rounded-full" data-testid="session-to-progress">View Progress</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
