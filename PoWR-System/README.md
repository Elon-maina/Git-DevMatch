# PoWR — Proof of Work Reputation

PoWR turns a developer's GitHub history into a verifiable reputation score. It analyzes real repositories, commits and pull requests, filters out low-effort spam, and scores developers across **Backend, Frontend, DevOps and Systems**. Scores can be anchored on the **Stacks blockchain** and earn soulbound (non-transferable) skill badges.

Recruiters can search verified developers, save talent pools, and post jobs and gigs.

## Features

- **GitHub login** — read-only OAuth access to public activity
- **Commit validation** — filters boilerplate and spam commits before scoring
- **Skill scoring** — profile across four engineering pillars
- **On-chain proofs** — score hashes anchored on Stacks
- **Soulbound badges** — Bronze, Silver and Gold skill NFTs
- **Recruiter dashboard** — talent search, saved pools, outreach
- **Jobs & gigs board**

## Tech Stack

| Part | Technology |
|------|------------|
| Frontend | Next.js, React, TanStack Query, Framer Motion |
| Backend | Node.js, Express, TypeScript |
| Database | MySQL 8 |
| Blockchain | Clarity smart contracts on Stacks |
| AI analysis | Gemini / OpenAI / Anthropic (configurable) |

## Project Structure

```
PoWR-System/
├── frontend/     # Next.js web app (port 3000)
├── backend/      # Express API (port 3001)
│   └── database/mysql/schema.sql   # full database schema
├── contracts/    # Clarity smart contracts
└── tests/        # contract tests (Vitest + Clarinet)
```

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL 8.0
- A GitHub OAuth app ([create one here](https://github.com/settings/developers))

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

Create `backend/.env`:

```env
PORT=3001
FRONTEND_URL=http://localhost:3000
DATABASE_URL=mysql://root:YOUR_PASSWORD@localhost:3306/powr

GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_CALLBACK_URL=http://localhost:3001/api/auth/github/callback

# At least one AI provider
GEMINI_API_KEY=your_key
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

> If your MySQL password contains `@ : / #`, URL-encode it (e.g. `@` → `%40`).

### 3. Set up the database

The backend creates the `powr` database and all tables automatically on startup. To create them manually instead:

```bash
mysql -u root -p < backend/database/mysql/schema.sql
```

### 4. Run the app

In two terminals:

```bash
cd backend && npm run dev     # http://localhost:3001
cd frontend && npm run dev    # http://localhost:3000
```

Open **http://localhost:3000**.

### Health checks

- API: http://localhost:3001/health
- Database: http://localhost:3001/health/db

## Testing

```bash
npm test               # smart contract tests (from project root)
cd backend && npm test # backend unit tests
```

## Privacy

PoWR only requests read access to public GitHub data and never asks for write permissions. Reputation badges are soulbound — they can't be bought, sold or transferred.
