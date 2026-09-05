/**
 * Disbursement bank codes. Prefer {@link DisbursementClient.listBank} at runtime —
 * it also returns each bank's transfer ceiling, which changes.
 */
export const BankCode = {
  BRI: '002', MANDIRI: '008', BNI: '009', DANAMON: '011', PERMATA: '013', BCA: '014',
  MAYBANK: '016', PANIN: '019', CIMB_NIAGA: '022', UOB: '023', OCBC_NISP: '028', CITI: '031',
  ARTHA_GRAHA: '037', DBS: '046', STANDARD_CHARTERED: '050', HSBC: '087',
  BJB: '110', DKI: '111', BPD_DIY: '112', JATENG: '113', JATIM: '114', JAMBI: '115',
  ACEH: '116', SUMUT: '117', NAGARI: '118', RIAU_KEPRI: '119', SUMSEL_BABEL: '120',
  LAMPUNG: '121', KALSEL: '122', KALBAR: '123', KALTIMTARA: '124', KALTENG: '125',
  SULSELBAR: '126', SULUT_GO: '127', NTB_SYARIAH: '128', BPD_BALI: '129', NTT: '130',
  MALUKU_MALUT: '131', PAPUA: '132', BENGKULU: '133', SULTENG: '134', SULTRA: '135',
  BANTEN: '137', MUAMALAT: '147', SHINHAN: '152', SINARMAS: '153', MASPION: '157',
  GANESHA: '161', QNB: '167', BTN: '200', BTPN: '213', BJB_SYARIAH: '425', MEGA: '426',
  KB_BUKOPIN: '441', BSI: '451', KEB_HANA: '484', MNC: '485', NEO_COMMERCE: '490',
  BRI_AGRONIAGA: '494', BLU_BCA_DIGITAL: '501', NOBU: '503', MEGA_SYARIAH: '506',
  INA_PERDANA: '513', SAHABAT_SAMPOERNA: '523', AMAR: '531', SEABANK: '535',
  BCA_SYARIAH: '536', JAGO: '542', BTPN_SYARIAH: '547', MULTIARTA_SENTOSA: '548',
  MAYORA: '553', SUPERBANK: '562', VICTORIA: '566', ALLO_BANK: '567', LINKAJA_BANK: '911',
  ALADIN_SYARIAH: '947', COMMONWEALTH: '950',

  /** E-wallet destinations. */
  OVO: '1010', GOPAY: '1011', DANA: '1012', SHOPEEPAY: '1013', LINKAJA: '1014',

  /** Cash out destinations. */
  INDOMARET: '2010', POS_INDONESIA: '2011',
} as const;

export type BankCodeValue = (typeof BankCode)[keyof typeof BankCode];

/** Cash out limits, in IDR. Indomaret amounts must be multiples of 50,000. */
export const CASH_OUT_LIMITS = {
  [BankCode.INDOMARET]: { min: 50_000, max: 1_000_000, multipleOf: 50_000 },
  [BankCode.POS_INDONESIA]: { min: 50_000, max: 2_000_000, multipleOf: 1 },
} as const;
