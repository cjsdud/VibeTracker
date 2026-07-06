-- DropIndex
DROP INDEX "github_events_deliveryId_key";

-- CreateIndex
CREATE INDEX "github_events_deliveryId_idx" ON "github_events"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "github_events_deliveryId_projectId_key" ON "github_events"("deliveryId", "projectId");

