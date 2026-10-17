-- PoWR System — full MySQL 8.0 schema
-- Run with:  mysql -u root -p < backend/database/mysql/schema.sql
-- The backend also creates any missing tables on startup.

CREATE DATABASE IF NOT EXISTS powr
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE powr;

-- ── Developers (GitHub users) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  username               VARCHAR(255) NOT NULL PRIMARY KEY,
  github_id              BIGINT NULL,
  access_token_encrypted TEXT NULL,
  stacks_principal       VARCHAR(255) NULL,
  nostr_pubkey           VARCHAR(255) NULL,
  last_updated           TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_at             TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- GitHub artifacts (repos, commits, PRs) collected per user
CREATE TABLE IF NOT EXISTS artifacts (
  id               VARCHAR(255) NOT NULL PRIMARY KEY,
  username         VARCHAR(255) NULL,
  type             VARCHAR(50) NULL,
  data             JSON NULL,
  timestamp        VARCHAR(64) NULL,
  repository_owner VARCHAR(255) NULL,
  repository_name  VARCHAR(255) NULL,
  created_at       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_artifacts_username (username),
  INDEX idx_artifacts_timestamp (timestamp),
  CONSTRAINT fk_artifacts_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

-- Computed Proof-of-Work profile per user
CREATE TABLE IF NOT EXISTS profiles (
  username              VARCHAR(255) NOT NULL PRIMARY KEY,
  profile_data          JSON NULL,
  artifacts_count       INT NULL,
  last_analyzed         TIMESTAMP NULL,
  current_artifact_hash VARCHAR(255) NULL,
  created_at            TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

-- On-chain proof anchors
CREATE TABLE IF NOT EXISTS blockchain_proofs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  username         VARCHAR(255) NULL,
  transaction_hash VARCHAR(255) NULL UNIQUE,
  artifact_hash    VARCHAR(255) NULL,
  block_number     BIGINT NULL,
  timestamp        BIGINT NULL,
  skill_scores     JSON NULL,
  created_at       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_proofs_username (username),
  CONSTRAINT fk_proofs_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

-- ── Subscriptions & payments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  username             VARCHAR(255) NOT NULL PRIMARY KEY,
  plan_type            VARCHAR(50) NOT NULL DEFAULT 'free',
  status               VARCHAR(50) NOT NULL DEFAULT 'active',
  payment_address      VARCHAR(255) NULL,
  last_payment_tx_hash VARCHAR(255) NULL,
  next_update_date     TIMESTAMP NULL,
  webhook_secret       VARCHAR(255) NULL,
  created_at           TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at           TIMESTAMP NULL,
  INDEX idx_subscriptions_status (status),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS update_schedule (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(255) NOT NULL,
  scheduled_date TIMESTAMP NOT NULL,
  status         VARCHAR(50) NOT NULL DEFAULT 'pending',
  plan_type      VARCHAR(50) NOT NULL,
  error          TEXT NULL,
  created_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_update_schedule_date (scheduled_date),
  CONSTRAINT fk_update_schedule_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(255) NOT NULL,
  tx_hash      VARCHAR(255) NOT NULL UNIQUE,
  amount       VARCHAR(100) NOT NULL,
  currency     VARCHAR(20) NOT NULL,
  plan_type    VARCHAR(50) NOT NULL,
  status       VARCHAR(50) NOT NULL DEFAULT 'pending',
  block_number BIGINT NULL,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_tx_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

-- ── Badges ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  username         VARCHAR(255) NULL,
  token_id         INT NULL,
  skill_type       INT NOT NULL,
  tier             INT NOT NULL,
  transaction_hash VARCHAR(255) NULL,
  stacks_principal VARCHAR(255) NULL,
  minted_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_badges_username (username),
  INDEX idx_badges_token_id (token_id),
  CONSTRAINT fk_badges_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS github_badges (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  username  VARCHAR(255) NULL,
  badge_key VARCHAR(100) NOT NULL,
  earned_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_github_badges (username, badge_key),
  INDEX idx_github_badges_username (username),
  CONSTRAINT fk_github_badges_user FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB;

-- ── Recruiters ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruiters (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  company_name  VARCHAR(255) NOT NULL,
  company_size  VARCHAR(50) NULL,
  plan          VARCHAR(50) NOT NULL DEFAULT 'free',
  nostr_pubkey  VARCHAR(255) NULL,
  created_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  last_login    TIMESTAMP NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recruiter_views (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  recruiter_id       INT NULL,
  developer_username VARCHAR(255) NOT NULL,
  viewed_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recruiter_views_recruiter (recruiter_id),
  INDEX idx_recruiter_views_viewed_at (viewed_at),
  CONSTRAINT fk_recruiter_views_recruiter FOREIGN KEY (recruiter_id) REFERENCES recruiters(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outreach (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  recruiter_id       INT NULL,
  developer_username VARCHAR(255) NOT NULL,
  message            TEXT NULL,
  status             VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at         TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_outreach_recruiter (recruiter_id),
  CONSTRAINT fk_outreach_recruiter FOREIGN KEY (recruiter_id) REFERENCES recruiters(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS saved_pools (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  recruiter_id INT NULL,
  name         VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_saved_pools_recruiter (recruiter_id),
  CONSTRAINT fk_saved_pools_recruiter FOREIGN KEY (recruiter_id) REFERENCES recruiters(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pool_members (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  pool_id            INT NULL,
  developer_username VARCHAR(255) NOT NULL,
  added_at           TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pool_member (pool_id, developer_username),
  CONSTRAINT fk_pool_members_pool FOREIGN KEY (pool_id) REFERENCES saved_pools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Job board ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  recruiter_id INT NULL,
  title        VARCHAR(255) NOT NULL,
  company      VARCHAR(255) NOT NULL,
  location     VARCHAR(255) NOT NULL,
  salary       VARCHAR(100) NULL,
  type         VARCHAR(50) NOT NULL DEFAULT 'full-time',
  description  TEXT NULL,
  tags         JSON NULL,
  status       VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_jobs_status (status),
  INDEX idx_jobs_recruiter (recruiter_id),
  CONSTRAINT fk_jobs_recruiter FOREIGN KEY (recruiter_id) REFERENCES recruiters(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gigs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  recruiter_id INT NULL,
  title        VARCHAR(255) NOT NULL,
  client       VARCHAR(255) NOT NULL,
  location     VARCHAR(255) NOT NULL,
  rate         VARCHAR(100) NULL,
  duration     VARCHAR(100) NULL,
  description  TEXT NULL,
  tags         JSON NULL,
  status       VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gigs_status (status),
  INDEX idx_gigs_recruiter (recruiter_id),
  CONSTRAINT fk_gigs_recruiter FOREIGN KEY (recruiter_id) REFERENCES recruiters(id) ON DELETE CASCADE
) ENGINE=InnoDB;
