// Seed script — TRIPLE DIMENSION v2
// Creates initial admin/worker accounts and demo data for all v2 modules.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database (v2)...\n');

  // ─── Users ────────────────────────────────────────────────────────────────
  const adminEmail = 'admin@local';
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    const hashed = await bcrypt.hash('adminpass', 10);
    await prisma.user.create({
      data: { name: 'Admin User', email: adminEmail, password: hashed, role: 'ADMIN' }
    });
    console.log('✓ Created admin user: admin@local (password: adminpass)');
  } else {
    console.log('⚠ Admin user already exists');
  }

  const workerEmail = 'worker@local';
  const workerExists = await prisma.user.findUnique({ where: { email: workerEmail } });
  if (!workerExists) {
    const hashed = await bcrypt.hash('workerpass', 10);
    await prisma.user.create({
      data: { name: 'John Worker', email: workerEmail, password: hashed, role: 'WORKER' }
    });
    console.log('✓ Created demo worker: worker@local (password: workerpass)');
  }

  // ─── Inventory ─────────────────────────────────────────────────────────────
  const invCount = await prisma.inventoryItem.count();
  if (invCount === 0) {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const items = [
      { name: 'PLA Filament (1 kg spool)', quantity: 5, location: 'Print Bay', description: 'Standard 1.75 mm PLA, various colours', updatedById: admin.id },
      { name: 'PETG Filament (1 kg spool)', quantity: 3, location: 'Print Bay', description: '1.75 mm PETG', updatedById: admin.id },
      { name: 'A4 Printer Paper', quantity: 50, location: 'Storage Room', description: 'Standard A4 white paper, 80 gsm', updatedById: admin.id },
      { name: 'HDMI Cables', quantity: 10, location: 'IT Cabinet', description: '2 m HDMI 2.0 cables', updatedById: admin.id },
      { name: 'USB-C Adapters', quantity: 8, location: 'IT Cabinet', description: 'Multi-purpose USB-C adapters', updatedById: admin.id },
      { name: 'Whiteboard Markers', quantity: 24, location: 'Stationery', description: 'Permanent markers (assorted colours)', updatedById: admin.id }
    ];
    for (const it of items) {
      await prisma.inventoryItem.create({ data: it });
    }
    console.log('✓ Created sample inventory items');
  }

  // ─── Assessment Template ───────────────────────────────────────────────────
  const assessCount = await prisma.assessmentTemplate.count();
  if (assessCount === 0) {
    await prisma.assessmentTemplate.create({
      data: {
        title: 'Daily Standup',
        questions: JSON.stringify([
          { label: 'What did you accomplish yesterday?', type: 'TEXT' },
          { label: 'What are you working on today?', type: 'TEXT' },
          { label: 'Any blockers or challenges?', type: 'TEXT' },
          { label: 'Morale (1-10)', type: 'NUMBER' }
        ])
      }
    });
    console.log('✓ Created sample assessment template');
  }

  // ─── Sample Fabrication Records ────────────────────────────────────────────
  const fabCount = await prisma.fabrication.count();
  if (fabCount === 0) {
    const worker = await prisma.user.findUnique({ where: { email: workerEmail } });
    if (worker) {
      const fabs = [
        {
          type: '3D_PRINTING',
          name: 'Prototype Gear',
          date: new Date(),
          description: 'Initial prototype gear printed in PLA, 0.2 mm layer height.',
          cost: 12.5,
          costPerGram: 0.15,
          status: 'COMPLETE',
          printCategory: 'PAID',
          startedAt: new Date(Date.now() - 90 * 60000),
          completedAt: new Date(),
          actualMinutes: 90,
          estimatedMinutes: 80,
          authorId: worker.id
        },
        {
          type: 'FIBER_LASER',
          name: 'Acrylic Panel',
          date: new Date(),
          description: 'Cut 3 mm acrylic panel for enclosure.',
          cost: 7.0,
          status: 'COMPLETE',
          actualMinutes: 25,
          estimatedMinutes: 30,
          startedAt: new Date(Date.now() - 25 * 60000),
          completedAt: new Date(),
          authorId: worker.id
        },
        {
          type: 'ELECTRONICS',
          name: 'Sensor Module Build',
          date: new Date(),
          description: 'Building temperature/humidity sensor module for greenhouse project.',
          cost: 45.0,
          status: 'ACTIVE',
          estimatedMinutes: 120,
          startedAt: new Date(),
          authorId: worker.id
        }
      ];
      for (const f of fabs) {
        await prisma.fabrication.create({ data: f });
      }
      console.log('✓ Created sample fabrication entries (v2 type keys)');
    }
  }

  console.log('\n✅ Seeding complete!\n');
  console.log('Demo credentials:');
  console.log('  Admin:  admin@local / adminpass');
  console.log('  Worker: worker@local / workerpass\n');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
