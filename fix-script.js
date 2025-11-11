// ============================================================================
// ADD CLICKUP API TOKEN TO EMPLOYEE TABLE
// ============================================================================
// COPY THIS COMMAND AND PASTE IN YOUR PRODUCTION TERMINAL:

node -e "const{PrismaClient}=require('@prisma/client');const prisma=new PrismaClient();(async()=>{try{console.log('Adding clickupApiToken column...');await prisma.\$executeRawUnsafe('ALTER TABLE \"Employee\" ADD COLUMN IF NOT EXISTS \"clickupApiToken\" TEXT');console.log('Done!');}catch(e){console.error(e.message);}finally{await prisma.\$disconnect();}})();"

// After running the above, run:
// npx prisma generate
// pm2 restart all
