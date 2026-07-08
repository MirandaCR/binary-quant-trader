# AI Workflow — End to End

> How **binary-quant-trader** actually uses AI. There are **two different kinds of AI** here,
> and they do *different jobs*. Understanding that split is the key to understanding the project.

---

## The big idea: two AIs, two jobs

```mermaid
flowchart LR
    subgraph GEN["🧠 Generative AI (LLM)"]
        direction TB
        G1["Reads market news"]
        G2["Writes NEW strategy code"]
        G3["Improves losing strategies"]
    end

    subgraph TRAD["📊 Traditional ML"]
        direction TB
        T1["Learns from your REAL trades"]
        T2["Predicts win-probability"]
        T3["Adjusts each signal's confidence"]
    end

    GEN -->|"creates the strategies"| POOL["Strategy Pool"]
    POOL -->|"produces signals"| TRAD
    TRAD -->|"filters / sizes them"| TRADES["Actual Trades"]
    TRADES -->|"outcomes teach both"| GEN
    TRADES -->|"outcomes teach both"| TRAD
```

| | Generative AI (LLM) | Traditional ML |
|--|--------------------|----------------|
| **Job** | *Invents* trading strategies | *Judges* which signals actually win |
| **Tech** | DeepSeek / OpenAI / Gemini / Claude | Logistic regression (scikit-learn) |
| **Input** | News + live performance | Your closed-trade history |
| **Output** | Python strategy code | A win-probability (0–1) per signal |
| **Analogy** | The *creative researcher* | The *skeptical risk analyst* |

> **Why both?** An LLM is great at generating ideas but can't know if they work on *your* account.
> A small ML model can't invent strategies, but it *can* learn, from your real results, which
> ideas are actually paying off — and quietly turn down the volume on the ones that aren't.

---

## Part A — The generative AI loop (multi-agent)

Every cycle (~60s, or an "express" cycle when a strategy is losing live), six agents run in
sequence. This is what *creates and maintains* the strategy pool.

```mermaid
sequenceDiagram
    autonumber
    participant O as Orchestrator
    participant N as NewsAgent
    participant R as ResearchAgent
    participant B as BacktestAgent
    participant T as TradeAnalysisAgent
    participant P as ParameterOptimizer
    participant LLM as LLM Provider

    O->>N: Fetch high-impact market news
    N->>LLM: Summarize sentiment
    LLM-->>N: bullish / bearish / mixed
    N-->>O: news context

    O->>R: Design a new strategy from news + live stats
    R->>LLM: "Write a BaseStrategy subclass…"
    LLM-->>R: raw Python strategy code
    R-->>O: strategy code + name

    O->>B: Compile & backtest the new code
    B-->>O: APPROVED (score ≥ 0.15) or REJECTED

    O->>T: Inject approved strategy, analyze performance
    T->>LLM: "Given live + backtest data, what to do?"
    LLM-->>T: concise recommendation
    T-->>O: strategy added to live pool

    O->>P: Review stats, prune weak strategies
    P->>LLM: Improve the worst performers
    LLM-->>P: improved strategy versions
    P-->>O: pool cleaned & upgraded
```

**The six agents:**

| Agent | What it does |
|-------|--------------|
| **OrchestratorAgent** | Master controller — runs the cycle, dispatches the others. |
| **NewsAgent** | Pulls headlines (NewsAPI), asks the LLM for sentiment. |
| **ResearchAgent** | Asks the LLM to *write brand-new strategy code* from context. |
| **BacktestAgent** | Compiles that code and backtests it; approves or rejects. |
| **TradeAnalysisAgent** | Injects approved strategies live; asks the LLM for advice. |
| **ParameterOptimizer** | Prunes consistently-losing strategies; asks the LLM to improve them. |

> ⚠️ **Honest note:** the LLM writes *plausible-looking* strategies, but "plausible" ≠ "profitable."
> The BacktestAgent is the guardrail — but it validates on small samples, so approved strategies
> can still be overfit. This is why the traditional-ML layer (Part B) exists as a second filter.

---

## Part B — The traditional ML loop (meta-labeling)

While the LLM *creates* strategies, a logistic-regression model *learns which ones actually win* on
your account, and adjusts confidence accordingly. This is classic quant **meta-labeling**.

```mermaid
flowchart TB
    START([Trade closes: win or loss]) --> STORE["Store result in SQLite"]
    STORE --> COUNT{"≥ 30 closed<br/>trades?"}
    COUNT -->|No| WAIT["ML stays OFF<br/>(confidence unchanged)"]
    COUNT -->|Yes| TRAIN["Retrain logistic regression<br/>features: strategy, asset, hour, weekday, confidence"]
    TRAIN --> READY["Model ready"]
    READY --> SCORE["On next signal:<br/>predict win-probability"]
    SCORE --> BLEND["Blend:<br/>0.7 × strategy_conf + 0.3 × ML_prob"]
    BLEND --> SIZE["Adjusted confidence drives<br/>position size & trade/skip"]
    SIZE --> START
```

**How the blend works in practice:**

- A strategy says: *"CALL on EUR/USD, 68% confident."*
- The ML model has seen this strategy lose most mornings on EUR/USD, and says: *"win-prob ≈ 30%."*
- Blended confidence drops (`0.7×0.68 + 0.3×0.30 ≈ 0.57`), so the trade is smaller — or skipped.
- If the ML model instead *agrees* (win-prob 75%), confidence holds and the trade is full-size.

> The model activates only after **30+ closed trades** with both wins and losses. Before that, it's a
> no-op and confidence passes through untouched — you'll see **"ML learning · N/30"** in the dashboard.

---

## Part C — Putting it together (one full cycle)

```mermaid
flowchart LR
    NEWS["📰 News"] --> LLM1["🧠 LLM writes<br/>a strategy"]
    LLM1 --> BT["📊 Backtest<br/>approves it"]
    BT --> POOL["Strategy Pool"]
    POOL --> RANK["Rank + pick<br/>portfolio"]
    RANK --> SIG["Signal on<br/>candle close"]
    SIG --> MLADJ["📊 ML adjusts<br/>confidence"]
    MLADJ --> RISKED["Risk-sized<br/>+ jittered"]
    RISKED --> TRADE["💹 Trade placed"]
    TRADE --> RESULT["✅/❌ Result"]
    RESULT -->|"retrains"| MLADJ
    RESULT -->|"triggers improve"| LLM1
```

**The feedback loop is the whole point:** every result makes the ML model smarter *and* tells the
LLM agents which strategies to fix. The system is designed to *adapt*, not to be right on day one.

---

## Choosing / switching the AI provider

DeepSeek is the default. You can switch in the dashboard's config panel, or via `AI_PROVIDER` in
`.env`. All providers implement the same interface (`backend/agents/llm_providers/base.py`), so the
rest of the system doesn't care which one you use.

```mermaid
flowchart LR
    CFG["config.ai_provider"] --> FACTORY["create_llm_provider()"]
    FACTORY --> D["DeepSeek<br/>(default)"]
    FACTORY --> O["OpenAI / ChatGPT"]
    FACTORY --> G["Google Gemini"]
    FACTORY --> A["Anthropic Claude"]
```

| Provider | Default model | Get a key |
|----------|---------------|-----------|
| `deepseek` | `deepseek-chat` | https://platform.deepseek.com |
| `openai` | `gpt-4o-mini` | https://platform.openai.com |
| `gemini` | `gemini-2.0-flash` | https://aistudio.google.com |
| `anthropic` | `claude-sonnet-4-5` | https://console.anthropic.com |

---

*See also: **[ARCHITECTURE.md](ARCHITECTURE.md)** (system structure) and
**[GETTING_STARTED.md](GETTING_STARTED.md)** (setup from zero).*
