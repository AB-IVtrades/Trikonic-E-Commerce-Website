import { PDFDocument, PDFString, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { receiptFont } from "./receipt-font.ts";

export type ReceiptItem = {
  name?: string;
  image?: string;
  color?: string;
  size?: string;
  variant?: string;
  availability?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  shippingTotal?: number | null;
};
export type ReceiptOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  contact?: string;
  delivery_area?: string;
  created_at: string;
  payment_paid_at?: string;
  payment_reference?: string;
  payment_status: string;
  estimated_total: number;
  currency: string;
  items: ReceiptItem[];
};
export const receiptColumns =
  "id,order_number,customer_name,customer_email,contact,delivery_area,created_at,payment_paid_at,payment_reference,payment_status,estimated_total,currency,items";
const navy = "#0b3154", orange = "#ff710f";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
export const trackingUrl = (order: ReceiptOrder) =>
  `https://trikonicimports.com/?track=${
    encodeURIComponent(order.order_number)
  }`;
export const receiptFilename = (order: ReceiptOrder) =>
  `Trikonic-${order.order_number.replace(/[^A-Za-z0-9-]/g, "")}-receipt.pdf`;
export function receiptTotals(order: ReceiptOrder) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce(
    (sum, i) =>
      sum +
      cents(i.lineTotal ?? Number(i.unitPrice || 0) * Number(i.quantity || 0)),
    0,
  );
  const shipping = items.reduce((sum, i) => sum + cents(i.shippingTotal), 0);
  const total = cents(order.estimated_total);
  return {
    subtotal,
    shipping,
    total,
    breakdown: items.length > 0 &&
      items.every((i) => i.shippingTotal != null) &&
      subtotal + shipping === total,
  };
}
const money = (order: ReceiptOrder, amount: number) =>
  `${order.currency || "GHS"} ${(amount / 100).toFixed(2)}`;
const date = (v?: string) =>
  v && Number.isFinite(Date.parse(v))
    ? new Date(v).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Accra",
    })
    : "—";
const options = (i: ReceiptItem) =>
  [
    i.color && `Colour: ${i.color}`,
    i.size && `Size: ${i.size}`,
    i.variant && `Option: ${i.variant}`,
  ].filter(Boolean).join(" · ");
export function safePhoto(source?: string): string {
  try {
    const url = new URL(source || "", "https://trikonicimports.com/");
    const allowed = url.protocol === "https:" && !url.username &&
      !url.password && !url.port &&
      ((url.hostname === "raw.githubusercontent.com" &&
        url.pathname.startsWith(
          "/AB-IVtrades/Trikonic-E-Commerce-Website/main/images/",
        )) ||
        (url.hostname === "trikonicimports.com" &&
          url.pathname.startsWith("/images/")));
    return allowed ? url.href : "";
  } catch {
    return "";
  }
}
export function receiptHtml(order: ReceiptOrder) {
  const totals = receiptTotals(order);
  const rows = (order.items || []).map((i) =>
    `<tr><td style="padding:20px 0;border-bottom:1px solid #e5eaf0"><table role="presentation" width="100%"><tr>${
      safePhoto(i.image)
        ? `<td width="100" valign="top"><img src="${
          esc(safePhoto(i.image))
        }" width="84" alt="${
          esc(i.name)
        }" style="max-height:92px;object-fit:contain"></td>`
        : ""
    }<td valign="top"><strong>${
      esc(i.name || "Item")
    }</strong><p style="margin:8px 0;font-size:12px;color:#5b6b7b">${
      esc(options(i))
    }</p><span style="font-size:12px">Quantity: ${
      Number(i.quantity) || 0
    }</span></td><td align="right" valign="bottom" style="white-space:nowrap">${
      money(
        order,
        cents(
          i.lineTotal ?? Number(i.unitPrice || 0) * Number(i.quantity || 0),
        ),
      )
    }</td></tr></table></td></tr>`
  ).join("");
  return `<!doctype html><html><body style="margin:0;background:#f3f5f7;color:${navy};font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="640" style="width:100%;max-width:640px;background:white" cellspacing="0" cellpadding="0"><tr><td align="center" style="background:${navy};padding:30px 20px;border-bottom:5px solid ${orange};color:white;font-size:26px;letter-spacing:5px;font-weight:bold">TRIKONIC<span style="display:block;font-size:10px;letter-spacing:4px;margin-top:8px">IMPORTS</span></td></tr><tr><td style="padding:32px 28px"><p style="color:${orange};font-size:11px;letter-spacing:2px;text-align:center">PAYMENT RECEIPT</p><h1 style="font-family:Georgia,serif;text-align:center;font-size:28px">Thanks for your order, ${
    esc(order.customer_name || "valued customer")
  }.</h1><p style="text-align:center;color:#5b6b7b;font-size:12px">Order ${
    esc(order.order_number)
  }</p><table role="presentation" width="100%" style="font-size:12px;line-height:1.7;margin:28px 0"><tr><td width="36%" valign="top"><span style="color:#5b6b7b">Delivering to</span><br><strong>${
    esc(order.customer_name)
  }</strong><br>${esc(order.delivery_area)}<br>${
    esc(order.contact)
  }</td><td width="36%" valign="top" style="word-break:break-word"><span style="color:#5b6b7b">Receipt for</span><br>${
    esc(order.customer_email)
  }<br><strong style="color:${orange}">Payment confirmed</strong></td><td valign="top"><span style="color:#5b6b7b">Date ordered</span><br>${
    date(order.created_at)
  }<br><span style="color:#5b6b7b">Date paid</span><br>${
    date(order.payment_paid_at)
  }</td></tr></table><p style="text-align:center;font-size:13px">Your payment has been received. Follow your order’s progress in your account.</p><p style="text-align:center;margin:24px 0 32px"><a href="${
    esc(trackingUrl(order))
  }" style="display:inline-block;padding:13px 28px;background:${orange};color:${navy};text-decoration:none;font-weight:bold">Track your order</a></p><h2 style="font-family:Georgia,serif;font-size:18px;border-bottom:1px solid #e5eaf0;padding-bottom:14px">Your order summary</h2><table role="presentation" width="100%" cellspacing="0">${rows}</table><table role="presentation" width="100%" style="font-size:13px;line-height:2;margin-top:16px"><tr><td>${
    totals.breakdown ? "Item subtotal" : "Items & shipping"
  }</td><td align="right">${
    money(order, totals.breakdown ? totals.subtotal : totals.total)
  }</td></tr><tr><td>Shipping</td><td align="right">${
    totals.breakdown ? money(order, totals.shipping) : "Included"
  }</td></tr><tr style="font-size:22px;font-weight:bold"><td>Total paid</td><td align="right" style="color:${orange}">${
    money(order, totals.total)
  }</td></tr></table><p style="font-size:11px;color:#5b6b7b;overflow-wrap:anywhere">Payment reference: ${
    esc(order.payment_reference || order.order_number)
  }</p><p style="font-size:12px;line-height:1.7;color:#5b6b7b">Pre-orders take 6–9 weeks to arrive in Ghana. In-stock orders take 2–3 days to be processed and delivered.</p><p style="font-size:12px">Your PDF payment receipt is attached.</p></td></tr><tr><td align="center" style="background:#f3f5f7;padding:24px;font-size:11px;line-height:1.8">Trikonic Imports<br><a style="color:${navy}" href="mailto:trikonic1011@gmail.com">trikonic1011@gmail.com</a><br><a style="color:${navy}" href="https://trikonicimports.com/">trikonicimports.com</a></td></tr></table></td></tr></table></body></html>`;
}
export const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
};
export async function createReceiptPdf(
  order: ReceiptOrder,
): Promise<Uint8Array> {
  if (order.payment_status !== "paid") {
    throw new Error("A payment receipt requires confirmed payment.");
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    Uint8Array.from(atob(receiptFont), (c) => c.charCodeAt(0)),
    { subset: true },
  );
  const color = (hex: string) =>
    rgb(
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    );
  const ink = color(navy),
    accent = color(orange),
    muted = color("#5b6b7b"),
    rule = color("#e5eaf0");
  let page = pdf.addPage([595.28, 841.89]);
  let y = 0;
  const text = (value: string, x: number, top: number, size = 10, fill = ink) =>
    page.drawText(String(value).replace(/[\r\n\t]/g, " "), {
      x,
      y: 841.89 - top - size,
      size,
      font,
      color: fill,
    });
  const lines = (value: string, width: number, size = 10) => {
    const result: string[] = [];
    let line = "";
    for (const word of String(value).replace(/[\r\n\t]/g, " ").split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) {
        result.push(line);
        line = "";
      }
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) {
          result.push(line);
          line = "";
        }
        line += char;
      }
      line += " ";
    }
    if (line || !result.length) result.push(line.trim());
    return result;
  };
  const block = (
    value: string,
    x: number,
    top: number,
    width: number,
    size = 10,
    fill = ink,
  ) => {
    const wrapped = lines(value, width, size);
    wrapped.forEach((line, index) =>
      text(line, x, top + index * (size + 5), size, fill)
    );
    return wrapped.length * (size + 5);
  };
  const right = (value: string, top: number, size = 10, fill = ink) =>
    text(value, 551 - font.widthOfTextAtSize(value, size), top, size, fill);
  const header = () => {
    page.drawRectangle({
      x: 0,
      y: 738,
      width: 595.28,
      height: 104,
      color: ink,
    });
    page.drawRectangle({
      x: 0,
      y: 734,
      width: 595.28,
      height: 4,
      color: accent,
    });
    const title = "T R I K O N I C";
    text(
      title,
      (595 - font.widthOfTextAtSize(title, 27)) / 2,
      26,
      27,
      rgb(1, 1, 1),
    );
    text(
      "I M P O R T S",
      (595 - font.widthOfTextAtSize("I M P O R T S", 10)) / 2,
      67,
      10,
      rgb(1, 1, 1),
    );
    y = 128;
  };
  const ensure = (height: number) => {
    if (y + height > 766) {
      page = pdf.addPage([595.28, 841.89]);
      header();
      text(`Order ${order.order_number} · continued`, 44, y, 10, muted);
      y += 34;
    }
  };
  header();
  text("PAYMENT RECEIPT", 44, y, 10, accent);
  y += 25;
  y += block(
    `Thanks for your order, ${order.customer_name || "valued customer"}.`,
    44,
    y,
    507,
    21,
  ) + 8;
  text(`Order ${order.order_number}`, 44, y, 10, muted);
  y += 26;
  const top = y;
  text("DELIVERING TO", 44, top, 9, muted);
  text("RECEIPT FOR", 226, top, 9, muted);
  text("DATE ORDERED", 421, top, 9, muted);
  const deliveryHeight = block(
    [order.customer_name, order.delivery_area, order.contact].filter(Boolean)
      .join(" · "),
    44,
    top + 20,
    157,
  );
  const billedHeight = block(order.customer_email, 226, top + 20, 170);
  text("Payment confirmed", 226, top + 25 + billedHeight, 10, accent);
  text(date(order.created_at), 421, top + 20, 9);
  text("DATE PAID", 421, top + 44, 9, muted);
  text(date(order.payment_paid_at), 421, top + 62, 9);
  y = top + Math.max(78, deliveryHeight + 28, billedHeight + 50);
  y += block(
    "Your payment has been received. Follow your order’s progress in your account.",
    44,
    y,
    507,
    11,
  ) + 12;
  page.drawRectangle({
    x: 44,
    y: 841.89 - y - 34,
    width: 160,
    height: 34,
    color: accent,
  });
  text("Track your order", 64, y + 9, 11);
  page.node.addAnnot(
    pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [44, 841.89 - y - 34, 204, 841.89 - y],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(trackingUrl(order)) },
      }),
    ),
  );
  y += 50;
  text("Your order summary", 44, y, 15);
  y += 28;
  for (const item of order.items || []) {
    const nameLines = lines(item.name || "Item", 300, 11),
      optionLines = options(item) ? lines(options(item), 300, 9) : [];
    const height = Math.max(
      90,
      nameLines.length * 16 + optionLines.length * 14 + 42,
    );
    ensure(height);
    page.drawLine({
      start: { x: 44, y: 841.89 - y },
      end: { x: 551, y: 841.89 - y },
      thickness: .7,
      color: rule,
    });
    let image;
    const url = safePhoto(item.image);
    if (url) {
      try {
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        if (
          response.ok &&
          Number(response.headers.get("content-length") || 0) <= 3000000
        ) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length <= 3000000) {
            image = bytes[0] === 137
              ? await pdf.embedPng(bytes)
              : bytes[0] === 255
              ? await pdf.embedJpg(bytes)
              : undefined;
          }
        }
      } catch {
        /* A missing product image must never block a payment receipt. */
      }
    }
    if (image) {
      const scaled = image.scaleToFit(78, 76);
      page.drawImage(image, {
        x: 44 + (78 - scaled.width) / 2,
        y: 841.89 - y - 14 - scaled.height,
        width: scaled.width,
        height: scaled.height,
      });
    } else {
      page.drawRectangle({
        x: 44,
        y: 841.89 - y - 84,
        width: 78,
        height: 70,
        color: color("#f3f5f7"),
      });
      text("TRIKONIC", 52, y + 39, 9, muted);
    }
    let rowY = y + 12;
    rowY += block(item.name || "Item", 140, rowY, 300, 11);
    if (options(item)) {
      rowY += block(options(item), 140, rowY + 4, 300, 9, muted) + 4;
    }
    text(`Quantity: ${Number(item.quantity) || 0}`, 140, rowY + 5, 9);
    right(
      money(
        order,
        cents(
          item.lineTotal ??
            Number(item.unitPrice || 0) * Number(item.quantity || 0),
        ),
      ),
      y + height - 28,
    );
    y += height;
  }
  const referenceText = `Payment reference: ${
    order.payment_reference || order.order_number
  }`;
  const deliveryText =
    "Pre-orders take 6–9 weeks to arrive in Ghana. In-stock orders take 2–3 days to be processed and delivered.";
  ensure(
    128 + lines(referenceText, 507, 9).length * 14 +
      lines(deliveryText, 507, 9).length * 14,
  );
  page.drawLine({
    start: { x: 44, y: 841.89 - y },
    end: { x: 551, y: 841.89 - y },
    thickness: .7,
    color: rule,
  });
  y += 18;
  const totals = receiptTotals(order);
  text(totals.breakdown ? "Item subtotal" : "Items & shipping", 320, y);
  right(money(order, totals.breakdown ? totals.subtotal : totals.total), y);
  y += 24;
  text("Shipping", 320, y);
  right(totals.breakdown ? money(order, totals.shipping) : "Included", y);
  y += 34;
  text("Total paid", 320, y, 18);
  right(money(order, totals.total), y, 18, accent);
  y += 42;
  y += block(
    `Payment reference: ${order.payment_reference || order.order_number}`,
    44,
    y,
    507,
    9,
    muted,
  ) + 10;
  y += block(
    "Pre-orders take 6–9 weeks to arrive in Ghana. In-stock orders take 2–3 days to be processed and delivered.",
    44,
    y,
    507,
    9,
    muted,
  );
  pdf.getPages().forEach((p, index) => {
    p.drawLine({
      start: { x: 44, y: 55 },
      end: { x: 551, y: 55 },
      thickness: .7,
      color: rule,
    });
    p.drawText(
      "Trikonic Imports  ·  trikonic1011@gmail.com  ·  trikonicimports.com",
      { x: 44, y: 36, size: 8, font, color: muted },
    );
    p.drawText(`${index + 1} / ${pdf.getPageCount()}`, {
      x: 522,
      y: 36,
      size: 8,
      font,
      color: muted,
    });
  });
  pdf.setTitle(`Payment receipt ${order.order_number}`);
  pdf.setAuthor("Trikonic Imports");
  return pdf.save();
}

// Keep the emailed attachment and every later download byte-for-byte identical.
export async function savedReceiptPdf(
  order: ReceiptOrder,
  url: string,
  key: string,
) {
  if (order.payment_status !== "paid") {
    throw new Error("Payment has not been confirmed.");
  }
  const path = `${url}/storage/v1/object/payment-receipts/${
    encodeURIComponent(order.id)
  }.pdf`;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const existing = await fetch(path, { headers });
  if (existing.ok) return new Uint8Array(await existing.arrayBuffer());
  const bytes = await createReceiptPdf(order);
  const upload = await fetch(path, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/pdf",
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (upload.ok) return bytes;
  // Another request may have created the receipt while this one was rendering.
  const winner = await fetch(path, { headers });
  if (winner.ok) return new Uint8Array(await winner.arrayBuffer());
  throw new Error("Could not save the payment receipt.");
}
