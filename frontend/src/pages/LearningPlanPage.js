import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, Target, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const difficultyColors = { easy: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', hard: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };

export default function LearningPlanPage() {
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

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
      toast.success('Learning plan regenerated!');
    } catch (err) { toast.error('Failed to regenerate plan'); }
    setRegenerating(false);
  };

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  if (!plan) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center" data-testid="no-plan">
        <h1 className="text-3xl font-semibold mb-4" style={{ fontFamily: 'Fraunces, serif' }}>No Learning Plan</h1>
        <p className="text-muted-foreground mb-6">Generate a personalized plan based on your assessment.</p>
        <Button onClick={regeneratePlan} disabled={regenerating} className="rounded-full" data-testid="generate-plan-btn">
          {regenerating ? 'Generating...' : 'Generate Plan'}
        </Button>
      </div>
    );
  }

  const completedModules = plan.modules?.filter(m => m.completed_at)?.length || 0;
  const totalModules = plan.modules?.length || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="learning-plan-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>Learning Plan</h1>
          <p className="text-muted-foreground mt-1">Your personalized path from {plan.current_cefr_level} to {plan.target_cefr_level}</p>
        </div>
        <Button variant="outline" className="rounded-full" onClick={regeneratePlan} disabled={regenerating} data-testid="regenerate-plan-btn">
          <RefreshCw size={16} className={`mr-2 ${regenerating ? 'animate-spin' : ''}`} /> Regenerate
        </Button>
      </div>

      {/* Plan Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="border-border/50" data-testid="plan-progress-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3"><Target size={16} className="text-accent" /><span className="text-sm text-muted-foreground">Progress</span></div>
            <div className="text-2xl font-bold mb-2" style={{ fontFamily: 'JetBrains Mono' }}>{completedModules}/{totalModules}</div>
            <Progress value={totalModules > 0 ? (completedModules / totalModules) * 100 : 0} className="h-2" />
            <span className="text-xs text-muted-foreground mt-1">modules completed</span>
          </CardContent>
        </Card>
        <Card className="border-border/50" data-testid="plan-timeline-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3"><Calendar size={16} className="text-accent" /><span className="text-sm text-muted-foreground">Timeline</span></div>
            <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{plan.estimated_weeks} weeks</div>
            <span className="text-xs text-muted-foreground">{plan.sessions_per_week} sessions/week</span>
          </CardContent>
        </Card>
        <Card className="border-border/50" data-testid="plan-completion-card">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3"><Clock size={16} className="text-accent" /><span className="text-sm text-muted-foreground">Est. Completion</span></div>
            <div className="text-lg font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
              {plan.estimated_completion_date ? new Date(plan.estimated_completion_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modules */}
      <Card className="border-border/50" data-testid="modules-card">
        <CardHeader><CardTitle className="text-base">Weekly Modules</CardTitle></CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="space-y-2">
            {plan.modules?.map((mod, i) => {
              const isCurrent = i === (plan.current_module_index || 0);
              const isCompleted = !!mod.completed_at;
              return (
                <AccordionItem key={i} value={`module-${i}`} className={`border rounded-xl px-4 ${isCurrent ? 'border-accent/50 bg-accent/5' : 'border-border/50'}`} data-testid={`module-${i}`}>
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="flex items-center gap-3 text-left">
                      {isCompleted ? <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" /> : isCurrent ? <div className="w-4 h-4 rounded-full border-2 border-accent flex-shrink-0" /> : <Circle size={18} className="text-muted-foreground flex-shrink-0" />}
                      <div>
                        <div className="font-medium text-sm">{mod.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${difficultyColors[mod.difficulty] || difficultyColors.easy}`}>{mod.difficulty}</span>
                          {mod.focus_areas?.map(f => <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>)}
                          {isCurrent && <Badge className="text-[10px] bg-accent text-accent-foreground">Current</Badge>}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pb-2">
                      {mod.session_templates?.map((st, j) => (
                        <div key={j} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30" data-testid={`session-template-${i}-${j}`}>
                          <Badge variant="outline" className="capitalize text-xs">{st.type}</Badge>
                          <div className="flex-1">
                            <div className="text-sm font-medium">{st.title}</div>
                            <div className="text-xs text-muted-foreground">{st.description}</div>
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">{st.duration_minutes}m</span>
                        </div>
                      ))}
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
