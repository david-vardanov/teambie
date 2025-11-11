/*
  Warnings:

  - A unique constraint covering the columns `[clickupUserId]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BotSettings" ADD COLUMN     "clickupApiToken" TEXT,
ADD COLUMN     "clickupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clickupFolderId" TEXT,
ADD COLUMN     "clickupListId" TEXT,
ADD COLUMN     "clickupSpaceId" TEXT,
ADD COLUMN     "clickupWorkspaceId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "clickupListId" TEXT,
ADD COLUMN     "clickupSpaceId" TEXT,
ADD COLUMN     "clickupUserId" TEXT,
ADD COLUMN     "clickupWebhookId" TEXT,
ADD COLUMN     "clickupWorkspaceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_clickupUserId_key" ON "Employee"("clickupUserId");
