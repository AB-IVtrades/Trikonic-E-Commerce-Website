/**
 * Optional Google Sheets order receiver for Trikonic Imports.
 * See README.md for setup. Deploy this project as a Web App, then put its URL
 * into config.js. Do not put any Google credentials in the website.
 */
const SHEET_NAME = "Trikonic Orders";
const CATALOG_SHEET_NAME = "Website Catalog";

function doGet(e) {
  // Only expose published catalog fields plus name/category/price from the inventory tab.
  // Inventory quantities, profit, customers, and orders are never returned.
  if (e.parameter.callback !== "receiveTrikonicProducts") {
    return ContentService.createTextOutput("Not found").setMimeType(ContentService.MimeType.TEXT);
  }
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const catalogSheet = spreadsheet.getSheetByName(CATALOG_SHEET_NAME);
    const inventorySheet = spreadsheet.getSheetByName("Products");
    const products = [];
    const ready = Boolean(catalogSheet && catalogSheet.getLastRow() > 1);
    if (ready) {
      const inventoryRows = inventorySheet ? inventorySheet.getDataRange().getValues() : [];
      const headers = (inventoryRows[2] || []).map(value => String(value).trim().toLowerCase());
      const skuIndex = headers.findIndex(value => value === "sku");
      const nameIndex = headers.findIndex(value => value === "product name");
      const categoryIndex = headers.findIndex(value => value === "category");
      const priceIndex = headers.findIndex(value => value === "selling price");
      const inventory = new Map();
      if ([skuIndex, nameIndex, categoryIndex, priceIndex].every(index => index >= 0)) {
        inventoryRows.slice(3).forEach(row => {
          const sku = String(row[skuIndex] || "").trim();
          const name = String(row[nameIndex] || "").trim();
          const rawPrice = row[priceIndex];
          const price = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice).replace(/[^0-9.-]/g, ""));
          if (sku && name && Number.isFinite(price) && price > 0) {
            inventory.set(sku, { name, category: String(row[categoryIndex] || "Other").trim(), price });
          }
        });
      }
      const rows = catalogSheet.getRange(2, 1, catalogSheet.getLastRow() - 1, 7).getValues();
      rows.forEach(row => {
        const [sku, description, image, rawAvailability, tag, color, visible] = row;
        const isVisible = visible === true || ["true", "yes", "1"].includes(String(visible).trim().toLowerCase());
        const product = inventory.get(String(sku || "").trim());
        if (!isVisible || !product || !image) return;
        const availability = String(rawAvailability || "in_stock").trim().toLowerCase() === "preorder" ? "preorder" : "in_stock";
        const safeColor = /^#[0-9a-f]{6}$/i.test(String(color).trim()) ? String(color).trim() : "#e8e4dc";
        products.push({
          id: String(sku).trim(), name: product.name, category: product.category,
          price: product.price, description: String(description || "").trim(), image: String(image).trim(), availability,
          tag: String(tag || "").trim(), color: safeColor
        });
      });
    }
    const response = JSON.stringify({ ready, products });
    return ContentService.createTextOutput(`receiveTrikonicProducts(${response});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput("receiveTrikonicProducts(null);").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

function doPost(e) {
  try {
    const order = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
      || SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Received at", "Order ID", "Customer", "Contact", "Delivery area", "Items", "Estimated total (GHS)", "Notes", "Status"]);
      sheet.setFrozenRows(1);
    }
    const items = (order.items || []).map(item => `${item.quantity} x ${item.name}${item.availability === "preorder" ? " [PRE-ORDER]" : " [IN STOCK]"} @ GHS ${item.unitPrice}`).join("; ");
    sheet.appendRow([
      new Date(), order.orderId || "", order.customer?.name || "", order.customer?.contact || "",
      order.customer?.location || "", items, Number(order.estimatedTotal || 0), order.customer?.notes || "", "New"
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error) })).setMimeType(ContentService.MimeType.JSON);
  }
}
