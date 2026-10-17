import mysql, { PoolOptions, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import fs from "fs";
import path from "path";
import { Artifact } from "./artifactIngestion";
import { PoWProfile } from "./scoringEngine";

export interface Badge {
  id: number;
  username: string;
  tokenId: number | null;
  skillType: number;
  tier: number;
  transactionHash: string | null;
  stacksPrincipal: string | null;
  mintedAt: Date;
}

export interface GithubBadge {
  id: number;
  username: string;
  badgeKey: string;
  earnedAt: Date;
}

// Parse DATABASE_URL (mysql://user:pass@host:3306/dbname) into mysql2 options
export function mysqlConfigFromUrl(url = process.env.DATABASE_URL): PoolOptions & { database: string } {
  const u = new URL(url || "mysql://root@localhost:3306/powr");
  return {
    host: u.hostname || "localhost",
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username || "root"),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "powr",
    // Store and read all timestamps as UTC
    timezone: "Z",
    supportBigNumbers: true,
  };
}

const dbConfig = mysqlConfigFromUrl();

// Initialize MySQL connection pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
});

// Keep NOW()/CURRENT_TIMESTAMP in UTC to match the driver's timezone setting
pool.pool.on("connection", (conn: any) => {
  conn.query("SET time_zone = '+00:00'");
});

async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

async function exec(sql: string, params: any[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query<ResultSetHeader>(sql, params);
  return result;
}

function toDate(value: any): Date | null {
  if (value === undefined || value === null || value === "") return null;
  return value instanceof Date ? value : new Date(value);
}

// Initialize database and tables on startup from database/mysql/schema.sql
async function initializeTables() {
  const schemaPath = path.join(__dirname, "../../database/mysql/schema.sql");
  const schema = fs
    .readFileSync(schemaPath, "utf8")
    .replace(/^CREATE DATABASE[\s\S]*?;\s*$/m, "")
    .replace(/^USE\s+\w+;\s*$/m, "");

  const { database, ...serverConfig } = dbConfig;
  const conn = await mysql.createConnection({ ...serverConfig, multipleStatements: true });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${database}\``);
    await conn.query(schema);
    console.log(`MySQL tables initialized successfully (database: ${database})`);
  } finally {
    await conn.end();
  }
}

// Initialize tables when module loads — retry on failure (e.g. MySQL still starting)
function initializeTablesWithRetry(retries = 5, delayMs = 3000) {
  initializeTables().catch((err) => {
    const detail = err.message || err.code || err.errors?.map((e: any) => e.message).join("; ") || String(err);
    console.error(`[DB] Table init failed (${retries} retries left):`, detail);
    if (retries > 0) {
      setTimeout(() => initializeTablesWithRetry(retries - 1, delayMs), delayMs);
    }
  });
}
initializeTablesWithRetry();

export class DatabaseService {
  // User management
  async upsertUser(username: string, githubId: number, accessToken?: string, stacksPrincipal?: string) {
    await exec(`
      INSERT INTO users (username, github_id, access_token_encrypted, stacks_principal, last_updated)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        github_id = COALESCE(VALUES(github_id), github_id),
        access_token_encrypted = COALESCE(VALUES(access_token_encrypted), access_token_encrypted),
        stacks_principal = COALESCE(VALUES(stacks_principal), stacks_principal),
        last_updated = NOW()
    `, [username, githubId ?? null, accessToken ?? null, stacksPrincipal || null]);
  }

  async getUser(username: string) {
    const rows = await q("SELECT * FROM users WHERE username = ?", [username]);
    return rows[0] || null;
  }

  async updateStacksPrincipal(username: string, principal: string): Promise<void> {
    await exec(
      "UPDATE users SET stacks_principal = ?, last_updated = NOW() WHERE username = ?",
      [principal, username]
    );
  }

  async getUserStacksPrincipal(username: string): Promise<string | null> {
    const rows = await q("SELECT stacks_principal FROM users WHERE username = ?", [username]);
    return rows[0]?.stacks_principal || null;
  }

  // Artifact management
  async saveArtifacts(username: string, artifacts: Artifact[]) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM artifacts WHERE username = ?", [username]);

      for (const artifact of artifacts) {
        await conn.query(`
          INSERT INTO artifacts (id, username, type, data, timestamp, repository_owner, repository_name)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          artifact.id,
          username,
          artifact.type,
          JSON.stringify(artifact.data),
          artifact.timestamp,
          artifact.repository?.owner || null,
          artifact.repository?.name || null,
        ]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async getArtifacts(username: string, since?: Date): Promise<Artifact[]> {
    let query = "SELECT * FROM artifacts WHERE username = ?";
    const params: any[] = [username];

    if (since) {
      query += " AND timestamp >= ?";
      params.push(since.toISOString());
    }
    query += " ORDER BY timestamp DESC";

    const rows = await q(query, params);
    return rows.map((row) => ({
      type: row.type as "repo" | "commit" | "pull_request",
      id: row.id,
      data: row.data,
      timestamp: row.timestamp,
      repository: row.repository_owner && row.repository_name
        ? { owner: row.repository_owner, name: row.repository_name }
        : undefined,
    }));
  }

  // Profile management
  async saveProfile(username: string, profile: PoWProfile, artifactsCount: number, artifactHash?: string) {
    if (artifactHash) {
      await exec(`
        INSERT INTO profiles (username, profile_data, artifacts_count, current_artifact_hash, last_analyzed, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          profile_data = VALUES(profile_data),
          artifacts_count = VALUES(artifacts_count),
          current_artifact_hash = VALUES(current_artifact_hash),
          last_analyzed = NOW(),
          updated_at = NOW()
      `, [username, JSON.stringify(profile), artifactsCount, artifactHash]);
    } else {
      await exec(`
        INSERT INTO profiles (username, profile_data, artifacts_count, last_analyzed, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          profile_data = VALUES(profile_data),
          artifacts_count = VALUES(artifacts_count),
          last_analyzed = NOW(),
          updated_at = NOW()
      `, [username, JSON.stringify(profile), artifactsCount]);
    }
  }

  async getProfile(username: string): Promise<PoWProfile | null> {
    const rows = await q("SELECT * FROM profiles WHERE username = ?", [username]);
    if (!rows[0]) return null;
    return rows[0].profile_data;
  }

  async getProfileWithMeta(username: string): Promise<{
    profile: PoWProfile;
    lastAnalyzed: Date | null;
    artifactsCount: number;
    currentArtifactHash: string | null;
  } | null> {
    const rows = await q(
      "SELECT profile_data, last_analyzed, artifacts_count, current_artifact_hash FROM profiles WHERE username = ?",
      [username]
    );
    if (!rows[0]) return null;
    return {
      profile: rows[0].profile_data,
      lastAnalyzed: rows[0].last_analyzed ? new Date(rows[0].last_analyzed) : null,
      artifactsCount: rows[0].artifacts_count || 0,
      currentArtifactHash: rows[0].current_artifact_hash || null
    };
  }

  async shouldRefreshProfile(username: string, maxAgeHours: number = 24): Promise<boolean> {
    const rows = await q("SELECT last_analyzed FROM profiles WHERE username = ?", [username]);
    if (!rows[0]?.last_analyzed) return true;
    const lastAnalyzed = new Date(rows[0].last_analyzed);
    const hoursSince = (Date.now() - lastAnalyzed.getTime()) / (1000 * 60 * 60);
    return hoursSince >= maxAgeHours;
  }

  // Blockchain proof management
  async saveBlockchainProof(
    username: string,
    transactionHash: string,
    artifactHash: string,
    blockNumber: number,
    timestamp: number,
    skillScores: number[]
  ) {
    await exec(`
      INSERT INTO blockchain_proofs (username, transaction_hash, artifact_hash, block_number, timestamp, skill_scores)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE id = id
    `, [username, transactionHash, artifactHash, blockNumber, timestamp, JSON.stringify(skillScores)]);
  }

  private mapProof(row: any) {
    return {
      id: row.id,
      transactionHash: row.transaction_hash,
      artifactHash: row.artifact_hash,
      blockNumber: row.block_number,
      timestamp: row.timestamp,
      skillScores: row.skill_scores,
      createdAt: row.created_at,
    };
  }

  async getBlockchainProofs(username: string): Promise<any[]> {
    const rows = await q(
      "SELECT * FROM blockchain_proofs WHERE username = ? ORDER BY timestamp DESC",
      [username]
    );
    return rows.map((row) => this.mapProof(row));
  }

  async getLatestBlockchainProof(username: string): Promise<any | null> {
    const rows = await q(
      "SELECT * FROM blockchain_proofs WHERE username = ? ORDER BY timestamp DESC LIMIT 1",
      [username]
    );
    return rows[0] ? this.mapProof(rows[0]) : null;
  }

  // Subscription management
  async saveSubscription(username: string, subscription: any) {
    await exec(`
      INSERT INTO subscriptions (username, plan_type, status, payment_address, last_payment_tx_hash, next_update_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        plan_type = COALESCE(VALUES(plan_type), plan_type),
        status = COALESCE(VALUES(status), status),
        payment_address = COALESCE(VALUES(payment_address), payment_address),
        last_payment_tx_hash = COALESCE(VALUES(last_payment_tx_hash), last_payment_tx_hash),
        next_update_date = COALESCE(VALUES(next_update_date), next_update_date),
        updated_at = NOW()
    `, [
      username,
      subscription.plan_type || "free",
      subscription.status || "active",
      subscription.payment_address || null,
      subscription.last_payment_tx_hash || null,
      toDate(subscription.next_update_date),
    ]);
  }

  async createSubscription(username: string, planType: string, paymentAddress?: string, paymentTxHash?: string) {
    await this.saveSubscription(username, {
      plan_type: planType,
      status: "active",
      payment_address: paymentAddress,
      last_payment_tx_hash: paymentTxHash,
    });
  }

  async updateSubscription(username: string, updates: any) {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.plan_type !== undefined) {
      fields.push("plan_type = ?");
      values.push(updates.plan_type);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.nextUpdateDate !== undefined) {
      fields.push("next_update_date = ?");
      values.push(toDate(updates.nextUpdateDate));
    }
    if (updates.payment_address !== undefined) {
      fields.push("payment_address = ?");
      values.push(updates.payment_address);
    }
    fields.push("updated_at = NOW()");

    if (fields.length > 1) {
      await exec(
        `UPDATE subscriptions SET ${fields.join(", ")} WHERE username = ?`,
        [...values, username]
      );
    }
  }

  async cancelSubscription(username: string) {
    await exec(
      "UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE username = ?",
      [username]
    );
  }

  async getSubscription(username: string): Promise<any | null> {
    const rows = await q("SELECT * FROM subscriptions WHERE username = ?", [username]);
    const row = rows[0];
    if (!row) return null;
    return {
      username: row.username,
      planType: row.plan_type,
      status: row.status,
      paymentAddress: row.payment_address,
      lastPaymentTxHash: row.last_payment_tx_hash,
      nextUpdateDate: row.next_update_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateSubscriptionNextUpdate(username: string, nextUpdateDate: Date) {
    await exec(
      "UPDATE subscriptions SET next_update_date = ?, updated_at = NOW() WHERE username = ?",
      [toDate(nextUpdateDate), username]
    );
  }

  // Scheduled updates
  async scheduleUpdate(username: string, scheduledDate: Date, planType: string) {
    await exec(`
      INSERT INTO update_schedule (username, scheduled_date, status, plan_type)
      VALUES (?, ?, 'pending', ?)
    `, [username, toDate(scheduledDate), planType]);
  }

  async getScheduledUpdates(beforeDate?: Date): Promise<any[]> {
    let query = "SELECT * FROM update_schedule WHERE status = 'pending'";
    const params: any[] = [];

    if (beforeDate) {
      query += " AND scheduled_date <= ?";
      params.push(toDate(beforeDate));
    }
    query += " ORDER BY scheduled_date ASC";

    const rows = await q(query, params);
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      scheduledDate: row.scheduled_date,
      status: row.status,
      planType: row.plan_type,
    }));
  }

  async getPendingUpdates(): Promise<any[]> {
    return this.getScheduledUpdates(new Date());
  }

  async markUpdateComplete(id: number) {
    await exec("UPDATE update_schedule SET status = 'completed' WHERE id = ?", [id]);
  }

  async markScheduledUpdateComplete(id: number) {
    await this.markUpdateComplete(id);
  }

  async markUpdateFailed(id: number, error: string) {
    await exec("UPDATE update_schedule SET status = 'failed', error = ? WHERE id = ?", [error, id]);
  }

  async markScheduledUpdateFailed(id: number, error?: string) {
    await this.markUpdateFailed(id, error || "Unknown error");
  }

  // Payment management
  async savePaymentTransaction(
    username: string,
    txHash: string,
    amount: string,
    currency: string,
    planType: string,
    blockNumber?: number
  ) {
    await exec(`
      INSERT INTO payment_transactions (username, tx_hash, amount, currency, plan_type, block_number, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
      ON DUPLICATE KEY UPDATE id = id
    `, [username, txHash, amount, currency, planType, blockNumber || null]);
  }

  async getPaymentTransaction(txHash: string): Promise<any | null> {
    const rows = await q("SELECT * FROM payment_transactions WHERE tx_hash = ?", [txHash]);
    return rows[0] || null;
  }

  async updatePaymentStatus(txHash: string, status: string, blockNumber?: number) {
    await exec(
      "UPDATE payment_transactions SET status = ?, block_number = COALESCE(?, block_number) WHERE tx_hash = ?",
      [status, blockNumber ?? null, txHash]
    );
  }

  async updatePaymentTransactionStatus(txHash: string, status: string, blockNumber?: number) {
    await this.updatePaymentStatus(txHash, status, blockNumber);
  }

  // Badge management
  async saveBadge(
    username: string,
    tokenId: number | null,
    skillType: number,
    tier: number,
    txHash: string | null,
    stacksPrincipal: string | null
  ): Promise<void> {
    await exec(`
      INSERT INTO badges (username, token_id, skill_type, tier, transaction_hash, stacks_principal)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [username, tokenId, skillType, tier, txHash, stacksPrincipal]);
  }

  async getUserBadges(username: string): Promise<Badge[]> {
    const rows = await q("SELECT * FROM badges WHERE username = ? ORDER BY minted_at DESC", [username]);
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      tokenId: row.token_id,
      skillType: row.skill_type,
      tier: row.tier,
      transactionHash: row.transaction_hash,
      stacksPrincipal: row.stacks_principal,
      mintedAt: row.minted_at,
    }));
  }

  async getBadgeByTokenId(tokenId: number): Promise<any | null> {
    const rows = await q("SELECT * FROM badges WHERE token_id = ? LIMIT 1", [tokenId]);
    return rows[0] || null;
  }

  async saveGithubBadge(username: string, badgeKey: string): Promise<void> {
    await exec(
      `INSERT INTO github_badges (username, badge_key)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [username, badgeKey]
    );
  }

  async getGithubBadges(username: string): Promise<GithubBadge[]> {
    const rows = await q("SELECT * FROM github_badges WHERE username = ? ORDER BY earned_at DESC", [username]);
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      badgeKey: row.badge_key,
      earnedAt: row.earned_at,
    }));
  }

  // Recruiter management
  async getRecruiterByEmail(email: string): Promise<any | null> {
    const rows = await q("SELECT * FROM recruiters WHERE email = ?", [email]);
    return rows[0] || null;
  }

  async getRecruiterById(id: number): Promise<any | null> {
    const rows = await q(
      "SELECT id, email, company_name, company_size, plan, created_at, last_login FROM recruiters WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  }

  async createRecruiter(email: string, passwordHash: string, companyName: string, companySize?: string): Promise<any> {
    const result = await exec(`
      INSERT INTO recruiters (email, password_hash, company_name, company_size)
      VALUES (?, ?, ?, ?)
    `, [email, passwordHash, companyName, companySize || null]);
    const rows = await q(
      "SELECT id, email, company_name, company_size, plan, created_at FROM recruiters WHERE id = ?",
      [result.insertId]
    );
    return rows[0];
  }

  async updateRecruiterLastLogin(id: number): Promise<void> {
    await exec("UPDATE recruiters SET last_login = NOW() WHERE id = ?", [id]);
  }

  async updateRecruiterPlan(id: number, plan: string): Promise<void> {
    await exec("UPDATE recruiters SET plan = ? WHERE id = ?", [plan, id]);
  }

  async getRecruiterViewCount(recruiterId: number, since: Date): Promise<number> {
    const rows = await q(
      "SELECT COUNT(DISTINCT developer_username) AS count FROM recruiter_views WHERE recruiter_id = ? AND viewed_at >= ?",
      [recruiterId, toDate(since)]
    );
    return Number(rows[0].count);
  }

  async logRecruiterView(recruiterId: number, developerUsername: string): Promise<void> {
    await exec(
      "INSERT INTO recruiter_views (recruiter_id, developer_username) VALUES (?, ?)",
      [recruiterId, developerUsername]
    );
  }

  async getSavedPools(recruiterId: number): Promise<any[]> {
    return q(`
      SELECT sp.*, COUNT(pm.id) AS member_count
      FROM saved_pools sp
      LEFT JOIN pool_members pm ON pm.pool_id = sp.id
      WHERE sp.recruiter_id = ?
      GROUP BY sp.id
      ORDER BY sp.created_at DESC
    `, [recruiterId]);
  }

  async createSavedPool(recruiterId: number, name: string): Promise<any> {
    const result = await exec(
      "INSERT INTO saved_pools (recruiter_id, name) VALUES (?, ?)",
      [recruiterId, name]
    );
    const rows = await q("SELECT * FROM saved_pools WHERE id = ?", [result.insertId]);
    return rows[0];
  }

  async getPoolMembers(poolId: number): Promise<string[]> {
    const rows = await q(
      "SELECT developer_username FROM pool_members WHERE pool_id = ? ORDER BY added_at DESC",
      [poolId]
    );
    return rows.map((r: any) => r.developer_username);
  }

  async addToPool(poolId: number, username: string): Promise<void> {
    await exec(
      "INSERT INTO pool_members (pool_id, developer_username) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id",
      [poolId, username]
    );
  }

  async removeFromPool(poolId: number, username: string): Promise<void> {
    await exec(
      "DELETE FROM pool_members WHERE pool_id = ? AND developer_username = ?",
      [poolId, username]
    );
  }

  async deleteSavedPool(poolId: number, recruiterId: number): Promise<void> {
    await exec("DELETE FROM saved_pools WHERE id = ? AND recruiter_id = ?", [poolId, recruiterId]);
  }

  async createOutreach(recruiterId: number, developerUsername: string, message: string): Promise<any> {
    const result = await exec(`
      INSERT INTO outreach (recruiter_id, developer_username, message)
      VALUES (?, ?, ?)
    `, [recruiterId, developerUsername, message]);
    const rows = await q("SELECT * FROM outreach WHERE id = ?", [result.insertId]);
    return rows[0];
  }

  async getOutreachCount(recruiterId: number, since: Date): Promise<number> {
    const rows = await q(
      "SELECT COUNT(*) AS count FROM outreach WHERE recruiter_id = ? AND created_at >= ?",
      [recruiterId, toDate(since)]
    );
    return Number(rows[0].count);
  }

  // Talent search for recruiters
  async searchDevelopers(params: {
    skills?: string[];
    minScore?: number;
    maxScore?: number;
    activeWithinDays?: number;
    hasOnChainProof?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ developers: any[]; total: number }> {
    const { skills, minScore, maxScore, activeWithinDays, hasOnChainProof, page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const values: any[] = [];

    // Base: must have a profile
    let query = `
      SELECT
        u.username,
        p.profile_data,
        p.last_analyzed,
        p.artifacts_count,
        EXISTS(SELECT 1 FROM blockchain_proofs bp WHERE bp.username = u.username) AS has_on_chain_proof,
        s.plan_type
      FROM users u
      JOIN profiles p ON p.username = u.username
      LEFT JOIN subscriptions s ON s.username = u.username
    `;

    if (activeWithinDays) {
      conditions.push("p.last_analyzed >= NOW() - INTERVAL ? DAY");
      values.push(Number(activeWithinDays));
    }

    if (hasOnChainProof === true) {
      conditions.push("EXISTS(SELECT 1 FROM blockchain_proofs bp WHERE bp.username = u.username)");
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) AS count FROM (${query}) sub`;
    query += " ORDER BY p.last_analyzed IS NULL, p.last_analyzed DESC";

    const [dataRows, countRows] = await Promise.all([
      q(query + " LIMIT ? OFFSET ?", [...values, limit, offset]),
      q(countQuery, values),
    ]);

    const total = Number(countRows[0].count);

    const developers = dataRows
      .map((row: any) => {
        const profile = row.profile_data;
        if (!profile) return null;

        const topSkills = (profile.skills || [])
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 3);

        // Filter by score if needed
        if (minScore !== undefined && profile.overallIndex < minScore) return null;
        if (maxScore !== undefined && profile.overallIndex > maxScore) return null;

        // Filter by skills
        if (skills && skills.length > 0) {
          const devSkillNames = (profile.skills || []).map((s: any) => s.skill.toLowerCase());
          const hasAllSkills = skills.some((sk) => devSkillNames.includes(sk.toLowerCase()));
          if (!hasAllSkills) return null;
        }

        return {
          username: row.username,
          topSkills,
          overallIndex: profile.overallIndex || 0,
          lastActive: row.last_analyzed,
          hasOnChainProof: Boolean(row.has_on_chain_proof),
          proofCount: 0,
          artifactSummary: profile.artifactSummary || {},
        };
      })
      .filter(Boolean);

    return { developers, total };
  }

  // Cleanup
  async cleanupOldArtifacts(olderThanDays: number) {
    await exec("DELETE FROM artifacts WHERE created_at < NOW() - INTERVAL ? DAY", [olderThanDays]);
  }

  async cleanupOldProofs(olderThanDays: number) {
    await exec("DELETE FROM blockchain_proofs WHERE created_at < NOW() - INTERVAL ? DAY", [olderThanDays]);
  }

  // ── Jobs CRUD ──────────────────────────────────────────────────────────────
  async createJob(recruiterId: number, data: { title: string; company: string; location: string; salary?: string; type?: string; description?: string; tags?: string[] }): Promise<any> {
    const result = await exec(`
      INSERT INTO jobs (recruiter_id, title, company, location, salary, type, description, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [recruiterId, data.title, data.company, data.location, data.salary || null, data.type || 'full-time', data.description || null, JSON.stringify(data.tags || [])]);
    const rows = await q("SELECT * FROM jobs WHERE id = ?", [result.insertId]);
    return rows[0];
  }

  async getJobs(params?: { status?: string; limit?: number; offset?: number }): Promise<{ jobs: any[]; total: number }> {
    const { status = 'active', limit = 20, offset = 0 } = params || {};
    const [jobs, countRows] = await Promise.all([
      q('SELECT j.*, r.company_name AS recruiter_company FROM jobs j LEFT JOIN recruiters r ON r.id = j.recruiter_id WHERE j.status = ? ORDER BY j.created_at DESC LIMIT ? OFFSET ?', [status, limit, offset]),
      q('SELECT COUNT(*) AS count FROM jobs WHERE status = ?', [status]),
    ]);
    return { jobs, total: Number(countRows[0].count) };
  }

  async getJobsByRecruiter(recruiterId: number): Promise<any[]> {
    return q('SELECT * FROM jobs WHERE recruiter_id = ? ORDER BY created_at DESC', [recruiterId]);
  }

  async getJobById(id: number): Promise<any | null> {
    const rows = await q('SELECT j.*, r.company_name AS recruiter_company FROM jobs j LEFT JOIN recruiters r ON r.id = j.recruiter_id WHERE j.id = ?', [id]);
    return rows[0] || null;
  }

  async updateJob(id: number, recruiterId: number, data: Partial<{ title: string; company: string; location: string; salary: string; type: string; description: string; tags: string[]; status: string }>): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.company !== undefined) { fields.push('company = ?'); values.push(data.company); }
    if (data.location !== undefined) { fields.push('location = ?'); values.push(data.location); }
    if (data.salary !== undefined) { fields.push('salary = ?'); values.push(data.salary); }
    if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    fields.push('updated_at = NOW()');
    const result = await exec(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ? AND recruiter_id = ?`, [...values, id, recruiterId]);
    if (result.affectedRows === 0) return null;
    const rows = await q('SELECT * FROM jobs WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async deleteJob(id: number, recruiterId: number): Promise<void> {
    await exec('DELETE FROM jobs WHERE id = ? AND recruiter_id = ?', [id, recruiterId]);
  }

  // ── Gigs CRUD ──────────────────────────────────────────────────────────────
  async createGig(recruiterId: number, data: { title: string; client: string; location: string; rate?: string; duration?: string; description?: string; tags?: string[] }): Promise<any> {
    const result = await exec(`
      INSERT INTO gigs (recruiter_id, title, client, location, rate, duration, description, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [recruiterId, data.title, data.client, data.location, data.rate || null, data.duration || null, data.description || null, JSON.stringify(data.tags || [])]);
    const rows = await q("SELECT * FROM gigs WHERE id = ?", [result.insertId]);
    return rows[0];
  }

  async getGigs(params?: { status?: string; limit?: number; offset?: number }): Promise<{ gigs: any[]; total: number }> {
    const { status = 'active', limit = 20, offset = 0 } = params || {};
    const [gigs, countRows] = await Promise.all([
      q('SELECT g.*, r.company_name AS recruiter_company FROM gigs g LEFT JOIN recruiters r ON r.id = g.recruiter_id WHERE g.status = ? ORDER BY g.created_at DESC LIMIT ? OFFSET ?', [status, limit, offset]),
      q('SELECT COUNT(*) AS count FROM gigs WHERE status = ?', [status]),
    ]);
    return { gigs, total: Number(countRows[0].count) };
  }

  async getGigsByRecruiter(recruiterId: number): Promise<any[]> {
    return q('SELECT * FROM gigs WHERE recruiter_id = ? ORDER BY created_at DESC', [recruiterId]);
  }

  async getGigById(id: number): Promise<any | null> {
    const rows = await q('SELECT g.*, r.company_name AS recruiter_company FROM gigs g LEFT JOIN recruiters r ON r.id = g.recruiter_id WHERE g.id = ?', [id]);
    return rows[0] || null;
  }

  async updateGig(id: number, recruiterId: number, data: Partial<{ title: string; client: string; location: string; rate: string; duration: string; description: string; tags: string[]; status: string }>): Promise<any> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.client !== undefined) { fields.push('client = ?'); values.push(data.client); }
    if (data.location !== undefined) { fields.push('location = ?'); values.push(data.location); }
    if (data.rate !== undefined) { fields.push('rate = ?'); values.push(data.rate); }
    if (data.duration !== undefined) { fields.push('duration = ?'); values.push(data.duration); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    fields.push('updated_at = NOW()');
    const result = await exec(`UPDATE gigs SET ${fields.join(', ')} WHERE id = ? AND recruiter_id = ?`, [...values, id, recruiterId]);
    if (result.affectedRows === 0) return null;
    const rows = await q('SELECT * FROM gigs WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async deleteGig(id: number, recruiterId: number): Promise<void> {
    await exec('DELETE FROM gigs WHERE id = ? AND recruiter_id = ?', [id, recruiterId]);
  }

  // ── Nostr pubkey helpers ───────────────────────────────────────────────────
  async updateUserNostrPubkey(username: string, pubkey: string): Promise<void> {
    await exec('UPDATE users SET nostr_pubkey = ?, last_updated = NOW() WHERE username = ?', [pubkey, username]);
  }

  async getUserNostrPubkey(username: string): Promise<string | null> {
    const rows = await q('SELECT nostr_pubkey FROM users WHERE username = ?', [username]);
    return rows[0]?.nostr_pubkey || null;
  }

  async updateRecruiterNostrPubkey(recruiterId: number, pubkey: string): Promise<void> {
    await exec('UPDATE recruiters SET nostr_pubkey = ? WHERE id = ?', [pubkey, recruiterId]);
  }

  // Used by /health/db
  async ping(): Promise<Date> {
    const rows = await q("SELECT NOW() AS time");
    return rows[0].time;
  }
}

export const dbService = new DatabaseService();
