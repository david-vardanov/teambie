const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'd.vardanov@gmail.com' },
    update: {},
    create: {
      email: 'd.vardanov@gmail.com',
      password: hashedPassword,
      name: 'Davit',
      role: 'ADMIN'
    }
  });

  console.log('Admin user created:', admin.email);
  console.log('Password: admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
