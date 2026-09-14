const express = require('express');
const crypto = require('crypto');
const dayjs = require('dayjs');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const upload = require('../utils/upload');
const { generateSubscriberCardPdf } = require('../utils/pdf');
const { persistUpload, removeUploadedFile } = require('../utils/storage');

const idCardUpload = upload.single('idCard');
const activityUpload = upload.single('attachment');

function computeEffectiveStatus(subscriber) {
  if (subscriber.status === 'SUSPENDED') return 'SUSPENDED';
  if (subscriber.endDate && dayjs(subscriber.endDate).isBefore(dayjs(), 'day')) return 'EXPIRED';
  return 'ACTIVE';
}

async function generateSubscriberCode(prisma) {
  for (let i = 0; i < 8; i += 1) {
    const code = `TD-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const exists = await prisma.subscriber.findUnique({ where: { code } });
    if (!exists) return code;
  }
  const fallback = Date.now().toString(36).toUpperCase().slice(-4);
  return `TD-${fallback}`;
}

// List subscribers with quick ID search
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const q = (req.query.q || '').toString().trim();
  const where = {};
  if (q) where.code = { contains: q };

  const subscribers = await prisma.subscriber.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { subscriptionType: true, createdBy: true }
  });

  const records = subscribers.map((subscriber) => ({
    ...subscriber,
    effectiveStatus: computeEffectiveStatus(subscriber)
  }));

  res.render('subscribers/index', { subscribers: records, q });
});

// Admin: manage subscription types
router.get('/subscriptions', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const types = await prisma.subscriptionType.findMany({ orderBy: { name: 'asc' } });
  res.render('subscribers/subscriptions', { types });
});

router.post('/subscriptions', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { name, price, durationDays, allowedServices, color } = req.body;

  if (!name || !price || !durationDays) {
    req.session.flash = { error: 'Name, price, and duration are required.' };
    return res.redirect('/subscribers/subscriptions');
  }

  await prisma.subscriptionType.create({
    data: {
      name: name.trim(),
      price: Number(price),
      durationDays: parseInt(durationDays, 10),
      allowedServices: (allowedServices || '').trim(),
      color: (color || '#1d4ed8').trim(),
      createdById: req.session.user.id
    }
  });

  req.session.flash = { success: 'Subscription type created.' };
  res.redirect('/subscribers/subscriptions');
});

// New subscriber form
router.get('/new', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const types = await prisma.subscriptionType.findMany({ orderBy: { name: 'asc' } });
  res.render('subscribers/form', {
    types,
    today: dayjs().format('YYYY-MM-DD')
  });
});

// Create subscriber
router.post('/new', isLoggedIn, (req, res, next) => {
  idCardUpload(req, res, (err) => {
    if (err) {
      req.session.flash = { error: `Upload failed: ${err.message}` };
      return res.redirect('/subscribers/new');
    }
    next();
  });
}, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const {
    name,
    profession,
    isStudent,
    studentId,
    phonePrimary,
    phoneSecondary,
    subscriptionTypeId,
    startDate,
    endDate,
    notes
  } = req.body;

  if (!name || !subscriptionTypeId || !startDate || !endDate) {
    req.session.flash = { error: 'Name, subscription type, start date, and end date are required.' };
    return res.redirect('/subscribers/new');
  }

  const parsedStart = dayjs(startDate);
  const parsedEnd = dayjs(endDate);
  if (!parsedStart.isValid() || !parsedEnd.isValid() || parsedEnd.isBefore(parsedStart, 'day')) {
    req.session.flash = { error: 'Provide valid start and end dates (end must be after start).' };
    return res.redirect('/subscribers/new');
  }

  const isStudentFlag = isStudent === 'on' || isStudent === 'true';
  if (isStudentFlag && !(studentId || '').trim()) {
    req.session.flash = { error: 'Student ID is required when "Student" is checked.' };
    return res.redirect('/subscribers/new');
  }

  const typeId = parseInt(subscriptionTypeId, 10);
  const subscriptionType = await prisma.subscriptionType.findUnique({ where: { id: typeId } });
  if (!subscriptionType) {
    req.session.flash = { error: 'Selected subscription type not found.' };
    return res.redirect('/subscribers/new');
  }

  const idCardPath = req.file ? (await persistUpload(req.file, 'subscriber-id-cards')).path : null;
  const code = await generateSubscriberCode(prisma);

  const created = await prisma.subscriber.create({
    data: {
      code,
      name: name.trim(),
      profession: (profession || '').trim() || undefined,
      isStudent: isStudentFlag,
      studentId: isStudentFlag ? (studentId || '').trim() : undefined,
      phonePrimary: (phonePrimary || '').trim() || undefined,
      phoneSecondary: (phoneSecondary || '').trim() || undefined,
      subscriptionTypeId: typeId,
      idCardImagePath: idCardPath,
      startDate: parsedStart.toDate(),
      endDate: parsedEnd.toDate(),
      notes: (notes || '').trim() || undefined,
      createdById: req.session.user.id
    }
  });

  req.session.flash = { success: `Subscriber created. Workshop ID: ${created.code}` };
  res.redirect(`/subscribers/${created.id}`);
});

// Subscriber card PDF
router.get('/:id/card.pdf', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const subscriber = await prisma.subscriber.findUnique({
    where: { id },
    include: { subscriptionType: true }
  });
  if (!subscriber) return res.status(404).send('Not found');

  await generateSubscriberCardPdf(res, {
    subscriber,
    qrPayload: subscriber.code
  });
  return;
});

// Show subscriber details + activity log
router.get('/:id', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const subscriber = await prisma.subscriber.findUnique({
    where: { id },
    include: {
      subscriptionType: true,
      createdBy: true,
      activities: { include: { createdBy: true }, orderBy: { serviceDate: 'desc' } }
    }
  });
  if (!subscriber) return res.status(404).send('Not found');

  res.render('subscribers/show', {
    subscriber: {
      ...subscriber,
      effectiveStatus: computeEffectiveStatus(subscriber)
    },
    today: dayjs().format('YYYY-MM-DD')
  });
});

// Add activity entry for a subscriber
router.post('/:id/activities', isLoggedIn, (req, res, next) => {
  activityUpload(req, res, (err) => {
    if (err) {
      req.session.flash = { error: `Upload failed: ${err.message}` };
      return res.redirect(`/subscribers/${req.params.id}`);
    }
    next();
  });
}, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const { actionType, description, serviceDate, cost } = req.body;

  if (!actionType) {
    req.session.flash = { error: 'Activity type is required.' };
    return res.redirect(`/subscribers/${id}`);
  }

  const parsedDate = dayjs(serviceDate || dayjs().format('YYYY-MM-DD'));
  if (!parsedDate.isValid()) {
    req.session.flash = { error: 'Provide a valid activity date.' };
    return res.redirect(`/subscribers/${id}`);
  }

  const attachmentPath = req.file ? (await persistUpload(req.file, 'subscriber-activities')).path : null;

  await prisma.subscriberActivity.create({
    data: {
      subscriberId: id,
      actionType: actionType.trim(),
      description: (description || '').trim() || undefined,
      serviceDate: parsedDate.toDate(),
      cost: cost ? Number(cost) : undefined,
      attachmentPath,
      attachmentName: req.file ? req.file.originalname : undefined,
      createdById: req.session.user.id
    }
  });

  req.session.flash = { success: 'Activity recorded.' };
  res.redirect(`/subscribers/${id}`);
});

// Admin only: toggle subscriber status (deactivate / activate)
router.post('/:id/toggle-status', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  try {
    const sub = await prisma.subscriber.findUnique({ where: { id } });
    if (!sub) {
      req.session.flash = { error: 'Subscriber not found.' };
      return res.redirect('/subscribers');
    }
    const nextStatus = sub.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    await prisma.subscriber.update({
      where: { id },
      data: { status: nextStatus }
    });
    req.session.flash = { success: `Subscriber status changed to ${nextStatus}.` };
    res.redirect(`/subscribers/${id}`);
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to update subscriber status.' };
    res.redirect(`/subscribers/${id}`);
  }
});

// Admin only: delete subscriber
router.post('/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  try {
    const sub = await prisma.subscriber.findUnique({
      where: { id },
      include: { activities: true }
    });
    if (!sub) {
      req.session.flash = { error: 'Subscriber not found.' };
      return res.redirect('/subscribers');
    }
    await prisma.subscriber.delete({ where: { id } });
    // Clean up storage (Blob objects or local dev files) after the DB rows are
    // gone — the id card plus every activity attachment — best-effort.
    await Promise.all([
      removeUploadedFile(sub.idCardImagePath),
      ...(sub.activities || []).map((a) => removeUploadedFile(a.attachmentPath))
    ]);
    req.session.flash = { success: `Subscriber ${sub.name} deleted successfully.` };
    res.redirect('/subscribers');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to delete subscriber.' };
    res.redirect(`/subscribers/${id}`);
  }
});

module.exports = router;
