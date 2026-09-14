const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  try {
    const count = await p.attendanceRecord.count();
    console.log('AttendanceRecord table OK, count:', count);
    const fabCount = await p.fabrication.count();
    console.log('Fabrication table OK, count:', fabCount);
    console.log('SUCCESS: Schema v2 is active.');
  } catch(e) {
    console.error('SCHEMA ERROR:', e.message);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}
main();
