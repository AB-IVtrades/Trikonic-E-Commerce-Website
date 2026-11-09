# Trikonic Imports storefront

A small static storefront, ready to push to a Git repository and deploy on Vercel. No build step or package installation is needed.

## Preview locally

Open `index.html` in a browser, or run a local static server from this folder (for example `python3 -m http.server 8000`) and visit `http://localhost:8000`.

## Add and update products

1. Open `products.js` in a text editor.
2. Each object inside `window.PRODUCTS` represents one product. Update its `name`, `category`, `price`, `description`, `image`, `tag`, and `color`. Prices are Ghana cedis, without a currency symbol.
3. Set `availability` to `"in_stock"` or `"preorder"`. The storefront shows the label on the product and in the bag, and the order sheet records it with the item. Example: `availability: "preorder"`.
4. Give each product a unique `id` made of lowercase letters and hyphens. Categories create the filter buttons automatically.
5. To add another item, copy one complete object, paste it inside the array, add a comma between objects, and save.
6. For your own photos, make an `images` folder beside `index.html`, copy in an optimized JPG/WebP image, and set its path, such as `image: "images/raffia-tote.webp"`. Keep image files reasonably small (around 300 KB where practical) and use a descriptive product photo. Remote image URLs also work, but an image stored in this repository will stay under your control.

The first featured photo in the hero and the story section are set in `index.html`; change those `<img src="...">` values too if you want your own brand photography.

After editing `products.js`, save the file and push the change to the repository’s `main` branch. If Vercel is connected to that repository, it will publish the update automatically.

The example catalog is illustrative. Replace its products, prices, photos, contact email, and wording with your actual business information before launch. Search the project for `hello@trikonic.com` to update the contact address.

## Send order requests to Google Sheets

The site does not take payment. Customers submit a request; your team confirms availability, delivery, and payment with them. Until you connect Sheets, the form opens a prefilled email to `hello@trikonic.com` (replace this address with one your team checks).

To connect the order form to a Sheet:

1. Create a Google spreadsheet for orders.
2. In that spreadsheet choose **Extensions → Apps Script**.
3. Replace the editor contents with `google-apps-script.gs` from this project and save. The script writes a header row the first time it runs and adds new order rows to the `Trikonic Orders` tab. If your second tab has a different exact name, change `SHEET_NAME` in the script to match it. After updating this script, deploy a new version of the Web App for availability labels to appear in the sheet.
4. In Apps Script choose **Deploy → New deployment → Web app**. Set **Execute as** to your account and access to **Anyone**, then deploy and approve the requested permissions. Copy the Web App URL ending in `/exec`.
5. Paste that URL into `config.js` between the quotes, replacing the empty string. Save and redeploy the website.
6. Submit one clearly marked test order and check that it appears in the `Trikonic Orders` sheet. Remove the test row afterwards.

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
