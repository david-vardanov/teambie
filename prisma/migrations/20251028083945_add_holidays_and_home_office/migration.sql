-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'HOLIDAY';
ALTER TYPE "EventType" ADD VALUE 'HOME_OFFICE';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "holidayDaysPerYear" INTEGER NOT NULL DEFAULT 14,
ALTER COLUMN "vacationDaysPerYear" SET DEFAULT 28;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isGlobal" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "employeeId" DROP NOT NULL;
