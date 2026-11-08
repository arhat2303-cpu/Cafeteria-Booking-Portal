import React from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AuthPage } from '@/pages/AuthPage';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { ParentDashboard } from '@/pages/parent/ParentDashboard';
import { StudentDashboard } from '@/pages/student/StudentDashboard';
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard';
import { ChefDashboard } from '@/pages/chef/ChefDashboard';
import { BrandCrest } from '@/components/BrandCrest';

const RoleRouter: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <BrandCrest size="lg" />
        <p className="text-sm text-slate-500 font-medium animate-pulse">
          Connecting to Bright Riders SmartCanteen...
        </p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  switch (user.role) {
    case 'admin':
      return <AdminDashboard />;
    case 'parent':
      return <ParentDashboard />;
    case 'student':
      return <StudentDashboard />;
    case 'teacher':
      return <TeacherDashboard />;
    case 'chef':
      return <ChefDashboard />;
    default:
      return <AuthPage />;
  }
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
