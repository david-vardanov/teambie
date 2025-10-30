-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'WAITING_DEPARTURE_REMINDER';

-- AlterTable
ALTER TABLE "AttendanceCheckIn" ADD COLUMN     "autoCheckedOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expectedDepartureAt" TIMESTAMP(3),
ADD COLUMN     "lastArrivalReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BotSettings" ADD COLUMN     "arrivalReminderInterval" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "autoCheckoutBufferMinutes" INTEGER NOT NULL DEFAULT 30;
