# Trikonic Imports storefront

A small static storefront, ready to push to a Git repository and deploy on Vercel. No build step or package installation is needed.

## Preview locally

Open `index.html` in a browser, or run a local static server from this folder (for example `python3 -m http.server 8000`) and visit `http://localhost:8000`.

## Customer accounts, saved carts, and order history

The storefront uses the Supabase project **Trikonic E-Commerce Website**. `config.js` contains its project URL and public publishable key; a publishable key is meant for browser code. Never put a Supabase secret or service-role key in this repository.

The `public.orders` and `public.site_settings` tables are defined in `supabase/schema.sql` and are installed in the connected Supabase project. To set them up in another project, run that SQL in **Supabase → SQL Editor**. Row Level Security lets authenticated customers insert orders and read only orders linked to their own account. Customers cannot update order status or read another customer's data. The site settings table exposes only the storefront maintenance flag; its update policy is restricted to the admin email configured in `config.js` (`nkab200321@gmail.com`). Update that email in both `config.js` and the policy in `supabase/schema.sql`/the matching migration if the admin account changes.

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

The confirmation page and logo are already branded in the website code. Until custom SMTP is enabled, Supabase's built-in sender is for limited testing and may not send to arbitrary customer addresses. Never share your Resend API key in chat or commit it to GitHub.

The bag is saved in the browser's local storage, so it survives closing and reopening the site on that same browser/device. Checkout prompts new visitors to create an account first (existing customers can switch to sign in); an authenticated account is required to submit an order request. New requests are stored in Supabase for the customer's order history and also sent to the existing Google Sheet for the team.

## Store maintenance mode

Sign in to the site using the admin account (`nkab200321@gmail.com`) and open **My account**. The account panel has a **Storefront control** button to turn maintenance mode on or off. Shoppers see a temporary maintenance page while the catalog and ordering controls are unavailable; the signed-in admin can still access the store and the control. Supabase RLS checks the authenticated email claim when accepting a change, so changing browser code or signing in as an ordinary customer cannot enable or disable the setting. The single boolean is readable by the storefront so it can display the right page.

## Manage products in Google Sheets

The website reads its public catalog from the `Website Catalog` tab in the Trikonic spreadsheet. The existing `Products` tab contains inventory and formula-driven business data, so leave that tab as it is and edit `Website Catalog` for website listings.

Each row is one website product. Put its existing inventory SKU in column A. The storefront then takes the product name, category, and current selling price from the `Products` tab automatically. Use the remaining columns:

- `Description`: the text customers see.
- `Photo URL`: a publicly accessible image URL, or a repository path such as `images/raffia-tote.webp`.
- `Availability`: choose `In Stock`, `Pre-Order`, or `Out of Stock` from the dropdown. Out-of-stock items remain visible but cannot be added to the bag, and an already-saved bag must have those items removed before checkout.
- `Tag` and `Card Color`: optional display styling; card color can be a hex value such as `#e5dcd0`.
- `Show on website`: enter `TRUE` to publish that row or `FALSE` to hide it.
- `Flash Sale`: choose `TRUE` while the item should be discounted; choose `FALSE` (or leave it off) to show its regular price.
- `Sale Price (GHS)`: the temporary discounted price. The site uses it only when `Flash Sale` is `TRUE` and the sale price is a valid amount below the regular `Products` tab selling price. Sale prices are shown alongside the crossed-out regular price and are saved onto the order receipt.
- `Available Colors`: comma-separated colour choices for that product, for example `Black, Sky Blue, White, Teal`.
- `Available Sizes`: comma-separated size choices, for example `S, M, L, XL`. Leave either cell empty when that product does not use that option. Each variant uses the product’s listed price; the customer’s selected colour and size are saved with the cart item, receipt, Supabase order, and Google Sheet order row.
- `Additional Photos`: optional extra public image URLs separated by semicolons or line breaks. The `Photo URL` remains the primary image; shoppers can switch between the primary and additional photos in the product detail view.
- `Product Specs`: product facts in `Label: value` pairs separated by semicolons or line breaks, for example `Brand: KitchenAid; Capacity: 4.5 qt; Speeds: 10`. These appear in the product details table when shoppers open a product.

Clicking a product photo or name opens its detail view with a gallery, colour and size selectors, specifications, availability, and the add-to-bag action. Each colour/size combination currently uses the row’s product price.

After updating `google-apps-script.gs` in the spreadsheet’s **Extensions → Apps Script**, save it and run `setupTrikonicCatalogSheet` once. This adds the sale, variant, gallery, and specification columns if missing and refreshes the availability and sale dropdowns without changing existing product values. Then redeploy the existing Web App as a **New version** so the storefront starts reading these fields. The Web App URL stays the same.

Only rows marked `TRUE` with a matching SKU and photo are sent to the storefront. Change prices and product names in the existing blue editable columns of the `Products` tab; update photos, descriptions, availability, and visibility in `Website Catalog`. The website receives these catalog fields only; it does not expose stock quantities, profit, or order data. Refresh the site after edits. Once Vercel is connected to the repository, spreadsheet edits do not require a code edit or GitHub commit.

For photos stored with the website, upload optimized JPG/WebP files to an `images` folder in the repository, then enter that relative path in the sheet (for example `images/set-of-basic-tops.jpeg`). A bare filename is also treated as an image inside `images/`. Keep images reasonably small (around 300 KB where practical). The hero and story photos are separate; change those `<img src="...">` values in `index.html` when you have brand photos. The storefront waits for the live sheet catalog instead of briefly showing sample products.

The example products and contact details are placeholders. Replace them before launch. Search the project for `hello@trikonic.com` to update the contact address.

## Send order requests to Google Sheets

The site does not take payment. Customers must sign in or create and confirm an account before the checkout form opens or an order can be submitted. Supabase Row Level Security also rejects anonymous order inserts. Each request is saved to the customer's Supabase order history and sent to `Trikonic Orders` in Google Sheets. Your team then confirms availability, delivery, and payment with them. After an order is saved, the customer can download a PDF order-request receipt. It is not proof of payment; shipping is paid separately by the customer and is excluded from the item subtotal.

To connect the order form and product catalog to the existing Sheet:

1. In the Trikonic spreadsheet choose **Extensions → Apps Script**.
2. Replace the editor contents with `google-apps-script.gs` from this project and save. It reads the `Website Catalog` tab and writes new orders to `Trikonic Orders`.
3. In the function picker, choose `setupTrikonicOrdersSheet` and click **Run** once. Approve the Apps Script authorization prompt. This immediately adds separate `Order Date` and `Order Time` columns, preserves the existing order columns, and fills times for existing rows from their timestamp. New orders also get the date and time automatically.
4. In Apps Script choose **Deploy → Manage deployments**, edit the Web App deployment, select **New version**, and deploy. Keep **Execute as** set to your account and **Who has access** set to **Anyone**. The Web App URL should remain the same, so `config.js` does not need a change.
5. Refresh the website. Submit one clearly marked test order and check `Trikonic Orders` and **My account → Order history**; remove any test records afterwards.

The Web App must accept requests from website visitors, so its URL is public. Keep only order fields in this spreadsheet, restrict spreadsheet access to your team, and redeploy the Apps Script deployment after changing its code. The website queues each request with a browser POST. Google Apps Script redirects its response, so the browser cannot verify the Sheet write; the customer sees an “on its way” message after the browser queues it. Check the Sheet when you first set this up.

### Update order status from the Sheet

The customer’s **My account → Order history** shows a private tracking timeline. Change the `Status` cell in column J of `Trikonic Orders`; the dropdown offers `Order Received`, `Payment Made`, `Order Placed`, `Order Shipped`, `Order Arrived in Ghana`, `Order Arrived at Warehouse`, `Order Ready for Collection`, `Order Delivered`, and `Order Cancelled`. An installable Apps Script edit trigger sends only that order number and status to the Supabase `order-status-sync` function. Supabase records each change, and the customer can open the order card and refresh to see the latest status. The function validates a shared secret and updates by order number; order reads remain protected by the customer ownership policies.

One-time secure setup:

1. In a terminal, run `openssl rand -hex 32` to make a private shared token. Keep it out of chat and source control.
2. In **Supabase → Edge Functions → Secrets**, add `ORDER_STATUS_SYNC_TOKEN` with that value. The `order-status-sync` Edge Function is deployed. Its endpoint is `https://wxhdfrnjoohiktqujbik.supabase.co/functions/v1/order-status-sync`.
3. In the spreadsheet, open **Extensions → Apps Script → Project Settings → Script properties** and add `TRIKONIC_STATUS_SYNC_TOKEN` with the exact same value.
4. Replace the Apps Script editor contents with `google-apps-script.gs` and save. Run `authorizeTrikonicStatusSync` once manually and approve Google's external request permission. This grants the scope that an edit trigger cannot prompt for itself.
5. Run `setupTrikonicOrdersSheet` and `setupOrderStatusSync` once each. The first function refreshes the Status dropdown; the second installs the edit trigger.
6. Choose **Deploy → Manage deployments**, edit the existing Web App, choose **New version**, and deploy. The existing Web App URL stays the same.
7. Change a test order’s status in column J and confirm the cell note says it synced. Open that customer’s account, click **Refresh**, and expand the order to view its tracking timeline. Avoid using a real customer order for the test.

Keep the shared token only in the Supabase function secret and Apps Script project properties. If it is exposed, replace it in both places. A sheet status edit is the staff control; customers can only read their own order and status history.

### Customer order cancellation

Customers can cancel an order from its expanded card in **My account → Order history** while its status is `Order Received`, `Payment Made`, or `Order Placed`. The cancellation endpoint verifies the signed-in user owns that order, then rechecks the spreadsheet status under a script lock before setting it to `Order Cancelled`. The sheet's existing edit trigger syncs the status and tracking event back to Supabase. Once the status reaches `Order Shipped` or later, the customer cancellation button is hidden and the endpoint rejects cancellation even if called directly.

The `customer-cancel-order` Edge Function requires a signed-in Supabase JWT and uses the existing `ORDER_STATUS_SYNC_TOKEN` secret to authenticate its request to Apps Script. The same value must remain in Apps Script project properties as `TRIKONIC_STATUS_SYNC_TOKEN`. After updating `google-apps-script.gs`, save it and redeploy the Web App as a **New version**. The existing `TRikonicOrderEndpoint` in `config.js` is passed to the function; it is a public Apps Script URL, while the shared token remains server-side.

## Deploy on Vercel

1. Create the Git repository when you are ready and put these project files at its root.
2. Import that repository in Vercel. This is a static site, so no framework, build command, or output directory is needed; Vercel can deploy the root as-is.
3. After deployment, add your domain in the Vercel project’s **Settings → Domains**. At your domain registrar, use the DNS records Vercel shows for that domain.

## Before launch

- Replace example catalog items and stock photos with your actual products and images.
- Set a real contact email in `app.js` (the email fallback) and `index.html` (the newsletter link and footer if desired).
- Add clear delivery, returns, and privacy information for your business.
- Connect and check the Sheet with a test request. Online payment is not implemented.
