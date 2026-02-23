import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { User, Moon, Sun, Globe, Target, Calendar } from 'lucide-react';
import api from '@/utils/api';

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [name, setName] = useState(user?.name || '');
  const [targetLevel, setTargetLevel] = useState(user?.target_cefr_level || 'B2');
  const [nativeLang, setNativeLang] = useState(user?.native_language || 'Other');
  const [sessionsPerWeek, setSessionsPerWeek] = useState(user?.sessions_per_week || 3);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put('/users/onboard', {
        native_language: nativeLang,
        target_cefr_level: targetLevel,
        learning_goals: user?.learning_goals || [],
        sessions_per_week: sessionsPerWeek,
      });
      updateUser({ ...res.data, name });
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="settings-page">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-8" style={{ fontFamily: 'Fraunces, serif' }}>Settings</h1>

      {/* Profile */}
      <Card className="border-border/50 mb-6" data-testid="profile-settings">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><User size={16} /> Profile</CardTitle>
          <CardDescription>Your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" data-testid="settings-name" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={user?.email || ''} disabled className="mt-1 opacity-60" />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <Label>Current Level</Label>
              <div className="text-2xl font-bold mt-1" style={{ fontFamily: 'JetBrains Mono' }}>{user?.cefr_level || '--'}</div>
            </div>
            <div>
              <Label>Native Language</Label>
              <Select value={nativeLang} onValueChange={setNativeLang}>
                <SelectTrigger className="mt-1" data-testid="settings-native-lang"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {['Spanish', 'Mandarin', 'Hindi', 'Bengali', 'Arabic', 'Portuguese', 'French', 'German', 'Japanese', 'Korean', 'Russian', 'Turkish', 'Italian', 'Vietnamese', 'Thai', 'Other'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Learning Preferences */}
      <Card className="border-border/50 mb-6" data-testid="learning-settings">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Target size={16} /> Learning Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Target CEFR Level</Label>
            <Select value={targetLevel} onValueChange={setTargetLevel}>
              <SelectTrigger className="mt-1" data-testid="settings-target-level"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['A2', 'B1', 'B2', 'C1', 'C2'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sessions Per Week</Label>
            <Select value={String(sessionsPerWeek)} onValueChange={v => setSessionsPerWeek(Number(v))}>
              <SelectTrigger className="mt-1" data-testid="settings-sessions"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5, 7].map(n => <SelectItem key={n} value={String(n)}>{n} sessions/week</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Learning Goals</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {user?.learning_goals?.map(g => (
                <span key={g} className="text-xs bg-accent/10 text-accent px-3 py-1 rounded-full">{g}</span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="border-border/50 mb-6" data-testid="appearance-settings">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">{theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />} Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Dark Mode</div>
              <div className="text-xs text-muted-foreground">Switch between light and dark themes</div>
            </div>
            <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} data-testid="settings-theme-switch" />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" className="rounded-full text-destructive border-destructive/30 hover:bg-destructive/10" onClick={logout} data-testid="settings-logout">
          Logout
        </Button>
        <Button onClick={handleSave} disabled={saving} className="rounded-full" data-testid="settings-save">
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
