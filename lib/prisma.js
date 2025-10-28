// Shared Prisma client instance to prevent connection pool issues
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
