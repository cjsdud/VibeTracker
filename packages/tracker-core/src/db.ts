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
  FeatureBranchActivity,
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
  return new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    // bootstrap처럼 수십 개 행을 만드는 트랜잭션이 원격 DB(Neon 등) 지연에서
    // 기본 5초 제한에 걸리지 않도록 여유를 준다
    transactionOptions: { timeout: 60_000, maxWait: 10_000 },
  });
}

/** 서비스 함수들이 트랜잭션 클라이언트도 받을 수 있도록 하는 최소 인터페이스 */
export type Db = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
