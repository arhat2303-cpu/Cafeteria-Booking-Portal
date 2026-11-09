import React from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AuthPage } from '@/pages/AuthPage';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { ParentDashboard } from '@/pages/parent/ParentDashboard';
import { StudentDashboard } from '@/pages/student/StudentDashboard';
import { ChefDashboard } from '@/pages/chef/ChefDashboard';
import { BrandCrest } from '@/components/BrandCrest';

const RoleRouter: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen portal-grid-bg flex flex-col items-center justify-center gap-5">
        <BrandCrest size="lg" lightText />
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-zinc-400 animate-pulse">
          Initializing Digital Canteen Portal...
        </p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="dark-portal-theme">
      {user.role === 'admin' && <AdminDashboard />}
      {user.role === 'parent' && <ParentDashboard />}
      {user.role === 'student' && <StudentDashboard />}
      {user.role === 'chef' && <ChefDashboard />}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <RoleRouter />
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
