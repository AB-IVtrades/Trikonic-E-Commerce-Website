(() => {
  window.createAdminReceipts = function () {
    const byId = id => document.getElementById(id);
    const form = byId("manual-receipt-form");
    const printed = byId("manual-receipt-print");
    const status = byId("manual-receipt-status");
    const field = name => form.elements.namedItem(name);
    const value = name => field(name).value.trim();
    const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Accra" });
    const printDate = new Intl.DateTimeFormat("en-GH", { dateStyle: "long", timeZone: "UTC" });
    const details = byId("manual-receipt-details");

    function clear() {
      form.reset();
      const today = localDate.format(new Date());
      field("paidOn").value = today;
      field("number").value = "RCP-" + today.replaceAll("-", "") + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
      printed.hidden = true;
      status.hidden = true;
      details.replaceChildren();
      for (const id of ["amount", "goods", "eta", "notes"]) byId("manual-receipt-" + id).replaceChildren();
    }

    function printReceipt(event) {
      event.preventDefault();
      if (byId("workspace").hidden || byId("payment-receipts").hidden) return;
      for (const name of ["number", "customer", "goods"]) {
        if (value(name)) continue;
        status.textContent = "Enter the receipt number, customer name, and goods covered.";
        status.hidden = false;
        field(name).focus();
        return;
      }
      status.hidden = true;
      const paymentAmount = new Intl.NumberFormat("en-GH", {
        style: "currency", currency: value("currency"), currencyDisplay: "code"
      }).format(field("amount").valueAsNumber);
      const entries = [
        ["Receipt number", value("number")],
        ["Date received", printDate.format(new Date(value("paidOn") + "T00:00:00Z"))],
        ["Received from", value("customer")],
        ["Customer contact", value("contact")],
        ["Payment method", value("method")],
        ["Transaction reference", value("paymentReference")],
        ["Order or pro forma invoice number", value("orderReference")],
        ["Received by", value("receivedBy")]
      ];
      const rows = document.createDocumentFragment();
      for (const [label, text] of entries) {
        if (!text) continue;
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = text;
        row.append(term, description);
        rows.append(row);
      }
      details.replaceChildren(rows);
      byId("manual-receipt-amount").textContent = paymentAmount;
      byId("manual-receipt-goods").textContent = value("goods");
      byId("manual-receipt-eta").textContent = value("eta");
      byId("manual-receipt-arrival").hidden = !value("eta");
      byId("manual-receipt-notes").textContent = value("notes");
      byId("manual-receipt-notes-section").hidden = !value("notes");
      printed.hidden = false;
      window.print();
    }

    form.addEventListener("submit", printReceipt);
    form.addEventListener("input", () => { status.hidden = true; printed.hidden = true; });
    byId("manual-receipt-new").addEventListener("click", () => {
      if (!window.confirm("Start a new receipt? This clears the current draft.")) return;
      clear();
      field("customer").focus();
    });
    window.addEventListener("afterprint", () => { printed.hidden = true; });
    clear();
    return { clear };
  };
})();
