import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Mic, Brain, TrendingUp, BookOpen, Target, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  { icon: Mic, title: 'Live Voice Sessions', desc: 'Natural conversations with an AI tutor using cutting-edge voice technology. No typing required.' },
  { icon: Brain, title: 'Persistent Memory', desc: 'Your tutor remembers your mistakes, progress, and goals across every session.' },
  { icon: Target, title: 'CEFR Assessment', desc: 'Start with a spoken assessment that accurately measures your English level from A1 to C2.' },
  { icon: TrendingUp, title: 'Adaptive Learning', desc: 'Your learning plan evolves based on your performance, focusing where you need it most.' },
  { icon: BookOpen, title: 'Vocabulary Builder', desc: 'Learn words in context with spaced repetition to lock them into long-term memory.' },
  { icon: Sparkles, title: 'Real-Time Feedback', desc: 'Get instant grammar corrections and pronunciation tips during every conversation.' },
];

const fadeUp = { hidden: { opacity: 0, y: 24 }, visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }) };

export default function LandingPage() {
  return (
    <div className="overflow-hidden" data-testid="landing-page">
      {/* Hero */}
      <section className="relative min-h-[85vh] flex items-center" data-testid="hero-section">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="max-w-7xl mx-auto px-6 py-20 flex flex-col md:flex-row items-center gap-12 md:gap-16 relative z-10 w-full">
          <motion.div className="flex-1 md:max-w-[55%]" initial="hidden" animate="visible">
            <motion.div variants={fadeUp} custom={0} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent text-sm font-medium mb-8">
              <Sparkles size={14} /> Powered by Gemini Live AI
            </motion.div>
            <motion.h1 variants={fadeUp} custom={1} className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1] mb-6">
              Speak English<br />
              <span className="text-accent">Like You Always</span><br />
              Knew How
            </motion.h1>
            <motion.p variants={fadeUp} custom={2} className="text-base md:text-lg text-muted-foreground max-w-lg mb-10 leading-relaxed">
              Fluentra is your AI English tutor that listens, remembers, and adapts.
              Have real conversations, get instant feedback, and watch your fluency grow.
            </motion.p>
            <motion.div variants={fadeUp} custom={3} className="flex flex-wrap gap-4">
              <Link to="/register">
                <Button className="rounded-full px-8 py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95" data-testid="hero-cta">
                  Start Free Assessment <ArrowRight size={18} className="ml-2" />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" className="rounded-full px-8 py-6 text-lg font-medium border-2 hover:bg-primary hover:text-primary-foreground" data-testid="hero-login">
                  I Have an Account
                </Button>
              </Link>
            </motion.div>
          </motion.div>

          <motion.div className="flex-1 relative" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.6 }}>
            <div className="relative rounded-2xl overflow-hidden aspect-[4/3] shadow-2xl">
              <img src="https://images.unsplash.com/photo-1653669487404-09c3617c2b6c?w=800&q=80" alt="Students learning" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
            </div>
            {/* Floating stats card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
              className="absolute -bottom-6 -left-6 glass rounded-xl p-4 border border-border/50 shadow-lg">
              <div className="text-2xl font-bold text-accent" style={{ fontFamily: 'JetBrains Mono' }}>A1 → C2</div>
              <div className="text-xs text-muted-foreground mt-1">Full CEFR journey</div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6" data-testid="features-section">
        <div className="max-w-7xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
              Everything You Need to Become Fluent
            </motion.h2>
            <motion.p variants={fadeUp} custom={1} className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
              A complete learning system that adapts to you, not the other way around.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div key={f.title} initial="hidden" whileInView="visible" viewport={{ once: true }} custom={i} variants={fadeUp}>
                <Card className="bg-card border-border/50 hover:border-accent/30 transition-all duration-300 hover:-translate-y-1 h-full" data-testid={`feature-card-${i}`}>
                  <CardContent className="p-8">
                    <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-6">
                      <f.icon size={22} className="text-accent" />
                    </div>
                    <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: 'Fraunces, serif' }}>{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-muted/30" data-testid="how-it-works">
        <div className="max-w-7xl mx-auto">
          <motion.h2 initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0} className="text-3xl sm:text-4xl font-semibold tracking-tight text-center mb-16">
            How Fluentra Works
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Take the Assessment', desc: 'A 5-15 minute spoken conversation determines your starting level on the CEFR scale.' },
              { step: '02', title: 'Get Your Plan', desc: 'We create a personalized weekly learning plan with vocabulary, grammar, and speaking exercises.' },
              { step: '03', title: 'Practice & Improve', desc: 'Have live voice sessions with your AI tutor. Track your progress as your plan adapts to you.' },
            ].map((item, i) => (
              <motion.div key={item.step} initial="hidden" whileInView="visible" viewport={{ once: true }} custom={i} variants={fadeUp}
                className="relative pl-8 md:pl-0 md:text-center">
                <div className="text-6xl font-light text-accent/20 mb-4" style={{ fontFamily: 'Fraunces, serif' }}>{item.step}</div>
                <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: 'Fraunces, serif' }}>{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6" data-testid="cta-section">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-6">Ready to Start Speaking?</h2>
          <p className="text-base md:text-lg text-muted-foreground mb-10">Your first assessment is free. Find out your English level in under 15 minutes.</p>
          <Link to="/register">
            <Button className="rounded-full px-10 py-6 text-lg font-medium bg-accent text-accent-foreground hover:bg-accent/90 transition-transform hover:scale-105 active:scale-95" data-testid="cta-button">
              Begin Your Journey <ArrowRight size={18} className="ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs" style={{ fontFamily: 'Fraunces, serif' }}>F</span>
            </div>
            <span className="text-sm text-muted-foreground">Fluentra.ai</span>
          </div>
          <p className="text-xs text-muted-foreground">Adaptive English tutoring powered by AI</p>
        </div>
      </footer>
    </div>
  );
}
