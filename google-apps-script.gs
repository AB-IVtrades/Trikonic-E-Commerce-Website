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
        const availabilityValue = String(rawAvailability || "in_stock").trim().toLowerCase().replace(/[\s_-]/g, "");
        const availability = availabilityValue === "preorder" ? "preorder" : "in_stock";
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
    ensureOrderHeaders(sheet);
    const items = (order.items || []).map(item => `${item.quantity} x ${item.name}${item.availability === "preorder" ? " [PRE-ORDER]" : " [IN STOCK]"} @ GHS ${item.unitPrice}`).join("; ");
    const receivedAt = new Date();
    sheet.appendRow([
      receivedAt, receivedAt, order.orderId || "", order.customer?.name || "", order.customer?.contact || "",
      order.customer?.location || "", items, Number(order.estimatedTotal || 0), order.customer?.notes || "", "New"
    ]);
    const row = sheet.getLastRow();
    sheet.getRange(row, 1).setNumberFormat("dd mmm yyyy");
    sheet.getRange(row, 2).setNumberFormat("hh:mm:ss AM/PM");
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error) })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Run once from the Apps Script editor to add/backfill the date and time columns now.
function setupTrikonicOrdersSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureOrderHeaders(sheet);
}

function ensureOrderHeaders(sheet) {
  const headers = ["Order Date", "Order Time", "Order ID", "Customer", "Contact", "Delivery area", "Items", "Estimated total (GHS)", "Notes", "Status"];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value).trim());
    if (current[0] === "Received at" && current[1] !== "Order Time") {
      // Preserve existing order columns while splitting the timestamp into date and time.
      sheet.insertColumnAfter(1);
      sheet.getRange(1, 1, 1, 2).setValues([["Order Date", "Order Time"]]);
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const timestamps = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        sheet.getRange(2, 2, timestamps.length, 1).setValues(timestamps);
      }
    } else if (current[0] !== "Order Date" || current[1] !== "Order Time") {
      throw new Error("The Trikonic Orders header row is unexpected. Please check it before accepting orders.");
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  sheet.getRange("A:A").setNumberFormat("dd mmm yyyy");
  sheet.getRange("B:B").setNumberFormat("hh:mm:ss AM/PM");
}
