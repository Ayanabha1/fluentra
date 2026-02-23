import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Flame, BookOpen, TrendingUp, Play, Clock, Award, ArrowRight, BarChart3 } from 'lucide-react';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.4 } }) };

const cefrProgress = { 'A1': 8, 'A2': 25, 'B1': 42, 'B2': 58, 'C1': 75, 'C2': 92 };

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionDuration, setSessionDuration] = useState(30);
  const [customDurationInput, setCustomDurationInput] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [planRes, sessRes, progRes] = await Promise.all([
          api.get('/learning-plan'),
          api.get('/sessions'),
          api.get('/progress'),
        ]);
        setPlan(planRes.data);
        setSessions(sessRes.data);
        setProgress(progRes.data);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    load();
  }, []);

  const startSession = async (type = 'speaking') => {
    try {
      const res = await api.post('/sessions', { session_type: type, plan_id: plan?.id, target_duration_minutes: sessionDuration });
      navigate(`/session/${res.data.id}`);
    } catch (err) {
      console.error(err);
    }
  };

  const currentModule = plan?.modules?.[plan?.current_module_index || 0];
  const completedSessions = sessions.filter(s => s.status === 'completed');
  const recentSessions = completedSessions.slice(0, 5);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="dashboard-page">
      {/* Greeting */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0} className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground mt-1">Keep up the momentum. Your English is getting better every day.</p>
      </motion.div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* CEFR Level - large card */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={1} className="md:col-span-2 lg:col-span-2">
          <Card className="h-full border-border/50 bg-gradient-to-br from-primary/10 to-primary/5" data-testid="cefr-card">
            <CardContent className="p-6 flex flex-col justify-between h-full">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Current Level</div>
                <div className="text-5xl font-bold text-primary mb-2" style={{ fontFamily: 'JetBrains Mono' }}>{user?.cefr_level || 'B1'}</div>
                <div className="text-sm text-muted-foreground">Target: {user?.target_cefr_level || 'B2'}</div>
              </div>
              <div className="mt-4">
                <Progress value={cefrProgress[user?.cefr_level] || 42} className="h-2" />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>A1</span><span>C2</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Streak */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={2} className="md:col-span-2 lg:col-span-2">
          <Card className="h-full border-border/50" data-testid="streak-card">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Flame size={20} className="text-accent" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Current Streak</div>
                  <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{user?.current_streak || 0} days</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Best Streak</div>
                  <div className="text-lg font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{user?.longest_streak || 0}</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Total Sessions</div>
                  <div className="text-lg font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{user?.total_sessions || 0}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Stats */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={3} className="md:col-span-2 lg:col-span-2">
          <Card className="h-full border-border/50" data-testid="stats-card">
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-chart-2/20 flex items-center justify-center">
                    <BookOpen size={20} className="text-green-600" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Words Learned</div>
                    <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{progress?.vocabulary?.total || 0}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-chart-4/20 flex items-center justify-center">
                    <TrendingUp size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Avg Score</div>
                    <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
                      {progress?.session_metrics?.length ? Math.round(progress.session_metrics.reduce((a, m) => a + m.overall_score, 0) / progress.session_metrics.length) : '--'}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Start Session CTA */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={4} className="md:col-span-4 lg:col-span-3">
          <Card className="h-full border-accent/30 bg-accent/5" data-testid="start-session-card">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: 'Fraunces, serif' }}>
                {currentModule?.title || 'Ready for Your Next Session?'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {currentModule ? `Focus: ${currentModule.focus_areas?.join(', ')}` : 'Start a practice session to continue improving.'}
              </p>

              <div className="mb-6">
                <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">Duration (Minutes)</label>
                <div className="flex flex-wrap gap-2 items-center">
                  {[10, 15, 30, 45, 60].map(mins => (
                    <Button
                      key={mins}
                      size="sm"
                      variant={sessionDuration === mins ? 'default' : 'outline'}
                      onClick={() => { setSessionDuration(mins); setCustomDurationInput(''); }}
                      className="rounded-full h-9 px-4"
                    >
                      {mins}m
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

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => startSession('speaking')} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90" data-testid="start-speaking-session">
                  <Play size={16} className="mr-2" /> Speaking Practice
                </Button>
                <Button onClick={() => startSession('vocabulary')} variant="outline" className="rounded-full" data-testid="start-vocab-session">
                  <BookOpen size={16} className="mr-2" /> Vocabulary
                </Button>
                <Button onClick={() => startSession('grammar')} variant="outline" className="rounded-full" data-testid="start-grammar-session">
                  Grammar Clinic
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Links */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={5} className="md:col-span-2 lg:col-span-3">
          <Card className="h-full border-border/50" data-testid="quick-links-card">
            <CardContent className="p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Quick Links</h3>
              <div className="space-y-2">
                <Link to="/progress" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group" data-testid="link-progress">
                  <div className="flex items-center gap-3"><BarChart3 size={16} className="text-muted-foreground" /><span className="text-sm">Progress Dashboard</span></div>
                  <ArrowRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
                <Link to="/vocabulary" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group" data-testid="link-vocabulary">
                  <div className="flex items-center gap-3"><BookOpen size={16} className="text-muted-foreground" /><span className="text-sm">Vocabulary Review</span></div>
                  <ArrowRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
                <Link to="/plan" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group" data-testid="link-plan">
                  <div className="flex items-center gap-3"><Award size={16} className="text-muted-foreground" /><span className="text-sm">Learning Plan</span></div>
                  <ArrowRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Sessions */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={6} className="md:col-span-4 lg:col-span-6">
          <Card className="border-border/50" data-testid="recent-sessions-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Recent Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {recentSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No completed sessions yet. Start your first one!</p>
              ) : (
                <div className="space-y-2">
                  {recentSessions.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/session/${s.id}`)}
                      data-testid={`session-${s.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="capitalize text-xs">{s.session_type}</Badge>
                        <span className="text-sm">{new Date(s.completed_at || s.started_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{s.metrics?.overall_score || 0}/100</span>
                        <Clock size={14} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{s.duration_minutes || 0}m</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
