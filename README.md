# duitku-node-sdk

Unofficial, TypeScript-first SDK for [Duitku](https://duitku.com), the Indonesian payment
gateway. Works in Node 18+ and Bun. **Zero runtime dependencies** — just `fetch` and
`node:crypto`.

Covers all four product lines:

| Module | What it does |
|---|---|
| `duitku.v2` | v2 Redirect API — you pick the channel, render your own VA / QR page |
| `duitku.pop` | Duitku Pop — Duitku's hosted checkout (popup or redirect) |
| `duitku.snap` | BI-SNAP — Fixed VA, direct debit, QRIS MPM |
| `duitku.disbursement` | Paying money out — transfer, clearing, cash out |

All signatures follow the **April 2026 HMAC-SHA256 migration** for the v2 API. MD5 is
implemented only as a diagnostic helper, never as an accepted signature.

## Install

```bash
npm install duitku-node-sdk
```

## Quick start

```ts
import { Duitku, PaymentMethod } from 'duitku-node-sdk';

const duitku = new Duitku({
  merchantCode: process.env.DUITKU_MERCHANT_CODE!,
  apiKey: process.env.DUITKU_API_KEY!,
  environment: 'sandbox', // default; switch to 'production' explicitly
});

const payment = await duitku.v2.createPayment({
  paymentAmount: 40_000,
  merchantOrderId: `order-${Date.now()}`,
  paymentMethod: PaymentMethod.BCA_VA,
  productDetails: 'Payment for Example Store',
  email: 'customer@example.com',
  customerVaName: 'John Doe',
  callbackUrl: 'https://example.com/duitku/callback',
  returnUrl: 'https://example.com/thanks',
  expiryPeriod: 1440,
});

console.log(payment.reference, payment.vaNumber, payment.paymentUrl);
```

Or build the client from environment variables:

```ts
const duitku = Duitku.fromEnv(); // DUITKU_MERCHANT_CODE, DUITKU_API_KEY, DUITKU_ENV, ...
```

The SDK never reads credentials implicitly — `fromEnv()` is opt-in and everything else is
explicit. Keep keys in environment variables; sandbox and production are separate projects
with separate keys.

## Handling the callback

The callback is the **only** authoritative signal. `parseCallback` verifies the signature in
constant time and throws `DuitkuSignatureError` on a mismatch.

```ts
import express from 'express';
import { DuitkuSignatureError } from 'duitku-node-sdk';

const app = express();
app.use(express.urlencoded({ extended: false })); // Duitku posts form-encoded

app.post('/duitku/callback', async (req, res) => {
  let payload;
  try {
    payload = duitku.v2.parseCallback(req.body);
  } catch (err) {
    if (err instanceof DuitkuSignatureError) return res.status(400).send('Bad Signature');
    throw err;
  }

  // Duitku retries up to 5 times — this handler must be idempotent.
  if (payload.isPaid) {
    await markOrderPaidOnce(payload.merchantOrderId, payload.reference, payload.amount);
  }

  res.status(200).send('OK'); // Duitku requires a 200
});
```

Requirements Duitku imposes on your endpoint: reachable from the public internet on port
80 or 443, and it must return HTTP 200. Duitku's outgoing IPs are exported as
`CALLBACK_IPS` for firewall allowlists.

**Never trust `returnUrl`.** The customer can edit it. Use it to render a status page only.

### Accounts still on legacy signatures

If verification fails on a live account, do not loosen the check. Log which scheme it is on:

```ts
const { matched, candidates } = duitku.v2.diagnoseCallbackSignature(req.body);
logger.warn({ matched, candidates, received: req.body.signature }, 'duitku signature mismatch');
```

## Checking status

```ts
const status = await duitku.v2.getTransactionStatus(merchantOrderId);
// statusCode: '00' success | '01' pending | '02' canceled/failed/expired
```

Do not poll this on a cron — Duitku rate-limits it and will block you for roughly an hour.
Call it on callback receipt and on user-initiated refresh.

## Duitku Pop (hosted checkout)

```ts
const invoice = await duitku.pop.createInvoice({
  paymentAmount: 40_000,
  merchantOrderId: `order-${Date.now()}`,
  productDetails: 'Example order',
  email: 'customer@example.com',
  returnUrl: 'https://example.com/thanks',
  callbackUrl: 'https://example.com/duitku/callback',
});

// Redirect flow:
res.redirect(duitku.pop.checkoutUrl(invoice.reference, { lang: 'id' }));

// Or popup flow — script tag for the current environment:
duitku.pop.checkoutScriptUrl; // https://app-sandbox.duitku.com/lib/js/duitku.js
```

```html
<script src="https://app-sandbox.duitku.com/lib/js/duitku.js"></script>
<script>
  checkout.process(reference, {
    defaultLanguage: 'id',
    successEvent: (r) => { /* UI only — the server callback is authoritative */ },
    pendingEvent: (r) => {},
    errorEvent:   (r) => {},
    closeEvent:   (r) => {},
  });
</script>
```

Pop callbacks are verified with `duitku.pop.parseCallback(req.body)`.

## Disbursement

Needs its own credentials (`userId`, `email`, `secretKey`), issued when the feature is
activated on the account.

```ts
const duitku = new Duitku({
  merchantCode, apiKey, environment: 'sandbox',
  disbursement: {
    userId: process.env.DUITKU_DISBURSEMENT_USER_ID!,
    email: process.env.DUITKU_DISBURSEMENT_EMAIL!,
    secretKey: process.env.DUITKU_DISBURSEMENT_SECRET_KEY!,
  },
});

const balance = await duitku.disbursement.checkBalance();
// Gate transfers on effectiveBalance, not balance.

const inquiry = await duitku.disbursement.inquiry({
  amountTransfer: 100_000,
  bankAccount: '8760673566',
  bankCode: BankCode.BCA,
  purpose: 'Payout',
});

// Show inquiry.accountName to the user before committing.
const transfer = await duitku.disbursement.transfer({
  ...inquiry,
  amountTransfer: 100_000,
  bankAccount: '8760673566',
  bankCode: BankCode.BCA,
  purpose: 'Payout',
});
```

Codes `TO`, `68` and `-100` mean the transfer *may* have gone through. The SDK raises
`DuitkuNonRetryableError` for these so a retry loop cannot double-pay — reconcile with
`inquiryStatus(disburseId)` instead.

Clearing (H2H) and cash out callbacks are verified with `parseClearingCallback` /
`parseCashOutCallback`, and Duitku expects the literal string `SUCCESS` in reply.

## SNAP

SNAP is not self-service — the merchant must pass the ASPI and Duitku functional tests and
exchange RSA keys with `snap@duitku.com` first.

```ts
const duitku = new Duitku({
  merchantCode, apiKey, environment: 'sandbox',
  snap: {
    privateKey: fs.readFileSync('PrivateKey.pem', 'utf8'),
    duitkuPublicKey: fs.readFileSync('DuitkuPublicKey.pem', 'utf8'),
  },
});

const va = await duitku.snap.createVa({
  partnerServiceId: '123456',
  customerNo: '1234567890',
  virtualAccountNo: '1234561234567890',
  virtualAccountName: 'John Doe',
  trxId: 'Transaction-0001',
  totalAmount: { value: '120000.00', currency: 'IDR' },
  virtualAccountTrxType: 'C',
});
```

Access tokens (900s) are cached and refreshed automatically, and concurrent callers share a
single in-flight token request.

Verifying a SNAP notification needs the **raw body bytes** — re-serializing a parsed object
changes the hash:

```ts
app.post('/v1.0/transfer-va/payment', express.raw({ type: '*/*' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  const ok = duitku.snap.verifyNotification({
    endpoint: '/v1.0/transfer-va/payment',
    rawBody,
    timestamp: req.header('X-TIMESTAMP')!,
    signature: req.header('X-SIGNATURE')!,
  });
  if (!ok) return res.status(401).json({ responseCode: '4012500', responseMessage: 'Unauthorized' });

  const notification = JSON.parse(rawBody);
  // ... mark paid, idempotently
  res.json({ responseCode: '2002500', responseMessage: 'Successful' });
});
```

Endpoints the SDK does not wrap are reachable through the signed escape hatch:

```ts
await duitku.snap.call({ method: 'POST', endpoint: '/merchant/...', channelId: 'DUITKU', body });
```

## Errors

| Class | When |
|---|---|
| `DuitkuConfigError` | Bad credentials or a request the SDK rejects before sending (amount below 10,000, `itemDetails` mismatch, paylater missing `customerDetail`) |
| `DuitkuApiError` | Non-2xx, or a 200 carrying a failure code. Exposes `status`, `code`, `body`, `endpoint` |
| `DuitkuSignatureError` | A callback or notification signature did not verify |
| `DuitkuNonRetryableError` | A disbursement result that must never be retried |

## Validation done for you

Caught client-side, before the request goes out:

- `paymentAmount` must be an integer of at least 10,000 IDR
- `merchantOrderId` at most 50 chars; `customerVaName` at most 20
- `itemDetails` — the sum of the raw `price` fields must equal `paymentAmount` exactly (see below)
- Paylater channels (`DN`, `AT`) require `customerDetail` and `itemDetails`
- Pop's timestamp is computed once and reused in both the signature and the header

## `itemDetails`: `price` is the line total

Duitku sums the raw `price` fields and **ignores `quantity`**. So `price` must already be
the total for that line, not the unit price:

```ts
itemDetails: [
  { name: 'Item 1', price: 10_000, quantity: 1 },  // line total 10,000
  { name: 'Item 2', price: 30_000, quantity: 3 },  // line total 30,000 (unit price 10,000)
]
// sum(price) = 40,000 → must equal paymentAmount
```

The example in Duitku's own docs (`10000 x1 + 10000 x3` against a `paymentAmount` of
40,000) does **not** work — the sandbox rejects it with
`409 Payment amount must be equal to all item price`. This SDK validates the rule that the
live API actually enforces, verified against the sandbox, and fails locally before spending
a round trip.

## Sandbox behaviour worth knowing

Observed against a live sandbox project, where it differs from the published docs:

- **A bad signature returns HTTP 403**, not the documented 401. Both surface as
  `DuitkuApiError`; branch on `err.status` only if you must.
- **A reused `merchantOrderId` is not reliably rejected.** The docs promise 409, but the
  sandbox accepted a resubmit — returning the *same* `reference` with a *different*
  `vaNumber`. Treat uniqueness as your responsibility: generate a fresh
  `merchantOrderId` per attempt, or you risk a customer paying a stale VA number.
- **`getPaymentMethods` is the source of truth for channels.** A fresh project may list
  channels the docs call retired (e.g. `LQ` LinkAja QRIS), and omit ones you expected.

## Constants

`PaymentMethod`, `BankCode`, `TransactionStatus`, `CallbackResult`, `DisbursementStatus`,
`HOSTS`, `CALLBACK_IPS`, `CASH_OUT_LIMITS`, `MIN_PAYMENT_AMOUNT` are all exported.

## Testing

Sandbox credentials, test cards, and per-channel simulator details are in
[`docs/codes-and-testing.md`](docs/codes-and-testing.md).

Every client accepts a `fetch` override, so you can test your integration without network:

```ts
const duitku = new Duitku({ merchantCode, apiKey, fetch: myStubFetch });
```

```bash
npm test        # node:test, no network
npm run typecheck
npm run build
```

## License

MIT
