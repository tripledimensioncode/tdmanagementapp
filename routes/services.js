const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// This is a standalone top-level router (mounted at /services in app.js) —
// deliberately NOT nested under /fabrication. The old /fabrication/services
// page was being silently swallowed by /fabrication/:id (a wildcard route
// registered earlier that matches any single path segment, including the
// literal word "services"), which caused every request to it to hang until
// the platform's function timeout killed it. Keeping this on its own path
// with no wildcard siblings means that class of bug can't happen here again.

function normalizeValue(raw) {
  return (raw || '').toString().trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function normalizeLabel(raw) {
  return (raw || '').toString().trim();
}

// List services + usage counts (admin only)
router.get('/', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;

  try {
    const [services, usage] = await Promise.all([
      prisma.service.findMany({ orderBy: { label: 'asc' } }),
      prisma.fabrication.groupBy({ by: ['type'], _count: { id: true } })
    ]);

    const usageByValue = Object.fromEntries(usage.map((u) => [u.type, u._count.id]));

    res.render('services/index', {
      services: services.map((s) => ({ ...s, usageCount: usageByValue[s.value] || 0 }))
    });
  } catch (err) {
    console.error('[GET /services]', err);
    req.session.flash = { error: 'Failed to load services.' };
    res.redirect('/');
  }
});

// Create a new service
router.post('/new', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const normalizedValue = normalizeValue(req.body.value);
  const normalizedLabel = normalizeLabel(req.body.label);

  if (!normalizedValue || !normalizedLabel) {
    req.session.flash = { error: 'Both service code and label are required.' };
    return res.redirect('/services');
  }

  try {
    const existing = await prisma.service.findUnique({ where: { value: normalizedValue } });
    if (existing) {
      req.session.flash = { error: `Service code ${normalizedValue} already exists.` };
      return res.redirect('/services');
    }

    await prisma.service.create({ data: { value: normalizedValue, label: normalizedLabel } });
    req.session.flash = { success: `Service "${normalizedLabel}" added successfully.` };
    res.redirect('/services');
  } catch (err) {
    console.error('[POST /services/new]', err);
    req.session.flash = { error: 'Failed to add service.' };
    res.redirect('/services');
  }
});

// Edit an existing service's code and/or label
router.post('/:id/edit', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    req.session.flash = { error: 'Invalid service.' };
    return res.redirect('/services');
  }

  const normalizedValue = normalizeValue(req.body.value);
  const normalizedLabel = normalizeLabel(req.body.label);

  if (!normalizedValue || !normalizedLabel) {
    req.session.flash = { error: 'Both service code and label are required.' };
    return res.redirect('/services');
  }

  try {
    const current = await prisma.service.findUnique({ where: { id } });
    if (!current) {
      req.session.flash = { error: 'Service not found.' };
      return res.redirect('/services');
    }

    if (normalizedValue !== current.value) {
      const conflict = await prisma.service.findUnique({ where: { value: normalizedValue } });
      if (conflict) {
        req.session.flash = { error: `Service code ${normalizedValue} is already used by another service.` };
        return res.redirect('/services');
      }
    }

    await prisma.service.update({
      where: { id },
      data: { value: normalizedValue, label: normalizedLabel }
    });

    req.session.flash = {
      success: normalizedValue !== current.value
        ? `Service updated. Note: existing jobs recorded under code "${current.value}" keep that code — they won't automatically move to "${normalizedValue}".`
        : `Service "${normalizedLabel}" updated.`
    };
    res.redirect('/services');
  } catch (err) {
    console.error('[POST /services/:id/edit]', err);
    req.session.flash = { error: 'Failed to update service.' };
    res.redirect('/services');
  }
});

// Delete a service (blocked if any fabrication job still references its code)
router.post('/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    req.session.flash = { error: 'Invalid service.' };
    return res.redirect('/services');
  }

  try {
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      req.session.flash = { error: 'Service not found.' };
      return res.redirect('/services');
    }

    const usageCount = await prisma.fabrication.count({ where: { type: service.value } });
    if (usageCount > 0) {
      req.session.flash = {
        error: `Can't delete "${service.label}" — ${usageCount} existing job${usageCount === 1 ? '' : 's'} still ${usageCount === 1 ? 'uses' : 'use'} this service. Rename it instead, or reassign those jobs first.`
      };
      return res.redirect('/services');
    }

    await prisma.service.delete({ where: { id } });
    req.session.flash = { success: `Service "${service.label}" deleted.` };
    res.redirect('/services');
  } catch (err) {
    console.error('[POST /services/:id/delete]', err);
    req.session.flash = { error: 'Failed to delete service.' };
    res.redirect('/services');
  }
});

module.exports = router;
