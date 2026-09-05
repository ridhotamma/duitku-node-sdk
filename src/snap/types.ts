/** SNAP money object. Values carry two decimals, e.g. `"120000.00"`. */
export interface SnapAmount {
  value: string;
  currency: string;
}

export interface CreateVaParams {
  /** VA prefix issued by Duitku. */
  partnerServiceId: string;
  /** The part you choose. */
  customerNo: string;
  /** `partnerServiceId + customerNo`, at most 16 digits total. */
  virtualAccountNo: string;
  /** Max 20 chars, shown at the bank. */
  virtualAccountName: string;
  /** Unique per VA creation. Must match on update/inquiry/delete. */
  trxId: string;
  totalAmount: SnapAmount;
  /** `C` closed amount, `O` open amount. */
  virtualAccountTrxType: 'C' | 'O';
  /** ISO-8601, e.g. `2022-10-18T23:27:43+0700`. */
  expiredDate?: string;
  /** Set min/max for open amount; `0.00` for closed. */
  additionalInfo?: { minAmount?: string; maxAmount?: string } & Record<string, unknown>;
}

export interface VaResponse {
  responseCode: string;
  responseMessage: string;
  virtualAccountData?: Record<string, unknown>;
}

export interface VaInquiryStatusParams {
  partnerServiceId: string;
  customerNo: string;
  virtualAccountNo: string;
  /** The `trxId` used at creation. */
  inquiryRequestId: string;
}

/** Body Duitku POSTs to your `/v1.0/transfer-va/payment` endpoint. */
export interface VaPaymentNotification {
  partnerServiceId: string;
  customerNo: string;
  virtualAccountNo: string;
  paymentRequestId: string;
  trxId: string;
  paidAmount: SnapAmount;
  additionalInfo?: { reference?: string; paymentCode?: string } & Record<string, unknown>;
}

export interface DirectDebitPaymentParams {
  partnerReferenceNo: string;
  /** Matches the CHANNEL-ID for redirect channels. */
  chargeToken?: string;
  /** Credential code from account binding, for linking channels. */
  bankCardToken?: string;
  merchantId?: string;
  amount: SnapAmount;
  payOptionDetails?: Array<{ payMethod: string; transAmount: SnapAmount }>;
  /** ISO-8601 expiry, required for redirect channels. */
  validUpTo?: string;
  additionalInfo?: Record<string, unknown>;
}

export interface QrisGenerateParams {
  partnerReferenceNo: string;
  amount: SnapAmount;
  /** ISO-8601. Minimum 30 minutes — shorter returns `4094700`. */
  validityPeriod: string;
  additionalInfo?: Record<string, unknown>;
}

export interface QrisGenerateResult {
  responseCode: string;
  responseMessage: string;
  /** Raw QRIS payload — render the QR image yourself. */
  qrContent?: string;
  referenceNo?: string;
  /** Duitku's own QR page. */
  redirectUrl?: string;
}

/** CHANNEL-ID values. `DUITKU` for VA calls, `DUITKU-PAYMENT` for VA notifications. */
export type ChannelId = 'DUITKU' | 'DUITKU-PAYMENT' | 'OL' | 'SL' | 'SA' | 'DA' | 'SP' | 'GQ' | 'DQ' | 'NQ' | (string & {});
