# Trikonic Imports storefront

A small static storefront, ready to push to a Git repository and deploy on Vercel. No build step or package installation is needed.

## Preview locally

Open `index.html` in a browser, or run a local static server from this folder (for example `python3 -m http.server 8000`) and visit `http://localhost:8000`.

## Manage products in Google Sheets

The website reads its public catalog from the `Website Catalog` tab in the Trikonic spreadsheet. The existing `Products` tab contains inventory and formula-driven business data, so leave that tab as it is and edit `Website Catalog` for website listings.

Each row is one website product. Put its existing inventory SKU in column A. The storefront then takes the product name, category, and current selling price from the `Products` tab automatically. Use the remaining columns:

- `Description`: the text customers see.
- `Photo URL`: a publicly accessible image URL, or a repository path such as `images/raffia-tote.webp`.
- `Availability`: enter exactly `in_stock` or `preorder`.
- `Tag` and `Card Color`: optional display styling; card color can be a hex value such as `#e5dcd0`.
- `Show on website`: enter `TRUE` to publish that row or `FALSE` to hide it.

Only rows marked `TRUE` with a matching SKU and photo are sent to the storefront. Change prices and product names in the existing blue editable columns of the `Products` tab; update photos, descriptions, availability, and visibility in `Website Catalog`. The website receives these catalog fields only; it does not expose stock quantities, profit, or order data. Refresh the site after edits. Once Vercel is connected to the repository, spreadsheet edits do not require a code edit or GitHub commit.

For photos stored with the website, upload optimized JPG/WebP files to an `images` folder in the repository, then enter that relative path in the sheet. Keep images reasonably small (around 300 KB where practical). The hero and story photos are separate; change those `<img src="...">` values in `index.html` when you have brand photos. `products.js` remains a sample fallback until the sheet catalog is ready.

The example products and contact details are placeholders. Replace them before launch. Search the project for `hello@trikonic.com` to update the contact address.

## Send order requests to Google Sheets

The site does not take payment. Customers submit a request; your team confirms availability, delivery, and payment with them. Until you connect Sheets, the form opens a prefilled email to `hello@trikonic.com` (replace this address with one your team checks).

To connect the order form and product catalog to the existing Sheet:

1. In the Trikonic spreadsheet choose **Extensions → Apps Script**.
2. Replace the editor contents with `google-apps-script.gs` from this project and save. It reads the `Website Catalog` tab and writes new orders to `Trikonic Orders`.
3. In Apps Script choose **Deploy → Manage deployments**, edit the Web App deployment, select **New version**, and deploy. Keep **Execute as** set to your account and **Who has access** set to **Anyone**. The Web App URL should remain the same, so `config.js` does not need a change.
4. Refresh the website and confirm a row marked `TRUE` appears. For order setup, submit one clearly marked test order and check `Trikonic Orders`; remove the test row afterwards.

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
