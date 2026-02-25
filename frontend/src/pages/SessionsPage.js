import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4 } }) };

const PAGE_SIZE = 10;

export default function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      try {
        const sessRes = await api.get('/sessions');
        // Filter only completed sessions for the history view
        setSessions(sessRes.data.filter(s => s.status === 'completed'));
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalPages = Math.ceil(sessions.length / PAGE_SIZE) || 1;
  const paginatedSessions = sessions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6" data-testid="sessions-history-page">
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0} className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>
          Session History
        </h1>
        <p className="text-muted-foreground mt-1">Review your past conversations and track your progress over time.</p>
      </motion.div>

      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={1}>
        <Card className="border-border/50 shadow-sm" data-testid="all-sessions-card">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-lg font-medium">All Completed Sessions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No completed sessions yet. Head to the Dashboard to start your first one!</p>
            ) : (
              <div className="divide-y divide-border/50">
                {paginatedSessions.map(s => (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background hover:bg-muted/50 transition-colors cursor-pointer gap-2"
                    onClick={() => navigate(`/session/${s.id}`)}
                    data-testid={`session-${s.id}`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize text-xs bg-accent/5 text-accent border-accent/20">
                          {s.session_type || 'speaking'}
                        </Badge>
                        <span className="text-sm font-medium">
                          {new Date(s.completed_at || s.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground ml-1">
                        {new Date(s.completed_at || s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-2 sm:mt-0">
                      <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1 rounded-md">
                        <Clock size={14} className="text-muted-foreground" />
                        <span className="text-xs font-medium">{s.duration_minutes || 0}m</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
                          Score: {s.metrics?.overall_score || 0}/100
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-border/50 bg-muted/20">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded-full"
                >
                  <ChevronLeft size={16} className="mr-1" /> Previous
                </Button>
                <span className="text-xs text-muted-foreground font-medium">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-full"
                >
                  Next <ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
