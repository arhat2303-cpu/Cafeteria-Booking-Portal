import React, { useEffect, useState } from 'react';
import { X, Download, ShieldCheck, Calendar, Clock, User, CheckCircle2, Copy } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { QrPassPayload } from '@/types';
import { OrderStatusBadge } from './BrandCrest';
import { useToast } from '@/context/ToastContext';

interface QrPassModalProps {
  orderId: number | null;
  onClose: () => void;
}

export const QrPassModal: React.FC<QrPassModalProps> = ({ orderId, onClose }) => {
  const [pass, setPass] = useState<QrPassPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!orderId) {
      setPass(null);
      return;
    }
    setLoading(true);
    setError(null);
    apiFetch<QrPassPayload>(`/api/orders/${orderId}/qr`)
      .then((data) => setPass(data))
      .catch((err) => setError(err.message || 'Unable to load QR verification pass.'))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (!orderId) return null;

  const handleDownload = () => {
    if (!pass) return;
    const link = document.createElement('a');
    link.href = pass.qrDataUrl;
    link.download = `${pass.orderNumber}-QR-Pass.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('QR Pass downloaded', 'success', `${pass.orderNumber}-QR-Pass.png saved.`);
  };

  const handleCopyOrderId = () => {
    if (!pass) return;
    navigator.clipboard?.writeText(pass.orderNumber);
    showToast('Order ID copied', 'info', pass.orderNumber);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-elevated overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-brs-navy to-brs-royal px-6 py-4 text-white flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-amber-300 font-semibold">
              Bright Riders Cashless Meal Pass
            </p>
            <h3 className="text-lg font-bold">Canteen QR Verification</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            aria-label="Close QR modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              Generating secure order QR code...
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-rose-600 font-medium text-sm mb-4">{error}</p>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-medium text-sm"
              >
                Close
              </button>
            </div>
          ) : pass ? (
            <div className="flex flex-col items-center">
              <div className="w-full flex items-center justify-between mb-4">
                <button
                  onClick={handleCopyOrderId}
                  className="inline-flex items-center gap-1.5 font-mono text-xs font-bold bg-slate-100 hover:bg-slate-200 text-brs-navy px-3 py-1.5 rounded-lg transition"
                  title="Copy Order ID"
                >
                  <span>{pass.orderNumber}</span>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                </button>
                <OrderStatusBadge status={pass.orderStatus} />
              </div>

              {/* Crisp Scannable QR Frame */}
              <div className="qr-white-surface relative p-4 rounded-2xl bg-white border-2 border-[#CCF32F]/40 shadow-soft mb-4">
                <img
                  src={pass.qrDataUrl}
                  alt={`Order QR Code ${pass.orderNumber}`}
                  className={`w-60 h-60 object-contain rounded-lg ${
                    pass.isCollected ? 'opacity-35 grayscale' : ''
                  }`}
                />
                {pass.isCollected && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/75 rounded-2xl p-4 text-center">
                    <CheckCircle2 className="w-12 h-12 text-emerald-600 mb-1.5" />
                    <span className="text-sm font-bold text-slate-900">Already Collected</span>
                    {pass.collectedAt && (
                      <span className="text-xs text-slate-600 mt-0.5">
                        {new Date(pass.collectedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Recipient & Collection Info */}
              <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2.5 text-sm mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <User className="w-4 h-4 text-brs-royal" /> Student / Diner
                  </span>
                  <span className="font-semibold text-slate-900">
                    {pass.beneficiaryName}{' '}
                    <span className="text-xs font-medium text-slate-500">({pass.className})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-brs-royal" /> Date
                  </span>
                  <span className="font-semibold text-slate-900">{pass.orderDate}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-brs-royal" /> Break Slot
                  </span>
                  <span className="font-semibold text-slate-900 text-right">
                    {pass.collectionSlot}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500 mb-5 text-center">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Cryptographically signed one-time token. Contains zero personal student data in QR
                  payload.
                </span>
              </div>

              <div className="w-full flex gap-3">
                <button
                  onClick={handleDownload}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brs-navy hover:bg-brs-royal text-white font-semibold text-sm transition shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  Save QR Image
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm transition"
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
