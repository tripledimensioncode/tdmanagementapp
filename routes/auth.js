const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const fs = require('fs/promises');
const path = require('path');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

const RESET_PHRASE = 'RESET EVERYTHING';

function parseLocalUsername(raw) {
  const input = (raw || '').toString().trim().toLowerCase();
  if (!input) return { error: 'Username is required.' };

  let username = input;
  if (username.includes('@')) {
    if (!username.endsWith('@local')) {
      return { error: 'Username must end with @local.' };
    }
    username = username.slice(0, -6); // remove @local
  }

  if (!username) return { error: 'Username is required.' };
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return { error: 'Username can only contain letters, numbers, dot, underscore, and hyphen.' };
  }

  return { username, email: `${username}@local` };
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0];
  }
  return req.ip || null;
}

async function clearUploadFiles() {
  const uploadRoot = path.join(__dirname, '..', 'public', 'uploads');
  const subDirs = ['images', 'videos', 'files'];

  for (const sub of subDirs) {
    const targetDir = path.join(uploadRoot, sub);
    await fs.mkdir(targetDir, { recursive: true });
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const full = path.join(targetDir, entry.name);
      await fs.rm(full, { recursive: true, force: true });
    }
  }
}

function clearSessionsExceptCurrent(req) {
  return new Promise((resolve) => {
    const store = req.app.locals.sessionStore;
    if (store && typeof store.clear === 'function') {
      store.clear(() => resolve());
    } else {
      resolve();
    }
  });
}

// Login form
router.get('/login', (req, res) => {
  res.render('auth/login');
});

// Login submit
router.post('/login', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { email, password } = req.body;
  const parsed = parseLocalUsername(email);
  if (parsed.error) {
    req.session.flash = { error: parsed.error };
    return res.redirect('/auth/login');
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (!user || user.isDeleted) {
    req.session.flash = { error: 'Invalid credentials' };
    return res.redirect('/auth/login');
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    req.session.flash = { error: 'Invalid credentials' };
    return res.redirect('/auth/login');
  }
  // store minimal user info in session
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  req.session.flash = { success: 'Welcome back!' };
  res.redirect('/');
});

// Logout
router.get('/logout', isLoggedIn, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

// Registration (admin only)
router.get('/register', isLoggedIn, isAdmin, (req, res) => {
  res.render('auth/register');
});

// Account creation audit trail (admin only)
router.get('/account-logs', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const logs = await prisma.accountCreationLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      createdBy: true,
      createdUser: true
    }
  });
  res.render('auth/account-logs', { logs });
});

// System reset confirmation page (admin only)
router.get('/system-reset', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const currentAdminId = req.session.user.id;

  try {
    // Get count of total admins
    const totalAdminsCount = await prisma.user.count({ where: { role: 'ADMIN' } });

    // Find active pending request (if any)
    const activeRequest = await prisma.systemResetRequest.findFirst({
      where: { status: 'PENDING' },
      include: {
        requestedBy: true,
        approvals: { include: { admin: true } }
      }
    });

    const hasApproved = activeRequest 
      ? activeRequest.approvals.some(appr => appr.adminId === currentAdminId)
      : false;

    res.render('auth/system-reset', {
      resetPhrase: RESET_PHRASE,
      totalAdminsCount,
      activeRequest,
      hasApproved,
      currentAdminId
    });
  } catch (err) {
    console.error('[GET /auth/system-reset Error]:', err);
    req.session.flash = { error: 'Failed to load system reset status.' };
    res.redirect('/');
  }
});

router.post('/register', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { username, password, confirmPassword, role } = req.body;

  if (password !== confirmPassword) {
    req.session.flash = { error: 'Passwords do not match.' };
    return res.redirect('/auth/register');
  }

  const parsed = parseLocalUsername(username);
  if (parsed.error) {
    req.session.flash = { error: parsed.error };
    return res.redirect('/auth/register');
  }

  const normalizedRole = (role || '').toString().toUpperCase();
  if (!['ADMIN', 'WORKER'].includes(normalizedRole)) {
    req.session.flash = { error: 'Invalid role selected.' };
    return res.redirect('/auth/register');
  }

  if (!password || password.length < 12) {
    req.session.flash = { error: 'Password must be at least 12 characters long.' };
    return res.redirect('/auth/register');
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    req.session.flash = { error: 'Username already exists.' };
    return res.redirect('/auth/register');
  }

  const hashed = await bcrypt.hash(password, 10);
  const creatorIp = getRequestIp(req);
  const creatorUserAgent = req.get('user-agent') || null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: parsed.username,
          email: parsed.email,
          password: hashed,
          role: normalizedRole
        }
      });

      await tx.accountCreationLog.create({
        data: {
          createdUserId: newUser.id,
          createdById: req.session.user.id,
          createdEmail: newUser.email,
          createdRole: newUser.role,
          creatorIp,
          creatorUserAgent
        }
      });

      return newUser;
    });
    req.session.flash = { success: `User created: ${created.email} (audit log captured)` };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Could not create user.' };
    res.redirect('/auth/register');
  }
});

// POST /auth/system-reset/request - Start the reset quorum flow
router.post('/system-reset/request', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const adminId = req.session.user.id;

  try {
    const totalAdminsCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (totalAdminsCount < 3) {
      req.session.flash = { error: 'At least 3 administrators are required to initiate a system reset.' };
      return res.redirect('/auth/system-reset');
    }

    const existing = await prisma.systemResetRequest.findFirst({ where: { status: 'PENDING' } });
    if (existing) {
      req.session.flash = { error: 'A system reset request is already active.' };
      return res.redirect('/auth/system-reset');
    }

    await prisma.$transaction(async (tx) => {
      const request = await tx.systemResetRequest.create({
        data: {
          requestedById: adminId,
          status: 'PENDING'
        }
      });
      await tx.systemResetApproval.create({
        data: {
          requestId: request.id,
          adminId
        }
      });
    });

    req.session.flash = { success: 'System reset request initiated. Two more approvals needed.' };
    res.redirect('/auth/system-reset');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to initiate system reset request.' };
    res.redirect('/auth/system-reset');
  }
});

// POST /auth/system-reset/approve - Co-sign/Approve active request
router.post('/system-reset/approve', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const adminId = req.session.user.id;

  try {
    const active = await prisma.systemResetRequest.findFirst({
      where: { status: 'PENDING' },
      include: { approvals: true }
    });

    if (!active) {
      req.session.flash = { error: 'No active system reset request found.' };
      return res.redirect('/auth/system-reset');
    }

    const alreadyApproved = active.approvals.some(appr => appr.adminId === adminId);
    if (alreadyApproved) {
      req.session.flash = { error: 'You have already approved this request.' };
      return res.redirect('/auth/system-reset');
    }

    await prisma.systemResetApproval.create({
      data: {
        requestId: active.id,
        adminId
      }
    });

    req.session.flash = { success: 'Reset request co-signed successfully.' };
    res.redirect('/auth/system-reset');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to approve system reset request.' };
    res.redirect('/auth/system-reset');
  }
});

// POST /auth/system-reset/cancel - Cancel active request
router.post('/system-reset/cancel', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const adminId = req.session.user.id;

  try {
    const active = await prisma.systemResetRequest.findFirst({
      where: { status: 'PENDING' }
    });

    if (!active) {
      req.session.flash = { error: 'No active system reset request found.' };
      return res.redirect('/auth/system-reset');
    }

    if (active.requestedById !== adminId) {
      req.session.flash = { error: 'Only the requesting administrator can cancel the request.' };
      return res.redirect('/auth/system-reset');
    }

    await prisma.systemResetRequest.delete({ where: { id: active.id } });

    req.session.flash = { success: 'System reset request cancelled.' };
    res.redirect('/auth/system-reset');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to cancel reset request.' };
    res.redirect('/auth/system-reset');
  }
});

// Admin-only full system reset execution (requires 3 approvals)
router.post('/system-reset', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { confirmationText, password } = req.body;
  const typed = (confirmationText || '').toString().trim();

  if (typed !== RESET_PHRASE) {
    req.session.flash = { error: `Confirmation phrase must be exactly: ${RESET_PHRASE}` };
    return res.redirect('/auth/system-reset');
  }

  const currentAdmin = await prisma.user.findUnique({ where: { id: req.session.user.id } });
  if (!currentAdmin) {
    req.session.flash = { error: 'Current admin account not found.' };
    return res.redirect('/auth/login');
  }

  const passwordOk = await bcrypt.compare((password || '').toString(), currentAdmin.password);
  if (!passwordOk) {
    req.session.flash = { error: 'Invalid password. Reset cancelled.' };
    return res.redirect('/auth/system-reset');
  }

  const activeRequest = await prisma.systemResetRequest.findFirst({
    where: { status: 'PENDING' },
    include: { approvals: true }
  });

  if (!activeRequest || activeRequest.approvals.length < 3) {
    req.session.flash = { error: 'A minimum of 3 unique administrator approvals is required to execute a system reset.' };
    return res.redirect('/auth/system-reset');
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Delete request & approvals
      await tx.systemResetApproval.deleteMany();
      await tx.systemResetRequest.deleteMany();

      // Clear all operational tables
      await tx.accountCreationLog.deleteMany();
      await tx.fundTransaction.deleteMany();
      await tx.fundingRequest.deleteMany();
      await tx.workTask.deleteMany();
      await tx.dailyLog.deleteMany();
      await tx.attendanceRecord.deleteMany();
      await tx.fabricationFile.deleteMany();
      await tx.fabrication.deleteMany();
      await tx.workUpdate.deleteMany();
      await tx.assessmentResponse.deleteMany();
      await tx.assessmentTemplate.deleteMany();
      await tx.inventoryItem.deleteMany();
      await tx.subscriberActivity.deleteMany();
      await tx.subscriber.deleteMany();
      await tx.subscriptionType.deleteMany();
      await tx.user.deleteMany({ where: { id: { not: currentAdmin.id } } });

      // Ensure the surviving account remains an admin after reset.
      await tx.user.update({
        where: { id: currentAdmin.id },
        data: { role: 'ADMIN' }
      });

      // Reset sequence counters if needed.
      // Auto-increment sequence reset is handled dynamically across models.
    });

    await clearUploadFiles();
    await clearSessionsExceptCurrent(req);

    req.session.flash = { success: 'System reset complete. All records cleared; current admin account preserved.' };
    return res.redirect('/');
  } catch (err) {
    console.error('[POST /auth/system-reset Error]:', err);
    req.session.flash = { error: 'System reset failed. No changes were committed.' };
    return res.redirect('/auth/system-reset');
  }
});

// GET /auth/change-password - Admin only password reset form
router.get('/change-password', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  try {
    const users = await prisma.user.findMany({
      where: { isDeleted: false },
      orderBy: { name: 'asc' }
    });
    res.render('auth/change-password', { users });
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to load user list.' };
    res.redirect('/');
  }
});

// POST /auth/change-password - Admin only password reset execute
router.post('/change-password', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { userId, password, confirmPassword } = req.body;

  const targetUserId = parseInt(userId, 10);
  if (!targetUserId || !password || !confirmPassword) {
    req.session.flash = { error: 'All fields are required.' };
    return res.redirect('/auth/change-password');
  }

  if (password !== confirmPassword) {
    req.session.flash = { error: 'Passwords do not match.' };
    return res.redirect('/auth/change-password');
  }

  if (password.length < 12) {
    req.session.flash = { error: 'Password must be at least 12 characters long.' };
    return res.redirect('/auth/change-password');
  }

  try {
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      req.session.flash = { error: 'Selected user not found.' };
      return res.redirect('/auth/change-password');
    }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: targetUserId },
      data: { password: hashed }
    });

    req.session.flash = { success: `Password changed successfully for ${targetUser.name} (${targetUser.email}).` };
    res.redirect('/auth/change-password');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Could not change password.' };
    res.redirect('/auth/change-password');
  }
});

// GET /auth/users - Admin only user management
router.get('/users', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  try {
    const users = await prisma.user.findMany({
      where: { isDeleted: false },
      orderBy: { name: 'asc' }
    });
    res.render('auth/users', { users });
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to load user list.' };
    res.redirect('/');
  }
});

// POST /auth/users/:id/delete - Admin only user deactivation/delete
router.post('/users/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const targetId = parseInt(req.params.id, 10);

  if (targetId === req.session.user.id) {
    req.session.flash = { error: 'You cannot delete your own admin account.' };
    return res.redirect('/auth/users');
  }

  try {
    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    if (!targetUser) {
      req.session.flash = { error: 'User not found.' };
      return res.redirect('/auth/users');
    }

    await prisma.user.update({
      where: { id: targetId },
      data: { isDeleted: true }
    });

    req.session.flash = { success: `User "${targetUser.name}" has been deleted/deactivated.` };
    res.redirect('/auth/users');
  } catch (err) {
    console.error(err);
    req.session.flash = { error: 'Failed to delete user.' };
    res.redirect('/auth/users');
  }
});

module.exports = router;
