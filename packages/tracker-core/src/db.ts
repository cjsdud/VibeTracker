import { PrismaClient } from '../generated/client/index.js';

export { PrismaClient, Prisma } from '../generated/client/index.js';
export type {
  User,
  Project,
  Repository,
  GithubInstallation,
  McpToken,
  FeatureNode,
  FeatureRelation,
  FeatureEvidence,
  WorkUpdate,
  WorkUpdateFeature,
  ChangeProposal,
  FeatureTreeVersion,
  GithubEvent,
  VerificationRun,
  Job,
  AuditLog,
  InboxItem,
  OpenQuestion,
} from '../generated/client/index.js';

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  );
}

/** 서비스 함수들이 트랜잭션 클라이언트도 받을 수 있도록 하는 최소 인터페이스 */
export type Db = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
