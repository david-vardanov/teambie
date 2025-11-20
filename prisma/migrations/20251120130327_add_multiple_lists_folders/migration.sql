-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "clickupFolderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clickupListIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clickupWebhookIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Migrate existing single list IDs to arrays
UPDATE "Employee"
SET "clickupListIds" = ARRAY["clickupListId"]
WHERE "clickupListId" IS NOT NULL;

-- Migrate existing webhook IDs to arrays
UPDATE "Employee"
SET "clickupWebhookIds" = ARRAY["clickupWebhookId"]
WHERE "clickupWebhookId" IS NOT NULL;
