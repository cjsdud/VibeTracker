-- DropForeignKey
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_featureNodeId_fkey";

-- DropForeignKey
ALTER TABLE "open_questions" DROP CONSTRAINT "open_questions_featureNodeId_fkey";

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_questions" ADD CONSTRAINT "open_questions_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

