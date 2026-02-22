import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, BookOpen, Mic, AlertTriangle } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const COLORS = ['hsl(13, 68%, 63%)', 'hsl(157, 25%, 39%)', 'hsl(40, 60%, 55%)', 'hsl(200, 50%, 50%)', 'hsl(280, 50%, 60%)', 'hsl(7, 67%, 55%)'];
const cefrProgress = { 'A1': 8, 'A2': 25, 'B1': 42, 'B2': 58, 'C1': 75, 'C2': 92 };

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

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const grammarData = progress?.session_metrics?.map((m, i) => ({ session: i + 1, accuracy: m.grammar_accuracy, score: m.overall_score })) || [];
  const fluencyData = progress?.session_metrics?.map((m, i) => ({ session: i + 1, wpm: m.fluency_wpm })) || [];
  const vocabWeekly = Object.entries(progress?.weekly_vocabulary || {}).map(([week, count]) => ({ week: week.split('-W')[1] ? `W${week.split('-W')[1]}` : week, count }));
  const mistakeData = Object.entries(progress?.mistake_types || {}).map(([name, value]) => ({ name: name.replace(/-/g, ' '), value }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="progress-page">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Your Progress</h1>
        <p className="text-muted-foreground mb-8">Track your improvement over time.</p>
      </motion.div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'CEFR Level', value: user?.cefr_level || '--', sub: `Target: ${user?.target_cefr_level || '--'}`, icon: TrendingUp },
          { label: 'Sessions', value: progress?.total_sessions || 0, sub: `${progress?.current_streak || 0} day streak`, icon: Mic },
          { label: 'Vocabulary', value: progress?.vocabulary?.total || 0, sub: `${progress?.vocabulary?.mastered || 0} mastered`, icon: BookOpen },
          { label: 'Mistake Types', value: Object.keys(progress?.mistake_types || {}).length, sub: 'categories tracked', icon: AlertTriangle },
        ].map((s, i) => (
          <Card key={s.label} className="border-border/50" data-testid={`progress-stat-${i}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CEFR Progress Bar */}
      <Card className="border-border/50 mb-8" data-testid="cefr-progress-bar">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">CEFR Level Progress</span>
            <Badge className="font-mono">{user?.cefr_level} → {user?.target_cefr_level}</Badge>
          </div>
          <Progress value={cefrProgress[user?.cefr_level] || 42} className="h-3 mb-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => <span key={l} className={l === user?.cefr_level ? 'text-accent font-bold' : ''}>{l}</span>)}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="grammar" className="space-y-6">
        <TabsList className="bg-muted/50 rounded-full p-1">
          <TabsTrigger value="grammar" className="rounded-full" data-testid="tab-grammar">Grammar</TabsTrigger>
          <TabsTrigger value="vocabulary" className="rounded-full" data-testid="tab-vocabulary">Vocabulary</TabsTrigger>
          <TabsTrigger value="fluency" className="rounded-full" data-testid="tab-fluency">Fluency</TabsTrigger>
          <TabsTrigger value="mistakes" className="rounded-full" data-testid="tab-mistakes">Mistakes</TabsTrigger>
        </TabsList>

        <TabsContent value="grammar">
          <Card className="border-border/50" data-testid="grammar-chart">
            <CardHeader><CardTitle className="text-base">Grammar Accuracy Over Sessions</CardTitle></CardHeader>
            <CardContent>
              {grammarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={grammarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="session" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    <Legend />
                    <Line type="monotone" dataKey="accuracy" stroke="hsl(13, 68%, 63%)" strokeWidth={2} dot={{ r: 4 }} name="Grammar %" />
                    <Line type="monotone" dataKey="score" stroke="hsl(157, 25%, 39%)" strokeWidth={2} dot={{ r: 4 }} name="Overall Score" />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-12">Complete sessions to see your grammar progress.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vocabulary">
          <Card className="border-border/50" data-testid="vocab-chart">
            <CardHeader><CardTitle className="text-base">Weekly Vocabulary Growth</CardTitle></CardHeader>
            <CardContent>
              {vocabWeekly.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={vocabWeekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    <Bar dataKey="count" fill="hsl(157, 25%, 39%)" radius={[4, 4, 0, 0]} name="Words" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-12">Add vocabulary words to track growth.</p>}
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{progress?.vocabulary?.new || 0}</div>
                  <div className="text-xs text-muted-foreground">New</div>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{progress?.vocabulary?.learning || 0}</div>
                  <div className="text-xs text-muted-foreground">Learning</div>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <div className="text-xl font-bold" style={{ fontFamily: 'JetBrains Mono' }}>{progress?.vocabulary?.mastered || 0}</div>
                  <div className="text-xs text-muted-foreground">Mastered</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fluency">
          <Card className="border-border/50" data-testid="fluency-chart">
            <CardHeader><CardTitle className="text-base">Fluency Trend (Words Per Minute)</CardTitle></CardHeader>
            <CardContent>
              {fluencyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={fluencyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="session" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    <Area type="monotone" dataKey="wpm" stroke="hsl(200, 50%, 50%)" fill="hsl(200, 50%, 50%)" fillOpacity={0.1} strokeWidth={2} name="WPM" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-12">Complete sessions to track fluency.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mistakes">
          <Card className="border-border/50" data-testid="mistakes-chart">
            <CardHeader><CardTitle className="text-base">Mistake Categories</CardTitle></CardHeader>
            <CardContent>
              {mistakeData.length > 0 ? (
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={mistakeData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value">
                        {mistakeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 min-w-[160px]">
                    {mistakeData.map((m, i) => (
                      <div key={m.name} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{m.name}</span>
                        <span className="ml-auto font-mono text-muted-foreground">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground text-center py-12">No mistakes tracked yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
