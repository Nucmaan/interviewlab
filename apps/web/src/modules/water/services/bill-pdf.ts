import 'server-only';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/format';

/**
 * Water bill as a PDF (pdfkit), with a QR code (bonus feature). The QR code holds the payment
 * reference in a simple, documented format that a mobile money app or bank teller can scan:
 *   IRCUB|WB-2026-0004567-3|SOS|1975.00|WA-000123
 * so the payer never has to type the control number.
 */
export async function renderBillPdf(billId: number): Promise<Buffer | null> {
  const bill = await prisma.waterBill.findUnique({
    where: { bill_id: billId },
    include: { account: { include: { payer: true } }, reading: true },
  });
  if (!bill) return null;

  const outstanding = Number(bill.total_due) - Number(bill.amount_paid);
  const qrPayload = [
    'IRCUB',
    bill.control_number,
    'SOS',
    outstanding.toFixed(2),
    bill.account_no,
  ].join('|');
  const qr = await QRCode.toBuffer(qrPayload, { width: 180, margin: 1 });
  const month = bill.billing_month.toISOString().slice(0, 7);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: { Title: `Water bill ${month} ${bill.account_no}` },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(18).text('State Water Agency', { continued: false });
  doc
    .fontSize(10)
    .fillColor('#555')
    .text('Integrated Revenue Collection & Utility Billing Platform (IRCUB)');
  doc.moveDown().fillColor('#000').fontSize(14).text(`Water bill - ${month}`);
  doc.image(qr, 400, 50, { width: 130 });
  doc.fontSize(8).text('Scan to pay', 430, 185);

  doc.fontSize(10).moveDown(2);
  const left = 50;
  let y = 220;
  const row = (label: string, value: string, bold = false) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, left, y)
      .text(value, 300, y, { width: 245, align: 'right' });
    y += 18;
  };
  row('Customer', bill.account.payer.full_name);
  row('Account / meter', `${bill.account_no} / ${bill.account.meter_no}`);
  row('Tariff class', bill.account.tariff_class);
  row('Payment reference (control number)', bill.control_number, true);
  y += 10;
  row(
    'Meter reading',
    bill.reading
      ? `${bill.reading.reading_value} (${bill.reading.reading_date.toISOString().slice(0, 10)})`
      : '—',
  );
  row('Consumption', `${bill.consumption_m3} m³${bill.is_estimated ? ' (estimated)' : ''}`);
  y += 10;
  row('Previous balance', formatMoney(bill.previous_balance.toString()));
  row('Payments received', `- ${formatMoney(bill.payments_received.toString())}`);
  row('Arrears brought forward', formatMoney(bill.arrears_brought_forward.toString()));
  row('Consumption charge', formatMoney(bill.consumption_charge.toString()));
  row('Service charge', formatMoney(bill.service_charge.toString()));
  row('Current charges', formatMoney(bill.amount_billed.toString()));
  y += 6;
  doc.moveTo(left, y).lineTo(545, y).stroke();
  y += 8;
  row('TOTAL DUE', formatMoney(bill.total_due.toString()), true);
  row('Due date', bill.due_date.toISOString().slice(0, 10), true);
  y += 20;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#555')
    .text(
      'Pay at any partner bank or by mobile money using the payment reference above. ' +
        "Payments in USD are converted at the day's rate. This is a demonstration bill with fictional data.",
      left,
      y,
      { width: 495 },
    );
  doc.end();
  return finished;
}
