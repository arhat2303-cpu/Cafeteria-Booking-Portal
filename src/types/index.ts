export type UserRole = 'admin' | 'parent' | 'student' | 'teacher' | 'chef';

export interface LinkedChild {
  linkId: number;
  relationship: string;
  id: number;
  fullName: string;
  username: string;
  studentCode: string;
  className: string;
  section: string | null;
  house: string | null;
  allergiesNotes: string | null;
  dailySpendLimitAed: number;
}

export interface UserAccount {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  parentProfile?: {
    address: string | null;
    emergencyContact: string | null;
    preferredPaymentMethod: string | null;
    notificationsEnabled: boolean;
  } | null;
  children?: LinkedChild[];
  studentProfile?: {
    studentCode: string;
    className: string;
    section: string | null;
    house: string | null;
    allergiesNotes: string | null;
    parents: Array<{ fullName: string; phone: string | null; relationship: string }>;
  } | null;
  teacherProfile?: {
    staffCode: string;
    department: string;
    homeroomClass: string | null;
    canPlaceOrdersOverride: boolean | null;
  } | null;
  chefProfile?: {
    staffCode: string;
    station: string;
    shift: string;
  } | null;
}

export interface CollectionSlotOption {
  id: string;
  label: string;
  shortLabel?: string;
}

export interface PlatformSettings {
  schoolName: string;
  schoolCampus: string;
  currencyCode: string;
  teacherOrderingEnabled: boolean;
  cancellationCutoffMinutes: number;
  collectionSlots: CollectionSlotOption[];
  paymentMode: 'stripe' | 'brs_sandbox_aed';
  stripePublishableKey?: string | null;
  initialSetupPending?: boolean;
}

export interface FoodCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface MenuScheduleRule {
  id: number;
  dayOfWeek: number | null;
  specificDate: string | null;
  isAvailable: boolean;
  specialNote: string | null;
}

export interface MenuItem {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  description: string | null;
  priceFils: number;
  priceAed: number;
  formattedPrice: string;
  imageUrl: string | null;
  isAvailable: boolean;
  availableOnDate: boolean;
  scheduleNote: string | null;
  isVegetarian: boolean;
  calories: number | null;
  allergens: string | null;
  preparationTimeMins: number | null;
  dailyStockLimit: number | null;
  displayOrder: number;
  schedules: MenuScheduleRule[];
  updatedAt: string;
}

export interface CartItem {
  cartItemId: number;
  menuItemId: number;
  name: string;
  categoryName: string;
  quantity: number;
  unitPriceFils: number;
  unitPriceAed: number;
  lineTotalFils: number;
  lineTotalAed: number;
  formattedLineTotal: string;
  imageUrl: string | null;
  isAvailable: boolean;
  itemNotes: string | null;
}

export interface ShoppingCart {
  cartId: number;
  beneficiaryUserId: number | null;
  orderDate: string | null;
  collectionSlot: string | null;
  specialInstructions: string;
  items: CartItem[];
  itemCount: number;
  subtotalFils: number;
  subtotalAed: number;
  totalFils: number;
  totalAed: number;
  formattedTotal: string;
  updatedAt: string;
}

export type OrderStatus =
  | 'awaiting_payment'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_collection'
  | 'collected'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface OrderRecord {
  id: number;
  orderNumber: string;
  placedByUserId: number;
  placedByName: string;
  placedByRole: string;
  beneficiaryUserId: number;
  beneficiaryName: string;
  beneficiaryRole: 'student' | 'teacher';
  studentCode: string | null;
  className: string;
  allergiesNotes: string | null;
  orderDate: string;
  collectionSlot: string;
  subtotalFils: number;
  subtotalAed: number;
  totalFils: number;
  totalAed: number;
  formattedTotal: string;
  currency: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  specialInstructions: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  hasQrCode: boolean;
  qrToken: string | null;
  qrUsed: boolean;
  collection: {
    collectedAt: string;
    verificationMethod: string;
    collectedByChefName: string | null;
  } | null;
  items: Array<{
    id: number;
    menuItemId: number | null;
    name: string;
    categoryName: string | null;
    unitPriceFils: number;
    unitPriceAed: number;
    quantity: number;
    lineTotalFils: number;
    lineTotalAed: number;
    formattedLineTotal: string;
    notes: string | null;
  }>;
  statusHistory: Array<{
    id: number;
    previousStatus: string | null;
    newStatus: string;
    actorName: string | null;
    note: string | null;
    createdAt: string;
  }>;
  payments: Array<{
    id: number;
    transactionRef: string;
    provider: string;
    amountFils: number;
    amountAed: number;
    formattedAmount: string;
    currency: string;
    status: string;
    paymentMethodLabel: string | null;
    failureReason: string | null;
    refundReason: string | null;
    refundedAt: string | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransactionRecord {
  id: number;
  transactionRef: string;
  orderId: number;
  orderNumber: string;
  orderDate: string;
  collectionSlot: string;
  orderStatus: OrderStatus;
  payerName: string;
  payerRole: string;
  beneficiaryName: string;
  className: string;
  provider: string;
  amountFils: number;
  amountAed: number;
  formattedAmount: string;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paymentMethodLabel: string | null;
  failureReason: string | null;
  refundReason: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface QrPassPayload {
  orderId: number;
  orderNumber: string;
  beneficiaryName: string;
  className: string;
  orderDate: string;
  collectionSlot: string;
  orderStatus: OrderStatus;
  signedToken: string;
  qrDataUrl: string;
  isCollected: boolean;
  collectedAt: string | null;
}

export interface ChefVerificationResult {
  valid: boolean;
  code: string;
  message: string;
  verificationMethod?: 'qr_scan' | 'manual_order_lookup';
  qrTokenId?: number;
  order?: {
    orderId: number;
    orderNumber: string;
    studentFullName: string;
    studentClass: string;
    beneficiaryRole: string;
    studentCode: string | null;
    allergiesNotes: string | null;
    items: Array<{ id: number; name: string; quantity: number; notes: string | null }>;
    collectionDate: string;
    collectionTime: string;
    paymentStatus: PaymentStatus;
    orderStatus: OrderStatus;
    specialInstructions: string | null;
    formattedTotal: string;
    collection: {
      collectedAt: string;
      verificationMethod: string;
      collectedByChefName: string | null;
    } | null;
  };
}
