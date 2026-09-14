const express = require('express');
const router = express.Router();
const dayjs = require('dayjs');
const { isLoggedIn } = require('../middleware/auth');

function periodWhere(query) {
  const p = (query.period || '30d').toString();
  if (p === 'all') return null;
  const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[p];
  if (days) {
    return { gte: dayjs().subtract(days, 'day').toDate() };
  }
  if (query.from && query.to) {
    return { gte: dayjs(query.from).startOf('day').toDate(), lte: dayjs(query.to).endOf('day').toDate() };
  }
  return { gte: dayjs().subtract(30, 'day').toDate() };
}

// Analytics dashboard
router.get('/', isLoggedIn, async (req, res) => {
  res.render('analytics/index');
});

// API: Time analytics
router.get('/api/time', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const dateWhere = periodWhere(req.query);
  const where = dateWhere ? { date: dateWhere } : {};

  const jobs = await prisma.fabrication.findMany({
    where: { ...where, status: 'COMPLETE' },
    select: { type: true, actualMinutes: true, authorId: true, author: { select: { name: true } } }
  });

  // Time and job counts by service type
  const byType = {};
  const byWorker = {};
  const jobCountsByType = {};
  for (const job of jobs) {
    const mins = job.actualMinutes || 0;
    byType[job.type] = (byType[job.type] || 0) + mins;
    const wname = job.author.name;
    byWorker[wname] = (byWorker[wname] || 0) + mins;
    jobCountsByType[job.type] = (jobCountsByType[job.type] || 0) + 1;
  }

  // Attendance hours by worker (all time or filtered)
  const attWhere = dateWhere ? { checkInAt: dateWhere } : {};
  const attendance = await prisma.attendanceRecord.findMany({
    where: { ...attWhere, checkOutAt: { not: null } },
    include: { user: { select: { name: true } } }
  });

  const attendanceByWorker = {};
  for (const rec of attendance) {
    const wname = rec.user.name;
    attendanceByWorker[wname] = (attendanceByWorker[wname] || 0) + (rec.durationMin || 0);
  }

  // Task efficiency
  const logWhere = dateWhere ? { date: dateWhere } : {};
  const tasks = await prisma.workTask.findMany({
    where: { status: 'DONE', dailyLog: logWhere },
    select: { estimatedMin: true, actualMin: true, dailyLog: { select: { user: { select: { name: true } } } } }
  });

  const taskEfficiency = {};
  for (const t of tasks) {
    if (t.estimatedMin && t.actualMin) {
      const wname = t.dailyLog.user.name;
      if (!taskEfficiency[wname]) taskEfficiency[wname] = { totalEst: 0, totalActual: 0, count: 0 };
      taskEfficiency[wname].totalEst += t.estimatedMin;
      taskEfficiency[wname].totalActual += t.actualMin;
      taskEfficiency[wname].count++;
    }
  }

  res.json({ byType, byWorker, attendanceByWorker, taskEfficiency, jobCountsByType, totalJobs: jobs.length });
});

// API: Money analytics
router.get('/api/money', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const dateWhere = periodWhere(req.query);
  const txWhere = dateWhere ? { date: dateWhere } : {};

  const transactions = await prisma.fundTransaction.findMany({ where: txWhere });
  const fundingRequests = await prisma.fundingRequest.findMany(
    dateWhere ? { where: { createdAt: dateWhere } } : {}
  );

  // Monthly deposits vs withdrawals (last 12 months always)
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const m = dayjs().subtract(i, 'month');
    months.push({ label: m.format('MMM YY'), start: m.startOf('month').toDate(), end: m.endOf('month').toDate() });
  }

  const allTx = await prisma.fundTransaction.findMany();
  const monthlyData = months.map(m => {
    const inRange = allTx.filter(t => new Date(t.date) >= m.start && new Date(t.date) <= m.end);
    const deposits = inRange.filter(t => t.type === 'DEPOSIT').reduce((s, t) => s + Number(t.amount || 0), 0);
    const withdrawals = inRange.filter(t => t.type === 'WITHDRAWAL').reduce((s, t) => s + Number(t.amount || 0), 0);
    return { label: m.label, deposits, withdrawals };
  });

  // Revenue by fabrication type (paid jobs with cost)
  const paidJobs = await prisma.fabrication.findMany({
    where: {
      ...(dateWhere ? { date: dateWhere } : {}),
      status: 'COMPLETE',
      OR: [{ cost: { gt: 0 } }, { costPerGram: { gt: 0 } }]
    },
    include: { files: true }
  });

  const revenueByType = {};
  for (const job of paidJobs) {
    let jobRevenue = Number(job.cost || 0);
    if (job.type === '3D_PRINTING' && job.costPerGram > 0) {
      const totalMass = (job.files || []).reduce((s, f) => s + Number(f.massGrams || 0), 0);
      jobRevenue += totalMass * job.costPerGram;
    }
    revenueByType[job.type] = (revenueByType[job.type] || 0) + jobRevenue;
  }

  // Funding request status breakdown
  const allRequests = await prisma.fundingRequest.findMany();
  const requestStatus = { PENDING: 0, APPROVED: 0, DECLINED: 0 };
  for (const r of allRequests) requestStatus[r.status] = (requestStatus[r.status] || 0) + 1;

  res.json({ monthlyData, revenueByType, requestStatus, transactions: transactions.slice(0, 50) });
});

// API: Filament analytics
router.get('/api/filament', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const dateWhere = periodWhere(req.query);

  const prints = await prisma.fabrication.findMany({
    where: {
      type: '3D_PRINTING',
      ...(dateWhere ? { date: dateWhere } : {})
    },
    include: { files: true },
    orderBy: { date: 'desc' }
  });

  let totalGrams = 0, paidGrams = 0, inhouseGrams = 0;
  const byJob = [];

  for (const p of prints) {
    const mass = (p.files || []).reduce((s, f) => s + Number(f.massGrams || 0), 0);
    totalGrams += mass;
    if (p.printCategory === 'PAID') paidGrams += mass;
    else if (p.printCategory === 'IN_HOUSE') inhouseGrams += mass;
    byJob.push({ name: p.name, massGrams: mass, date: p.date, category: p.printCategory || 'UNKNOWN' });
  }

  // Sort by heaviest
  byJob.sort((a, b) => b.massGrams - a.massGrams);

  // Weekly usage (last 12 weeks)
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const wStart = dayjs().subtract(i, 'week').startOf('week');
    const wEnd = wStart.endOf('week');
    const weekPrints = prints.filter(p => {
      const d = new Date(p.date);
      return d >= wStart.toDate() && d <= wEnd.toDate();
    });
    const weekMass = weekPrints.reduce((s, p) => {
      return s + (p.files || []).reduce((ss, f) => ss + Number(f.massGrams || 0), 0);
    }, 0);
    weeks.push({ label: wStart.format('MMM D'), massGrams: weekMass });
  }

  const inHouseProjects = {};
  for (const p of prints) {
    if (p.printCategory === 'IN_HOUSE') {
      const proj = p.projectName || 'Unassigned';
      const mass = (p.files || []).reduce((s, f) => s + Number(f.massGrams || 0), 0);
      inHouseProjects[proj] = (inHouseProjects[proj] || 0) + mass;
    }
  }

  res.json({
    summary: { totalGrams, paidGrams, inhouseGrams, jobCount: prints.length },
    byJob: byJob.slice(0, 10),
    categoryBreakdown: { PAID: paidGrams, IN_HOUSE: inhouseGrams },
    weeklyUsage: weeks,
    inHouseProjects
  });
});

module.exports = router;
