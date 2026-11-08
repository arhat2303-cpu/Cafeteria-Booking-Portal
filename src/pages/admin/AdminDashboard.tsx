import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  UtensilsCrossed,
  ClipboardList,
  CreditCard,
  BarChart3,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, useRealtimeUpdates } from '@/lib/api';
import { BrandCrest, RolePill } from '@/components/BrandCrest';
import { AdminOverviewSection } from './AdminOverviewSection';
import { AdminUsersSection } from './AdminUsersSection';
import { AdminMenuSection } from './AdminMenuSection';
import {
  AdminOrdersSection,
  AdminPaymentsSection,
  AdminReportsAndAuditSection,
} from './AdminOperationsSection';

type AdminTab = 'overview' | 'users' | 'menu' | 'orders' | 'payments' | 'reports';

export const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overviewData, setOverviewData] = useState<any | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/overview');
      setOverviewData(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useRealtimeUpdates(() => {
    loadOverview();
  });

  const navItems: Array<{ id: AdminTab; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview Dashboard', icon: LayoutDashboard },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'menu', label: 'Menu Management', icon: UtensilsCrossed },
    { id: 'orders', label: 'Order Management', icon: ClipboardList },
    { id: 'payments', label: 'Payment Management', icon: CreditCard },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-68 shrink-0 bg-brs-navy text-white flex-col justify-between p-5 sticky top-0 h-screen">
        <div>
          <BrandCrest size="sm" lightText />

          <div className="mt-8 space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition ${
                    active
                      ? 'bg-amber-400 text-slate-950 shadow-sm font-bold'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-white/10 space-y-3">
          <div>
            <p className="text-xs font-bold text-white truncate">{user?.fullName}</p>
            <p className="text-[11px] text-slate-400 font-mono">@{user?.username}</p>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-slate-200 text-slate-700"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900">
                {navItems.find((n) => n.id === tab)?.label}
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                Bright Riders School • Complete Platform Administration
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <RolePill role="admin" />
            <button
              onClick={logout}
              className="lg:hidden p-2 rounded-xl border border-slate-200 text-slate-600"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 bg-slate-950/70 flex">
            <div className="w-72 bg-brs-navy text-white p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-6">
                  <BrandCrest size="sm" lightText />
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-1.5 rounded-lg bg-white/10"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setTab(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold ${
                          active ? 'bg-amber-400 text-slate-950 font-bold' : 'text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full py-2.5 rounded-xl bg-white/10 text-xs font-semibold"
              >
                Sign Out
              </button>
            </div>
            <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
          </div>
        )}

        {/* Active Admin View */}
        <main className="p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {tab === 'overview' && <AdminOverviewSection data={overviewData} />}
          {tab === 'users' && <AdminUsersSection />}
          {tab === 'menu' && <AdminMenuSection />}
          {tab === 'orders' && <AdminOrdersSection />}
          {tab === 'payments' && <AdminPaymentsSection />}
          {tab === 'reports' && <AdminReportsAndAuditSection />}
        </main>
      </div>
    </div>
  );
};
