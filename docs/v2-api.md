# Duitku v2 Payment API

Source: https://docs.duitku.com/api/id/ (Indonesian page is authoritative — the English
page still documents the retired MD5 signatures).

Contents: Get Payment Method · Request Transaction · Response · Callback · Redirect ·
Check Transaction · JSON objects · Fixed VA & OVO H2H.

---

## Get Payment Method (optional)

Returns the channels enabled on your project for a given amount, with fees and logo URLs.
Skip it if you already know the `paymentMethod` code you want.

```
POST {host}/webapi/api/merchant/paymentmethod/getpaymentmethod
Content-Type: application/json
```

| Field | Type | Req | Notes |
|---|---|---|---|
| `merchantcode` | string(50) | Y | Lowercase `c` here — unlike every other endpoint. |
| `amount` | integer | Y | No decimals. |
| `datetime` | string | Y | `yyyy-MM-dd HH:mm:ss` |
| `signature` | string | Y | `HMAC_SHA256(merchantcode + amount + datetime, apiKey)` |

Response:

```json
{
  "paymentFee": [
    { "paymentMethod": "VA", "paymentName": "MAYBANK VA",
      "paymentImage": "https://images.duitku.com/hotlink-ok/VA.PNG", "totalFee": "0" }
  ],
  "responseCode": "00",
  "responseMessage": "SUCCESS"
}
```

`totalFee` shows `0` when the project is configured to charge fees to the merchant; a
non-zero value means the fee is passed to the customer.

---

## Request Transaction (inquiry)

```
POST {host}/webapi/api/merchant/v2/inquiry
Content-Type: application/json
```

Signature: `stringToSign = merchantCode + merchantOrderId + paymentAmount`, then
`HMAC_SHA256(stringToSign, apiKey)` hex lowercase.

| Parameter | Type | Req | Description |
|---|---|---|---|
| `merchantCode` | string(50) | Y | Project code, e.g. `DXXXX`. |
| `paymentAmount` | integer | Y | Total. No decimal point or digits. |
| `merchantOrderId` | string(50) | Y | Your order ID. Must be unique per new transaction. |
| `productDetails` | string(255) | Y | Description of what is being sold. |
| `email` | string(255) | Y | Customer email. Max 50 chars in practice (400 error above). |
| `paymentMethod` | string(2) | Y | Channel code — see `codes-and-testing.md`. |
| `customerVaName` | string(20) | Y | Name shown on the bank confirmation screen. |
| `callbackUrl` | string(255) | Y | Your server-to-server notification endpoint. |
| `returnUrl` | string(255) | Y | Browser redirect after payment/cancel. |
| `signature` | string(255) | Y | See above. |
| `phoneNumber` | string(50) | N | Max 50. |
| `additionalParam` | string(255) | N | Echoed back in the callback. URL-encode the contents. |
| `merchantUserInfo` | string(255) | N | Your customer's username/email on your site. |
| `expiryPeriod` | int | N | Minutes. Defaults and caps vary per channel. |
| `itemDetails` | array | N | Line items. Sum of `price` must equal `paymentAmount`. |
| `customerDetail` | object | N | Mandatory for paylater channels. |
| `creditCardDetail` | object | N | Acquirer selection and BIN whitelist. |
| `accountLink` | object | N | Mandatory for `OL` (OVO) and `SL` (ShopeePay) account link. |

Extra requirements: paylater (`DN`, `AT`) needs both `customerDetail` and `itemDetails`;
e-commerce channels (`T1`, `T2`, `T3`) need `customerVaName`.

### Example

```bash
curl -X POST 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry' \
  -H 'Content-Type: application/json' \
  -d '{
    "merchantCode": "DXXXX",
    "paymentAmount": 40000,
    "paymentMethod": "BC",
    "merchantOrderId": "abcde12345",
    "productDetails": "Payment for Example Store",
    "email": "customer@example.com",
    "customerVaName": "John Doe",
    "phoneNumber": "08123456789",
    "itemDetails": [
      { "name": "Test Item 1", "price": 10000, "quantity": 1 },
      { "name": "Test Item 2", "price": 10000, "quantity": 3 }
    ],
    "callbackUrl": "https://example.com/callback",
    "returnUrl": "https://example.com/return",
    "signature": "d842db69f70501fe69487b3d957611c2d4e47335f390a5895b0a762a1bf1f1a0",
    "expiryPeriod": 1440
  }'
```

### Response

```json
{
  "merchantCode": "DXXXX",
  "reference": "DXXXXCX80TZJ85Q70QCI",
  "paymentUrl": "https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=...",
  "vaNumber": "7007014001444348",
  "qrString": "00020101021226660014ID.DANA.WWW...",
  "AppUrl": "https://tokopedia.app.link/?...",
  "amount": "40000",
  "statusCode": "00",
  "statusMessage": "SUCCESS"
}
```

| Field | Use |
|---|---|
| `reference` | Duitku's transaction reference. Persist it — needed for tracing and support. |
| `paymentUrl` | Redirect the customer here to use Duitku's hosted payment page. |
| `vaNumber` | Render on your own page for VA channels. |
| `qrString` | Raw QRIS payload. You generate the QR image from this string. |
| `AppUrl` / `appUrl` | Deeplink into the e-commerce app. Casing varies between docs. |

---

## Callback

```
POST {your callbackUrl}
Content-Type: application/x-www-form-urlencoded
```

Signature: `HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)`.

| Parameter | Description |
|---|---|
| `merchantCode` | Your project code. |
| `amount` | Transaction amount. |
| `merchantOrderId` | Your order ID. |
| `productDetail` | Product description (note: singular here, plural in the request). |
| `additionalParam` | Whatever you sent at inquiry. |
| `paymentCode` | Channel code used. |
| `resultCode` | `00` success, `01` failed. |
| `merchantUserId` | Customer username/email on your site. |
| `reference` | Duitku reference. |
| `signature` | Verify before doing anything else. |
| `publisherOrderId` | Duitku's unique payment number. Keep for reconciliation. |
| `spUserHash` | Present for ShopeePay (QRIS/App/Account Link). |
| `settlementDate` | Estimated settlement, `YYYY-MM-DD`. |
| `issuerCode` | QRIS issuer code — see issuer list. |
| `customerName` | QRIS payer identifier, possibly masked (`Bam**** Maul***`). Added Jun 2026. |

Handler requirements: reachable on port 80/443 from the public internet, respond
HTTP 200. Duitku retries up to 5 times before emailing a failure notice. Manual resend is
available under the dashboard's report menu. Make the handler idempotent.

```php
<?php
$apiKey = getenv('DUITKU_API_KEY');

$merchantCode    = $_POST['merchantCode']    ?? null;
$amount          = $_POST['amount']          ?? null;
$merchantOrderId = $_POST['merchantOrderId'] ?? null;
$signature       = $_POST['signature']       ?? null;
$resultCode      = $_POST['resultCode']      ?? null;
$reference       = $_POST['reference']       ?? null;

if (!$merchantCode || !$amount || !$merchantOrderId || !$signature) {
    http_response_code(400);
    throw new Exception('Bad Parameter');
}

$calc = hash_hmac('sha256', $merchantCode . $amount . $merchantOrderId, $apiKey);
if (!hash_equals($calc, $signature)) {
    http_response_code(400);
    throw new Exception('Bad Signature');
}

// idempotent: only act if the order is not already settled
if ($resultCode === '00') {
    markOrderPaid($merchantOrderId, $reference, $amount);
}
http_response_code(200);
echo 'OK';
```

---

## Redirect

```
GET {your returnUrl}?merchantOrderId=abcde12345&resultCode=00&reference=DXXXXCX80TXXX5Q70QCI
```

`resultCode`: `00` success, `01` pending, `02` canceled.

The URL is user-manipulable. Render a status page from it if you like, but never write
payment state from these parameters.

---

## Check Transaction

```
POST {host}/webapi/api/merchant/transactionStatus
Content-Type: application/json
```

Signature: `HMAC_SHA256(merchantCode + merchantOrderId, apiKey)`.

```json
{
  "merchantOrderId": "abcde12345",
  "reference": "DXXXXCX80TZJ85Q70QCI",
  "amount": "100000",
  "fee": "0.00",
  "statusCode": "00",
  "statusMessage": "SUCCESS"
}
```

`statusCode`: `00` success, `01` pending/process, `02` canceled/failed/expired.

Rate limited with no SLA for cron usage — sustained polling gets you blocked for roughly
an hour.

---

## JSON objects

### itemDetails

```json
"itemDetails": [{ "name": "Apel", "quantity": 2, "price": 50000 }]
```

All three fields required. `price` is per-item and has no decimals. The total across items
must equal `paymentAmount` exactly, otherwise HTTP 409.

### customerDetail

```json
"customerDetail": {
  "firstName": "John", "lastName": "Doe",
  "email": "customer@example.com", "phoneNumber": "08123456789",
  "billingAddress":  { "...": "Address object" },
  "shippingAddress": { "...": "Address object" }
}
```

### Address

`firstName`, `lastName`, `address`, `city`, `postalCode`, `phone`, `countryCode`
(ISO 3166-1 alpha-3 per the docs, though the example shows `ID`). All optional.

### creditCardDetail

```json
"creditCardDetail": { "acquirer": "014", "binWhitelist": ["014", "022", "400000"] }
```

`acquirer`: `014` BCA, `022` CIMB. `binWhitelist` takes 3-digit bank codes or 6-digit
card BINs. The English docs say max 15 entries, the Indonesian docs say 25 — assume 15.

### accountLink (OVO `OL` / ShopeePay `SL`)

```json
"accountLink": {
  "credentialCode": "A0F22572-4AF1-E111-812C-B01224449936",
  "ovo":    { "paymentDetails": [{ "paymentType": "CASH", "amount": "10000" }] },
  "shopee": { "useCoin": false, "promoId": "" }
}
```

`credentialCode` is issued by Duitku after the customer links their account. Account
linking has its own connect/unbind/check-status API set at
`api-sandbox.duitku.com/accountlinking/api/accountlinking/v1/...` with headers
`X-duitku-timestamp`, `X-duitku-merchant`, and
`X-duitku-signature = SHA256(merchantCode + timestamp + requestBody + merchantKey)`.
Full spec is in the Account Linking PDF linked from the API reference.

---

## Fixed VA

A static, merchant-customizable VA number (your prefix plus digits you choose). **Not**
available through the v2 inquiry endpoint — use the SNAP VA API instead. See
`snap-api.md`.

Legacy Fixed VA merchants may still be on an older inquiry/notification flow where your
server answers Duitku's inquiry request with the customer's bill:

- Inquiry request → `action`, `merchantCode`, `bin`, `vaNo`, `session`, `signature`
- Your response → `vaNo`, `name`, `amount` (0 for open payment), `merchantOrderId`,
  `statusCode` (`00` success, `01` not found, `02` already paid, `03` expired, `99` other)

New integrations should use SNAP.

## OVO H2H

Host-to-host OVO payment without redirecting to a Duitku payment page.
Docs: `https://docs.duitku.com/h2h/ovo/id/`.
