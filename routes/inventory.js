const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const upload = require('../utils/upload');
const { persistUpload, removeUploadedFile } = require('../utils/storage');

// Multer middleware: accept one image field called "image"
const itemImageUpload = upload.single('image');

// ── List inventory with filtering ─────────────────────────────────────────────
router.get('/', isLoggedIn, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { q, categoryId, departmentId } = req.query;

  const where = {};
  if (q)            where.name        = { contains: q };
  if (categoryId)   where.categoryId   = parseInt(categoryId);
  if (departmentId) where.departmentId = parseInt(departmentId);

  const [items, categories, departments] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      include: { category: true, department: true, updatedBy: { select: { name: true } } }
    }),
    prisma.inventoryCategory.findMany({ orderBy: { name: 'asc' } }),
    prisma.inventoryDepartment.findMany({ orderBy: { name: 'asc' } })
  ]);

  res.render('inventory/index', {
    items, categories, departments,
    filters: {
      q:            q            || '',
      categoryId:   categoryId   || '',
      departmentId: departmentId || ''
    }
  });
});

// ── Admin: add item (with optional image) ────────────────────────────────────
router.post('/add', isLoggedIn, isAdmin, (req, res, next) => {
  itemImageUpload(req, res, async (err) => {
    if (err) { req.session.flash = { error: 'Image upload failed: ' + err.message }; return res.redirect('/inventory'); }
    const prisma = req.app.locals.prisma;
    const { name, quantity, location, description, categoryId, departmentId } = req.body;

    const imagePath = req.file ? (await persistUpload(req.file, 'inventory')).path : null;

    await prisma.inventoryItem.create({
      data: {
        name,
        quantity:    parseInt(quantity || 0),
        location:    location    || null,
        description: description || null,
        imagePath,
        categoryId:  categoryId  ? parseInt(categoryId)  : null,
        departmentId: departmentId ? parseInt(departmentId) : null,
        updatedById: req.session.user.id
      }
    });
    req.session.flash = { success: 'Item added.' };
    res.redirect('/inventory');
  });
});

// ── Admin: update item metadata + quantity (with optional new image) ──────────
router.post('/:id/adjust', isLoggedIn, isAdmin, (req, res, next) => {
  itemImageUpload(req, res, async (err) => {
    if (err) { req.session.flash = { error: 'Image upload failed: ' + err.message }; return res.redirect('/inventory'); }
    const prisma = req.app.locals.prisma;
    const id = parseInt(req.params.id);
    const { quantity, location, categoryId, departmentId } = req.body;

    const current = await prisma.inventoryItem.findUnique({ where: { id }, select: { imagePath: true } });

    let imagePath = current ? current.imagePath : null;
    if (req.file) {
      await removeUploadedFile(imagePath); // delete the old file
      imagePath = (await persistUpload(req.file, 'inventory')).path;
    }

    await prisma.inventoryItem.update({
      where: { id },
      data: {
        quantity:    parseInt(quantity || 0),
        location:    location || null,
        categoryId:  categoryId  ? parseInt(categoryId)  : null,
        departmentId: departmentId ? parseInt(departmentId) : null,
        imagePath,
        lastUpdated: new Date(),
        updatedById: req.session.user.id
      }
    });
    req.session.flash = { success: 'Item updated.' };
    res.redirect('/inventory');
  });
});

// ── Admin: remove item image only ─────────────────────────────────────────────
router.post('/:id/remove-image', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  const item = await prisma.inventoryItem.findUnique({ where: { id }, select: { imagePath: true } });
  if (item) await removeUploadedFile(item.imagePath);
  await prisma.inventoryItem.update({ where: { id }, data: { imagePath: null } });
  req.session.flash = { success: 'Image removed.' };
  res.redirect('/inventory');
});

// ── Admin: delete item ────────────────────────────────────────────────────────
router.post('/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  const item = await prisma.inventoryItem.findUnique({ where: { id }, select: { imagePath: true } });
  if (item) await removeUploadedFile(item.imagePath);
  await prisma.inventoryItem.delete({ where: { id } });
  req.session.flash = { success: 'Item removed.' };
  res.redirect('/inventory');
});

// ── Admin: add category ───────────────────────────────────────────────────────
router.post('/categories/add', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { name } = req.body;
  if (name && name.trim()) {
    await prisma.inventoryCategory.upsert({ where: { name: name.trim() }, update: {}, create: { name: name.trim() } });
    req.session.flash = { success: `Category "${name.trim()}" added.` };
  }
  res.redirect('/inventory#manage');
});

// ── Admin: delete category ────────────────────────────────────────────────────
router.post('/categories/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  await prisma.inventoryItem.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
  await prisma.inventoryCategory.delete({ where: { id } });
  req.session.flash = { success: 'Category removed.' };
  res.redirect('/inventory#manage');
});

// ── Admin: add department ─────────────────────────────────────────────────────
router.post('/departments/add', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { name } = req.body;
  if (name && name.trim()) {
    await prisma.inventoryDepartment.upsert({ where: { name: name.trim() }, update: {}, create: { name: name.trim() } });
    req.session.flash = { success: `Department "${name.trim()}" added.` };
  }
  res.redirect('/inventory#manage');
});

// ── Admin: delete department ──────────────────────────────────────────────────
router.post('/departments/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const id = parseInt(req.params.id);
  await prisma.inventoryItem.updateMany({ where: { departmentId: id }, data: { departmentId: null } });
  await prisma.inventoryDepartment.delete({ where: { id } });
  req.session.flash = { success: 'Department removed.' };
  res.redirect('/inventory#manage');
});

module.exports = router;
