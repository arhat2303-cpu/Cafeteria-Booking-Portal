import React, { useState } from 'react';
import {
  ShieldCheck,
  QrCode,
  CreditCard,
  UtensilsCrossed,
  Eye,
  EyeOff,
  Users,
  GraduationCap,
  ChefHat,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { BrandCrest } from '@/components/BrandCrest';

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Login fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Parent registration fields
  const [fullName, setFullName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [relationship, setRelationship] = useState('Mother');

  const { login, registerParent, settings } = useAuth();
  const { showToast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await login(username.trim(), password);
      showToast(`Welcome back, ${u.fullName}!`, 'success', `Signed in as ${u.role.toUpperCase()}`);
    } catch (err: any) {
      showToast('Sign-in failed', 'error', err.message || 'Invalid credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await registerParent({
        fullName,
        username: regUsername,
        password: regPassword,
        email,
        phone,
        address,
        studentCode: studentCode.trim() || undefined,
        relationship,
      });
      showToast(
        'Parent Account Created!',
        'success',
        `Welcome to Bright Riders SmartCanteen, ${u.fullName}.`
      );
    } catch (err: any) {
      showToast('Registration failed', 'error', err.message || 'Please check your details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Brand & Value Proposition Panel */}
      <div className="lg:w-[48%] bg-gradient-to-br from-brs-navy via-brs-royal to-slate-900 text-white p-8 sm:p-12 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <BrandCrest size="lg" lightText />

          <div className="mt-10 lg:mt-14 max-w-xl">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-semibold mb-4">
              <ShieldCheck className="w-3.5 h-3.5" />
              {settings?.schoolCampus || 'Abu Dhabi Campus, UAE'} • Cashless AED Dining
            </span>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              Pre-order nutritious school meals. Collect with a single QR scan.
            </h1>

            <p className="mt-4 text-slate-200/90 text-sm sm:text-base leading-relaxed">
              Designed for Bright Riders School families, students, teachers, and kitchen staff —
              eliminating physical cash on campus while keeping canteen queues fast, transparent, and
              organized.
            </p>

            {/* Key Capabilities */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
                <UtensilsCrossed className="w-5 h-5 text-amber-400 mb-2" />
                <h3 className="font-semibold text-sm">Live School Menu</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Browse exact canteen items, prices in AED, allergens, and daily availability.
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
                <CreditCard className="w-5 h-5 text-emerald-400 mb-2" />
                <h3 className="font-semibold text-sm">Digital AED Payments</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Itemized online checkout with instant confirmation and transaction receipts.
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
                <QrCode className="w-5 h-5 text-sky-400 mb-2" />
                <h3 className="font-semibold text-sm">Cashless QR Collection</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Students collect pre-paid meals using secure, single-use order QR codes.
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
                <ChefHat className="w-5 h-5 text-amber-300 mb-2" />
                <h3 className="font-semibold text-sm">Real-Time Kitchen Sync</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Track every order from Confirmed to Preparing, Ready, and Collected.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Five Unified Portals Footer */}
        <div className="relative z-10 mt-10 pt-6 border-t border-white/10">
          <p className="text-xs uppercase tracking-wider text-slate-300 font-semibold mb-3">
            One Unified Platform • Five Role-Based Experiences
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-slate-100">
              <Users className="w-3.5 h-3.5 text-sky-300" /> Parents
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-slate-100">
              <GraduationCap className="w-3.5 h-3.5 text-emerald-300" /> Students
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-slate-100">
              <BookOpen className="w-3.5 h-3.5 text-violet-300" /> Teachers
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-slate-100">
              <ChefHat className="w-3.5 h-3.5 text-amber-300" /> Chefs
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-slate-100">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Administrators
            </span>
          </div>
        </div>
      </div>

      {/* Right Authentication Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md">
          {/* Tab Switcher */}
          <div className="grid grid-cols-2 bg-slate-200/70 p-1 rounded-2xl mb-7">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`py-2.5 rounded-xl text-sm font-semibold transition ${
                mode === 'login'
                  ? 'bg-white text-brs-navy shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Portal Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`py-2.5 rounded-xl text-sm font-semibold transition ${
                mode === 'register'
                  ? 'bg-white text-brs-navy shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Parent Registration
            </button>
          </div>

          {mode === 'login' ? (
            <div className="bg-white rounded-3xl p-7 sm:p-8 shadow-soft border border-slate-200/90">
              <h2 className="text-2xl font-bold text-slate-900">Sign in to SmartCanteen</h2>
              <p className="text-sm text-slate-500 mt-1">
                Enter your Bright Riders School credentials to access your role dashboard.
              </p>

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. parent.fatima or student.zayed"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full rounded-xl border border-slate-300 pl-3.5 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal focus:border-transparent"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-xl bg-brs-navy hover:bg-brs-royal disabled:opacity-60 text-white font-semibold text-sm shadow-sm transition flex items-center justify-center gap-2"
                >
                  <span>{submitting ? 'Signing in...' : 'Sign In to Portal'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
                <p>
                  <span className="font-semibold text-slate-700">Students, Teachers & Chefs:</span>{' '}
                  Sign in with the credentials issued by your Bright Riders School Administrator.
                </p>
                <p className="mt-1">
                  <span className="font-semibold text-slate-700">New Parents:</span> Switch to{' '}
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    className="text-brs-royal font-semibold underline"
                  >
                    Parent Registration
                  </button>{' '}
                  to create an account and link your children.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-7 sm:p-8 shadow-soft border border-slate-200/90">
              <h2 className="text-2xl font-bold text-slate-900">Create Parent Account</h2>
              <p className="text-sm text-slate-500 mt-1">
                Register to browse the canteen menu, pre-order meals, and pay digitally in AED.
              </p>

              <form onSubmit={handleRegister} className="mt-5 space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Parent Full Name *
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ahmed Al Dhaheri"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Username *
                    </label>
                    <input
                      type="text"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="parent.ahmed"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Password (min 8 chars) *
                    </label>
                    <input
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="••••••••"
                      minLength={8}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="parent@example.ae"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile Phone (UAE)
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+971 50 000 0000"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Residential Area (Abu Dhabi)
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Mohammed Bin Zayed City, Abu Dhabi"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                  />
                </div>

                <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 space-y-2.5">
                  <p className="text-xs font-semibold text-amber-950">
                    Optional: Link Child Account Immediately
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        value={studentCode}
                        onChange={(e) => setStudentCode(e.target.value)}
                        placeholder="Student ID (e.g. BRS-STU-2026-101)"
                        className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <select
                        value={relationship}
                        onChange={(e) => setRelationship(e.target.value)}
                        className="w-full rounded-xl border border-amber-300 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <option value="Mother">Mother</option>
                        <option value="Father">Father</option>
                        <option value="Guardian">Guardian</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-semibold text-sm shadow-sm transition"
                >
                  {submitting ? 'Creating Account...' : 'Create Parent Account'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
