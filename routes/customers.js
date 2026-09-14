const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const dayjs = require('dayjs');

// List all customers
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { search, potential } = req.query;

  // Build prisma filter
  const where = {};
  if (search && search.trim() !== '') {
    where.name = { contains: search.trim() };
  }
  if (potential === '1') {
    where.isPotential = true;
  }

  try {
    const items = await prisma.customer.findMany({
      where,
      orderBy: [
        { isPotential: 'desc' },
        { name: 'asc' }
      ],
      include: {
        attendedBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.render('customers/index', {
      items,
      filters: { search: search || '', potential: potential || '' },
      dayjs
    });
  } catch (err) {
    console.error('[GET /customers Error]:', err);
    req.session.flash = { error: 'Failed to retrieve customers.' };
    res.redirect('/');
  }
});

// New customer form
router.get('/new', isLoggedIn, (req, res) => {
  res.render('customers/form', { item: null });
});

// Create customer
router.post('/new', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { name, location, phone, email, comment, lastJobDetails, isPotential } = req.body;

  if (!name || !name.trim()) {
    req.session.flash = { error: 'Customer name is required.' };
    return res.redirect('/customers/new');
  }

  try {
    await prisma.customer.create({
      data: {
        name: name.trim(),
        location: location ? location.trim() : null,
        phone: phone ? phone.trim() : null,
        email: email ? email.trim() : null,
        comment: comment ? comment.trim() : null,
        lastJobDetails: lastJobDetails ? lastJobDetails.trim() : null,
        isPotential: isPotential === 'true' || isPotential === '1',
        attendedById: req.session.user.id
      }
    });

    req.session.flash = { success: 'Customer added successfully.' };
    res.redirect('/customers');
  } catch (err) {
    console.error('[POST /customers/new Error]:', err);
    req.session.flash = { error: 'Failed to add customer.' };
    res.redirect('/customers/new');
  }
});

// Edit customer form
router.get('/:id/edit', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);

  try {
    const item = await prisma.customer.findUnique({ where: { id } });
    if (!item) {
      req.session.flash = { error: 'Customer not found.' };
      return res.redirect('/customers');
    }
    res.render('customers/form', { item });
  } catch (err) {
    console.error(err);
    res.redirect('/customers');
  }
});

// Update customer
router.post('/:id/edit', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);
  const { name, location, phone, email, comment, lastJobDetails, isPotential } = req.body;

  if (!name || !name.trim()) {
    req.session.flash = { error: 'Customer name is required.' };
    return res.redirect(`/customers/${id}/edit`);
  }

  try {
    await prisma.customer.update({
      where: { id },
      data: {
        name: name.trim(),
        location: location ? location.trim() : null,
        phone: phone ? phone.trim() : null,
        email: email ? email.trim() : null,
        comment: comment ? comment.trim() : null,
        lastJobDetails: lastJobDetails ? lastJobDetails.trim() : null,
        isPotential: isPotential === 'true' || isPotential === '1'
      }
    });

    req.session.flash = { success: 'Customer updated successfully.' };
    res.redirect('/customers');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to update customer.' };
    res.redirect(`/customers/${id}/edit`);
  }
});

// Record customer call
router.post('/:id/call', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);

  try {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      req.session.flash = { error: 'Customer not found.' };
      return res.redirect('/customers');
    }

    await prisma.customer.update({
      where: { id },
      data: {
        lastCalled: new Date(),
        attendedById: req.session.user.id
      }
    });

    req.session.flash = { success: `Recorded call to ${customer.name}.` };
    res.redirect(req.get('Referrer') || '/customers');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to update call state.' };
    res.redirect('/customers');
  }
});

// Toggle potential status
router.post('/:id/toggle-potential', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);

  try {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      req.session.flash = { error: 'Customer not found.' };
      return res.redirect('/customers');
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: { isPotential: !customer.isPotential }
    });

    req.session.flash = {
      success: updated.isPotential
        ? `${customer.name} flagged as a potential customer.`
        : `${customer.name} unflagged from potential list.`
    };
    res.redirect(req.get('Referrer') || '/customers');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to toggle potential status.' };
    res.redirect('/customers');
  }
});

// Delete customer
router.post('/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id, 10);

  try {
    await prisma.customer.delete({ where: { id } });
    req.session.flash = { success: 'Customer deleted successfully.' };
    res.redirect('/customers');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to delete customer.' };
    res.redirect('/customers');
  }
});

module.exports = router;
