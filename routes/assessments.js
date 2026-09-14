const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// List available assessments for worker
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  // For simplicity show latest templates
  const templates = await prisma.assessmentTemplate.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  res.render('assessments/index', { templates });
});

// Respond to template
router.get('/respond/:id', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  const template = await prisma.assessmentTemplate.findUnique({ where: { id } });
  if (!template) return res.status(404).send('Not found');
  // Parse questions from JSON string
  const questions = typeof template.questions === 'string' ? JSON.parse(template.questions) : template.questions;
  template.questions = questions;
  res.render('assessments/respond', { template });
});

router.post('/respond/:id', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  const template = await prisma.assessmentTemplate.findUnique({ where: { id } });
  if (!template) return res.status(404).send('Not found');
  // gather answers - send as JSON
  const answers = {};
  for (const key of Object.keys(req.body)) {
    answers[key] = req.body[key];
  }
  // Serialize answers to JSON string
  await prisma.assessmentResponse.create({ data: { templateId: id, userId: req.session.user.id, answers: JSON.stringify(answers) } });
  req.session.flash = { success: 'Assessment submitted.' };
  res.redirect('/assessments');
});

// Admin: create template
router.get('/admin/create', isLoggedIn, isAdmin, (req, res) => {
  res.render('assessments/admin/create');
});

router.post('/admin/create', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { title, questionsJson } = req.body; // questionsJson should be JSON string
  let questions = [];
  try { questions = JSON.parse(questionsJson); } catch(e) { questions = []; }
  // Store questions as JSON string
  await prisma.assessmentTemplate.create({ data: { title, questions: JSON.stringify(questions) } });
  req.session.flash = { success: 'Template created.' };
  res.redirect('/assessments');
});

module.exports = router;
