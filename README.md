# Trikonic Imports storefront

A small static storefront, ready to push to a Git repository and deploy on Vercel. No build step or package installation is needed.

## Preview locally

Open `index.html` in a browser, or run a local static server from this folder (for example `python3 -m http.server 8000`) and visit `http://localhost:8000`.

## Customer accounts, saved carts, and order history

The storefront uses the Supabase project **Trikonic E-Commerce Website**. `config.js` contains its project URL and public publishable key; a publishable key is meant for browser code. Never put a Supabase secret or service-role key in this repository.

The `public.orders` table is defined in `supabase/schema.sql` and is already installed in the connected Supabase project. To set it up in another project, run that SQL in **Supabase → SQL Editor**. Row Level Security lets authenticated customers insert orders and read only orders linked to their own account. Customers cannot update order status or read another customer's data.

In **Supabase → Authentication → URL Configuration**, use `https://trikonicimports.com` as the Site URL and allow the live site and local preview:

- `https://trikonicimports.com`
- `https://trikonic-e-commerce-website.vercel.app`
- `http://localhost:8000` for local preview

Email confirmation is expected for new accounts. The branded confirmation page is `confirm.html`. The matching email HTML is in `email-templates/confirm-signup.html`; the current Supabase dashboard says custom email templates require custom SMTP or a Pro upgrade. Once custom SMTP is configured, open **Supabase → Authentication → Email Templates → Confirm signup**, set the subject to `Confirm your Trikonic Imports account`, and paste that HTML. Its button opens the branded page on the Site URL domain, where the one-time token is verified and the customer is signed into their account.

The confirmation page and logo are already branded in the website code. When custom SMTP is set up, use an address on your verified business domain for the sender. Supabase's default email sender is rate-limited and its template editor is currently disabled for this project until SMTP is configured or the project plan is upgraded.

The bag is saved in the browser's local storage, so it survives closing and reopening the site on that same browser/device. A customer must sign in to submit an order request. New requests are stored in Supabase for the customer's order history and also sent to the existing Google Sheet for the team.

## Manage products in Google Sheets

The website reads its public catalog from the `Website Catalog` tab in the Trikonic spreadsheet. The existing `Products` tab contains inventory and formula-driven business data, so leave that tab as it is and edit `Website Catalog` for website listings.

Each row is one website product. Put its existing inventory SKU in column A. The storefront then takes the product name, category, and current selling price from the `Products` tab automatically. Use the remaining columns:

- `Description`: the text customers see.
- `Photo URL`: a publicly accessible image URL, or a repository path such as `images/raffia-tote.webp`.
- `Availability`: choose `In Stock` or `Pre-Order` from the dropdown. The site accepts either capitalization and common variants such as `pre-order`.
- `Tag` and `Card Color`: optional display styling; card color can be a hex value such as `#e5dcd0`.
- `Show on website`: enter `TRUE` to publish that row or `FALSE` to hide it.

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

## Deploy on Vercel

1. Create the Git repository when you are ready and put these project files at its root.
2. Import that repository in Vercel. This is a static site, so no framework, build command, or output directory is needed; Vercel can deploy the root as-is.
3. After deployment, add your domain in the Vercel project’s **Settings → Domains**. At your domain registrar, use the DNS records Vercel shows for that domain.

## Before launch

- Replace example catalog items and stock photos with your actual products and images.
- Set a real contact email in `app.js` (the email fallback) and `index.html` (the newsletter link and footer if desired).
- Add clear delivery, returns, and privacy information for your business.
- Connect and check the Sheet with a test request. Online payment is not implemented.
