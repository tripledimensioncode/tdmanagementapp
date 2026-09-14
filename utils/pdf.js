const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');
const QRCode = require('qrcode');
const { PassThrough } = require('stream');
const { calculatePaymentSummary } = require('./billing');

const THEME = {
  accent: '#1f3a5f',
  ink: '#111827',
  muted: '#6b7280',
  line: '#d1d5db',
  headerFill: '#e5edf8',
  zebra: '#f8fafc'
};

function formatCurrency(value) {
  return `GHS ${Number(value || 0).toFixed(2)}`;
}

function formatMass(value) {
  return `${Number(value || 0).toFixed(2)} g`;
}

function truncate(value, max) {
  const text = String(value == null ? '' : value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function startPdfResponse(res, filename, disposition = 'inline') {
  const safeDisposition = disposition === 'attachment' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${safeDisposition}; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function pageBounds(doc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  return { left, right, width: right - left, bottom };
}

function ensureSpace(doc, requiredHeight) {
  const { bottom } = pageBounds(doc);
  if (doc.y + requiredHeight > bottom) doc.addPage();
}

function drawHeader(doc, options) {
  const { title, subtitle, rightMeta = [] } = options;
  const { left, right } = pageBounds(doc);
  const fsNormal = require('fs');
  const path = require('path');

  const logoPath = path.join(__dirname, '..', 'public', 'images', 'company-logo.png');
  const hasLogo = fsNormal.existsSync(logoPath);

  const startY = doc.y;
  let textX = left;

  if (hasLogo) {
    // Render the logo on the extreme left, scaling it proportionally with a 50pt width
    doc.image(logoPath, left, startY, { width: 50 });
    textX = left + 62;
  }

  doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(18)
    .text('TRIPLE DIMENSION', textX, startY, { width: 280 });
  doc.fillColor(THEME.ink).font('Helvetica-Bold').fontSize(13)
    .text(title, textX, startY + 20, { width: 360 });
  if (subtitle) {
    doc.fillColor(THEME.muted).font('Helvetica').fontSize(9)
      .text(subtitle, textX, startY + 36, { width: 360 });
  }

  const rightWidth = 220;
  let metaY = startY + 2;
  rightMeta.forEach((line) => {
    doc.fillColor(THEME.muted).font('Helvetica').fontSize(9)
      .text(line, right - rightWidth, metaY, { width: rightWidth, align: 'right' });
    metaY += 13;
  });

  doc.moveTo(left, startY + 62).lineTo(right, startY + 62).strokeColor(THEME.line).lineWidth(1).stroke();
  doc.y = startY + 76;
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 24);
  const { left, right } = pageBounds(doc);
  doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(11)
    .text(text, left, doc.y);
  doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(THEME.line).lineWidth(1).stroke();
  doc.y += 10;
}

function drawInfoList(doc, rows) {
  const { left } = pageBounds(doc);
  rows.forEach((row) => {
    ensureSpace(doc, 18);
    const label = `${row.label}: `;
    doc.fillColor(THEME.ink).font('Helvetica-Bold').fontSize(10)
      .text(label, left, doc.y, { continued: true });
    doc.fillColor(THEME.ink).font('Helvetica').fontSize(10)
      .text(row.value || '-');
    doc.moveDown(0.2);
  });
  doc.moveDown(0.3);
}

function drawSimpleList(doc, lines) {
  const { left } = pageBounds(doc);
  lines.forEach((line) => {
    ensureSpace(doc, 16);
    doc.fillColor(THEME.ink).font('Helvetica').fontSize(10)
      .text(`- ${line}`, left, doc.y);
    doc.moveDown(0.15);
  });
  doc.moveDown(0.25);
}

function drawTable(doc, options) {
  const { columns, rows, rowHeight = 24, zebra = true, align = 'left', x, centerOnPage = false } = options;
  const { left, right, width, bottom } = pageBounds(doc);
  const pageLeft = 0;
  const pageRight = doc.page.width;
  const availableWidth = align === 'center' && centerOnPage ? (pageRight - pageLeft) : width;
  let tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const needsScale = tableWidth > availableWidth;
  const scale = needsScale ? availableWidth / tableWidth : 1;
  const scaledColumns = needsScale
    ? columns.map((col) => ({ ...col, width: col.width * scale }))
    : columns;
  tableWidth = scaledColumns.reduce((sum, col) => sum + col.width, 0);

  const startX = Number.isFinite(x)
    ? x
    : align === 'center'
      ? (centerOnPage
        ? pageLeft + Math.max(0, (availableWidth - tableWidth) / 2)
        : left + Math.max(0, (width - tableWidth) / 2))
      : align === 'right'
        ? Math.max(left, right - tableWidth)
        : left;

  function drawHeaderRow() {
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;
    doc.save();
    doc.rect(startX, y, tableWidth, rowHeight).fill(THEME.headerFill);
    doc.restore();

    let x = startX;
    scaledColumns.forEach((col) => {
      doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(9)
        .text(col.label, x + 6, y + 7, { width: col.width - 12, align: col.align || 'left' });
      x += col.width;
    });

    doc.save();
    doc.moveTo(startX, y + rowHeight).lineTo(Math.min(startX + tableWidth, right), y + rowHeight).strokeColor(THEME.line).lineWidth(1).stroke();
    doc.restore();

    doc.y += rowHeight;
  }

  drawHeaderRow();

  rows.forEach((row, rowIndex) => {
    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      drawHeaderRow();
    }

    const y = doc.y;
    if (zebra && rowIndex % 2 === 1) {
      doc.save();
      doc.rect(startX, y, tableWidth, rowHeight).fill(THEME.zebra);
      doc.restore();
    }

    let x = startX;
    scaledColumns.forEach((col) => {
      const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
      const value = truncate(raw == null ? '-' : raw, col.maxChars || 70);
      doc.fillColor(THEME.ink).font('Helvetica').fontSize(9)
        .text(value, x + 6, y + 7, { width: col.width - 12, align: col.align || 'left' });
      x += col.width;
    });

    doc.save();
    doc.moveTo(startX, y + rowHeight).lineTo(Math.min(startX + tableWidth, right), y + rowHeight).strokeColor(THEME.line).lineWidth(0.7).stroke();
    doc.restore();

    doc.y += rowHeight;
  });

  doc.moveDown(0.4);
}

function drawTotalsBlock(doc, rows) {
  const { left, width } = pageBounds(doc);
  const boxWidth = Math.min(300, width);
  const x = left + width - boxWidth;
  const y = doc.y;
  const lineHeight = 18;
  const boxHeight = 12 + rows.length * lineHeight + 8;

  ensureSpace(doc, boxHeight + 4);

  doc.save();
  doc.rect(x, y, boxWidth, boxHeight).strokeColor(THEME.line).lineWidth(1).stroke();
  doc.restore();

  let currentY = y + 8;
  rows.forEach((row) => {
    doc.fillColor(THEME.ink).font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.bold ? 11 : 10)
      .text(row.label, x + 10, currentY, { width: boxWidth - 20, continued: true })
      .text(row.value, { align: 'right' });
    currentY += lineHeight;
  });

  doc.y += boxHeight + 10;
}

function generateFabricationSummaryPdf(res, options) {
  const { periodLabel, entries, generatedByName, download = false } = options;

  const filename = `fabrication-summary-${dayjs().format('YYYYMMDD-HHmmss')}.pdf`;
  startPdfResponse(res, filename, download ? 'attachment' : 'inline');

  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  doc.pipe(res);

  const totalEntries = entries.length;
  const computeEntryCost = (entry) => {
    const additionalCost = Number(entry.cost || 0);
    if (entry.type !== '3D_PRINTING') return { total: additionalCost, complete: entry.cost != null };

    const rate = Number(entry.costPerGram || 0);
    const hasRate = Number.isFinite(rate) && rate > 0;
    const files = entry.files || [];
    if (!hasRate) return { total: entry.cost != null ? additionalCost : null, complete: false };
    if (files.length === 0) return { total: additionalCost, complete: entry.cost != null };

    const masses = files.map((file) => Number(file.massGrams));
    const allMassValid = masses.every((mass) => Number.isFinite(mass) && mass > 0);
    if (!allMassValid) return { total: entry.cost != null ? additionalCost : null, complete: false };

    const totalMass = masses.reduce((sum, mass) => sum + mass, 0);
    const fileCostTotal = totalMass * rate;
    return { total: fileCostTotal + additionalCost, complete: true };
  };

  const totalRecordedCost = entries.reduce((sum, entry) => {
    const result = computeEntryCost(entry);
    return sum + Number(result.total || 0);
  }, 0);
  const totalMass = entries.reduce((sum, entry) => {
    return sum + (entry.files || []).reduce((inner, file) => inner + Number(file.massGrams || 0), 0);
  }, 0);
  const totalFiles = entries.reduce((sum, entry) => sum + ((entry.files || []).length), 0);

  const typeCounts = entries.reduce((map, entry) => {
    map[entry.type] = (map[entry.type] || 0) + 1;
    return map;
  }, {});

  drawHeader(doc, {
    title: 'Fabrication Summary Report',
    subtitle: periodLabel,
    rightMeta: [
      `Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `Generated by: ${generatedByName}`
    ]
  });

  sectionTitle(doc, 'Summary');
  drawInfoList(doc, [
    { label: 'Total Entries', value: String(totalEntries) },
    { label: 'Total Uploaded Files', value: String(totalFiles) },
    { label: 'Total File Mass', value: formatMass(totalMass) },
    { label: 'Total Recorded Cost', value: formatCurrency(totalRecordedCost) }
  ]);

  sectionTitle(doc, 'Production Mix');
  const sortedTypes = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
  if (!sortedTypes.length) {
    drawSimpleList(doc, ['No entries found in the selected period.']);
  } else {
    drawSimpleList(doc, sortedTypes.map((type) => `${type}: ${typeCounts[type]} job(s)`));
  }

  sectionTitle(doc, 'Entry Register');
  drawTable(doc, {
    columns: [
      { label: 'Date', width: 62, value: (r) => dayjs(r.date).format('YYYY-MM-DD'), maxChars: 10 },
      { label: 'Type', width: 88, key: 'type', maxChars: 18 },
      { label: 'Job Name', width: 145, key: 'name', maxChars: 32 },
      { label: 'Author', width: 86, value: (r) => (r.author && r.author.name) || '-', maxChars: 18 },
      { label: 'Files', width: 40, value: (r) => String((r.files || []).length), align: 'right', maxChars: 4 },
      { label: 'Mass (g)', width: 64, value: (r) => (r.files || []).reduce((s, f) => s + Number(f.massGrams || 0), 0).toFixed(2), align: 'right', maxChars: 12 },
      {
        label: 'Cost',
        width: 70,
        value: (r) => {
          const result = computeEntryCost(r);
          return result.total != null ? formatCurrency(result.total) : '-';
        },
        align: 'right',
        maxChars: 12
      }
    ],
    rows: entries,
    rowHeight: 23,
    zebra: true,
    align: 'center',
    centerOnPage: true
  });

  drawTotalsBlock(doc, [
    { label: 'Total Entries', value: String(totalEntries) },
    { label: 'Total Cost', value: formatCurrency(totalRecordedCost), bold: true }
  ]);

  doc.fillColor(THEME.muted).font('Helvetica').fontSize(8)
    .text('Generated from internal fabrication records.', { align: 'left' });

  doc.end();
}

function generateFabricationInvoicePdf(res, options) {
  const { entry, ratePerGram, generatedByName, download = false } = options;

  const filename = `invoice-fabrication-${entry.id}.pdf`;
  startPdfResponse(res, filename, download ? 'attachment' : 'inline');

  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  doc.pipe(res);

  const is3DPrint = entry.type === '3D_PRINTING';
  const files = entry.files || [];
  const lineItems = entry.lineItems || [];
  let totalCost = 0;
  const additionalCost = Number(entry.cost || 0);

  const invoicePrefix = is3DPrint ? 'INV-3DP' : 'INV-FAB';
  const invoiceNumber = `${invoicePrefix}-${entry.id}-${dayjs(entry.createdAt).format('YYYYMMDD')}`;

  drawHeader(doc, {
    title: is3DPrint ? '3D Print Invoice' : 'Fabrication Invoice',
    subtitle: `Invoice #${invoiceNumber}`,
    rightMeta: [
      `Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `Generated by: ${generatedByName}`
    ]
  });

  sectionTitle(doc, 'Job Details');
  const authorName = entry.author && entry.author.name ? entry.author.name : '-';
  drawInfoList(doc, [
    { label: 'Job Name', value: entry.name },
    { label: 'Work Date', value: dayjs(entry.date).format('YYYY-MM-DD') },
    { label: 'Recorded By', value: authorName },
    { label: 'Entry Type', value: entry.typeLabel || entry.type },
    ...(is3DPrint ? [{ label: 'Rate Per Gram', value: formatCurrency(ratePerGram) }] : []),
    { label: 'Description', value: entry.description || 'N/A' }
  ]);

  if (is3DPrint) {
    const lines = files.map((file, idx) => {
      const mass = Number(file.massGrams || 0);
      const fileCost = mass * Number(ratePerGram || 0);
      return {
        serial: idx + 1,
        fileName: file.originalName || 'Uploaded File',
        mass,
        rate: Number(ratePerGram || 0),
        fileCost
      };
    });
    const totalMass = lines.reduce((sum, line) => sum + line.mass, 0);
    const fileCostTotal = lines.reduce((sum, line) => sum + line.fileCost, 0);
    const lineItemsTotal = lineItems.reduce((sum, li) => sum + (li.quantity * li.cost), 0);
    totalCost = fileCostTotal + additionalCost + lineItemsTotal;

    sectionTitle(doc, 'File Cost Breakdown');
    if (!lines.length) {
      drawSimpleList(doc, ['No files were attached to this entry.']);
    } else {
      drawTable(doc, {
        columns: [
          { label: '#', width: 24, key: 'serial', align: 'right', maxChars: 3 },
          { label: 'File Name', width: 220, key: 'fileName', maxChars: 42 },
          { label: 'Mass (g)', width: 74, value: (r) => r.mass.toFixed(2), align: 'right', maxChars: 12 },
          { label: 'Cost / g', width: 78, value: (r) => formatCurrency(r.rate), align: 'right', maxChars: 12 },
          { label: 'File Cost', width: 105, value: (r) => formatCurrency(r.fileCost), align: 'right', maxChars: 14 }
        ],
        rows: lines,
        rowHeight: 24,
        zebra: true
      });
    }

    if (lineItems.length > 0) {
      sectionTitle(doc, 'Additional Line Items');
      const itemLines = lineItems.map((li, idx) => ({
        serial: idx + 1,
        label: li.label,
        quantity: li.quantity,
        cost: li.cost,
        total: li.quantity * li.cost
      }));
      drawTable(doc, {
        columns: [
          { label: '#', width: 24, key: 'serial', align: 'right', maxChars: 3 },
          { label: 'Item / Label', width: 240, key: 'label', maxChars: 42 },
          { label: 'Qty', width: 44, key: 'quantity', align: 'right', maxChars: 6 },
          { label: 'Unit Cost', width: 94, value: (r) => formatCurrency(r.cost), align: 'right', maxChars: 12 },
          { label: 'Total', width: 99, value: (r) => formatCurrency(r.total), align: 'right', maxChars: 14 }
        ],
        rows: itemLines,
        rowHeight: 24,
        zebra: true
      });
    }

    const totalsRows = [
      { label: 'Total Mass', value: formatMass(totalMass) },
      { label: 'Print Cost (Files Total)', value: formatCurrency(fileCostTotal) },
      { label: 'Additional Cost', value: formatCurrency(additionalCost) }
    ];
    if (lineItems.length > 0) {
      totalsRows.push({ label: 'Additional Items Total', value: formatCurrency(lineItemsTotal) });
    }
    totalsRows.push({ label: 'Total Cost', value: formatCurrency(totalCost), bold: true });

    drawTotalsBlock(doc, totalsRows);
  } else {
    // Other services (using label system)
    const hasLineItems = lineItems && lineItems.length > 0;
    
    if (hasLineItems) {
      totalCost = lineItems.reduce((sum, li) => sum + (li.quantity * li.cost), 0);
      
      sectionTitle(doc, 'Cost Breakdown');
      const lines = lineItems.map((li, idx) => ({
        serial: idx + 1,
        label: li.label,
        quantity: li.quantity,
        cost: li.cost,
        total: li.quantity * li.cost
      }));

      drawTable(doc, {
        columns: [
          { label: '#', width: 24, key: 'serial', align: 'right', maxChars: 3 },
          { label: 'Item / Label', width: 240, key: 'label', maxChars: 42 },
          { label: 'Qty', width: 44, key: 'quantity', align: 'right', maxChars: 6 },
          { label: 'Unit Cost', width: 94, value: (r) => formatCurrency(r.cost), align: 'right', maxChars: 12 },
          { label: 'Total', width: 99, value: (r) => formatCurrency(r.total), align: 'right', maxChars: 14 }
        ],
        rows: lines,
        rowHeight: 24,
        zebra: true
      });

      drawTotalsBlock(doc, [
        { label: 'Total Cost', value: formatCurrency(totalCost), bold: true }
      ]);
    } else {
      totalCost = additionalCost;
      drawTotalsBlock(doc, [
        { label: 'Service Cost', value: formatCurrency(additionalCost) },
        { label: 'Total Cost', value: formatCurrency(totalCost), bold: true }
      ]);
    }

    if (files.length > 0) {
      sectionTitle(doc, 'Attached Design Files');
      const fileLines = files.map((file, idx) => ({
        serial: idx + 1,
        fileName: file.originalName || 'Uploaded File'
      }));
      drawTable(doc, {
        columns: [
          { label: '#', width: 30, key: 'serial', align: 'right', maxChars: 3 },
          { label: 'File Name', width: 471, key: 'fileName', maxChars: 90 }
        ],
        rows: fileLines,
        rowHeight: 24,
        zebra: true
      });
    }
  }

  // Payment instructions block — stacked vertically and enlarged (was a
  // cramped two-column layout at 8pt; the two sections now sit one above
  // the other, each with a bigger bold header and larger body text).
  const PAY_PAD_X = 16;
  const PAY_PAD_TOP = 14;
  const PAY_PAD_BOTTOM = 14;
  const PAY_HEADER_SIZE = 12;
  const PAY_BODY_SIZE = 10.5;
  const PAY_HEADER_GAP = 8;   // space between a section header and its first line
  const PAY_LINE_GAP = 17;    // vertical spacing between body lines
  const PAY_DIVIDER_GAP = 10; // space above/below the divider between sections
  const PAY_MOBILE_LINES = 2; // Recipient, Number
  const PAY_BANK_LINES = 3;   // Account Name, Bank/Acct, Branch

  const boxHeight =
    PAY_PAD_TOP +
    PAY_HEADER_SIZE + PAY_HEADER_GAP + (PAY_MOBILE_LINES * PAY_LINE_GAP) +
    (PAY_DIVIDER_GAP * 2) +
    PAY_HEADER_SIZE + PAY_HEADER_GAP + (PAY_BANK_LINES * PAY_LINE_GAP) +
    PAY_PAD_BOTTOM;

  ensureSpace(doc, boxHeight + 20);
  doc.moveDown(1);
  const payY = doc.y;
  const { left, right } = pageBounds(doc);
  const payWidth = right - left;
  const textX = left + PAY_PAD_X;

  doc.save();
  doc.rect(left, payY, payWidth, boxHeight).fillColor('#f8fafc').fill(); // light slate background
  doc.rect(left, payY, payWidth, boxHeight).strokeColor(THEME.line).lineWidth(0.5).stroke();
  doc.restore();

  let curY = payY + PAY_PAD_TOP;

  // Section 1: Mobile Money
  doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(PAY_HEADER_SIZE)
     .text('PAY VIA MOBILE MONEY', textX, curY);
  curY += PAY_HEADER_SIZE + PAY_HEADER_GAP;

  doc.fillColor(THEME.ink).font('Helvetica').fontSize(PAY_BODY_SIZE)
     .text('Recipient: ', textX, curY, { continued: true })
     .font('Helvetica-Bold').text('TRIPLE DIMENSION FABRICATION WORKS');
  curY += PAY_LINE_GAP;

  doc.font('Helvetica').fontSize(PAY_BODY_SIZE)
     .text('Number: ', textX, curY, { continued: true })
     .font('Helvetica-Bold').text('059 892 6121');
  curY += PAY_LINE_GAP;

  // Divider between the two sections
  curY += PAY_DIVIDER_GAP;
  doc.moveTo(left + PAY_PAD_X, curY)
     .lineTo(right - PAY_PAD_X, curY)
     .strokeColor(THEME.line)
     .lineWidth(0.5)
     .stroke();
  curY += PAY_DIVIDER_GAP;

  // Section 2: Bank Transfer
  doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(PAY_HEADER_SIZE)
     .text('PAY VIA BANK TRANSFER', textX, curY);
  curY += PAY_HEADER_SIZE + PAY_HEADER_GAP;

  doc.fillColor(THEME.ink).font('Helvetica').fontSize(PAY_BODY_SIZE)
     .text('Account Name: ', textX, curY, { continued: true })
     .font('Helvetica-Bold').text('Triple Dimension Fabrication Works');
  curY += PAY_LINE_GAP;

  doc.font('Helvetica').fontSize(PAY_BODY_SIZE)
     .text('Bank / Acct: ', textX, curY, { continued: true })
     .font('Helvetica-Bold').text('UBA CEDI - 02015163803516');
  curY += PAY_LINE_GAP;

  doc.font('Helvetica').fontSize(PAY_BODY_SIZE)
     .text('Branch: ', textX, curY, { continued: true })
     .font('Helvetica-Bold').text('KNUST Branch');
  curY += PAY_LINE_GAP;

  doc.y = payY + boxHeight + 8;

  doc.fillColor(THEME.muted).font('Helvetica').fontSize(8)
    .text(is3DPrint
      ? 'Generated from 3D print file masses and configured print rate.'
      : 'Generated from fabrication record details.', { align: 'left' });

  doc.end();
}

function generateFabricationInvoicePdfBuffer(options) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks = [];
    // The existing renderer only needs this method to set browser headers.
    output.setHeader = () => {};
    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    try {
      generateFabricationInvoicePdf(output, options);
    } catch (err) {
      reject(err);
    }
  });
}

function generateFabricationReceiptPdf(res, options) {
  const { job, payment, generatedByName, download = false } = options;
  const filename = `receipt-fabrication-${job.id}-${payment.id}.pdf`;
  startPdfResponse(res, filename, download ? 'attachment' : 'inline');

  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  doc.pipe(res);
  const receiptNumber = `RCT-${payment.id}-${dayjs(payment.createdAt || payment.paidAt).format('YYYYMMDD')}`;
  const summary = calculatePaymentSummary(job);

  drawHeader(doc, {
    title: 'Payment Receipt',
    subtitle: `Receipt #${receiptNumber}`,
    rightMeta: [
      `Issued: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `Issued by: ${generatedByName}`
    ]
  });

  sectionTitle(doc, 'Payment Received');
  drawInfoList(doc, [
    { label: 'Job', value: job.name },
    { label: 'Job ID', value: String(job.id) },
    { label: 'Payment Date', value: dayjs(payment.paidAt).format('YYYY-MM-DD HH:mm') },
    { label: 'Amount Received', value: formatCurrency(payment.amount) },
    { label: 'Payment Method', value: payment.method },
    { label: 'Payment Reference', value: payment.reference || 'N/A' },
    { label: 'Notes', value: payment.notes || 'N/A' },
    { label: 'Received By', value: (payment.receivedBy && payment.receivedBy.name) || generatedByName }
  ]);

  sectionTitle(doc, 'Invoice Balance');
  const balanceRows = [
    { label: 'Invoice Total', value: formatCurrency(summary.invoiceTotal) },
    { label: 'Total Payments Received', value: formatCurrency(summary.paid) },
    { label: 'Balance Outstanding', value: formatCurrency(summary.outstanding), bold: summary.outstanding > 0 }
  ];
  if (summary.overpaid > 0) balanceRows.push({ label: 'Credit Balance', value: formatCurrency(summary.overpaid), bold: true });
  drawTotalsBlock(doc, balanceRows);

  doc.fillColor(THEME.muted).font('Helvetica').fontSize(8)
    .text('This receipt confirms payment received by TRIPLE DIMENSION. Keep it as proof of payment.');
  doc.end();
}

function generateFabricationReceiptPdfBuffer(options) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks = [];
    output.setHeader = () => {};
    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    try {
      generateFabricationReceiptPdf(output, options);
    } catch (err) {
      reject(err);
    }
  });
}

async function generateSubscriberCardPdf(res, options) {
  const { subscriber, qrPayload } = options;

  const filename = `subscriber-card-${subscriber.code}.pdf`;
  startPdfResponse(res, filename, 'inline');

  const doc = new PDFDocument({ margin: 36, size: 'A6' });
  doc.pipe(res);

  const { left, right, width } = pageBounds(doc);
  const startY = doc.y;
  const accent = (subscriber.subscriptionType && subscriber.subscriptionType.color)
    ? subscriber.subscriptionType.color
    : THEME.accent;

  doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(14)
    .text('Subscriber Card', left, startY, { width });
  doc.fillColor(THEME.muted).font('Helvetica').fontSize(9)
    .text('TRIPLE DIMENSION Workshop', left, startY + 16, { width });

  doc.save();
  doc.rect(left, startY + 32, width, 6).fill(accent);
  doc.restore();

  doc.y = startY + 48;
  doc.fillColor(THEME.ink).font('Helvetica-Bold').fontSize(13)
    .text(subscriber.name, left, doc.y, { width });
  doc.fillColor(THEME.muted).font('Helvetica').fontSize(9)
    .text(`ID: ${subscriber.code}`, left, doc.y + 18, { width });

  doc.y += 36;
  doc.fillColor(THEME.ink).font('Helvetica-Bold').fontSize(10)
    .text('Subscription', left, doc.y);
  doc.fillColor(THEME.ink).font('Helvetica').fontSize(10)
    .text((subscriber.subscriptionType && subscriber.subscriptionType.name) || '-', left, doc.y + 14, { width });

  doc.y += 34;
  doc.fillColor(THEME.muted).font('Helvetica').fontSize(8)
    .text(`Start: ${dayjs(subscriber.startDate).format('YYYY-MM-DD')}`, left, doc.y, { continued: true })
    .text(`   End: ${dayjs(subscriber.endDate).format('YYYY-MM-DD')}`);

  doc.fillColor(THEME.muted).font('Helvetica').fontSize(8)
    .text('Present this card at the workshop.', left, doc.y + 14, { width });

  if (qrPayload) {
    try {
      const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 110 });
      const base64 = qrDataUrl.split(',')[1];
      const qrBuffer = Buffer.from(base64, 'base64');
      const qrSize = 110;
      const qrX = right - qrSize;
      const qrY = doc.page.height - doc.page.margins.bottom - qrSize;
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    } catch (err) {
      console.warn('[Subscriber Card] Failed to render QR code:', err.message);
    }
  }

  doc.end();
}

module.exports = {
  generateFabricationSummaryPdf,
  generateFabricationInvoicePdf,
  generateFabricationInvoicePdfBuffer,
  generateFabricationReceiptPdf,
  generateFabricationReceiptPdfBuffer,
  generateSubscriberCardPdf
};
