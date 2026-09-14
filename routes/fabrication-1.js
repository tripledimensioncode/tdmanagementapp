const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const upload = require('../utils/upload');
const dayjs = require('dayjs');
const { generateFabricationSummaryPdf, generateFabricationInvoicePdf, generateFabricationReceiptPdf } = require('../utils/pdf');
const { calculatePaymentSummary } = require('../utils/billing');
const { persistUpload, removeUploadedFile } = require('../utils/storage');

let cachedServices = [];

router.use(async (req, res, next) => {
  const prisma = req.app.locals.prisma;
  try {
    const services = await prisma.service.findMany({ orderBy: { label: 'asc' } });
    cachedServices = services;
    res.locals.services = services;
    res.locals.FABRICATION_TYPES = services.map(s => ({ value: s.value, label: s.label }));
    res.locals.VALID_TYPES = services.map(s => s.value);
    res.locals.typeLabel = (val) => {
      const s = services.find(x => x.value === val);
      return s ? s.label : val;
    };
    next();
  } catch (err) {
    next(err);
  }
});

function getValidTypes() {
  return cachedServices.map(s => s.value);
}

const fabricationUpload = upload.fields([
  { name: 'files', maxCount: 10 },
  { name: 'file', maxCount: 1 }
]);

function getSystemDefaultPrintRate() {
  const parsed = Number(process.env.PRINT_COST_PER_GRAM);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 0.15;
}

function toDateOrNull(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function parseMassInputs(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return [raw];
  return [];
}

function parseStringArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') return [val];
  return [];
}

function parseNumberArray(val) {
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === 'string' && val.trim() !== '') return [Number(val)];
  return [];
}


function wantsPdfDownload(query) {
  const value = (query.download || '').toString().trim().toLowerCase();
  return value === '1' || value === 'true';
}

function typeLabel(typeValue) {
  const found = cachedServices.find(t => t.value === typeValue);
  return found ? found.label : typeValue;
}



// List fabrication entries — with filtering
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { status, type, dateFrom, dateTo, quick } = req.query;

  // Build Prisma where clause
  const where = {};
  if (status && ['ACTIVE', 'COMPLETE'].includes(status)) where.status = status;
  if (type && getValidTypes().includes(type)) where.type = type;

  // Quick preset date ranges
  let resolvedFrom = dateFrom;
  let resolvedTo   = dateTo;
  if (quick === 'today') {
    resolvedFrom = dayjs().startOf('day').format('YYYY-MM-DD');
    resolvedTo   = dayjs().endOf('day').format('YYYY-MM-DD');
  } else if (quick === 'week') {
    resolvedFrom = dayjs().startOf('week').format('YYYY-MM-DD');
    resolvedTo   = dayjs().endOf('week').format('YYYY-MM-DD');
  } else if (quick === 'month') {
    resolvedFrom = dayjs().startOf('month').format('YYYY-MM-DD');
    resolvedTo   = dayjs().endOf('month').format('YYYY-MM-DD');
  } else if (quick === 'last30') {
    resolvedFrom = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    resolvedTo   = dayjs().format('YYYY-MM-DD');
  }

  if (resolvedFrom || resolvedTo) {
    where.date = {};
    if (resolvedFrom) where.date.gte = dayjs(resolvedFrom).startOf('day').toDate();
    if (resolvedTo)   where.date.lte = dayjs(resolvedTo).endOf('day').toDate();
  }

  const items = await prisma.fabrication.findMany({
    where,
    orderBy: { date: 'desc' },
    include: { author: true, files: true }
  });

  res.render('fabrication/index', {
    items,
    FABRICATION_TYPES: res.locals.FABRICATION_TYPES,
    typeLabel,
    filters: { status: status || '', type: type || '', dateFrom: resolvedFrom || '', dateTo: resolvedTo || '', quick: quick || '' }
  });
});

// Export fabrication data as CSV or Excel
router.get('/export', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { status, type, dateFrom, dateTo, format } = req.query;
  const fmt = (format || 'csv').toLowerCase();

  const where = {};
  if (status && ['ACTIVE', 'COMPLETE'].includes(status)) where.status = status;
  if (type && getValidTypes().includes(type)) where.type = type;
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = dayjs(dateFrom).startOf('day').toDate();
    if (dateTo)   where.date.lte = dayjs(dateTo).endOf('day').toDate();
  }

  const items = await prisma.fabrication.findMany({
    where,
    orderBy: { date: 'desc' },
    include: { author: true, files: true }
  });

  // Build rows
  const rows = items.map(item => {
    const totalMass = (item.files || []).reduce((s, f) => s + Number(f.massGrams || 0), 0);
    const rate = Number(item.costPerGram || 0);
    const addCost = Number(item.cost || 0);
    const calcCost = item.type === '3D_PRINTING' && rate > 0
      ? ((totalMass * rate) + addCost).toFixed(2)
      : addCost > 0 ? addCost.toFixed(2) : '';
    return {
      ID: item.id,
      Status: item.status,
      Type: typeLabel(item.type),
      Name: item.name,
      Date: item.date ? item.date.toISOString().split('T')[0] : '',
      PrintCategory: item.printCategory || '',
      EstimatedMinutes: item.estimatedMinutes || '',
      ActualMinutes: item.actualMinutes || '',
      TotalMassGrams: totalMass > 0 ? totalMass.toFixed(2) : '',
      CostPerGram: rate > 0 ? rate : '',
      TotalCost: calcCost,
      Worker: item.author.name,
      Description: item.description || '',
      StartedAt: item.startedAt ? item.startedAt.toISOString() : '',
      CompletedAt: item.completedAt ? item.completedAt.toISOString() : ''
    };
  });

  const timestamp = dayjs().format('YYYY-MM-DD');
  const filenameBase = `fabrication_export_${timestamp}`;

  if (fmt === 'xlsx') {
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Fabrication Jobs');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    } catch (err) {
      console.error('[XLSX export error]:', err.message);
      return res.status(500).send('Excel export failed. Make sure the xlsx package is installed.');
    }
  }

  // Default: CSV
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\r\n');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send('\uFEFF' + csv); // BOM for Excel compatibility
});


// New fabrication form
router.get('/new', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.user.id },
      select: { printCostPerGram: true }
    });
    const storedRate = Number(user && user.printCostPerGram);
    const preferredRate = Number.isFinite(storedRate) && storedRate > 0 ? storedRate : getSystemDefaultPrintRate();
    res.render('fabrication/form', { item: null, costPerGram: preferredRate, FABRICATION_TYPES: res.locals.FABRICATION_TYPES });
  } catch (err) {
    console.error('[GET /fabrication/new Error]:', err);
    res.render('fabrication/form', { item: null, costPerGram: getSystemDefaultPrintRate(), FABRICATION_TYPES: res.locals.FABRICATION_TYPES });
  }
});

// Create fabrication entry
router.post('/new', isLoggedIn, (req, res, next) => {
  fabricationUpload(req, res, (err) => {
    if (err) {
      req.session.flash = { error: `Upload failed: ${err.message}` };
      return res.redirect('/fabrication/new');
    }
    next();
  });
}, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { type, name, date, description, cost, costPerGram, printCategory, projectName, estimatedMinutes } = req.body;
  const uploadedFiles = []
    .concat((req.files && req.files.files) || [])
    .concat((req.files && req.files.file) || []);
  const fileMassInputs = parseMassInputs(req.body.fileMasses);
  const is3DPrint = type === '3D_PRINTING';

  if (!type || !getValidTypes().includes(type)) {
    req.session.flash = { error: 'Please select a valid fabrication type.' };
    return res.redirect('/fabrication/new');
  }

  if (!name || !name.trim()) {
    req.session.flash = { error: 'Job name is required.' };
    return res.redirect('/fabrication/new');
  }

  if (!['IN_HOUSE', 'PAID'].includes(printCategory)) {
    req.session.flash = { error: 'Please select a category (In-House or Paid) for this job.' };
    return res.redirect('/fabrication/new');
  }

  if (printCategory === 'IN_HOUSE') {
    if (!projectName || !projectName.trim()) {
      req.session.flash = { error: 'Project name is required for In-House jobs.' };
      return res.redirect('/fabrication/new');
    }
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.user.id },
      select: { printCostPerGram: true }
    });
    const userStoredRate = Number(user && user.printCostPerGram);
    const defaultUserRate = Number.isFinite(userStoredRate) && userStoredRate > 0
      ? userStoredRate
      : getSystemDefaultPrintRate();

    let selectedRate = null;
    if (is3DPrint) {
      const parsedRate = Number(costPerGram);
      selectedRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : defaultUserRate;
    }

    const persistedFiles = await Promise.all(uploadedFiles.map((file) => persistUpload(file, 'fabrication')));
    const filesData = uploadedFiles.map((file, idx) => {
      const massValue = fileMassInputs[idx];
      const parsedMass = massValue != null && massValue !== '' ? Number(massValue) : null;
      return {
        path: persistedFiles[idx].path,
        originalName: file.originalname,
        massGrams: Number.isFinite(parsedMass) ? parsedMass : null,
        _multerFile: file
      };
    });

    let lineItemsData = [];
    let finalCost = undefined;

    // Parse line items for all services (including 3D Printing)
    const itemLabels = parseStringArray(req.body.itemLabels);
    const itemQuantities = parseNumberArray(req.body.itemQuantities);
    const itemCosts = parseNumberArray(req.body.itemCosts);

    let sumCost = 0;
    for (let i = 0; i < itemLabels.length; i++) {
      const label = itemLabels[i] ? itemLabels[i].trim() : '';
      if (label) {
        const qty = Number.isFinite(itemQuantities[i]) && itemQuantities[i] > 0 ? itemQuantities[i] : 1;
        const ucost = Number.isFinite(itemCosts[i]) && itemCosts[i] >= 0 ? itemCosts[i] : 0.0;
        sumCost += qty * ucost;
        lineItemsData.push({ label, quantity: qty, cost: ucost });
      }
    }

    if (is3DPrint) {
      if (filesData.length > 0) {
        for (const fileRecord of filesData) {
          if (!(Number.isFinite(fileRecord.massGrams) && fileRecord.massGrams > 0)) {
            req.session.flash = { error: 'Each 3D print file mass must be a number greater than zero.' };
            return res.redirect('/fabrication/new');
          }
        }
      }
      finalCost = cost ? parseFloat(cost) : undefined;
    } else {
      finalCost = sumCost;
    }

    const estMin = parseInt(estimatedMinutes, 10);

    const created = await prisma.fabrication.create({
      data: {
        type,
        name: name.trim(),
        date: date ? new Date(date) : new Date(),
        description: description ? description.trim() : undefined,
        cost: finalCost,
        costPerGram: selectedRate,
        filePath: filesData.length ? filesData[0].path : null,
        status: 'ACTIVE',
        startedAt: new Date(),
        estimatedMinutes: Number.isFinite(estMin) && estMin > 0 ? estMin : null,
        printCategory: printCategory,
        projectName: printCategory === 'IN_HOUSE' ? projectName.trim() : null,
        authorId: req.session.user.id,
        files: filesData.length ? {
          create: filesData.map(f => ({
            path: f.path,
            originalName: f.originalName,
            massGrams: f.massGrams
          }))
        } : undefined,
        lineItems: lineItemsData.length ? {
          create: lineItemsData
        } : undefined
      },
      include: { files: true, lineItems: true }
    });



    if (is3DPrint && selectedRate != null) {
      await prisma.user.update({
        where: { id: req.session.user.id },
        data: { printCostPerGram: selectedRate }
      });
      req.session.user.printCostPerGram = selectedRate;
    }

    req.session.flash = { success: 'Fabrication job recorded as ACTIVE.' };
    res.redirect(`/fabrication/${created.id}`);
  } catch (err) {
    console.error('[POST /fabrication/new Error]:', err);
    req.session.flash = { error: 'Failed to save entry.' };
    res.redirect('/fabrication/new');
  }
});

// Mark job complete
router.post('/:id/complete', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const item = await prisma.fabrication.findUnique({ where: { id } });
  if (!item) return res.status(404).send('Not found');
  if (item.status === 'COMPLETE') {
    req.session.flash = { error: 'Job is already marked complete.' };
    return res.redirect(`/fabrication/${id}`);
  }

  const now = new Date();
  const refTime = item.startedAt || item.date;
  const actualMinutes = refTime ? Math.round((now - new Date(refTime)) / 60000) : null;

  await prisma.fabrication.update({
    where: { id },
    data: { status: 'COMPLETE', completedAt: now, actualMinutes }
  });

  req.session.flash = { success: `Job "${item.name}" marked complete. Duration: ${actualMinutes != null ? actualMinutes + ' min' : 'unknown'}.` };
  res.redirect(`/fabrication/${id}`);
});

// Download summary report PDF (day/month/range/all)
router.get('/summary/pdf', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const period = (req.query.period || 'day').toString();
  const where = {};
  let periodLabel = 'All Entries';

  if (period === 'day') {
    const selected = (req.query.date || dayjs().format('YYYY-MM-DD')).toString();
    const base = toDateOrNull(selected);
    if (!base) { req.session.flash = { error: 'Invalid day.' }; return res.redirect('/fabrication'); }
    where.date = { gte: base.startOf('day').toDate(), lt: base.add(1, 'day').startOf('day').toDate() };
    periodLabel = `Day: ${base.format('YYYY-MM-DD')}`;
  } else if (period === 'month') {
    const selected = (req.query.month || dayjs().format('YYYY-MM')).toString();
    const base = toDateOrNull(`${selected}-01`);
    if (!base) { req.session.flash = { error: 'Invalid month.' }; return res.redirect('/fabrication'); }
    where.date = { gte: base.startOf('month').toDate(), lt: base.add(1, 'month').startOf('month').toDate() };
    periodLabel = `Month: ${base.format('MMMM YYYY')}`;
  } else if (period === 'range') {
    const s = toDateOrNull(req.query.start || ''); const e = toDateOrNull(req.query.end || '');
    if (!s || !e) { req.session.flash = { error: 'Invalid date range.' }; return res.redirect('/fabrication'); }
    where.date = { gte: s.startOf('day').toDate(), lte: e.endOf('day').toDate() };
    periodLabel = `Range: ${s.format('YYYY-MM-DD')} to ${e.format('YYYY-MM-DD')}`;
  } else if (period === 'all') {
    periodLabel = 'All Time';
  }

  const entries = await prisma.fabrication.findMany({
    where,
    orderBy: { date: 'desc' },
    include: { author: true, files: true }
  });

  // Add type labels to entries for PDF
  const labelledEntries = entries.map(e => ({ ...e, typeLabel: typeLabel(e.type) }));

  return generateFabricationSummaryPdf(res, {
    periodLabel,
    entries: labelledEntries,
    generatedByName: req.session.user.name,
    download: wantsPdfDownload(req.query)
  });
});

// Invoice PDF
router.get('/:id/invoice.pdf', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const item = await prisma.fabrication.findUnique({ where: { id }, include: { author: true, files: true, lineItems: true } });
  if (!item) return res.status(404).send('Not found');

  const is3DPrint = item.type === '3D_PRINTING';
  const hasMissingMass = is3DPrint && (item.files || []).some(f => !Number.isFinite(Number(f.massGrams)) || Number(f.massGrams) <= 0);
  if (is3DPrint && hasMissingMass) {
    req.session.flash = { error: 'Missing mass values on some files. Update before generating invoice.' };
    return res.redirect(`/fabrication/${id}`);
  }

  const ratePerGram = is3DPrint ? Number(item.costPerGram || getSystemDefaultPrintRate()) : null;
  return generateFabricationInvoicePdf(res, {
    entry: { ...item, typeLabel: typeLabel(item.type) },
    ratePerGram,
    generatedByName: req.session.user.name,
    download: wantsPdfDownload(req.query)
  });
});

// Record a customer payment. Payments are intentionally separate records so
// instalments and their individual receipts remain auditable.
router.post('/:id/payments', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const amount = Number(req.body.amount);
  const method = (req.body.method || '').toString().trim();
  const reference = (req.body.reference || '').toString().trim() || null;
  const notes = (req.body.notes || '').toString().trim() || null;

  if (!Number.isFinite(amount) || amount <= 0 || !method) {
    req.session.flash = { error: 'Enter a payment amount greater than zero and a payment method.' };
    return res.redirect(`/fabrication/${id}`);
  }

  const job = await prisma.fabrication.findUnique({ where: { id }, include: { payments: true, files: true, lineItems: true } });
  if (!job) return res.status(404).send('Not found');
  const summary = calculatePaymentSummary(job);
  if (amount > summary.outstanding + 0.005) {
    req.session.flash = { error: `Payment exceeds the outstanding balance of GHS ${summary.outstanding.toFixed(2)}.` };
    return res.redirect(`/fabrication/${id}`);
  }

  const payment = await prisma.fabricationPayment.create({
    data: { fabricationId: id, amount, method, reference, notes, receivedById: req.session.user.id }
  });
  req.session.flash = { success: `Payment of GHS ${amount.toFixed(2)} recorded. Receipt #${payment.id} is ready.` };
  res.redirect(`/fabrication/${id}`);
});

// Receipt PDF for one specific payment against a job.
router.get('/:id/receipts/:paymentId.pdf', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const paymentId = parseInt(req.params.paymentId, 10);
  const job = await prisma.fabrication.findUnique({
    where: { id },
    include: { files: true, lineItems: true, payments: true }
  });
  const payment = await prisma.fabricationPayment.findFirst({
    where: { id: paymentId, fabricationId: id },
    include: { receivedBy: true }
  });
  if (!job || !payment) return res.status(404).send('Not found');
  return generateFabricationReceiptPdf(res, {
    job,
    payment,
    generatedByName: req.session.user.name,
    download: wantsPdfDownload(req.query)
  });
});

// NOTE: service management (add/edit/delete) now lives in its own
// standalone router at routes/services.js, mounted at /services in app.js —
// not nested here under /fabrication. It used to live at
// GET/POST /fabrication/services, but that path was being silently
// swallowed by the GET /:id route below (a wildcard that matches any single
// path segment, including the literal word "services"), which caused every
// request to it to hang until the platform's function timeout killed it.
// Moving it to its own top-level path with no wildcard siblings removes
// that whole class of bug rather than just reordering around it.

// Show single fabrication
router.get('/:id', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(404).send('Not found');
  }
  const item = await prisma.fabrication.findUnique({
    where: { id },
    include: {
      author: true,
      files: true,
      lineItems: true,
      payments: { include: { receivedBy: { select: { name: true } } }, orderBy: { paidAt: 'desc' } }
    }
  });
  if (!item) return res.status(404).send('Not found');

  let invoice = null;

  if (item.type === '3D_PRINTING') {
    const ratePerGram = Number(item.costPerGram || getSystemDefaultPrintRate());
    const totalMass = (item.files || []).reduce((sum, f) => sum + Number(f.massGrams || 0), 0);
    const fileCostTotal = totalMass * ratePerGram;
    const additionalCharges = Number(item.cost || 0);
    const lineItems = item.lineItems || [];
    const lineItemsTotal = lineItems.reduce((sum, li) => sum + (li.quantity * li.cost), 0);
    invoice = {
      type: item.type,
      typeLabel: typeLabel(item.type),
      ratePerGram,
      totalMass,
      fileCostTotal,
      additionalCharges,
      lineItemsTotal,
      totalCost: fileCostTotal + additionalCharges + lineItemsTotal
    };
  } else {
    const lineItems = item.lineItems || [];
    const hasLineItems = lineItems.length > 0;
    const totalCost = hasLineItems
      ? lineItems.reduce((sum, li) => sum + (li.quantity * li.cost), 0)
      : Number(item.cost || 0);
    invoice = {
      type: item.type,
      typeLabel: typeLabel(item.type),
      additionalCharges: Number(item.cost || 0),
      totalCost
    };
  }

  const paymentSummary = calculatePaymentSummary(item);
  res.render('fabrication/show', { item, invoice, paymentSummary, typeLabel });
});

// Admin only: delete fabrication
router.post('/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  try {
    const item = await prisma.fabrication.findUnique({
      where: { id },
      include: { files: true }
    });
    if (!item) {
      req.session.flash = { error: 'Fabrication record not found.' };
      return res.redirect('/fabrication');
    }
    await prisma.fabrication.delete({ where: { id } });
    // Clean up the attached files' storage (Blob objects or local dev files)
    // after the DB rows are gone — best-effort, never blocks the delete.
    await Promise.all((item.files || []).map((f) => removeUploadedFile(f.path)));
    req.session.flash = { success: `Fabrication record "${item.name}" deleted successfully.` };
    res.redirect('/fabrication');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to delete fabrication record.' };
    res.redirect(`/fabrication/${id}`);
  }
});

module.exports = router;
