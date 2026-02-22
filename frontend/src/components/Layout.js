import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Sun, Moon, Menu, LayoutDashboard, TrendingUp, BookOpen, Map, Settings, LogOut, User } from 'lucide-react';
import { useState } from 'react';

const navLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/vocabulary', label: 'Vocabulary', icon: BookOpen },
  { to: '/plan', label: 'Plan', icon: Map },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/'); };

  return (
    <div className="min-h-screen bg-background" data-testid="app-layout">
      <nav className="sticky top-0 z-50 glass border-b border-border/50" data-testid="main-navbar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-2 group" data-testid="nav-logo">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm" style={{ fontFamily: 'Fraunces, serif' }}>F</span>
              </div>
              <span className="text-xl font-semibold tracking-tight" style={{ fontFamily: 'Fraunces, serif' }}>Fluentra</span>
            </Link>

            {user && (
              <div className="hidden md:flex items-center gap-1">
                {navLinks.map(({ to, label, icon: Icon }) => (
                  <Link key={to} to={to} data-testid={`nav-${label.toLowerCase()}`}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${location.pathname === to ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                    <Icon size={16} />
                    {label}
                  </Link>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full" data-testid="theme-toggle">
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </Button>

              {user ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="rounded-full gap-2 hidden md:flex" data-testid="user-menu-trigger">
                        <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
                          <User size={14} className="text-accent" />
                        </div>
                        <span className="text-sm font-medium">{user.name}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => navigate('/settings')} data-testid="menu-settings">
                        <Settings size={14} className="mr-2" /> Settings
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
                        <LogOut size={14} className="mr-2" /> Logout
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                    <SheetTrigger asChild>
                      <Button variant="ghost" size="icon" className="md:hidden rounded-full" data-testid="mobile-menu-trigger">
                        <Menu size={20} />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-64">
                      <div className="flex flex-col gap-2 mt-8">
                        {navLinks.map(({ to, label, icon: Icon }) => (
                          <Link key={to} to={to} onClick={() => setMobileOpen(false)} data-testid={`mobile-nav-${label.toLowerCase()}`}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${location.pathname === to ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                            <Icon size={18} />
                            {label}
                          </Link>
                        ))}
                        <Link to="/settings" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted">
                          <Settings size={18} /> Settings
                        </Link>
                        <button onClick={() => { handleLogout(); setMobileOpen(false); }} className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10" data-testid="mobile-logout">
                          <LogOut size={18} /> Logout
                        </button>
                      </div>
                    </SheetContent>
                  </Sheet>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Link to="/login">
                    <Button variant="ghost" className="rounded-full" data-testid="nav-login">Log in</Button>
                  </Link>
                  <Link to="/register">
                    <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90" data-testid="nav-register">Get Started</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1">{children}</main>
    </div>
  );
}
