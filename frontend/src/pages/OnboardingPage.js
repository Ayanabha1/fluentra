import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ArrowRight, ArrowLeft, Globe, Target, BookOpen, Calendar, Sun, Moon } from 'lucide-react';
import api from '@/utils/api';
import { motion, AnimatePresence } from 'framer-motion';

const languages = ['Spanish', 'Mandarin', 'Hindi', 'Bengali', 'Arabic', 'Portuguese', 'French', 'German', 'Japanese', 'Korean', 'Russian', 'Turkish', 'Italian', 'Vietnamese', 'Thai', 'Other'];
const cefrLevels = [
  { value: 'A2', label: 'A2 — Elementary' },
  { value: 'B1', label: 'B1 — Intermediate' },
  { value: 'B2', label: 'B2 — Upper Intermediate' },
  { value: 'C1', label: 'C1 — Advanced' },
  { value: 'C2', label: 'C2 — Mastery' },
];
const goals = ['Business English', 'IELTS Preparation', 'TOEFL Preparation', 'Daily Conversation', 'Job Interviews', 'Academic Writing', 'Travel English', 'Public Speaking'];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [nativeLang, setNativeLang] = useState('');
  const [targetLevel, setTargetLevel] = useState('');
  const [selectedGoals, setSelectedGoals] = useState([]);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3);
  const [loading, setLoading] = useState(false);
  const { updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const toggleGoal = (g) => setSelectedGoals(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const handleSubmit = async () => {
    if (!nativeLang || !targetLevel || selectedGoals.length === 0) { toast.error('Please complete all fields'); return; }
    setLoading(true);
    try {
      const res = await api.put('/users/onboard', { native_language: nativeLang, target_cefr_level: targetLevel, learning_goals: selectedGoals, sessions_per_week: sessionsPerWeek });
      updateUser(res.data);
      toast.success('Profile set up! Time for your assessment.');
      navigate('/assessment');
    } catch (err) {
      toast.error('Failed to save preferences');
    }
    setLoading(false);
  };

  const steps = [
    {
      title: 'Your Native Language', icon: Globe,
      content: (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
          {languages.map(l => (
            <Button key={l} variant={nativeLang === l ? 'default' : 'outline'} className={`rounded-xl py-4 text-sm ${nativeLang === l ? 'bg-primary text-primary-foreground' : ''}`}
              onClick={() => setNativeLang(l)} data-testid={`lang-${l.toLowerCase()}`}>{l}</Button>
          ))}
        </div>
      ),
    },
    {
      title: 'Your Target Level', icon: Target,
      content: (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {cefrLevels.map(l => (
            <Button key={l.value} variant={targetLevel === l.value ? 'default' : 'outline'} className={`w-full rounded-xl py-5 justify-start text-left ${targetLevel === l.value ? 'bg-primary text-primary-foreground' : ''}`}
              onClick={() => setTargetLevel(l.value)} data-testid={`target-${l.value}`}>{l.label}</Button>
          ))}
        </div>
      ),
    },
    {
      title: 'Learning Goals', icon: BookOpen,
      content: (
        <div className="flex flex-wrap gap-3">
          {goals.map(g => (
            <Badge key={g} variant={selectedGoals.includes(g) ? 'default' : 'outline'} className={`cursor-pointer px-4 py-2 text-sm rounded-full transition-all ${selectedGoals.includes(g) ? 'bg-accent text-accent-foreground hover:bg-accent/90' : 'hover:bg-muted'}`}
              onClick={() => toggleGoal(g)} data-testid={`goal-${g.toLowerCase().replace(/ /g, '-')}`}>{g}</Badge>
          ))}
        </div>
      ),
    },
    {
      title: 'Sessions Per Week', icon: Calendar,
      content: (
        <div className="flex flex-wrap items-center justify-center gap-4">
          {[1, 2, 3, 5, 7].map(n => (
            <Button key={n} variant={sessionsPerWeek === n ? 'default' : 'outline'} className={`w-14 h-14 rounded-xl text-lg font-bold ${sessionsPerWeek === n ? 'bg-primary text-primary-foreground' : ''}`}
              onClick={() => setSessionsPerWeek(n)} data-testid={`sessions-${n}`}>{n}</Button>
          ))}
        </div>
      ),
    },
  ];

  const current = steps[step];

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="onboarding-page">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm" style={{ fontFamily: 'Fraunces, serif' }}>F</span>
          </div>
          <span className="text-lg font-semibold" style={{ fontFamily: 'Fraunces, serif' }}>Fluentra</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full" data-testid="onboarding-theme-toggle">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-lg border-border/50">
          <CardContent className="p-8">
            {/* Progress */}
            <div className="flex gap-2 mb-8">
              {steps.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? 'bg-accent' : 'bg-border'}`} />
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <current.icon size={20} className="text-accent" />
                  </div>
                  <h2 className="text-xl font-semibold" style={{ fontFamily: 'Fraunces, serif' }}>{current.title}</h2>
                </div>
                {current.content}
              </motion.div>
            </AnimatePresence>

            <div className="flex justify-between mt-8">
              <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={step === 0} className="rounded-full" data-testid="onboarding-back">
                <ArrowLeft size={16} className="mr-2" /> Back
              </Button>
              {step < steps.length - 1 ? (
                <Button onClick={() => setStep(s => s + 1)} className="rounded-full" data-testid="onboarding-next">
                  Next <ArrowRight size={16} className="ml-2" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={loading} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90" data-testid="onboarding-submit">
                  {loading ? 'Saving...' : 'Start Assessment'} <ArrowRight size={16} className="ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
