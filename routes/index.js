const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');
const dayjs = require('dayjs');

// Dashboard / Home
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = req.session.user;
  const isAdmin = user.role === 'ADMIN';
  const today = dayjs().startOf('day').toDate();
  const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();
  const weekAgo = dayjs().subtract(7, 'day').startOf('day').toDate();
  const monthStart = dayjs().startOf('month').toDate();
  const in14Days = dayjs().add(14, 'day').toDate();

  // ── Personal: attendance + daily log ──────────────────────────────────────
  const [todayAttendance, todayLog, recentAttendance] = await Promise.all([
    prisma.attendanceRecord.findFirst({
      where: { userId: user.id, checkInAt: { gte: today, lt: tomorrow }, checkOutAt: null },
      orderBy: { checkInAt: 'desc' }
    }),
    prisma.dailyLog.findFirst({
      where: { userId: user.id, date: { gte: today, lt: tomorrow } },
      include: { tasks: { orderBy: { createdAt: 'asc' } } }
    }),
    // Last 7 sessions for the Attendance dashboard card
    prisma.attendanceRecord.findMany({
      where: { userId: user.id },
      orderBy: { checkInAt: 'desc' },
      take: 7
    })
  ]);


  // ── Active jobs (everyone sees these) ────────────────────────────────────
  const activeJobs = await prisma.fabrication.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    include: { author: true }
  });

  // ── Potential customers (pending jobs) ──────────────────────────────────
  const potentialCustomers = await prisma.customer.findMany({
    where: { isPotential: true },
    orderBy: { name: 'asc' },
    include: { attendedBy: { select: { id: true, name: true } } }
  });

  // ── Workers currently checked in ─────────────────────────────────────────
  const checkedInWorkers = await prisma.attendanceRecord.findMany({
    where: { checkInAt: { gte: today, lt: tomorrow }, checkOutAt: null },
    include: { user: { select: { id: true, name: true } } }
  });

  // ── Subscriber summary ───────────────────────────────────────────────────
  const [subscriberActiveCount, subscriberExpiringCount, recentSubscribers] = await Promise.all([
    prisma.subscriber.count({ where: { status: 'ACTIVE' } }),
    prisma.subscriber.count({ where: { status: 'ACTIVE', endDate: { lte: in14Days } } }),
    prisma.subscriber.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { subscriptionType: { select: { name: true, color: true } } }
    })
  ]);

  // ── Recent completed fabrications ────────────────────────────────────────
  const recentFabrication = await prisma.fabrication.findMany({
    where: { status: 'COMPLETE' },
    orderBy: { completedAt: 'desc' },
    take: 5,
    include: { author: { select: { name: true } } }
  });

  // ── Admin-only analytics ─────────────────────────────────────────────────
  let adminStats = null;
  if (isAdmin) {
    const [
      totalJobsThisMonth,
      completedThisMonth,
      totalJobsThisWeek,
      allWorkers,
      fundDepositsThisMonth,
      fundWithdrawalsThisMonth,
      pendingFundingRequests,
      totalInventoryItems,
      recentActivity
    ] = await Promise.all([
      // Jobs this month
      prisma.fabrication.count({ where: { date: { gte: monthStart } } }),
      prisma.fabrication.count({ where: { status: 'COMPLETE', completedAt: { gte: monthStart } } }),
      // Jobs this week
      prisma.fabrication.count({ where: { date: { gte: weekAgo } } }),
      // All workers with last check-in
      prisma.user.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' }
      }),
      // Funds this month
      prisma.fundTransaction.aggregate({
        where: { type: 'DEPOSIT', date: { gte: monthStart } },
        _sum: { amount: true }
      }),
      prisma.fundTransaction.aggregate({
        where: { type: 'WITHDRAWAL', date: { gte: monthStart } },
        _sum: { amount: true }
      }),
      // Pending funding requests
      prisma.fundingRequest.count({ where: { status: 'PENDING' } }),
      // Inventory
      prisma.inventoryItem.count(),
      // Recent 8 fabrication jobs (any status)
      prisma.fabrication.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { author: { select: { name: true } } }
      })
    ]);

    // Jobs by type this month
    const jobsByType = await prisma.fabrication.groupBy({
      by: ['type'],
      where: { date: { gte: monthStart } },
      _count: { id: true }
    });

    // Total hours logged this week (attendance)
    const weekAttendance = await prisma.attendanceRecord.findMany({
      where: { checkInAt: { gte: weekAgo }, durationMin: { not: null } },
      select: { durationMin: true }
    });
    const totalHoursThisWeek = weekAttendance.reduce((s, r) => s + (r.durationMin || 0), 0) / 60;

    adminStats = {
      totalJobsThisMonth,
      completedThisMonth,
      totalJobsThisWeek,
      allWorkers,
      incomeThisMonth: fundDepositsThisMonth._sum.amount || 0,
      expenditureThisMonth: fundWithdrawalsThisMonth._sum.amount || 0,
      pendingFundingRequests,
      totalInventoryItems,
      recentActivity,
      jobsByType,
      totalHoursThisWeek: totalHoursThisWeek.toFixed(1)
    };
  }

  res.render('dashboard', {
    activeJobs,
    todayAttendance,
    todayLog,
    recentAttendance,
    recentFabrication,
    checkedInWorkers,
    subscriberStats: {
      activeCount: subscriberActiveCount,
      expiringCount: subscriberExpiringCount,
      recent: recentSubscribers
    },
    adminStats,
    isAdmin,
    potentialCustomers,
    now: new Date()
  });
});

// JSON endpoint for live active jobs polling
router.get('/api/active-jobs', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const jobs = await prisma.fabrication.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, type: true, date: true, startedAt: true,
      estimatedMinutes: true, author: { select: { name: true } }
    }
  });
  res.json({ jobs, now: new Date().toISOString() });
});

module.exports = router;
