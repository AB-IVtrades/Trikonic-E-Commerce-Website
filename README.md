# Trikonic Imports storefront

A small static storefront, ready to push to a Git repository and deploy on Vercel. No build step or package installation is needed.

## Preview locally

Open `index.html` in a browser, or run a local static server from this folder (for example `python3 -m http.server 8000`) and visit `http://localhost:8000`.

## Customer accounts, saved carts, and order history

The storefront uses the Supabase project **Trikonic E-Commerce Website**. `config.js` contains its project URL and public publishable key; a publishable key is meant for browser code. Never put a Supabase secret or service-role key in this repository.

Customer orders are created by the authenticated `create-order` Edge Function, with server-verified catalog prices. Customers can read only their own orders and status history through RLS; they cannot insert orders directly, mark them paid, read another account, or access payment attempts. Run the migrations in `supabase/migrations` when setting up a new project. Admin authorization uses server-controlled app metadata, as described under Payment safety.

In **Supabase → Authentication → URL Configuration**, use `https://trikonicimports.com` as the Site URL and allow the live site and local preview:

- `https://trikonicimports.com`
- `https://trikonic-e-commerce-website.vercel.app`
- `http://localhost:8000` for local preview

Email confirmation is expected for new accounts. The branded confirmation page is `confirm.html`. The matching email HTML is in `email-templates/confirm-signup.html`. To send those account emails through Resend:

1. In Resend, add and verify a sending domain you control. Add the DNS records Resend provides, and use one of its verified addresses as the sender (for example, `accounts@trikonicimports.com`, if that address/domain is verified).
2. Create a Resend API key in the Resend dashboard. Keep it private; do not put it in this repository, `config.js`, or a customer-facing Vercel environment variable.
3. In **Supabase → Authentication → Emails → SMTP Settings**, enable custom SMTP and enter: Host `smtp.resend.com`, Port `465`, Username `resend`, Password your Resend API key, Sender email the verified address, and Sender name `Trikonic Imports`. Save the settings. Supabase documents Resend as a supported SMTP provider; Resend's SMTP password is an API key.
4. Go to **Supabase → Authentication → Email Templates → Confirm signup**, set the subject to `Confirm your Trikonic Imports account`, and paste the HTML from `email-templates/confirm-signup.html`. Its button opens the branded page on the Site URL domain, where the one-time token is verified and the customer is signed into their account.
5. Sign up with an email address you can check and confirm that the email arrives and the link returns to the site.
6. For **Reset password**, use subject `Reset your Trikonic Imports password` and the HTML from `email-templates/reset-password.html`. Its button and fallback link use Supabase’s `{{ .ConfirmationURL }}` to preserve recovery verification and the allowed redirect back to the website, where `PASSWORD_RECOVERY` opens the new-password form. Both account email templates share the Trikonic logo, navy/orange palette and layout.

The confirmation page and logo are already branded in the website code. Until custom SMTP is enabled, Supabase's built-in sender is for limited testing and may not send to arbitrary customer addresses. Never share your Resend API key in chat or commit it to GitHub.

The bag is saved in the browser's local storage, so it survives closing and reopening the site on that same browser/device. Checkout prompts new visitors to create an account first (existing customers can switch to sign in); an authenticated account is required to submit an order request. New requests are stored in Supabase for the customer's order history and also sent to the existing Google Sheet for the team.

## Store maintenance mode

Sign in with the existing store administrator account and open **My account → Storefront control** to turn maintenance on or off. The browser checks `is_store_admin()`, and the update policy independently checks the server-controlled admin role. Customers cannot change that role through editable user metadata. The public site-settings table contains only the manual maintenance flag.

## Manage products in Google Sheets

The website reads its public catalog from the `Website Catalog` tab in the Trikonic spreadsheet. The existing `Products` tab contains inventory and formula-driven business data, so leave that tab as it is and edit `Website Catalog` for website listings.

Each row is one website product. Put its existing inventory SKU in column A. The storefront then takes the product name, category, and current selling price from the `Products` tab automatically. Use the remaining columns:

- `Description`: the text customers see.
- `Photo URL`: a publicly accessible image URL, or a repository path such as `images/raffia-tote.webp`.
- `Availability`: choose `In Stock`, `Pre-Order`, or `Out of Stock` from the dropdown. Out-of-stock items remain visible but cannot be added to the bag, and customers can deselect or remove those items from their cart before checkout.
- `Stock Quantity`: enter the total number of units across all colours and sizes for an in-stock product. For example, enter `8` to show “8 in stock” on the product card and detail view. Enter `0` to show “Out of stock”, or leave the cell blank to show “In stock” without a number. Pre-order items continue to show “Pre-order”. Update the count in the sheet as stock changes.
- `Shipping Fee (USD)`: optional fee per checkout item (regardless of quantity), converted using **Pricing Settings → B2**. Leave it blank to use an existing **Shipping Fee (GHS)**. Leave both blank if shipping is included in the product price.
- `Tag` and `Card Color`: optional display styling; card color can be a hex value such as `#e5dcd0`.
- `Show on website`: enter `TRUE` to publish that row or `FALSE` to hide it.
- `Flash Sale`: choose `TRUE` while the item should be discounted; choose `FALSE` (or leave it off) to show its regular price.
- `Sale Price (GHS)`: the temporary discounted price. The site uses it only when `Flash Sale` is `TRUE` and the sale price is a valid amount below the regular `Products` tab selling price. Sale prices are shown alongside the crossed-out regular price and are saved onto the order receipt.
- `Available Colors`: comma-separated colour choices for that product, for example `Black, Sky Blue, White, Teal`.
- `Available Sizes`: comma-separated size choices, for example `S, M, L, XL`. Leave either cell empty when that product does not use that option. Each variant uses the product’s listed price; the customer’s selected colour and size are saved with the cart item, receipt, Supabase order, and Google Sheet order row.
- `Product Types` holds comma-separated choices on the same SKU, for example `Matching gray set, Gray hoodie with black joggers, Black hoodie with gray joggers`. Customers choose a type alongside any colour or size options you have listed. Leave the cell blank for products that do not need a type selector. For different prices by type, use the matching names in the variant price column for that product’s currency.
- `Variant Prices (GHS)`: optional prices for specific colour, size, or other product options. Enter rules separated by commas, semicolons, or line breaks in the format `Colour | Size: price`; use only the colour or only the size before the colon when that price applies to every other option. For example: `Black | 160 x 30 cm: 120, White | 160 x 30 cm: 135`. For a non-colour/size option, use `4 mode lighting effect: 100, 7 mode lighting effect: 130`. A rule like `Black: 110` applies to every size in Black, while `180 x 30 cm: 150` applies to that size in every colour. Any option without a matching rule uses the regular price from the `Products` tab. When a flash sale is active, its sale price applies only if it is lower than that selected variant’s regular price. Prices are shown when customers choose options and are saved per item in their bag and order.
- For the **Hair** category, `Available Sizes` is displayed as **Hair Length** and `Product Types` as **Closure Size**. Enter lengths such as `12 inches, 14 inches` and closure sizes such as `2 x 4, 4 x 4`. In the applicable variant price column, enter **Hair Length | Closure Size: price**, for example `12 inches | 2 x 4: 250; 12 inches | 4 x 4: 300; 14 inches | 2 x 4: 320; 14 inches | 4 x 4: 350`. These example amounts are item prices before the separate shipping fee. USD variant prices use the same syntax and existing exchange-rate conversion. A matching combination takes priority over a closure-only, length-only or base price. Unlisted combinations use the existing option/base-price fallback. The selected combination and its GHS price are saved with the order, and new hair orders retain these labels in the cart, checkout, order details, email and PDF receipt. Other categories retain their existing labels and pricing. This uses the existing deployed catalog API and needs no new Apps Script deployment.
- `Additional Photos`: optional extra public image URLs separated by commas, semicolons, or line breaks. The `Photo URL` remains the primary image; shoppers can switch between the primary and additional photos in the product detail view. Each URL must be a direct, publicly accessible image URL (or a path to an image in the website repository).
- To match a photo to a colour swatch, include the colour name in the filename (for example, `shirt-dusty-blue.png`). For an exact match, put `Colour | URL` in `Additional Photos`, using the label from `Available Colors`. For example, enter `Gray | images/charcoal-lounge-chair.jpg`. Use a separate line for each labelled photo. A colour without a match shows the primary photo.
- For a product with no colour options, put `Type | URL` in `Additional Photos`, using the exact name from `Product Types`. For example, enter `Matching gray set | images/matching-gray-set.jpg`. Use a separate line for each type photo.
- `Product Specs`: product facts in `Label: value` pairs separated by semicolons or line breaks, for example `Brand: KitchenAid; Capacity: 4.5 qt; Speeds: 10`. These appear in the product details table when shoppers open a product.

Clicking a product photo or name opens its detail view with a gallery, colour and size selectors, specifications, availability, and the add-to-bag action. Customers must explicitly choose each option that applies before adding the item, so the first colour or size is not silently assumed. The displayed price updates to reflect the chosen variant.

After updating `google-apps-script.gs` in the spreadsheet’s **Extensions → Apps Script**, save it and run `setupTrikonicCatalogSheet` once. This adds missing catalog columns, creates the **Pricing Settings** tab, and refreshes the validation rules. Then redeploy the existing Web App as a **New version** so the storefront starts reading these fields. The Web App URL stays the same.

Only rows marked `TRUE` with a matching SKU, photo, and valid selling price are sent to the storefront. Change product names and existing GHS prices in the blue editable columns of the `Products` tab. Update photos, descriptions, availability, public stock quantities, and visibility in `Website Catalog`. Refresh the site after edits.

To base prices on USD, enter the number of Ghana cedis per US dollar in **Pricing Settings → B2**. In **Website Catalog**, enter each product’s **Selling Price (USD)** and copy any applicable sale or variant prices into **Sale Price (USD)** or **Variant Prices (USD)** using the same variant rule syntax. USD-priced rows use those USD fields and require a positive exchange rate to appear in the catalog. Leave **Selling Price (USD)** blank for rows that use the existing GHS pricing fields.

The catalog converts each USD unit price and USD shipping fee to GHS and rounds each to the nearest pesewa before calculating the cart total. The public catalog, cart, checkout, and Paystack all use GHS. Updating the rate changes prices the next time the storefront loads the catalog. Saved orders retain their original GHS amounts.

For photos stored with the website, upload optimized JPG/WebP files to an `images` folder in the repository, then enter that relative path in the sheet (for example `images/set-of-basic-tops.jpeg`). A bare filename is also treated as an image inside `images/`. Keep images reasonably small (around 300 KB where practical). The hero and story photos are separate; change those `<img src="...">` values in `index.html` when you have brand photos. The storefront waits for the live sheet catalog instead of briefly showing sample products.

Photos added or replaced in `images/` on `main` are checked by the **Compress product photos** GitHub Actions workflow. Photos over 500 KB are compressed in place, with a maximum dimension of 1280 pixels. Filenames, file formats, and photo URLs are preserved. The workflow commits smaller results and updates the stable image cache version automatically. Already-compressed photos are skipped. To run the same process locally, install `Pillow==12.1.1` and run `python scripts/compress-images.py`.


The example products and contact details are placeholders. Replace them before launch. Search the project for `hello@trikonic.com` to update the contact address.

## Secure order backend and admin dashboard

Open `/admin.html` and sign in with the existing store administrator account. Complete authenticator verification before opening customer orders. First-time setup shows a QR code to scan using your own authenticator app; enter its code to finish. Every admin API independently checks the fresh server-controlled admin role and MFA assurance (`aal2`). There are no staff accounts or manual paid overrides.

Supabase is now the official order/payment record. Sheets remains the product catalog only; its order-writing and status-sync endpoints are retired. Historical Sheet rows remain an archive and cannot alter website orders. Keep restricted access to any historical customer information still in that archive. Older unpaid orders without verified pricing must be recreated through checkout.

**Orders:** search by number/customer, filter payment and delivery state, review exceptions, and browse 25-record pages. Open an order for customer details, item/price snapshots, Paystack references, automatic jobs and audit history. **Recheck with Paystack** verifies payment instead of letting an admin mark it paid.

**Shipments:** create a named batch, then open paid orders to allocate item quantities into it. One order can use multiple batches. Search finds older unshipped batches. Transactional locks prevent over-allocation and stale shipment edits. Advance one shipment to update every linked item's stage. An order follows its least-advanced outstanding items and is only delivered when every item is delivered. Customers can open **View shipment items** to see partial deliveries. Cancellation is blocked after any item ships. Paid cancellations and duplicate successful references require refund review; there are no automatic refunds.

Signed Paystack webhooks enqueue payment verification quickly. Return-page verification uses the same transactional payment recorder. Reference, amount, currency and customer checks must match; confirmed payment atomically queues a receipt job. Email outages never undo payment confirmation. Receipts retain the existing private PDF, colours and Resend idempotency key.

`trikonic-order-recovery` runs every five minutes. It claims up to 50 due jobs using row locks and leases and invokes independent workers with at most four concurrent requests. Expired leases recover interrupted work. Retries increase from five minutes to a maximum of six hours. Unresolved payments require review after 72 hours and are never assumed successful. Receipt retries stop at 23 hours to stay within Resend's 24-hour deduplication window; ambiguous deliveries require review rather than a blind duplicate send. Existing paid receipts are not resent during migration. No new shipping emails or SMS are enabled.

Worker authentication uses an internally generated random credential encrypted in Supabase Vault. Cron commands contain no plaintext credentials; browser callers cannot read the queue, audit records, worker credential or privileged RPCs. Maintenance remains strictly manual. Saved verified orders can be paid, managed and cancelled without Google Sheets. Creating a new order still requires the trusted product catalog for current prices.

Apply migrations in order, deploy the functions, then activate `activate_order_recovery`. Deploy the catalog-only Apps Script revision at the existing URL and retire the old order-status endpoint (HTTP 410). Run `deno test --allow-env --allow-read --allow-write=/private/tmp/trikonic-receipt-preview supabase/functions/tests/` and the four storefront `scripts/test-*.cjs` checks. `supabase/tests/order_operations.sql` tests actual transactional rules with rolled-back fixtures and no external emails or provider requests.

Before calling acceptance complete, the owner must enroll MFA and verify a Paystack test-mode checkout, receipt email/PDF and customer tracking. Do not use real payment credentials or swap production keys merely for testing. Monitor **Needs attention**, `cron.job_run_details`, `net._http_response` and private job states. No paid-plan upgrade is included; free-plan leaked-password protection remains a separate account-plan decision.

## Deploy on Vercel

1. Create the Git repository when you are ready and put these project files at its root.
2. Import that repository in Vercel. This is a static site, so no framework, build command, or output directory is needed; Vercel can deploy the root as-is.
3. After deployment, add your domain in the Vercel project’s **Settings → Domains**. At your domain registrar, use the DNS records Vercel shows for that domain.

## Before launch

- Replace example catalog items and stock photos with your actual products and images.
- Set a real contact email in `app.js` (the email fallback) and `index.html` (the newsletter link and footer if desired).
- Add clear delivery, returns, and privacy information for your business.
- Verify Paystack payment using test mode before enabling live keys. The server checks the transaction amount, currency, reference, and verified status before setting an order to `Payment Made`.
- Keep Paystack and Resend API keys in Supabase Edge Function secrets only. Never add them to `config.js`, the website, GitHub, or chat.

### Paystack online payments and tracking notices

The checkout uses Paystack's hosted checkout. Orders remain unpaid until the server verifies the transaction with Paystack. The signed webhook and authenticated return-page verification share the same amount, currency, reference and ownership checks. The backend checks the paid amount and currency against the saved order. After confirmation it updates the Supabase order status and queues receipt delivery separately. Customers can retry a pending payment from **My account → Order history**.

Set these values in **Supabase → Edge Functions → Secrets** (do not paste secrets into chat or source files):

- `PAYSTACK_SECRET_KEY`: start with the Paystack **test secret key**. Switch to the live secret key only after a successful test and business verification.
- `PAYSTACK_WEBHOOK_SECRET`: the webhook signing secret (`whsec_...`) generated in Paystack **Developers → API configuration** for the same environment. The handler also accepts Paystack's legacy signature while the dashboard still sends it.
- `RESEND_API_KEY`: the Resend API key for order emails.
- `TRIKONIC_FROM_EMAIL`: a sender on the verified domain, for example `Trikonic Imports <orders@trikonicimports.com>`.
- `APPS_SCRIPT_ORDER_ENDPOINT`: the existing catalog-only Apps Script Web App URL, stored only in server configuration.

In Paystack **Developers → API configuration** (test mode), generate a webhook signing secret and add it as `PAYSTACK_WEBHOOK_SECRET` in Supabase. Set the webhook URL to `https://wxhdfrnjoohiktqujbik.supabase.co/functions/v1/paystack-webhook` in the test environment's webhook settings. Keep the webhook and both Paystack secrets in test mode during testing. The webhook does not use a browser return page as proof of payment.

The Apps Script deployment is catalog-only. Payment processing and cancellations no longer use the spreadsheet sync token. Recovery jobs handle payment checks and receipt delivery independently.

Before taking real payments, complete Paystack business activation and test card/mobile-money flows, failed payments, retries, and customer tracking updates. The total charged is the item subtotal plus one shipping fee per checkout item, regardless of quantity.

### Branded payment receipts

Verified payments receive a navy, orange and white HTML receipt with the PDF attached. The same PDF is downloadable under **My account → Track your orders** (active orders) or **Order history** (delivered/cancelled orders), using **Download payment receipt (PDF)**. The email tracking link opens that order in the account. Receipts show the saved customer details, item options, photos, quantity, item subtotal, shipping and total paid. New orders snapshot their selected photo URL. Older orders without a photo use a branded placeholder. Legacy orders without a separate shipping amount label shipping as included.

Apply `supabase/migrations/20261116000000_payment_receipts.sql`, then deploy `customer-receipt` with JWT verification enabled and the updated `paystack-webhook` with its existing signature authentication. Both functions include the `_shared` receipt modules. The `payment-receipts` bucket stays private with no customer storage policies. The download function validates the signed-in user and order ownership and requires `payment_status = paid`. PDFs are saved once, so the emailed attachment and later downloads are identical. No additional secrets are needed. Existing paid orders can download a receipt without resending their previous email. The pre-payment order summary remains distinct from a paid receipt.

Receipt checks use mocked payment, storage and email services and never send customer emails or charge a card. Run `deno test --lock=supabase/functions/deno.lock --allow-read --allow-write=/private/tmp --allow-env supabase/functions/tests/receipts_test.ts` and `node scripts/test-receipt-ui.cjs`. A sample PDF and HTML email are generated in `/private/tmp/trikonic-receipt-preview`. The Noto Sans font is bundled under the SIL Open Font License, avoiding a runtime font download.


### Payment safety and the return page

Apply `supabase/migrations/20261116010000_payment_safety.sql` and deploy `create-order`, `verify-payment`, `initialize-paystack-payment` (JWT enabled) and `paystack-webhook` (signature authenticated). Deploy the website together with these functions. Browser INSERT permission on orders is revoked. `create-order` authenticates the customer, fetches the trusted catalog using the existing `APPS_SCRIPT_ORDER_ENDPOINT` secret, validates options/quantity, and calculates all prices and shipping on the server. Legacy unpaid orders must match current catalog prices before they can be paid; customers must recreate orders whose prices or options changed. Already paid receipts are unaffected.

Admin access uses the server-controlled `auth.users.raw_app_meta_data.store_role = admin` value and `is_store_admin()` RPC, not an email in browser JavaScript or editable user metadata. Assign this only through a trusted backend/database administrator. The existing store administrator retains their access. Maintenance remains strictly manual.

The Supabase project URL and publishable key are intentionally public browser connection details. They do not grant administrative access. Never publish the service-role key, Paystack secret, email API key, or status-sync token. Customer reads are restricted by RLS; payment attempts are server-only. Deployment ignores backend source, scripts and email templates.

The payment initializer sends `callback_url: https://trikonicimports.com/?payment=return`. Paystack appends its reference. The return page requires the customer to be signed in, calls `verify-payment`, and shows success only after Paystack reports success, the transaction matches the customer's saved order, and the paid status is saved. Pending/error states offer another check without requesting another payment. Payment attempts are reserved per order and active checkout links reused to reduce duplicate payments. The webhook independently validates its signature, verifies the transaction, and sends the existing receipt email/PDF, even if the customer closes the checkout tab.

Paystack settings: use the correct live/test `PAYSTACK_SECRET_KEY`; set the matching environment's webhook URL to `https://wxhdfrnjoohiktqujbik.supabase.co/functions/v1/paystack-webhook`. Keep any configured `PAYSTACK_WEBHOOK_SECRET` in the matching mode. Callback URL can also be entered in the Paystack dashboard as the URL above; the server passes it on every checkout. No new public or secret keys are required for this update. Card/mobile money redirection behavior also depends on completing Paystack's hosted checkout; closing the provider's tab cannot force a browser redirect.

Regression checks (mocked services, no charges or customer emails): `deno test --allow-env --allow-read --allow-write=/private/tmp/trikonic-receipt-preview supabase/functions/tests/`; `node scripts/test-payment-ui.cjs`; `node scripts/test-receipt-ui.cjs`; `node scripts/test-hair-options.cjs`. A real provider checkout is still required to validate live redirect behavior end to end.

### Shop display and security hardening

Shop and category listings use 24 cards per page, with previous/next and numbered pages on desktop and mobile. Search, category, price and sorting changes reset to page one; links preserve the selected page and filters. Homepage previews remain limited to ten cards. Product cards show the item price. Product details show the shipping fee separately, with checkout retaining the exact subtotal + shipping total. A blank shipping cell means shipping is included; zero displays free shipping. Required controls display * and retain native validation; signup now requires a name.

`customer-cancel-order` ignores client-supplied URLs and calls the transactional Supabase cancellation function only. It makes no request to Apps Script. Spreadsheet order writes and edit-trigger status updates are retired (deployed Apps Script version 28); payments and order management never depend on sheet writes.

The public `public-catalog` Edge Function reads the fixed server-configured catalog URL, parses its response as JSON data without executing it, and returns `application/json` with `nosniff`. The browser uses `fetch` without credentials, never injects catalog scripts, and no longer receives the Apps Script endpoint through config.js. Concurrent upstream reads are coalesced, with a 60-second in-memory/browser cache. Google Apps Script domains are removed from the page's script CSP. Spreadsheet catalog edits still work; allow roughly one minute for cached listings to refresh. Deploy `public-catalog` before publishing the frontend. It is deliberately public and read-only; it returns only the same public product catalog as the shop.

Apply the `storefront_abuse_limits` migration and include `_shared/limits.ts`, `_shared/server.ts` when deploying relevant functions. Limits are atomic and server-only: checkout 10/minute per customer, payment initialization 20/minute, verification 60/minute; contact enquiries 100/hour globally and 5/hour per email. Counter identifiers are keyed hashes; no raw email/IP is stored in them. These limits reduce abuse and are not a substitute for CAPTCHA or provider-level rate limits. Request bodies are bounded while streaming, including requests without Content-Length.

`vercel.json` adds a restrictive script CSP, disallows framing and inline script handlers, and sets MIME, referrer and permissions protections. Supabase browser JS is version-pinned with subresource integrity; analytics is version-pinned and loaded from a local module. Backend source and local credential file patterns are excluded from static deployment. The current source snapshot removes the personal admin email; previously published Git commits or cached copies are not erased by this update.

Security checks cover RLS ownership, private receipts/profile photos/payment attempts, role escalation through user metadata, request limits, cancellation destination tampering, unsigned sheet writes, formula injection, malicious markup and unsigned webhooks. No secret/service-role/Paystack/email API credentials were found in tracked source during this audit. Supabase's publishable key and project URL remain public by design. The free Supabase plan does not include leaked-password protection; enabling that provider feature requires an account-plan decision. The legacy status-sync token was rotated previously; order processing no longer uses it.

Run `node scripts/test-storefront.cjs` in addition to the existing receipt, hair and payment tests. No security test sends mail, creates a real order, or charges a payment.

### Per-device sign-out
Customers open My profile → Signed-in devices → Show devices to list their own browser sessions, then sign out an individual device. The current device is marked separately and uses local sign-out; other sessions remain signed in. Device names come from the browser user-agent and can be approximate. The endpoint returns no IP addresses or tokens. Session mutations require the signed JWT's current session and own user ID, and are audited privately. Database RLS and customer-facing Edge Functions check active session membership so revoked access tokens cannot read private orders, profile photos or perform authenticated backend operations. Open storefront/admin tabs check on focus and every 60 seconds while visible and clear local private views after revocation. A server cannot erase information already displayed or copied on another device.
