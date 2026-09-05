# Duitku SNAP API

Source: https://docs.duitku.com/snap-api/id/

SNAP (Standar Nasional Open API Pembayaran) is Bank Indonesia's mandated open API standard
(Governor Decree No. 23/10/KEP.GBI/2021, administered by ASPI). Duitku's SNAP surface
covers Virtual Account (including Fixed VA), Direct Debit, and QRIS MPM.

Hosts: `https://snapdev.duitku.com` (sandbox) · `https://snap.duitku.com` (production).

## Onboarding (do this before writing code)

SNAP is not self-service. The merchant must:

1. **Pass the ASPI developer-site test** — register at ASPI, run at least one positive and
   one negative scenario per sub-API.
2. **Pass Duitku's functional test** — end-to-end against the integrated APIs.
3. **Register with Duitku** by sending two emails to `snap@duitku.com` from the account's
   registered email address:
   - Email 1: sandbox project code; which API services are needed (Virtual Account,
     Direct Debit Redirect, Direct Debit Linking, QRIS-MPM); a password-protected ZIP
     containing the RSA public key as `.pem`; and the notification URL(s) matching the
     requested services.
   - Email 2: the ZIP password.

Generate the key pair with OpenSSL, 2048-bit:

```bash
openssl genrsa -out PrivateKey.pem 2048
openssl rsa -in PrivateKey.pem -pubout -out PublicKey.pem
```

Keep the private key on your server. Duitku sends you *their* public key for verifying
notifications.

## Authentication

Three layers: RSA key pair → bearer access token → per-request signature.

### Get access token

```
POST {host}/auth/v1.0/access-token/b2b        Service Code 73
Content-Type: application/json
```

Headers:

| Header | Value |
|---|---|
| `X-TIMESTAMP` | ISO-8601 with offset, e.g. `2022-09-16T13:00:00+07:00` |
| `X-CLIENT-KEY` | Project ID (`DXXXX`) |
| `X-SIGNATURE` | `Base64(SHA256withRSA(clientKey + "|" + timestamp, privateKey))` |

Body: `{ "grantType": "client_credentials" }`

Response: `{ "responseCode": "2007300", "accessToken": "...", "tokenType": "Bearer", "expiresIn": "900" }`

Token lifetime is 900 seconds. Cache it and refresh before expiry rather than fetching one
per request.

Errors: `4007301` bad `grantType` value · `4007302` missing `grantType`, or bad client
key/timestamp/signature · `4017300` invalid client key or signature.

### Symmetric signature (for all merchant→Duitku calls)

```
stringToSign = HttpMethod + ":" + Endpoint + ":" + AccessToken + ":"
             + LowerCase(HexEncode(SHA256(Minify(RequestBody)))) + ":" + Timestamp
signature    = Base64(HMAC_SHA512(stringToSign, clientSecret))
```

`Endpoint` is the path only, no host. `clientSecret` is the project API key.
`Minify(RequestBody)` means the exact serialized JSON you send — hash the same bytes you
transmit, or the signature will not match.

```javascript
function symmetricSignature(date, method, endpoint, body, accessToken, clientSecret) {
  const minifyBody = JSON.stringify(body);
  const encBody = CryptoJS.SHA256(minifyBody).toString().toLowerCase();
  const stringToSign = `${method}:${endpoint}:${accessToken}:${encBody}:${date}`;
  return CryptoJS.HmacSHA512(stringToSign, clientSecret).toString(CryptoJS.enc.Base64);
}
```

### Asymmetric signature (for Duitku→merchant notifications)

Duitku signs notifications with its private key; you verify with Duitku's public key.

```
stringToSign = HttpMethod + ":" + Endpoint + ":"
             + LowerCase(HexEncode(SHA256(Minify(RequestBody)))) + ":" + Timestamp
verify Base64-decoded X-SIGNATURE with SHA256withRSA against Duitku's public key
```

### Standard request headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-TIMESTAMP` | ISO-8601 with offset |
| `X-SIGNATURE` | symmetric (requests) or asymmetric (notifications) |
| `X-PARTNER-ID` | Project ID |
| `X-EXTERNAL-ID` | Unique per request — duplicates return `409` |
| `CHANNEL-ID` | `DUITKU` for VA; `DUITKU-PAYMENT` for VA notifications; the channel code (`OL`, `SL`, `SA`, `DA`, `SP`, `GQ`, `DQ`, `NQ`) for direct debit and QRIS |
| `Authorization` | `Bearer {accessToken}` |

Notification IP ranges to whitelist: `182.23.85.0/28`, `103.177.101.177/28`.

## Virtual Account

Lifecycle: create → (update) → (inquiry) → payment notification → (status) → (delete).
Every call must carry the same `virtualAccountNo` + `trxId` pair.

| Operation | Method | Endpoint | Svc |
|---|---|---|---|
| Create VA | POST | `/merchant/va/v1.0/transfer-va/create-va` | 27 |
| Update VA | PUT | `/merchant/va/v1.0/transfer-va/update-va` | 28 |
| Inquiry VA | POST | `/merchant/va/v1.0/transfer-va/inquiry-va` | 30 |
| Delete VA | DELETE | `/merchant/va/v1.0/transfer-va/delete-va` | 31 |
| Payment notify (you host) | POST | `/v1.0/transfer-va/payment` | 25 |
| Inquiry status | POST | `/merchant/va/v1.0/transfer-va/status` | 26 |

### Create VA body

```json
{
  "partnerServiceId": "123456",
  "customerNo": "1234567890",
  "virtualAccountNo": "1234561234567890",
  "virtualAccountName": "John Doe",
  "trxId": "Transaction-0001",
  "totalAmount": { "value": "120000.00", "currency": "IDR" },
  "virtualAccountTrxType": "C",
  "expiredDate": "2022-10-18T23:27:43+0700",
  "additionalInfo": { "minAmount": "0.00", "maxAmount": "0.00" }
}
```

| Field | Notes |
|---|---|
| `partnerServiceId` | VA prefix issued by Duitku. |
| `customerNo` | The part you choose. |
| `virtualAccountNo` | `partnerServiceId + customerNo`. Keep the total ≤ 16 digits. |
| `virtualAccountName` | Max 20 chars, shown at the bank. |
| `trxId` | Unique per VA creation. Must match on update/inquiry/delete. |
| `virtualAccountTrxType` | `C` = closed amount, `O` = open amount. |
| `totalAmount.value` | Two decimals, e.g. `120000.00`. Set `0.00` for open amount. |
| `additionalInfo.minAmount` / `maxAmount` | Set for open amount (limits come from Duitku). `0.00` for closed. |

Amount constraints: minimum 10,000; maximum 50,000,000.

Success: `2002700` with `virtualAccountData`. Notable errors: `4002701` invalid field
format · `4002702` missing mandatory field · `4012700` unauthorized signature/client ·
`4012701` invalid access token · `4042712` VA already exists · `4092700` duplicate
`X-EXTERNAL-ID`.

### Payment notification (you implement this)

Duitku POSTs to your `https://yourdomain.com/v1.0/transfer-va/payment`. Headers use
`CHANNEL-ID: DUITKU-PAYMENT` and an asymmetric `X-SIGNATURE`.

```json
{
  "partnerServiceId": "123456",
  "customerNo": "1234567890",
  "virtualAccountNo": "1234561234567890",
  "paymentRequestId": "46181",
  "trxId": "Transaction-0001",
  "paidAmount": { "value": "100000.00", "currency": "IDR" },
  "additionalInfo": { "reference": "D0001YB1CUE2ET3027DK", "paymentCode": "M2" }
}
```

Respond `{ "responseCode": "2002500", "responseMessage": "Successful", "virtualAccountData": {...} }`.
Validate the signature first, optionally confirm via Inquiry Status, then mark paid.

Error codes to return where applicable: `4042512` bill not found · `4042513` invalid
amount · `4042514` bill already paid · `4092500` conflict.

### Inquiry status

Body: `partnerServiceId`, `customerNo`, `virtualAccountNo`, `inquiryRequestId` (the
`trxId` from create). Response includes `paymentFlagStatus`: `00` success, `01` process,
`02` expired.

## Direct Debit

| Operation | Endpoint | Svc | CHANNEL-ID |
|---|---|---|---|
| Account binding | `/merchant/registration/v1.0/registration-account-binding` | 07 | `OL`, `SL` |
| Account inquiry | `/merchant/registration/v1.0/registration-account-inquiry` | 08 | `OL`, `SL` |
| Account unbinding | `/merchant/registration/v1.0/registration-account-unbinding` | 09 | `OL`, `SL` |
| Payment (linking or redirect) | `/merchant/debit/v1.0/debit/payment-host-to-host` | 54 | `OL`, `SL` (linking) · `DA`, `SA` (redirect) |
| Payment status | `/merchant/debit/v1.0/debit/status` | 55 | matches the transaction |
| Payment notify (you host) | `/v1.0/debit/notify` | 56 | matches the transaction |
| Refund | `/merchant/debit/v1.0/debit/refund` | 58 | matches the transaction |

**Linking** (OVO `OL`, ShopeePay `SL`) requires binding the customer's phone number first;
the payment call then passes `bankCardToken` (the credential code from binding) and
`additionalInfo.transactionType`: `M` = manual debit (customer enters a PIN, response is
`2025400` "Request In Progress" plus a `webRedirectUrl`), `A` = auto debit (no PIN,
response `2005400`).

**Redirect** (DANA `DA`, ShopeePay Apps `SA`) needs no binding — send `chargeToken`
matching the `CHANNEL-ID`, plus `validUpTo` (ISO-8601 expiry), and redirect the customer
to `webRedirectUrl`.

Payment body essentials: `partnerReferenceNo`, `chargeToken`, `merchantId`,
`amount { value, currency }`, `payOptionDetails[] { payMethod: "CASH", transAmount }`,
`additionalInfo { productDetails, phoneNumber, email, returnUrl, itemDetails,
customerDetail, merchantUserInfo }`.

`latestTransactionStatus`: `00` successful · `03` pending · `04` refunded · `06` failed ·
`07` not found.

Refund body: `partnerRefundNo`, `originalPartnerReferenceNo`, `originalReferenceNo`,
`refundAmount`. Success `2005800`.

## QRIS MPM

| Operation | Endpoint | Svc |
|---|---|---|
| Generate QR | `/merchant/qris/v1.0/qr/qr-mpm-generate` | 47 |
| Query payment | `/merchant/qris/v1.0/qr/qr-mpm-query` | 51 |
| Payment notify (you host) | `/v1.0/qr/qr-mpm-notify` | 52 |
| Refund | `/merchant/qris/v1.0/qr/qr-mpm-refund` | 78 |

`CHANNEL-ID`: `SP` ShopeePay, `GQ` Gudang Voucher, `DQ` DANA, `NQ` Nobu.

Generate body: `partnerReferenceNo`, `validityPeriod` (ISO-8601, **minimum 30 minutes** —
shorter returns `4094700`), `amount`, `additionalInfo` (product details, contact,
`returnUrl`, `itemDetails`, `customerDetail`).

Response returns `qrContent` (the raw QRIS payload you render as a QR code),
`referenceNo`, and a `redirectUrl` to Duitku's own QR page.

Notification carries `originalReferenceNo`, `originalPartnerReferenceNo`,
`latestTransactionStatus`, `amount`, and `additionalInfo` with `issuerCode`,
`paymentMethod`, `publisherOrderId`, `settlementDate`. Respond `2005200`.

## Common SNAP error patterns

- `401xxxx Unauthorized Signature` / `Unauthorized stringToSign` — your `stringToSign` is
  wrong. Log the minified body, its SHA256 hex, and the assembled string; mismatch is
  almost always body serialization or timestamp format.
- `401xxx1 Invalid Access Token` — expired (900s) or fetched against the other environment.
- `409xxxx Conflict` — `X-EXTERNAL-ID` reused.
- `4xxx700 Service Not Implemented` — the `CHANNEL-ID` isn't enabled for your project.
