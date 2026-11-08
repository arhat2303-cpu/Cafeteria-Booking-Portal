import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Download,
  RotateCcw,
  XCircle,
  Eye,
  X,
  FileSpreadsheet,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { OrderRecord, OrderStatus, PaymentTransactionRecord } from '@/types';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/BrandCrest';

export const AdminOrdersSection: React.FC = () => {
  const { showToast } = useToast();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [status, setStatus] = useState('all');
  const [date, setDate] = useState('');
  const [className, setClassName] = useState('');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (date) params.set('date', date);
    if (className.trim()) params.set('className', className.trim());
    if (search.trim()) params.set('search', search.trim());

    const res = await apiFetch<{ orders: OrderRecord[] }>(`/api/orders?${params.toString()}`);
    setOrders(res.orders);
  }, [status, date, className, search]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleStatusChange = async (orderId: number, nextStatus: OrderStatus) => {
    try {
      const res = await apiFetch<{ order: OrderRecord }>(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ orderStatus: nextStatus }),
      });
      showToast('Order status updated', 'success', `${res.order.orderNumber} → ${nextStatus}`);
      setSelectedOrder(res.order);
      loadOrders();
    } catch (err: any) {
      showToast('Status update failed', 'error', err.message);
    }
  };

  const handleCancelOrder = async (ord: OrderRecord) => {
    const reason = window.prompt(
      `Enter cancellation reason for ${ord.orderNumber} (auto-refunds if paid):`,
      'Cancelled by school administration'
    );
    if (reason === null) return;
    try {
      await apiFetch(`/api/orders/${ord.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      showToast('Order cancelled', 'info');
      setSelectedOrder(null);
      loadOrders();
    } catch (err: any) {
      showToast('Cancellation failed', 'error', err.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Order ID, student, or parent..."
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold bg-white"
        >
          <option value="all">All Order Statuses</option>
          <option value="awaiting_payment">Awaiting Payment</option>
          <option value="confirmed">Confirmed</option>
          <option value="preparing">Preparing</option>
          <option value="ready_for_collection">Ready for Collection</option>
          <option value="collected">Collected</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <input
          type="text"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          placeholder="Filter Class (e.g. Grade 5-A)"
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs w-44"
        />

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />

        {(status !== 'all' || date || className || search) && (
          <button
            onClick={() => {
              setStatus('all');
              setDate('');
              setClassName('');
              setSearch('');
            }}
            className="text-xs font-semibold text-brs-royal underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3.5">Order ID</th>
                <th className="px-4 py-3.5">Student & Class</th>
                <th className="px-4 py-3.5">Date & Break Slot</th>
                <th className="px-4 py-3.5">Total</th>
                <th className="px-4 py-3.5">Payment</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No orders matched current filters.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3.5 font-mono font-bold text-xs text-brs-navy">
                      {o.orderNumber}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-slate-900">{o.beneficiaryName}</div>
                      <div className="text-xs text-slate-500">
                        {o.className} • Ordered by {o.placedByName}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-700">
                      <div className="font-semibold">{o.orderDate}</div>
                      <div className="text-slate-500">{o.collectionSlot}</div>
                    </td>
                    <td className="px-4 py-3.5 font-bold text-slate-900">{o.formattedTotal}</td>
                    <td className="px-4 py-3.5">
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </td>
                    <td className="px-4 py-3.5">
                      <OrderStatusBadge status={o.orderStatus} />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedOrder(o)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5" /> Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail & Status Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-elevated border border-slate-200 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono font-bold text-sm text-brs-navy">
                  {selectedOrder.orderNumber}
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedOrder.beneficiaryName} ({selectedOrder.className})
                </h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Placed By:</span>
                <span className="font-semibold">
                  {selectedOrder.placedByName} ({selectedOrder.placedByRole})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Collection Schedule:</span>
                <span className="font-semibold">
                  {selectedOrder.orderDate} • {selectedOrder.collectionSlot}
                </span>
              </div>
              {selectedOrder.collection && (
                <div className="flex justify-between text-emerald-800 font-semibold">
                  <span>Collection Record:</span>
                  <span>
                    {new Date(selectedOrder.collection.collectedAt).toLocaleString()} by{' '}
                    {selectedOrder.collection.collectedByChefName || 'Chef'} (
                    {selectedOrder.collection.verificationMethod})
                  </span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold uppercase text-slate-500 mb-1.5">Order Items</p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3.5 text-xs">
                {selectedOrder.items.map((it) => (
                  <div key={it.id} className="py-2 flex justify-between">
                    <span>
                      <strong>{it.quantity}×</strong> {it.name}
                    </span>
                    <span className="font-bold">{it.formattedLineTotal}</span>
                  </div>
                ))}
              </div>
            </div>

            {selectedOrder.payments.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase text-slate-500 mb-1.5">
                  Payment Transactions
                </p>
                {selectedOrder.payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs mb-1.5"
                  >
                    <span className="font-mono font-semibold">{p.transactionRef}</span>
                    <span>{p.formattedAmount}</span>
                    <PaymentStatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Admin Status Controls */}
            {selectedOrder.orderStatus !== 'cancelled' && (
              <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      'confirmed',
                      'preparing',
                      'ready_for_collection',
                      'collected',
                    ] as OrderStatus[]
                  ).map((st) => (
                    <button
                      key={st}
                      disabled={selectedOrder.paymentStatus !== 'paid'}
                      onClick={() => handleStatusChange(selectedOrder.id, st)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border ${
                        selectedOrder.orderStatus === st
                          ? 'bg-brs-navy text-white border-brs-navy'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                      } disabled:opacity-40`}
                    >
                      {st.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>

                {selectedOrder.orderStatus !== 'collected' && (
                  <button
                    onClick={() => handleCancelOrder(selectedOrder)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Cancel Order
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const AdminPaymentsSection: React.FC = () => {
  const { showToast } = useToast();
  const [txns, setTxns] = useState<PaymentTransactionRecord[]>([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const loadPayments = useCallback(async () => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    const res = await apiFetch<{ transactions: PaymentTransactionRecord[] }>(
      `/api/payments?${params.toString()}`
    );
    setTxns(res.transactions);
  }, [status, search]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const handleRefund = async (t: PaymentTransactionRecord) => {
    const reason = window.prompt(
      `Issue refund of ${t.formattedAmount} for ${t.transactionRef}? Enter reason:`,
      'Authorized school canteen refund'
    );
    if (reason === null) return;
    try {
      await apiFetch(`/api/payments/${t.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      showToast('Payment Refunded', 'success', t.transactionRef);
      loadPayments();
    } catch (err: any) {
      showToast('Refund failed', 'error', err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'succeeded', 'pending', 'failed', 'refunded'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatus(st)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold capitalize ${
                status === st ? 'bg-brs-navy text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {st === 'all' ? 'All Transactions' : st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search TXN-BRS-... or payer"
              className="rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs w-56"
            />
          </div>
          <a
            href="/api/admin/reports/export?type=payments"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </a>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3.5">Transaction Ref</th>
                <th className="px-4 py-3.5">Order & Diner</th>
                <th className="px-4 py-3.5">Payer</th>
                <th className="px-4 py-3.5">Gateway</th>
                <th className="px-4 py-3.5">Amount</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {txns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No payment transactions found.
                  </td>
                </tr>
              ) : (
                txns.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3.5 font-mono font-bold text-xs text-brs-navy">
                      {t.transactionRef}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900">{t.orderNumber}</div>
                      <div className="text-xs text-slate-500">
                        {t.beneficiaryName} ({t.className})
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-700">{t.payerName}</td>
                    <td className="px-4 py-3.5 text-xs text-slate-600">
                      {t.paymentMethodLabel || t.provider}
                    </td>
                    <td className="px-4 py-3.5 font-bold text-slate-900">{t.formattedAmount}</td>
                    <td className="px-4 py-3.5">
                      <PaymentStatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {t.status === 'succeeded' && (
                        <button
                          onClick={() => handleRefund(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-purple-200 hover:bg-purple-50 text-purple-800 text-xs font-semibold"
                        >
                          <RotateCcw className="w-3 h-3" /> Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const AdminReportsAndAuditSection: React.FC = () => {
  const [reports, setReports] = useState<any | null>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/admin/reports'),
      apiFetch<{ logs: any[] }>('/api/admin/audit-logs'),
    ]).then(([rep, aud]) => {
      setReports(rep);
      setLogs(aud.logs);
    });
  }, []);

  const exportButtons = [
    { type: 'daily_sales', label: 'Daily Sales CSV' },
    { type: 'weekly_sales', label: 'Weekly Sales CSV' },
    { type: 'monthly_sales', label: 'Monthly Sales CSV' },
    { type: 'popular_items', label: 'Popular Items CSV' },
    { type: 'student_orders', label: 'Student Orders CSV' },
    { type: 'class_orders', label: 'Class-Wise Orders CSV' },
    { type: 'payments', label: 'Payment Transactions CSV' },
  ];

  return (
    <div className="space-y-6">
      {/* CSV Export Hub */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-slate-900">Exportable School Canteen Reports (CSV)</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Download official finance, student participation, and item popularity spreadsheets
        </p>

        <div className="flex flex-wrap gap-2.5">
          {exportButtons.map((b) => (
            <a
              key={b.type}
              href={`/api/admin/reports/export?type=${b.type}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-brs-navy hover:text-white text-slate-800 text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5" />
              {b.label}
            </a>
          ))}
        </div>
      </div>

      {/* Completion Rate & Sales Tables */}
      {reports && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-2">
            <p className="text-xs font-bold uppercase text-slate-500">Order Completion Rate</p>
            <p className="text-3xl font-extrabold text-emerald-700">
              {reports.completionMetrics.completionRatePct}%
            </p>
            <p className="text-xs text-slate-600">
              {reports.completionMetrics.collectedOrders} collected out of{' '}
              {reports.completionMetrics.paidOrders} paid orders
            </p>
          </div>

          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <h4 className="font-bold text-slate-900 text-sm mb-3">Daily Sales Summary</h4>
            {reports.dailySales.length === 0 ? (
              <p className="text-xs text-slate-400">No daily sales recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2">Date</th>
                      <th className="py-2">Orders</th>
                      <th className="py-2">Collected</th>
                      <th className="py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reports.dailySales.slice(0, 8).map((d: any) => (
                      <tr key={d.date}>
                        <td className="py-2 font-semibold">{d.date}</td>
                        <td className="py-2">{d.paidOrders}</td>
                        <td className="py-2">{d.collectedOrders}</td>
                        <td className="py-2 text-right font-bold text-brs-navy">
                          {d.formattedRevenue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Administrative Activity Audit Logs */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-brs-royal" />
          <h3 className="font-bold text-slate-900 text-sm">
            Administrative Security & Activity Logs
          </h3>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
          {logs.map((l) => (
            <div key={l.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono font-bold text-brs-navy mr-2">{l.action}</span>
                <span className="text-slate-600">
                  by <strong>{l.actorName}</strong> on {l.targetType}{' '}
                  {l.targetId ? `#${l.targetId}` : ''}
                </span>
              </div>
              <span className="text-slate-400">{new Date(l.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
