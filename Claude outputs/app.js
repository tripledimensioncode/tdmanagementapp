// Main Express Application Configuration for Vercel Serverless & Local Development

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { rateLimit } = require('express-rate-limit');
const { RedisStore: SessionRedisStore } = require('connect-redis');
const { RedisStore: RateLimitRedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');
const expressLayouts = require('express-ejs-layouts');
const flash = require('./middleware/flash');
const csrf = require('./utils/csrf');
const { securityHeaders } = require('./middleware/security');
const { PrismaClient } = require('@prisma/client');

/**
 * Neon's pooled connection string (the one with "-pooler" in the hostname)
 * goes through PgBouncer, which breaks the unbroken client<->Postgres TLS
 * channel that SCRAM `channel_binding` depends on. If `channel_binding=require`
 * ends up on a pooled DATABASE_URL (Neon's dashboard "Copy connection string"
 * button appends it by default, and it's an easy thing to paste in without
 * noticing), the connection handshake can hang indefinitely instead of
 * failing cleanly — which is exactly what serverless requests do not have
 * time for. Strip it defensively here so a bad paste into an env var doesn't
 * take the whole app down with silent 60s timeouts.
 *
 * We also make sure a `connect_timeout` is always present so that if the
 * initial TCP/TLS handshake to Postgres genuinely can't complete (wrong
 * host, network issue, connection limit), Prisma fails fast with a clear
 * error instead of hanging until the platform kills the function.
 */
function sanitizeDatabaseUrl(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('-pooler') && url.searchParams.has('channel_binding')) {
      console.warn('[db] Removing channel_binding=require from pooled DATABASE_URL — incompatible with PgBouncer and can hang connections.');
      url.searchParams.delete('channel_binding');
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', '10');
    }
    return url.toString();
  } catch (err) {
    console.error('[db] Failed to parse DATABASE_URL, using it as-is:', err.message);
    return raw;
  }
}

const RESOLVED_DATABASE_URL = sanitizeDatabaseUrl(process.env.DATABASE_URL);

// Global Prisma Client instance for connection pooling in serverless environments
const globalForPrisma = global;
const prisma = globalForPrisma.prisma || new PrismaClient({
  datasources: RESOLVED_DATABASE_URL ? { db: { url: RESOLVED_DATABASE_URL } } : undefined
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

let redisClient = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('[redis]', err.message));
  redisClient.connect().catch((err) => console.error('[redis connect]', err.message));
}

async function ensureDefaultServices() {
  try {
    const defaultServices = [
      { value: '3D_PRINTING', label: '3D Printing' },
      { value: 'FIBER_LASER', label: 'Fiber Laser Cutting' },
      { value: 'CO2_LASER', label: 'CO2 Laser Cutting' },
      { value: 'ELECTRONICS', label: 'Electronics Project Build' },
      { value: '3D_MODELLING', label: '3D Modelling' },
      { value: 'WOOD_MILLING', label: 'Wood milling' }
    ];
    for (const s of defaultServices) {
      await prisma.service.upsert({
        where: { value: s.value },
        update: {},
        create: s
      });
    }
  } catch (err) {
    console.error('[bootstrap] Failed to seed default services:', err.message);
  }
}

// Default services are seeded during database migration/setup, not on module import.

const app = express();

const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback_session_secret_change_me';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const parsedSessionMaxAgeHours = Number(process.env.SESSION_MAX_AGE_HOURS || 8);
const SESSION_MAX_AGE_HOURS = Number.isFinite(parsedSessionMaxAgeHours) && parsedSessionMaxAgeHours > 0
  ? parsedSessionMaxAgeHours
  : 8;

app.disable('x-powered-by');
if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Defensive request timeout: if a request hasn't finished within this
// window, respond with a clear, logged error instead of letting the
// platform silently kill the function at its own hard limit (Vercel's
// maxDuration, 60s per vercel.json here) with no error and no log line —
// which is exactly what a stuck DB/Redis connection looked like before
// this was added. This doesn't fix a stuck upstream connection, but it
// makes it diagnosable instead of a mysterious blank 504.
const REQUEST_TIMEOUT_MS = 25000;
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`[timeout] ${req.method} ${req.originalUrl} did not complete within ${REQUEST_TIMEOUT_MS}ms — likely a stuck database or Redis connection.`);
      res.status(503).send('The server took too long to respond (database or cache connection may be stuck). Please try again in a moment.');
    }
  }, REQUEST_TIMEOUT_MS);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// Apply Security Headers
app.use(securityHeaders);

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');

// Static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Session Store Setup (Redis for Vercel/Production, MemoryStore for local dev fallback)
const sessionStore = redisClient
  ? new SessionRedisStore({ client: redisClient, prefix: 'td:sess:' })
  : new session.MemoryStore();

app.locals.sessionStore = sessionStore;

app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: TRUST_PROXY,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * SESSION_MAX_AGE_HOURS
  }
}));

// Upstash Redis rate limiting for sensitive endpoints
const rateLimitStore = redisClient
  ? new RateLimitRedisStore({
    prefix: 'td:rate:',
    sendCommand: (...args) => redisClient.sendCommand(args)
  })
  : undefined;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many attempts. Please try again in 15 minutes.',
  ...(rateLimitStore ? { store: rateLimitStore } : {})
});
app.use('/auth/login', authLimiter);

// Flash messages helper
app.use(flash());

// Modern session-backed CSRF protection
app.use(csrf());

// Make csrf token and current user available in views
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;
  next();
});

// Make prisma available to routes via app.locals
app.locals.prisma = prisma;

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

// Application Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/inventory', require('./routes/inventory'));
app.use('/assessments', require('./routes/assessments'));
app.use('/work-updates', require('./routes/work-updates'));
app.use('/fabrication', require('./routes/fabrication'));
app.use('/funds', require('./routes/funds'));
app.use('/subscribers', require('./routes/subscribers'));
app.use('/customers', require('./routes/customers'));
app.use('/attendance', require('./routes/attendance'));
app.use('/my-day', require('./routes/my-day'));
app.use('/files', require('./routes/files'));
app.use('/analytics', require('./routes/analytics'));

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    req.session.flash = { error: 'Form submission error (CSRF token mismatch). Please try again.' };
    return res.redirect(req.get('Referrer') || '/');
  }
  console.error('[App Error]', err);
  res.status(err.status || 500).send('Internal Server Error');
});

module.exports = app;
