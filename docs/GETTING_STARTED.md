# Getting Started — Step by Step (for Dummies)

> No prior experience assumed. Follow this top to bottom and you'll have the app running on a
> **demo account** in ~15 minutes. If a step fails, jump to [Troubleshooting](#troubleshooting).

> ### ⚠️ Before anything: this is educational
> Run it on an **IQ Option PRACTICE (demo) account**. Binary options are stacked against you, and
> automated trading can get real accounts frozen. See the main [README](../README.md) disclaimer.

---

## Step 0 — What you'll need (and where to get it)

| Thing | Why | Where to get it | Cost |
|-------|-----|-----------------|------|
| **Python 3.11+** | Runs the backend | https://www.python.org/downloads | Free |
| **Node.js 18+** | Runs the dashboard | https://nodejs.org | Free |
| **Git** | Installs the broker library | https://git-scm.com/downloads | Free |
| **IQ Option account** | The broker | https://iqoption.com (use the demo!) | Free |
| **DeepSeek API key** | Powers the AI agents (optional) | https://platform.deepseek.com | ~cents |
| **NewsAPI key** | Market headlines (optional) | https://newsapi.org | Free tier |

> The two "optional" keys just switch off the AI/news features if missing — the bot still trades
> using its 21 built-in strategies. Start without them if you want.

### How to check what you already have

Open a terminal (PowerShell on Windows) and run:

```bash
python --version    # should say 3.11 or higher
node --version      # should say v18 or higher
git --version       # any recent version
```

If any says "not recognized," install it from the link above and reopen the terminal.

---

## Step 1 — Get the code onto a LOCAL disk

```bash
git clone https://github.com/<your-username>/binary-quant-trader.git
cd binary-quant-trader
```

> 🚫 **Do NOT put this in a Google Drive / OneDrive folder.** Those are "virtual drives" — the heavy
> file activity of installing dependencies corrupts them. Use a normal local folder like
> `C:\Users\you\projects\`. (This is a real problem we hit; it will waste hours if ignored.)

---

## Step 2 — Get your API keys (optional but recommended)

### DeepSeek (the AI brain)
1. Go to https://platform.deepseek.com and sign up.
2. Add a few dollars of credit (the agents are cheap — cents per session).
3. Create an API key and copy it. It looks like `sk-xxxxxxxx...`.

### NewsAPI (market headlines)
1. Go to https://newsapi.org, sign up (free).
2. Copy your API key from the dashboard.

*Skip this step to run without AI/news — the bot still works with its built-in strategies.*

---

## Step 3 — Configure your credentials

You have **two options** — pick one:

### Option A — Type them in the dashboard (easiest)
Just run the app (Step 4) and fill in email, password, and API keys in the left-hand config panel.
Nothing to edit. Good for a first try.

### Option B — Use a `.env` file (better for regular use)
1. Copy the template:
   ```bash
   cd backend
   copy .env.example .env      # Windows
   # cp .env.example .env      # Mac/Linux
   ```
2. Open `backend/.env` in a text editor and fill it in:
   ```env
   IQ_EMAIL=your_demo_email@example.com
   IQ_PASSWORD=your_password
   ACCOUNT_TYPE=PRACTICE

   AI_PROVIDER=deepseek
   AI_API_KEY=sk-your-deepseek-key
   NEWS_API_KEY=your-newsapi-key
   ```

> 🔒 **The `.env` file is never uploaded to GitHub** (it's in `.gitignore`). Keep your real keys only
> there. Never paste real keys into code or into a public issue.

---

## Step 4 — Run it

### The easy way (one command)
From the project root:
```bash
python run.py
```
This installs everything the first time (be patient — a few minutes), then starts both servers.
When it's done, open your browser at:

- **Dashboard → http://localhost:3010**

### The manual way (two terminals, if `run.py` misbehaves)

**Terminal 1 — backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\python -m pip install -r requirements.txt     # Windows
python -m uvicorn main:app --port 8100
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm install
npm run dev        # opens on http://localhost:3000
```

---

## Step 5 — Start trading (on demo!)

1. In the dashboard's **left config panel**, confirm **Account = PRACTICE**.
2. Enter your IQ Option email + password (or confirm they loaded from `.env`).
3. Pick a **timeframe** (1m is the recommended default) and some **assets**.
4. (Optional) Choose your **AI provider** and paste the API key.
5. Click **Start**. Watch the **Console** tab — you'll see it connect, evaluate strategies, and trade.

---

## Step 6 — Read the dashboard

| Tab | What you're looking at |
|-----|------------------------|
| **Overview** | Active portfolio (what it's trading now + capital split), ML status, trade history, equity curve. |
| **AI Agents** | The six LLM agents live — what each is doing this cycle. |
| **Strategies** | Leaderboard of every strategy × asset combo by score, plus the strategy catalog. |
| **Calendar** | Daily profit/loss calendar. |
| **News** | Market headlines for your assets. |
| **Console** | Live log of everything: signals, trades, agent actions, results. |

**On the Overview tab, the "Active Portfolio" panel** shows the ML status:
- **"ML learning · 12/30"** → still collecting trades, confidence unchanged.
- **"ML active · 45 trades"** → the ML model is now adjusting each signal's confidence.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot find module '../build/output/log'` (frontend) | `node_modules` is corrupted (often from Drive sync). Delete `frontend/node_modules` and run `npm install` again on a **local disk**. |
| `failed to locate pyvenv.cfg` | The Python venv is broken. Delete `backend/venv` and recreate it: `python -m venv venv`. |
| `No matching distribution found for iqoptionapi` | Install it from GitHub: `pip install git+https://github.com/iqoptionapi/iqoptionapi.git`. |
| Bot connects but places no trades | It's still evaluating, or no signal passed the confidence threshold. Watch the Console tab; give it a few candles. |
| "No AI API key" in the agents | Add a DeepSeek key in the config panel or `.env`. The bot still trades without it. |
| Port already in use | Something else is on 8100/3010. Stop it, or change the port in `run.py`. |
| Installs keep corrupting | You're almost certainly on a Google Drive / OneDrive virtual drive. Move the project to a local disk. |

---

## What next?

- Understand how the AI actually works → **[AI_WORKFLOW.md](AI_WORKFLOW.md)**
- Understand the system structure → **[ARCHITECTURE.md](ARCHITECTURE.md)**
- Read the honest limitations before trusting any number → **[README](../README.md#honest-limitations)**
