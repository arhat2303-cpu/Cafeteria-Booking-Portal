import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  QrCode,
  Calendar,
  Clock,
  LogOut,
  GraduationCap,
  Utensils,
  History,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, useRealtimeUpdates } from '@/lib/api';
import type { OrderRecord } from '@/types';
import {
  BrandCrest,
  OrderProgressStepper,
  OrderStatusBadge,
  RolePill,
} from '@/components/BrandCrest';
import { QrPassModal } from '@/components/QrPassModal';

export const StudentDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [qrOrderId, setQrOrderId] = useState<number | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const res = await apiFetch<{ orders: OrderRecord[] }>('/api/orders');
      setOrders(res.orders);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useRealtimeUpdates((evt) => {
    if (evt.startsWith('order.')) {
      loadOrders();
    }
  });

  const upcomingOrders = useMemo(
    () => orders.filter((o) => !['collected', 'cancelled'].includes(o.orderStatus)),
    [orders]
  );

  const pastOrders = useMemo(
    () => orders.filter((o) => ['collected', 'cancelled'].includes(o.orderStatus)),
    [orders]
  );

  const sp = user?.studentProfile;

  return (
    <div className="min-h-screen bg-slate-50 pb-14">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <BrandCrest size="sm" />
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-slate-900">{user?.fullName}</p>
              <RolePill role="student" />
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Student Campus Dining ID Card */}
        <div className="bg-gradient-to-br from-brs-navy via-brs-royal to-emerald-950 rounded-3xl p-6 text-white shadow-soft">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-amber-300 shrink-0">
                <GraduationCap className="w-8 h-8" />
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-amber-300 font-semibold">
                  Cashless Student Dining Pass
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold">{user?.fullName}</h1>
                <p className="text-xs sm:text-sm text-slate-200 mt-0.5">
                  {sp?.className || 'Student'} • ID:{' '}
                  <span className="font-mono font-semibold">{sp?.studentCode || 'N/A'}</span>
                  {sp?.house ? ` • ${sp.house}` : ''}
                </p>
              </div>
            </div>

            <div className="bg-white/10 border border-white/15 rounded-2xl px-4 py-3 text-xs space-y-1">
              <div className="text-amber-200 font-semibold">Zero Physical Cash Needed</div>
              <div className="text-slate-200">
                Present your Order QR Code at the canteen counter during your break slot.
              </div>
              {sp?.parents && sp.parents.length > 0 && (
                <div className="text-slate-300 pt-1">
                  Linked Parent: <strong>{sp.parents.map((p) => p.fullName).join(', ')}</strong>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="flex gap-2 bg-slate-200/70 p-1 rounded-2xl max-w-sm">
          <button
            onClick={() => setTab('upcoming')}
            className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition ${
              tab === 'upcoming'
                ? 'bg-white text-brs-navy shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Utensils className="w-4 h-4" />
            Upcoming Meals ({upcomingOrders.length})
          </button>
          <button
            onClick={() => setTab('history')}
            className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition ${
              tab === 'history'
                ? 'bg-white text-brs-navy shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            Past Orders ({pastOrders.length})
          </button>
        </div>

        {/* Orders List */}
        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">Loading your meal orders...</div>
        ) : tab === 'upcoming' ? (
          upcomingOrders.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
              <Sparkles className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900">No Upcoming Meal Orders</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                When your parent places and pays for a meal order online, your food items and
                cashless QR collection pass will appear right here automatically!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingOrders.map((ord) => (
                <div
                  key={ord.id}
                  className={`bg-white rounded-3xl border-2 p-5 sm:p-6 shadow-sm space-y-4 transition ${
                    ord.orderStatus === 'ready_for_collection'
                      ? 'border-emerald-400 ring-4 ring-emerald-50'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-sm text-brs-navy">
                        {ord.orderNumber}
                      </span>
                      <OrderStatusBadge status={ord.orderStatus} />
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      Pre-Paid Online ✓
                    </span>
                  </div>

                  {/* Date & Break Slot */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 rounded-2xl p-3.5 border border-slate-100 text-xs sm:text-sm">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Calendar className="w-4 h-4 text-brs-royal shrink-0" />
                      <span>
                        Date: <strong className="text-slate-900">{ord.orderDate}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-700">
                      <Clock className="w-4 h-4 text-brs-royal shrink-0" />
                      <span>
                        Break: <strong className="text-slate-900">{ord.collectionSlot}</strong>
                      </span>
                    </div>
                  </div>

                  <OrderProgressStepper status={ord.orderStatus} />

                  {/* Food Items & Quantities */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                      Your Meal Items
                    </p>
                    <ul className="divide-y divide-slate-100 bg-slate-50/70 rounded-2xl border border-slate-200/80 px-4">
                      {ord.items.map((it) => (
                        <li key={it.id} className="py-2.5 flex items-center justify-between text-sm">
                          <span className="font-semibold text-slate-900">{it.name}</span>
                          <span className="px-2.5 py-0.5 rounded-lg bg-brs-navy text-white text-xs font-bold">
                            Qty: {it.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    onClick={() => setQrOrderId(ord.id)}
                    className="w-full py-3.5 rounded-2xl bg-brs-navy hover:bg-brs-royal text-white font-bold text-sm sm:text-base shadow-md transition flex items-center justify-center gap-2.5"
                  >
                    <QrCode className="w-5 h-5 text-amber-300" />
                    Display Order QR Code for Collection
                  </button>
                </div>
              ))}
            </div>
          )
        ) : pastOrders.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
            No previous meal collections yet.
          </div>
        ) : (
          <div className="space-y-3">
            {pastOrders.map((ord) => (
              <div
                key={ord.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-brs-navy">
                      {ord.orderNumber}
                    </span>
                    <OrderStatusBadge status={ord.orderStatus} />
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-1">
                    {ord.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {ord.orderDate} • {ord.collectionSlot}
                  </p>
                </div>
                {ord.collection && (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Collected {new Date(ord.collection.collectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <QrPassModal orderId={qrOrderId} onClose={() => setQrOrderId(null)} />
    </div>
  );
};
