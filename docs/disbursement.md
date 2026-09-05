# Duitku Disbursement API

Source: https://docs.duitku.com/disbursement/id/

Sending money out. **The feature must be activated on the account** — when it is, Duitku
issues a numeric `userId` and a `secretKey`. These are *not* the same as the payment
gateway's `merchantCode`/`apiKey`.

Three products:

| Product | What it does | Limits |
|---|---|---|
| **Transfer Online** | Real-time transfer to 140+ Indonesian banks, 24/7. | 50–100 million IDR per transaction depending on the receiving bank. |
| **Clearing** | LLG, RTGS, H2H, BI-FAST. | LLG max 1,000,000,000. RTGS min 100,000,000. LLG/RTGS follow BI hours: 08:00–15:00 on business days. H2H covers BNI, BRI, Mandiri, Permata, CIMB on each bank's schedule. BI-FAST is 24/7. |
| **Cash Out** | Withdrawal at Indomaret (`2010`) or Pos Indonesia (`2011`). | Indomaret: multiples of 50,000, min 50,000, max 1,000,000. Pos: min 50,000, max 2,000,000. |

All signatures are **plain SHA256** over concatenated fields with `secretKey` appended
(not HMAC). `timestamp` is Unix milliseconds and expires after 5 minutes (`-960`).

Always check the balance or let the API validate it — insufficient funds returns `-510`.

## Transfer Online

Two steps: inquiry (validates the account, returns `accountName` and `disburseId`), then
transfer.

### Inquiry

```
POST https://sandbox.duitku.com/webapi/api/disbursement/inquirysandbox    # sandbox
POST https://passport.duitku.com/webapi/api/disbursement/inquiry          # production
```

Signature: `SHA256(email + timestamp + bankCode + bankAccount + amountTransfer + purpose + secretKey)`

| Field | Req | Notes |
|---|---|---|
| `userId` | Y | Merchant ID from Duitku. |
| `amountTransfer` | Y | Integer, no decimals. |
| `bankAccount` | Y | Destination account number. |
| `bankCode` | Y | 3-digit code, see bank list. |
| `email` | Y | The email registered with Duitku. |
| `purpose` | N | Included in the signature even when empty. |
| `timestamp` | Y | Unix ms. |
| `senderId`, `senderName` | N | Your customer's ID/name. |

Response: `accountName` (verify this against what your user expects before transferring),
`custRefNumber`, `disburseId` (store it), `responseCode`, `responseDesc`.

### Transfer

```
POST https://sandbox.duitku.com/webapi/api/disbursement/transfersandbox   # sandbox
POST https://passport.duitku.com/webapi/api/disbursement/transfer         # production
```

Signature: `SHA256(email + timestamp + bankCode + bankAccount + accountName +
custRefNumber + amountTransfer + purpose + disburseId + secretKey)`

Send back everything from the inquiry plus `disburseId`, `accountName`, `custRefNumber`.
`purpose` is mandatory here.

**If the transfer returns `TO`, `68`, or `-100`, do not retry.** The transfer may have
gone through; wait for bank confirmation and check with Inquiry Status instead.

## Clearing

Same two-step shape, with a `type` field: `LLG`, `RTGS`, `H2H`, or `BIFAST`.

| Step | Endpoint (sandbox / production path) |
|---|---|
| Inquiry | `/webapi/api/disbursement/inquiryclearingsandbox` / `/webapi/api/disbursement/inquiryclearing` |
| Transfer | `/webapi/api/disbursement/transferclearingsandbox` / `/webapi/api/disbursement/transferclearing` |

Inquiry signature: `SHA256(email + timestamp + bankCode + type + bankAccount +
amountTransfer + purpose + secretKey)`

Transfer signature: `SHA256(email + timestamp + bankCode + type + bankAccount +
accountName + custRefNumber + amountTransfer + purpose + disburseId + secretKey)`

### Clearing callback (H2H only)

`POST` to your callback URL, `application/json`.

Signature: `SHA256(email + bankCode + bankAccount + accountName + custRefNumber +
amountTransfer + disburseId + secretKey)`

Payload: `disburseId`, `userId`, `email`, `bankCode`, `bankAccount`, `amountTransfer`,
`accountName`, `custRefNumber`, `statusCode`, `statusDesc`, `errorMessage`, `signature`.
Respond with the literal string `SUCCESS`.

Callback status codes: `00` success, `01` failed, `68` pending (do not retry).

## Cash Out

```
POST https://disbursement-sandbox.duitku.com/api/cashout/inquiry   # sandbox
POST https://disbursement.duitku.com/api/cashout/inquiry           # production
```

Signature: `SHA256(email + timestamp + amountTransfer + purpose + secretKey)`

Body: `userId`, `amountTransfer`, `custRefNumber`, `bankCode` (`2010` Indomaret /
`2011` Pos), `accountName`, `accountAddress`, `accountIdentity` (customer's KTP number),
`email`, `phoneNumber`, `purpose`, `timestamp`, `callbackUrl`, `signature`.

Response returns `token` and, for Pos Indonesia, `pin`. The token is SMS'd to the
customer, who redeems it at the outlet.

Cash out callback signature: `SHA256(email + disburseId + custRefNumber + secretKey)`.
Respond `SUCCESS`.

## Inquiry Status

```
POST {host}/webapi/api/disbursement/inquirystatus
```

Signature: `SHA256(email + timestamp + disburseId + secretKey)`
Body: `disburseId`, `userId`, `email`, `timestamp`, `signature`.

Use this rather than retrying an ambiguous transfer.

## Check Balance

```
POST {host}/webapi/api/disbursement/checkbalance
```

Signature: `SHA256(email + timestamp + secretKey)`

Returns `balance` (pre-settlement) and `effectiveBalance` (actually usable for
disbursement). Gate transfers on `effectiveBalance`.

## List Bank

```
POST {host}/webapi/api/disbursement/listBank
```

Signature: `SHA256(email + timestamp + secretKey)`

Returns `Banks[]` with `bankCode`, `bankName`, `maxAmountTransfer`. Prefer this over a
hardcoded list — the per-bank ceiling varies (BCA 50,000,000; BRI 100,000,000;
OVO 25,000,000).

## Status codes

| Code | Meaning |
|---|---|
| `00` | Approved / success |
| `EE` | General error |
| `TO` | Timeout from ATM Bersama network — **do not retry** |
| `LD` | Link problem between Duitku and ATM Bersama |
| `NF` | Not yet recorded at the remittance gateway |
| `76` | Invalid destination account number |
| `80` | Waiting for callback |
| `-100` | Other error — **do not retry** |
| `-120` | User ID not found / no access to this API |
| `-123` | User blocked |
| `-141` | Invalid transfer amount |
| `-142` | Transaction already completed |
| `-148` | Bank does not support H2H |
| `-149` | Bank not registered |
| `-161` | Callback URL not found |
| `-191` | Invalid signature |
| `-192` | Account number blacklisted |
| `-213` | Wrong email address |
| `-420` | Transaction not found |
| `-510` | Insufficient funds |
| `-920` | Limit exceeded |
| `-930` | IP not whitelisted |
| `-951` | Timed out |
| `-952` | Invalid parameter |
| `-960` | Timestamp expired (5 minutes) |

Vendor codes (passed through from the bank): `01` refer to card issuer · `05` transaction
not allowed · `12` generic exception · `14` account not found · `30` invalid format ·
`31` invalid bank code · `51` insufficient funds · `66` generic error · `68` late
response/timeout, wait for bank confirmation, do not retry · `88` bill already paid ·
`90` invalid beneficiary or currency · `91` transport error to back end.

## Batch disbursement

For bulk payouts without API work, Duitku's dashboard has a batch upload feature:
`https://docs.duitku.com/disbursement-feature/batch/`
