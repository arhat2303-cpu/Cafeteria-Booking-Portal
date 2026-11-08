import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  QrCode,
  ChefHat,
  Search,
  LogOut,
  Flame,
  BellRing,
  CheckCircle2,
  Clock,
  Calendar,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { apiFetch, useRealtimeUpdates } from '@/lib/api';
import type { OrderRecord } from '@/types';
import {
  BrandCrest,
  OrderStatusBadge,
  PaymentStatusBadge,
  RolePill,
} from '@/components/BrandCrest';
import { ChefQrScannerModal } from '@/components/ChefQrScannerModal';

type KdsStatusFilter = 'active' | 'confirmed' | 'preparing' | 'ready_for_collection' | 'collected';

export const ChefDashboard: React.FC = () => {
  const { user, settings, logout } = useAuth();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({
    confirmed: 0,
    preparing: 0,
    ready_for_collection: 0,
    collected: 0,
  });
  const [statusFilter, setStatusFilter] = useState<KdsStatusFilter>('active');
  const [selectedSlot, setSelectedSlot] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Scanner modal state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'camera' | 'manual'>('camera');

  const loadChefOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedDate !== 'all') params.set('date', selectedDate);
      if (selectedSlot !== 'all') params.set('slot', selectedSlot);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await apiFetch<{ orders: OrderRecord[]; counts: Record<string, number> }>(
        `/api/chef/orders?${params.toString()}`
      );
      setOrders(res.orders);
      setCounts(res.counts);
    } catch (err: any) {
      showToast('Failed to load kitchen queue', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedSlot, searchQuery, showToast]);

  useEffect(() => {
    loadChefOrders();
  }, [loadChefOrders]);

  useRealtimeUpdates((evt) => {
    if (evt.startsWith('order.') || evt.startsWith('payment.')) {
      loadChefOrders();
    }
  });

  const handleUpdatePrep = async (
    order: OrderRecord,
    nextStatus: 'preparing' | 'ready_for_collection'
  ) => {
    setUpdatingId(order.id);
    try {
      await apiFetch(`/api/chef/orders/${order.id}/prep-status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadChefOrders();
      showToast(
        nextStatus === 'preparing' ? 'Started Preparing' : 'Ready for Collection!',
        'success',
        `${order.orderNumber} (${order.beneficiaryName})`
      );
    } catch (err: any) {
      showToast('Status update failed', 'error', err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const visibleOrders = useMemo(() => {
    if (statusFilter === 'active') {
      return orders.filter((o) =>
        ['confirmed', 'preparing', 'ready_for_collection'].includes(o.orderStatus)
      );
    }
    return orders.filter((o) => o.orderStatus === statusFilter);
  }, [orders, statusFilter]);

  // Group visible orders by Collection Time Slot for clear kitchen preparation organization
  const ordersGroupedBySlot = useMemo(() => {
    const map = new Map<string, OrderRecord[]>();
    for (const ord of visibleOrders) {
      const key = `${ord.orderDate} • ${ord.collectionSlot}`;
      const list = map.get(key) || [];
      list.push(ord);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [visibleOrders]);

  const activeTotal =
    (counts.confirmed || 0) + (counts.preparing || 0) + (counts.ready_for_collection || 0);

  return (
    <div className="min-h-screen bg-slate-100 pb-24">
      {/* Sticky Tablet/Mobile Optimized KDS Top Bar */}
      <header className="sticky top-0 z-30 bg-brs-navy text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandCrest size="sm" lightText />
            <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-amber-300 text-xs font-semibold">
              <ChefHat className="w-3.5 h-3.5" />
              {user?.chefProfile?.station || 'Kitchen Display'}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Prominent Scan QR Code Button */}
            <button
              type="button"
              onClick={() => {
                setScannerMode('camera');
                setScannerOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs sm:text-sm shadow-md transition active:scale-95"
            >
              <QrCode className="w-5 h-5" />
              <span>Scan QR Code</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScannerMode('manual');
                setScannerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs sm:text-sm transition"
              title="Manual Order ID Verification"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Manual ID</span>
            </button>

            <div className="hidden md:block pl-2 border-l border-white/15 text-right">
              <p className="text-xs font-bold leading-tight">{user?.fullName}</p>
              <RolePill role="chef" />
            </div>

            <button
              onClick={logout}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 space-y-5">
        {/* Status Counter Tabs (Large Touch Targets for Tablets & Phones) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {(
            [
              { id: 'active', label: 'Active Queue', count: activeTotal, color: 'text-brs-navy' },
              {
                id: 'confirmed',
                label: 'Incoming Paid',
                count: counts.confirmed || 0,
                color: 'text-sky-700',
              },
              {
                id: 'preparing',
                label: 'Preparing',
                count: counts.preparing || 0,
                color: 'text-indigo-700',
              },
              {
                id: 'ready_for_collection',
                label: 'Ready for Pickup',
                count: counts.ready_for_collection || 0,
                color: 'text-emerald-700',
              },
              {
                id: 'collected',
                label: 'Collected',
                count: counts.collected || 0,
                color: 'text-slate-600',
              },
            ] as const
          ).map((st) => {
            const active = statusFilter === st.id;
            return (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id)}
                className={`rounded-2xl p-3.5 text-left border transition ${
                  active
                    ? 'bg-white border-brs-navy ring-2 ring-brs-navy/15 shadow-sm'
                    : 'bg-white/80 border-slate-200 hover:bg-white'
                }`}
              >
                <p className="text-xs font-semibold text-slate-500">{st.label}</p>
                <p className={`text-2xl font-extrabold mt-0.5 ${st.color}`}>{st.count}</p>
              </button>
            );
          })}
        </div>

        {/* Filter Bar: Collection Time Slot, Date, and Search */}
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1 px-1">
              <Clock className="w-3.5 h-3.5 text-brs-royal" /> Break Slot:
            </span>
            <button
              onClick={() => setSelectedSlot('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                selectedSlot === 'all'
                  ? 'bg-brs-navy text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Slots
            </button>
            {(settings?.collectionSlots || []).map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSlot(s.label)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  selectedSlot === s.label
                    ? 'bg-brs-navy text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {s.shortLabel || s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl px-3 py-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                value={selectedDate === 'all' ? '' : selectedDate}
                onChange={(e) => setSelectedDate(e.target.value || 'all')}
                className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none"
              />
              {selectedDate !== 'all' && (
                <button
                  onClick={() => setSelectedDate('all')}
                  className="text-[11px] text-brs-royal font-bold ml-1"
                >
                  All
                </button>
              )}
            </div>

            <div className="relative flex-1 sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student or BRS-..."
                className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brs-royal"
              />
            </div>
          </div>
        </div>

        {/* Grouped Kitchen Order Tickets */}
        {loading ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            Loading incoming paid kitchen orders...
          </div>
        ) : ordersGroupedBySlot.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
            <ChefHat className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-900">No Paid Orders in This Queue</h3>
            <p className="text-sm text-slate-500 mt-1">
              Incoming paid orders appear here automatically in real time as parents complete
              checkout.
            </p>
          </div>
        ) : (
          <div className="space-y-7">
            {ordersGroupedBySlot.map(([slotHeading, slotOrders]) => (
              <section key={slotHeading} className="space-y-3">
                <div className="flex items-center justify-between bg-slate-200/80 px-4 py-2 rounded-2xl">
                  <h2 className="text-xs sm:text-sm font-extrabold text-brs-navy uppercase tracking-wide flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600" />
                    {slotHeading}
                  </h2>
                  <span className="text-xs font-bold bg-white text-slate-700 px-2.5 py-0.5 rounded-full">
                    {slotOrders.length} {slotOrders.length === 1 ? 'order' : 'orders'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {slotOrders.map((ord) => (
                    <div
                      key={ord.id}
                      className={`bg-white rounded-3xl border-2 p-5 shadow-sm flex flex-col justify-between gap-4 ${
                        ord.orderStatus === 'ready_for_collection'
                          ? 'border-emerald-400'
                          : ord.orderStatus === 'preparing'
                          ? 'border-indigo-300'
                          : ord.orderStatus === 'confirmed'
                          ? 'border-amber-300'
                          : 'border-slate-200'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Top Ticket Header */}
                        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                          <div>
                            <span className="font-mono font-extrabold text-sm text-brs-navy block">
                              {ord.orderNumber}
                            </span>
                            <h3 className="font-bold text-base text-slate-900 mt-0.5">
                              {ord.beneficiaryName}
                            </h3>
                            <span className="inline-block text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md mt-0.5">
                              {ord.className}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <PaymentStatusBadge status={ord.paymentStatus} />
                            <OrderStatusBadge status={ord.orderStatus} />
                          </div>
                        </div>

                        {/* Allergy Warning */}
                        {ord.allergiesNotes && ord.allergiesNotes.toLowerCase() !== 'none' && (
                          <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs font-bold text-rose-900 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>Allergy Alert: {ord.allergiesNotes}</span>
                          </div>
                        )}

                        {/* Special Instructions */}
                        {ord.specialInstructions && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-950 flex items-start gap-1.5">
                            <MessageSquare className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <strong>Note:</strong> {ord.specialInstructions}
                            </div>
                          </div>
                        )}

                        {/* Itemized Quantities */}
                        <ul className="divide-y divide-slate-100 bg-slate-50 rounded-2xl border border-slate-200/80 px-3.5">
                          {ord.items.map((it) => (
                            <li
                              key={it.id}
                              className="py-2.5 flex items-center justify-between gap-2"
                            >
                              <span className="font-bold text-sm text-slate-900">{it.name}</span>
                              <span className="px-3 py-1 rounded-xl bg-brs-navy text-white font-extrabold text-xs">
                                × {it.quantity}
                              </span>
                            </li>
                          ))}
                        </ul>

                        {ord.collection && (
                          <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>
                              Collected {new Date(ord.collection.collectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {ord.collection.collectedByChefName
                                ? ` • ${ord.collection.collectedByChefName}`
                                : ''}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Large Touch Action Controls */}
                      {ord.orderStatus !== 'collected' && (
                        <div className="pt-2 flex flex-col sm:flex-row gap-2">
                          {ord.orderStatus === 'confirmed' && (
                            <button
                              disabled={updatingId === ord.id}
                              onClick={() => handleUpdatePrep(ord, 'preparing')}
                              className="flex-1 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition"
                            >
                              <Flame className="w-4 h-4" />
                              Mark as Preparing
                            </button>
                          )}

                          {(ord.orderStatus === 'confirmed' || ord.orderStatus === 'preparing') && (
                            <button
                              disabled={updatingId === ord.id}
                              onClick={() => handleUpdatePrep(ord, 'ready_for_collection')}
                              className="flex-1 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition"
                            >
                              <BellRing className="w-4 h-4" />
                              Ready for Collection
                            </button>
                          )}

                          {ord.orderStatus === 'ready_for_collection' && (
                            <button
                              onClick={() => {
                                setScannerMode('camera');
                                setScannerOpen(true);
                              }}
                              className="w-full py-3 px-4 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition"
                            >
                              <QrCode className="w-4 h-4" />
                              Scan Student QR to Hand Over
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* Mobile Floating Quick Scan Button */}
      <div className="sm:hidden fixed bottom-4 inset-x-4 z-30">
        <button
          onClick={() => {
            setScannerMode('camera');
            setScannerOpen(true);
          }}
          className="w-full py-4 rounded-2xl bg-amber-400 text-slate-950 font-extrabold text-base shadow-elevated flex items-center justify-center gap-2.5 border-2 border-brs-navy"
        >
          <QrCode className="w-5 h-5" />
          Scan Student Order QR Code
        </button>
      </div>

      {/* Chef QR Scanner & Manual Verification Modal */}
      <ChefQrScannerModal
        open={scannerOpen}
        initialMode={scannerMode}
        onClose={() => setScannerOpen(false)}
        onCollectionConfirmed={loadChefOrders}
      />
    </div>
  );
};
