import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UtensilsCrossed,
  ShoppingBag,
  ClipboardList,
  BookOpen,
  LogOut,
  Plus,
  Minus,
  QrCode,
  CreditCard,
  Calendar,
  Clock,
  Lock,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { apiFetch, useRealtimeUpdates } from '@/lib/api';
import type { FoodCategory, MenuItem, OrderRecord, ShoppingCart } from '@/types';
import {
  BrandCrest,
  FoodIllustrationPlaceholder,
  OrderProgressStepper,
  OrderStatusBadge,
  PaymentStatusBadge,
  RolePill,
} from '@/components/BrandCrest';
import { QrPassModal } from '@/components/QrPassModal';

export const TeacherDashboard: React.FC = () => {
  const { user, settings, logout, refreshSession } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'menu' | 'cart' | 'orders' | 'profile'>('menu');
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<number | 'all'>('all');
  const [cart, setCart] = useState<ShoppingCart | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [qrOrderId, setQrOrderId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const selectedDate = cart?.orderDate || todayIso;

  const canTeacherOrder = useMemo(() => {
    if (
      user?.teacherProfile?.canPlaceOrdersOverride !== null &&
      user?.teacherProfile?.canPlaceOrdersOverride !== undefined
    ) {
      return user.teacherProfile.canPlaceOrdersOverride;
    }
    return settings?.teacherOrderingEnabled !== false;
  }, [user, settings]);

  const loadData = useCallback(async () => {
    try {
      const [menuRes, cartRes, ordRes] = await Promise.all([
        apiFetch<{ categories: FoodCategory[]; items: MenuItem[] }>(
          `/api/menu?date=${encodeURIComponent(selectedDate)}`
        ),
        apiFetch<{ cart: ShoppingCart }>('/api/cart'),
        apiFetch<{ orders: OrderRecord[] }>('/api/orders'),
      ]);
      setCategories(menuRes.categories);
      setItems(menuRes.items);
      setCart(cartRes.cart);
      setOrders(ordRes.orders);
    } catch {
      // ignore
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useRealtimeUpdates((evt) => {
    if (evt === 'settings.updated') {
      refreshSession();
    }
    loadData();
  });

  const handleAdd = async (item: MenuItem) => {
    if (!canTeacherOrder) {
      showToast('Teacher ordering is currently disabled by Administration', 'info');
      return;
    }
    try {
      const res = await apiFetch<{ cart: ShoppingCart }>('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ menuItemId: item.id, quantity: 1 }),
      });
      setCart(res.cart);
      showToast(`Added ${item.name}`, 'success');
    } catch (err: any) {
      showToast('Failed to add item', 'error', err.message);
    }
  };

  const handleQty = async (menuItemId: number, qty: number) => {
    const res = await apiFetch<{ cart: ShoppingCart }>(`/api/cart/items/${menuItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity: qty }),
    });
    setCart(res.cart);
  };

  const handleUpdateCartMeta = async (patch: Record<string, unknown>) => {
    const res = await apiFetch<{ cart: ShoppingCart }>('/api/cart/meta', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    setCart(res.cart);
  };

  const handleCheckout = async () => {
    if (!cart || cart.items.length === 0) return;
    setSubmitting(true);
    try {
      const ordRes = await apiFetch<{ order: OrderRecord }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          orderDate: cart.orderDate || todayIso,
          collectionSlot:
            cart.collectionSlot ||
            settings?.collectionSlots?.[0]?.label ||
            'Morning Recess (09:45 AM – 10:15 AM)',
          specialInstructions: cart.specialInstructions,
          idempotencyKey: `tch-ord-${user!.id}-${Date.now()}`,
        }),
      });

      const payRes = await apiFetch<any>('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderId: ordRes.order.id,
          paymentMethodType: 'visa_sandbox',
          sandboxOutcome: 'succeeded',
          idempotencyKey: `tch-pay-${ordRes.order.id}-${Date.now()}`,
        }),
      });

      if (payRes.mode === 'stripe' && payRes.checkoutUrl) {
        window.location.href = payRes.checkoutUrl;
        return;
      }

      await loadData();
      setTab('orders');
      setQrOrderId(ordRes.order.id);
      showToast('Faculty Meal Order Confirmed!', 'success', `Order ${ordRes.order.orderNumber}`);
    } catch (err: any) {
      showToast('Checkout failed', 'error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredItems = useMemo(
    () => items.filter((i) => (selectedCat === 'all' ? true : i.categoryId === selectedCat)),
    [items, selectedCat]
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-14">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <BrandCrest size="sm" />

          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setTab('menu')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'menu' ? 'bg-brs-navy text-white' : 'text-slate-600'
              }`}
            >
              <UtensilsCrossed className="w-3.5 h-3.5" /> Menu
            </button>
            {canTeacherOrder && (
              <button
                onClick={() => setTab('cart')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                  tab === 'cart' ? 'bg-brs-navy text-white' : 'text-slate-600'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" /> Cart
                {cart?.itemCount ? ` (${cart.itemCount})` : ''}
              </button>
            )}
            <button
              onClick={() => setTab('orders')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'orders' ? 'bg-brs-navy text-white' : 'text-slate-600'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" /> My Orders ({orders.length})
            </button>
            <button
              onClick={() => setTab('profile')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'profile' ? 'bg-brs-navy text-white' : 'text-slate-600'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Staff Profile
            </button>
          </nav>

          <div className="flex items-center gap-2.5">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-slate-900">{user?.fullName}</p>
              <RolePill role="teacher" />
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {!canTeacherOrder && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-xs sm:text-sm text-amber-950">
            <Lock className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <strong>Menu View-Only Mode:</strong> Teacher personal ordering is currently disabled
              by school administration. You can still browse the live canteen menu and view your
              previous orders.
            </div>
          </div>
        )}

        {tab === 'menu' && (
          <div className="space-y-5">
            <div className="bg-gradient-to-r from-brs-navy to-violet-950 rounded-3xl p-5 sm:p-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs uppercase tracking-wider text-amber-300 font-semibold">
                  Bright Riders Faculty Portal
                </span>
                <h1 className="text-xl font-bold mt-0.5">School Canteen Menu & Schedule</h1>
                <p className="text-xs text-slate-300">
                  {user?.teacherProfile?.department} • Staff ID: {user?.teacherProfile?.staffCode}
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <div className="bg-white/10 border border-white/15 rounded-2xl px-3.5 py-2">
                  <label className="text-[11px] text-amber-200 font-semibold flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Date
                  </label>
                  <input
                    type="date"
                    min={todayIso}
                    value={selectedDate}
                    onChange={(e) => handleUpdateCartMeta({ orderDate: e.target.value })}
                    className="bg-transparent text-white text-xs font-semibold focus:outline-none [color-scheme:dark]"
                  />
                </div>
                <div className="bg-white/10 border border-white/15 rounded-2xl px-3.5 py-2">
                  <label className="text-[11px] text-amber-200 font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Collection Break
                  </label>
                  <select
                    value={
                      cart?.collectionSlot ||
                      settings?.collectionSlots?.[0]?.label ||
                      'Morning Recess (09:45 AM – 10:15 AM)'
                    }
                    onChange={(e) => handleUpdateCartMeta({ collectionSlot: e.target.value })}
                    className="bg-transparent text-white text-xs font-semibold focus:outline-none [&>option]:text-slate-900"
                  >
                    {(settings?.collectionSlots || []).map((s) => (
                      <option key={s.id} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {categories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedCat('all')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold ${
                    selectedCat === 'all'
                      ? 'bg-brs-navy text-white'
                      : 'bg-white border border-slate-200 text-slate-600'
                  }`}
                >
                  All Items
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCat(c.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                      selectedCat === c.id
                        ? 'bg-brs-navy text-white'
                        : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {items.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center max-w-lg mx-auto">
                <Sparkles className="w-9 h-9 text-amber-500 mx-auto mb-3" />
                <h3 className="font-bold text-slate-900">Official Canteen Menu Pending Publication</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Menu items will appear here as soon as they are published by the Canteen
                  Administrator.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredItems.map((it) => (
                  <div
                    key={it.id}
                    className="bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col justify-between shadow-sm"
                  >
                    <div>
                      <div className="h-40 bg-slate-100 relative">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FoodIllustrationPlaceholder name={it.name} category={it.categoryName} />
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-slate-900 text-sm">{it.name}</h3>
                          <span className="font-bold text-xs bg-amber-50 border border-amber-200 text-brs-navy px-2.5 py-1 rounded-lg">
                            {it.formattedPrice}
                          </span>
                        </div>
                        {it.description && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                            {it.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {canTeacherOrder && (
                      <div className="px-4 pb-4">
                        <button
                          disabled={!it.availableOnDate}
                          onClick={() => handleAdd(it)}
                          className="w-full py-2.5 rounded-xl bg-brs-navy hover:bg-brs-royal disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {it.availableOnDate ? 'Add to Staff Order' : 'Unavailable on Date'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'cart' && canTeacherOrder && (
          <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-5">
            <h2 className="text-lg font-bold text-slate-900">Faculty Meal Checkout</h2>
            {!cart || cart.items.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">Your cart is empty.</p>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {cart.items.map((ci) => (
                    <div
                      key={ci.cartItemId}
                      className="py-3 flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="font-semibold text-slate-900 flex-1">{ci.name}</span>
                      <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1">
                        <button
                          onClick={() => handleQty(ci.menuItemId, ci.quantity - 1)}
                          className="w-7 h-7 rounded-lg bg-white flex items-center justify-center"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold">{ci.quantity}</span>
                        <button
                          onClick={() => handleQty(ci.menuItemId, ci.quantity + 1)}
                          className="w-7 h-7 rounded-lg bg-white flex items-center justify-center"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-bold text-brs-navy w-24 text-right">
                        {ci.formattedLineTotal}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                  <span className="font-bold text-slate-700">Total (AED)</span>
                  <span className="text-xl font-extrabold text-brs-navy">
                    {cart.formattedTotal}
                  </span>
                </div>

                <button
                  disabled={submitting}
                  onClick={handleCheckout}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  {submitting
                    ? 'Processing Payment...'
                    : `Complete Payment (${cart.formattedTotal})`}
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'orders' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <h2 className="text-xl font-bold text-slate-900">My Canteen Orders & QR Passes</h2>
            {orders.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                No faculty orders placed yet.
              </div>
            ) : (
              orders.map((ord) => (
                <div
                  key={ord.id}
                  className="bg-white rounded-3xl border border-slate-200 p-5 space-y-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-brs-navy">
                        {ord.orderNumber}
                      </span>
                      <OrderStatusBadge status={ord.orderStatus} />
                      <PaymentStatusBadge status={ord.paymentStatus} />
                    </div>
                    <span className="font-extrabold text-brs-navy">{ord.formattedTotal}</span>
                  </div>

                  <p className="text-xs text-slate-600">
                    Collection: <strong>{ord.orderDate}</strong> •{' '}
                    <strong>{ord.collectionSlot}</strong>
                  </p>

                  <OrderProgressStepper status={ord.orderStatus} />

                  <div className="text-xs text-slate-700 bg-slate-50 rounded-xl p-3">
                    {ord.items.map((i) => `${i.quantity}× ${i.name}`).join(' • ')}
                  </div>

                  <div className="flex gap-2.5">
                    {ord.hasQrCode && ord.orderStatus !== 'cancelled' && (
                      <button
                        onClick={() => setQrOrderId(ord.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brs-navy text-white text-xs font-semibold"
                      >
                        <QrCode className="w-4 h-4" /> Show Order QR Pass
                      </button>
                    )}
                    {['awaiting_payment', 'confirmed'].includes(ord.orderStatus) && (
                      <button
                        onClick={async () => {
                          await apiFetch(`/api/orders/${ord.id}/cancel`, { method: 'POST' });
                          loadData();
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 text-xs font-semibold"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'profile' && (
          <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3 text-sm">
            <h2 className="text-lg font-bold text-slate-900">Faculty Profile</h2>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <span className="text-xs text-slate-500 block">Full Name</span>
                <span className="font-semibold">{user?.fullName}</span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Staff ID</span>
                <span className="font-mono font-semibold">
                  {user?.teacherProfile?.staffCode || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Department</span>
                <span className="font-semibold">
                  {user?.teacherProfile?.department || 'Academic Faculty'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Homeroom</span>
                <span className="font-semibold">
                  {user?.teacherProfile?.homeroomClass || 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      <QrPassModal orderId={qrOrderId} onClose={() => setQrOrderId(null)} />
    </div>
  );
};
