-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ImplementationStatus" AS ENUM ('NOT_STARTED', 'PARTIAL', 'IMPLEMENTED', 'CHANGED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNKNOWN', 'NEEDS_VERIFICATION', 'PASSED', 'FAILED', 'MANUAL_VERIFIED');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('MERGED_INTO', 'SPLIT_FROM', 'REPLACED_BY');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('FILE', 'ROUTE', 'API_ENDPOINT', 'TEST', 'COMMIT', 'PULL_REQUEST', 'DOCUMENT', 'WORK_UPDATE');

-- CreateEnum
CREATE TYPE "WorkUpdateSource" AS ENUM ('MCP', 'GITHUB', 'USER');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('CREATE', 'RETIRE', 'RENAME', 'MOVE', 'MERGE', 'SPLIT', 'REPLACE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TreeVersionCause" AS ENUM ('BOOTSTRAP_APPROVED', 'PROPOSAL_APPLIED', 'MANUAL_EDIT');

-- CreateEnum
CREATE TYPE "GithubEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "VerificationSource" AS ENUM ('CI', 'MCP', 'MANUAL');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "InboxItemType" AS ENUM ('FEATURE_MAP_REVIEW', 'STRUCTURE_PROPOSAL', 'UNTRACKED_CHANGE', 'EVIDENCE_MISMATCH', 'TEST_FAILURE');

-- CreateEnum
CREATE TYPE "InboxItemStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "githubId" BIGINT,
    "githubLogin" TEXT,
    "avatarUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "githubInstallationId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tokens" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_nodes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'DRAFT',
    "implementationStatus" "ImplementationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastChangedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_relations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromFeatureId" TEXT NOT NULL,
    "toFeatureId" TEXT NOT NULL,
    "type" "RelationType" NOT NULL,
    "proposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_evidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featureNodeId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "path" TEXT,
    "ref" TEXT,
    "title" TEXT,
    "url" TEXT,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "workUpdateId" TEXT,
    "githubEventId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_updates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "WorkUpdateSource" NOT NULL DEFAULT 'MCP',
    "summary" TEXT NOT NULL,
    "changedFiles" JSONB NOT NULL DEFAULT '[]',
    "gitHeadSha" TEXT,
    "testsStatus" TEXT,
    "testsPassed" INTEGER,
    "testsFailed" INTEGER,
    "testsSummary" TEXT,
    "manualCheck" BOOLEAN NOT NULL DEFAULT false,
    "nextTask" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_update_features" (
    "id" TEXT NOT NULL,
    "workUpdateId" TEXT NOT NULL,
    "featureNodeId" TEXT NOT NULL,

    CONSTRAINT "work_update_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_proposals" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ProposalType" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "targetFeatureIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "evidence" JSONB,
    "source" "WorkUpdateSource" NOT NULL DEFAULT 'MCP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "appliedTreeVersionId" TEXT,

    CONSTRAINT "change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_tree_versions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "cause" "TreeVersionCause" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeProposalId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_tree_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_events" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "action" TEXT,
    "payload" JSONB NOT NULL,
    "status" "GithubEventStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "github_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featureNodeId" TEXT,
    "workUpdateId" TEXT,
    "commitSha" TEXT,
    "source" "VerificationSource" NOT NULL,
    "status" "VerificationOutcome" NOT NULL,
    "name" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "InboxItemType" NOT NULL,
    "status" "InboxItemStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "changeProposalId" TEXT,
    "githubEventId" TEXT,
    "featureNodeId" TEXT,
    "workUpdateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_questions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featureNodeId" TEXT,
    "workUpdateId" TEXT,
    "question" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "open_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_githubId_key" ON "users"("githubId");

-- CreateIndex
CREATE INDEX "projects_userId_idx" ON "projects"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_projectId_key" ON "repositories"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_installationId_key" ON "github_installations"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tokens_tokenHash_key" ON "mcp_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "mcp_tokens_projectId_idx" ON "mcp_tokens"("projectId");

-- CreateIndex
CREATE INDEX "feature_nodes_projectId_lifecycle_idx" ON "feature_nodes"("projectId", "lifecycle");

-- CreateIndex
CREATE INDEX "feature_nodes_parentId_idx" ON "feature_nodes"("parentId");

-- CreateIndex
CREATE INDEX "feature_relations_projectId_idx" ON "feature_relations"("projectId");

-- CreateIndex
CREATE INDEX "feature_evidence_projectId_type_path_idx" ON "feature_evidence"("projectId", "type", "path");

-- CreateIndex
CREATE INDEX "feature_evidence_featureNodeId_idx" ON "feature_evidence"("featureNodeId");

-- CreateIndex
CREATE INDEX "work_updates_projectId_createdAt_idx" ON "work_updates"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "work_updates_gitHeadSha_idx" ON "work_updates"("gitHeadSha");

-- CreateIndex
CREATE INDEX "work_update_features_featureNodeId_idx" ON "work_update_features"("featureNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "work_update_features_workUpdateId_featureNodeId_key" ON "work_update_features"("workUpdateId", "featureNodeId");

-- CreateIndex
CREATE INDEX "change_proposals_projectId_status_idx" ON "change_proposals"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "feature_tree_versions_projectId_version_key" ON "feature_tree_versions"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "github_events_deliveryId_key" ON "github_events"("deliveryId");

-- CreateIndex
CREATE INDEX "github_events_projectId_receivedAt_idx" ON "github_events"("projectId", "receivedAt");

-- CreateIndex
CREATE INDEX "verification_runs_projectId_createdAt_idx" ON "verification_runs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_runs_commitSha_idx" ON "verification_runs"("commitSha");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "audit_logs_projectId_createdAt_idx" ON "audit_logs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "inbox_items_projectId_status_createdAt_idx" ON "inbox_items"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "open_questions_projectId_status_idx" ON "open_questions"("projectId", "status");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_githubInstallationId_fkey" FOREIGN KEY ("githubInstallationId") REFERENCES "github_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_nodes" ADD CONSTRAINT "feature_nodes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_nodes" ADD CONSTRAINT "feature_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "feature_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_relations" ADD CONSTRAINT "feature_relations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_relations" ADD CONSTRAINT "feature_relations_fromFeatureId_fkey" FOREIGN KEY ("fromFeatureId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_relations" ADD CONSTRAINT "feature_relations_toFeatureId_fkey" FOREIGN KEY ("toFeatureId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_evidence" ADD CONSTRAINT "feature_evidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_evidence" ADD CONSTRAINT "feature_evidence_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_evidence" ADD CONSTRAINT "feature_evidence_workUpdateId_fkey" FOREIGN KEY ("workUpdateId") REFERENCES "work_updates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_evidence" ADD CONSTRAINT "feature_evidence_githubEventId_fkey" FOREIGN KEY ("githubEventId") REFERENCES "github_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_updates" ADD CONSTRAINT "work_updates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_update_features" ADD CONSTRAINT "work_update_features_workUpdateId_fkey" FOREIGN KEY ("workUpdateId") REFERENCES "work_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_update_features" ADD CONSTRAINT "work_update_features_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_tree_versions" ADD CONSTRAINT "feature_tree_versions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_tree_versions" ADD CONSTRAINT "feature_tree_versions_changeProposalId_fkey" FOREIGN KEY ("changeProposalId") REFERENCES "change_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_events" ADD CONSTRAINT "github_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_workUpdateId_fkey" FOREIGN KEY ("workUpdateId") REFERENCES "work_updates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_changeProposalId_fkey" FOREIGN KEY ("changeProposalId") REFERENCES "change_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_githubEventId_fkey" FOREIGN KEY ("githubEventId") REFERENCES "github_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_workUpdateId_fkey" FOREIGN KEY ("workUpdateId") REFERENCES "work_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_questions" ADD CONSTRAINT "open_questions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_questions" ADD CONSTRAINT "open_questions_featureNodeId_fkey" FOREIGN KEY ("featureNodeId") REFERENCES "feature_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_questions" ADD CONSTRAINT "open_questions_workUpdateId_fkey" FOREIGN KEY ("workUpdateId") REFERENCES "work_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
