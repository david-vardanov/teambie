/*
  Warnings:

  - A unique constraint covering the columns `[telegramUserId]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('WAITING_ARRIVAL', 'WAITING_ARRIVAL_REMINDER', 'ARRIVED', 'WAITING_DEPARTURE', 'LEFT', 'MISSED', 'HOME_OFFICE', 'VACATION', 'SICK', 'HOLIDAY');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "arrivalWindowEnd" TEXT NOT NULL DEFAULT '11:00',
ADD COLUMN     "arrivalWindowStart" TEXT NOT NULL DEFAULT '10:00',
ADD COLUMN     "halfDayOnFridays" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringHomeOfficeDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "telegramUserId" BIGINT,
ADD COLUMN     "workHoursOnFriday" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "workHoursPerDay" INTEGER NOT NULL DEFAULT 8;

-- CreateTable
CREATE TABLE "AttendanceCheckIn" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "askedArrivalAt" TIMESTAMP(3),
    "confirmedArrivalAt" TIMESTAMP(3),
    "expectedArrivalAt" TIMESTAMP(3),
    "actualArrivalTime" TEXT,
    "askedDepartureAt" TIMESTAMP(3),
    "confirmedDepartureAt" TIMESTAMP(3),
    "actualDepartureTime" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'WAITING_ARRIVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSettings" (
    "id" SERIAL NOT NULL,
    "telegramBotToken" TEXT,
    "botEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timezoneOffset" INTEGER NOT NULL DEFAULT 3,
    "morningReportTime" TEXT NOT NULL DEFAULT '09:00',
    "endOfDayReportTime" TEXT NOT NULL DEFAULT '19:00',
    "missedCheckInTime" TEXT NOT NULL DEFAULT '12:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" INTEGER,

    CONSTRAINT "BotSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceCheckIn_employeeId_idx" ON "AttendanceCheckIn"("employeeId");

-- CreateIndex
CREATE INDEX "AttendanceCheckIn_date_idx" ON "AttendanceCheckIn"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCheckIn_employeeId_date_key" ON "AttendanceCheckIn"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_telegramUserId_key" ON "Employee"("telegramUserId");

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSettings" ADD CONSTRAINT "BotSettings_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
