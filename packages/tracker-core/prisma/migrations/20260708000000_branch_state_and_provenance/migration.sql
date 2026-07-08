-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('GITHUB_WEBHOOK', 'MCP_RECORD', 'USER_MANUAL');

-- AlterTable
ALTER TABLE "feature_nodes" ADD COLUMN     "lastStatusSource" "ChangeSource";

-- AlterTable
ALTER TABLE "work_updates" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "commitShas" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "feature_branch_activities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featureNodeId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "summary" TEXT,
    "lastCommitSha" TEXT,
    "prNumber" INTEGER,
    "prState" TEXT,
    "ciFailed" BOOLEAN NOT NULL DEFAULT false,
    "source" "ChangeSource" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_branch_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_branch_activities_projectId_branch_idx" ON "feature_branch_activities"("projectId", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "feature_branch_activities_featureNodeId_branch_key" ON "feature_branch_activities"("featureNodeId", "branch");

-- AddForeignKey
ALTER TABLE "feature_branch_activities" ADD CONSTRAINT "feature_branch_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_branch_activities" ADD CONSTRAINT "feature_branch_activities_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

