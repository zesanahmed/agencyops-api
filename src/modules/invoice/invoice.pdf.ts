import PDFDocument from "pdfkit";

export interface InvoicePdfData {
  number: string;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID";
  issueDate: Date;
  dueDate: Date;
  paidAt: Date | null;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  sellerName: string;
  clientName: string;
  projectName: string | null;
  items: Array<{ description: string; quantity: number; unitAmountCents: number; amountCents: number }>;
}

const MARGIN = 50;
const PAGE_BOTTOM = 760;
const COLUMNS = { description: MARGIN, quantity: 330, unit: 395, amount: 480 } as const;
const AMOUNT_WIDTH = 65;

const GREY = "#6b7280";
const INK = "#111827";

function formatMoney(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

const formatDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Renders an invoice to an in-memory PDF. Pure function of its input — no
 * database, network or clock — so regenerating from the same data is
 * deterministic apart from PDF metadata timestamps.
 *
 * Uses PDFKit's built-in Helvetica (WinAnsi), so Latin text only: characters
 * outside that set (e.g. Bengali) are not rendered correctly until a Unicode
 * font is bundled.
 */
export function renderInvoicePdf(data: InvoicePdfData, options: { compress?: boolean } = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      compress: options.compress ?? true,
      info: { Title: `Invoice ${data.number}`, Author: data.sellerName },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const money = (cents: number): string => formatMoney(cents, data.currency);

    // Header
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(24).text("INVOICE", MARGIN, MARGIN);
    doc.font("Helvetica").fontSize(11).fillColor(GREY).text(data.number, MARGIN, MARGIN + 30);
    const statusLabel = data.status === "PAID" ? "PAID" : data.status === "VOID" ? "VOID" : "DUE";
    doc.font("Helvetica-Bold").fontSize(16).fillColor(data.status === "PAID" ? "#15803d" : INK).text(statusLabel, 400, MARGIN, {
      width: 145,
      align: "right",
    });

    // Parties
    let y = 120;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("FROM", MARGIN, y).text("BILL TO", 300, y);
    doc.font("Helvetica").fontSize(12).fillColor(INK).text(data.sellerName, MARGIN, y + 14, { width: 220 });
    doc.text(data.clientName, 300, y + 14, { width: 245 });
    if (data.projectName) {
      doc.fontSize(10).fillColor(GREY).text(`Project: ${data.projectName}`, 300, doc.y + 2, { width: 245 });
    }

    // Dates
    y = 190;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("ISSUE DATE", MARGIN, y).text("DUE DATE", 200, y);
    doc.font("Helvetica").fontSize(11).fillColor(INK).text(formatDate(data.issueDate), MARGIN, y + 13).text(formatDate(data.dueDate), 200, y + 13);
    if (data.status === "PAID" && data.paidAt) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("PAID ON", 350, y);
      doc.font("Helvetica").fontSize(11).fillColor(INK).text(formatDate(data.paidAt), 350, y + 13);
    }

    // Items table
    y = 245;
    const drawTableHeader = (top: number): number => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY);
      doc.text("DESCRIPTION", COLUMNS.description, top);
      doc.text("QTY", COLUMNS.quantity, top, { width: 50, align: "right" });
      doc.text("UNIT PRICE", COLUMNS.unit, top, { width: 75, align: "right" });
      doc.text("AMOUNT", COLUMNS.amount, top, { width: AMOUNT_WIDTH, align: "right" });
      doc.moveTo(MARGIN, top + 14).lineTo(545, top + 14).strokeColor("#d1d5db").lineWidth(0.5).stroke();
      return top + 22;
    };
    y = drawTableHeader(y);

    doc.font("Helvetica").fontSize(10).fillColor(INK);
    for (const item of data.items) {
      const height = doc.heightOfString(item.description, { width: 265 });
      if (y + height > PAGE_BOTTOM) {
        doc.addPage();
        y = drawTableHeader(MARGIN);
        doc.font("Helvetica").fontSize(10).fillColor(INK);
      }
      doc.text(item.description, COLUMNS.description, y, { width: 265 });
      doc.text(String(item.quantity), COLUMNS.quantity, y, { width: 50, align: "right" });
      doc.text(money(item.unitAmountCents), COLUMNS.unit, y, { width: 75, align: "right" });
      doc.text(money(item.amountCents), COLUMNS.amount, y, { width: AMOUNT_WIDTH, align: "right" });
      y += Math.max(height, 12) + 8;
    }

    // Totals
    if (y + 110 > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    doc.moveTo(300, y).lineTo(545, y).strokeColor("#d1d5db").lineWidth(0.5).stroke();
    y += 10;
    const totalRow = (label: string, value: string, bold = false): void => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(INK);
      doc.text(label, 300, y, { width: 120 });
      doc.text(value, 420, y, { width: 125, align: "right" });
      y += bold ? 20 : 16;
    };
    totalRow("Subtotal", money(data.subtotalCents));
    if (data.discountCents > 0) totalRow("Discount", `-${money(data.discountCents)}`);
    if (data.taxCents > 0) totalRow("Tax", money(data.taxCents));
    totalRow("Total", money(data.totalCents), true);

    // Notes
    if (data.notes) {
      y += 16;
      if (y + 60 > PAGE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("NOTES", MARGIN, y);
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(data.notes, MARGIN, y + 13, { width: 495 });
    }

    doc.end();
  });
}
