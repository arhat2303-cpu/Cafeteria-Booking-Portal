import React from 'react';
import { Check, Clock, Utensils, PackageCheck, XCircle, AlertTriangle } from 'lucide-react';
import type { OrderStatus, PaymentStatus, UserRole } from '@/types';

export const BrandCrest: React.FC<{ size?: 'sm' | 'md' | 'lg'; lightText?: boolean }> = ({
  size = 'md',
  lightText = false,
}) => {
  const boxSize = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-13 h-13' : 'w-10 h-10';
  return (
    <div className="flex items-center gap-3 select-none">
      <div
        className={`${boxSize} rounded-xl bg-gradient-to-br from-brs-navy via-brs-royal to-brs-blue border border-amber-400/50 flex items-center justify-center shadow-sm shrink-0`}
      >
        <svg viewBox="0 0 64 64" className="w-7 h-7" fill="none">
          <path
            d="M32 7L52 16V30.5C52 44 43.2 54.5 32 58C20.8 54.5 12 44 12 30.5V16L32 7Z"
            fill="#163A5F"
            stroke="#F59E0B"
            strokeWidth="3"
          />
          <path
            d="M24 21V31C24 33.2 25.8 35 28 35V45H31V21H29V29.5H27.2V21H24Z"
            fill="#FEF3C7"
          />
          <path
            d="M36.5 21C34.4 21 33 23.4 33 27C33 30.2 34.2 32.3 35.8 33V45H39V21H36.5Z"
            fill="#F59E0B"
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="flex items-center gap-2">
          <span
            className={`font-bold tracking-tight ${
              size === 'lg' ? 'text-lg' : 'text-sm sm:text-base'
            } ${lightText ? 'text-white' : 'text-brs-navy'}`}
          >
            Bright Riders School
          </span>
        </div>
        <p
          className={`text-xs font-medium ${
            lightText ? 'text-amber-300/90' : 'text-amber-700'
          }`}
        >
          SmartCanteen • Cashless Campus Dining
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
    <div className="w-full h-full bg-gradient-to-br from-amber-50 via-orange-50/70 to-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-amber-200/30" />
      <div className="absolute -left-6 -bottom-6 w-20 h-20 rounded-full bg-brs-navy/5" />
      <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-amber-200/80 flex items-center justify-center text-amber-700 font-bold text-base mb-1.5 z-10">
        {initials || <Utensils className="w-5 h-5" />}
      </div>
      {category && (
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider z-10 text-center line-clamp-1">
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
      cls: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    confirmed: {
      label: 'Order Confirmed',
      cls: 'bg-sky-50 text-sky-800 border-sky-200',
    },
    preparing: {
      label: 'Preparing in Kitchen',
      cls: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    },
    ready_for_collection: {
      label: 'Ready for Collection',
      cls: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold',
    },
    collected: {
      label: 'Collected',
      cls: 'bg-slate-100 text-slate-700 border-slate-300',
    },
    cancelled: {
      label: 'Cancelled',
      cls: 'bg-rose-50 text-rose-800 border-rose-200',
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
    paid: { label: 'Paid (AED)', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    failed: { label: 'Failed', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
    refunded: { label: 'Refunded', cls: 'bg-purple-50 text-purple-800 border-purple-200' },
  };
  const cfg = styles[normalized] || {
    label: status,
    cls: 'bg-slate-100 text-slate-700 border-slate-200',
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
    admin: { label: 'Administrator', cls: 'bg-brs-navy text-amber-300' },
    parent: { label: 'Parent', cls: 'bg-sky-100 text-sky-900' },
    student: { label: 'Student', cls: 'bg-emerald-100 text-emerald-900' },
    teacher: { label: 'Teacher', cls: 'bg-violet-100 text-violet-900' },
    chef: { label: 'Chef / Kitchen', cls: 'bg-amber-100 text-amber-900' },
  };
  const cfg = map[role];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

export const OrderProgressStepper: React.FC<{ status: OrderStatus }> = ({ status }) => {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
        <XCircle className="w-4 h-4 shrink-0" />
        <span>This order has been cancelled.</span>
      </div>
    );
  }
  if (status === 'awaiting_payment') {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
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
                  idx === 0 ? 'opacity-0' : done ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
              />
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all ${
                  done
                    ? active && step.key === 'ready_for_collection'
                      ? 'bg-emerald-600 border-emerald-600 text-white ring-4 ring-emerald-100'
                      : 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-300 text-slate-400'
                }`}
              >
                {step.icon}
              </div>
              <div
                className={`h-1 flex-1 rounded-r-full ${
                  idx === steps.length - 1
                    ? 'opacity-0'
                    : idx < currentIdx
                    ? 'bg-emerald-500'
                    : 'bg-slate-200'
                }`}
              />
            </div>
            <span
              className={`mt-1 text-[11px] leading-tight ${
                done ? 'font-semibold text-slate-800' : 'text-slate-400'
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
