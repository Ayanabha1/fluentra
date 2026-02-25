import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Flame, BookOpen, TrendingUp, Play, Lock, PlayCircle, RefreshCw, Sparkles, CheckCircle2, Circle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.4 } }) };

const cefrProgress = { 'A1': 8, 'A2': 25, 'B1': 42, 'B2': 58, 'C1': 75, 'C2': 92 };

const difficultyColors = {
  easy: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  hard: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
};

const typeColors = {
  speaking: 'border-blue-400/40 text-blue-400',
  grammar: 'border-purple-400/40 text-purple-400',
  vocabulary: 'border-amber-400/40 text-amber-400',
  assessment: 'border-rose-400/40 text-rose-400',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [startingSession, setStartingSession] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [planRes, progRes] = await Promise.all([
          api.get('/learning-plan'),
          api.get('/progress'),
        ]);
        setPlan(planRes.data);
        setProgress(progRes.data);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    load();
  }, []);

  const regeneratePlan = async () => {
    setRegenerating(true);
    try {
      const res = await api.post('/learning-plan/generate');
      setPlan(res.data);
      toast.success('Learning plan generated!');
    } catch (err) { toast.error('Failed to generate plan'); }
    setRegenerating(false);
  };

  const startPlanSession = async (sess, moduleIndex, sessionIndex) => {
    setStartingSession(sess.plan_session_id);
    try {
      const res = await api.post('/sessions', {
        session_type: sess.type || 'speaking',
        target_duration_minutes: sess.duration_minutes || 10,
        plan_id: plan.id,
        plan_module_index: moduleIndex,
        plan_session_index: sessionIndex,
        plan_session_id: sess.plan_session_id,
        system_prompt: sess.system_prompt,
      });
      navigate(`/session/${res.data.id}`);
    } catch (e) {
      toast.error('Failed to start session');
      setStartingSession(null);
    }
  };

  const startAdHocSession = async (type = 'speaking') => {
    try {
      const res = await api.post('/sessions', { session_type: type, plan_id: plan?.id, target_duration_minutes: 10 });
      navigate(`/session/${res.data.id}`);
    } catch (err) {
      toast.error("Failed to start ad-hoc session");
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Compute stats metrics
  const allSessions = plan?.modules?.flatMap(m => m.sessions || []) || [];
  const planCompletedCount = allSessions.filter(s => s.status === 'completed').length;
  const planTotalCount = allSessions.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6" data-testid="dashboard-page">
      {/* Greeting */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0} className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <p className="text-muted-foreground mt-1">Keep up the momentum. Your English is getting better every day.</p>
        </div>
        <div className="mt-4 md:mt-0 flex gap-2">
          <Button onClick={() => startAdHocSession('speaking')} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90" data-testid="start-speaking-session">
            <Play size={16} className="mr-2" /> Quick Practice
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Content Area - Learning Plan taking 8 columns */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* Learning Plan Content */}
          {!plan ? (
            <Card className="border-border/50 text-center py-12" data-testid="no-plan">
              <div className="text-5xl mb-4">📚</div>
              <h2 className="text-2xl font-semibold mb-3" style={{ fontFamily: 'Fraunces, serif' }}>No Learning Plan Yet</h2>
              <p className="text-muted-foreground mb-6">Generate a personalized plan based on your assessment results.</p>
              <Button onClick={regeneratePlan} disabled={regenerating} className="rounded-full px-8">
                {regenerating ? (
                  <><RefreshCw size={16} className="mr-2 animate-spin" />Generating your plan…</>
                ) : (
                  <><Sparkles size={16} className="mr-2" />Generate My Plan</>
                )}
              </Button>
            </Card>
          ) : (
            <>
              <div className="flex justify-between items-center bg-card p-5 rounded-xl border border-border/50 shadow-sm">
                <div>
                  <h2 className="text-xl font-semibold" style={{ fontFamily: 'Fraunces, serif' }}>Your Learning Plan</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Goal: {plan.target_cefr_level} proficiency
                  </p>
                </div>
                <Button variant="outline" size="sm" className="rounded-full" onClick={regeneratePlan} disabled={regenerating}>
                  <RefreshCw size={14} className={`mr-2 ${regenerating ? 'animate-spin' : ''}`} />
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
                </Button>
              </div>

              {/* Modules accordion */}
              <Card className="border-border/50 shadow-sm">
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-base font-semibold">Weekly Modules</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Accordion type="single" defaultValue={`module-${plan.current_module_index || 0}`} collapsible className="flex flex-col bg-card">
                    {plan.modules?.map((mod, mi) => {
                      const modSessions = mod.sessions || [];
                      const modCompleted = modSessions.every(s => s.status === 'completed');
                      const modActive = !modCompleted && modSessions.some(
                        s => s.status === 'unlocked' || s.status === 'completed'
                      );

                      return (
                        <AccordionItem
                          key={mi}
                          value={`module-${mi}`}
                          className={`px-4 md:px-6 transition-colors border-b last:border-0 ${modCompleted ? 'bg-green-500/5' :
                            modActive ? 'bg-accent/5' :
                              'hover:bg-muted/30'
                            }`}
                          data-testid={`module-${mi}`}
                        >
                          <AccordionTrigger className="hover:no-underline py-5">
                            <div className="flex items-center gap-4 text-left">
                              {modCompleted
                                ? <CheckCircle2 size={24} className="text-green-500 shrink-0" />
                                : modActive
                                  ? <div className="w-6 h-6 rounded-full border-2 border-accent shrink-0 flex items-center justify-center animate-pulse"><div className="w-2 h-2 rounded-full bg-accent" /></div>
                                  : <Circle size={24} className="text-muted-foreground/30 shrink-0" />
                              }
                              <div>
                                <div className="font-semibold text-base">{mod.title}</div>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${difficultyColors[mod.difficulty] || difficultyColors.easy}`}>
                                    {mod.difficulty}
                                  </span>
                                  {mod.focus_areas?.slice(0, 3).map(f => (
                                    <Badge key={f} variant="outline" className="text-[10px] bg-background">{f}</Badge>
                                  ))}
                                  {modCompleted && <Badge className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">Complete ✓</Badge>}
                                  {modActive && !modCompleted && <Badge className="text-[10px] bg-accent/20 text-accent border-accent/30">In Progress</Badge>}
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>

                          <AccordionContent>
                            <div className="space-y-3 pb-5 pt-2 pl-10">
                              {modSessions.map((sess, si) => {
                                const isCompleted = sess.status === 'completed';
                                const isUnlocked = sess.status === 'unlocked';
                                const isLocked = sess.status === 'locked';
                                const isStarting = startingSession === sess.plan_session_id;
                                const wasAdapted = !!sess.prompt_adapted_from;

                                return (
                                  <div
                                    key={si}
                                    className={`p-4 rounded-xl border bg-background transition-all ${isCompleted ? 'border-green-500/20 shadow-sm' :
                                      isUnlocked ? 'border-accent/40 shadow-sm ring-1 ring-accent/10' :
                                        'border-border/30 opacity-70'
                                      }`}
                                    data-testid={`session-${mi}-${si}`}
                                  >
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex-1 min-w-0">
                                        {/* Session header */}
                                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                          <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize font-medium ${typeColors[sess.type] || typeColors.speaking}`}>
                                            {sess.type || 'speaking'}
                                          </span>
                                          <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                                            <Clock size={10} /> {sess.duration_minutes || 10} min
                                          </span>
                                          {wasAdapted && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                                              <Sparkles size={9} /> Adapted to you
                                            </span>
                                          )}
                                        </div>

                                        <div className={`text-sm font-semibold ${isLocked ? 'text-muted-foreground' : 'text-foreground'}`}>
                                          {sess.title}
                                        </div>
                                        <div className={`text-xs mt-1 leading-relaxed ${isLocked ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
                                          {sess.description}
                                        </div>

                                        {/* Session plan preview — only for unlocked sessions */}
                                        {isUnlocked && sess.system_prompt && (
                                          <div className="mt-3 p-3 bg-muted/30 border border-border/50 rounded-lg relative">
                                            <div className="absolute -top-2 left-3 bg-background px-1.5 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                                              What you'll practice
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                                              {sess.description || sess.system_prompt.split('.').slice(1, 3).join('. ')}
                                            </p>
                                          </div>
                                        )}
                                      </div>

                                      {/* Status / action button */}
                                      <div className="shrink-0 pt-0.5 flex flex-col items-center gap-1">
                                        {isCompleted ? (
                                          <div
                                            className="flex flex-col items-center gap-1 cursor-pointer hover:bg-muted p-2 rounded-lg transition-colors border border-transparent hover:border-green-500/20"
                                            onClick={() => sess.completed_session_id && navigate(`/session/${sess.completed_session_id}`)}
                                          >
                                            <CheckCircle2 size={20} className="text-green-500" />
                                            <span className="text-[10px] text-green-600 font-semibold uppercase tracking-wider">Review</span>
                                          </div>
                                        ) : isLocked ? (
                                          <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50 p-2">
                                            <Lock size={16} />
                                            <span className="text-[10px] uppercase font-semibold tracking-wider">Locked</span>
                                          </div>
                                        ) : (
                                          <Button
                                            size="sm"
                                            className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90 gap-1.5 mt-1"
                                            disabled={isStarting}
                                            onClick={(e) => { e.stopPropagation(); startPlanSession(sess, mi, si); }}
                                            data-testid={`start-session-${mi}-${si}`}
                                          >
                                            {isStarting ? <RefreshCw size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                                            {isStarting ? 'Starting…' : 'Start'}
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </CardContent>
              </Card>
            </>
          )}

        </div>

        {/* Sidebar Space - Taking 4 columns */}
        <div className="lg:col-span-4 flex flex-col gap-4">

          {/* CEFR Level */}
          <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={1}>
            <Card className="border-border/50 bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm overflow-hidden relative">
              <div className="absolute -right-6 -top-6 text-9xl opacity-5">🏆</div>
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-1 relative z-10">Current Level</div>
                    <div className="text-4xl font-bold text-primary mb-1 relative z-10" style={{ fontFamily: 'JetBrains Mono' }}>{user?.cefr_level || 'B1'}</div>
                  </div>
                  <Badge variant="outline" className="bg-background relative z-10">Target: {user?.target_cefr_level || 'B2'}</Badge>
                </div>
                <div>
                  <Progress value={cefrProgress[user?.cefr_level] || 42} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-2 font-medium">
                    <span>A1</span><span>C2</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Streak & Plan Completion Grid */}
          <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={2} className="grid grid-cols-2 gap-4">
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center mb-3">
                  <Flame size={20} className="text-orange-500" />
                </div>
                <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{user?.current_streak || 0}</div>
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Day Streak</div>
              </CardContent>
            </Card>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{planCompletedCount}</span>
                  <span className="text-sm text-muted-foreground font-bold">/{planTotalCount}</span>
                </div>
                <Progress value={planTotalCount > 0 ? (planCompletedCount / planTotalCount) * 100 : 0} className="h-1.5 w-full mb-3" />
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Plan Progress</div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Quick Stats */}
          <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={3}>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-5">
                <div className="space-y-4 text-sm font-medium">
                  <div className="flex justify-between items-center bg-muted/30 p-3 rounded-lg border border-border/50">
                    <div className="flex items-center gap-2">
                      <BookOpen size={16} className="text-green-500" /> Vocabulary Learned
                    </div>
                    <span className="font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{progress?.vocabulary?.total || 0}</span>
                  </div>
                  <div className="flex justify-between items-center bg-muted/30 p-3 rounded-lg border border-border/50">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={16} className="text-blue-500" /> Average Score
                    </div>
                    <span className="font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
                      {progress?.session_metrics?.length ? Math.round(progress.session_metrics.reduce((a, m) => a + m.overall_score, 0) / progress.session_metrics.length) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-muted/30 p-3 rounded-lg border border-border/50 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate('/sessions')}>
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-purple-500" /> Total Sessions
                    </div>
                    <span className="font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{user?.total_sessions || 0} </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
