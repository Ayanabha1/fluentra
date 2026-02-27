import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp, BookOpen, Mic, AlertTriangle,
  Flame, Target, Activity, CheckCircle2,
  Calendar, Award, Lightbulb
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const COLORS = [
  'hsl(13, 68%, 63%)',  // brand-orange
  'hsl(157, 25%, 39%)', // brand-emerald
  'hsl(40, 60%, 55%)',  // yellow
  'hsl(200, 50%, 50%)', // blue
  'hsl(280, 50%, 60%)', // purple
  'hsl(340, 60%, 55%)'  // pink
];

// CEFR Progress mapping (in percentage)
const cefrProgress = { 'A1': 15, 'A2': 33, 'B1': 50, 'B2': 67, 'C1': 84, 'C2': 100 };
const cefrDescriptions = {
  'A1': 'Beginner - Starting to understand basic phrases.',
  'A2': 'Elementary - Can communicate in simple and routine tasks.',
  'B1': 'Intermediate - Can deal with most everyday situations.',
  'B2': 'Upper Inter - Can understand main ideas of complex text.',
  'C1': 'Advanced - Can express ideas fluently and spontaneously.',
  'C2': 'Mastery - Can understand with ease everything heard or read.'
};

const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  } catch (e) {
    return '';
  }
};

const calculateInsights = (progress) => {
  const insights = [];
  if (!progress) return insights;

  // Streak insight
  if (progress.current_streak >= 3) {
    insights.push({
      title: 'On Fire!',
      desc: `You have an incredible ${progress.current_streak}-day learning streak. Keep the momentum going!`,
      icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500/10'
    });
  } else if (progress.total_sessions < 3) {
    insights.push({
      title: 'Just Starting',
      desc: 'Complete a few more sessions to build a solid learning habit.',
      icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10'
    });
  }

  // Fluency insight
  const metrics = progress.session_metrics || [];
  if (metrics.length >= 2) {
    const recent = metrics.slice(-3);
    const avgRecent = recent.reduce((sum, m) => sum + m.fluency_wpm, 0) / (recent.length || 1);
    const old = metrics.slice(0, Math.max(1, metrics.length - 3));
    const avgOld = old.reduce((sum, m) => sum + m.fluency_wpm, 0) / (old.length || 1);

    if (avgRecent > avgOld + 5) {
      insights.push({
        title: 'Speaking Faster',
        desc: `Your fluency has improved to ~${Math.round(avgRecent)} WPM. You're sounding more natural.`,
        icon: Activity, color: 'text-emerald-500', bg: 'bg-emerald-500/10'
      });
    }
  }

  // Mistakes insight
  const mistakes = progress.mistake_types || {};
  const sortedMistakes = Object.entries(mistakes).sort((a, b) => b[1] - a[1]);
  if (sortedMistakes.length > 0) {
    insights.push({
      title: 'Focus Area',
      desc: `You make the most errors with ${sortedMistakes[0][0].replace(/-/g, ' ')}. Pay attention to this next session.`,
      icon: Lightbulb, color: 'text-yellow-500', bg: 'bg-yellow-500/10'
    });
  }

  // Vocab insight
  if (progress.vocabulary?.mastered > 10) {
    insights.push({
      title: 'Vocab Master',
      desc: `You've mastered ${progress.vocabulary.mastered} new words. Your vocabulary is expanding!`,
      icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10'
    });
  }

  return insights.slice(0, 3); // Max 3 insights
};

export default function ProgressPage() {
  const { user } = useAuth();
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/progress');
        setProgress(res.data);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const formatAccuracy = (val) => {
    // Sometimes the backend might return 300 if it was out of 30 and multiplied by 10 without capping
    if (val > 100) return Math.min(100, Math.round(val / 3));
    return Math.min(100, val || 0);
  };

  const metricsData = progress?.session_metrics?.map((m, i) => ({
    sessionLabel: `S${i + 1}`,
    date: formatDate(m.date),
    accuracy: formatAccuracy(m.grammar_accuracy),
    score: Math.min(100, m.overall_score || 0),
    wpm: m.fluency_wpm || 0
  })) || [];

  const vocabWeekly = Object.entries(progress?.weekly_vocabulary || {}).map(([week, count]) => ({
    week: week.split('-W')[1] ? `W${week.split('-W')[1]}` : week,
    count
  }));

  const mistakeData = Object.entries(progress?.mistake_types || {})
    .sort((a, b) => b[1] - a[1]) // Sort largest first
    .map(([name, value]) => ({ name: name.replace(/-/g, ' '), value }));

  const insights = calculateInsights(progress);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card/95 backdrop-blur border border-border rounded-xl p-3 shadow-xl">
          <p className="font-medium text-sm mb-2 text-muted-foreground">{label}</p>
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-2 text-sm mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.stroke || entry.fill || entry.color }} />
              <span className="text-muted-foreground">{entry.name}:</span>
              <span className="font-medium text-foreground">{entry.value}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="progress-page">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2" style={{ fontFamily: 'Fraunces, serif' }}>
          Your Learning Journey
        </h1>
        <p className="text-muted-foreground">Comprehensive insights into your spoken English progress.</p>
      </motion.div>

      {/* Top Banner: CEFR & Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* CEFR Journey Card */}
        <Card className="lg:col-span-2 relative overflow-hidden border-border/50 shadow-sm bg-gradient-to-br from-card to-card/50">
          <div className="absolute -right-12 -top-12 opacity-5 pointer-events-none">
            <TrendingUp size={240} />
          </div>
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">Current Level</p>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-5xl font-bold text-foreground" style={{ fontFamily: 'JetBrains Mono' }}>{user?.cefr_level || '--'}</h2>
                  <span className="text-primary font-medium">{cefrDescriptions[user?.cefr_level] || 'Keep learning!'}</span>
                </div>
              </div>
              <div className="text-left md:text-right">
                <p className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">Target Level</p>
                <Badge variant="outline" className="text-lg px-3 py-1 bg-background/50 border-primary/20 text-primary">{user?.target_cefr_level || '--'}</Badge>
              </div>
            </div>

            <div className="relative pt-4">
              <div className="flex justify-between text-xs font-semibold text-muted-foreground mb-2 px-1">
                {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(lvl => (
                  <span key={lvl} className={lvl === user?.cefr_level ? 'text-primary scale-110 transition-transform' : ''}>
                    {lvl}
                  </span>
                ))}
              </div>
              <div className="relative h-4 bg-muted/50 rounded-full overflow-hidden backdrop-blur-sm">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${cefrProgress[user?.cefr_level] || 10}%` }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Insights Panel */}
        <Card className="border-border/50 shadow-sm flex flex-col">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-primary" />
              Learning Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 flex-1 justify-center">
            {insights.length > 0 ? insights.map((insight, i) => (
              <motion.div
                key={insight.title}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 }}
                className="flex items-start gap-3"
              >
                <div className={`p-2 rounded-xl ${insight.bg} shrink-0 mt-0.5`}>
                  <insight.icon className={`w-4 h-4 ${insight.color}`} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold">{insight.title}</h4>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{insight.desc}</p>
                </div>
              </motion.div>
            )) : (
              <div className="text-center text-muted-foreground text-sm py-4">
                Complete more sessions to generate AI insights.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Sessions', value: progress?.total_sessions || 0, sub: `${progress?.current_streak || 0} Day Streak`, icon: Mic, color: 'text-blue-500' },
          { label: 'Words Mastered', value: progress?.vocabulary?.mastered || 0, sub: `Out of ${progress?.vocabulary?.total || 0} words`, icon: BookOpen, color: 'text-emerald-500' },
          { label: 'Fluency', value: metricsData.length > 0 ? metricsData[metricsData.length - 1].wpm : '--', sub: 'WPM Average', icon: Activity, color: 'text-purple-500' },
          { label: 'Mistakes Logged', value: Object.keys(progress?.mistake_types || {}).length, sub: 'Categories analyzed', icon: AlertTriangle, color: 'text-rose-500' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + (i * 0.05) }}>
            <Card className="border-border/50 shadow-sm hover:border-border transition-colors h-full">
              <CardContent className="p-5 flex flex-col items-center text-center justify-center h-full">
                <div className="mb-3">
                  <s.icon size={24} className={s.color} />
                </div>
                <div className="text-2xl font-bold mb-1" style={{ fontFamily: 'JetBrains Mono' }}>{s.value}</div>
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Performance Trends */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Performance Trends</CardTitle>
            <CardDescription>Your overall score and grammar accuracy over time.</CardDescription>
          </CardHeader>
          <CardContent>
            {metricsData.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                  <AreaChart data={metricsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorOverall" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(157, 25%, 39%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(157, 25%, 39%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorGrammar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(13, 68%, 63%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(13, 68%, 63%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="sessionLabel" axisLine={false} tickLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} dy={10} />
                    <YAxis axisLine={false} tickLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                    <Area type="natural" dataKey="score" name="Overall Score" stroke="hsl(157, 25%, 39%)" fillOpacity={1} fill="url(#colorOverall)" strokeWidth={2} />
                    <Area type="natural" dataKey="accuracy" name="Grammar %" stroke="hsl(13, 68%, 63%)" fillOpacity={1} fill="url(#colorGrammar)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center border-2 border-dashed border-border rounded-xl bg-muted/20">
                <p className="text-sm text-muted-foreground text-center">Complete more sessions to display performance trends.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fluency */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Fluency Trend</CardTitle>
            <CardDescription>Speaking speed measured in Words Per Minute (WPM).</CardDescription>
          </CardHeader>
          <CardContent>
            {metricsData.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                  <LineChart data={metricsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="sessionLabel" axisLine={false} tickLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} dy={10} />
                    <YAxis axisLine={false} tickLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="wpm" name="Words Per Min" stroke="hsl(280, 50%, 60%)" strokeWidth={3} dot={{ r: 4, fill: "hsl(var(--card))", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center border-2 border-dashed border-border rounded-xl bg-muted/20">
                <p className="text-sm text-muted-foreground text-center">Complete more sessions to track fluency.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Weekly Vocab Growth */}
        <Card className="border-border/50 shadow-sm flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Vocabulary Acquisition</CardTitle>
            <CardDescription>Number of new words acquired grouped by week.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-end">
            {vocabWeekly.length > 0 ? (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                  <BarChart data={vocabWeekly} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="week" axisLine={false} tickLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} dy={10} />
                    <YAxis axisLine={false} tickLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted)/0.5)' }} />
                    <Bar dataKey="count" fill="hsl(200, 50%, 50%)" radius={[6, 6, 0, 0]} name="Words Added" maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center border-2 border-dashed border-border rounded-xl bg-muted/20">
                <p className="text-sm text-muted-foreground text-center">Add vocabulary words to track growth.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mistake Analysis */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Mistake Recognition</CardTitle>
            <CardDescription>Breakdown of AI-identified linguistic errors.</CardDescription>
          </CardHeader>
          <CardContent>
            {mistakeData.length > 0 ? (
              <div className="flex flex-col md:flex-row items-center gap-8 h-[250px]">
                <div className="w-full md:w-1/2 h-full min-h-[150px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                    <PieChart>
                      <Pie
                        data={mistakeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {mistakeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full md:w-1/2 space-y-3 overflow-y-auto max-h-full pr-2">
                  {mistakeData.map((m, i) => (
                    <div key={m.name} className="flex items-center gap-3 bg-muted/30 p-2 rounded-lg">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="capitalize text-sm font-medium truncate flex-1">{m.name}</span>
                      <Badge variant="secondary" className="font-mono bg-background shadow-sm">{m.value}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center border-2 border-dashed border-border rounded-xl bg-muted/20">
                <p className="text-sm text-muted-foreground text-center">No mistakes tracked yet. Great job!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
