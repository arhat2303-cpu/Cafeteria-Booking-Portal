import React, { useState } from 'react';
import {
  ShieldCheck,
  Eye,
  EyeOff,
  User,
  GraduationCap,
  ChefHat,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { BrandCrest } from '@/components/BrandCrest';
import type { UserRole } from '@/types';

interface RoleCardConfig {
  role: UserRole;
  title: string;
  description: string;
  accentHex: string;
  borderHoverClass: string;
  glowStyle: string;
  buttonBgStyle: string;
  buttonTextClass: string;
  placeholderUser: string;
  subtitle: string;
  icon: React.ReactNode;
}

const ROLE_CARDS: RoleCardConfig[] = [
  {
    role: 'student',
    title: 'Student',
    description: 'View pre-ordered meals & display your cashless QR pass',
    accentHex: '#5CE1E6',
    borderHoverClass: 'hover:border-[#5CE1E6]/50',
    glowStyle: 'radial-gradient(circle at 85% 15%, rgba(92, 225, 230, 0.11), transparent 60%)',
    buttonBgStyle: '#5CE1E6',
    buttonTextClass: 'text-zinc-950',
    placeholderUser: 'Enter student username',
    subtitle: 'Sign in with your school-issued student account to view meals & QR codes.',
    icon: <GraduationCap className="w-6 h-6 text-[#5CE1E6]" strokeWidth={1.9} />,
  },
  {
    role: 'parent',
    title: 'Parent',
    description: 'Browse official menu, schedule child meals & pay in AED',
    accentHex: '#CCF32F',
    borderHoverClass: 'hover:border-[#CCF32F]/50',
    glowStyle: 'radial-gradient(circle at 85% 15%, rgba(204, 243, 47, 0.12), transparent 60%)',
    buttonBgStyle: '#CCF32F',
    buttonTextClass: 'text-zinc-950',
    placeholderUser: 'Enter parent username',
    subtitle: 'Sign in to manage linked children, pre-order canteen meals & pay digitally.',
    icon: <User className="w-6 h-6 text-[#CCF32F]" strokeWidth={1.9} />,
  },
  {
    role: 'chef',
    title: 'Chef',
    description: 'Prepare break-slot orders, scan QR passes & confirm pickup',
    accentHex: '#FFB020',
    borderHoverClass: 'hover:border-[#FFB020]/50',
    glowStyle: 'radial-gradient(circle at 85% 15%, rgba(255, 176, 32, 0.11), transparent 60%)',
    buttonBgStyle: '#FFB020',
    buttonTextClass: 'text-zinc-950',
    placeholderUser: 'Enter kitchen staff username',
    subtitle: 'Kitchen Display & QR Verification access for authorised canteen chefs.',
    icon: <ChefHat className="w-6 h-6 text-[#FFB020]" strokeWidth={1.9} />,
  },
  {
    role: 'admin',
    title: 'Admin',
    description: 'Everything + manage students, parents, chefs & menu',
    accentHex: '#A78BFA',
    borderHoverClass: 'hover:border-[#A78BFA]/50',
    glowStyle: 'radial-gradient(circle at 85% 15%, rgba(167, 139, 250, 0.12), transparent 60%)',
    buttonBgStyle: '#A78BFA',
    buttonTextClass: 'text-zinc-950',
    placeholderUser: 'Enter administrator username',
    subtitle: 'Authorised Bright Riders School Canteen Administration access.',
    icon: <ShieldCheck className="w-6 h-6 text-[#A78BFA]" strokeWidth={1.9} />,
  },
];

export const AuthPage: React.FC = () => {
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [parentTab, setParentTab] = useState<'login' | 'register'>('login');
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

  const { login, registerParent } = useAuth();
  const { showToast } = useToast();

  const activeCard = ROLE_CARDS.find((c) => c.role === selectedRole) || null;

  const openRolePortal = (role: UserRole) => {
    setSelectedRole(role);
    setParentTab('login');
    setUsername('');
    setPassword('');
    setShowPw(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    setSubmitting(true);
    try {
      const u = await login(username.trim(), password, selectedRole);
      showToast(`Welcome, ${u.fullName}!`, 'success', `Signed in to ${u.role.toUpperCase()} Portal`);
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
        password,
        email,
        phone,
        address,
        studentCode: studentCode.trim() || undefined,
        relationship,
      });
      showToast(
        'Parent Account Created!',
        'success',
        `Welcome to Bright Riders Digital Canteen, ${u.fullName}.`
      );
    } catch (err: any) {
      showToast('Registration failed', 'error', err.message || 'Please check your details.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleParentRegisterSubmit = async (e: React.FormEvent) => {
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
        `Welcome to Bright Riders Digital Canteen, ${u.fullName}.`
      );
    } catch (err: any) {
      showToast('Registration failed', 'error', err.message || 'Please check your details.');
    } finally {
      setSubmitting(false);
    }
  };

  // Suppress unused warning on handleRegister helper
  void handleRegister;

  return (
    <div className="min-h-screen portal-grid-bg flex flex-col relative overflow-hidden">
      {/* Subtle architectural arc watermark inspired by reference layout */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-56 right-12 w-[520px] h-[520px] rounded-full border border-white/[0.035] hidden lg:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-44 right-24 w-[420px] h-[420px] rounded-full border border-[#CCF32F]/[0.04] hidden lg:block"
      />

      {/* Top Portal Header Bar */}
      <header className="w-full border-b border-white/[0.08] bg-[#0B0D11]/85 backdrop-blur-md z-20">
        <div className="max-w-7xl mx-auto px-5 sm:px-10 h-20 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setSelectedRole(null)}
            className="text-left focus:outline-none group"
          >
            <BrandCrest size="md" lightText />
          </button>

          <div className="hidden md:flex items-center gap-2.5 font-mono text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
            <span className="w-2 h-2 rounded-full bg-[#CCF32F] shadow-[0_0_10px_#CCF32F]" />
            <span>ABU DHABI • AED CASHLESS PORTAL</span>
          </div>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 sm:px-8 py-12 sm:py-16 z-10">
        {!activeCard ? (
          /* ROLE SELECTION LANDING SCREEN ("Who's signing in?") */
          <div className="w-full max-w-6xl mx-auto flex flex-col items-center">
            <p className="font-mono text-[11px] sm:text-xs tracking-[0.28em] text-zinc-400 uppercase text-center mb-4">
              BRIGHT RIDERS DIGITAL CANTEEN &nbsp;•&nbsp; SCHOOL FOOD ORDERING &amp; PAYMENT PORTAL
            </p>

            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-center mb-12 sm:mb-14">
              <span className="text-white">Who’s </span>
              <span className="text-[#CCF32F]">signing in?</span>
            </h1>

            {/* Exactly 4 Role-Selection Cards: Student, Parent, Chef, Admin */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
              {ROLE_CARDS.map((card) => (
                <button
                  key={card.role}
                  type="button"
                  onClick={() => openRolePortal(card.role)}
                  style={{ backgroundImage: card.glowStyle }}
                  className={`group relative text-left rounded-[22px] bg-[#13161E]/95 border border-white/[0.08] ${card.borderHoverClass} p-7 sm:p-8 flex flex-col justify-between min-h-[290px] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.85)] focus:outline-none focus:ring-2 focus:ring-[#CCF32F]/50`}
                >
                  <div>
                    <div className="w-14 h-14 rounded-2xl bg-[#0D0F15] border border-white/[0.08] group-hover:border-white/20 flex items-center justify-center transition-colors shadow-inner">
                      {card.icon}
                    </div>

                    <h2 className="text-2xl sm:text-[26px] font-bold tracking-tight text-white mt-7">
                      {card.title}
                    </h2>

                    <p className="font-mono text-xs sm:text-[13px] text-zinc-400 leading-relaxed mt-3">
                      {card.description}
                    </p>
                  </div>

                  <div
                    style={{ color: card.accentHex }}
                    className="mt-9 inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.2em] uppercase"
                  >
                    <span>SIGN IN</span>
                    <span className="transition-transform duration-300 group-hover:translate-x-1">
                      →]
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <p className="mt-12 font-mono text-[11px] tracking-[0.22em] text-zinc-600 uppercase text-center">
              ADFSA &amp; ADEK SEHHI COMPLIANT &nbsp;•&nbsp; SINGLE-USE QR COLLECTION VERIFICATION
            </p>
          </div>
        ) : (
          /* DEDICATED ROLE LOGIN / PARENT REGISTRATION INTERFACE */
          <div className="w-full max-w-md mx-auto">
            <button
              type="button"
              onClick={() => setSelectedRole(null)}
              className="mb-6 inline-flex items-center gap-2 font-mono text-xs tracking-[0.18em] uppercase text-zinc-400 hover:text-white transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>BACK TO ROLE SELECTION</span>
            </button>

            <div
              style={{ backgroundImage: activeCard.glowStyle }}
              className="rounded-[24px] bg-[#13161E]/95 border border-white/[0.1] p-7 sm:p-9 shadow-elevated"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-13 h-13 p-3.5 rounded-2xl bg-[#0D0F15] border border-white/[0.09] flex items-center justify-center shrink-0">
                  {activeCard.icon}
                </div>
                <div>
                  <span
                    style={{ color: activeCard.accentHex }}
                    className="font-mono text-[11px] font-semibold tracking-[0.22em] uppercase block"
                  >
                    {activeCard.title.toUpperCase()} PORTAL
                  </span>
                  <h2 className="text-2xl font-bold text-white tracking-tight mt-0.5">
                    {activeCard.role === 'parent' && parentTab === 'register'
                      ? 'Parent Registration'
                      : `${activeCard.title} Sign In`}
                  </h2>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed mb-6">
                {activeCard.subtitle}
              </p>

              {/* Parent Role Only: Toggle between Sign In and New Parent Registration */}
              {activeCard.role === 'parent' && (
                <div className="grid grid-cols-2 bg-[#0B0D11] border border-white/[0.08] p-1 rounded-xl mb-6">
                  <button
                    type="button"
                    onClick={() => setParentTab('login')}
                    className={`py-2 rounded-lg font-mono text-xs uppercase tracking-wider font-semibold transition ${
                      parentTab === 'login'
                        ? 'bg-[#CCF32F] text-zinc-950 shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setParentTab('register')}
                    className={`py-2 rounded-lg font-mono text-xs uppercase tracking-wider font-semibold transition ${
                      parentTab === 'register'
                        ? 'bg-[#CCF32F] text-zinc-950 shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Register
                  </button>
                </div>
              )}

              {activeCard.role === 'parent' && parentTab === 'register' ? (
                <form onSubmit={handleParentRegisterSubmit} className="space-y-3.5">
                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                      Parent Full Name *
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Full Name"
                      className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                        Username *
                      </label>
                      <input
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="e.g. parent.ahmed"
                        className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                        Password (8+ chars) *
                      </label>
                      <input
                        type="password"
                        minLength={8}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="parent@domain.ae"
                        className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                        UAE Mobile
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+971-50-..."
                        className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                      Residential Area (Abu Dhabi)
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Mohammed Bin Zayed City, Abu Dhabi"
                      className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                    />
                  </div>

                  <div className="rounded-2xl bg-[#0B0D11] border border-white/10 p-3.5 space-y-2.5">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-[#CCF32F]">
                      Optional: Link Enrolled Child by Student ID
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="sm:col-span-2">
                        <input
                          type="text"
                          value={studentCode}
                          onChange={(e) => setStudentCode(e.target.value)}
                          placeholder="Student ID (e.g. BRS-STU-...)"
                          className="w-full rounded-xl bg-[#13161E] border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#CCF32F]"
                        />
                      </div>
                      <div>
                        <select
                          value={relationship}
                          onChange={(e) => setRelationship(e.target.value)}
                          className="w-full rounded-xl bg-[#13161E] border border-white/15 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#CCF32F]"
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
                    className="w-full py-3 rounded-xl bg-[#CCF32F] hover:bg-[#d8fa50] disabled:opacity-60 text-zinc-950 font-mono text-xs uppercase tracking-[0.18em] font-bold transition shadow-lime"
                  >
                    {submitting ? 'CREATING ACCOUNT...' : 'CREATE PARENT ACCOUNT →]'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={activeCard.placeholderUser}
                      className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/40"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full rounded-xl bg-[#0B0D11] border border-white/15 px-3.5 py-3 pr-10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/40"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    style={{ backgroundColor: activeCard.buttonBgStyle }}
                    className={`w-full py-3.5 rounded-xl hover:brightness-110 disabled:opacity-60 ${activeCard.buttonTextClass} font-mono text-xs uppercase tracking-[0.2em] font-bold transition shadow-lg mt-2`}
                  >
                    {submitting ? 'VERIFYING...' : `SIGN IN AS ${activeCard.title.toUpperCase()} →]`}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
