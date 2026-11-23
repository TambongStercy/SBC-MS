/**
 * Shapes of the support-service desk API. Fixed by CONTRACT.md where it says
 * so (Agent, RecheckResult, SupportMember, payins, withdrawals, business
 * statuses); everything marked "assumed" was invented here so the screens
 * could be built in parallel with the backend, and is listed in the
 * frontend report. Change a shape here and TypeScript shows every screen
 * that depends on it.
 */

export interface PersonRef {
  id: string;
  name: string;
}

// ── Auth (CONTRACT §3.1) ────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export type LoginStep = 'totp' | 'enroll';

export interface LoginResult {
  step: LoginStep;
  challengeId: string;
}

export interface EnrollStart {
  otpauthUrl: string;
  qrDataUrl: string;
}

// ── Recheck (CONTRACT §2.2) ─────────────────────────────────────────────

export type RecheckOutcome = 'confirmed' | 'pending' | 'not_found' | 'failed' | 'provider_unavailable' | 'not_finished';

export interface RecheckResult {
  result: RecheckOutcome;
  provider: string;
  providerStatus: string;
  providerRef: string;
  amount?: number;
  currency?: string;
  checkedAt: string;
  requestId: string;
}

// ── Members (CONTRACT §2.1, masked by support-service) ──────────────────

export interface MemberHit {
  _id: string;
  name: string;
  country?: string;
  role?: string;
  createdAt?: string;
}

export interface MemberSubscription {
  type: string;
  category?: string;
  status: string;
  startDate?: string;
  endDate?: string | null;
}

/**
 * SupportMember as the desk returns it. `email` and `phoneNumber` arrive
 * already masked (`j•••@gmail.com`, `+237 6•• •• 34`) unless the agent has
 * `members.read.full`; the app shows them exactly as given.
 */
export interface SupportMember {
  _id: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  country?: string;
  city?: string;
  sex?: string;
  language?: string;
  role?: string;
  createdAt?: string;
  lastLogin?: string;
  isVerified?: boolean;
  blocked?: boolean;
  deleted?: boolean;
  referrerId?: string;
  referrerName?: string;
  balance?: number;
  usdBalance?: number;
  reservedBalance?: number;
  debt?: number;
  withdrawalLockedUntil?: string | null;
  subscriptions?: MemberSubscription[];
  /** assumed: true when contact fields are masked for this agent. */
  masked?: boolean;
  /** Security plan Phase 5: declared / usual / last country (Phase 1 signals). */
  geo?: { declared: string | null; usual: string | null; usualShare: number | null; last: string | null; lastAt: string | null } | null;
  /** Money frozen by support (withdrawals and transfers suspended). */
  frozen?: { at: string; reason: string | null } | null;
  /** Balance A (account) against B (opening + movements), per currency; finance readers only. */
  ledger?: { currency: 'XAF' | 'USD'; actual: number; expected: number; matches: boolean }[] | null;
  momoNumber?: string | null;
  momoOperator?: string | null;
}

export interface Payin {
  sessionId: string;
  gateway: string;
  amount: number;
  currency: string;
  status: string;
  purpose?: string;
  createdAt: string;
  gatewayRef?: string;
  /** Why it did not finish (payment-service Security plan Phase 10). */
  failure?: { group: 'sbc_code' | 'provider_api' | 'member' | 'unknown'; code: string; message: string | null; providerCode: string | null; step: string; at: string } | null;
  /** Failed attempts before this one on the same payment (retries). */
  earlierFailures?: number;
}

export type BusinessStatus =
  | 'REQUESTED' | 'PENDING_APPROVAL' | 'RESERVED' | 'SUBMITTED' | 'PENDING'
  | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED' | 'UNKNOWN';

export interface MemberWithdrawal {
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  businessStatus: BusinessStatus | string;
  method?: string;
  createdAt: string;
  updatedAt?: string;
}

// ── Tickets (assumed) ───────────────────────────────────────────────────

export type TicketStatus = 'new' | 'open' | 'waiting_member' | 'waiting_internal' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  category: string;
  queue: string;
  priority: TicketPriority;
  status: TicketStatus;
  /** `public`: sent from the form without an account (contact details only, unverified). */
  source: 'member' | 'assistant' | 'system' | 'agent' | 'public';
  /** `id` is null for a request sent without an account. */
  member: { id: string | null; name: string };
  /** Name, phone and email typed in the form: how to reach the person, never proof of identity. */
  contact?: { name: string | null; phone: string | null; email: string | null; verified: false } | null;
  assignee?: PersonRef | null;
  slaDueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  /** The member's OpenReplay session at the time of the ticket; the link comes from `ticketsApi.replayUrl` (audited). */
  replay?: { at: string | null } | null;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface TicketMessage {
  id: string;
  author: { type: 'member' | 'agent' | 'assistant' | 'system'; id?: string; name: string };
  body: string;
  /** Internal note: never shown to the member. */
  internal: boolean;
  attachments: Attachment[];
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  type: 'status' | 'assign' | 'priority' | 'created' | string;
  actor?: PersonRef;
  from?: string | null;
  to?: string | null;
  /** assign events: the agent's name (to holds the id). */
  toName?: string | null;
  reason?: string;
  at: string;
}

export interface TicketDetail {
  ticket: Ticket;
  messages: TicketMessage[];
  events: TicketEvent[];
}

export interface QueueCount {
  key: string;
  label: string;
  open: number;
}

// ── Content (assumed) ───────────────────────────────────────────────────

export interface ResponseTemplate {
  id: string;
  title: string;
  category: string;
  language: 'fr' | 'en';
  body: string;
  updatedAt?: string;
}

export type ArticleStatus = 'draft' | 'published' | 'archived';

export interface KbArticleSummary {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: ArticleStatus;
  version: number;
  publishedVersion?: number | null;
  updatedAt: string;
  updatedBy?: PersonRef;
}

export interface KbArticleVersion {
  version: number;
  title: string;
  body: string;
  createdAt: string;
  author?: PersonRef;
  published: boolean;
}

export interface KbArticle extends KbArticleSummary {
  body: string;
  versions: KbArticleVersion[];
}

export interface GuideNode {
  id: string;
  label: string;
  kind: 'question' | 'article' | 'route';
  articleSlug?: string;
  route?: 'activation' | 'withdrawal' | 'ticket' | 'contact';
  children: GuideNode[];
}

// ── Cases (activation + finance, assumed) ───────────────────────────────

export type CaseType =
  | 'activation' | 'withdrawal_divergence' | 'debit_missing' | 'paid_not_debited'
  | 'duplicate_callback' | 'unknown_status' | 'amount_mismatch' | 'ledger_mismatch'
  // Security plan Phase 5: fraud cases (opened by the fraud engine).
  | 'self_referral' | 'shared_payout_number' | 'multi_account' | 'abnormal_behavior' | 'geo_anomaly' | 'dormant_reactivation' | 'dormant_review';

export type CaseStatus = 'open' | 'in_progress' | 'waiting_provider' | 'resolved' | 'closed';
export type Severity = 'info' | 'warning' | 'critical';

export interface CaseComment {
  id: string;
  author: PersonRef;
  body: string;
  createdAt: string;
}

export interface SupportCase {
  id: string;
  type: CaseType;
  status: CaseStatus;
  severity: Severity;
  subject: { userId?: string; memberName?: string; transactionId?: string; sessionId?: string; gateway?: string };
  summary: string;
  details?: Record<string, unknown>;
  /** Member's country (country teams) and the money at stake (fraud queue). */
  country?: string | null;
  amount?: number | null;
  occurrences?: number;
  assignee?: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  checks?: RecheckResult[];
  comments?: CaseComment[];
}

// ── Finance (CONTRACT §2.2 relayed by support-service) ──────────────────

export type AgeBucket = '<24h' | '24-48h' | '48-72h' | '>72h';

export interface FinanceSummary {
  currency: string;
  byStatus: { status: BusinessStatus | string; count: number; amount: number }[];
  ageBuckets: { bucket: AgeBucket; count: number; amount: number }[];
}

export interface FinanceWithdrawal {
  transactionId: string;
  userId: string;
  memberName?: string;
  amount: number;
  currency: string;
  status: string;
  businessStatus: BusinessStatus | string;
  method?: string;
  gateway?: string;
  country?: string;
  createdAt: string;
  updatedAt?: string;
  ageBucket?: AgeBucket;
}

// ── Approvals (assumed) ─────────────────────────────────────────────────

export type ApprovalType = 'regularization' | 'manual_activation' | 'contact_change' | 'authenticator_reset' | 'account_freeze' | 'risk_release';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired' | 'cancelled';

export interface Approval {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  /** One line in French, written by the server ("Activation manuelle CIBLE pour …"). */
  summary: string;
  reason: string;
  payload: Record<string, unknown>;
  requestedBy: PersonRef;
  requestedAt: string;
  decidedBy?: PersonRef | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

// ── Views (CONTRACT addendum 1.2, assumed) ──────────────────────────────

export type ViewTaskState = 'available' | 'assigned' | 'in_progress' | 'approved' | 'rejected' | 'to_review' | 'closed';

export interface ViewProof {
  videoUrl: string;
  dayIndex: number;
  submittedAt: string;
  participationId?: string;
  campaign: { id?: string; name: string; targetViews?: number };
  diffuseur: { id: string; name: string; country?: string };
  history?: { at: string; label: string }[];
}

export interface ViewTask {
  id: string;
  sourceId: string;
  state: ViewTaskState;
  assignee?: PersonRef | null;
  assignedAt?: string | null;
  startedAt?: string | null;
  lastActivityAt?: string | null;
  decidedAt?: string | null;
  decision?: ViewDecision | null;
  observedViews?: number | null;
  reason?: string | null;
  version: number;
  country?: string;
  submittedAt: string;
  proof?: ViewProof;
}

export type ViewDecision = 'approve' | 'reject' | 'review' | 'technical_error' | 'already_decided';

export interface ViewAgentStatus {
  id: string;
  name: string;
  online: boolean;
  current?: { taskId: string; state: ViewTaskState; assignedAt?: string; startedAt?: string | null; lastActivityAt?: string | null; idleMinutes: number } | null;
  todayDecided: number;
  todayApproved: number;
  todayRejected: number;
}

export interface ViewBoard {
  counts: { available: number; assigned: number; in_progress: number; to_review: number };
  agents: ViewAgentStatus[];
  alerts: { taskId: string; agentId: string; agentName: string; idleMinutes: number; kind: 'unstarted' | 'idle' }[];
}

export type AssignmentMode = 'round_robin' | 'load' | 'manual';

export interface ViewSettings {
  assignmentMode: AssignmentMode;
  unstartedRequeueMinutes: number;
  idleAlertMinutes: number;
  qaSamplePercent: number;
}

export interface QaItem {
  task: ViewTask;
  verdict?: 'confirmed' | 'corrected' | null;
}

// ── Reports (assumed) ───────────────────────────────────────────────────

export interface AgentReportRow {
  agentId: string;
  name: string;
  roles: string[];
  ticketsHandled: number;
  ticketsResolved: number;
  avgFirstResponseMinutes: number | null;
  casesResolved: number;
  viewsDecided: number;
  viewsApproved: number;
  viewsRejected: number;
  viewsReassigned: number;
  avgDecisionSeconds: number | null;
  qaErrorRate: number | null;
}

export interface AgentReport {
  from: string;
  to: string;
  rows: AgentReportRow[];
}

// ── Administration (assumed) ────────────────────────────────────────────

export type AgentStatus = 'pending_activation' | 'active' | 'disabled';

export interface AgentAccount {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: AgentStatus;
  totpEnrolled: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  activeSessions: number;
  /** Country team (ISO codes); empty = every country. */
  countries?: string[];
  /** The agent's own SBC member account (they may never act on it or its referral tree). */
  memberUserId?: string | null;
}

export interface SettingEntry {
  key: string;
  value: unknown;
  updatedAt?: string;
  updatedBy?: PersonRef | null;
}

export interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  actor: { id: string; name: string; role?: string } | null;
  action: string;
  object?: { type: string; id: string } | null;
  reason?: string | null;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  before?: unknown;
  after?: unknown;
  hash: string;
  prevHash: string;
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  firstBrokenSeq?: number | null;
  verifiedAt: string;
}

/** Security plan Phase 4: the fraud engine's card on the member page (`risk.read`). */
export type RiskCard =
  | { available: false }
  | {
      available: true;
      score: number;
      decision: 'allow' | 'require_code' | 'hold';
      scoredAt: string | null;
      groupSize: number;
      reasons: { rule: string; points: number; detail: string; live: boolean; at?: string; expiresAt?: string }[];
      linked: { userId: string; name: string | null; country: string | null; score: number; decision: string }[];
      identifiers: { kind: 'phone' | 'device'; uses: string[]; tail: string; count: number; hub: boolean }[];
      events: { type: string; at: string; kind: string | null; amountXaf: number | null; numberTail: string | null }[];
      kyc: {
        score: number; band: 'low' | 'medium' | 'high'; reasons: string[]; emailDomain: string | null; checkedAt: string; variantAccounts: number;
        /** KYC level 2: services where the e-mail address is registered (flagged members only). */
        level2?: { found: string[]; asked: number; answered: number; gravatar: boolean | null; trigger: string | null; checkedAt: string } | null;
      } | null;
      /** Blocking mode: support's approved release (allowed while the score stays at or under scoreAtRelease). */
      release?: { at: string; by: { id: string; name: string } | null; reason: string | null; scoreAtRelease: number; endedAt: string | null; active: boolean } | null;
    };
