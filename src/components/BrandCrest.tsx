import React from 'react';
import { Check, Clock, Utensils, PackageCheck, XCircle, AlertTriangle } from 'lucide-react';
import type { OrderStatus, PaymentStatus, UserRole } from '@/types';

export const BrandCrest: React.FC<{ size?: 'sm' | 'md' | 'lg'; lightText?: boolean }> = ({
  size = 'md',
}) => {
  const boxSize = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-12 h-12' : 'w-11 h-11';
  return (
    <div className="flex items-center gap-3.5 select-none">
      <div
        className={`${boxSize} rounded-2xl bg-[#151821] border border-white/15 flex items-center justify-center shadow-[0_0_20px_rgba(204,243,47,0.12)] shrink-0 p-1`}
      >
        <img
          src="/brs-logo.png"
          alt="Bright Riders School Official Crest"
          className="w-full h-full object-contain drop-shadow-sm"
        />
      </div>
      <div className="leading-tight">
        <div className="flex items-center gap-1 font-extrabold tracking-tight uppercase text-white">
          <span className={size === 'lg' ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'}>
            BRIGHT RIDERS
          </span>
          <span className="text-[#CCF32F] font-mono font-bold">/</span>
          <span className={size === 'lg' ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'}>
            DIGITAL CANTEEN
          </span>
        </div>
        <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.2em] text-zinc-400 uppercase mt-0.5">
          SCHOOL FOOD ORDERING &amp; PAYMENT PORTAL
        </p>
      </div>
    </div>
  );
};

export const FoodIllustrationPlaceholder: React.FC<{ name: string; category?: string }> = ({
  name,
  category,
}) => {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="w-full h-full bg-gradient-to-br from-[#181C26] via-[#13161E] to-[#0E1016] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-[#CCF32F]/10" />
      <div className="absolute -left-6 -bottom-6 w-20 h-20 rounded-full bg-[#5CE1E6]/10" />
      <div className="w-12 h-12 rounded-2xl bg-[#1F2432] border border-white/10 flex items-center justify-center text-[#CCF32F] font-bold text-base mb-1.5 z-10">
        {initials || <Utensils className="w-5 h-5" />}
      </div>
      {category && (
        <span className="font-mono text-[10px] font-medium text-zinc-400 uppercase tracking-widest z-10 text-center line-clamp-1">
          {category}
        </span>
      )}
    </div>
  );
};

export const OrderStatusBadge: React.FC<{ status: OrderStatus }> = ({ status }) => {
  const styles: Record<OrderStatus, { label: string; cls: string }> = {
    awaiting_payment: {
      label: 'Awaiting Payment',
      cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    },
    confirmed: {
      label: 'Order Confirmed',
      cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30',
    },
    preparing: {
      label: 'Preparing in Kitchen',
      cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
    },
    ready_for_collection: {
      label: 'Ready for Collection',
      cls: 'bg-[#CCF32F]/20 text-[#CCF32F] border-[#CCF32F]/40 font-semibold',
    },
    collected: {
      label: 'Collected',
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
    },
    cancelled: {
      label: 'Cancelled',
      cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
    },
  };
  const cfg = styles[status] || styles.confirmed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
};

export const PaymentStatusBadge: React.FC<{ status: PaymentStatus | string }> = ({ status }) => {
  const normalized = status === 'succeeded' ? 'paid' : status;
  const styles: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Paid (AED)', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
    pending: { label: 'Pending', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
    failed: { label: 'Failed', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
    refunded: { label: 'Refunded', cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  };
  const cfg = styles[normalized] || {
    label: status,
    cls: 'bg-zinc-800 text-zinc-300 border-white/10',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
};

export const RolePill: React.FC<{ role: UserRole }> = ({ role }) => {
  const map: Record<UserRole, { label: string; cls: string }> = {
    student: {
      label: 'Student',
      cls: 'bg-[#5CE1E6]/15 text-[#5CE1E6] border border-[#5CE1E6]/30',
    },
    parent: {
      label: 'Parent',
      cls: 'bg-[#CCF32F]/15 text-[#CCF32F] border border-[#CCF32F]/30',
    },
    chef: {
      label: 'Chef',
      cls: 'bg-[#FFB020]/15 text-[#FFB020] border border-[#FFB020]/30',
    },
    admin: {
      label: 'Admin',
      cls: 'bg-[#A78BFA]/15 text-[#A78BFA] border border-[#A78BFA]/30',
    },
  };
  const cfg = map[role];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md font-mono text-[11px] uppercase tracking-wider font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

export const OrderProgressStepper: React.FC<{ status: OrderStatus }> = ({ status }) => {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-xl px-3 py-2">
        <XCircle className="w-4 h-4 shrink-0" />
        <span>This order has been cancelled.</span>
      </div>
    );
  }
  if (status === 'awaiting_payment') {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-400/25 rounded-xl px-3 py-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Complete digital payment to confirm order and generate Student QR Pass.</span>
      </div>
    );
  }

  const steps: Array<{ key: OrderStatus; label: string; icon: React.ReactNode }> = [
    { key: 'confirmed', label: 'Confirmed', icon: <Check className="w-3.5 h-3.5" /> },
    { key: 'preparing', label: 'Preparing', icon: <Utensils className="w-3.5 h-3.5" /> },
    { key: 'ready_for_collection', label: 'Ready', icon: <Clock className="w-3.5 h-3.5" /> },
    { key: 'collected', label: 'Collected', icon: <PackageCheck className="w-3.5 h-3.5" /> },
  ];

  const currentIdx = steps.findIndex((s) => s.key === status);

  return (
    <div className="grid grid-cols-4 gap-1.5 pt-1">
      {steps.map((step, idx) => {
        const done = idx <= currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step.key} className="flex flex-col items-center text-center">
            <div className="w-full flex items-center">
              <div
                className={`h-1 flex-1 rounded-l-full ${
                  idx === 0 ? 'opacity-0' : done ? 'bg-[#CCF32F]' : 'bg-zinc-800'
                }`}
              />
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all ${
                  done
                    ? active && step.key === 'ready_for_collection'
                      ? 'bg-[#CCF32F] border-[#CCF32F] text-zinc-950 ring-4 ring-[#CCF32F]/20'
                      : 'bg-[#CCF32F] border-[#CCF32F] text-zinc-950'
                    : 'bg-[#151821] border-white/15 text-zinc-500'
                }`}
              >
                {step.icon}
              </div>
              <div
                className={`h-1 flex-1 rounded-r-full ${
                  idx === steps.length - 1
                    ? 'opacity-0'
                    : idx < currentIdx
                    ? 'bg-[#CCF32F]'
                    : 'bg-zinc-800'
                }`}
              />
            </div>
            <span
              className={`mt-1 text-[11px] leading-tight ${
                done ? 'font-semibold text-zinc-100' : 'text-zinc-500'
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};
