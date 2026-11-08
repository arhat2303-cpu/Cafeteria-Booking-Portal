import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  X,
  Search,
  Upload,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  PackageCheck,
  SwitchCamera,
} from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import type { ChefVerificationResult } from '@/types';
import { OrderStatusBadge, PaymentStatusBadge } from './BrandCrest';
import { useToast } from '@/context/ToastContext';

interface ChefQrScannerModalProps {
  open: boolean;
  initialMode?: 'camera' | 'manual';
  onClose: () => void;
  onCollectionConfirmed: () => void;
}

export const ChefQrScannerModal: React.FC<ChefQrScannerModalProps> = ({
  open,
  initialMode = 'camera',
  onClose,
  onCollectionConfirmed,
}) => {
  const [tab, setTab] = useState<'camera' | 'manual'>(initialMode);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const [manualOrderId, setManualOrderId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [verification, setVerification] = useState<ChefVerificationResult | null>(null);
  const [lastScannedToken, setLastScannedToken] = useState<string | null>(null);
  const [collectionDone, setCollectionDone] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningLockRef = useRef(false);

  const { showToast } = useToast();

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const verifyQrPayload = useCallback(
    async (rawQrText: string) => {
      if (scanningLockRef.current) return;
      scanningLockRef.current = true;
      stopCamera();
      setVerifying(true);
      setCollectionDone(false);
      setLastScannedToken(rawQrText);

      try {
        const res = await apiFetch<ChefVerificationResult>('/api/chef/verify-qr', {
          method: 'POST',
          body: JSON.stringify({ qrPayload: rawQrText }),
        });
        setVerification(res);
      } catch (err: any) {
        if (err instanceof ApiError && err.data && typeof err.data === 'object') {
          setVerification({
            valid: false,
            code: err.data.code || 'ERROR',
            message:
              err.data.message ||
              err.data.error ||
              'Invalid QR code. Please scan a valid Bright Riders School order QR code.',
            order: err.data.order,
          });
        } else {
          setVerification({
            valid: false,
            code: 'INVALID_QR',
            message: 'Invalid QR code. Please scan a valid Bright Riders School order QR code.',
          });
        }
      } finally {
        setVerifying(false);
        scanningLockRef.current = false;
      }
    },
    [stopCamera]
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    stopCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera API is not available in this browser context. You can upload a QR Pass image below or use Manual Order ID Search.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      const scanFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !streamRef.current) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });
            if (code && code.data && code.data.trim().length > 0) {
              verifyQrPayload(code.data.trim());
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(scanFrame);
      };

      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (err: any) {
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please grant camera access in your browser, scan a saved QR image, or enter the Order ID manually.'
          : 'No active camera device was detected. Use "Scan QR Image File" below or switch to Manual Order ID Search.'
      );
    }
  }, [facingMode, stopCamera, verifyQrPayload]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setVerification(null);
      setCollectionDone(false);
      setLastScannedToken(null);
      setManualOrderId('');
      return;
    }
    setTab(initialMode);
    if (initialMode === 'camera') {
      startCamera();
    }
    return () => stopCamera();
  }, [open, initialMode, startCamera, stopCamera]);

  const handleImageFileScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded && decoded.data) {
          verifyQrPayload(decoded.data.trim());
        } else {
          setVerification({
            valid: false,
            code: 'INVALID_QR',
            message: 'Invalid QR code. Please scan a valid Bright Riders School order QR code.',
          });
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualOrderId.trim()) return;
    stopCamera();
    setVerifying(true);
    setCollectionDone(false);
    setLastScannedToken(null);

    try {
      const res = await apiFetch<ChefVerificationResult>('/api/chef/verify-order', {
        method: 'POST',
        body: JSON.stringify({ orderNumber: manualOrderId.trim() }),
      });
      setVerification(res);
    } catch (err: any) {
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
        setVerification({
          valid: false,
          code: err.data.code || 'UNKNOWN_ORDER',
          message: err.data.message || err.data.error || 'Order verification failed.',
          order: err.data.order,
        });
      } else {
        setVerification({
          valid: false,
          code: 'UNKNOWN_ORDER',
          message: err.message || 'Order not found.',
        });
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleConfirmCollection = async () => {
    if (!verification?.valid || !verification.order) return;
    setConfirming(true);
    try {
      await apiFetch('/api/chef/confirm-collection', {
        method: 'POST',
        body: JSON.stringify({
          orderId: verification.order.orderId,
          verificationMethod: verification.verificationMethod || 'qr_scan',
          qrPayload: lastScannedToken || undefined,
        }),
      });
      setCollectionDone(true);
      showToast(
        'Collection Confirmed!',
        'success',
        `${verification.order.orderNumber} collected by ${verification.order.studentFullName}.`
      );
      onCollectionConfirmed();
    } catch (err: any) {
      showToast('Collection failed', 'error', err.message || 'Unable to confirm collection.');
    } finally {
      setConfirming(false);
    }
  };

  const handleScanNext = () => {
    setVerification(null);
    setCollectionDone(false);
    setLastScannedToken(null);
    setManualOrderId('');
    if (tab === 'camera') {
      startCamera();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-elevated overflow-hidden border border-slate-200 my-auto">
        {/* Header */}
        <div className="bg-brs-navy px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg leading-tight">
                Chef Order Scanner & Verification
              </h3>
              <p className="text-xs text-slate-300">
                Scan Student QR Pass or verify by Order ID
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 bg-slate-100 p-1.5 gap-1.5 border-b border-slate-200">
          <button
            type="button"
            onClick={() => {
              setTab('camera');
              setVerification(null);
              setCollectionDone(false);
              startCamera();
            }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
              tab === 'camera'
                ? 'bg-white text-brs-navy shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-4 h-4" />
            Camera QR Scanner
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setTab('manual');
              setVerification(null);
              setCollectionDone(false);
            }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
              tab === 'manual'
                ? 'bg-white text-brs-navy shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Search className="w-4 h-4" />
            Manual Order ID Lookup
          </button>
        </div>

        <div className="p-5">
          {/* Active Scanner or Manual Input when no verification result yet */}
          {!verification && !verifying && tab === 'camera' && (
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3] flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />
                <canvas ref={canvasRef} className="hidden" />

                {cameraActive && (
                  <>
                    {/* Viewfinder Reticle */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-56 h-56 rounded-2xl border-2 border-amber-400/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] relative overflow-hidden">
                        <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scanline" />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                      }
                      className="absolute top-3 right-3 bg-slate-900/80 hover:bg-slate-900 text-white px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border border-white/15"
                    >
                      <SwitchCamera className="w-3.5 h-3.5" />
                      Flip Camera
                    </button>
                  </>
                )}

                {!cameraActive && (
                  <div className="p-6 text-center text-slate-200 max-w-xs">
                    <Camera className="w-10 h-10 text-amber-400 mx-auto mb-2.5" />
                    <p className="text-sm font-medium mb-2">
                      {cameraError || 'Initializing camera scanner...'}
                    </p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Camera Access
                    </button>
                  </div>
                )}
              </div>

              {/* Image Upload QR Scan Fallback */}
              <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Scan from QR Image File</p>
                  <p>Upload a student's saved QR Pass PNG to verify directly</p>
                </div>
                <label className="cursor-pointer shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-semibold shadow-sm transition">
                  <Upload className="w-3.5 h-3.5 text-brs-royal" />
                  Select QR PNG
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleImageFileScan}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {!verification && !verifying && tab === 'manual' && (
            <form onSubmit={handleManualVerify} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Bright Riders Order ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualOrderId}
                    onChange={(e) => setManualOrderId(e.target.value)}
                    placeholder="e.g. BRS-20261108-12345"
                    className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brs-royal"
                    required
                  />
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-brs-navy hover:bg-brs-royal text-white font-semibold text-sm transition flex items-center gap-1.5"
                  >
                    <Search className="w-4 h-4" />
                    Verify
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Backup lookup when a student's screen is damaged or camera scanning is unavailable.
                </p>
              </div>
            </form>
          )}

          {verifying && (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-brs-royal animate-spin mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-700">
                Verifying order against Bright Riders canteen database...
              </p>
            </div>
          )}

          {/* Verification Result Screen */}
          {verification && !verifying && (
            <div className="space-y-4">
              {/* Validation Status Banner */}
              <div
                className={`rounded-2xl p-4 border flex items-start gap-3 ${
                  collectionDone
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : verification.valid
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : verification.code === 'ALREADY_COLLECTED'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-rose-50 border-rose-300 text-rose-950'
                }`}
              >
                {collectionDone || verification.valid ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                ) : verification.code === 'ALREADY_COLLECTED' ? (
                  <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold text-sm">
                    {collectionDone
                      ? 'Collection Confirmed! Order status updated to Collected.'
                      : verification.message}
                  </p>
                  {verification.order?.collection && (
                    <p className="text-xs mt-1 opacity-90">
                      Collected at {new Date(verification.order.collection.collectedAt).toLocaleString()}
                      {verification.order.collection.collectedByChefName
                        ? ` • Processed by ${verification.order.collection.collectedByChefName}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Order Details Card */}
              {verification.order && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block">
                        Order ID
                      </span>
                      <span className="font-mono font-bold text-base text-brs-navy">
                        {verification.order.orderNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <PaymentStatusBadge status={verification.order.paymentStatus} />
                      <OrderStatusBadge
                        status={
                          collectionDone ? 'collected' : verification.order.orderStatus
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-slate-500 block">Student / Diner</span>
                      <span className="font-bold text-slate-900">
                        {verification.order.studentFullName}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Class / Dept</span>
                      <span className="font-semibold text-slate-900">
                        {verification.order.studentClass}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Collection Date</span>
                      <span className="font-semibold text-slate-800">
                        {verification.order.collectionDate}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Collection Time</span>
                      <span className="font-semibold text-slate-800">
                        {verification.order.collectionTime}
                      </span>
                    </div>
                  </div>

                  {verification.order.allergiesNotes &&
                    verification.order.allergiesNotes.toLowerCase() !== 'none' && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-xl px-3 py-2 text-xs font-semibold">
                        Allergy / Dietary Alert: {verification.order.allergiesNotes}
                      </div>
                    )}

                  {verification.order.specialInstructions && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-950 rounded-xl px-3 py-2 text-xs">
                      <span className="font-semibold">Special Instructions:</span>{' '}
                      {verification.order.specialInstructions}
                    </div>
                  )}

                  {/* Food Items & Quantities */}
                  <div className="pt-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">
                      Ordered Food Items
                    </span>
                    <ul className="divide-y divide-slate-200 bg-white rounded-xl border border-slate-200 px-3">
                      {verification.order.items.map((item) => (
                        <li
                          key={item.id}
                          className="py-2 flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="font-medium text-slate-900">{item.name}</span>
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-lg bg-brs-navy text-white font-bold text-xs">
                            × {item.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                {verification.valid && !collectionDone && (
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={handleConfirmCollection}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-base shadow-md transition"
                  >
                    <PackageCheck className="w-5 h-5" />
                    {confirming ? 'Recording Collection...' : 'Confirm Collection'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleScanNext}
                  className="px-5 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-sm transition inline-flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4 text-brs-royal" />
                  {collectionDone ? 'Scan Next Student' : 'Scan Another Order'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
