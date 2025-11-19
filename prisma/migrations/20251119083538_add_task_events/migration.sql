-- CreateEnum
CREATE TYPE "TaskEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'COMPLETED', 'ASSIGNED', 'UNASSIGNED', 'DESCRIPTION_UPDATED', 'SUBTASK_ADDED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "clickupApiToken" TEXT;

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" SERIAL NOT NULL,
    "clickupTaskId" TEXT NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "eventType" "TaskEventType" NOT NULL,
    "taskName" TEXT NOT NULL,
    "projectName" TEXT,
    "statusFrom" TEXT,
    "statusTo" TEXT,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskEvent_employeeId_occurredAt_idx" ON "TaskEvent"("employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "TaskEvent_clickupTaskId_idx" ON "TaskEvent"("clickupTaskId");

-- CreateIndex
CREATE INDEX "TaskEvent_occurredAt_idx" ON "TaskEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
