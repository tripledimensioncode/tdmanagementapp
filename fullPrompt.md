# TRIPLE DIMENSION Workshop Management System — Full Rebuild Prompt

## Project Overview

Build a **cloud-native, internet-hosted internal management web application** for **TRIPLE DIMENSION**, a fabrication/makerspace workshop. The system manages fabrication jobs, customers, staff, inventory, financials, subscriptions, and daily operations. It must be production-ready on **Vercel** (Node.js serverless functions), backed by **Neon PostgreSQL**, **Vercel Blob** private file storage, and **Upstash Redis** for sessions.

**Business currency**: GHS (Ghanaian Cedis). All monetary amounts display as `GHS X.XX`.

---

## Technology Stack

### Required Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Web Framework | Express 4 |
| Template Engine | EJS with `express-ejs-layouts` |
| ORM | Prisma (v4+) |
| Database | Neon Serverless PostgreSQL |
| File Storage | Vercel Blob (private access) |
| Sessions | `express-session` + `connect-redis` backed by Upstash Redis |
| Rate Limiting | `express-rate-limit` + `rate-limit-redis` on Upstash |
| Authentication | bcrypt password hashing |
| CSRF Protection | Custom session-backed middleware (do NOT use deprecated `csurf`) |
| PDF Generation | PDFKit + QRCode |
| Date Handling | dayjs |
| File Uploads | Multer (memory storage in cloud, disk in dev fallback) |
| Spreadsheet Export | xlsx |
| Styling | Tailwind CSS CDN |
| Hosting | Vercel Serverless Functions |
| CI/CD | GitHub → Vercel auto-deploy |

### Project File Structure

```
triple-dimension/
├── app.js                    # Express app configuration (exported module)
├── server.js                 # Local-only HTTP listener (npm start)
├── api/
│   └── index.js              # Vercel function entry point (exports app)
├── vercel.json               # Vercel routing config
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       └── 0_init/
│           └── migration.sql
├── routes/
│   ├── index.js              # Dashboard
│   ├── auth.js               # Login, logout, register, user management
│   ├── fabrication.js        # Jobs, invoices, payments, receipts
│   ├── inventory.js          # Inventory management
│   ├── funds.js              # Cashbook, fund transactions, requests
│   ├── subscribers.js        # Workshop subscribers / membership
│   ├── customers.js          # Customer CRM
│   ├── attendance.js         # Staff check-in/check-out
│   ├── my-day.js             # Personal daily log & task tracker
│   ├── work-updates.js       # Team work updates / project status
│   ├── assessments.js        # Staff assessments
│   ├── analytics.js          # Charts & analytics APIs
│   └── files.js              # Vercel Blob secure file proxy & upload tokens
├── middleware/
│   ├── auth.js               # isLoggedIn, isAdmin guards
│   ├── flash.js              # Flash message middleware
│   └── security.js           # Security headers, password validation, ownership checks
├── utils/
│   ├── csrf.js               # Custom session-backed CSRF middleware
│   ├── storage.js            # Vercel Blob upload, delete, client token handlers
│   ├── upload.js             # Multer config (memory storage in cloud)
│   ├── pdf.js                # PDFKit invoice, receipt, summary, subscriber card generation
│   ├── billing.js            # Invoice total and payment summary calculations
│   └── helpers.js            # Date formatting helpers
├── views/
│   ├── layout.ejs            # Base HTML template
│   ├── dashboard.ejs         # Main dashboard view
│   ├── partials/
│   │   ├── navbar.ejs
│   │   ├── flash-messages.ejs
│   │   └── footer.ejs
│   ├── auth/                 # login, register, users, change-password, system-reset, account-logs
│   ├── fabrication/          # index, form, show, services
│   ├── funds/                # index, transaction-form, request-form
│   ├── subscribers/          # index, form, show, subscriptions
│   ├── inventory/            # index
│   ├── customers/            # index, form
│   ├── attendance/           # index, admin
│   ├── my-day/               # index
│   ├── work-updates/         # index, form
│   ├── assessments/          # index, respond, admin/create
│   └── analytics/            # index
├── public/
│   ├── css/style.css
│   ├── js/app.js
│   └── images/
│       ├── triple-dimension-logo.svg
│       ├── favicon.svg
│       └── company-logo.png  # Used in PDF headers
├── scripts/
│   └── migrate-sqlite-to-postgres.js  # One-off data migration tool
├── .env.example
├── .gitignore
└── docs/
    └── restoration-runbook.md
```

---

## Vercel Deployment Architecture

### app.js (Exported Express Module)
The main app file exports the Express application. It must NOT start an HTTP listener itself.

```
app.js              → exports Express app (middleware, routes, error handlers)
server.js           → imports app, calls app.listen() for local dev only
api/index.js        → imports app, exports it as the Vercel function handler
```

### vercel.json
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/index.js": {
      "maxDuration": 60
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ]
}
```

### package.json Scripts
```json
{
  "scripts": {
    "postinstall": "prisma generate",
    "build": "prisma generate",
    "vercel-build": "prisma generate",
    "start": "node server.js",
    "dev": "nodemon --watch . --exec node server.js"
  }
}
```

---

## Environment Variables

### Production (Vercel Dashboard)
```env
NODE_ENV=production
DATABASE_URL=<Neon pooled connection string>
DIRECT_URL=<Neon direct connection string>
SESSION_SECRET=<64-char random string>
REDIS_URL=<Upstash Redis URL>
BLOB_READ_WRITE_TOKEN=<Vercel Blob token>
COOKIE_SECURE=1
TRUST_PROXY=1
APP_URL=https://app.tripledimension.com
PRINT_COST_PER_GRAM=0.15
SESSION_MAX_AGE_HOURS=8
```

### Local Development (.env)
```env
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/triple_dimension
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/triple_dimension
SESSION_SECRET=local_dev_secret
COOKIE_SECURE=0
TRUST_PROXY=0
APP_URL=http://localhost:3000
PRINT_COST_PER_GRAM=0.15
```

---

## Full Database Schema (Prisma / PostgreSQL)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id               Int      @id @default(autoincrement())
  name             String
  email            String   @unique
  password         String
  role             String   @default("WORKER")  // WORKER | ADMIN
  printCostPerGram Decimal? @default(0.15) @db.Decimal(12, 2)
  isDeleted        Boolean  @default(false)
  createdAt        DateTime @default(now())

  inventoryUpdates            InventoryItem[]      @relation("Updater")
  assessments                 AssessmentResponse[]
  workUpdates                 WorkUpdate[]
  fabrications                Fabrication[]
  telegramAccount             TelegramAccount?
  telegramLinkCodes           TelegramLinkCode[]
  receivedPayments            FabricationPayment[] @relation("PaymentReceiver")
  subscriptionTypesCreated    SubscriptionType[]   @relation("SubscriptionTypeCreator")
  subscribersCreated          Subscriber[]         @relation("SubscriberCreator")
  subscriberActivitiesCreated SubscriberActivity[] @relation("SubscriberActivityCreator")
  fundTransactions            FundTransaction[]    @relation("FundTransactionCreator")
  fundingRequests             FundingRequest[]     @relation("FundingRequestRequester")
  reviewedFundingRequests     FundingRequest[]     @relation("FundingRequestReviewer")
  accountCreationsMade        AccountCreationLog[] @relation("AccountCreator")
  accountCreationsReceived    AccountCreationLog[] @relation("AccountCreatedUser")
  attendanceRecords           AttendanceRecord[]
  dailyLogs                   DailyLog[]
  nasFilesUploaded            NasFile[]
  resetRequests               SystemResetRequest[] @relation("ResetRequester")
  resetApprovals              SystemResetApproval[]
  attendedCustomers           Customer[]
}

model InventoryItem {
  id           Int                  @id @default(autoincrement())
  name         String
  quantity     Int                  @default(0)
  location     String?
  description  String?
  imagePath    String?
  lastUpdated  DateTime             @default(now())
  updatedById  Int?
  updatedBy    User?                @relation("Updater", fields: [updatedById], references: [id])
  itemType     String?              // TOOL | PART | MACHINE | MATERIAL | CONSUMABLE
  categoryId   Int?
  category     InventoryCategory?   @relation(fields: [categoryId], references: [id])
  departmentId Int?
  department   InventoryDepartment? @relation(fields: [departmentId], references: [id])
}

model InventoryCategory {
  id        Int             @id @default(autoincrement())
  name      String          @unique
  createdAt DateTime        @default(now())
  items     InventoryItem[]
}

model InventoryDepartment {
  id        Int             @id @default(autoincrement())
  name      String          @unique
  createdAt DateTime        @default(now())
  items     InventoryItem[]
}

model AssessmentTemplate {
  id        Int                  @id @default(autoincrement())
  title     String
  questions String               // JSON string array of question objects
  createdAt DateTime             @default(now())
  responses AssessmentResponse[]
}

model AssessmentResponse {
  id         Int                @id @default(autoincrement())
  templateId Int
  template   AssessmentTemplate @relation(fields: [templateId], references: [id])
  userId     Int
  user       User               @relation(fields: [userId], references: [id])
  answers    String             // JSON string of answers
  date       DateTime           @default(now())
}

model WorkUpdate {
  id        Int      @id @default(autoincrement())
  title     String
  content   String
  status    String   @default("PLANNING") // PLANNING | IN_PROGRESS | DONE | ON_HOLD
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
  ideaId    Int?
  createdAt DateTime @default(now())
}

model Fabrication {
  id               Int      @id @default(autoincrement())
  type             String   // 3D_PRINTING | FIBER_LASER | CO2_LASER | ELECTRONICS | 3D_MODELLING | WOOD_MILLING
  name             String
  date             DateTime
  description      String?
  cost             Decimal? @db.Decimal(12, 2)
  costPerGram      Decimal? @db.Decimal(12, 2)
  filePath         String?
  status           String   @default("ACTIVE") // ACTIVE | COMPLETE
  startedAt        DateTime?
  completedAt      DateTime?
  estimatedMinutes Int?
  actualMinutes    Int?
  printCategory    String?  // IN_HOUSE | PAID (only for 3D_PRINTING)
  projectName      String?  // required for IN_HOUSE jobs
  authorId         Int
  author           User     @relation(fields: [authorId], references: [id])
  files            FabricationFile[]
  lineItems        FabricationLineItem[]
  payments         FabricationPayment[]
  createdAt        DateTime @default(now())
}

model TelegramAccount {
  id             Int      @id @default(autoincrement())
  userId         Int      @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  telegramUserId String   @unique
  chatId         String
  username       String?
  displayName    String?
  linkedAt       DateTime @default(now())
  isActive       Boolean  @default(true)
  draft          TelegramJobDraft?
}

model TelegramLinkCode {
  id        Int      @id @default(autoincrement())
  code      String   @unique
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
}

model TelegramJobDraft {
  id                Int             @id @default(autoincrement())
  telegramAccountId Int             @unique
  telegramAccount   TelegramAccount @relation(fields: [telegramAccountId], references: [id], onDelete: Cascade)
  state             String
  payload           String          // JSON string of draft data
  updatedAt         DateTime        @updatedAt
  createdAt         DateTime        @default(now())
}

model TelegramProcessedUpdate {
  id        Int      @id @default(autoincrement())
  updateId  String   @unique
  createdAt DateTime @default(now())
}

model FabricationPayment {
  id            Int         @id @default(autoincrement())
  fabricationId Int
  fabrication   Fabrication @relation(fields: [fabricationId], references: [id], onDelete: Cascade)
  amount        Decimal     @db.Decimal(12, 2)
  method        String      // Cash | MoMo | Bank Transfer | Cheque | etc.
  reference     String?
  notes         String?
  paidAt        DateTime    @default(now())
  receivedById  Int
  receivedBy    User        @relation("PaymentReceiver", fields: [receivedById], references: [id])
  createdAt     DateTime    @default(now())
}

model FabricationFile {
  id            Int         @id @default(autoincrement())
  fabricationId Int
  fabrication   Fabrication @relation(fields: [fabricationId], references: [id], onDelete: Cascade)
  path          String      // Web path or Blob proxy URL
  originalName  String
  massGrams     Float?      // Used for 3D print cost calculations
  nasFileId     Int?
  nasFile       NasFile?    @relation(fields: [nasFileId], references: [id])
  createdAt     DateTime    @default(now())
}

model FabricationLineItem {
  id            Int         @id @default(autoincrement())
  fabricationId Int
  fabrication   Fabrication @relation(fields: [fabricationId], references: [id], onDelete: Cascade)
  label         String
  quantity      Int         @default(1)
  cost          Decimal     @default(0.0) @db.Decimal(12, 2)
  createdAt     DateTime    @default(now())
}

model SubscriptionType {
  id              Int          @id @default(autoincrement())
  name            String
  price           Decimal      @db.Decimal(12, 2)
  durationDays    Int
  allowedServices String       // Comma-separated service values or description
  color           String       // Hex color for UI display
  createdById     Int
  createdBy       User         @relation("SubscriptionTypeCreator", fields: [createdById], references: [id])
  createdAt       DateTime     @default(now())
  subscribers     Subscriber[]
}

model Subscriber {
  id                 Int              @id @default(autoincrement())
  code               String           @unique  // e.g. "TD-A1B2"
  name               String
  profession         String?
  isStudent          Boolean          @default(false)
  studentId          String?
  phonePrimary       String?
  phoneSecondary     String?
  subscriptionTypeId Int
  subscriptionType   SubscriptionType @relation(fields: [subscriptionTypeId], references: [id])
  idCardImagePath    String?          // Blob URL or local path
  idCardNasFileId    Int?
  idCardNasFile      NasFile?         @relation("SubscriberIdCard", fields: [idCardNasFileId], references: [id])
  startDate          DateTime
  endDate            DateTime
  notes              String?
  status             String           @default("ACTIVE") // ACTIVE | EXPIRED | SUSPENDED
  createdById        Int
  createdBy          User             @relation("SubscriberCreator", fields: [createdById], references: [id])
  createdAt          DateTime         @default(now())
  activities         SubscriberActivity[]
}

model SubscriberActivity {
  id              Int        @id @default(autoincrement())
  subscriberId    Int
  subscriber      Subscriber @relation(fields: [subscriberId], references: [id], onDelete: Cascade)
  actionType      String     // CHECK_IN | SERVICE | NOTE | PAYMENT | RENEWAL | etc.
  description     String?
  serviceDate     DateTime
  cost            Decimal?   @db.Decimal(12, 2)
  attachmentPath  String?
  attachmentName  String?
  nasFileId       Int?
  nasFile         NasFile?   @relation("ActivityAttachment", fields: [nasFileId], references: [id])
  createdById     Int
  createdBy       User       @relation("SubscriberActivityCreator", fields: [createdById], references: [id])
  createdAt       DateTime   @default(now())
}

model FundTransaction {
  id          Int      @id @default(autoincrement())
  type        String   // DEPOSIT | WITHDRAWAL
  amount      Decimal  @db.Decimal(12, 2)
  title       String
  description String?
  reference   String?
  date        DateTime
  createdById Int
  createdBy   User     @relation("FundTransactionCreator", fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
}

model FundingRequest {
  id              Int      @id @default(autoincrement())
  title           String
  requestedAmount Decimal  @db.Decimal(12, 2)
  purpose         String
  details         String?
  status          String   @default("PENDING") // PENDING | APPROVED | DECLINED
  adminComment    String?
  requestedById   Int
  requestedBy     User     @relation("FundingRequestRequester", fields: [requestedById], references: [id])
  reviewedById    Int?
  reviewedBy      User?    @relation("FundingRequestReviewer", fields: [reviewedById], references: [id])
  reviewedAt      DateTime?
  createdAt       DateTime @default(now())
}

model AccountCreationLog {
  id               Int      @id @default(autoincrement())
  createdUserId    Int
  createdUser      User     @relation("AccountCreatedUser", fields: [createdUserId], references: [id], onDelete: Cascade)
  createdById      Int
  createdBy        User     @relation("AccountCreator", fields: [createdById], references: [id], onDelete: Restrict)
  createdEmail     String
  createdRole      String
  creatorIp        String?
  creatorUserAgent String?
  createdAt        DateTime @default(now())
}

model AttendanceRecord {
  id          Int       @id @default(autoincrement())
  userId      Int
  user        User      @relation(fields: [userId], references: [id])
  checkInAt   DateTime
  checkOutAt  DateTime?
  notes       String?
  durationMin Int?
  createdAt   DateTime  @default(now())
}

model DailyLog {
  id        Int        @id @default(autoincrement())
  userId    Int
  user      User       @relation(fields: [userId], references: [id])
  date      DateTime
  summary   String
  blockers  String?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  tasks     WorkTask[]
}

model WorkTask {
  id           Int       @id @default(autoincrement())
  dailyLogId   Int
  dailyLog     DailyLog  @relation(fields: [dailyLogId], references: [id], onDelete: Cascade)
  title        String
  estimatedMin Int?
  actualMin    Int?
  status       String    @default("TODO") // TODO | IN_PROGRESS | DONE
  startedAt    DateTime?
  completedAt  DateTime?
  createdAt    DateTime  @default(now())
}

// Legacy NAS models — kept for schema compatibility during migration.
// The hosted cloud app does NOT use these tables for active operations.
model NasCategory {
  id        Int       @id @default(autoincrement())
  name      String    @unique
  createdAt DateTime  @default(now())
  files     NasFile[]
}

model NasFolder {
  id         Int         @id @default(autoincrement())
  name       String
  path       String
  parentId   Int?
  parent     NasFolder?  @relation("SubFolders", fields: [parentId], references: [id], onDelete: Cascade)
  subFolders NasFolder[] @relation("SubFolders")
  files      NasFile[]
  createdAt  DateTime    @default(now())

  @@unique([parentId, name])
}

model NasFile {
  id            Int          @id @default(autoincrement())
  originalName  String
  storedName    String
  storedPath    String
  sizeBytes     Int          @default(0)
  mimeType      String?
  description   String
  categoryId    Int?
  category      NasCategory? @relation(fields: [categoryId], references: [id])
  uploadedById  Int
  uploadedBy    User         @relation(fields: [uploadedById], references: [id])
  fabricationId Int?
  folderId      Int?
  folder        NasFolder?   @relation(fields: [folderId], references: [id], onDelete: Cascade)
  createdAt     DateTime     @default(now())

  fabricationFiles    FabricationFile[]
  subscriberIdCards   Subscriber[]         @relation("SubscriberIdCard")
  activityAttachments SubscriberActivity[] @relation("ActivityAttachment")
}

model SystemResetRequest {
  id            Int                   @id @default(autoincrement())
  requestedById Int
  requestedBy   User                  @relation("ResetRequester", fields: [requestedById], references: [id], onDelete: Cascade)
  createdAt     DateTime              @default(now())
  status        String                @default("PENDING") // PENDING | COMPLETED | EXPIRED
  approvals     SystemResetApproval[]
}

model SystemResetApproval {
  id        Int                @id @default(autoincrement())
  requestId Int
  request   SystemResetRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  adminId   Int
  admin     User               @relation(fields: [adminId], references: [id], onDelete: Cascade)
  createdAt DateTime           @default(now())

  @@unique([requestId, adminId])
}

model Customer {
  id             Int       @id @default(autoincrement())
  name           String
  location       String?
  phone          String?
  email          String?
  lastCalled     DateTime?
  isPotential    Boolean   @default(false)
  lastJobDetails String?
  comment        String?
  attendedById   Int?
  attendedBy     User?     @relation(fields: [attendedById], references: [id])
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}

model Service {
  id        Int      @id @default(autoincrement())
  value     String   @unique  // e.g. "3D_PRINTING"
  label     String            // e.g. "3D Printing"
  createdAt DateTime @default(now())
}
```

---

## Default Services (Seed on First Run)

Seed these on startup (in `app.js` using `prisma.service.upsert`):
- `3D_PRINTING` → "3D Printing"
- `FIBER_LASER` → "Fiber Laser Cutting"
- `CO2_LASER` → "CO2 Laser Cutting"
- `ELECTRONICS` → "Electronics Project Build"
- `3D_MODELLING` → "3D Modelling"
- `WOOD_MILLING` → "Wood milling"

---

## Authentication System

### User Roles
- **WORKER**: Can use all personal modules (My Day, Attendance, Fabrication creation, Funds requests)
- **ADMIN**: Everything + user management, admin views, funding approval, service management, system reset

### Login System
- Username format: `username@local` (e.g., `john@local`). Display name is the part before `@local`.
- Passwords are bcrypt-hashed with cost 10.
- Minimum password length: **12 characters**.
- Session-based auth. Store minimal user object in session: `{ id, name, email, role }`.
- Login rate-limited to 10 attempts per 15 minutes (Redis-backed in production).

### CSRF Protection
Use a custom session-backed CSRF middleware:
- On GET requests: inject a token from `req.session.csrfSecret` (generate with `crypto.randomBytes(32).toString('hex')` if absent).
- `req.csrfToken()` returns `req.session.csrfSecret`.
- On POST/PUT/DELETE: verify that `req.body._csrf`, `req.query._csrf`, or `req.headers['x-csrf-token']` matches the session secret.
- On mismatch: set `err.code = 'EBADCSRFTOKEN'` and call `next(err)`.
- All EJS forms must include `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
- The `csrfToken` and `currentUser` variables are injected into `res.locals` via a middleware in `app.js`.

### Admin User Registration (Admins only)
- Route: `GET /auth/register` and `POST /auth/register`
- Creates users with `email` as `username@local`.
- Logs creation to `AccountCreationLog` including creator IP and User-Agent.
- Admin-issued Telegram link codes: `POST /auth/users/:id/telegram-link` generates a short-lived code.

### Multi-Admin System Reset
Requires 3 admin approvals to wipe all data. Controlled by `SystemResetRequest` + `SystemResetApproval` models.

---

## Module: Fabrication Jobs

**Route prefix**: `/fabrication`

### Data Concepts
- A "fabrication" is a workshop job (3D print, laser cut, electronics build, etc.)
- Services are admin-configurable via the `Service` model.
- Each job can have multiple attached files, line items, and payment installments.
- **3D Printing** jobs: cost = `(totalMassGrams × costPerGram)` + additional charges
- **Other jobs**: cost = sum of line items, OR a flat cost field
- Print categories: `IN_HOUSE` (requires `projectName`) or `PAID`

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/fabrication` | List with filters (status, type, date range, quick presets: today/week/month/last30) |
| GET | `/fabrication/export` | Export to CSV or XLSX |
| GET | `/fabrication/new` | New job form (auto-fills user's saved `costPerGram`) |
| POST | `/fabrication/new` | Create job + file upload (up to 10 files) |
| GET | `/fabrication/summary/pdf` | Summary PDF (day/month/range/all periods) |
| GET | `/fabrication/:id` | Show job detail with invoice summary and payments |
| POST | `/fabrication/:id/complete` | Mark job complete (calculates `actualMinutes`) |
| GET | `/fabrication/:id/invoice.pdf` | Generate invoice PDF |
| POST | `/fabrication/:id/payments` | Record a payment installment |
| GET | `/fabrication/:id/receipts/:paymentId.pdf` | Generate payment receipt PDF |
| POST | `/fabrication/:id/delete` | Admin-only: delete job |
| GET | `/fabrication/services` | Admin: list/manage services |
| POST | `/fabrication/services/new` | Admin: add new service type |

### Invoice Calculation Logic
```javascript
function calculateFabricationTotal(job) {
  const lineItemsTotal = (job.lineItems || []).reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.cost), 0
  );
  const additionalCost = Number(job.cost || 0);
  if (job.type !== '3D_PRINTING') {
    return lineItemsTotal > 0 ? lineItemsTotal : additionalCost;
  }
  const totalMass = (job.files || []).reduce((sum, f) => sum + Number(f.massGrams || 0), 0);
  const printCost = totalMass * Number(job.costPerGram || 0);
  return printCost + additionalCost + lineItemsTotal;
}
```

### File Uploads
- Accept multiple files per job. In cloud, use Multer memory storage + Vercel Blob.
- Store each file's `path` (Blob proxy URL) and `originalName` in `FabricationFile`.
- For 3D prints, each file also stores `massGrams` (entered by user).

---

## Module: Funds / Cashbook

**Route prefix**: `/funds`

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/funds` | Dashboard: all transactions, summary stats, funding requests (with filters: q, type, from, to) |
| GET | `/funds/transactions/new` | Form (query: `?type=DEPOSIT` or `?type=WITHDRAWAL`) |
| POST | `/funds/transactions/new` | Create transaction |
| GET | `/funds/requests/new` | Funding request form |
| POST | `/funds/requests/new` | Submit funding request |
| POST | `/funds/requests/:id/review` | Admin: approve/decline funding request |
| GET | `/funds/export` | Export cashbook as CSV or XLSX |

### Summary Stats
- Total deposits, total withdrawals, net balance
- Pending funding count and pending amount
- Full filter support on the transaction list

---

## Module: Subscribers / Workshop Membership

**Route prefix**: `/subscribers`

### Data Concepts
- Subscribers have a unique workshop code (e.g., "TD-A1B2") auto-generated.
- Status logic: if `endDate` is in the past, effective status = `EXPIRED` (regardless of stored status).
- Activities are a log of any service, check-in, payment, etc. against the subscriber.

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/subscribers` | List (searchable by code) |
| GET | `/subscribers/subscriptions` | Admin: manage subscription types |
| POST | `/subscribers/subscriptions` | Admin: create subscription type |
| GET | `/subscribers/new` | New subscriber form |
| POST | `/subscribers/new` | Create subscriber (with optional ID card image upload) |
| GET | `/subscribers/:id` | Show subscriber + activity log |
| GET | `/subscribers/:id/card.pdf` | Generate subscriber card PDF with QR code |
| POST | `/subscribers/:id/activities` | Log an activity against subscriber |

---

## Module: Inventory

**Route prefix**: `/inventory`

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/inventory` | List with filters (search, category, department) |
| POST | `/inventory/add` | Admin: add item (with optional image upload) |
| POST | `/inventory/:id/adjust` | Admin: update quantity/details/image |
| POST | `/inventory/:id/remove-image` | Admin: remove item image |
| POST | `/inventory/:id/delete` | Admin: delete item |
| POST | `/inventory/categories/add` | Admin: add category |
| POST | `/inventory/categories/:id/delete` | Admin: delete category |
| POST | `/inventory/departments/add` | Admin: add department |
| POST | `/inventory/departments/:id/delete` | Admin: delete department |

### Item Classification
- `itemType`: TOOL | PART | MACHINE | MATERIAL | CONSUMABLE
- `categoryId`: FK to InventoryCategory (admin-managed)
- `departmentId`: FK to InventoryDepartment (admin-managed)

---

## Module: Customers / CRM

**Route prefix**: `/customers`

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/customers` | List with search and `?potential=1` filter |
| GET | `/customers/new` | New customer form |
| POST | `/customers/new` | Create customer |
| GET | `/customers/:id/edit` | Edit form |
| POST | `/customers/:id/edit` | Update customer |
| POST | `/customers/:id/call` | Record a call (updates `lastCalled` and `attendedById`) |
| POST | `/customers/:id/toggle-potential` | Toggle `isPotential` flag |
| POST | `/customers/:id/delete` | Delete customer |

---

## Module: Attendance

**Route prefix**: `/attendance`

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/attendance` | My attendance history (last 60 records) |
| POST | `/attendance/checkin` | Check in (prevents double check-in on same day) |
| POST | `/attendance/checkout` | Check out (calculates `durationMin`) |
| GET | `/attendance/admin` | Admin: all workers with date range + user filters |

---

## Module: My Day (Daily Log & Task Tracker)

**Route prefix**: `/my-day`

### Data Concepts
- Each day auto-creates a `DailyLog` record for the logged-in user.
- Workers add tasks with optional estimated minutes; system records actual time on completion.

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/my-day` | Today's log and task list |
| POST | `/my-day/update` | Update summary and blockers |
| POST | `/my-day/tasks` | Add a task |
| POST | `/my-day/tasks/:id/start` | Mark task IN_PROGRESS (records `startedAt`) |
| POST | `/my-day/tasks/:id/done` | Mark task DONE (calculates `actualMin`) |
| POST | `/my-day/tasks/:id/delete` | Delete task |

---

## Module: Analytics

**Route prefix**: `/analytics`

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/analytics` | Analytics dashboard page (renders charts client-side using JSON APIs) |
| GET | `/analytics/api/time` | Time data: jobs by type, by worker, attendance hours, task efficiency |
| GET | `/analytics/api/money` | Money data: monthly deposits/withdrawals (12 months), revenue by type, funding request status |
| GET | `/analytics/api/filament` | 3D print: total grams, paid vs in-house, weekly usage, top jobs, in-house projects |
| GET | `/analytics/api/nas` | (Legacy) File counts by category/worker — can return empty data |

### Period Filtering
All API routes accept `?period=7d|30d|90d|1y|all` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

---

## Module: Work Updates

**Route prefix**: `/work-updates`

Simple team status board.

| Method | Path | Description |
|---|---|---|
| GET | `/work-updates` | List all updates |
| GET | `/work-updates/new` | Form |
| POST | `/work-updates/new` | Create update (status: PLANNING | IN_PROGRESS | DONE | ON_HOLD) |

---

## Module: Assessments

**Route prefix**: `/assessments`

Staff self-assessment tool.

| Method | Path | Description |
|---|---|---|
| GET | `/assessments` | List templates |
| GET | `/assessments/respond/:id` | Assessment form (questions stored as JSON) |
| POST | `/assessments/respond/:id` | Submit responses (stored as JSON) |
| GET | `/assessments/admin/create` | Admin: create template form |
| POST | `/assessments/admin/create` | Admin: create template |

---

## Module: File Proxy (Vercel Blob)

**Route prefix**: `/files`

| Method | Path | Description |
|---|---|---|
| POST | `/files/upload-token` | Generate client-side upload token for files > 4.5 MB |
| GET | `/files/open?url=...` | Authenticated proxy: streams private Blob file to browser |

The `/files/open` route fetches the Blob URL with the `BLOB_READ_WRITE_TOKEN` bearer token and pipes it back. Only logged-in users can access it. Validate that the URL hostname ends with `.blob.vercel-storage.com`.

---

## Dashboard (`/`)

The main dashboard aggregates data for the logged-in user:

### All Users See:
- **Attendance card**: today's check-in status and last 7 sessions
- **Daily Log card**: today's log and task status
- **Active Fabrication Jobs**: all ACTIVE jobs (live-updated every 30 seconds via `GET /api/active-jobs`)
- **Potential Customers**: customers flagged as potential
- **Checked-in Workers**: who is currently in the workshop
- **Subscriber Summary**: active count, expiring in 14 days count, 5 recent subscribers
- **Recent Completed Jobs**: last 5 completed fabrications

### Admin-Only Section:
- Monthly job count, completion count, weekly job count
- Fund income/expenditure this month
- Pending funding request count
- Total inventory item count
- Jobs by service type breakdown
- Total attendance hours this week

---

## PDF Generation

Use **PDFKit** for all PDF output. All PDFs are streamed directly to the HTTP response.

### PDFs Produced:
1. **Fabrication Invoice PDF** (`/fabrication/:id/invoice.pdf`): Job details, file list with mass (for 3D prints), line items, cost breakdown, total. Shows print rate per gram for 3D printing jobs.
2. **Fabrication Receipt PDF** (`/fabrication/:id/receipts/:paymentId.pdf`): Single payment receipt with job summary, payment amount, method, and running balance.
3. **Fabrication Summary PDF** (`/fabrication/summary/pdf`): Multi-job summary for a day/month/range/all time.
4. **Subscriber Card PDF** (`/subscribers/:id/card.pdf`): Membership card with subscriber details and QR code of their unique code.

### PDF Styling
- Company header: "TRIPLE DIMENSION" in navy blue (#1f3a5f), 18pt bold, + logo image if `public/images/company-logo.png` exists
- Currency: formatted as `GHS X.XX`
- Zebra-striped tables
- Generates QR codes via `qrcode` package

---

## UI / Frontend

### Styling
- **Tailwind CSS** via CDN (no build step required)
- Custom CSS at `public/css/style.css` for non-Tailwind styles
- Custom JS at `public/js/app.js` for interactive behaviors (mobile nav toggle, live job polling)

### Layout
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TRIPLE DIMENSION</title>
    <link rel="icon" type="image/svg+xml" href="/public/images/favicon.svg">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/public/css/style.css">
  </head>
  <body class="bg-slate-100 min-h-screen text-slate-900 overflow-x-hidden">
    <%- include('partials/navbar') %>
    <main class="pt-36 pb-10">
      <div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <%- include('partials/flash-messages') %>
        <%- body %>
      </div>
    </main>
    <%- include('partials/footer') %>
    <script src="/public/js/app.js"></script>
  </body>
</html>
```

### Navbar
Responsive fixed top navbar with brand logo, navigation links, and user display.

Navigation links (all logged-in users):
- Dashboard (`/`)
- Fabrication (`/fabrication`)
- Customers (`/customers`)
- Inventory (`/inventory`)
- Funds (`/funds`)
- Daily Log (`/my-day`)
- Analytics (`/analytics`)

Admin-only additional links:
- Attend. Admin (`/attendance/admin`)
- Account Logs (`/auth/account-logs`)
- Manage Services (`/fabrication/services`)
- Manage Users (`/auth/users`)
- Change Password (`/auth/change-password`)

### Flash Messages
Session-based flash messages: `req.session.flash = { success: '...' }` or `{ error: '...' }`. Displayed and cleared on next page render.

---

## Security Requirements

1. **Password Minimum**: 12 characters (enforced at registration and password change)
2. **Session Persistence**: Redis-backed sessions (MemoryStore only as local dev fallback)
3. **CSRF**: Session-backed CSRF on all POST forms
4. **Rate Limiting**: `/auth/login` limited to 10 attempts per 15 minutes (Redis-backed)
5. **Security Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`, `Strict-Transport-Security`
6. **Private Files**: Blob files only accessible via authenticated `/files/open` proxy
7. **Body Limit**: `express.urlencoded` and `express.json` both limited to `10mb`
8. **Trust Proxy**: Must set `app.set('trust proxy', 1)` when `TRUST_PROXY=1` env var is set
9. **No X-Powered-By**: `app.disable('x-powered-by')`

---

## Upload Handling

### Cloud (Vercel / `BLOB_READ_WRITE_TOKEN` set)
- Multer configured with `multer.memoryStorage()`
- `persistUpload(file, folder)` in `utils/storage.js` uploads to Vercel Blob (private)
- Returns `{ path: '/files/open?url=...', storageUrl: 'https://...' }`
- File size limit: **4.5 MB** (Vercel serverless function body limit)
- For larger files: use the `/files/upload-token` endpoint for direct client-side upload via `@vercel/blob`

### Local Development (no Blob token)
- Multer configured with `diskStorage`
- Files go to `public/uploads/images/`, `public/uploads/videos/`, `public/uploads/files/`
- Path returned as `/uploads/...`

### Multer Field Definitions
- Inventory images: `upload.single('image')` (image MIME type enforced)
- Subscriber ID card: `upload.single('idCard')`
- Activity attachment: `upload.single('attachment')`
- Fabrication files: `upload.fields([{ name: 'files', maxCount: 10 }, { name: 'file', maxCount: 1 }])`

---

## Health Endpoint

```javascript
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});
```

---

## Prisma Client Instantiation (Serverless-Safe)

```javascript
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = global;
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

Make `prisma` available to all routes via `app.locals.prisma = prisma`.

---

## Key Best Practices & Fixes vs Original

1. **Do NOT call `ensureDefaultServices()` as a top-level await on module import.** Seed services in a dedicated migration/setup script, or wrap the call so it does not block or crash the Vercel function cold start if the database is unreachable.

2. **Never use `multer.diskStorage()` in production.** Always use `multer.memoryStorage()` on Vercel.

3. **All `Decimal` fields must convert to `Number()` for arithmetic** since Prisma returns `Decimal` objects. Use `Number(item.amount)` before `.toFixed(2)`.

4. **All financial fields use `Decimal @db.Decimal(12, 2)`** — never `Float` for money.

5. **Session store falls back to `MemoryStore` only in local dev** — do NOT use MemoryStore in production (users get logged out on function restarts).

6. **CSRF token must be regenerated** on session creation if absent. Do not assume a token exists.

7. **`prisma.service.upsert` for default services** must be wrapped in try/catch — if the database isn't migrated yet, it will throw.

8. **Use `isBefore(dayjs(), 'day')`** from dayjs for date-based status computation (subscriber expiry).

9. **Export CSV with UTF-8 BOM** (`'\uFEFF' + csv`) for Excel compatibility.

10. **The `?download=1` query parameter** on PDF routes sets `Content-Disposition: attachment` instead of `inline`.

11. **Route ordering matters**: register `/fabrication/services` and `/fabrication/export` BEFORE `/:id` — otherwise Express matches `services` or `export` as an ID.

12. **`app.locals.nasEnabled = false`** in cloud — no NAS routes should be mounted.

---

## GitHub Actions CI/CD (.github/workflows/deploy.yml)

```yaml
name: Triple Dimension CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx prisma validate
        env:
          DATABASE_URL: "postgresql://dummy:dummy@localhost/test"
          DIRECT_URL: "postgresql://dummy:dummy@localhost/test"
      - run: npx prisma generate
      - run: node -c app.js server.js api/index.js

  deploy:
    needs: validate
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
          DIRECT_URL: ${{ secrets.PRODUCTION_DIRECT_URL }}
```

---

## .gitignore

```gitignore
node_modules/
.env
.env.local
.env.*.local
data/
prisma/data/
*.sqlite
*.db
gen_out.txt
prisma_output.txt
.vercel/
logs/
*.log
npm-debug.log*
.DS_Store
Thumbs.db
.vscode/
dist/
build/
backups/
```

---

## Initial Seed Script Note

On first deployment, after running `prisma migrate deploy`, seed the `Service` table using:

```javascript
const services = [
  { value: '3D_PRINTING', label: '3D Printing' },
  { value: 'FIBER_LASER', label: 'Fiber Laser Cutting' },
  { value: 'CO2_LASER', label: 'CO2 Laser Cutting' },
  { value: 'ELECTRONICS', label: 'Electronics Project Build' },
  { value: '3D_MODELLING', label: '3D Modelling' },
  { value: 'WOOD_MILLING', label: 'Wood milling' }
];
for (const s of services) {
  await prisma.service.upsert({ where: { value: s.value }, update: {}, create: s });
}
```

---

## Summary of All Application Modules

| Module | Path | Key Features |
|---|---|---|
| Dashboard | `/` | Live active jobs, attendance, subscribers, admin stats |
| Authentication | `/auth` | Login, logout, register (admin), user management, system reset quorum |
| Fabrication | `/fabrication` | Job lifecycle, file uploads, invoice PDF, payment installments, receipt PDF, CSV/XLSX export |
| Inventory | `/inventory` | Item catalog with images, categories, departments |
| Funds | `/funds` | Cashbook (deposits/withdrawals), funding requests with admin approval, export |
| Subscribers | `/subscribers` | Workshop membership with unique codes, subscription types, activity log, card PDF |
| Customers | `/customers` | CRM: potential customers, call tracking |
| Attendance | `/attendance` | Clock in/out, admin overview |
| My Day | `/my-day` | Personal daily log + task tracking with time estimation |
| Work Updates | `/work-updates` | Team project status board |
| Assessments | `/assessments` | Self-assessment templates and responses |
| Analytics | `/analytics` | Interactive charts: time, money, filament consumption |
| File Proxy | `/files` | Authenticated Vercel Blob streaming and client upload tokens |
| Health | `/health` | JSON health check |
