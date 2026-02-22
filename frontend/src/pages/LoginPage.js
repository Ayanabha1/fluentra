import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success('Welcome back!');
      if (!user.onboarding_completed) navigate('/onboarding');
      else if (!user.assessment_completed) navigate('/assessment');
      else navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12" data-testid="login-page">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center pb-2">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
            <span className="text-primary-foreground font-bold text-lg" style={{ fontFamily: 'Fraunces, serif' }}>F</span>
          </div>
          <CardTitle className="text-2xl" style={{ fontFamily: 'Fraunces, serif' }}>Welcome Back</CardTitle>
          <CardDescription>Continue your English learning journey</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required className="mt-1" data-testid="login-email" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" required className="mt-1" data-testid="login-password" />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-full py-5 text-base font-medium" data-testid="login-submit">
              {loading ? <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <><LogIn size={16} className="mr-2" /> Log In</>}
            </Button>
          </form>
          <p className="text-sm text-center text-muted-foreground mt-6">
            New here? <Link to="/register" className="text-accent hover:underline font-medium" data-testid="login-to-register">Create an account</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
