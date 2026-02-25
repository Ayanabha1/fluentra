import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, Target, CheckCircle2, Circle, Lock, PlayCircle, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/utils/api';

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

export default function LearningPlanPage() {
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [startingSession, setStartingSession] = useState(null); // plan_session_id being started

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/learning-plan');
        setPlan(res.data);
      } catch (err) { console.error(err); }
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
      // Use window.location so the session page loads fresh with the session ID
      window.location.href = `/session/${res.data.id}`;
    } catch (e) {
      toast.error('Failed to start session');
      setStartingSession(null);
    }
  };

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!plan) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="no-plan">
      <div className="text-5xl mb-4">📚</div>
      <h1 className="text-3xl font-semibold mb-3" style={{ fontFamily: 'Fraunces, serif' }}>No Learning Plan Yet</h1>
      <p className="text-muted-foreground mb-8">Generate a personalized plan based on your assessment results.</p>
      <Button onClick={regeneratePlan} disabled={regenerating} className="rounded-full px-8" data-testid="generate-plan-btn">
        {regenerating ? (
          <><RefreshCw size={16} className="mr-2 animate-spin" />Generating your plan…</>
        ) : (
          <><Sparkles size={16} className="mr-2" />Generate My Plan</>
        )}
      </Button>
    </div>
  );

  // Compute progress
  const allSessions = plan.modules?.flatMap(m => m.sessions || []) || [];
  const completedCount = allSessions.filter(s => s.status === 'completed').length;
  const totalCount = allSessions.length;
  const completedModules = plan.modules?.filter(m =>
    m.sessions?.every(s => s.status === 'completed')
  ).length || 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6" data-testid="learning-plan-page">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
            Learning Plan
          </h1>
          <p className="text-muted-foreground mt-1">
            {plan.current_cefr_level} → {plan.target_cefr_level} · {plan.estimated_weeks} weeks
          </p>
        </div>
        <Button variant="outline" className="rounded-full" onClick={regeneratePlan} disabled={regenerating} data-testid="regenerate-plan-btn">
          <RefreshCw size={16} className={`mr-2 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Target size={15} className="text-accent" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Progress</span>
            </div>
            <div className="text-2xl font-bold mb-2" style={{ fontFamily: 'JetBrains Mono' }}>
              {completedCount}/{totalCount}
            </div>
            <Progress value={totalCount > 0 ? (completedCount / totalCount) * 100 : 0} className="h-1.5" />
            <p className="text-xs text-muted-foreground mt-1.5">sessions completed</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={15} className="text-accent" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Timeline</span>
            </div>
            <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
              {plan.estimated_weeks} weeks
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{plan.sessions_per_week} sessions · 10 min each</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={15} className="text-accent" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Est. Completion</span>
            </div>
            <div className="text-lg font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
              {plan.estimated_completion_date
                ? new Date(plan.estimated_completion_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modules accordion */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weekly Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" defaultValue="module-0" collapsible className="space-y-2">
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
                  className={`border rounded-xl px-4 transition-colors ${modCompleted ? 'border-green-500/30 bg-green-500/5' :
                    modActive ? 'border-accent/50 bg-accent/5' :
                      'border-border/50'
                    }`}
                  data-testid={`module-${mi}`}
                >
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="flex items-center gap-3 text-left">
                      {modCompleted
                        ? <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                        : modActive
                          ? <div className="w-4 h-4 rounded-full border-2 border-accent shrink-0 animate-pulse" />
                          : <Circle size={18} className="text-muted-foreground/40 shrink-0" />
                      }
                      <div>
                        <div className="font-medium text-sm">{mod.title}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${difficultyColors[mod.difficulty] || difficultyColors.easy}`}>
                            {mod.difficulty}
                          </span>
                          {mod.focus_areas?.slice(0, 3).map(f => (
                            <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                          ))}
                          {modCompleted && <Badge className="text-[10px] bg-green-500/20 text-green-500 border-green-500/30">Complete ✓</Badge>}
                          {modActive && !modCompleted && <Badge className="text-[10px] bg-accent/20 text-accent border-accent/30">In Progress</Badge>}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent>
                    <div className="space-y-3 pb-3">
                      {modSessions.map((sess, si) => {
                        const isCompleted = sess.status === 'completed';
                        const isUnlocked = sess.status === 'unlocked';
                        const isLocked = sess.status === 'locked';
                        const isStarting = startingSession === sess.plan_session_id;
                        const wasAdapted = !!sess.prompt_adapted_from;

                        return (
                          <div
                            key={si}
                            className={`p-4 rounded-xl border transition-all ${isCompleted ? 'border-green-500/20 bg-green-500/5' :
                              isUnlocked ? 'border-accent/40 bg-accent/5 shadow-sm' :
                                'border-border/30 bg-muted/20 opacity-60'
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
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {sess.duration_minutes || 10} min
                                  </span>
                                  {wasAdapted && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                                      <Sparkles size={9} /> Adapted for you
                                    </span>
                                  )}
                                </div>

                                <div className={`text-sm font-semibold ${isLocked ? 'text-muted-foreground/60' : 'text-foreground'}`}>
                                  {sess.title}
                                </div>
                                <div className={`text-xs mt-1 leading-relaxed ${isLocked ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
                                  {sess.description}
                                </div>

                                {/* Session plan preview — only for unlocked sessions */}
                                {isUnlocked && sess.system_prompt && (
                                  <div className="mt-3 p-3 bg-background/60 border border-accent/20 rounded-lg relative">
                                    <div className="absolute -top-2 left-3 bg-background px-1.5 text-[9px] uppercase tracking-wider text-accent font-semibold">
                                      What you'll practice
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                                      {/* Extract a human-readable summary from the system prompt */}
                                      {sess.description || sess.system_prompt.split('.').slice(1, 3).join('. ')}
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Status / action button */}
                              <div className="shrink-0 pt-0.5 flex flex-col items-center gap-1">
                                {isCompleted ? (
                                  <div
                                    className="flex flex-col items-center gap-1 cursor-pointer hover:bg-muted/50 p-2 rounded-lg transition-colors border border-transparent hover:border-green-500/20"
                                    onClick={() => sess.completed_session_id && (window.location.href = `/session/${sess.completed_session_id}`)}
                                  >
                                    <CheckCircle2 size={22} className="text-green-500" />
                                    <span className="text-[10px] text-green-500 font-semibold uppercase">View</span>
                                  </div>
                                ) : isLocked ? (
                                  <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
                                    <Lock size={18} />
                                    <span className="text-[10px] uppercase font-medium">Locked</span>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90 gap-1.5"
                                    disabled={isStarting}
                                    onClick={() => startPlanSession(sess, mi, si)}
                                    data-testid={`start-session-${mi}-${si}`}
                                  >
                                    {isStarting ? (
                                      <RefreshCw size={14} className="animate-spin" />
                                    ) : (
                                      <PlayCircle size={14} />
                                    )}
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
    </div>
  );
}