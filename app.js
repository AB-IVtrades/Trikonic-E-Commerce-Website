(() => {
  // The Google Sheet is the catalog source of truth. Never render bundled sample data first.
  let products = [];
  let catalogState = "loading";
  const money = n => `GH₵${Number(n).toFixed(2)}`;
  const CART_KEY = "trikonic-cart-v1";
  const supabaseConfig = window.TRikonicSupabaseConfig || {};
  const supabaseClient = window.supabase?.createClient && supabaseConfig.url && supabaseConfig.publishableKey
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
    : null;
  let signedInUser = null;
  let passwordRecoveryMode = false;
  let resumeCheckoutAfterAuth = false;
  const paymentReturned = new URLSearchParams(location.search).get("payment") === "return";
  const adminEmail = String(window.TRikonicAdminEmail || "").trim().toLowerCase();
  let manualMaintenance = false;
  let maintenanceLoaded = false;
  let cart = new Map();
  try {
    const storedCart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (Array.isArray(storedCart)) cart = new Map(storedCart.filter(row => Array.isArray(row) && row.length === 2 && Number(row[1]) > 0).map(([id, quantity]) => [String(id), Number(quantity)]));
  } catch (_) { cart = new Map(); }
  const excludedCartKey = "trikonic-cart-excluded";
  let excludedCartItems = new Set();
  try {
    excludedCartItems = new Set(JSON.parse(sessionStorage.getItem(excludedCartKey) || "[]"));
  } catch (_) {}
  let category = new URLSearchParams(location.search).get("category") || "All finds";
  let searchTerm = new URLSearchParams(location.search).get("search") || "";
  let maxPriceFilter = Number.POSITIVE_INFINITY;
  let productSort = "recommended";
  const $ = s => document.querySelector(s);
  const grid = $("#product-grid");
  const cartPage = $("#cart-page");
  const homeMore = $("#home-more-products");
  const collection = new URLSearchParams(location.search).get("collection");
  const collectionLabel = { "in-stock": "In stock", preorder: "Pre-orders", sale: "Flash sale" };
  function parseCartKey(key) {
    try { const parsed = JSON.parse(key); if (Array.isArray(parsed) && (parsed.length === 3 || parsed.length === 4)) return { id: String(parsed[0]), color: String(parsed[1] || ""), size: String(parsed[2] || ""), variant: String(parsed[3] || "") }; } catch (_) {}
    return { id: String(key), color: "", size: "", variant: "" };
  }
  function cartKey(id, color = "", size = "", variant = "") { return color || size || variant ? JSON.stringify([String(id), String(color), String(size), String(variant)]) : String(id); }
  function productForCartKey(key) { const { id } = parseCartKey(key); return products.find(item => item.id === id); }
  function inStockLabel(product) {
    const quantity = product.stockQuantity;
    return Number.isSafeInteger(quantity) && quantity > 0 ? `${quantity} in stock` : "In stock";
  }
  function normalizeVariantOption(value) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
  function productVariantOptions(product) { return [...new Set((product?.variantPrices || []).map(option => String(option.label || "").trim()).filter(Boolean))]; }
  function regularPriceFor(product, selection = {}) {
    const prices = product?.variantPrices || [];
    const color = normalizeVariantOption(selection.color), size = normalizeVariantOption(selection.size);
    const find = (matchColor, matchSize) => prices.find(option => normalizeVariantOption(option.color) === matchColor && normalizeVariantOption(option.size) === matchSize);
    const variant = normalizeVariantOption(selection.variant);
    const match = (color && size && find(color, size)) || (variant && prices.find(option => normalizeVariantOption(option.label) === variant)) || (color && find(color, "")) || (size && find("", size));
    return Number(match?.price) || Number(product?.price) || 0;
  }
  function priceFor(product, selection = {}) {
    const regular = regularPriceFor(product, selection);
    const sale = Number(product?.salePrice);
    return { regular, current: product?.flashSale && sale > 0 && sale < regular ? sale : regular, onSale: Boolean(product?.flashSale && sale > 0 && sale < regular) };
  }
  function priceMarkup(product, selection = {}, prefix = "") {
    const { regular, current, onSale } = priceFor(product, selection);
    return onSale ? `<span class="sale-prices"><s>${money(regular)}</s><strong>${money(current)}</strong></span>` : `${prefix}<strong>${money(current)}</strong>`;
  }
  function productStartingPrice(product) {
    const options = (product?.variantPrices || []).map(option => ({ color: option.color, size: option.size, variant: option.label }));
    const prices = [priceFor(product, {}).current, ...options.map(option => priceFor(product, option).current)].filter(price => price > 0);
    return Math.min(...prices);
  }
  function cartSelectionIsValid(product, selection) {
    const matches = (options, selected) => !options?.length || options.some(option => normalizeVariantOption(option) === normalizeVariantOption(selected));
    const variants = productVariantOptions(product);
    return Boolean(product && matches(product.colors, selection.color) && matches(product.sizes, selection.size) && (!variants.length || variants.some(option => normalizeVariantOption(option) === normalizeVariantOption(selection.variant))));
  }
  function saveCart() {
    const entries = [...cart].filter(([, quantity]) => quantity > 0);
    try { localStorage.setItem(CART_KEY, JSON.stringify(entries)); } catch (_) {}
    saveCartSelection();
  }
  function saveCartSelection() {
    excludedCartItems = new Set([...excludedCartItems].filter(key => cart.get(key) > 0));
    try { sessionStorage.setItem(excludedCartKey, JSON.stringify([...excludedCartItems])); } catch (_) {}
  }
  function selectedCartKeys() {
    return [...cart.keys()].filter(key => cart.get(key) > 0 && !excludedCartItems.has(key));
  }
  function cartOrderItems(keys) {
    return keys.map(key => {
      const product = productForCartKey(key);
      if (!product) return null;
      const { color, size, variant } = parseCartKey(key);
      const { current, regular, onSale } = priceFor(product, { color, size, variant });
      const quantity = cart.get(key);
      const shippingRate = product.shippingFee == null ? null : Number(product.shippingFee);
      return {
        id: product.id, name: product.name, color, size, variant, availability: product.availability,
        flashSale: onSale, quantity, unitPrice: current, originalUnitPrice: regular,
        lineTotal: Math.round(current * 100) * quantity / 100,
        shippingTotal: Number.isFinite(shippingRate) && shippingRate >= 0 ? Math.round(shippingRate * 100) * quantity / 100 : null
      };
    }).filter(Boolean);
  }
  function orderTotals(items) {
    const subtotal = items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0);
    const shipping = items.reduce((sum, item) => sum + Math.round((item.shippingTotal || 0) * 100), 0);
    return { subtotal: subtotal / 100, shipping: shipping / 100, total: (subtotal + shipping) / 100 };
  }
  function shippingLabel(items, amount) {
    return items.length && items.every(item => item.shippingTotal == null) ? "Included" : money(amount);
  }
  function resolveProductImage(source) {
    const image = String(source || "").trim();
    if (!image) return "";
    if (/^(https?:\/\/|data:|blob:|\/)/i.test(image)) return image;
    const path = image.replace(/^\.\//, "");
    return path.includes("/") ? path : `images/${path}`;
  }
  let savedReceiptOrder = null;
  function renderCheckoutReceipt(items, target = "#checkout-receipt-items", totalTarget = "#checkout-total") {
    const { subtotal, shipping, total } = orderTotals(items);
    const rows = items.map(item => {
      const options = [item.color && `Colour: ${item.color}`, item.size && `Size: ${item.size}`, item.variant && `Option: ${item.variant}`].filter(Boolean);
      return `<div class="receipt-line"><span>${item.quantity} × ${escapeHtml(item.name)}${options.length ? `<small class="variant-summary">${options.map(escapeHtml).join(" · ")}</small>` : ""}</span><strong>${money(item.lineTotal)}</strong></div>`;
    });
    rows.push(`<div class="receipt-line"><span>Items subtotal</span><strong>${money(subtotal)}</strong></div>`);
    rows.push(`<div class="receipt-line"><span>Shipping</span><strong>${shippingLabel(items, shipping)}</strong></div>`);
    $(target).innerHTML = rows.join("");
    $(totalTarget).textContent = money(total);
  }

  function downloadReceiptPdf(order) {
    const ascii = value => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
    const escapePdf = value => ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const pages = [];
    let operations = [];
    let y = 780;
    const startPage = () => { operations = []; pages.push(operations); y = 780; };
    const write = (text, size = 10, indent = 0) => {
      const clean = ascii(text);
      const maxChars = Math.max(24, Math.floor(88 - indent / 4));
      const words = clean.split(/\s+/);
      const wrapped = [];
      let line = "";
      words.forEach(word => {
        if (line && `${line} ${word}`.length > maxChars) { wrapped.push(line); line = word; }
        else line += `${line ? " " : ""}${word}`;
      });
      if (line) wrapped.push(line);
      wrapped.forEach(part => {
        if (y < 58) startPage();
        operations.push(`BT /F1 ${size} Tf ${50 + indent} ${y} Td (${escapePdf(part)}) Tj ET`);
        y -= Math.max(15, size + 6);
      });
    };
    const rule = () => { if (y < 70) startPage(); operations.push(`0.75 w 50 ${y} m 545 ${y} l S`); y -= 16; };
    startPage();
    write("TRIKONIC IMPORTS", 20);
    write("ORDER REQUEST RECEIPT", 10);
    write(`Order ID: ${order.orderId}`, 10);
    write(`Date: ${new Date(order.createdAt).toLocaleString()}`, 10);
    rule();
    write("CUSTOMER", 10);
    write(`Name: ${order.customer.name}`);
    write(`Contact: ${order.customer.contact}`);
    if (order.customer.location) write(`Delivery area: ${order.customer.location}`);
    rule();
    write("ITEMS", 10);
    order.items.forEach(item => {
      const availability = item.availability === "preorder" ? " (PRE-ORDER)" : item.availability === "out_of_stock" ? " (OUT OF STOCK)" : "";
      const sale = item.flashSale ? " (FLASH SALE)" : "";
      const options = [item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`, item.variant && `Option: ${item.variant}`].filter(Boolean).join(", ");
      write(`${item.quantity} x ${item.name}${options ? ` (${options})` : ""}${availability}${sale} - GHS ${(Number(item.lineTotal) || 0).toFixed(2)}`, 10, 8);
    });
    rule();
    const { subtotal, shipping } = orderTotals(order.items);
    write(`Items subtotal: GHS ${subtotal.toFixed(2)}`);
    write(order.items.some(item => item.shippingTotal != null) ? `Shipping: GHS ${shipping.toFixed(2)}` : "Shipping: Included");
    write(`Order total: GHS ${Number(order.estimatedTotal).toFixed(2)}`, 12);
    rule();
    write("Order summary. Payment must be confirmed separately by Paystack.", 9);

    const objects = [];
    const setObject = (id, value) => { objects[id] = value; };
    setObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
    const pageIds = pages.map((_, index) => 4 + index * 2);
    setObject(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
    setObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    pages.forEach((pageOps, index) => {
      const pageId = pageIds[index];
      const streamId = pageId + 1;
      const stream = pageOps.join("\n");
      setObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
      setObject(streamId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = pdf.length;
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Trikonic-Receipt-${ascii(order.orderId).replace(/[^a-zA-Z0-9-]/g, "")}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderProducts() {
    if (!grid) return;
    if (homeMore) homeMore.hidden = true;
    if (catalogState === "loading") { grid.innerHTML = '<p class="catalog-message">Loading the latest finds…</p>'; return; }
    if (catalogState === "error") { grid.innerHTML = '<p class="catalog-message">We couldn’t load the catalog right now. Please refresh in a moment.</p>'; return; }
    if (catalogState === "empty") { grid.innerHTML = '<p class="catalog-message">No products are published right now. Please check back soon.</p>'; return; }
    const query = searchTerm.trim().toLowerCase();
    let shown = products.filter(p => (category === "All finds" || p.category === category) && productStartingPrice(p) <= maxPriceFilter && (!query || `${p.name} ${p.category} ${p.description} ${(p.colors || []).join(" ")} ${(p.sizes || []).join(" ")}`.toLowerCase().includes(query)));
    if (collection === "in-stock") shown = shown.filter(p => p.availability === "in_stock");
    if (collection === "preorder") shown = shown.filter(p => p.availability === "preorder");
    if (collection === "sale") shown = shown.filter(p => p.flashSale && p.availability !== "out_of_stock");
    if (productSort === "price-low") shown = shown.sort((a, b) => productStartingPrice(a) - productStartingPrice(b));
    else if (productSort === "price-high") shown = shown.sort((a, b) => productStartingPrice(b) - productStartingPrice(a));
    else if (productSort === "name") shown = shown.sort((a, b) => a.name.localeCompare(b.name));
    const resultCount = $("#product-result-count");
    const filteredCollection = Object.hasOwn(collectionLabel, collection);
    if (resultCount) resultCount.textContent = `Showing ${shown.length} of ${products.length} products${filteredCollection ? ` · ${collectionLabel[collection]}` : ""}`;
    const clearCollection = $("#clear-shop-collection");
    if (clearCollection) clearCollection.hidden = !filteredCollection;
    if (!shown.length) { grid.innerHTML = `<p class="catalog-message">${query ? "No finds matched your search. Try another word." : "No products match these filters right now."}</p>`; return; }
    grid.innerHTML = (homeMore ? shown.slice(0, 5) : shown).map(productCardMarkup).join("");
    if (homeMore && shown.length > 5) {
      $("#home-more-grid").innerHTML = shown.slice(5, 10).map(productCardMarkup).join("");
      homeMore.hidden = false;
    }
  }
  function productCardMarkup(p) {
    const preorder = p.availability === "preorder";
    const outOfStock = p.availability === "out_of_stock";
    const availabilityLabel = preorder ? "PRE-ORDER" : outOfStock ? "OUT OF STOCK" : inStockLabel(p).toUpperCase();
    const optionsLabel = [p.colors?.length && `${p.colors.length} colours`, p.sizes?.length && `${p.sizes.length} sizes`].filter(Boolean).join(" · ");
    const startPrice = productStartingPrice(p);
    const price = p.flashSale && startPrice < p.price ? `<span class="sale-prices"><s>${money(p.price)}</s><strong>${money(startPrice)}</strong></span>` : `<strong>${money(startPrice)}</strong>`;
    return `<article class="product-card"><div class="product-photo" style="--product-bg:${p.color || "#eee"}"><button class="product-image-open" data-detail="${escapeAttr(p.id)}" aria-label="View details for ${escapeAttr(p.name)}"><img src="${escapeAttr(resolveProductImage(p.image))}" alt="${escapeAttr(p.name)}" loading="lazy"></button><span class="product-tag">${escapeHtml(p.tag || p.category)}</span>${p.flashSale ? '<span class="sale-ribbon">FLASH SALE</span>' : ""}<button class="quick-add ${outOfStock ? "unavailable" : ""}" data-detail="${escapeAttr(p.id)}" aria-label="View details for ${escapeAttr(p.name)}">→</button></div><div class="product-meta"><div><div class="product-overline"><span class="product-category">${escapeHtml(p.category)}</span><span class="availability-badge ${preorder ? "preorder" : outOfStock ? "out-of-stock" : "in-stock"}">${availabilityLabel}</span></div><h3><button class="product-title-open" data-detail="${escapeAttr(p.id)}">${escapeHtml(p.name)}</button></h3><div class="product-card-price">${price}</div><p>${escapeHtml(p.description)}</p>${optionsLabel ? `<small class="product-options-hint">Available in ${escapeHtml(optionsLabel)}</small>` : ""}</div></div></article>`;
  }
  function renderCategories() {
    const categoryRow = $("#categories");
    const homeCategoryGrid = $("#home-category-grid");
    if (catalogState === "loading" || catalogState === "error" || catalogState === "empty") {
      if (categoryRow) categoryRow.innerHTML = "";
      if (homeCategoryGrid) homeCategoryGrid.innerHTML = "";
      return;
    }
    const categories = [...new Set(products.map(product => product.category).filter(Boolean))];
    if (categoryRow) {
      const cats = ["All finds", ...categories];
      categoryRow.innerHTML = cats.map(c => `<button class="category-chip ${c === category ? "active" : ""}" data-category="${escapeAttr(c)}">${escapeHtml(c)}${c === "All finds" ? ` <span>${products.length}</span>` : ""}</button>`).join("");
    }
    if (homeCategoryGrid) {
      homeCategoryGrid.innerHTML = categories.slice(0, 8).map(name => {
        const image = resolveProductImage(products.find(p => p.category === name && p.image)?.image);
        return `<a class="home-category-card" href="shop.html?category=${encodeURIComponent(name)}"><span class="home-category-photo" aria-hidden="true">${image ? `<img src="${escapeAttr(image)}" alt="" loading="lazy">` : "↗"}</span><strong>${escapeHtml(name)}</strong></a>`;
      }).join("");
      const sale = products.find(p => p.flashSale && p.availability !== "out_of_stock");
      const promo = $("#home-promo-sale");
      if (promo && sale) {
        promo.href = "shop.html?collection=sale#shop";
        if (sale.image) promo.querySelector("img").src = resolveProductImage(sale.image);
        promo.querySelector("h2").textContent = "Flash sale";
        promo.querySelector("p").textContent = "See current discounts on selected items.";
        promo.querySelector("span").textContent = "Shop deals →";
      }
    }
  }
  $("#product-search").value = searchTerm;
  $("#product-search").addEventListener("input", event => { searchTerm = event.currentTarget.value; renderProducts(); });
  $("#search-form").addEventListener("submit", event => { event.preventDefault(); searchTerm = $("#product-search").value.trim(); if (!["shop.html", "categories.html"].includes(location.pathname.split("/").pop())) { location.href = `shop.html?search=${encodeURIComponent(searchTerm)}`; return; } renderProducts(); $("#shop").scrollIntoView({ behavior: "smooth" }); });
  $("#sort-products")?.addEventListener("change", event => { productSort = event.currentTarget.value; renderProducts(); });
  $("#max-price")?.addEventListener("input", event => { maxPriceFilter = Number(event.currentTarget.value); const label = $("#max-price-label"); if (label) label.textContent = `Max Price: GH₵${maxPriceFilter.toLocaleString()}`; renderProducts(); });
  function loadProductsFromSheet() {
    const endpoint = window.TRikonicOrderEndpoint || "";
    const finishCatalogLoad = () => { renderCategories(); renderProducts(); renderCart(); };
    if (!endpoint) { catalogState = "error"; finishCatalogLoad(); return; }
    window.receiveTrikonicProducts = catalog => {
      if (!catalog || !Array.isArray(catalog.products)) { catalogState = "error"; finishCatalogLoad(); return; }
      products = catalog.ready ? catalog.products : [];
      catalogState = products.length ? "ready" : "empty";
      clearTimeout(catalogLoadTimeout);
      finishCatalogLoad();
    };
    const script = document.createElement("script");
    const url = new URL(endpoint);
    url.searchParams.set("callback", "receiveTrikonicProducts");
    url.searchParams.set("t", String(Date.now()));
    script.src = url.toString();
    const catalogLoadTimeout = setTimeout(() => { if (catalogState === "loading") { catalogState = "error"; finishCatalogLoad(); } }, 15000);
    script.onerror = () => { clearTimeout(catalogLoadTimeout); catalogState = "error"; finishCatalogLoad(); console.warn("Could not load the storefront catalog from Google Sheets."); };
    document.head.appendChild(script);
  }
  const mobileNav = $("#mobile-sidebar");
  const mobileNavBackdrop = $("#mobile-nav-backdrop");
  function setMobileNav(open) {
    if (!mobileNav || !mobileNavBackdrop) return;
    mobileNav.classList.toggle("open", open);
    mobileNav.setAttribute("aria-hidden", String(!open));
    mobileNavBackdrop.hidden = !open;
    $("#mobile-menu-open")?.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("mobile-nav-open", open);
  }
  $("#mobile-menu-open")?.addEventListener("click", () => setMobileNav(true));
  $("#mobile-menu-close")?.addEventListener("click", () => setMobileNav(false));
  mobileNavBackdrop?.addEventListener("click", () => setMobileNav(false));
  mobileNav?.querySelectorAll("a").forEach(link => {
    const currentPage = location.pathname.split("/").pop() || "index.html";
    if (link.getAttribute("href") === currentPage) link.setAttribute("aria-current", "page");
    link.addEventListener("click", () => setMobileNav(false));
  });
  $("#mobile-account-open")?.addEventListener("click", () => { setMobileNav(false); showProfile(); });
  function renderCart() {
    const entries = [...cart].filter(([, quantity]) => quantity > 0);
    const count = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
    $("#cart-count").textContent = count;
    $("#cart-open").setAttribute("aria-label", `Shopping cart, ${count} ${count === 1 ? "item" : "items"}`);
    if (!cartPage) return;

    const ready = catalogState === "ready" || catalogState === "empty";
    const status = $("#cart-status");
    status.textContent = !count ? "Your cart is empty." : catalogState === "loading" ? "Loading your cart…" : !ready ? "We couldn’t load your cart. Refresh to try again." : "";
    $("#cart-layout").hidden = !count || !ready;
    if (!count || !ready) {
      $("#cart-selection-count").textContent = "";
      return;
    }
    const keys = selectedCartKeys();
    const items = cartOrderItems(keys);
    const hasUnavailable = items.length !== keys.length || items.some(item => item.availability === "out_of_stock");
    const { subtotal, shipping, total } = orderTotals(items);
    $("#cart-selection-count").textContent = `${keys.length} of ${entries.length} selected for checkout`;
    $("#subtotal").textContent = money(subtotal);
    $("#cart-shipping").textContent = shippingLabel(items, shipping);
    $("#cart-total").textContent = money(total);
    $("#cart-stock-warning").hidden = !hasUnavailable;
    $("#checkout-open").disabled = !items.length || hasUnavailable;

    $("#cart-items").innerHTML = entries.map(([key, quantity]) => {
      const product = productForCartKey(key);
      const selection = parseCartKey(key);
      const name = escapeHtml(product?.name || "Unavailable product");
      const itemKey = escapeAttr(key);
      const unavailable = !product || product.availability === "out_of_stock";
      const options = [selection.color, selection.size, selection.variant].filter(Boolean).map(escapeHtml).join(" · ");
      const image = product && resolveProductImage(productGallery(product).colorPhotos.get(selection.color) || product.image);
      return `<article class="cart-page-item">
        <input type="checkbox" data-cart-select="${itemKey}" aria-label="Select ${name}${options ? `, ${options}` : ""} for checkout" ${excludedCartItems.has(key) ? "" : "checked"}>
        ${image ? `<img src="${escapeAttr(image)}" alt="" width="72" height="72">` : ""}
        <div class="cart-page-item-copy"><h3>${name}</h3>${options ? `<small>${options}</small>` : ""}
          ${product ? priceMarkup(product, selection) : ""}${unavailable ? "<small>Unavailable</small>" : product.availability === "preorder" ? "<small>Pre-order</small>" : ""}
        </div>
        <div class="cart-page-item-actions"><div class="quantity">
          <button type="button" data-qty="${itemKey}" data-delta="-1" aria-label="Remove one ${name}" ${quantity <= 1 ? "disabled" : ""}>−</button>
          <span>${quantity}</span>
          <button type="button" data-qty="${itemKey}" data-delta="1" aria-label="Add one ${name}" ${unavailable ? "disabled" : ""}>+</button>
        </div><button type="button" class="cart-remove" data-remove="${itemKey}" aria-label="Remove ${name} from cart">×</button></div>
      </article>`;
    }).join("");
  }
  $("#cart-items")?.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-cart-select]");
    if (!checkbox) return;
    const key = checkbox.dataset.cartSelect;
    if (checkbox.checked) excludedCartItems.delete(key);
    else excludedCartItems.add(key);
    saveCartSelection();
    renderCart();
    [...$("#cart-items").querySelectorAll("[data-cart-select]")].find(input => input.dataset.cartSelect === key)?.focus({ preventScroll: true });
  });
  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  const detailBackdrop = $("#product-detail-backdrop");
  let detailProduct = null, detailColor = "", detailSize = "", detailVariant = "";
  let detailColorPhotos = new Map();
  const swatchColors = {
    black:"#242424", jet:"#171717", charcoal:"#414141", graphite:"#454545",
    white:"#fffefa", ivory:"#f5f0e5", "off white":"#f5f0e5", "off-white":"#f5f0e5",
    cream:"#eee8d8", beige:"#d8c4a4", oatmeal:"#cbbba3", taupe:"#9b897c", khaki:"#b6a77c",
    tan:"#c49a6c", camel:"#b78354", brown:"#78513b", chocolate:"#54382d",
    red:"#c83b3b", wine:"#781f3b", whine:"#781f3b", burgundy:"#781f3b", maroon:"#742c3b",
    pink:"#e5a3ad", blush:"#e8b2b6", "rose gold":"#b76e79", purple:"#8066a1", lavender:"#b7a3d1",
    blue:"#325c9b", navy:"#162c49", "sky blue":"#9bc8df", teal:"#198b8b", turquoise:"#40b9b3",
    green:"#4f805c", sage:"#a8b899", olive:"#777b43", orange:"#df7c42", yellow:"#e9bf47",
    gold:"#c7a547", silver:"#bfc3c7", grey:"#9b9b98", gray:"#9b9b98"
  };
  const swatchColorNames = Object.keys(swatchColors).sort((a, b) => b.length - a.length);
  function normalizeSwatchName(value) {
    return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9#]+/g, " ").trim().replace(/\s+/g, " ");
  }
  const photoColorAliases = [
    ["white", "cream", "ivory", "off white"],
    ["gray", "grey", "charcoal"],
    ["yellow", "mustard"],
    ["burgundy", "wine", "whine", "maroon"]
  ];
  function productGallery(product) {
    const photos = new Set();
    const colorPhotos = new Map();
    const unlabeledPhotos = [];
    const colors = (product.colors || []).map(label => ({ label, name: normalizeSwatchName(label) }))
      .filter(color => color.name).sort((a, b) => b.name.length - a.name.length);

    for (const entry of [product.image, ...(product.images || [])]) {
      if (!entry) continue;
      const separator = entry.indexOf("|");
      const label = separator < 0 ? "" : entry.slice(0, separator).trim();
      const image = resolveProductImage(separator < 0 ? entry : entry.slice(separator + 1));
      if (!image) continue;
      photos.add(image);
      if (label) {
        const color = colors.find(option => normalizeVariantOption(option.label) === normalizeVariantOption(label));
        if (color) colorPhotos.set(color.label, image);
      } else {
        unlabeledPhotos.push(image);
      }
    }

    const labeledImages = new Set(colorPhotos.values());
    const aliasMatches = [];
    for (const image of unlabeledPhotos) {
      if (labeledImages.has(image) || /^(data:|blob:)/i.test(image)) continue;
      const filename = image.split(/[?#]/)[0].split("/").pop().replace(/\.[^.]+$/, "");
      const words = ` ${normalizeSwatchName(filename.replace(/%20/gi, " "))} `;
      const exact = colors.filter(color => words.includes(` ${color.name} `));
      if (exact.length) {
        const best = exact[0];
        const unambiguous = exact.every(color => ` ${best.name} `.includes(` ${color.name} `));
        if (unambiguous && !colorPhotos.has(best.label)) colorPhotos.set(best.label, image);
        continue;
      }
      const aliases = colors.filter(color => photoColorAliases.some(group =>
        group.includes(color.name) && group.some(name => words.includes(` ${name} `))
      ));
      if (aliases.length === 1) aliasMatches.push([aliases[0].label, image]);
    }
    for (const [color, image] of aliasMatches) {
      if (!colorPhotos.has(color)) colorPhotos.set(color, image);
    }
    return { images: [...photos], colorPhotos };
  }
  function showDetailPhoto(image) {
    $("#detail-main-image").src = image;
    $("#detail-thumbnails").querySelectorAll("[data-detail-image]").forEach(button => {
      const active = button.dataset.detailImage === image;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function swatchFor(color) {
    const value = String(color || "").trim();
    if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return value;
    const normalized = normalizeSwatchName(value);
    const padded = ` ${normalized} `;
    const match = swatchColorNames.find(name => padded.includes(` ${normalizeSwatchName(name)} `));
    return match ? swatchColors[match] : "#d8d4ca";
  }
  function swatchMarkFor(color) {
    const hex = swatchFor(color).slice(1);
    const full = hex.length === 3 ? hex.split("").map(value => value + value).join("") : hex;
    const rgb = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    return luminance < .38 ? "#ffffff" : "#0b2f4d";
  }
  function renderDetailOptions() {
    if (!detailProduct) return;
    $("#detail-color-group").hidden = !detailProduct.colors?.length;
    $("#detail-size-group").hidden = !detailProduct.sizes?.length;
    $("#detail-variant-group").hidden = !productVariantOptions(detailProduct).length;
    $("#detail-color-label").textContent = detailColor ? `Selected: ${detailColor}` : "Choose a colour";
    $("#detail-size-label").textContent = detailSize ? `Selected: ${detailSize}` : "Choose a size";
    $("#detail-variant-label").textContent = detailVariant ? `Selected: ${detailVariant}` : "Choose an option";
    $("#detail-colors").innerHTML = (detailProduct.colors || []).map(color => `<button type="button" class="detail-swatch ${color === detailColor ? "selected" : ""}" style="--swatch:${swatchFor(color)};--swatch-mark:${swatchMarkFor(color)}" data-detail-color="${escapeAttr(color)}" aria-label="${escapeAttr(color)}" aria-pressed="${color === detailColor}"><span class="visually-hidden">${escapeHtml(color)}</span></button>`).join("");
    $("#detail-sizes").innerHTML = (detailProduct.sizes || []).map(size => `<button type="button" class="detail-size ${size === detailSize ? "selected" : ""}" data-detail-size="${escapeAttr(size)}" aria-pressed="${size === detailSize}">${escapeHtml(size)}</button>`).join("");
    $("#detail-variants").innerHTML = productVariantOptions(detailProduct).map(option => `<button type="button" class="detail-size ${option === detailVariant ? "selected" : ""}" data-detail-variant="${escapeAttr(option)}" aria-pressed="${option === detailVariant}">${escapeHtml(option)}</button>`).join("");
    const missingChoice = Boolean((detailProduct.colors?.length && !detailColor) || (detailProduct.sizes?.length && !detailSize) || (productVariantOptions(detailProduct).length && !detailVariant));
    const unavailable = detailProduct.availability === "out_of_stock";
    $("#detail-price").innerHTML = priceMarkup(detailProduct, { color: detailColor, size: detailSize, variant: detailVariant });
    $("#detail-add").disabled = unavailable || missingChoice;
    $("#detail-purchase-status").textContent = missingChoice && !unavailable ? "Choose the available options to continue." : $("#detail-availability").textContent;
  }
  function openProductDetail(product) {
    detailProduct = product;
    detailColor = "";
    detailSize = "";
    detailVariant = "";
    const { images, colorPhotos } = productGallery(product);
    detailColorPhotos = colorPhotos;
    $("#detail-main-image").alt = product.name;
    $("#detail-thumbnails").innerHTML = images.map((image, index) => `<button type="button" class="detail-thumbnail" data-detail-image="${escapeAttr(image)}" aria-label="View product image ${index + 1}"><img src="${escapeAttr(image)}" alt=""></button>`).join("");
    showDetailPhoto(images[0] || "");
    $("#detail-category").textContent = product.category || "Trikonic find";
    $("#detail-name").textContent = product.name;
    $("#detail-description").textContent = product.description || "Thoughtfully selected and ready to make yours.";
    const availability = product.availability === "preorder" ? "Available for pre-order" : product.availability === "out_of_stock" ? "Currently out of stock" : inStockLabel(product);
    $("#detail-availability").textContent = availability;
    $("#detail-availability").className = `detail-availability ${product.availability === "preorder" ? "preorder" : product.availability === "out_of_stock" ? "out-of-stock" : "in-stock"}`;
    $("#detail-price").innerHTML = priceMarkup(product);
    $("#detail-purchase-status").textContent = availability;
    $("#detail-add").disabled = product.availability === "out_of_stock";
    $("#detail-add").innerHTML = product.availability === "out_of_stock" ? "Out of stock" : 'Add to bag <span>↗</span>';
    const specs = Array.isArray(product.specs) ? product.specs : [];
    $("#detail-specs-table").innerHTML = specs.length ? `<dl>${specs.map(spec => `<div><dt>${escapeHtml(spec.name)}</dt><dd>${escapeHtml(spec.value)}</dd></div>`).join("")}</dl>` : '<p class="detail-no-specs">Product specifications will be added soon.</p>';
    renderDetailOptions();
    detailBackdrop.classList.add("show");
    detailBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
  function closeProductDetail() {
    detailBackdrop.classList.remove("show");
    detailBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    detailProduct = null;
  }
  $("#detail-close").addEventListener("click", closeProductDetail);
  detailBackdrop.addEventListener("click", event => { if (event.target === detailBackdrop) closeProductDetail(); });
  $("#detail-thumbnails").addEventListener("click", event => {
    const thumbnail = event.target.closest("[data-detail-image]");
    if (thumbnail) showDetailPhoto(thumbnail.dataset.detailImage);
  });
  $("#detail-colors").addEventListener("click", event => {
    const button = event.target.closest("[data-detail-color]");
    if (!button) return;
    detailColor = button.dataset.detailColor;
    showDetailPhoto(detailColorPhotos.get(detailColor) || resolveProductImage(detailProduct.image));
    renderDetailOptions();
    [...$("#detail-colors").querySelectorAll("[data-detail-color]")]
      .find(swatch => swatch.dataset.detailColor === detailColor)?.focus({ preventScroll: true });
  });
  $("#detail-sizes").addEventListener("click", event => { const button = event.target.closest("[data-detail-size]"); if (button) { detailSize = button.dataset.detailSize; renderDetailOptions(); } });
  $("#detail-variants").addEventListener("click", event => { const button = event.target.closest("[data-detail-variant]"); if (button) { detailVariant = button.dataset.detailVariant; renderDetailOptions(); } });
  $("#detail-add").addEventListener("click", () => {
    if (!detailProduct || detailProduct.availability === "out_of_stock" || !cartSelectionIsValid(detailProduct, { color: detailColor, size: detailSize, variant: detailVariant })) return;
    addProductToCart(detailProduct, detailColor, detailSize, detailVariant);
    closeProductDetail();
  });
  const variantBackdrop = $("#variant-backdrop");
  let pendingVariantProduct = null;
  function fillVariantSelect(select, values, label) {
    select.required = values.length > 0;
    select.innerHTML = `<option value="">Choose ${label.toLowerCase()}</option>${values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("")}`;
  }
  function openVariantPicker(product) {
    pendingVariantProduct = product;
    $("#variant-product-name").textContent = product.name;
    $("#variant-color-field").hidden = !product.colors?.length;
    $("#variant-size-field").hidden = !product.sizes?.length;
    $("#variant-option-field").hidden = !productVariantOptions(product).length;
    fillVariantSelect($("#variant-color"), product.colors || [], "colour");
    fillVariantSelect($("#variant-size"), product.sizes || [], "size");
    fillVariantSelect($("#variant-option"), productVariantOptions(product), "option");
    $("#variant-status").textContent = "";
    updateVariantPickerPrice();
    variantBackdrop.classList.add("show");
    variantBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
  function updateVariantPickerPrice() {
    if (!pendingVariantProduct) return;
    const selection = { color: $("#variant-color").value, size: $("#variant-size").value, variant: $("#variant-option").value };
    const { regular, current, onSale } = priceFor(pendingVariantProduct, selection);
    $("#variant-product-name").textContent = `${pendingVariantProduct.name} · ${money(current)}${onSale ? ` (was ${money(regular)})` : ""}`;
  }
  function closeVariantPicker() {
    variantBackdrop.classList.remove("show");
    variantBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    pendingVariantProduct = null;
  }
  function addProductToCart(product, color = "", size = "", variant = "") {
    const key = cartKey(product.id, color, size, variant);
    cart.set(key, (cart.get(key) || 0) + 1);
    saveCart(); renderCart();
  }
  $("#variant-close").addEventListener("click", closeVariantPicker);
  $("#variant-color").addEventListener("change", updateVariantPickerPrice);
  $("#variant-size").addEventListener("change", updateVariantPickerPrice);
  $("#variant-option").addEventListener("change", updateVariantPickerPrice);
  variantBackdrop.addEventListener("click", event => { if (event.target === variantBackdrop) closeVariantPicker(); });
  $("#variant-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!pendingVariantProduct) return;
    const color = $("#variant-color").value, size = $("#variant-size").value, variant = $("#variant-option").value;
    if ((pendingVariantProduct.colors?.length && !color) || (pendingVariantProduct.sizes?.length && !size) || (productVariantOptions(pendingVariantProduct).length && !variant)) {
      $("#variant-status").textContent = "Choose the available options to continue.";
      return;
    }
    addProductToCart(pendingVariantProduct, color, size, variant);
    closeVariantPicker();
  });
  document.addEventListener("click", e => {
    const detail = e.target.closest("[data-detail]"); if (detail) { const product = products.find(p => p.id === detail.dataset.detail); if (product) openProductDetail(product); return; }
    const add = e.target.closest("[data-add]"); if (add) { const product = products.find(p => p.id === add.dataset.add); if (!product || product.availability === "out_of_stock") return; if (product.colors?.length || product.sizes?.length || productVariantOptions(product).length) openVariantPicker(product); else addProductToCart(product); }
    const filter = e.target.closest("[data-category]"); if (filter) { category = filter.dataset.category; renderCategories(); renderProducts(); }
    const qty = e.target.closest("[data-qty]"); if (qty) { const product = productForCartKey(qty.dataset.qty); if (Number(qty.dataset.delta) > 0 && product?.availability === "out_of_stock") return; cart.set(qty.dataset.qty, Math.max(0, (cart.get(qty.dataset.qty) || 0) + Number(qty.dataset.delta))); saveCart(); renderCart(); }
    const remove = e.target.closest("[data-remove]"); if (remove) { cart.delete(remove.dataset.remove); saveCart(); renderCart(); }
  });
  function openCheckout() {
    if (storefrontIsClosed() && !isStoreAdmin()) return;
    const keys = selectedCartKeys();
    const items = cartOrderItems(keys);
    if (!items.length || items.length !== keys.length || items.some(item => item.availability === "out_of_stock")) return;
    const fields = $("#order-form").elements;
    if (!fields.name.value) fields.name.value = signedInUser?.user_metadata?.full_name || "";
    if (!fields.contact.value) fields.contact.value = signedInUser?.user_metadata?.checkout_phone || signedInUser?.email || "";
    $("#form-status").textContent = "";
    $("#checkout-form-view").hidden = false;
    $("#checkout-success-view").hidden = true;
    $("#modal-backdrop").classList.add("show");
    document.body.classList.add("no-scroll");
    renderCheckoutReceipt(items);
  }
  $("#checkout-open")?.addEventListener("click", () => {
    if (storefrontIsClosed() && !isStoreAdmin()) return;
    if (!signedInUser) {
      resumeCheckoutAfterAuth = true;
      openAccount("signup");
      $("#account-status").textContent = "Create an account or sign in to place your order and track its progress.";
      return;
    }
    openCheckout();
  });
  const closeModal = () => { $("#modal-backdrop").classList.remove("show"); document.body.classList.remove("no-scroll"); };
  $("#checkout-close").addEventListener("click", closeModal); $("#modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });
  $("#receipt-download").addEventListener("click", () => { if (savedReceiptOrder) downloadReceiptPdf(savedReceiptOrder); });
  // Every storefront route uses the payment-enabled checkout. Keep this guard
  // so shared startup remains resilient if a page is intentionally simplified.
  async function startPaystackPayment() {
    if (!savedReceiptOrder || !supabaseClient) return false;
    const button = $("#pay-order-now"), status = $("#payment-start-status");
    if (!button || !status) return false;
    button.disabled = true; button.textContent = "Opening Paystack…"; status.textContent = "Connecting to secure payment…";
    try {
      const { data, error } = await supabaseClient.functions.invoke("initialize-paystack-payment", { body: { orderNumber: savedReceiptOrder.orderId } });
      if (error || !data?.authorizationUrl) throw new Error(data?.error || error?.message || "Payment could not start.");
      window.location.assign(data.authorizationUrl);
      return true;
    } catch (error) {
      button.disabled = false; button.innerHTML = 'Continue to secure payment <span>↗</span>';
      status.textContent = `${error.message || "Payment could not start."} Your order is saved; use the button to retry or pay from your order history.`;
      return false;
    }
  }
  $("#pay-order-now")?.addEventListener("click", () => startPaystackPayment());
  const accountBackdrop = $("#account-backdrop");
  const closeAccount = () => { accountBackdrop.classList.remove("show"); accountBackdrop.setAttribute("aria-hidden", "true"); document.body.classList.remove("no-scroll"); };
  function isStoreAdmin() { return Boolean(signedInUser?.email && adminEmail && signedInUser.email.trim().toLowerCase() === adminEmail); }
  function outsideStoreHours(now = new Date()) {
    // Ghana uses GMT year-round.
    const day = now.getUTCDay();
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (day === 0) return true;
    if (day === 6) return minutes < 9 * 60 || minutes >= 15 * 60;
    return minutes < 8 * 60 + 30 || minutes >= 18 * 60;
  }
  function storefrontIsClosed() { return manualMaintenance || outsideStoreHours(); }
  let lastScheduledClosure;
  function renderMaintenanceMode() {
    const isAdmin = isStoreAdmin();
    const scheduledClosure = outsideStoreHours();
    lastScheduledClosure = scheduledClosure;
    const showScreen = (manualMaintenance || scheduledClosure) && !isAdmin;
    const screen = $("#maintenance-screen");
    if (showScreen && screen.hidden) {
      setMobileNav(false);
      closeProductDetail();
      closeVariantPicker();
      if (!savedReceiptOrder) closeModal();
    }
    screen.hidden = !showScreen;
    screen.querySelector("p").textContent = scheduledClosure && !manualMaintenance
      ? "Shop Monday to Friday, 8:30 AM–6:00 PM, and Saturday, 9:00 AM–3:00 PM GMT. We’re closed on Sundays."
      : "We’re updating the collection right now. Please check back soon.";
    document.body.classList.toggle("maintenance-active", showScreen);
    $("#admin-maintenance-control").hidden = !isAdmin;
    $("#maintenance-status").textContent = !maintenanceLoaded ? "Checking storefront status…"
      : manualMaintenance ? "Manual maintenance is on."
      : scheduledClosure ? "The store is closed outside scheduled hours."
      : "The storefront is open.";
    $("#maintenance-toggle").textContent = manualMaintenance ? "Turn off manual maintenance" : "Turn on manual maintenance";
    $("#maintenance-toggle").setAttribute("aria-pressed", String(manualMaintenance));
  }
  async function loadMaintenanceMode() {
    if (!supabaseClient) { maintenanceLoaded = true; renderMaintenanceMode(); return; }
    const { data, error } = await supabaseClient.from("site_settings").select("maintenance_mode").eq("id", 1).maybeSingle();
    if (error) { console.warn("Could not load storefront maintenance setting.", error); maintenanceLoaded = true; renderMaintenanceMode(); return; }
    manualMaintenance = Boolean(data?.maintenance_mode);
    maintenanceLoaded = true;
    renderMaintenanceMode();
  }
  $("#maintenance-toggle").addEventListener("click", async () => {
    if (!isStoreAdmin() || !supabaseClient) return;
    const button = $("#maintenance-toggle");
    button.disabled = true;
    $("#maintenance-status").textContent = "Saving storefront setting…";
    const nextMode = !manualMaintenance;
    const { data, error } = await supabaseClient.from("site_settings").update({ maintenance_mode: nextMode }).eq("id", 1).select("maintenance_mode").single();
    button.disabled = false;
    if (error || !data) {
      $("#maintenance-status").textContent = "Could not update the storefront. Check admin access and try again.";
      console.error("Could not update maintenance mode.", error);
      return;
    }
    manualMaintenance = Boolean(data.maintenance_mode);
    renderMaintenanceMode();
  });
  function openAccount(mode = "signin") { setAuthMode(mode); accountBackdrop.classList.add("show"); accountBackdrop.setAttribute("aria-hidden", "false"); document.body.classList.add("no-scroll"); if (signedInUser) loadOrderHistory(); }
  const profilePage = $("#profile-page");
  let profileUserId = null;
  let avatarVersion = "";
  let avatarUrl = "";
  let authReady = !supabaseClient;

  function showProfile() {
    if (!signedInUser) openAccount("signup");
    else if (profilePage) $("#profile-details-title").scrollIntoView({ block: "nearest" });
    else location.assign("profile.html");
  }

  function paintProfileAvatars() {
    const name = signedInUser?.user_metadata?.full_name?.trim() || signedInUser?.email || "";
    const initial = Array.from(name)[0]?.toUpperCase() || "";
    for (const element of [$("#account-initial"), $("#profile-avatar")].filter(Boolean)) {
      element.textContent = initial;
      if (avatarUrl) {
        const img = document.createElement("img");
        img.src = avatarUrl;
        img.alt = "";
        element.replaceChildren(img);
      }
    }
    $("#account-initial").hidden = !signedInUser;
    $("#account-open .account-icon").hidden = Boolean(signedInUser);
  }

  async function loadProfileAvatar(userId, version) {
    const { data, error } = await supabaseClient.storage.from("profile-photos").download(`${userId}/avatar`);
    if (error || signedInUser?.id !== userId || avatarVersion !== version) return;
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    avatarUrl = URL.createObjectURL(data);
    paintProfileAvatars();
  }

  function renderProfile() {
    const userId = signedInUser?.id || null;
    const version = userId ? String(signedInUser.user_metadata?.profile_photo_version || "") : "";
    if (profileUserId !== userId || avatarVersion !== version) {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
      avatarUrl = "";
      avatarVersion = version;
      if (version) setTimeout(() => {
        if (signedInUser?.id === userId && avatarVersion === version) loadProfileAvatar(userId, version);
      }, 0);
    }
    paintProfileAvatars();
    if (profilePage) {
      $("#profile-page-status").hidden = authReady;
      $("#profile-guest").hidden = !authReady || Boolean(userId);
      $("#profile-layout").hidden = !userId;
      $("#profile-actions").hidden = !userId;
      if (profileUserId !== userId) {
        const fields = $("#profile-details-form").elements;
        fields.fullName.value = signedInUser?.user_metadata?.full_name || "";
        fields.email.value = signedInUser?.email || "";
        fields.phone.value = signedInUser?.user_metadata?.checkout_phone || "";
        $("#profile-password-form").reset();
        profilePage.querySelectorAll(".form-status").forEach(status => { status.textContent = ""; });
      }
    }
    profileUserId = userId;
  }

  async function runProfileAction(button, status, action) {
    const userId = signedInUser?.id;
    if (!userId) return;
    button.disabled = true;
    status.textContent = "";
    status.classList.remove("account-error");
    try {
      const message = await action();
      if (signedInUser?.id === userId) status.textContent = message;
    } catch (error) {
      if (signedInUser?.id === userId) {
        status.textContent = error.message || "Something went wrong. Please try again.";
        status.classList.add("account-error");
      }
    } finally {
      button.disabled = false;
    }
  }

  if (profilePage) {
    $("#profile-signin").addEventListener("click", () => openAccount("signin"));
    $("#profile-orders").addEventListener("click", () => openAccount());
    $("#profile-signout").addEventListener("click", () => signOut($("#profile-details-status")));
    $("#profile-details-form").addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      const { fullName, phone } = form.elements;
      runProfileAction(form.querySelector("[type=submit]"), $("#profile-details-status"), async () => {
        const name = fullName.value.trim();
        if (!name) throw new Error("Enter your full name.");
        const { error } = await supabaseClient.auth.updateUser({ data: { full_name: name, checkout_phone: phone.value.trim() } });
        if (error) throw error;
        return "Profile saved.";
      });
    });
    $("#profile-password-form").addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      const { currentPassword, newPassword, confirmPassword } = form.elements;
      runProfileAction(form.querySelector("[type=submit]"), $("#profile-password-status"), async () => {
        if (newPassword.value !== confirmPassword.value) throw new Error("Your new passwords don’t match.");
        const { error } = await supabaseClient.auth.updateUser({ password: newPassword.value, current_password: currentPassword.value });
        if (error) throw error;
        form.reset();
        return "Password updated.";
      });
    });
    $("#profile-reset").addEventListener("click", event => {
      runProfileAction(event.currentTarget, $("#profile-password-status"), async () => {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(signedInUser.email, { redirectTo: location.origin });
        if (error) throw error;
        return "Check your email for the password reset link.";
      });
    });
    $("#profile-photo").addEventListener("change", event => {
      const input = event.currentTarget;
      const file = input.files[0];
      if (!file) return;
      runProfileAction(input, $("#profile-photo-status"), async () => {
        if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error("Choose a JPG or PNG up to 2 MB.");
        const userId = signedInUser.id;
        const bucket = supabaseClient.storage.from("profile-photos");
        const { error: uploadError } = await bucket.upload(`${userId}/avatar`, file, { upsert: true, cacheControl: "0" });
        if (uploadError) throw uploadError;
        if (signedInUser?.id !== userId) return "";
        const { error } = await supabaseClient.auth.updateUser({ data: { profile_photo_version: String(Date.now()) } });
        if (error) throw error;
        return "Profile photo updated.";
      }).finally(() => { input.value = ""; });
    });
  }

  function renderAccountState() {
    const showAuth = !signedInUser || passwordRecoveryMode;
    $("#account-backdrop .account-modal").classList.toggle("account-auth-mode", showAuth);
    renderProfile();
    $("#account-open").setAttribute("aria-label", signedInUser ? "My account" : "Sign in or create an account");
    $("#account-menu-auth").textContent = signedInUser ? "My profile" : "Sign in or create account";
    $("#account-menu-history").innerHTML = signedInUser ? '<span aria-hidden="true">▤</span> Order history' : '<span aria-hidden="true">▤</span> Purchase history';
    $("#account-auth-view").hidden = !showAuth;
    $("#account-dashboard").hidden = showAuth;
    if (signedInUser) $("#account-email").textContent = signedInUser.email || "Signed in";
    renderMaintenanceMode();
  }
  async function loadOrderHistory() {
    const history = $("#order-history");
    const status = $("#orders-status");
    if (!signedInUser || !supabaseClient) return;
    status.textContent = "Loading your orders…";
    const { data, error } = await supabaseClient.from("orders").select("id,order_number,items,estimated_total,currency,status,payment_status,created_at,order_status_events(status,created_at)").order("created_at", { ascending: false }).limit(25);
    if (error) { status.textContent = "We couldn’t load your order history. Please try again."; return; }
    status.textContent = paymentReturned ? "Paystack has returned you to Trikonic. Payment status updates after secure verification; refresh shortly if it still says pending." : "";
    if (!data.length) { history.innerHTML = '<p class="account-empty">No order requests yet. Your requests will appear here.</p>'; return; }
    const stages = ["Order Received", "Payment Made", "Order Placed", "Order Shipped", "Order Arrived in Ghana", "Order Arrived at Warehouse", "Order Ready for Collection", "Order Delivered"];
    const normalized = value => String(value || "Order Received").trim().toLowerCase().replace(/[ _-]+/g, " ");
    const legacyStatusLabels = { new: "Order Received", confirmed: "Payment Made", preparing: "Order Placed", "in transit": "Order Shipped", delivered: "Order Delivered", cancelled: "Order Cancelled", "order cancelled": "Order Cancelled" };
    const displayStatus = value => legacyStatusLabels[normalized(value)] || stages.find(stage => normalized(stage) === normalized(value)) || "Order Received";
    const formatStamp = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
    history.innerHTML = data.map(order => {
      const date = new Date(order.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      const lineItems = Array.isArray(order.items) ? order.items : [];
      const summary = lineItems.map(item => `${Number(item.quantity) || 0} × ${escapeHtml(item.name || "Item")}${item.color || item.size ? ` (${[item.color, item.size].filter(Boolean).map(escapeHtml).join(", ")})` : ""}`).join(" · ");
      const current = displayStatus(order.status);
      const canCancel = ["Order Received", "Payment Made", "Order Placed"].includes(current);
      const currentIndex = stages.findIndex(stage => normalized(stage) === normalized(current));
      const events = Array.isArray(order.order_status_events) ? order.order_status_events : [];
      const timeline = normalized(current) === "order cancelled"
        ? `<div class="order-cancelled"><strong>Order Cancelled</strong><span>${escapeHtml(formatStamp(events.find(event => normalized(displayStatus(event.status)) === "order cancelled")?.created_at) || "Contact us if you have questions.")}</span></div>`
        : `<ol class="order-progress" aria-label="Order progress">${stages.map((stage, index) => {
          const event = events.find(entry => normalized(displayStatus(entry.status)) === normalized(stage));
          const done = currentIndex >= 0 && index <= currentIndex;
          const when = event ? formatStamp(event.created_at) : "";
          return `<li class="${done ? "complete" : ""} ${index === currentIndex ? "current" : ""}"><span class="progress-dot" aria-hidden="true"></span><span class="progress-copy"><strong>${escapeHtml(stage)}</strong>${when ? `<time>${escapeHtml(when)}</time>` : ""}</span></li>`;
        }).join("")}</ol>`;
      const latestEvent = events.length ? [...events].sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0] : null;
      const details = lineItems.map(item => `<li><span>${Number(item.quantity) || 0} × ${escapeHtml(item.name || "Item")}${item.color || item.size ? `<small class="cart-variant-summary">${[item.color && `Colour: ${item.color}`, item.size && `Size: ${item.size}`].filter(Boolean).map(escapeHtml).join(" · ")}</small>` : ""}</span><strong>${money(Number(item.lineTotal) || (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</strong></li>`).join("");
      const unpaid = order.payment_status !== "paid" && order.payment_status !== "not_required" && current !== "Order Cancelled";
      const paymentLine = order.payment_status === "paid" ? '<p class="order-payment-state paid">Payment confirmed</p>' : unpaid ? `<p class="order-payment-state">Payment pending · Shipping included</p><button class="pay-order-button" type="button" data-pay-order="${escapeAttr(order.order_number)}">Pay securely with Paystack</button>` : "";
      return `<details class="order-card"><summary class="order-card-summary"><div class="order-card-head"><strong>${escapeHtml(order.order_number)}</strong><span class="order-status">${escapeHtml(current)}</span></div><p class="order-card-meta">${date} · ${money(order.estimated_total)}</p><p class="order-card-items">${summary || "Order details"}</p><span class="order-expand-label">View order tracking <span aria-hidden="true">＋</span></span></summary><div class="order-card-details"><div class="tracking-heading"><span class="eyebrow">ORDER TRACKING</span><strong>${escapeHtml(current)}</strong></div>${timeline}<div class="tracking-items"><span class="eyebrow">YOUR ITEMS</span><ul>${details}</ul></div><p class="tracking-updated">${latestEvent ? `Last updated ${escapeHtml(formatStamp(latestEvent.created_at))}` : `Placed ${escapeHtml(date)}`}</p>${paymentLine}${canCancel ? `<button class="cancel-order-button" type="button" data-cancel-order="${escapeAttr(order.order_number)}">Cancel this order</button><p class="cancel-order-note">Orders cannot be cancelled after they have shipped.</p>` : ""}</div></details>`;
    }).join("");
  }
  $("#order-history").addEventListener("click", async event => {
    const payButton = event.target.closest("[data-pay-order]");
    if (payButton) {
      event.preventDefault(); event.stopPropagation(); payButton.disabled = true; payButton.textContent = "Opening Paystack…";
      const { data, error } = await supabaseClient.functions.invoke("initialize-paystack-payment", { body: { orderNumber: payButton.dataset.payOrder } });
      if (error || !data?.authorizationUrl) { payButton.disabled = false; payButton.textContent = "Pay securely with Paystack"; $("#orders-status").textContent = data?.error || error?.message || "Payment could not start. Please try again."; return; }
      window.location.assign(data.authorizationUrl); return;
    }
    const button = event.target.closest("[data-cancel-order]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const orderNumber = button.dataset.cancelOrder;
    const orderStatus = $("#orders-status");
    if (!window.confirm(`Cancel order ${orderNumber}? This cannot be undone.`)) return;
    button.disabled = true;
    button.textContent = "Cancelling…";
    orderStatus.textContent = "";
    try {
      const { data, error } = await supabaseClient.functions.invoke("customer-cancel-order", {
        body: { orderNumber, appsScriptEndpoint: window.TRikonicOrderEndpoint || "" }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "We couldn’t cancel this order. Please try again.");
      await loadOrderHistory();
      orderStatus.textContent = "Your order was cancelled, and the order spreadsheet was updated.";
    } catch (error) {
      orderStatus.textContent = error.message || "We couldn’t cancel this order. Please try again.";
      button.disabled = false;
      button.textContent = "Cancel this order";
    }
  });
  function setAuthMode(mode) {
    const signup = mode === "signup";
    const recovery = mode === "recover";
    const updatePassword = mode === "update-password";
    const signIn = mode === "signin";
    if (!updatePassword) passwordRecoveryMode = false;
    const nameField = $("#account-name-field");
    const passwordField = $("#account-password-field");
    if (nameField) nameField.hidden = !signup;
    if (passwordField) passwordField.hidden = recovery;
    const passwordInput = $("#account-form [name=password]");
    passwordInput.required = !recovery;
    passwordInput.autocomplete = updatePassword ? "new-password" : "current-password";
    if (passwordField?.firstChild) passwordField.firstChild.textContent = updatePassword ? "New password" : "Password";
    $("#account-title").innerHTML = signup ? "Create your <em>account.</em>" : recovery ? "Reset your <em>password.</em>" : updatePassword ? "Choose a <em>new password.</em>" : "Welcome to <em>Trikonic.</em>";
    $("#account-intro").textContent = signup ? "Create an account to place orders, keep your bag on this device, and track requests here. If you’ve registered this email before, sign in or use Forgot password? instead." : recovery ? "We’ll email you a secure link to reset your password." : updatePassword ? "Choose a new password for your Trikonic account." : "Sign in to place order requests and keep track of them here.";
    $("#account-submit").innerHTML = signup ? "Create account <span>↗</span>" : recovery ? "Send reset link <span>↗</span>" : updatePassword ? "Update password <span>↗</span>" : "Sign in <span>↗</span>";
    const recoveryActions = $("#account-recovery-actions");
    if (recoveryActions) recoveryActions.hidden = !signIn;
    $("#account-switch-copy").innerHTML = signup ? 'Already have an account? <button type="button" id="account-switch">Sign in</button>' : signIn ? 'New here? <button type="button" id="account-switch">Create an account</button>' : '<button type="button" id="account-switch">Back to sign in</button>';
    $("#account-form").dataset.mode = mode;
    $("#account-status").textContent = "";
    $("#account-status").classList.remove("account-error");
  }
  const accountPopover = $("#account-popover");
  function setAccountPopover(open) {
    accountPopover.hidden = !open;
    $("#account-open").setAttribute("aria-expanded", String(open));
  }
  $("#account-open").addEventListener("click", () => setAccountPopover(accountPopover.hidden));
  $("#account-menu-auth").addEventListener("click", () => { setAccountPopover(false); showProfile(); });
  $("#account-menu-history").addEventListener("click", () => { setAccountPopover(false); openAccount("signin"); });
  $("#account-side-track").addEventListener("click", event => { document.querySelectorAll(".account-side-link").forEach(link => link.classList.remove("active")); event.currentTarget.classList.add("active"); $("#order-history").scrollIntoView({ block: "nearest" }); });
  $("#account-side-history").addEventListener("click", event => { document.querySelectorAll(".account-side-link").forEach(link => link.classList.remove("active")); event.currentTarget.classList.add("active"); $("#order-history").scrollIntoView({ block: "nearest" }); });
  document.addEventListener("click", event => { if (!event.target.closest(".account-menu-wrap")) setAccountPopover(false); });
  $("#maintenance-admin-open").addEventListener("click", () => openAccount("signin"));
  $("#footer-track-order")?.addEventListener("click", () => openAccount("signin"));
  $("#home-track-order")?.addEventListener("click", () => openAccount("signin"));
  $("#account-close").addEventListener("click", closeAccount);
  $("#orders-refresh").addEventListener("click", loadOrderHistory);
  accountBackdrop.addEventListener("click", e => { if (e.target === accountBackdrop) closeAccount(); });
  $("#account-switch-copy").addEventListener("click", e => {
    if (e.target.id !== "account-switch") return;
    const mode = $("#account-form").dataset.mode;
    setAuthMode(mode === "signup" ? "signin" : mode === "signin" ? "signup" : "signin");
  });
  $("#account-forgot-password")?.addEventListener("click", () => setAuthMode("recover"));
  async function sendAccountEmail(kind) {
    const status = $("#account-status");
    const button = kind === "recovery" ? $("#account-submit") : $("#account-resend-confirmation");
    const email = String($("#account-form [name=email]").value || "").trim();
    if (!email) { status.textContent = "Enter your email address first."; status.classList.add("account-error"); $("#account-form [name=email]").focus(); return; }
    if (!supabaseClient) { status.textContent = "Account access isn’t configured yet. Please contact us."; status.classList.add("account-error"); return; }
    button.disabled = true;
    status.classList.remove("account-error");
    try {
      const response = kind === "recovery"
        ? await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        : await supabaseClient.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin } });
      if (response.error) throw response.error;
      status.textContent = kind === "recovery"
        ? "If an account exists for that address, we’ve sent a password reset link. Check your inbox and spam folder."
        : "If that account still needs confirmation, we’ve sent a fresh confirmation link. Check your inbox and spam folder.";
    } catch (error) {
      status.textContent = error.message || "We couldn’t send that email. Wait a minute and try again.";
      status.classList.add("account-error");
    } finally { button.disabled = false; }
  }
  $("#account-resend-confirmation")?.addEventListener("click", () => sendAccountEmail("confirmation"));
  $("#account-form").addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("#account-status");
    const submit = $("#account-submit");
    if (!supabaseClient) { status.textContent = "Account access isn’t configured yet. Please contact us."; status.classList.add("account-error"); return; }
    status.classList.remove("account-error");
    submit.disabled = true;
    const fields = new FormData(e.currentTarget);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    const mode = e.currentTarget.dataset.mode;
    try {
      if (mode === "recover") {
        await sendAccountEmail("recovery");
      } else if (mode === "update-password") {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;
        passwordRecoveryMode = false;
        signedInUser = (await supabaseClient.auth.getUser()).data.user || signedInUser;
        renderAccountState();
        status.textContent = "Your password has been updated. You’re signed in.";
      } else if (mode === "signup") {
        const fullName = String(fields.get("fullName") || "").trim();
        const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        // Supabase may return a success-shaped response for an existing email to
        // avoid account enumeration. An empty identities array marks that case.
        if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
          status.textContent = "An account already exists with this email. Please sign in or use Forgot password? to access it.";
          status.classList.add("account-error");
        } else if (data.session) { status.textContent = "Account created. You’re signed in."; }
        else { status.textContent = "We sent a confirmation link for your Trikonic Imports account. Check your inbox and spam folder to activate it."; }
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        status.textContent = "Signed in.";
        renderAccountState();
        setTimeout(loadOrderHistory, 0);
      }
    } catch (error) {
      status.textContent = error.message || "We couldn’t complete that. Please check your details and try again.";
      if (mode === "signin" && /invalid login credentials/i.test(status.textContent)) status.textContent = "Email or password didn’t match. Check your details, or use Forgot password? to reset it.";
      if (mode === "signup" && /already (?:been )?registered|already exists|user_exists|user_already_exists/i.test(`${error.code || ""} ${error.message || ""}`)) status.textContent = "This email may already have an account. Sign in or use Forgot password? to get back in.";
      status.classList.add("account-error");
    } finally { submit.disabled = false; }
  });
  async function signOut(status) {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) status.textContent = "Could not sign out. Please try again.";
    else { signedInUser = null; renderAccountState(); setAuthMode("signin"); }
  }
  $("#account-signout").addEventListener("click", () => signOut($("#orders-status")));
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      authReady = true;
      signedInUser = session?.user || null;
      if (event === "PASSWORD_RECOVERY") {
        passwordRecoveryMode = true;
        renderAccountState();
        openAccount("update-password");
      }
      renderAccountState();
      renderMaintenanceMode();
      if (signedInUser && (accountBackdrop.classList.contains("show") || paymentReturned)) setTimeout(loadOrderHistory, 0);
      if (signedInUser && resumeCheckoutAfterAuth) {
        resumeCheckoutAfterAuth = false;
        closeAccount();
        openCheckout();
      }
    });
  }
  renderAccountState(); setAuthMode("signup");
  loadMaintenanceMode();
  function refreshScheduledMaintenance() {
    if (lastScheduledClosure !== outsideStoreHours()) renderMaintenanceMode();
  }
  setInterval(refreshScheduledMaintenance, 1000);
  document.addEventListener("visibilitychange", refreshScheduledMaintenance);
  window.addEventListener("pageshow", refreshScheduledMaintenance);
  document.addEventListener("keydown", e => { if (e.key === "Escape") { setMobileNav(false); closeModal(); closeAccount(); closeVariantPicker(); closeProductDetail(); closeContactForm(); setAccountPopover(false); } });
  $("#year").textContent = new Date().getFullYear();

  const contactBackdrop = $("#contact-form-backdrop");
  function openContactForm() {
    if (!contactBackdrop) return;
    $("#contact-form-view").hidden = false;
    $("#contact-form-success").hidden = true;
    contactBackdrop.classList.add("show");
    contactBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    setTimeout(() => $("#contact-inquiry-form [name='name']")?.focus(), 0);
  }
  function closeContactForm() {
    if (!contactBackdrop) return;
    contactBackdrop.classList.remove("show");
    contactBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
  }
  if (contactBackdrop) {
    $("#contact-form-open").addEventListener("click", openContactForm);
    $("#contact-form-close").addEventListener("click", closeContactForm);
    $("#contact-form-done").addEventListener("click", closeContactForm);
    contactBackdrop.addEventListener("click", event => { if (event.target === contactBackdrop) closeContactForm(); });
    const contactMessage = $("#contact-inquiry-form [name='message']");
    contactMessage.addEventListener("input", () => { $("#contact-message-count").textContent = `${contactMessage.value.length}/500 characters`; });
    if (location.hash === "#contact-form") openContactForm();
    $("#contact-inquiry-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = $("#contact-form-status");
      const submit = $("#contact-form-submit");
      if (!supabaseClient) { status.textContent = "We can’t send your message right now. Please email trikonic1011@gmail.com or contact us on WhatsApp."; status.classList.add("account-error"); return; }
      const values = new FormData(form);
      submit.disabled = true;
      submit.innerHTML = "Sending…";
      status.textContent = "";
      status.classList.remove("account-error");
      try {
        const { error } = await supabaseClient.functions.invoke("contact-message", { body: {
          name: values.get("name"), email: values.get("email"), phone: values.get("phone"),
          subject: values.get("subject"), message: values.get("message"), website: values.get("website")
        } });
        if (error) throw error;
        form.reset();
        $("#contact-message-count").textContent = "0/500 characters";
        $("#contact-form-view").hidden = true;
        $("#contact-form-success").hidden = false;
      } catch (_) {
        status.textContent = "Your message couldn’t be sent just now. Please try again, or email trikonic1011@gmail.com.";
        status.classList.add("account-error");
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Send Message <span>↗</span>';
      }
    });
  }

  $("#order-form").addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("#form-status"); const submit = $(".submit-order");
    if (storefrontIsClosed() && !isStoreAdmin()) { closeModal(); renderMaintenanceMode(); return; }
    if (!signedInUser) { closeModal(); openAccount("signup"); $("#account-status").textContent = "Create an account or sign in first so you can place and track this order."; return; }
    if (!supabaseClient) { status.textContent = "Order tracking is temporarily unavailable. Please try again later."; return; }
    const form = new FormData(e.currentTarget);
    const keys = selectedCartKeys();
    const items = cartOrderItems(keys);
    if (!items.length || items.length !== keys.length || items.some(item => item.availability === "out_of_stock")) {
      status.textContent = "Review your cart and select available items before continuing.";
      return;
    }
    const { shipping, total } = orderTotals(items);
    const order = { orderId: `TRK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, createdAt: new Date().toISOString(), customer: { name: form.get("name"), contact: form.get("contact"), location: form.get("location"), notes: form.get("notes") }, items, shippingTotal: items.some(item => item.shippingTotal != null) ? shipping : null, estimatedTotal: total, currency: "GHS" };
    const endpoint = window.TRikonicOrderEndpoint || "";
    submit.disabled = true; submit.textContent = "Sending…"; status.textContent = "";
    try {
      const { error: saveError } = await supabaseClient.from("orders").insert({
        order_number: order.orderId,
        customer_name: order.customer.name,
        contact: order.customer.contact,
        delivery_area: order.customer.location || "",
        notes: order.customer.notes || "",
        items: order.items,
        estimated_total: order.estimatedTotal,
        currency: order.currency
      });
      if (saveError) throw saveError;
      savedReceiptOrder = order;
      $("#success-order-id").textContent = `Order ID: ${order.orderId}`;
      renderCheckoutReceipt(order.items, "#success-receipt-items", "#success-receipt-total");
      let sheetQueued = true;
      if (endpoint) {
        // Apps Script ContentService redirects its response to googleusercontent.com,
        // which can make a cross-origin fetch look like a failure after the row was
        // written. sendBeacon queues the same JSON POST without needing to read that
        // cross-origin response. Apps Script still receives it as e.postData.contents.
        sheetQueued = navigator.sendBeacon(endpoint, new Blob([JSON.stringify(order)], { type: "text/plain;charset=utf-8" }));
      }
      $("#success-message").textContent = sheetQueued ? "Your order is saved. Opening secure Paystack payment now. We’ll email your tracking number after payment; SMS is sent when notifications are enabled." : "Your order is saved in your account, but the order sheet could not be reached. Opening secure Paystack payment now; you can still track it in your account.";
      $("#checkout-form-view").hidden = true; $("#checkout-success-view").hidden = false;
      keys.forEach(key => cart.delete(key)); saveCart(); renderCart(); $("#order-form").reset();
      setTimeout(loadOrderHistory, 0);
      await startPaystackPayment();
    } catch (err) { status.textContent = err.message || "We couldn’t save that just now. Please try again."; }
    finally { submit.disabled = false; submit.innerHTML = 'Continue to payment <span>↗</span>'; }
  });
  renderCategories(); renderProducts(); renderCart();
  const heroControls = $(".hero-controls");
  if (heroControls) {
    const slides = [...document.querySelectorAll(".hero-slide")];
    const dots = [...heroControls.querySelectorAll(".hero-dot")];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = 0;
    let requested = 0;
    let timer;

    function scheduleSlide() {
      clearTimeout(timer);
      if (!reducedMotion.matches && !document.hidden) {
        timer = setTimeout(() => showSlide((requested + 1) % slides.length), 3000);
      }
    }

    async function showSlide(index) {
      requested = index;
      scheduleSlide();
      const slide = slides[index];
      if (!slide.hasAttribute("src")) slide.src = slide.dataset.src;
      try { await slide.decode(); } catch { return; }
      if (requested !== index) return;
      slides[active].classList.remove("active");
      dots[active].setAttribute("aria-pressed", "false");
      slide.classList.add("active");
      dots[index].setAttribute("aria-pressed", "true");
      active = index;
    }

    dots.forEach((dot, index) => dot.addEventListener("click", () => showSlide(index)));
    reducedMotion.addEventListener("change", scheduleSlide);
    document.addEventListener("visibilitychange", scheduleSlide);
    heroControls.hidden = false;
    scheduleSlide();
  }
  // Informational pages keep the shared app shell for account/cart controls, but
  // don't need a catalog request. Avoid an Apps Script round trip on those pages.
  if (cartPage || (grid && !grid.closest(".runtime-catalog"))) loadProductsFromSheet();
})();
