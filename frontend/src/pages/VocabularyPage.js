import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Search, BookOpen, RotateCcw, CheckCircle2 } from 'lucide-react';
import api from '@/utils/api';
import { motion } from 'framer-motion';

const statusColors = { new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', learning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', reviewing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', mastered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' };

export default function VocabularyPage() {
  const [vocabulary, setVocabulary] = useState([]);
  const [dueWords, setDueWords] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newWord, setNewWord] = useState({ word: '', definition: '', example_sentence: '', cefr_level: 'B1' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [vocRes, dueRes] = await Promise.all([api.get('/vocabulary'), api.get('/vocabulary/due')]);
      setVocabulary(vocRes.data);
      setDueWords(dueRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const addWord = async () => {
    if (!newWord.word || !newWord.definition) { toast.error('Word and definition required'); return; }
    try {
      await api.post('/vocabulary', newWord);
      toast.success(`"${newWord.word}" added!`);
      setNewWord({ word: '', definition: '', example_sentence: '', cefr_level: 'B1' });
      setAddOpen(false);
      loadData();
    } catch (err) { toast.error('Failed to add word'); }
  };

  const reviewWord = async (id, quality) => {
    try {
      await api.put(`/vocabulary/${id}/review`, { quality });
      toast.success(quality >= 3 ? 'Correct!' : 'Keep practicing!');
      loadData();
    } catch (err) { toast.error('Review failed'); }
  };

  const filtered = vocabulary.filter(v => {
    const matchSearch = v.word.toLowerCase().includes(search.toLowerCase()) || v.definition.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || v.status === filter;
    return matchSearch && matchFilter;
  });

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="vocabulary-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>Vocabulary</h1>
          <p className="text-muted-foreground mt-1">{vocabulary.length} words in your library</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full" data-testid="add-word-btn"><Plus size={16} className="mr-2" /> Add Word</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle style={{ fontFamily: 'Fraunces, serif' }}>Add New Word</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div><Label>Word</Label><Input value={newWord.word} onChange={e => setNewWord(p => ({ ...p, word: e.target.value }))} placeholder="e.g. eloquent" className="mt-1" data-testid="new-word-input" /></div>
              <div><Label>Definition</Label><Input value={newWord.definition} onChange={e => setNewWord(p => ({ ...p, definition: e.target.value }))} placeholder="Fluent or persuasive in speaking" className="mt-1" data-testid="new-word-definition" /></div>
              <div><Label>Example Sentence</Label><Input value={newWord.example_sentence} onChange={e => setNewWord(p => ({ ...p, example_sentence: e.target.value }))} placeholder="She gave an eloquent speech." className="mt-1" data-testid="new-word-example" /></div>
              <div><Label>CEFR Level</Label>
                <Select value={newWord.cefr_level} onValueChange={v => setNewWord(p => ({ ...p, cefr_level: v }))}>
                  <SelectTrigger className="mt-1" data-testid="new-word-level"><SelectValue /></SelectTrigger>
                  <SelectContent>{['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={addWord} className="w-full rounded-full" data-testid="save-word-btn">Save Word</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Due for Review */}
      {dueWords.length > 0 && (
        <Card className="border-accent/30 bg-accent/5 mb-8" data-testid="due-review-card">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><RotateCcw size={16} className="text-accent" /> {dueWords.length} Words Due for Review</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {dueWords.slice(0, 10).map(w => (
                <div key={w.id} className="flex items-center gap-2 bg-background rounded-lg p-3 border border-border/50">
                  <span className="font-medium text-sm">{w.word}</span>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-green-600" onClick={() => reviewWord(w.id, 4)} data-testid={`review-correct-${w.id}`}>
                    <CheckCircle2 size={14} className="mr-1" /> Know it
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-accent" onClick={() => reviewWord(w.id, 1)} data-testid={`review-again-${w.id}`}>
                    Again
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search words..." className="pl-10" data-testid="vocab-search" />
        </div>
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="bg-muted/50 rounded-full">
            <TabsTrigger value="all" className="rounded-full text-xs" data-testid="filter-all">All</TabsTrigger>
            <TabsTrigger value="new" className="rounded-full text-xs" data-testid="filter-new">New</TabsTrigger>
            <TabsTrigger value="learning" className="rounded-full text-xs" data-testid="filter-learning">Learning</TabsTrigger>
            <TabsTrigger value="mastered" className="rounded-full text-xs" data-testid="filter-mastered">Mastered</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Word List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen size={40} className="mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">{vocabulary.length === 0 ? 'No words yet. Add your first word!' : 'No words match your search.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((w, i) => (
            <motion.div key={w.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="border-border/50 hover:border-accent/20 transition-colors" data-testid={`vocab-item-${w.id}`}>
                <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{w.word}</span>
                      <Badge variant="outline" className="text-[10px]">{w.cefr_level}</Badge>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[w.status] || statusColors.new}`}>{w.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{w.definition}</p>
                    {w.example_sentence && <p className="text-xs text-muted-foreground/70 italic mt-1">"{w.example_sentence}"</p>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground" style={{ fontFamily: 'JetBrains Mono' }}>
                    <span>{w.correct_attempts}/{w.total_attempts}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
