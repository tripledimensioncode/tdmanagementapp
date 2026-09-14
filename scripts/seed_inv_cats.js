const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function seed() {
  const cats = ['Tool', 'Part', 'Machine', 'Material', 'Consumable'];
  for (const name of cats) {
    await prisma.inventoryCategory.upsert({ where: { name }, update: {}, create: { name } });
    console.log('  category:', name);
  }
  const depts = ['3D Printing', 'Metal Work', 'Wood Work', 'Electronics', 'General'];
  for (const name of depts) {
    await prisma.inventoryDepartment.upsert({ where: { name }, update: {}, create: { name } });
    console.log('  department:', name);
  }
  console.log('Done.');
  await prisma.$disconnect();
}
seed().catch(e => { console.error(e); process.exit(1); });
