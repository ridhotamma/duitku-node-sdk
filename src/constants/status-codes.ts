/** `statusCode` from the v2 inquiry and transaction-status endpoints. */
export const TransactionStatus = {
  SUCCESS: '00',
  /** Pending / in process. */
  PENDING: '01',
  /** Canceled, failed or expired. */
  FAILED: '02',
} as const;

/** `resultCode` on the server-to-server callback. */
export const CallbackResult = {
  SUCCESS: '00',
  FAILED: '01',
} as const;

/** Disbursement `responseCode` values worth branching on. */
export const DisbursementStatus = {
  SUCCESS: '00',
  GENERAL_ERROR: 'EE',
  /** Timeout from the ATM Bersama network. Do not retry — check status instead. */
  TIMEOUT: 'TO',
  LINK_PROBLEM: 'LD',
  NOT_RECORDED: 'NF',
  INVALID_ACCOUNT: '76',
  WAITING_CALLBACK: '80',
  /** Late bank response. Do not retry. */
  LATE_RESPONSE: '68',
  /** Other error. Do not retry. */
  OTHER_ERROR: '-100',
  INSUFFICIENT_FUNDS: '-510',
  INVALID_SIGNATURE: '-191',
  TIMESTAMP_EXPIRED: '-960',
} as const;

/**
 * Disbursement codes where the transfer may already have gone through.
 * Never retry these — reconcile with `inquiryStatus` instead.
 */
export const DISBURSEMENT_DO_NOT_RETRY: readonly string[] = [
  DisbursementStatus.TIMEOUT,
  DisbursementStatus.LATE_RESPONSE,
  DisbursementStatus.OTHER_ERROR,
];
