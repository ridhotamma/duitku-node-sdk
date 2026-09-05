/**
 * `paymentMethod` codes for the v2 inquiry and (optionally) Pop `createInvoice`.
 *
 * Use the object for readable call sites: `PaymentMethod.BCA_VA`.
 */
export const PaymentMethod = {
  /** Visa / Mastercard / JCB. */
  CREDIT_CARD: 'VC',

  BCA_VA: 'BC',
  MANDIRI_VA: 'M2',
  MAYBANK_VA: 'VA',
  BNI_VA: 'I1',
  CIMB_VA: 'B1',
  PERMATA_VA: 'BT',
  ATM_BERSAMA_VA: 'A1',
  ARTHA_GRAHA_VA: 'AG',
  BNC_VA: 'NC',
  BRI_VA: 'BR',
  SAMPOERNA_VA: 'S1',
  DANAMON_VA: 'DM',
  BSI_VA: 'BV',

  /** Pegadaian / ALFA / Pos. */
  RETAIL_ALFA: 'FT',
  RETAIL_INDOMARET: 'IR',

  OVO: 'OV',
  SHOPEEPAY_APPS: 'SA',
  /** LinkAja Apps, fixed fee. */
  LINKAJA_FIXED: 'LF',
  /** LinkAja Apps, percentage fee. */
  LINKAJA_PERCENT: 'LA',
  DANA: 'DA',
  SHOPEEPAY_LINK: 'SL',
  OVO_LINK: 'OL',

  QRIS_SHOPEEPAY: 'SP',
  QRIS_NOBU: 'NQ',
  QRIS_GUDANG_VOUCHER: 'GQ',
  QRIS_NUSAPAY: 'SQ',

  PAYLATER_INDODANA: 'DN',
  PAYLATER_ATOME: 'AT',

  JENIUS_PAY: 'JP',

  TOKOPEDIA_CARD: 'T1',
  TOKOPEDIA_EWALLET: 'T2',
  TOKOPEDIA_OTHERS: 'T3',
} as const;

export type PaymentMethodCode = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** Channels that require `customerDetail` **and** `itemDetails` on the inquiry. */
export const PAYLATER_METHODS: readonly string[] = [PaymentMethod.PAYLATER_INDODANA, PaymentMethod.PAYLATER_ATOME];

/** E-commerce channels that require `customerVaName`. */
export const ECOMMERCE_METHODS: readonly string[] = [
  PaymentMethod.TOKOPEDIA_CARD,
  PaymentMethod.TOKOPEDIA_EWALLET,
  PaymentMethod.TOKOPEDIA_OTHERS,
];

/** Minimum transaction amount accepted by Duitku, in IDR. */
export const MIN_PAYMENT_AMOUNT = 10_000;
