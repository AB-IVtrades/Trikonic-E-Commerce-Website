(() => {
  let products = window.PRODUCTS || [];
  const money = n => `GH₵${Number(n).toFixed(2)}`;
  const cart = new Map();
  let category = "All finds";
  const $ = s => document.querySelector(s);
  const grid = $("#product-grid");

  function renderProducts() {
    const shown = category === "All finds" ? products : products.filter(p => p.category === category);
    grid.innerHTML = shown.map(p => { const preorder = p.availability === "preorder"; return `<article class="product-card"><div class="product-photo" style="--product-bg:${p.color || "#eee"}"><img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy"><span class="product-tag">${escapeHtml(p.tag || p.category)}</span><button class="quick-add" data-add="${escapeAttr(p.id)}" aria-label="Add ${escapeAttr(p.name)} to bag">+</button></div><div class="product-meta"><div><div class="product-overline"><span class="product-category">${escapeHtml(p.category)}</span><span class="availability-badge ${preorder ? "preorder" : "in-stock"}">${preorder ? "PRE-ORDER" : "IN STOCK"}</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p></div><strong>${money(p.price)}</strong></div></article>`; }).join("");
  }
  function renderCategories() {
    const cats = ["All finds", ...new Set(products.map(p => p.category))];
    $("#categories").innerHTML = cats.map(c => `<button class="category-chip ${c === category ? "active" : ""}" data-category="${escapeAttr(c)}">${escapeHtml(c)}${c === "All finds" ? ` <span>${products.length}</span>` : ""}</button>`).join("");
  }
  function loadProductsFromSheet() {
    const endpoint = window.TRikonicOrderEndpoint || "";
    if (!endpoint) return;
    window.receiveTrikonicProducts = catalog => {
      if (!catalog?.ready || !Array.isArray(catalog.products)) return;
      products = catalog.products;
      renderCategories(); renderProducts(); renderCart();
    };
    const script = document.createElement("script");
    const url = new URL(endpoint);
    url.searchParams.set("callback", "receiveTrikonicProducts");
    url.searchParams.set("t", String(Date.now()));
    script.src = url.toString();
    script.onerror = () => console.warn("Could not load the storefront catalog from Google Sheets.");
    document.head.appendChild(script);
  }
  function renderCart() {
    const entries = [...cart.entries()].filter(([, qty]) => qty > 0);
    const count = entries.reduce((s, [, q]) => s + q, 0);
    const total = entries.reduce((s, [id, q]) => s + (products.find(p => p.id === id)?.price || 0) * q, 0);
    $("#cart-count").textContent = count; $("#drawer-count").textContent = `(${count})`;
    $("#subtotal").textContent = money(total); $("#checkout-total").textContent = money(total);
    $("#cart-empty").hidden = count > 0; $("#cart-bottom").hidden = count === 0;
    $("#cart-items").innerHTML = entries.map(([id, qty]) => { const p = products.find(x => x.id === id); const preorder = p.availability === "preorder"; return `<article class="cart-item"><img src="${escapeAttr(p.image)}" alt=""><div class="cart-item-info"><span>${escapeHtml(p.category)}</span><h3>${escapeHtml(p.name)}</h3><span class="cart-availability ${preorder ? "preorder" : "in-stock"}">${preorder ? "PRE-ORDER" : "IN STOCK"}</span><strong>${money(p.price)}</strong><div class="quantity"><button data-qty="${id}" data-delta="-1" aria-label="Remove one ${escapeAttr(p.name)}">−</button><span>${qty}</span><button data-qty="${id}" data-delta="1" aria-label="Add one ${escapeAttr(p.name)}">+</button></div></div><button class="remove-item" data-remove="${id}" aria-label="Remove ${escapeAttr(p.name)}">×</button></article>`; }).join("");
  }
  function setDrawer(open) { $("#cart-drawer").classList.toggle("open", open); $("#overlay").classList.toggle("show", open); $("#cart-drawer").setAttribute("aria-hidden", String(!open)); document.body.classList.toggle("no-scroll", open); }
  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  document.addEventListener("click", e => {
    const add = e.target.closest("[data-add]"); if (add) { cart.set(add.dataset.add, (cart.get(add.dataset.add) || 0) + 1); renderCart(); add.classList.add("added"); add.textContent = "✓"; setTimeout(() => { add.classList.remove("added"); add.textContent = "+"; }, 800); }
    const filter = e.target.closest("[data-category]"); if (filter) { category = filter.dataset.category; renderCategories(); renderProducts(); }
    const qty = e.target.closest("[data-qty]"); if (qty) { cart.set(qty.dataset.qty, Math.max(0, (cart.get(qty.dataset.qty) || 0) + Number(qty.dataset.delta))); renderCart(); }
    const remove = e.target.closest("[data-remove]"); if (remove) { cart.delete(remove.dataset.remove); renderCart(); }
  });
  $("#cart-open").addEventListener("click", () => setDrawer(true)); $("#cart-close").addEventListener("click", () => setDrawer(false)); $("#overlay").addEventListener("click", () => setDrawer(false)); $("#continue-shopping").addEventListener("click", () => setDrawer(false));
  $("#checkout-open").addEventListener("click", () => { setDrawer(false); $("#modal-backdrop").classList.add("show"); document.body.classList.add("no-scroll"); });
  const closeModal = () => { $("#modal-backdrop").classList.remove("show"); document.body.classList.remove("no-scroll"); };
  $("#checkout-close").addEventListener("click", closeModal); $("#modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { setDrawer(false); closeModal(); } });
  $("#year").textContent = new Date().getFullYear();

  $("#order-form").addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("#form-status"); const submit = $(".submit-order");
    const form = new FormData(e.currentTarget);
    const items = [...cart.entries()].filter(([, q]) => q > 0).map(([id, quantity]) => { const p = products.find(x => x.id === id); return { id, name: p.name, availability: p.availability === "preorder" ? "preorder" : "in_stock", quantity, unitPrice: p.price, lineTotal: p.price * quantity }; });
    const order = { orderId: `TRK-${Date.now()}`, createdAt: new Date().toISOString(), customer: { name: form.get("name"), contact: form.get("contact"), location: form.get("location"), notes: form.get("notes") }, items, estimatedTotal: items.reduce((sum, x) => sum + x.lineTotal, 0), currency: "GHS" };
    const endpoint = window.TRikonicOrderEndpoint || "";
    submit.disabled = true; submit.textContent = "Sending…"; status.textContent = "";
    try {
      if (endpoint) {
        // Apps Script ContentService redirects its response to googleusercontent.com,
        // which can make a cross-origin fetch look like a failure after the row was
        // written. sendBeacon queues the same JSON POST without needing to read that
        // cross-origin response. Apps Script still receives it as e.postData.contents.
        const queued = navigator.sendBeacon(endpoint, new Blob([JSON.stringify(order)], { type: "text/plain;charset=utf-8" }));
        if (!queued) throw new Error("The browser could not queue this order request.");
      } else {
        const subject = encodeURIComponent(`Order request ${order.orderId} — Trikonic Imports`);
        const body = encodeURIComponent(`Hi Trikonic Imports,\n\nPlease confirm this order request.\n\nOrder: ${order.orderId}\nName: ${order.customer.name}\nContact: ${order.customer.contact}\nDelivery area: ${order.customer.location || "Not provided"}\n\n${items.map(i => `${i.quantity} × ${i.name} — ${money(i.lineTotal)}`).join("\n")}\n\nEstimated total: ${money(order.estimatedTotal)}\n\nNotes: ${order.customer.notes || "None"}`);
        window.location.href = `mailto:hello@trikonic.com?subject=${subject}&body=${body}`;
      }
      status.textContent = endpoint ? "Thanks! Your request is on its way. We’ll be in touch to confirm availability, delivery, and payment." : "Your email app is opening with your order. Add a contact email in the code before launch.";
      if (endpoint) { cart.clear(); renderCart(); e.currentTarget.reset(); }
    } catch (err) { status.textContent = "We couldn’t send that just now. Please try again or email us directly."; }
    finally { submit.disabled = false; submit.innerHTML = 'Send my request <span>↗</span>'; }
  });
  renderCategories(); renderProducts(); renderCart(); loadProductsFromSheet();
})();
