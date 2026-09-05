/** Which Duitku environment to talk to. */
export type Environment = 'sandbox' | 'production';

/** Hosts per product line. Sandbox and production are separate projects with separate keys. */
export const HOSTS = {
  v2: { sandbox: 'https://sandbox.duitku.com', production: 'https://passport.duitku.com' },
  pop: { sandbox: 'https://api-sandbox.duitku.com', production: 'https://api-prod.duitku.com' },
  popCheckout: { sandbox: 'https://app-sandbox.duitku.com', production: 'https://app-prod.duitku.com' },
  snap: { sandbox: 'https://snapdev.duitku.com', production: 'https://snap.duitku.com' },
  disbursement: { sandbox: 'https://sandbox.duitku.com', production: 'https://passport.duitku.com' },
  cashout: { sandbox: 'https://disbursement-sandbox.duitku.com', production: 'https://disbursement.duitku.com' },
} as const satisfies Record<string, Record<Environment, string>>;

/** Duitku's outgoing IPs, for firewall allowlists. */
export const CALLBACK_IPS = {
  production: ['182.23.85.8', '182.23.85.9', '182.23.85.10', '182.23.85.13', '182.23.85.14',
    '103.177.101.184', '103.177.101.185', '103.177.101.186', '103.177.101.189', '103.177.101.190'],
  sandbox: ['182.23.85.11', '182.23.85.12', '103.177.101.187', '103.177.101.188'],
  snap: ['182.23.85.0/28', '103.177.101.177/28'],
} as const;
