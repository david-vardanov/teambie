// Update ClickUp User ID for employee
// Run on production: node update-user-id.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    console.log('Updating ClickUp User ID...');

    // Update employee with Telegram ID 7164991347
    const result = await prisma.employee.update({
      where: { telegramUserId: BigInt(7164991347) },
      data: { clickupUserId: '111919846' }
    });

    console.log('✅ Updated successfully!');
    console.log('Employee:', result.name);
    console.log('ClickUp User ID:', result.clickupUserId);
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
