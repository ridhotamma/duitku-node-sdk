---
name: duitku-integration
description: Integrate Duitku, the Indonesian payment gateway, for accepting payments (virtual account, QRIS, e-wallet, credit card, retail, paylater) and sending money (disbursement, clearing, cash out). Covers the v2 Redirect API, Duitku Pop checkout, the BI-SNAP API (Fixed VA, Direct Debit, QRIS MPM), disbursement APIs, signature generation and callback verification. Use this skill whenever the user mentions Duitku, duitku.com, merchantCode/apiKey pairs, `passport.duitku.com`, `sandbox.duitku.com`, `snap.duitku.com`, or asks about Indonesian payment gateway integration, VA numbers, QRIS payments, payment callbacks, or disbursement to Indonesian bank accounts — even if they don't name Duitku explicitly but the code or endpoints clearly belong to it.
---

# Duitku Integration

Duitku is an Indonesian payment gateway. It has two halves:

- **Payment Gateway** — collect money from customers (VA, QRIS, e-wallet, card, retail, paylater).
- **Disbursement** — send money out (bank transfer, clearing, cash out at Indomaret/Pos).

Everything is HTTP POST + JSON, authenticated with a hashed signature. There is no OAuth
except in the SNAP product line, which uses RSA keys and bearer tokens.

## Read this first: the signature migration

**As of April 2026, Duitku upgraded the v2 Payment API to HMAC-SHA256. Plain MD5 and plain
SHA256 are marked obsolete.** The Indonesian docs (`docs.duitku.com/api/id`) reflect this;
the English docs (`/api/en`) still show the old MD5 formulas and are stale. Always trust
the Indonesian page for the v2 API, and treat any MD5 example you find online — including
in Duitku's own English docs, sample projects, and community SDKs — as legacy.

| Product | Signature algorithm | Notes |
|---|---|---|
| v2 Payment API (inquiry, status, callback, getPaymentMethod) | `HMAC_SHA256(stringToSign, apiKey)`, hex lowercase | Migrated Apr 2026. MD5/SHA256 obsolete. |
| Duitku Pop (createInvoice) | `SHA256(merchantCode + timestamp + apiKey)` in headers | Plain SHA256, not HMAC. Sent as `x-duitku-signature`. |
| Disbursement / Clearing / Cash Out | `SHA256(concatenated fields + secretKey)` | Plain SHA256. Uses `secretKey`, not `apiKey`. |
| SNAP API | HMAC-SHA512 (requests) / SHA256withRSA (notifications) | See `references/snap-api.md`. |

When writing a callback verifier, compute HMAC-SHA256 and compare with
`hash_equals` / `crypto.timingSafeEqual`. If the merchant account has not been migrated yet
and signatures fail in production, log the received signature alongside all three candidate
hashes to identify which scheme the account is on — do **not** silently accept whichever
one matches, because that defeats the purpose.

## Choosing an integration path

Ask which one the user wants before writing code. If they don't know, this is the decision:

| Path | Use when | Docs |
|---|---|---|
| **v2 Redirect API** (`/webapi/api/merchant/v2/inquiry`) | You want to pick the payment channel yourself, or render your own VA / QR page. Most common. | `references/v2-api.md` |
| **Duitku Pop** (`/api/merchant/createInvoice`) | You want Duitku's hosted checkout — a JS popup or a full-page redirect where the customer picks the channel. Fastest to ship. | `references/pop-api.md` |
| **SNAP API** (`snap.duitku.com`) | You need **Fixed/static VA**, account-linked direct debit, or QRIS MPM; or Bank Indonesia SNAP compliance is required. Needs ASPI approval + RSA key exchange. | `references/snap-api.md` |
| **Disbursement API** | You are paying money out. Separate feature, must be enabled on the account, uses a different credential (`secretKey` + `userId`). | `references/disbursement.md` |
| **CMS plugin** | WordPress/WooCommerce, Magento, etc. Point them at the plugin list rather than writing code. | `docs.duitku.com/payment-gateway/plugin/` |

## Credentials and environments

Every project registered at `passport.duitku.com/merchant/Project` yields a
**merchantCode** (`DXXXX`, project identifier) and an **apiKey** (32-char secret). Sandbox
and production are separate projects with separate credentials — a sandbox key will not
work in production.

Some older code and SDKs call the apiKey `merchantKey`. Same thing. Disbursement uses a
different secret called `secretKey` plus a numeric `userId`, issued when the feature is
activated.

| Product | Sandbox host | Production host |
|---|---|---|
| v2 Payment API | `https://sandbox.duitku.com` | `https://passport.duitku.com` |
| Duitku Pop | `https://api-sandbox.duitku.com` | `https://api-prod.duitku.com` |
| Pop checkout page / JS | `https://app-sandbox.duitku.com` | `https://app-prod.duitku.com` |
| SNAP | `https://snapdev.duitku.com` | `https://snap.duitku.com` |
| Disbursement (transfer/clearing) | `https://sandbox.duitku.com` | `https://passport.duitku.com` |
| Disbursement (cash out) | `https://disbursement-sandbox.duitku.com` | `https://disbursement.duitku.com` |

Never hardcode keys. Put them in environment variables and keep the sandbox/production
switch in one place.

## The core flow (v2 API)

```
1. (optional) getPaymentMethod   → list of channels + fees for this amount
2. inquiry                       → reference, paymentUrl, vaNumber, qrString
3. customer pays
4. Duitku POSTs your callbackUrl → verify signature, mark order paid
5. Duitku redirects to returnUrl → display only, never trust for status
6. (optional) transactionStatus  → authoritative re-check
```

### Request a transaction

`POST {host}/webapi/api/merchant/v2/inquiry` — `application/json`

```php
$stringToSign = $merchantCode . $merchantOrderId . $paymentAmount;
$signature    = hash_hmac('sha256', $stringToSign, $apiKey);
```

```javascript
const signature = crypto
  .createHmac('sha256', apiKey)
  .update(`${merchantCode}${merchantOrderId}${paymentAmount}`)
  .digest('hex');
```

```python
signature = hmac.new(
    api_key.encode(), f"{merchant_code}{merchant_order_id}{payment_amount}".encode(), hashlib.sha256
).hexdigest()
```

Required body fields: `merchantCode`, `paymentAmount` (integer, no decimals),
`paymentMethod` (2-char code), `merchantOrderId` (unique per request, max 50),
`productDetails`, `email`, `customerVaName` (max 20), `callbackUrl`, `returnUrl`,
`signature`. Optional: `expiryPeriod` (minutes), `itemDetails`, `customerDetail`,
`phoneNumber`, `additionalParam` (URL-encode it), `creditCardDetail`, `accountLink`.

Response gives `reference` (store it), `paymentUrl`, and channel-specific fields:
`vaNumber` for VA, `qrString` for QRIS (render it into a QR image yourself), `appUrl` for
e-commerce deeplinks.

### Verify the callback

`Content-Type: application/x-www-form-urlencoded`, POSTed to your `callbackUrl`.

```php
$stringToSign  = $merchantCode . $amount . $merchantOrderId;   // note: different order
$calcSignature = hash_hmac('sha256', $stringToSign, $apiKey);
if (!hash_equals($calcSignature, $signature)) { throw new Exception('Bad Signature'); }
```

The callback carries `resultCode` (`00` success, `01` failed), `reference`,
`publisherOrderId`, `paymentCode`, `settlementDate`, and for QRIS `issuerCode` +
`customerName`. Callback requirements: port 80 or 443, publicly reachable, must return
HTTP 200. Duitku retries up to 5 times, then emails a failure notice; you can resend
manually from the dashboard report menu.

Duitku's outgoing IPs for whitelisting —
production: `182.23.85.8/9/10/13/14`, `103.177.101.184/185/186/189/190`;
sandbox: `182.23.85.11/12`, `103.177.101.187/188`.

### Do not trust the redirect

`returnUrl` receives `merchantOrderId`, `reference`, `resultCode` as GET params. The
customer can edit that URL. Use it for UI only. Update order state from the callback, or
confirm with `transactionStatus`.

### Check status

`POST {host}/webapi/api/merchant/transactionStatus` with `merchantCode`,
`merchantOrderId`, `signature = HMAC_SHA256(merchantCode + merchantOrderId, apiKey)`.
Returns `statusCode`: `00` success, `01` pending/process, `02` failed/expired/canceled.

Do not poll this on a cron. Duitku rate-limits it and will block you for about an hour if
you hit the ceiling. Call it on callback receipt and on user-initiated refresh.

## Things that break integrations

- **`merchantOrderId` must be new for every request.** Retrying with the same ID while the
  first is in flight returns 409; retrying with the same ID and a different amount returns
  400 on Pop.
- **`itemDetails` prices must sum exactly to `paymentAmount`**, or you get HTTP 409.
- **Amounts are integers.** No decimal separator, no decimal digits. Minimum 10,000 IDR.
- **`customerVaName` is capped at 20 chars** and is mandatory for VA and e-commerce channels.
- **Paylater (`DN`, `AT`) requires `customerDetail` and `itemDetails`.**
- **Signature field order differs between endpoints.** Inquiry is
  `merchantCode + merchantOrderId + paymentAmount`; callback is
  `merchantCode + amount + merchantOrderId`. Mixing them up is the most common cause of
  "Wrong signature" (HTTP 401).
- **Timestamps for Pop are Unix milliseconds in Jakarta time**; SNAP wants ISO-8601 with
  offset. SNAP rejects timestamps older than a few minutes; disbursement rejects them after
  5 minutes (`-960`).
- **Callback handlers must be idempotent.** Retries mean you will receive the same
  successful payment more than once.

## Reference files

Read the one matching the task rather than all of them.

- `references/v2-api.md` — full v2 field tables, response shapes, Fixed VA and OVO H2H pointers.
- `references/pop-api.md` — createInvoice, `duitku.js` checkout object, window-redirect mode.
- `references/snap-api.md` — RSA registration, token, HMAC-SHA512 and RSA signatures, VA lifecycle, direct debit, QRIS MPM, refunds.
- `references/disbursement.md` — transfer online, clearing (LLG/RTGS/H2H/BI-FAST), cash out, balance, bank list, response codes.
- `references/codes-and-testing.md` — payment method codes, expiry periods, HTTP/status codes, QRIS issuer list, disbursement bank codes, sandbox test credentials.

## Official sources

- Docs hub: `https://docs.duitku.com/`
- v2 API (authoritative, Indonesian): `https://docs.duitku.com/api/id/`
- Duitku Pop: `https://docs.duitku.com/pop/en/`
- SNAP: `https://docs.duitku.com/snap-api/id/`
- Disbursement: `https://docs.duitku.com/disbursement/id/`
- Official libraries: `duitkupg/duitku-php` (Packagist), `duitku` (npm), `duitku-python` (PyPI).
  They lag the API — verify the signature algorithm in any SDK before trusting it.

When the docs and this skill disagree, the docs win: fetch the relevant page and check the
changelog at the bottom.
