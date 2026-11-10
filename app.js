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
  let maintenanceMode = false;
  let maintenanceLoaded = false;
  let cart = new Map();
  try {
    const storedCart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (Array.isArray(storedCart)) cart = new Map(storedCart.filter(row => Array.isArray(row) && row.length === 2 && Number(row[1]) > 0).map(([id, quantity]) => [String(id), Number(quantity)]));
  } catch (_) { cart = new Map(); }
  let category = new URLSearchParams(location.search).get("category") || "All finds";
  let searchTerm = new URLSearchParams(location.search).get("search") || "";
  let maxPriceFilter = Number.POSITIVE_INFINITY;
  let productSort = "recommended";
  const $ = s => document.querySelector(s);
  const grid = $("#product-grid");
  function parseCartKey(key) {
    try { const parsed = JSON.parse(key); if (Array.isArray(parsed) && parsed.length === 3) return { id: String(parsed[0]), color: String(parsed[1] || ""), size: String(parsed[2] || "") }; } catch (_) {}
    return { id: String(key), color: "", size: "" };
  }
  function cartKey(id, color = "", size = "") { return color || size ? JSON.stringify([String(id), String(color), String(size)]) : String(id); }
  function productForCartKey(key) { const { id } = parseCartKey(key); return products.find(item => item.id === id); }
  function normalizeVariantOption(value) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
  function regularPriceFor(product, selection = {}) {
    const prices = product?.variantPrices || [];
    const color = normalizeVariantOption(selection.color), size = normalizeVariantOption(selection.size);
    const find = (matchColor, matchSize) => prices.find(option => normalizeVariantOption(option.color) === matchColor && normalizeVariantOption(option.size) === matchSize);
    const match = (color && size && find(color, size)) || (color && find(color, "")) || (size && find("", size));
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
    const options = (product?.variantPrices || []).map(option => ({ color: option.color, size: option.size }));
    const prices = [priceFor(product, {}).current, ...options.map(option => priceFor(product, option).current)].filter(price => price > 0);
    return Math.min(...prices);
  }
  function cartSelectionIsValid(product, selection) {
    const matches = (options, selected) => !options?.length || options.some(option => normalizeVariantOption(option) === normalizeVariantOption(selected));
    return Boolean(product && matches(product.colors, selection.color) && matches(product.sizes, selection.size));
  }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify([...cart])); } catch (_) {} }
  function resolveProductImage(source) {
    const image = String(source || "").trim();
    if (!image) return "";
    if (/^(https?:\/\/|data:|blob:|\/)/i.test(image)) return image;
    const path = image.replace(/^\.\//, "");
    return path.includes("/") ? path : `images/${path}`;
  }
  let savedReceiptOrder = null;
  function renderCheckoutReceipt(target = "#checkout-receipt-items", totalTarget = "#checkout-total") {
    const rows = [...cart.entries()].filter(([, qty]) => qty > 0).map(([key, quantity]) => {
      const product = productForCartKey(key);
      return product ? { product, quantity, selection: parseCartKey(key) } : null;
    }).filter(Boolean);
    $(target).innerHTML = rows.length
      ? rows.map(({ product, quantity, selection }) => `<div class="receipt-line"><span>${quantity} × ${escapeHtml(product.name)}${selection.color || selection.size ? `<small class="variant-summary">${[selection.color && `Colour: ${selection.color}`, selection.size && `Size: ${selection.size}`].filter(Boolean).map(escapeHtml).join(" · ")}</small>` : ""}</span><strong>${money(priceFor(product, selection).current * quantity)}</strong></div>`).join("")
      : '<p class="receipt-empty">Your bag is empty.</p>';
    if (totalTarget) $(totalTarget).textContent = money(rows.reduce((sum, row) => sum + priceFor(row.product, row.selection).current * row.quantity, 0));
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
      const options = [item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`].filter(Boolean).join(", ");
      write(`${item.quantity} x ${item.name}${options ? ` (${options})` : ""}${availability}${sale} - GHS ${(Number(item.lineTotal) || 0).toFixed(2)}`, 10, 8);
    });
    rule();
    write(`Estimated item subtotal: GHS ${Number(order.estimatedTotal).toFixed(2)}`, 12);
    write("Shipping fee is paid by the customer separately.");
    write("Shipping amount will be confirmed and is not included above.");
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
    if (catalogState === "loading") { grid.innerHTML = '<p class="catalog-message">Loading the latest finds…</p>'; return; }
    if (catalogState === "error") { grid.innerHTML = '<p class="catalog-message">We couldn’t load the catalog right now. Please refresh in a moment.</p>'; return; }
    if (catalogState === "empty") { grid.innerHTML = '<p class="catalog-message">No products are published right now. Please check back soon.</p>'; return; }
    const query = searchTerm.trim().toLowerCase();
    let shown = products.filter(p => (category === "All finds" || p.category === category) && productStartingPrice(p) <= maxPriceFilter && (!query || `${p.name} ${p.category} ${p.description} ${(p.colors || []).join(" ")} ${(p.sizes || []).join(" ")}`.toLowerCase().includes(query)));
    if (productSort === "price-low") shown = shown.sort((a, b) => productStartingPrice(a) - productStartingPrice(b));
    else if (productSort === "price-high") shown = shown.sort((a, b) => productStartingPrice(b) - productStartingPrice(a));
    else if (productSort === "name") shown = shown.sort((a, b) => a.name.localeCompare(b.name));
    const resultCount = $("#product-result-count");
    if (resultCount) resultCount.textContent = `Showing ${shown.length} of ${products.length} products`;
    if (!shown.length) { grid.innerHTML = `<p class="catalog-message">${query ? "No finds matched your search. Try another word." : "No products in this category right now."}</p>`; return; }
    grid.innerHTML = shown.map(p => {
      const preorder = p.availability === "preorder";
      const outOfStock = p.availability === "out_of_stock";
      const availabilityLabel = preorder ? "PRE-ORDER" : outOfStock ? "OUT OF STOCK" : "IN STOCK";
      const optionsLabel = [p.colors?.length && `${p.colors.length} colours`, p.sizes?.length && `${p.sizes.length} sizes`].filter(Boolean).join(" · ");
      const startPrice = productStartingPrice(p);
      const price = p.flashSale && startPrice < p.price ? `<span class="sale-prices"><s>${money(p.price)}</s><strong>${money(startPrice)}</strong></span>` : `<strong>${money(startPrice)}</strong>`;
      return `<article class="product-card"><div class="product-photo" style="--product-bg:${p.color || "#eee"}"><button class="product-image-open" data-detail="${escapeAttr(p.id)}" aria-label="View details for ${escapeAttr(p.name)}"><img src="${escapeAttr(resolveProductImage(p.image))}" alt="${escapeAttr(p.name)}" loading="lazy"></button><span class="product-tag">${escapeHtml(p.tag || p.category)}</span>${p.flashSale ? '<span class="sale-ribbon">FLASH SALE</span>' : ""}<button class="quick-add ${outOfStock ? "unavailable" : ""}" data-detail="${escapeAttr(p.id)}" aria-label="View details for ${escapeAttr(p.name)}">→</button></div><div class="product-meta"><div><div class="product-overline"><span class="product-category">${escapeHtml(p.category)}</span><span class="availability-badge ${preorder ? "preorder" : outOfStock ? "out-of-stock" : "in-stock"}">${availabilityLabel}</span></div><h3><button class="product-title-open" data-detail="${escapeAttr(p.id)}">${escapeHtml(p.name)}</button></h3><div class="product-card-price">${price}</div><p>${escapeHtml(p.description)}</p>${optionsLabel ? `<small class="product-options-hint">Available in ${escapeHtml(optionsLabel)}</small>` : ""}</div></div></article>`;
    }).join("");
  }
  function renderCategories() {
    if (catalogState === "loading" || catalogState === "error" || catalogState === "empty") { $("#categories").innerHTML = ""; return; }
    const cats = ["All finds", ...new Set(products.map(p => p.category))];
    $("#categories").innerHTML = cats.map(c => `<button class="category-chip ${c === category ? "active" : ""}" data-category="${escapeAttr(c)}">${escapeHtml(c)}${c === "All finds" ? ` <span>${products.length}</span>` : ""}</button>`).join("");
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
  function renderCart() {
    const entries = [...cart.entries()].filter(([key, qty]) => qty > 0 && productForCartKey(key));
    const count = entries.reduce((s, [, q]) => s + q, 0);
    const total = entries.reduce((s, [key, q]) => { const p = productForCartKey(key); return s + (p ? priceFor(p, parseCartKey(key)).current : 0) * q; }, 0);
    $("#cart-count").textContent = count; $("#drawer-count").textContent = `(${count})`;
    $("#subtotal").textContent = money(total); $("#checkout-total").textContent = money(total);
    $("#cart-empty").hidden = count > 0; $("#cart-bottom").hidden = count === 0;
    const hasOutOfStock = entries.some(([key]) => productForCartKey(key)?.availability === "out_of_stock");
    $("#cart-stock-warning").hidden = !hasOutOfStock;
    $("#cart-stock-warning").textContent = "Remove out-of-stock items before continuing.";
    // Saved selections can outlive a catalog refresh. This store submits requests
    // for manual confirmation, so stale variant labels must not block checkout.
    $("#checkout-open").disabled = hasOutOfStock;
    $("#cart-items").innerHTML = entries.map(([key, qty]) => { const p = productForCartKey(key), selection = parseCartKey(key); const preorder = p.availability === "preorder", outOfStock = p.availability === "out_of_stock", badge = preorder ? "PRE-ORDER" : outOfStock ? "OUT OF STOCK" : "IN STOCK"; const price = priceMarkup(p, selection); const options = [selection.color && `Colour: ${selection.color}`, selection.size && `Size: ${selection.size}`].filter(Boolean).map(escapeHtml).join(" · "); return `<article class="cart-item"><img src="${escapeAttr(resolveProductImage(p.image))}" alt=""><div class="cart-item-info"><span>${escapeHtml(p.category)}</span><h3>${escapeHtml(p.name)}</h3>${options ? `<small class="cart-variant-summary">${options}</small>` : ""}<span class="cart-availability ${preorder ? "preorder" : outOfStock ? "out-of-stock" : "in-stock"}">${badge}</span>${price}<div class="quantity"><button data-qty="${escapeAttr(key)}" data-delta="-1" aria-label="Remove one ${escapeAttr(p.name)}">−</button><span>${qty}</span><button data-qty="${escapeAttr(key)}" data-delta="1" aria-label="Add one ${escapeAttr(p.name)}" ${outOfStock ? "disabled" : ""}>+</button></div></div><button class="remove-item" data-remove="${escapeAttr(key)}" aria-label="Remove ${escapeAttr(p.name)}">×</button></article>`; }).join("");
    renderCheckoutReceipt();
  }
  function setDrawer(open) { $("#cart-drawer").classList.toggle("open", open); $("#overlay").classList.toggle("show", open); $("#cart-drawer").setAttribute("aria-hidden", String(!open)); document.body.classList.toggle("no-scroll", open); }
  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  const detailBackdrop = $("#product-detail-backdrop");
  let detailProduct = null, detailColor = "", detailSize = "";
  const swatchColors = { black:"#242424", white:"#fffefa", red:"#b52c2c", blue:"#325c9b", navy:"#162c49", "sky blue":"#9bc8df", teal:"#198b8b", green:"#5d8561", sage:"#a8b899", pink:"#e5a3ad", beige:"#d8c4a4", cream:"#eee8d8", brown:"#78513b", grey:"#9b9b98", gray:"#9b9b98", purple:"#8066a1", orange:"#df7c42", yellow:"#e9bf47" };
  function swatchFor(color) { const value = String(color || "").trim().toLowerCase(); if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return value; const match = Object.keys(swatchColors).sort((a, b) => b.length - a.length).find(name => value === name || value.includes(name)); return match ? swatchColors[match] : "#d8d4ca"; }
  function renderDetailOptions() {
    if (!detailProduct) return;
    $("#detail-color-group").hidden = !detailProduct.colors?.length;
    $("#detail-size-group").hidden = !detailProduct.sizes?.length;
    $("#detail-color-label").textContent = detailColor ? `Selected: ${detailColor}` : "Choose a colour";
    $("#detail-size-label").textContent = detailSize ? `Selected: ${detailSize}` : "Choose a size";
    $("#detail-colors").innerHTML = (detailProduct.colors || []).map(color => `<button type="button" class="detail-swatch ${color === detailColor ? "selected" : ""}" style="--swatch:${swatchFor(color)}" data-detail-color="${escapeAttr(color)}" aria-label="${escapeAttr(color)}" aria-pressed="${color === detailColor}"><span class="visually-hidden">${escapeHtml(color)}</span></button>`).join("");
    $("#detail-sizes").innerHTML = (detailProduct.sizes || []).map(size => `<button type="button" class="detail-size ${size === detailSize ? "selected" : ""}" data-detail-size="${escapeAttr(size)}" aria-pressed="${size === detailSize}">${escapeHtml(size)}</button>`).join("");
    const missingChoice = Boolean((detailProduct.colors?.length && !detailColor) || (detailProduct.sizes?.length && !detailSize));
    const unavailable = detailProduct.availability === "out_of_stock";
    $("#detail-price").innerHTML = priceMarkup(detailProduct, { color: detailColor, size: detailSize });
    $("#detail-add").disabled = unavailable || missingChoice;
    $("#detail-purchase-status").textContent = unavailable ? "Currently out of stock" : missingChoice ? "Choose the available options to continue." : detailProduct.availability === "preorder" ? "Available for pre-order" : "In stock";
  }
  function openProductDetail(product) {
    detailProduct = product;
    detailColor = "";
    detailSize = "";
    const images = [...new Set((product.images?.length ? product.images : [product.image]).filter(Boolean))];
    const mainImage = images[0] || product.image;
    $("#detail-main-image").src = resolveProductImage(mainImage);
    $("#detail-main-image").alt = product.name;
    $("#detail-thumbnails").innerHTML = images.map((image, index) => `<button type="button" class="detail-thumbnail ${index === 0 ? "active" : ""}" data-detail-image="${escapeAttr(image)}" aria-label="View product image ${index + 1}"><img src="${escapeAttr(resolveProductImage(image))}" alt=""></button>`).join("");
    $("#detail-category").textContent = product.category || "Trikonic find";
    $("#detail-name").textContent = product.name;
    $("#detail-description").textContent = product.description || "Thoughtfully selected and ready to make yours.";
    const availability = product.availability === "preorder" ? "Available for pre-order" : product.availability === "out_of_stock" ? "Currently out of stock" : "In stock";
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
    if (!thumbnail) return;
    $("#detail-main-image").src = resolveProductImage(thumbnail.dataset.detailImage);
    $("#detail-thumbnails").querySelectorAll(".detail-thumbnail").forEach(button => button.classList.toggle("active", button === thumbnail));
  });
  $("#detail-colors").addEventListener("click", event => { const button = event.target.closest("[data-detail-color]"); if (button) { detailColor = button.dataset.detailColor; renderDetailOptions(); } });
  $("#detail-sizes").addEventListener("click", event => { const button = event.target.closest("[data-detail-size]"); if (button) { detailSize = button.dataset.detailSize; renderDetailOptions(); } });
  $("#detail-add").addEventListener("click", () => { if (!detailProduct || detailProduct.availability === "out_of_stock" || !cartSelectionIsValid(detailProduct, { color: detailColor, size: detailSize })) return; addProductToCart(detailProduct, detailColor, detailSize); closeProductDetail(); setDrawer(true); });
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
    fillVariantSelect($("#variant-color"), product.colors || [], "colour");
    fillVariantSelect($("#variant-size"), product.sizes || [], "size");
    $("#variant-status").textContent = "";
    updateVariantPickerPrice();
    variantBackdrop.classList.add("show");
    variantBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
  function updateVariantPickerPrice() {
    if (!pendingVariantProduct) return;
    const selection = { color: $("#variant-color").value, size: $("#variant-size").value };
    const { regular, current, onSale } = priceFor(pendingVariantProduct, selection);
    $("#variant-product-name").textContent = `${pendingVariantProduct.name} · ${money(current)}${onSale ? ` (was ${money(regular)})` : ""}`;
  }
  function closeVariantPicker() {
    variantBackdrop.classList.remove("show");
    variantBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    pendingVariantProduct = null;
  }
  function addProductToCart(product, color = "", size = "") {
    const key = cartKey(product.id, color, size);
    cart.set(key, (cart.get(key) || 0) + 1);
    saveCart(); renderCart();
  }
  $("#variant-close").addEventListener("click", closeVariantPicker);
  $("#variant-color").addEventListener("change", updateVariantPickerPrice);
  $("#variant-size").addEventListener("change", updateVariantPickerPrice);
  variantBackdrop.addEventListener("click", event => { if (event.target === variantBackdrop) closeVariantPicker(); });
  $("#variant-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!pendingVariantProduct) return;
    const color = $("#variant-color").value, size = $("#variant-size").value;
    if ((pendingVariantProduct.colors?.length && !color) || (pendingVariantProduct.sizes?.length && !size)) {
      $("#variant-status").textContent = "Choose the available colour and size to continue.";
      return;
    }
    addProductToCart(pendingVariantProduct, color, size);
    closeVariantPicker();
  });
  document.addEventListener("click", e => {
    const detail = e.target.closest("[data-detail]"); if (detail) { const product = products.find(p => p.id === detail.dataset.detail); if (product) openProductDetail(product); return; }
    const add = e.target.closest("[data-add]"); if (add) { const product = products.find(p => p.id === add.dataset.add); if (!product || product.availability === "out_of_stock") return; if (product.colors?.length || product.sizes?.length) openVariantPicker(product); else addProductToCart(product); }
    const filter = e.target.closest("[data-category]"); if (filter) { category = filter.dataset.category; renderCategories(); renderProducts(); }
    const qty = e.target.closest("[data-qty]"); if (qty) { const product = productForCartKey(qty.dataset.qty); if (Number(qty.dataset.delta) > 0 && product?.availability === "out_of_stock") return; cart.set(qty.dataset.qty, Math.max(0, (cart.get(qty.dataset.qty) || 0) + Number(qty.dataset.delta))); saveCart(); renderCart(); }
    const remove = e.target.closest("[data-remove]"); if (remove) { cart.delete(remove.dataset.remove); saveCart(); renderCart(); }
  });
  $("#cart-open").addEventListener("click", () => setDrawer(true)); $("#cart-close").addEventListener("click", () => setDrawer(false)); $("#overlay").addEventListener("click", () => setDrawer(false)); $("#continue-shopping").addEventListener("click", () => setDrawer(false));
  function openCheckout() { $("#checkout-form-view").hidden = false; $("#checkout-success-view").hidden = true; $("#modal-backdrop").classList.add("show"); document.body.classList.add("no-scroll"); renderCheckoutReceipt(); }
  $("#checkout-open").addEventListener("click", () => {
    setDrawer(false);
    if (maintenanceMode && !isStoreAdmin()) return;
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
  // This payment handoff is only present on the payment-enabled checkout page.
  // Other routes use the order-request receipt, so don't let the missing button
  // abort shared startup (auth handlers and the Google Sheets catalog loader).
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
  function renderMaintenanceMode() {
    const isAdmin = isStoreAdmin();
    const screen = $("#maintenance-screen");
    screen.hidden = maintenanceLoaded && (!maintenanceMode || isAdmin);
    document.body.classList.toggle("maintenance-active", maintenanceMode && !isAdmin);
    $("#admin-maintenance-control").hidden = !isAdmin;
    $("#maintenance-status").textContent = !maintenanceLoaded ? "Checking storefront status…" : maintenanceMode ? "Maintenance mode is on. Shoppers see the maintenance page." : "Maintenance mode is off. The storefront is open.";
    $("#maintenance-toggle").textContent = maintenanceMode ? "Turn off maintenance mode" : "Turn on maintenance mode";
    $("#maintenance-toggle").setAttribute("aria-pressed", String(maintenanceMode));
  }
  async function loadMaintenanceMode() {
    if (!supabaseClient) { maintenanceLoaded = true; renderMaintenanceMode(); return; }
    const { data, error } = await supabaseClient.from("site_settings").select("maintenance_mode").eq("id", 1).maybeSingle();
    if (error) { console.warn("Could not load storefront maintenance setting.", error); maintenanceLoaded = true; renderMaintenanceMode(); return; }
    maintenanceMode = Boolean(data?.maintenance_mode);
    maintenanceLoaded = true;
    renderMaintenanceMode();
  }
  $("#maintenance-toggle").addEventListener("click", async () => {
    if (!isStoreAdmin() || !supabaseClient) return;
    const button = $("#maintenance-toggle");
    button.disabled = true;
    $("#maintenance-status").textContent = "Saving storefront setting…";
    const nextMode = !maintenanceMode;
    const { data, error } = await supabaseClient.from("site_settings").update({ maintenance_mode: nextMode }).eq("id", 1).select("maintenance_mode").single();
    button.disabled = false;
    if (error || !data) {
      $("#maintenance-status").textContent = "Could not update the storefront. Check admin access and try again.";
      console.error("Could not update maintenance mode.", error);
      return;
    }
    maintenanceMode = Boolean(data.maintenance_mode);
    renderMaintenanceMode();
  });
  function openAccount(mode = "signin") { setAuthMode(mode); accountBackdrop.classList.add("show"); accountBackdrop.setAttribute("aria-hidden", "false"); document.body.classList.add("no-scroll"); if (signedInUser) loadOrderHistory(); }
  function renderAccountState() {
    const showAuth = !signedInUser || passwordRecoveryMode;
    $("#account-backdrop .account-modal").classList.toggle("account-auth-mode", showAuth);
    $("#account-trigger-label").innerHTML = signedInUser ? "My account<br>Orders" : "Sign in<br>Account";
    $("#account-menu-auth").textContent = signedInUser ? "My account" : "Sign in or create account";
    $("#account-menu-history").innerHTML = signedInUser ? '<span aria-hidden="true">▤</span> Order history' : '<span aria-hidden="true">▤</span> Purchase history';
    $("#checkout-open").innerHTML = signedInUser ? 'Review your request <span>↗</span>' : 'Create an account to order <span>↗</span>';
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
      const paymentLine = order.payment_status === "paid" ? '<p class="order-payment-state paid">Payment confirmed</p>' : unpaid ? `<p class="order-payment-state">Payment pending · Shipping is paid separately</p><button class="pay-order-button" type="button" data-pay-order="${escapeAttr(order.order_number)}">Pay securely with Paystack</button>` : "";
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
    $("#account-intro").textContent = signup ? "Create an account to place orders, keep your bag on this device, and track requests here." : recovery ? "We’ll email you a secure link to reset your password." : updatePassword ? "Choose a new password for your Trikonic account." : "Sign in to place order requests and keep track of them here.";
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
  $("#account-menu-auth").addEventListener("click", () => { setAccountPopover(false); openAccount(signedInUser ? "signin" : "signup"); });
  $("#account-menu-history").addEventListener("click", () => { setAccountPopover(false); openAccount("signin"); });
  $("#account-side-track").addEventListener("click", event => { document.querySelectorAll(".account-side-link").forEach(link => link.classList.remove("active")); event.currentTarget.classList.add("active"); $("#order-history").scrollIntoView({ block: "nearest" }); });
  $("#account-side-history").addEventListener("click", event => { document.querySelectorAll(".account-side-link").forEach(link => link.classList.remove("active")); event.currentTarget.classList.add("active"); $("#order-history").scrollIntoView({ block: "nearest" }); });
  document.addEventListener("click", event => { if (!event.target.closest(".account-menu-wrap")) setAccountPopover(false); });
  $("#maintenance-admin-open").addEventListener("click", () => openAccount("signin"));
  $("#footer-track-order")?.addEventListener("click", () => openAccount("signin"));
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
        if (data.session) { status.textContent = "Account created. You’re signed in."; }
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
      status.classList.add("account-error");
    } finally { submit.disabled = false; }
  });
  $("#account-signout").addEventListener("click", async () => {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) $("#orders-status").textContent = "Could not sign out. Please try again.";
    else { signedInUser = null; renderAccountState(); setAuthMode("signin"); }
  });
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      signedInUser = session?.user || null;
      if (event === "PASSWORD_RECOVERY") {
        passwordRecoveryMode = true;
        renderAccountState();
        openAccount("update-password");
      }
      renderAccountState();
      setTimeout(loadMaintenanceMode, 0);
      if (signedInUser) setTimeout(loadOrderHistory, 0);
      if (signedInUser && resumeCheckoutAfterAuth) {
        resumeCheckoutAfterAuth = false;
        closeAccount();
        openCheckout();
      }
    });
  }
  renderAccountState(); setAuthMode("signup");
  loadMaintenanceMode();
  document.addEventListener("keydown", e => { if (e.key === "Escape") { setDrawer(false); closeModal(); closeAccount(); closeVariantPicker(); closeProductDetail(); setAccountPopover(false); } });
  $("#year").textContent = new Date().getFullYear();

  $("#order-form").addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("#form-status"); const submit = $(".submit-order");
    if (maintenanceMode && !isStoreAdmin()) { closeModal(); return; }
    if (!signedInUser) { closeModal(); openAccount("signup"); $("#account-status").textContent = "Create an account or sign in first so you can place and track this order."; return; }
    if (!supabaseClient) { status.textContent = "Order tracking is temporarily unavailable. Please try again later."; return; }
    const form = new FormData(e.currentTarget);
    const items = [...cart.entries()].filter(([, quantity]) => quantity > 0).map(([key, quantity]) => { const p = productForCartKey(key), selection = parseCartKey(key), pricing = p && priceFor(p, selection); return p ? { id: p.id, name: p.name, color: selection.color, size: selection.size, availability: p.availability, flashSale: pricing.onSale, quantity, unitPrice: pricing.current, originalUnitPrice: pricing.regular, lineTotal: pricing.current * quantity } : null; }).filter(Boolean);
    if (items.some(item => item.availability === "out_of_stock")) { status.textContent = "Your bag contains an out-of-stock item. Remove it before sending your order."; return; }
    const order = { orderId: `TRK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, createdAt: new Date().toISOString(), customer: { name: form.get("name"), contact: form.get("contact"), location: form.get("location"), notes: form.get("notes") }, items, estimatedTotal: items.reduce((sum, x) => sum + x.lineTotal, 0), currency: "GHS" };
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
      renderCheckoutReceipt("#success-receipt-items", "#success-receipt-total");
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
      cart.clear(); saveCart(); renderCart(); e.currentTarget.reset();
      setTimeout(loadOrderHistory, 0);
      await startPaystackPayment();
    } catch (err) { status.textContent = err.message || "We couldn’t save that just now. Please try again."; }
    finally { submit.disabled = false; submit.innerHTML = 'Continue to payment <span>↗</span>'; }
  });
  renderCategories(); renderProducts(); renderCart(); loadProductsFromSheet();
})();
