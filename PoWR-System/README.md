# PoWR: Proof of Work Reputation 

PoWR turns your GitHub history into a verifiable, tamper-proof reputation score—backed by real artifacts and anchored on the Stacks blockchain. By replacing keyword-stuffed resumes with an objective calculation of a developer's real output, PoWR bridges the gap between engineering talent and technical recruiters.

This version introduces an **automated Spam Filter** and an **Algorithmic Commit Validation Engine** to keep reputation metrics authentic and free from superficial contribution padding.

---

## How It Works

1. **Connect GitHub:** Securely authenticate via OAuth. The engine reads public repositories, commits, and pull requests.
2. **Algorithmic Validation:** Every commit passes through an analysis engine that evaluates git diffs, filters out boilerplate/documentation spam, and calculates a true developer weight.
3. **Multi-Dimensional Scoring:** Validated commits generate an engineering score mapped across four core pillars: **Backend, Frontend, DevOps, and Systems**.
4. **On-Chain Anchoring:** Your finalized reputation score is hashed and permanently anchored to the Stacks blockchain, allowing developers to mint non-transferable, soulbound NFT badges (Bronze, Silver, and Gold).

---

## The Commit Validation Framework

To protect open-source projects from low-effort contribution spam (e.g., mass white-space formatting or minor typo corrections across dozens of repositories), PoWR evaluates the legitimacy of each commit. 

The algorithm assigns an engineering weight $W$ to each commit by analyzing lines added ($a$), lines deleted ($d$), and the number of unique structural identifiers changed ($u$), bounded by a dynamic pattern-matching spam penalty coefficient $P_s$:

$$W = P_s \cdot \ln\left(1 + \frac{a + d}{\sqrt{u + 1}}\right)$$

* If a commit’s calculated weight $W$ falls below our baseline validity threshold, or if $P_s$ flags repeating global patterns, the commit is classified as spam and excluded from the user's reputation score.

---

## Tech Stack

* **Frontend:** Next.js, React, Tailwind CSS
* **Backend Engine:** Node.js, Python (for Git patch analysis & processing)
* **Smart Contracts:** Clarity (Deployed on the Stacks Blockchain)
* **Data Sources:** GitHub REST & GraphQL APIs

---

##  Getting Started

### Prerequisites
* Node.js v18+
* Python 3.9+
* [Clarinet](https://github.com/hirosystems/clarinet) (for smart contract testing)

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/your-username/powr.git](https://github.com/your-username/powr.git)
   cd powr

    Install dependencies:
    Bash

    # Install frontend & gateway dependencies
    npm install

    # Install validation engine requirements
    cd engine && pip install -r requirements.txt

    Set up environment variables: Create a .env file in the root directory and add your keys:
    Code snippet

    GITHUB_CLIENT_ID=your_github_client_id
    GITHUB_CLIENT_SECRET=your_github_client_secret
    STACKS_API_URL=[https://api.mainnet.hiro.so](https://api.mainnet.hiro.so)
    VALIDATION_SECRET=your_backend_secret

    Run the local development server:
    Bash

    npm run dev

    Open http://localhost:3000 to view the application in your browser.

🛡️ Privacy & Security

    Read-Only Permissions: PoWR only requests access to public repository histories. We never request write permissions to your GitHub account.

    Soulbound Integrity: The reputation tokens minted via our Clarity smart contracts are non-transferable. Your reputation belongs to your cryptographic identity—it cannot be bought, sold, or traded.

    ---
## **Challenges We Ran Into**
The absolute hardest part was writing an algorithm that could judge code quality without being biased or penalizing junior developers making genuine, small updates. We had to build a mathematical validation framework to weight commits dynamically.

If a commit falls below our dynamic validity threshold, it gets filtered out of the reputation score. Fine-tuning these parameters so they correctly flagged automated spam without breaking a legitimate developer's score took an intense amount of backtesting and data tweaking.

---

## Accomplishments That We're Proud Of
Seamless Web2 to Web3 Pipeline: Moving from a standard GitHub login to an on-chain, Bitcoin-backed cryptographic proof in just a couple of clicks.

Real-Time Spam Filter: Building an open-source filter that actively protects the integrity of developer stats.

Recruiter-Ready Profiles: Creating a gorgeous, shareable user profile page (/u/username) that tells a recruiter exactly what a dev is capable of at a single glance.

## What We Learned
We learned that quantifying human code output is an incredibly nuanced problem—numbers don't always tell the whole story, which is why refining the context of a commit is so vital.

On the infrastructure side, we got a deep masterclass in writing secure Clarity contracts and understanding how to anchor decentralized web identity natively using the Stacks ecosystem.

---

## What's Next for PoWR System 
Decentralized Verification Layer: We want to introduce a community-driven verification layer, where veteran maintainers can act as a decentralized oracle to review disputed commit scores.

Recruiter Outreach Panel: We plan to build out a dedicated talent sourcing dashboard for tech recruiters, complete with secure escrow milestones, allowing them to directly hire verified open-source legends right from the platform.

