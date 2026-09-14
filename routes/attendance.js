const express = require('express');
const router = express.Router();
const dayjs = require('dayjs');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

function todayRange() {
  const start = dayjs().startOf('day').toDate();
  const end = dayjs().add(1, 'day').startOf('day').toDate();
  return { start, end };
}

// My attendance history
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const userId = req.session.user.id;

  const records = await prisma.attendanceRecord.findMany({
    where: { userId },
    orderBy: { checkInAt: 'desc' },
    take: 60
  });

  const { start, end } = todayRange();
  const openSession = await prisma.attendanceRecord.findFirst({
    where: { userId, checkInAt: { gte: start, lt: end }, checkOutAt: null },
    orderBy: { checkInAt: 'desc' }
  });

  res.render('attendance/index', {
    records,
    openSession,
    now: new Date()
  });
});

// Check in
router.post('/checkin', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const userId = req.session.user.id;
  const { start, end } = todayRange();

  // Prevent double check-in on same day
  const existing = await prisma.attendanceRecord.findFirst({
    where: { userId, checkInAt: { gte: start, lt: end }, checkOutAt: null }
  });

  if (existing) {
    req.session.flash = { error: 'You are already checked in.' };
    return res.redirect('/');
  }

  await prisma.attendanceRecord.create({
    data: { userId, checkInAt: new Date() }
  });

  req.session.flash = { success: 'Checked in successfully. Have a productive day!' };
  res.redirect('/');
});

// Check out
router.post('/checkout', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const userId = req.session.user.id;
  const notes = (req.body.notes || '').trim() || null;
  const { start, end } = todayRange();

  const openSession = await prisma.attendanceRecord.findFirst({
    where: { userId, checkInAt: { gte: start, lt: end }, checkOutAt: null },
    orderBy: { checkInAt: 'desc' }
  });

  if (!openSession) {
    req.session.flash = { error: 'No active check-in found for today.' };
    return res.redirect('/');
  }

  const now = new Date();
  const durationMin = Math.round((now - openSession.checkInAt) / 60000);

  await prisma.attendanceRecord.update({
    where: { id: openSession.id },
    data: { checkOutAt: now, notes, durationMin }
  });

  req.session.flash = { success: `Checked out. Duration: ${durationMin} min. See you next time!` };
  res.redirect('/');
});

// Admin: all workers attendance
router.get('/admin', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { from, to, userId: filterUserId } = req.query;

  const where = {};
  if (from || to) {
    where.checkInAt = {};
    if (from) where.checkInAt.gte = dayjs(from).startOf('day').toDate();
    if (to) where.checkInAt.lte = dayjs(to).endOf('day').toDate();
  }
  if (filterUserId) where.userId = parseInt(filterUserId, 10);

  const records = await prisma.attendanceRecord.findMany({
    where,
    orderBy: { checkInAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true } } }
  });

  const workers = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  res.render('attendance/admin', { records, workers, from: from || '', to: to || '', filterUserId: filterUserId || '' });
});

module.exports = router;
