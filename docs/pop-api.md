# Duitku Pop (hosted checkout)

Source: https://docs.duitku.com/pop/en/

Duitku Pop renders Duitku's own checkout — either as a JS popup over your page or as a
full-page redirect. The customer picks the channel there, so you don't have to build a
channel selector.

## Flow

1. Customer checks out on your site.
2. Your server calls `createInvoice` → gets `reference` and `paymentUrl`.
3. You either (a) render a page that calls `checkout.process(reference, options)` from
   `duitku.js`, or (b) redirect the browser straight to `paymentUrl`.
4. Customer pays. Duitku JS fires your success/pending/error/close callback.
5. Duitku POSTs your `callbackUrl` server-side — this is the authoritative status.

## createInvoice

```
POST https://api-sandbox.duitku.com/api/merchant/createInvoice     # sandbox
POST https://api-prod.duitku.com/api/merchant/createInvoice        # production
Content-Type: application/json
Accept: application/json
```

### Headers (this is the whole auth mechanism)

| Header | Value |
|---|---|
| `x-duitku-merchantcode` | Your merchant code, e.g. `DXXXX`. |
| `x-duitku-timestamp` | Unix timestamp in **milliseconds**, Jakarta timezone. |
| `x-duitku-signature` | `SHA256(merchantCode + timestamp + apiKey)` — plain SHA256, not HMAC. |

```php
$timestamp = round(microtime(true) * 1000);
$signature = hash('sha256', $merchantCode . $timestamp . $apiKey);
```

```javascript
const timestamp = Date.now();
const signature = crypto
  .createHash('sha256')
  .update(`${merchantCode}${timestamp}${apiKey}`)
  .digest('hex');
```

A frequent bug in Duitku's own PHP sample: `$timestamp` is computed *after* the signature
line, so the signature hashes an empty string. Compute the timestamp first and reuse the
same value in both the signature and the header.

### Body

Note there is **no `merchantCode` and no `signature` in the body** — both live in headers.

| Parameter | Type | Req | Description |
|---|---|---|---|
| `paymentAmount` | integer | Y | No decimals. |
| `merchantOrderId` | string(50) | Y | Unique per invoice. |
| `productDetails` | string(255) | Y | |
| `email` | string(255) | Y | |
| `returnUrl` | string(255) | Y | Redirect target after finish/cancel. |
| `callbackUrl` | string(255) | Y | Server-to-server notification. |
| `customerVaName` | string(20) | N | Shown on bank confirmation. |
| `phoneNumber` | string(50) | N | |
| `additionalParam` | string(255) | N | Echoed in the callback. |
| `merchantUserInfo` | string(255) | N | |
| `itemDetails` | array | N | Must sum to `paymentAmount`. |
| `customerDetail` | object | N | Same shape as the v2 API. |
| `creditCardDetail` | object | N | `acquirer`, `binWhitelist`. |
| `expiryPeriod` | integer | N | Minutes. |
| `paymentMethod` | string(2) | N | Set it to skip the channel picker and go straight to one channel. |

### Response

```json
{
  "merchantCode": "DXXXX",
  "reference": "DXXXXS875LXXXX32IJZ7",
  "paymentUrl": "https://app-sandbox.duitku.com/redirect_checkout?reference=DXXXXS875LXXXX32IJZ7",
  "statusCode": "00",
  "statusMessage": "SUCCESS"
}
```

## Frontend: duitku.js

```html
<!-- sandbox -->
<script src="https://app-sandbox.duitku.com/lib/js/duitku.js"></script>
<!-- production -->
<script src="https://app-prod.duitku.com/lib/js/duitku.js"></script>
```

```javascript
checkout.process(reference, {
  defaultLanguage: "id",                  // "id" or "en"
  successEvent: function (result) { /* resultCode 00 */ },
  pendingEvent: function (result) { /* resultCode 01 */ },
  errorEvent:   function (result) { /* payment error */ },
  closeEvent:   function (result) { /* popup closed without paying (02) */ }
});
```

The callback object is `{ resultCode, merchantOrderId, reference }`. Treat these as UI
hints only — the server callback is what updates the order.

Supported browsers: Chrome 26+, Firefox 29+, IE 10+, Safari 6+ on desktop; Chrome 32+,
Android 4.4+, Safari 8+ on mobile.

## Window redirection (no JS needed)

Send the browser to the `paymentUrl` from the response:

```
https://app-sandbox.duitku.com/redirect_checkout?reference=DXXXXS875LXXXX32IJZ7&lang=en
```

Query params: `lang=id|en`, and `currency=USD|EUR` to display an estimated converted
amount (display only; the charge is still IDR and rates move).

After payment the customer is sent to your `returnUrl` with `merchantOrderId`,
`reference`, `resultCode`.

## Callback

Same shape as the v2 API callback: `x-www-form-urlencoded` POST with `merchantCode`,
`amount`, `merchantOrderId`, `productDetail`, `additionalParam`, `paymentCode`,
`resultCode`, `merchantUserId`, `reference`, `signature`, `publisherOrderId`,
`spUserHash`, `settlementDate`, `issuerCode`.

The published Pop callback example still shows `MD5(merchantCode + amount +
merchantOrderId + apiKey)`, but the v2 API callback migrated to
`HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)` in April 2026 and callbacks
are emitted by the same subsystem. Implement HMAC-SHA256, and if verification fails on a
live account, log the received signature next to the HMAC-SHA256 and MD5 candidates to see
which scheme that account is on before changing anything. Do not accept "any match".

`resultCode`: `00` success, `02` failed.
Redirect `resultCode`: `00` paid, `01` not yet paid, `02` canceled/failed.

## Errors

| Code | Meaning |
|---|---|
| 400 | Bad request. |
| 400 | "Amount is different please try again later." — same `merchantOrderId` re-sent with a different amount. |
| 401 | Unauthorized — signature, timestamp, or merchant code is wrong. |
| 404 | Endpoint not recognised. |
| 409 | "The transaction is still in progress." — same `merchantOrderId` re-sent while the first is processing. |
| 500 | Duitku server error. |

Sample project: `https://github.com/duitkupg/sample-project-duitku-pop`
