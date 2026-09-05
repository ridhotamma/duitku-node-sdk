import type { PaymentMethodCode } from '../constants/payment-methods.js';

export interface ItemDetail {
  name: string;
  quantity: number;
  /** Per-item price, integer IDR. The sum across items must equal `paymentAmount` exactly. */
  price: number;
}

export interface Address {
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  phone?: string;
  /** ISO 3166-1 alpha-3 per the docs, though `ID` is accepted. */
  countryCode?: string;
}

/** Mandatory for paylater channels (`DN`, `AT`). */
export interface CustomerDetail {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
}

export interface CreditCardDetail {
  /** `014` BCA, `022` CIMB. */
  acquirer?: string;
  /** 3-digit bank codes or 6-digit card BINs. Assume a 15-entry cap. */
  binWhitelist?: string[];
}

/** Required for OVO (`OL`) and ShopeePay (`SL`) account link. */
export interface AccountLink {
  /** Issued by Duitku once the customer links their account. */
  credentialCode: string;
  ovo?: { paymentDetails: Array<{ paymentType: string; amount: string }> };
  shopee?: { useCoin?: boolean; promoId?: string };
}

export interface CreatePaymentParams {
  /** Integer IDR, no decimals. Minimum 10,000. */
  paymentAmount: number;
  /** Your order ID. Must be unique per new transaction, max 50 chars. */
  merchantOrderId: string;
  paymentMethod: PaymentMethodCode | (string & {});
  productDetails: string;
  email: string;
  /** Name shown on the bank confirmation screen. Max 20 chars, required for VA and e-commerce. */
  customerVaName?: string;
  callbackUrl: string;
  returnUrl: string;
  phoneNumber?: string;
  /** Echoed back in the callback. URL-encode the contents yourself. */
  additionalParam?: string;
  merchantUserInfo?: string;
  /** Minutes. Defaults and caps vary per channel. */
  expiryPeriod?: number;
  itemDetails?: ItemDetail[];
  customerDetail?: CustomerDetail;
  creditCardDetail?: CreditCardDetail;
  accountLink?: AccountLink;
}

export interface CreatePaymentResult {
  merchantCode: string;
  /** Duitku's reference. Persist it — needed for tracing and support. */
  reference: string;
  /** Duitku's hosted payment page. */
  paymentUrl: string;
  /** Present for VA channels. */
  vaNumber?: string;
  /** Raw QRIS payload for QRIS channels — render the QR image yourself. */
  qrString?: string;
  /** Deeplink for e-commerce channels. Duitku's casing varies; normalized here. */
  appUrl?: string;
  amount: string;
  statusCode: string;
  statusMessage: string;
}

export interface PaymentMethodFee {
  paymentMethod: string;
  paymentName: string;
  paymentImage: string;
  /** `0` when the project charges fees to the merchant. */
  totalFee: string;
}

export interface TransactionStatusResult {
  merchantOrderId: string;
  reference: string;
  amount: string;
  fee: string;
  /** `00` success, `01` pending/process, `02` canceled/failed/expired. */
  statusCode: string;
  statusMessage: string;
}

/** The `x-www-form-urlencoded` fields Duitku POSTs to your `callbackUrl`. */
export interface CallbackPayload {
  merchantCode: string;
  amount: string;
  merchantOrderId: string;
  productDetail?: string;
  additionalParam?: string;
  paymentCode?: string;
  /** `00` success, `01` failed. */
  resultCode: string;
  merchantUserId?: string;
  reference: string;
  signature: string;
  /** Duitku's unique payment number. Keep it for reconciliation. */
  publisherOrderId?: string;
  spUserHash?: string;
  settlementDate?: string;
  issuerCode?: string;
  customerName?: string;
}
