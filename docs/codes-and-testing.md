# Duitku codes, limits and sandbox testing

Contents: payment method codes · expiry periods · HTTP/error codes · sandbox test
credentials · QRIS issuer list · disbursement bank codes.

---

## Payment method codes

Used as `paymentMethod` in v2 inquiry and (optionally) in Pop `createInvoice`.

| Type | Code | Channel |
|---|---|---|
| Credit Card | `VC` | Visa / Mastercard / JCB |
| Virtual Account | `BC` | BCA |
| | `M2` | Mandiri |
| | `VA` | Maybank |
| | `I1` | BNI |
| | `B1` | CIMB Niaga |
| | `BT` | Permata |
| | `A1` | ATM Bersama |
| | `AG` | Bank Artha Graha |
| | `NC` | Bank Neo Commerce (BNC) |
| | `BR` | BRIVA |
| | `S1` | Bank Sahabat Sampoerna |
| | `DM` | Danamon |
| | `BV` | BSI |
| Retail | `FT` | Pegadaian / ALFA / Pos |
| | `IR` | Indomaret |
| E-Wallet | `OV` | OVO (supports void) |
| | `SA` | ShopeePay Apps (supports void) |
| | `LF` | LinkAja Apps (fixed fee) |
| | `LA` | LinkAja Apps (percentage fee) |
| | `DA` | DANA |
| | `SL` | ShopeePay Account Link |
| | `OL` | OVO Account Link |
| QRIS | `SP` | ShopeePay |
| | `NQ` | Nobu |
| | `GQ` | Gudang Voucher |
| | `SQ` | Nusapay |
| Paylater | `DN` | Indodana |
| | `AT` | ATOME |
| E-Banking | `JP` | Jenius Pay |
| E-Commerce | `T1` | Tokopedia Card Payment |
| | `T2` | Tokopedia E-Wallet |
| | `T3` | Tokopedia Others |

Retired: QRIS LinkAja (`LQ`) removed Jan 2025, QRIS DANA (`DQ`) removed from the v2 list
Aug 2025 (still present in SNAP QRIS as a CHANNEL-ID). The `isSubscription` /
`subscriptionDetail` parameters were removed in late 2025.

Extra requirements: paylater needs `customerDetail` + `itemDetails`; e-commerce needs
`customerVaName`.

---

## Expiry periods

`expiryPeriod` is in minutes. Channels marked * ignore your value and always use the
default.

| Channel | Default | Maximum |
|---|---|---|
| Credit Card | 30* | — |
| Virtual Account | 1440 | > 1440 |
| Retail | 1440 | > 1440 |
| OVO | 10** | 1440 |
| ShopeePay Apps | 10 | 60 |
| LinkAja Apps | 24* | 1440 |
| DANA | 1440 | 1440 |
| ShopeePay Account Link | 30* | — |
| OVO Account Link | 15* | — |
| QRIS | 10 | 60 |
| Nobu QRIS | 24 | 1440 |
| Indodana Paylater | 1440 | 1440 |
| ATOME | 720 | 720 |
| Jenius Pay | 10 | 10 |
| Tokopedia | 1440 | 1440 |

** For OVO this is the window on Duitku's checkout page before the customer presses
"pay now".

SNAP QRIS `validityPeriod` has a **minimum of 30 minutes**.

---

## HTTP codes (v2 API)

| Code | Message | Cause |
|---|---|---|
| 200 | SUCCESS | |
| 400 | Minimum Payment 10000 IDR | Amount below the floor. |
| 400 | Maximum Payment exceeded | Above the channel ceiling. |
| 400 | paymentMethod is mandatory | Missing/blank channel code. |
| 400 | merchantOrderId is mandatory | Missing order ID. |
| 400 | length of merchantOrderId can't > 50 | |
| 400 | Invalid Email Address | Malformed `email`. |
| 400 | length of email can't > 50 | |
| 400 | length of phoneNumber can't > 50 | |
| 400 | Customer VA Name must not be empty for this payment channel | `customerVaName` required. |
| 401 | Wrong signature | Signature or one of its inputs is wrong. Check field order and algorithm. |
| 404 | Merchant not found | Bad `merchantCode`, or sandbox code used against production. |
| 404 | Payment channel not available | Channel not activated — contact Duitku support. |
| 409 | Payment amount must be equal to all item price | `itemDetails` total ≠ `paymentAmount`. |

Transaction `statusCode` (check transaction): `00` success · `01` pending/process ·
`02` canceled/failed/expired.
Callback `resultCode`: `00` success · `01` failed (Pop docs list `02` for failed).
Redirect `resultCode`: `00` success · `01` pending · `02` canceled.

---

## Sandbox test credentials

### Credit card (3D Secure)

| Type | Number | Exp | CVV |
|---|---|---|---|
| VISA | 4000 0000 0000 0044 | 03/33 | 123 |
| Mastercard | 5500 0000 0000 0004 | 03/33 | 123 |

### Virtual account

Simulate a paid VA at
`https://sandbox.duitku.com/payment/demo/demosuccesstransaction.aspx`.
The same demo page is used to test Gudang Voucher QRIS and Tokopedia.

### E-wallet / QRIS

- **ShopeePay** — staging APK from the Google Drive link in the docs; also used for
  ShopeePay QRIS.
- **Nusapay QRIS** — phone `08188886666`, PIN `123789`, OTP `123456`, plus their staging APK.

### Paylater

- **Indodana** — `081282325566` / PIN `000000`; `0838499610` and `085780110019` with
  PIN `123654`, OTP `999999`.
- **Atome** — success: `ID` `+62811000122` OTP `7524`; failure: `ID` `+62810000001500`
  OTP `1111`.

### Jenius Pay

`jenius@duitku.com` / `P@ssw0rd123` / cashtag `$testjenpay4` / any 6-digit OTP, via the
Jenius UAT site.

For anything not listed, email `support@duitku.com` first.

### Disbursement sandbox merchant

`userId` `3551`, email `demo@duitku.com`, secretKey
`de56f832487bc1ce1de5ff2cfacf8d9486c61da69df6fd61d5537b6b7d6d354d`.

Transfer Online — inquiry: `8760673566` → `00`, `...511` → `TO`, `...512` → `-100`,
`...513` → `LD`, `...514` → `91`, `...515` → `89`.
Transfer: `8760673566` → `00`, `...559` → `LD`, `...560` → `91`, `...561` → `TO`,
`...562` → `-510`, `...563` → `89`, `...564` → `68`, `...565` → `-100`.

Clearing — inquiry base `8760673466` → `00`; `...411` `EE`, `...412` `TO`, `...413` `LD`,
`...414` `NF`, `...415` `-100`, `...416` `66`, `...417` `68`, `...418` `88`, `...419` `90`,
`...420` `91`. Transfer: `8760673466` → `00` for LLG/RTGS/BIFAST and `80` for H2H;
`...451` `LD`, `...452` `NF`, `...453` `TO`, `...454` `-510`, `...455` `90`, `...456` `68`,
`...457` `91`.

Cash out — phone numbers ending `100`–`200` produce a successful callback (`00`);
`201`–`300` produce a failed callback (`01`).

### Postman

Duitku publishes a Postman collection linked from the API reference pages (payment
gateway and disbursement have separate collections).

---

## QRIS issuer codes

Returned as `issuerCode` in the callback.

`93600999` AHDI · `93600947` Aladin Syariah · `93600567` Allo Bank · `93600531` Amar ·
`93600822` Astrapay · `93600116` Bank Aceh Syariah · `93600037` Artha Graha ·
`93600133` BPD Bengkulu · `93600124` BPD Kaltimtara · `93600161` Ganesha ·
`93600513` Ina Perdana · `93600113` Jateng · `93600123` Kalbar · `93600122` Kalsel ·
`93600441` KB Bukopin · `93600121` Lampung · `93600157` Maspion · `93600553` Mayora ·
`93600548` Multiarta Sentosa · `93600490` Neo Commerce · `93600128` NTB Syariah ·
`93600019` Panin · `93600132` Papua · `93600115` BPD Jambi · `93600494` Bank Raya ·
`93600119` Riau Kepri · `93600523` Sahabat Sampoerna · `93600152` Shinhan ·
`93600126` Sulsel · `93600120` Sumselbabel · `93600023` UOB Indonesia · `93600808` Bayarind ·
`93600014` BCA · `93600536` BCA Syariah · `93600501` BCAD · `93600815` Bimasakti ·
`93600110` BJB · `93600425` BJB Syariah · `93600919` BluePay · `93600009` BNI ·
`93600129` BPD Bali · `93600112` BPD DIY · `93600130` BPD NTT · `93600114` BPD Jatim ·
`93600002` BRI · `93600422` BRIS Pay · `93600200` BTN · `93600076` Bumi Arta ·
`93600031` Citibank · `93600950` Commonwealth · `93600915` DANA · `93600011` Danamon ·
`93600046` DBS MAX · `93600111` DKI · `93600899` Doku · `93600998` DSP · `93600827` Fello ·
`93600777` Finpay · `93600813` GAJA · `93600914` GoPay · `93600916` Gudang Voucher ·
`93600484` Hana · `93600789` IMkas · `93600920` Isaku · `93600542` Jago · `93600213` Jenius ·
`93600812` Kaspro · `93600911` LinkAja · `93600008` Mandiri Pay · `93600016` Maybank ·
`93600426` Mega · `93600821` Midazpay · `93600485` Motion Banking · `93600147` Muamalat ·
`93600118` Nagari · `93600814` Netzme · `93600022` Niaga · `93600503` Nobu · `93600028` OCBC ·
`93600811` OTTOCASH · `93600912` OVO · `93600820` PAC Cash · `93600818` Paydia ·
`93600917` Paytrend · `93600013` Permata · `93608161` POS Indonesia · `93600167` QNB ·
`93600921` Saldomu · `93600535` Seabank · `93600918` ShopeePay · `93600153` Sinarmas ·
`93600816` SPIN · `93600451` Bank Syariah Indonesia · `93600898` T-Money ·
`93600828` TrueMoney · `93600835` Virgo · `93600830` YODU · `93600817` Yukk · `93600825` Zipay

---

## Disbursement bank codes

Prefer the List Bank API — it also returns each bank's transfer ceiling. Reference values:

`002` BRI · `008` Mandiri · `009` BNI · `011` Danamon · `013` Permata · `014` BCA ·
`016` Maybank · `019` Panin · `022` CIMB Niaga · `023` UOB · `028` OCBC NISP · `031` Citi ·
`036` CCB · `037` Artha Graha · `042` MUFG · `046` DBS · `050` Standard Chartered ·
`054` Capital · `061` ANZ · `069` Bank of China · `076` Bumi Arta · `087` HSBC ·
`095` JTrust · `097` Mayapada · `110` BJB · `111` DKI · `112` BPD DIY · `113` Jateng ·
`114` Jatim · `115` Jambi · `116` Aceh · `117` Sumut · `118` Nagari · `119` Riau Kepri ·
`120` Sumsel Babel · `121` Lampung · `122` Kalsel · `123` Kalbar · `124` Kaltimtara ·
`125` Kalteng · `126` Sulselbar · `127` Sulut Go · `128` NTB Syariah · `129` BPD Bali ·
`130` NTT · `131` Maluku Malut · `132` Papua · `133` Bengkulu · `134` Sulteng ·
`135` Sultra · `137` Banten · `146` Bank of India · `147` Muamalat · `151` Mestika ·
`152` Shinhan · `153` Sinarmas · `157` Maspion · `161` Ganesha · `164` ICBC · `167` QNB ·
`200` BTN · `212` Woori Saudara · `213` BTPN · `405` Victoria Syariah · `425` BJB Syariah ·
`426` Mega · `441` KB Bukopin · `451` Bank Syariah Indonesia · `472` Jasa Jakarta ·
`484` KEB Hana · `485` MNC · `490` Neo Commerce · `494` BRI Agroniaga · `498` SBI ·
`501` Blu (Digital BCA) · `503` Nobu · `506` Mega Syariah · `513` Ina Perdana ·
`517` Panin Dubai Syariah · `520` Prima Master · `521` Bukopin Syariah ·
`523` Sahabat Sampoerna · `526` Oke Indonesia · `531` Amar · `535` SeaBank ·
`536` BCA Syariah · `542` Jago · `547` BTPN Syariah · `548` Multiarta Sentosa ·
`553` Mayora · `555` Index Selindo · `562` Superbank · `564` Mantap · `566` Victoria ·
`567` Allo Bank · `600` BPR Supra · `688` BPR KS · `699` BPR Eka · `789` IMkas ·
`911` LinkAja · `945` Agris · `947` Aladin Syariah · `949` CTBC · `950` Commonwealth

E-wallet destinations: `1010` OVO · `1011` GoPay · `1012` DANA · `1013` ShopeePay ·
`1014` LinkAja Direct.
Cash out destinations: `2010` Indomaret · `2011` Pos Indonesia.
