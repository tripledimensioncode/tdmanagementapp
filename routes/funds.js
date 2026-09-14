const express = require('express');
const dayjs = require('dayjs');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');

function toDateOrNull(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function calculateSummary(transactions, fundingRequests) {
  const totalDeposits = transactions
    .filter((item) => item.type === 'DEPOSIT')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalWithdrawals = transactions
    .filter((item) => item.type === 'WITHDRAWAL')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const netBalance = totalDeposits - totalWithdrawals;
  const pendingFunding = fundingRequests.filter((item) => item.status === 'PENDING');
  const pendingAmount = pendingFunding.reduce((sum, item) => sum + Number(item.requestedAmount || 0), 0);

  return {
    totalDeposits,
    totalWithdrawals,
    netBalance,
    pendingFundingCount: pendingFunding.length,
    pendingAmount
  };
}

// Funds dashboard (with filtering)
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { q, type, from, to } = req.query;

  // 1. Fetch overall data for the summary stats (independent of filters)
  const [allTransactions, fundingRequests] = await Promise.all([
    prisma.fundTransaction.findMany({ include: { createdBy: true } }),
    prisma.fundingRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { requestedBy: true, reviewedBy: true }
    })
  ]);
  const summary = calculateSummary(allTransactions, fundingRequests);

  // 2. Build where filter for list display
  const transactionWhere = {};
  if (type === 'DEPOSIT' || type === 'WITHDRAWAL') {
    transactionWhere.type = type;
  }
  if (q && q.trim()) {
    transactionWhere.OR = [
      { title: { contains: q.trim() } },
      { description: { contains: q.trim() } },
      { reference: { contains: q.trim() } }
    ];
  }
  if (from || to) {
    transactionWhere.date = {};
    if (from) transactionWhere.date.gte = dayjs(from).startOf('day').toDate();
    if (to)   transactionWhere.date.lte = dayjs(to).endOf('day').toDate();
  }

  // 3. Fetch filtered list of transactions
  const transactions = await prisma.fundTransaction.findMany({
    where: transactionWhere,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { createdBy: true }
  });

  res.render('funds/index', {
    transactions,
    fundingRequests,
    summary,
    today: dayjs().format('YYYY-MM-DD'),
    currentMonth: dayjs().format('YYYY-MM'),
    isAdminUser: req.session.user.role === 'ADMIN',
    filters: {
      q: q || '',
      type: type || '',
      from: from || '',
      to: to || ''
    }
  });
});

// Transaction form
router.get('/transactions/new', isLoggedIn, (req, res) => {
  const rawType = (req.query.type || 'DEPOSIT').toString().toUpperCase();
  const type = rawType === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT';
  res.render('funds/transaction-form', {
    type,
    today: dayjs().format('YYYY-MM-DD')
  });
});

// Create transaction
router.post('/transactions/new', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { type, amount, title, description, reference, date } = req.body;
  const normalizedType = (type || '').toString().toUpperCase();
  if (!['DEPOSIT', 'WITHDRAWAL'].includes(normalizedType)) {
    req.session.flash = { error: 'Invalid transaction type.' };
    return res.redirect('/funds');
  }

  const parsedAmount = Number(amount);
  if (!(Number.isFinite(parsedAmount) && parsedAmount > 0)) {
    req.session.flash = { error: 'Amount must be greater than zero.' };
    return res.redirect(`/funds/transactions/new?type=${normalizedType}`);
  }

  if (!title || !title.trim()) {
    req.session.flash = { error: 'Title is required.' };
    return res.redirect(`/funds/transactions/new?type=${normalizedType}`);
  }

  const selectedDate = toDateOrNull(date);
  if (!selectedDate) {
    req.session.flash = { error: 'Please provide a valid transaction date.' };
    return res.redirect(`/funds/transactions/new?type=${normalizedType}`);
  }

  try {
    await prisma.fundTransaction.create({
      data: {
        type: normalizedType,
        amount: parsedAmount,
        title: title.trim(),
        description: description ? description.trim() : null,
        reference: reference ? reference.trim() : null,
        date: selectedDate.toDate(),
        createdById: req.session.user.id
      }
    });
    req.session.flash = { success: `${normalizedType === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} recorded.` };
    return res.redirect('/funds');
  } catch (err) {
    console.error('[POST /funds/transactions/new Error]:', err);
    req.session.flash = { error: 'Failed to record transaction.' };
    return res.redirect(`/funds/transactions/new?type=${normalizedType}`);
  }
});

// Funding request form
router.get('/requests/new', isLoggedIn, (req, res) => {
  res.render('funds/request-form');
});

// Create funding request
router.post('/requests/new', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { title, requestedAmount, purpose, details } = req.body;
  const parsedAmount = Number(requestedAmount);

  if (!title || !title.trim() || !purpose || !purpose.trim()) {
    req.session.flash = { error: 'Title and purpose are required.' };
    return res.redirect('/funds/requests/new');
  }

  if (!(Number.isFinite(parsedAmount) && parsedAmount > 0)) {
    req.session.flash = { error: 'Requested amount must be greater than zero.' };
    return res.redirect('/funds/requests/new');
  }

  try {
    await prisma.fundingRequest.create({
      data: {
        title: title.trim(),
        requestedAmount: parsedAmount,
        purpose: purpose.trim(),
        details: details ? details.trim() : null,
        requestedById: req.session.user.id
      }
    });
    req.session.flash = { success: 'Funding request submitted for admin review.' };
    return res.redirect('/funds');
  } catch (err) {
    console.error('[POST /funds/requests/new Error]:', err);
    req.session.flash = { error: 'Failed to submit funding request.' };
    return res.redirect('/funds/requests/new');
  }
});

// Admin review funding request
router.post('/requests/:id/review', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    req.session.flash = { error: 'Invalid request id.' };
    return res.redirect('/funds');
  }
  const decision = (req.body.decision || '').toString().toUpperCase();
  const adminComment = req.body.adminComment ? req.body.adminComment.toString().trim() : null;

  if (!['APPROVED', 'DECLINED'].includes(decision)) {
    req.session.flash = { error: 'Invalid decision.' };
    return res.redirect('/funds');
  }

  const requestItem = await prisma.fundingRequest.findUnique({ where: { id } });
  if (!requestItem) {
    req.session.flash = { error: 'Funding request not found.' };
    return res.redirect('/funds');
  }

  if (requestItem.status !== 'PENDING') {
    req.session.flash = { error: 'This request has already been reviewed.' };
    return res.redirect('/funds');
  }

  try {
    await prisma.fundingRequest.update({
      where: { id },
      data: {
        status: decision,
        adminComment,
        reviewedById: req.session.user.id,
        reviewedAt: new Date()
      }
    });
    req.session.flash = { success: `Funding request ${decision.toLowerCase()}.` };
    return res.redirect('/funds');
  } catch (err) {
    console.error('[POST /funds/requests/:id/review Error]:', err);
    req.session.flash = { error: 'Failed to review request.' };
    return res.redirect('/funds');
  }
});

// Cashbook Data Export (CSV or Excel)
router.get('/export', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { q, type, from, to, format } = req.query;
  const fmt = (format || 'csv').toLowerCase();

  const transactionWhere = {};
  if (type === 'DEPOSIT' || type === 'WITHDRAWAL') {
    transactionWhere.type = type;
  }
  if (q && q.trim()) {
    transactionWhere.OR = [
      { title: { contains: q.trim() } },
      { description: { contains: q.trim() } },
      { reference: { contains: q.trim() } }
    ];
  }
  if (from || to) {
    transactionWhere.date = {};
    if (from) transactionWhere.date.gte = dayjs(from).startOf('day').toDate();
    if (to)   transactionWhere.date.lte = dayjs(to).endOf('day').toDate();
  }

  const transactions = await prisma.fundTransaction.findMany({
    where: transactionWhere,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { createdBy: true }
  });

  const rows = transactions.map(item => ({
    ID: item.id,
    Date: item.date ? item.date.toISOString().split('T')[0] : '',
    Type: item.type,
    Title: item.title,
    Description: item.description || '',
    Reference: item.reference || '',
    Amount: Number(item.amount).toFixed(2),
    RecordedBy: item.createdBy ? item.createdBy.name : 'Unknown',
    CreatedAt: item.createdAt ? item.createdAt.toISOString() : ''
  }));

  const timestamp = dayjs().format('YYYY-MM-DD');
  const filenameBase = `cashbook_export_${timestamp}`;

  if (fmt === 'xlsx') {
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Cashbook');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    } catch (err) {
      console.error('[XLSX export error]:', err.message);
      return res.status(500).send('Excel export failed.');
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
  res.send('\uFEFF' + csv);
});

module.exports = router;
