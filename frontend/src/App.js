import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import Layout from "@/components/Layout";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import OnboardingPage from "@/pages/OnboardingPage";
import AssessmentPage from "@/pages/AssessmentPage";
import DashboardPage from "@/pages/DashboardPage";
import SessionPage from "@/pages/SessionPage";
import ProgressPage from "@/pages/ProgressPage";
import VocabularyPage from "@/pages/VocabularyPage";
import LearningPlanPage from "@/pages/LearningPlanPage";
import SettingsPage from "@/pages/SettingsPage";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (!user.onboarding_completed) return <Navigate to="/onboarding" />;
  if (!user.assessment_completed) return <Navigate to="/assessment" />;
  return children;
}

function OnboardingRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (user.onboarding_completed && !user.assessment_completed) return <Navigate to="/assessment" />;
  if (user.onboarding_completed && user.assessment_completed) return <Navigate to="/dashboard" />;
  return children;
}

function AssessmentRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (!user.onboarding_completed) return <Navigate to="/onboarding" />;
  if (user.assessment_completed) return <Navigate to="/dashboard" />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.onboarding_completed) return <Navigate to="/onboarding" />;
  if (user && !user.assessment_completed) return <Navigate to="/assessment" />;
  if (user) return <Navigate to="/dashboard" />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout><LandingPage /></Layout>} />
      <Route path="/login" element={<PublicRoute><Layout><LoginPage /></Layout></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Layout><RegisterPage /></Layout></PublicRoute>} />
      <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />
      <Route path="/assessment" element={<AssessmentRoute><AssessmentPage /></AssessmentRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><Layout><DashboardPage /></Layout></ProtectedRoute>} />
      <Route path="/session/:sessionId?" element={<ProtectedRoute><SessionPage /></ProtectedRoute>} />
      <Route path="/progress" element={<ProtectedRoute><Layout><ProgressPage /></Layout></ProtectedRoute>} />
      <Route path="/vocabulary" element={<ProtectedRoute><Layout><VocabularyPage /></Layout></ProtectedRoute>} />
      <Route path="/plan" element={<ProtectedRoute><Layout><LearningPlanPage /></Layout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Layout><SettingsPage /></Layout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="top-right" />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
