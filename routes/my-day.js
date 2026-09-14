const express = require('express');
const router = express.Router();
const dayjs = require('dayjs');
const { isLoggedIn } = require('../middleware/auth');

function todayRange() {
  const start = dayjs().startOf('day').toDate();
  const end = dayjs().add(1, 'day').startOf('day').toDate();
  return { start, end };
}

async function getOrCreateTodayLog(prisma, userId) {
  const { start, end } = todayRange();
  let log = await prisma.dailyLog.findFirst({
    where: { userId, date: { gte: start, lt: end } },
    include: { tasks: { orderBy: { createdAt: 'asc' } } }
  });
  if (!log) {
    log = await prisma.dailyLog.create({
      data: { userId, date: new Date(), summary: '', blockers: null },
      include: { tasks: { orderBy: { createdAt: 'asc' } } }
    });
  }
  return log;
}

// My day view
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const log = await getOrCreateTodayLog(prisma, req.session.user.id);
  res.render('my-day/index', { log, today: dayjs().format('dddd, MMMM D, YYYY') });
});

// Update daily log summary
router.post('/update', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { summary, blockers } = req.body;
  const log = await getOrCreateTodayLog(prisma, req.session.user.id);
  await prisma.dailyLog.update({
    where: { id: log.id },
    data: { summary: (summary || '').trim(), blockers: (blockers || '').trim() || null }
  });
  req.session.flash = { success: 'Daily log updated.' };
  res.redirect('/my-day');
});

// Create a task
router.post('/tasks', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { title, estimatedMin } = req.body;
  if (!title || !title.trim()) {
    req.session.flash = { error: 'Task title is required.' };
    return res.redirect('/my-day');
  }
  const log = await getOrCreateTodayLog(prisma, req.session.user.id);
  const parsed = parseInt(estimatedMin, 10);
  await prisma.workTask.create({
    data: {
      dailyLogId: log.id,
      title: title.trim(),
      estimatedMin: Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
  });
  req.session.flash = { success: 'Task added.' };
  res.redirect('/my-day');
});

// Start a task
router.post('/tasks/:id/start', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  await prisma.workTask.update({
    where: { id },
    data: { status: 'IN_PROGRESS', startedAt: new Date() }
  });
  res.redirect('/my-day');
});

// Complete a task
router.post('/tasks/:id/done', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const task = await prisma.workTask.findUnique({ where: { id } });
  if (!task) return res.redirect('/my-day');
  const now = new Date();
  const refTime = task.startedAt || task.createdAt;
  const actualMin = Math.round((now - refTime) / 60000);
  await prisma.workTask.update({
    where: { id },
    data: { status: 'DONE', completedAt: now, actualMin }
  });
  res.redirect('/my-day');
});

// Delete a task
router.post('/tasks/:id/delete', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  await prisma.workTask.delete({ where: { id } });
  res.redirect('/my-day');
});

module.exports = router;
