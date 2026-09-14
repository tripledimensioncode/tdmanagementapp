const express = require('express');
const router = express.Router();
const { isLoggedIn } = require('../middleware/auth');

// List work updates
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const items = await prisma.workUpdate.findMany({ orderBy: { createdAt: 'desc' }, include: { author: true } });
  res.render('work-updates/index', { items });
});

// New update form
router.get('/new', isLoggedIn, (req, res) => {
  res.render('work-updates/form', { item: null });
});

// Create update
router.post('/new', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { title, content, status, ideaId } = req.body;
  await prisma.workUpdate.create({ data: { title, content, status: status || 'PLANNING', authorId: req.session.user.id, ideaId: ideaId ? parseInt(ideaId) : null } });
  req.session.flash = { success: 'Work update posted.' };
  res.redirect('/work-updates');
});

module.exports = router;
