import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UtensilsCrossed,
  ShoppingBag,
  ClipboardList,
  CreditCard,
  UserCircle2,
  LogOut,
  Search,
  Plus,
  Minus,
  Trash2,
  QrCode,
  Calendar,
  Clock,
  Leaf,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  XCircle,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { apiFetch, useRealtimeUpdates } from '@/lib/api';
import type {
  FoodCategory,
  MenuItem,
  OrderRecord,
  PaymentTransactionRecord,
  ShoppingCart,
} from '@/types';
import {
  BrandCrest,
  FoodIllustrationPlaceholder,
  OrderProgressStepper,
  OrderStatusBadge,
  PaymentStatusBadge,
  RolePill,
} from '@/components/BrandCrest';
import { QrPassModal } from '@/components/QrPassModal';

type ParentTab = 'menu' | 'cart' | 'orders' | 'payments' | 'family';

export const ParentDashboard: React.FC = () => {
  const { user, settings, logout, refreshSession } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<ParentTab>('menu');
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);

  const [cart, setCart] = useState<ShoppingCart | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransactionRecord[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);

  // Checkout state
  const [paymentMethod, setPaymentMethod] = useState<
    'visa_sandbox' | 'uae_debit_sandbox' | 'apple_pay_sandbox'
  >('visa_sandbox');
  const [sandboxOutcome, setSandboxOutcome] = useState<'succeeded' | 'failed' | 'pending'>(
    'succeeded'
  );
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    order: OrderRecord;
    transactionRef: string;
  } | null>(null);

  // Retry payment on awaiting_payment / failed order
  const [retryingOrderId, setRetryingOrderId] = useState<number | null>(null);

  // QR Modal
  const [qrOrderId, setQrOrderId] = useState<number | null>(null);

  // Family & Profile Form
  const [profileFullName, setProfileFullName] = useState(user?.fullName || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profilePhone, setProfilePhone] = useState(user?.phone || '');
  const [profileAddress, setProfileAddress] = useState(user?.parentProfile?.address || '');
  const [profileEmergency, setProfileEmergency] = useState(
    user?.parentProfile?.emergencyContact || ''
  );

  // Link Child Form
  const [linkStudentCode, setLinkStudentCode] = useState('');
  const [linkStudentUsername, setLinkStudentUsername] = useState('');
  const [linkRelationship, setLinkRelationship] = useState('Mother');

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const selectedDate = cart?.orderDate || todayIso;

  const loadCart = useCallback(async () => {
    try {
      const res = await apiFetch<{ cart: ShoppingCart }>('/api/cart');
      setCart(res.cart);
    } catch {
      // ignore
    }
  }, []);

  const loadMenu = useCallback(async (dateForMenu: string) => {
    setLoadingMenu(true);
    try {
      const res = await apiFetch<{ categories: FoodCategory[]; items: MenuItem[] }>(
        `/api/menu?date=${encodeURIComponent(dateForMenu)}`
      );
      setCategories(res.categories);
      setMenuItems(res.items);
    } catch (err: any) {
      showToast('Failed to load canteen menu', 'error', err.message);
    } finally {
      setLoadingMenu(false);
    }
  }, [showToast]);

  const loadOrdersAndPayments = useCallback(async () => {
    try {
      const [ordRes, payRes] = await Promise.all([
        apiFetch<{ orders: OrderRecord[] }>('/api/orders'),
        apiFetch<{ transactions: PaymentTransactionRecord[] }>('/api/payments'),
      ]);
      setOrders(ordRes.orders);
      setTransactions(payRes.transactions);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCart();
    loadOrdersAndPayments();
  }, [loadCart, loadOrdersAndPayments]);

  useEffect(() => {
    loadMenu(selectedDate);
  }, [selectedDate, loadMenu]);

  useRealtimeUpdates((evt) => {
    if (evt.startsWith('order.') || evt.startsWith('payment.')) {
      loadOrdersAndPayments();
    } else if (evt === 'menu.updated') {
      loadMenu(selectedDate);
      loadCart();
    }
  });

  const children = user?.children || [];
  const selectedChild =
    children.find((c) => c.id === cart?.beneficiaryUserId) || children[0] || null;

  const updateCartMeta = async (patch: Record<string, unknown>) => {
    try {
      const res = await apiFetch<{ cart: ShoppingCart }>('/api/cart/meta', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setCart(res.cart);
    } catch (err: any) {
      showToast('Unable to update order preferences', 'error', err.message);
    }
  };

  const handleAddToCart = async (item: MenuItem) => {
    try {
      const res = await apiFetch<{ cart: ShoppingCart }>('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ menuItemId: item.id, quantity: 1 }),
      });
      setCart(res.cart);
      showToast(`Added ${item.name}`, 'success', `${item.formattedPrice} added to order.`);
    } catch (err: any) {
      showToast('Could not add item', 'error', err.message);
    }
  };

  const handleQuantityChange = async (menuItemId: number, nextQty: number) => {
    try {
      const res = await apiFetch<{ cart: ShoppingCart }>(`/api/cart/items/${menuItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: nextQty }),
      });
      setCart(res.cart);
    } catch (err: any) {
      showToast('Could not update quantity', 'error', err.message);
    }
  };

  const handlePlaceOrderAndPay = async () => {
    if (!selectedChild) {
      showToast('Link or select a child first', 'error', 'Go to Family & Profile to link your child.');
      setActiveTab('family');
      return;
    }
    if (!cart || cart.items.length === 0) {
      showToast('Your cart is empty', 'error');
      return;
    }

    setProcessingCheckout(true);
    setConfirmedOrder(null);
    try {
      // Step 1: Create order from persistent cart
      const orderIdempotency = `ord-${user!.id}-${Date.now()}`;
      const ordRes = await apiFetch<{ order: OrderRecord }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          beneficiaryUserId: selectedChild.id,
          orderDate: cart.orderDate || todayIso,
          collectionSlot:
            cart.collectionSlot ||
            settings?.collectionSlots?.[0]?.label ||
            'Morning Recess (09:45 AM – 10:15 AM)',
          specialInstructions: cart.specialInstructions,
          idempotencyKey: orderIdempotency,
        }),
      });

      await loadCart();

      // Step 2: Process Digital Payment
      const payIdempotency = `pay-${ordRes.order.id}-${Date.now()}`;
      const payRes = await apiFetch<any>('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderId: ordRes.order.id,
          paymentMethodType: paymentMethod,
          sandboxOutcome,
          idempotencyKey: payIdempotency,
        }),
      });

      if (payRes.mode === 'stripe' && payRes.checkoutUrl) {
        window.location.href = payRes.checkoutUrl;
        return;
      }

      await loadOrdersAndPayments();

      if (payRes.status === 'succeeded') {
        setConfirmedOrder({
          order: payRes.order,
          transactionRef: payRes.transactionRef,
        });
        showToast(
          'Payment Confirmed & QR Code Ready!',
          'success',
          `Order ${payRes.order.orderNumber} for ${selectedChild.fullName} is confirmed.`
        );
      } else if (payRes.status === 'pending') {
        showToast(
          'Payment Pending Authorization',
          'info',
          `Transaction ${payRes.transactionRef} is pending. Order cannot be collected until completed.`
        );
        setActiveTab('orders');
      }
    } catch (err: any) {
      await loadOrdersAndPayments();
      showToast('Payment / Checkout Notice', 'error', err.message);
      setActiveTab('orders');
    } finally {
      setProcessingCheckout(false);
    }
  };

  const handleRetryOrderPayment = async (orderId: number) => {
    setRetryingOrderId(orderId);
    try {
      const payRes = await apiFetch<any>('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          paymentMethodType: 'visa_sandbox',
          sandboxOutcome: 'succeeded',
          idempotencyKey: `retry-${orderId}-${Date.now()}`,
        }),
      });
      if (payRes.mode === 'stripe' && payRes.checkoutUrl) {
        window.location.href = payRes.checkoutUrl;
        return;
      }
      await loadOrdersAndPayments();
      showToast('Payment Completed!', 'success', `Order ${payRes.order.orderNumber} is now confirmed.`);
    } catch (err: any) {
      showToast('Retry payment failed', 'error', err.message);
    } finally {
      setRetryingOrderId(null);
    }
  };

  const handleResolvePendingTxn = async (txnId: number, resolution: 'succeeded' | 'failed') => {
    try {
      await apiFetch(`/api/payments/${txnId}/resolve-pending`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      await loadOrdersAndPayments();
      showToast(
        resolution === 'succeeded' ? 'Pending Payment Authorized!' : 'Pending Payment Cancelled',
        resolution === 'succeeded' ? 'success' : 'info'
      );
    } catch (err: any) {
      showToast('Action failed', 'error', err.message);
    }
  };

  const handleCancelOrder = async (order: OrderRecord) => {
    if (!window.confirm(`Cancel order ${order.orderNumber} for ${order.beneficiaryName}?`)) return;
    try {
      await apiFetch(`/api/orders/${order.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled by parent prior to preparation' }),
      });
      await loadOrdersAndPayments();
      showToast(
        'Order Cancelled',
        'info',
        order.paymentStatus === 'paid'
          ? 'Order cancelled and digital refund recorded.'
          : 'Order cancelled.'
      );
    } catch (err: any) {
      showToast('Cannot cancel order', 'error', err.message);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName: profileFullName,
          email: profileEmail,
          phone: profilePhone,
          address: profileAddress,
          emergencyContact: profileEmergency,
        }),
      });
      await refreshSession();
      showToast('Profile saved', 'success');
    } catch (err: any) {
      showToast('Failed to update profile', 'error', err.message);
    }
  };

  const handleLinkChild = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/link-child', {
        method: 'POST',
        body: JSON.stringify({
          studentCode: linkStudentCode,
          studentUsername: linkStudentUsername,
          relationship: linkRelationship,
        }),
      });
      setLinkStudentCode('');
      setLinkStudentUsername('');
      await refreshSession();
      await loadCart();
      showToast('Child Linked!', 'success', res.message);
    } catch (err: any) {
      showToast('Could not link child', 'error', err.message);
    }
  };

  const handleUpdateChildAllergy = async (studentId: number, currentVal: string | null) => {
    const next = window.prompt(
      'Update allergy or dietary notes for kitchen staff (leave empty or "None" if none):',
      currentVal || ''
    );
    if (next === null) return;
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          childAllergies: { studentId, allergiesNotes: next },
        }),
      });
      await refreshSession();
      showToast('Dietary notes updated', 'success');
    } catch (err: any) {
      showToast('Update failed', 'error', err.message);
    }
  };

  const filteredMenu = useMemo(() => {
    return menuItems.filter((item) => {
      if (selectedCategoryId !== 'all' && item.categoryId !== selectedCategoryId) return false;
      if (vegOnly && !item.isVegetarian) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          item.name.toLowerCase().includes(q) ||
          (item.description || '').toLowerCase().includes(q) ||
          item.categoryName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [menuItems, selectedCategoryId, vegOnly, searchQuery]);

  const cartQtyByItemId = useMemo(() => {
    const map = new Map<number, number>();
    cart?.items.forEach((ci) => map.set(ci.menuItemId, ci.quantity));
    return map;
  }, [cart]);

  const activeOrders = useMemo(
    () => orders.filter((o) => !['collected', 'cancelled'].includes(o.orderStatus)),
    [orders]
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-10">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <BrandCrest size="sm" />

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(
              [
                { id: 'menu', label: 'Canteen Menu', icon: UtensilsCrossed },
                {
                  id: 'cart',
                  label: `Order Cart${cart?.itemCount ? ` (${cart.itemCount})` : ''}`,
                  icon: ShoppingBag,
                },
                {
                  id: 'orders',
                  label: `Orders${activeOrders.length ? ` (${activeOrders.length})` : ''}`,
                  icon: ClipboardList,
                },
                { id: 'payments', label: 'Payments', icon: CreditCard },
                { id: 'family', label: 'Family & Profile', icon: UserCircle2 },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setConfirmedOrder(null);
                    setActiveTab(item.id);
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                    active
                      ? 'bg-brs-navy text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-slate-900 leading-tight">{user?.fullName}</p>
              <RolePill role="parent" />
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {/* Child & Schedule Bar (shown on Menu & Cart) */}
        {(activeTab === 'menu' || activeTab === 'cart') && (
          <div className="bg-gradient-to-r from-brs-navy via-brs-royal to-brs-blue rounded-3xl p-5 sm:p-6 text-white shadow-soft mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-amber-300 font-semibold mb-1.5">
                  Ordering Meal For Child
                </p>
                {children.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {children.map((child) => {
                      const isSel = selectedChild?.id === child.id;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => updateCartMeta({ beneficiaryUserId: child.id })}
                          className={`px-3.5 py-2 rounded-2xl text-left border transition flex items-center gap-2.5 ${
                            isSel
                              ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold shadow-sm'
                              : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                          }`}
                        >
                          <div>
                            <div className="text-sm leading-tight">{child.fullName}</div>
                            <div
                              className={`text-[11px] ${
                                isSel ? 'text-slate-800' : 'text-slate-300'
                              }`}
                            >
                              {child.className} • {child.studentCode}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 bg-white/10 border border-white/20 rounded-2xl px-4 py-2.5 text-sm">
                    <AlertCircle className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>No student linked yet.</span>
                    <button
                      onClick={() => setActiveTab('family')}
                      className="underline font-semibold text-amber-300"
                    >
                      Link your child now →
                    </button>
                  </div>
                )}
              </div>

              {/* Ordering Date & Break Slot Quick Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:min-w-[420px]">
                <div className="bg-white/10 border border-white/15 rounded-2xl px-3.5 py-2">
                  <label className="text-[11px] text-amber-200 font-semibold flex items-center gap-1 mb-0.5">
                    <Calendar className="w-3.5 h-3.5" /> Ordering Date
                  </label>
                  <input
                    type="date"
                    min={todayIso}
                    value={selectedDate}
                    onChange={(e) => updateCartMeta({ orderDate: e.target.value })}
                    className="w-full bg-transparent text-white text-xs sm:text-sm font-semibold focus:outline-none [color-scheme:dark]"
                  />
                </div>

                <div className="bg-white/10 border border-white/15 rounded-2xl px-3.5 py-2">
                  <label className="text-[11px] text-amber-200 font-semibold flex items-center gap-1 mb-0.5">
                    <Clock className="w-3.5 h-3.5" /> Collection Break
                  </label>
                  <select
                    value={
                      cart?.collectionSlot ||
                      settings?.collectionSlots?.[0]?.label ||
                      'Morning Recess (09:45 AM – 10:15 AM)'
                    }
                    onChange={(e) => updateCartMeta({ collectionSlot: e.target.value })}
                    className="w-full bg-transparent text-white text-xs sm:text-sm font-semibold focus:outline-none [&>option]:text-slate-900"
                  >
                    {(settings?.collectionSlots || []).map((slot) => (
                      <option key={slot.id} value={slot.label}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: CANTEEN MENU */}
        {activeTab === 'menu' && (
          <div className="space-y-6">
            {/* Search & Category Controls */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Bright Riders canteen menu..."
                  className="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                />
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setVegOnly((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold border transition ${
                    vegOnly
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Leaf className="w-3.5 h-3.5" />
                  Vegetarian Only
                </button>

                {cart && cart.itemCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('cart')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs sm:text-sm shadow-sm transition"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    View Cart ({cart.itemCount}) • {cart.formattedTotal}
                  </button>
                )}
              </div>
            </div>

            {/* Category Tabs */}
            {categories.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedCategoryId('all')}
                  className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                    selectedCategoryId === 'all'
                      ? 'bg-brs-navy text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  All Categories ({menuItems.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                      selectedCategoryId === cat.id
                        ? 'bg-brs-navy text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}

            {/* Menu Grid or Awaiting Official Menu State */}
            {loadingMenu ? (
              <div className="py-16 text-center text-slate-500 text-sm">
                Loading Bright Riders School canteen menu...
              </div>
            ) : menuItems.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center max-w-xl mx-auto shadow-soft">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto mb-4">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Official Bright Riders School Menu Pending Publication
                </h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  The school canteen administrator has not published menu items yet. Once the
                  official Bright Riders School menu is uploaded or added in the Administrator
                  Dashboard, all exact food items, categories, and AED prices will appear here
                  automatically.
                </p>
              </div>
            ) : filteredMenu.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                No food items matched your current search or filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filteredMenu.map((item) => {
                  const qtyInCart = cartQtyByItemId.get(item.id) || 0;
                  const canOrder = item.availableOnDate;

                  return (
                    <div
                      key={item.id}
                      className={`bg-white rounded-3xl border overflow-hidden flex flex-col transition shadow-sm hover:shadow-soft ${
                        canOrder ? 'border-slate-200/90' : 'border-slate-200 opacity-65'
                      }`}
                    >
                      <div className="h-44 relative bg-slate-100 overflow-hidden">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FoodIllustrationPlaceholder
                            name={item.name}
                            category={item.categoryName}
                          />
                        )}
                        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                          <span className="px-2.5 py-1 rounded-full bg-white/95 backdrop-blur-sm text-[11px] font-semibold text-slate-700 shadow-sm">
                            {item.categoryName}
                          </span>
                          {item.isVegetarian && (
                            <span className="px-2 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1 shadow-sm">
                              <Leaf className="w-3 h-3" /> Veg
                            </span>
                          )}
                        </div>
                        {!canOrder && (
                          <div className="absolute inset-0 bg-slate-900/45 flex items-center justify-center p-3 text-center">
                            <span className="px-3 py-1.5 rounded-xl bg-white text-slate-900 font-bold text-xs shadow">
                              {item.scheduleNote || 'Unavailable on selected date'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-4 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-bold text-slate-900 text-base leading-snug">
                              {item.name}
                            </h3>
                            <span className="font-extrabold text-brs-navy text-sm whitespace-nowrap bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-xl">
                              {item.formattedPrice}
                            </span>
                          </div>
                          {item.description && (
                            <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                              {item.description}
                            </p>
                          )}
                          {(item.allergens || item.calories) && (
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                              {item.calories && <span>{item.calories} kcal</span>}
                              {item.allergens && (
                                <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md">
                                  Allergens: {item.allergens}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100">
                          {qtyInCart > 0 ? (
                            <div className="flex items-center justify-between bg-slate-100 rounded-2xl p-1">
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(item.id, qtyInCart - 1)}
                                className="w-9 h-9 rounded-xl bg-white hover:bg-slate-50 text-slate-800 flex items-center justify-center shadow-sm"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="font-bold text-sm text-brs-navy">
                                {qtyInCart} in cart
                              </span>
                              <button
                                type="button"
                                disabled={!canOrder}
                                onClick={() => handleQuantityChange(item.id, qtyInCart + 1)}
                                className="w-9 h-9 rounded-xl bg-brs-navy hover:bg-brs-royal text-white flex items-center justify-center shadow-sm disabled:opacity-40"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!canOrder}
                              onClick={() => handleAddToCart(item)}
                              className="w-full py-2.5 rounded-2xl bg-brs-navy hover:bg-brs-royal disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-1.5"
                            >
                              <Plus className="w-4 h-4" />
                              Add to Order
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SHOPPING CART & DIGITAL CHECKOUT */}
        {activeTab === 'cart' && (
          <div className="max-w-5xl mx-auto">
            {confirmedOrder ? (
              <div className="bg-white rounded-3xl border border-emerald-200 p-7 sm:p-9 shadow-soft text-center max-w-xl mx-auto">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Digital Payment Confirmed
                </span>
                <h2 className="text-2xl font-extrabold text-slate-900 mt-1">
                  Order Placed for {confirmedOrder.order.beneficiaryName}!
                </h2>
                <p className="text-sm text-slate-600 mt-2">
                  Order <span className="font-mono font-bold">{confirmedOrder.order.orderNumber}</span>{' '}
                  • Transaction{' '}
                  <span className="font-mono font-semibold">{confirmedOrder.transactionRef}</span>
                </p>

                <div className="mt-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-sm space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Student & Class:</span>
                    <span className="font-semibold">
                      {confirmedOrder.order.beneficiaryName} ({confirmedOrder.order.className})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Collection Date:</span>
                    <span className="font-semibold">{confirmedOrder.order.orderDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Break Slot:</span>
                    <span className="font-semibold">{confirmedOrder.order.collectionSlot}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200">
                    <span className="font-semibold">Total Paid:</span>
                    <span className="font-extrabold text-brs-navy">
                      {confirmedOrder.order.formattedTotal}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setQrOrderId(confirmedOrder.order.id)}
                    className="flex-1 py-3 px-5 rounded-2xl bg-brs-navy hover:bg-brs-royal text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
                  >
                    <QrCode className="w-4 h-4" />
                    Open Child's QR Code Pass
                  </button>
                  <button
                    onClick={() => {
                      setConfirmedOrder(null);
                      setActiveTab('orders');
                    }}
                    className="py-3 px-5 rounded-2xl border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold text-sm"
                  >
                    Track Order Live
                  </button>
                </div>
              </div>
            ) : !cart || cart.items.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center max-w-lg mx-auto">
                <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-slate-900">Your Order Cart is Empty</h3>
                <p className="text-sm text-slate-500 mt-1 mb-5">
                  Browse the Bright Riders School canteen menu to add nutritious meals and snacks for
                  your child.
                </p>
                <button
                  onClick={() => setActiveTab('menu')}
                  className="px-6 py-2.5 rounded-2xl bg-brs-navy hover:bg-brs-royal text-white font-semibold text-sm transition"
                >
                  Browse Canteen Menu
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left: Cart Items & Special Instructions */}
                <div className="lg:col-span-3 space-y-4">
                  <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-slate-900">
                        Review Selected Items ({cart.itemCount})
                      </h2>
                      <button
                        onClick={async () => {
                          await apiFetch('/api/cart', { method: 'DELETE' });
                          loadCart();
                        }}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Clear Cart
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {cart.items.map((ci) => (
                        <div
                          key={ci.cartItemId}
                          className="py-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-slate-900 text-sm truncate">{ci.name}</p>
                            <p className="text-xs text-slate-500">
                              AED {ci.unitPriceAed.toFixed(2)} each • {ci.categoryName}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1">
                            <button
                              onClick={() => handleQuantityChange(ci.menuItemId, ci.quantity - 1)}
                              className="w-7 h-7 rounded-lg bg-white text-slate-700 flex items-center justify-center shadow-sm"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-6 text-center text-xs font-bold">{ci.quantity}</span>
                            <button
                              onClick={() => handleQuantityChange(ci.menuItemId, ci.quantity + 1)}
                              className="w-7 h-7 rounded-lg bg-white text-slate-700 flex items-center justify-center shadow-sm"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="text-right font-bold text-sm text-brs-navy w-24">
                            {ci.formattedLineTotal}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 pt-4 border-t border-slate-100">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Special Kitchen Instructions (Optional)
                      </label>
                      <textarea
                        rows={2}
                        value={cart.specialInstructions}
                        onChange={(e) =>
                          setCart((prev) =>
                            prev ? { ...prev, specialInstructions: e.target.value } : prev
                          )
                        }
                        onBlur={(e) => updateCartMeta({ specialInstructions: e.target.value })}
                        placeholder="e.g. No mayonnaise, cut sandwich in halves, warm gently..."
                        className="w-full rounded-2xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                      />
                    </div>
                  </div>
                </div>

                {/* Right: Checkout & Digital Payment Box */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4 sticky top-24">
                    <h3 className="text-lg font-bold text-slate-900">Digital Checkout (AED)</h3>

                    {/* Summary */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-xs space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Child:</span>
                        <span className="font-bold text-slate-900">
                          {selectedChild
                            ? `${selectedChild.fullName} (${selectedChild.className})`
                            : 'Select child above'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Ordering Date:</span>
                        <span className="font-semibold text-slate-900">{selectedDate}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Collection Time:</span>
                        <span className="font-semibold text-slate-900 text-right">
                          {cart.collectionSlot}
                        </span>
                      </div>
                      <div className="pt-2.5 border-t border-slate-200 flex justify-between items-baseline text-sm">
                        <span className="font-bold text-slate-800">Total Amount</span>
                        <span className="text-lg font-extrabold text-brs-navy">
                          {cart.formattedTotal}
                        </span>
                      </div>
                    </div>

                    {/* Payment Provider Section */}
                    {settings?.paymentMode === 'stripe' ? (
                      <div className="bg-sky-50 border border-sky-200 rounded-2xl p-3.5 text-xs text-sky-950">
                        <p className="font-bold">Stripe Secure UAE Checkout (AED)</p>
                        <p className="mt-0.5">
                          You will be redirected to Stripe's PCI-compliant checkout page to complete
                          your payment in UAE Dirhams.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-950 flex items-start gap-2.5">
                          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">
                              UAE AED Sandbox Payment Environment (Demo Mode)
                            </p>
                            <p className="mt-0.5 text-amber-900/90">
                              Clearly labelled test payment gateway. No real bank charge occurs and
                              no card numbers or CVVs are stored. Ready for live Stripe AED keys via{' '}
                              <code className="font-mono">.env</code>.
                            </p>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Payment Instrument
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as any)}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium bg-white"
                          >
                            <option value="visa_sandbox">
                              UAE Sandbox Card •••• 4242 (Test Visa/Mastercard)
                            </option>
                            <option value="apple_pay_sandbox">
                              Digital Wallet Sandbox (Apple Pay / Google Pay Test)
                            </option>
                            <option value="uae_debit_sandbox">
                              UAE Direct Debit Sandbox (Test Bank Auth)
                            </option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Sandbox Authorization Outcome (For Testing)
                          </label>
                          <select
                            value={sandboxOutcome}
                            onChange={(e) => setSandboxOutcome(e.target.value as any)}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium bg-white"
                          >
                            <option value="succeeded">Authorize Payment (Success → Issue QR)</option>
                            <option value="failed">Simulate Declined Payment (Failed)</option>
                            <option value="pending">Simulate Pending Bank Confirmation</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={processingCheckout || !selectedChild}
                      onClick={handlePlaceOrderAndPay}
                      className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                    >
                      <CreditCard className="w-4 h-4" />
                      {processingCheckout
                        ? 'Processing Digital Payment...'
                        : `Pay ${cart.formattedTotal} & Confirm Order`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACTIVE & PAST ORDERS */}
        {activeTab === 'orders' && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Child Orders & Live Tracking</h2>
                <p className="text-xs text-slate-500">
                  Real-time updates as the Bright Riders kitchen prepares and distributes your
                  child's meal
                </p>
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                No canteen orders placed yet.
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-bold text-sm text-brs-navy">
                            {ord.orderNumber}
                          </span>
                          <OrderStatusBadge status={ord.orderStatus} />
                          <PaymentStatusBadge status={ord.paymentStatus} />
                        </div>
                        <p className="text-sm font-semibold text-slate-800 mt-1">
                          For {ord.beneficiaryName}{' '}
                          <span className="text-slate-500 font-normal">({ord.className})</span> •{' '}
                          {ord.orderDate} • {ord.collectionSlot}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-lg font-extrabold text-brs-navy">{ord.formattedTotal}</p>
                        <p className="text-[11px] text-slate-400">
                          Ordered {new Date(ord.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Live Progress Stepper */}
                    <OrderProgressStepper status={ord.orderStatus} />

                    {/* Items */}
                    <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100 text-xs space-y-1.5">
                      {ord.items.map((it) => (
                        <div key={it.id} className="flex justify-between text-slate-700">
                          <span>
                            <strong className="text-slate-900">{it.quantity}×</strong> {it.name}
                          </span>
                          <span className="font-semibold">{it.formattedLineTotal}</span>
                        </div>
                      ))}
                      {ord.specialInstructions && (
                        <p className="pt-1.5 border-t border-slate-200 text-amber-900">
                          <strong>Kitchen Note:</strong> {ord.specialInstructions}
                        </p>
                      )}
                      {ord.collection && (
                        <p className="pt-1.5 border-t border-slate-200 text-emerald-800 font-medium">
                          Collected at {new Date(ord.collection.collectedAt).toLocaleString()}
                          {ord.collection.collectedByChefName
                            ? ` (Verified by ${ord.collection.collectedByChefName})`
                            : ''}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      {ord.hasQrCode && ord.orderStatus !== 'cancelled' && (
                        <button
                          onClick={() => setQrOrderId(ord.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brs-navy hover:bg-brs-royal text-white text-xs font-semibold transition shadow-sm"
                        >
                          <QrCode className="w-4 h-4" />
                          {ord.orderStatus === 'collected'
                            ? 'View Collected QR Record'
                            : "Open Child's QR Code"}
                        </button>
                      )}

                      {ord.orderStatus === 'awaiting_payment' &&
                        ['failed', 'pending'].includes(ord.paymentStatus) && (
                          <button
                            disabled={retryingOrderId === ord.id}
                            onClick={() => handleRetryOrderPayment(ord.id)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            {retryingOrderId === ord.id
                              ? 'Authorizing...'
                              : 'Complete Digital Payment'}
                          </button>
                        )}

                      {['awaiting_payment', 'confirmed'].includes(ord.orderStatus) && (
                        <button
                          onClick={() => handleCancelOrder(ord)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold transition"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel Order
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PAYMENT HISTORY */}
        {activeTab === 'payments' && (
          <div className="max-w-5xl mx-auto space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Digital Payment History</h2>
              <p className="text-xs text-slate-500">
                Complete audit trail of all AED canteen transactions, pending authorizations, and
                refunds
              </p>
            </div>

            {transactions.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                No payment transactions recorded yet.
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3.5">Transaction Ref</th>
                        <th className="px-4 py-3.5">Order & Child</th>
                        <th className="px-4 py-3.5">Method</th>
                        <th className="px-4 py-3.5">Amount</th>
                        <th className="px-4 py-3.5">Status</th>
                        <th className="px-4 py-3.5">Date</th>
                        <th className="px-4 py-3.5">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3.5 font-mono font-semibold text-xs text-brs-navy">
                            {t.transactionRef}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-slate-900">{t.orderNumber}</div>
                            <div className="text-xs text-slate-500">{t.beneficiaryName}</div>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-600">
                            {t.paymentMethodLabel || t.provider}
                            {t.failureReason && (
                              <div className="text-rose-600 mt-0.5">{t.failureReason}</div>
                            )}
                            {t.refundReason && (
                              <div className="text-purple-700 mt-0.5">Refund: {t.refundReason}</div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-bold text-slate-900">
                            {t.formattedAmount}
                          </td>
                          <td className="px-4 py-3.5">
                            <PaymentStatusBadge status={t.status} />
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-500">
                            {new Date(t.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3.5">
                            {t.status === 'pending' && (
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleResolvePendingTxn(t.id, 'succeeded')}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                                >
                                  Authorize
                                </button>
                                <button
                                  onClick={() => handleResolvePendingTxn(t.id, 'failed')}
                                  className="px-2.5 py-1 rounded-lg bg-slate-200 text-slate-700 text-xs font-semibold"
                                >
                                  Decline
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: FAMILY & PROFILE */}
        {activeTab === 'family' && (
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Linked Children Card */}
            <div className="space-y-5">
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-1">
                  Linked Bright Riders Students
                </h2>
                <p className="text-xs text-slate-500 mb-4">
                  Manage dietary alerts and view Student IDs for your children
                </p>

                {children.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">
                    No children linked yet. Use the form below to link your child's Student ID.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {children.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-2xl border border-slate-200 p-4 bg-slate-50/70 flex items-start justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900">{c.fullName}</h3>
                            <span className="text-xs px-2 py-0.5 rounded-md bg-brs-navy/10 text-brs-navy font-semibold">
                              {c.className}
                            </span>
                          </div>
                          <p className="text-xs font-mono text-slate-500 mt-0.5">
                            Student ID: {c.studentCode} • Username: {c.username}
                          </p>
                          <p className="text-xs text-slate-600 mt-1.5">
                            <strong>Dietary / Allergies:</strong> {c.allergiesNotes || 'None listed'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleUpdateChildAllergy(c.id, c.allergiesNotes)}
                          className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-700 shrink-0"
                        >
                          Edit Allergies
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Link Another Child */}
                <form
                  onSubmit={handleLinkChild}
                  className="mt-5 pt-5 border-t border-slate-200 space-y-3"
                >
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-brs-royal" />
                    Link an Enrolled Child
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={linkStudentCode}
                      onChange={(e) => setLinkStudentCode(e.target.value)}
                      placeholder="Student ID (BRS-STU-...)"
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                      required
                    />
                    <input
                      type="text"
                      value={linkStudentUsername}
                      onChange={(e) => setLinkStudentUsername(e.target.value)}
                      placeholder="Student Username"
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                      required
                    />
                  </div>
                  <div className="flex gap-2.5">
                    <select
                      value={linkRelationship}
                      onChange={(e) => setLinkRelationship(e.target.value)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
                    >
                      <option value="Mother">Mother</option>
                      <option value="Father">Father</option>
                      <option value="Guardian">Guardian</option>
                    </select>
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-xl bg-brs-navy hover:bg-brs-royal text-white text-xs font-semibold transition"
                    >
                      Verify & Link Student
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Parent Profile Card */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-1">Parent Account Details</h2>
              <p className="text-xs text-slate-500 mb-4">
                Keep your contact details current for order confirmations
              </p>

              <form onSubmit={handleSaveProfile} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profileFullName}
                    onChange={(e) => setProfileFullName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile Number
                    </label>
                    <input
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={profileAddress}
                    onChange={(e) => setProfileAddress(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Secondary / Emergency Contact
                  </label>
                  <input
                    type="text"
                    value={profileEmergency}
                    onChange={(e) => setProfileEmergency(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-brs-navy hover:bg-brs-royal text-white font-semibold text-sm transition"
                >
                  Save Profile Changes
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 grid grid-cols-5 py-1.5 px-1">
        {(
          [
            { id: 'menu', label: 'Menu', icon: UtensilsCrossed },
            { id: 'cart', label: `Cart${cart?.itemCount ? `(${cart.itemCount})` : ''}`, icon: ShoppingBag },
            { id: 'orders', label: 'Orders', icon: ClipboardList },
            { id: 'payments', label: 'Payments', icon: CreditCard },
            { id: 'family', label: 'Family', icon: UserCircle2 },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setConfirmedOrder(null);
                setActiveTab(item.id);
              }}
              className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-semibold ${
                active ? 'text-brs-navy' : 'text-slate-400'
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${active ? 'text-amber-600' : ''}`} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Child Order QR Pass Modal */}
      <QrPassModal orderId={qrOrderId} onClose={() => setQrOrderId(null)} />
    </div>
  );
};
