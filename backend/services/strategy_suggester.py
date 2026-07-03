"""
Ask an LLM for profitable binary options strategies to test.
Uses parallelism: non-blocking, can run alongside bot evaluation.
"""
import logging
from typing import List, Optional, Dict, Any

from agents.llm_providers.factory import PROVIDERS, DEFAULT_PROVIDER

logger = logging.getLogger(__name__)


def get_strategy_suggestions(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    existing_strategies: Optional[List[str]] = None,
    assets_hint: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Call an LLM to get suggested profitable binary options strategies.
    Returns dict with keys: suggestions (list of str), raw_response (str), error (str or None).
    """
    key = (api_key or "").strip()
    if not key:
        return {"suggestions": [], "raw_response": "", "error": "No API key provided"}

    provider_key = (provider or DEFAULT_PROVIDER).lower().strip()
    cls, default_url, default_model = PROVIDERS.get(provider_key, PROVIDERS[DEFAULT_PROVIDER])

    existing = existing_strategies or []
    assets = assets_hint or ["EURUSD-OTC", "GBPUSD-OTC", "stocks like AAPL-OTC"]
    prompt = f"""You are a quantitative trading expert. Suggest 5-8 short, actionable binary options strategies that are commonly profitable when backtested. Focus on:
- Technical strategies (candlestick, RSI, moving average, support/resistance, momentum).
- One sentence per strategy: what to do and on what condition.
- Prefer strategies that work on 1m-5m timeframes and 1-5 minute expirations.
Existing strategies we already test: {', '.join(existing[:15]) if existing else 'none'}.
Assets we trade: {', '.join(assets[:10])}.
Reply with a numbered list of strategy names and one-line description each. No preamble."""

    try:
        llm = cls(api_key=key, base_url=(base_url or default_url), model=(model or default_model))

        text = llm.chat_completion([
            {"role": "system", "content": "You are a concise trading strategy assistant."},
            {"role": "user", "content": prompt}
        ])
        
        if text:
            text = text.strip()
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            suggestions = [ln for ln in lines if ln and (ln[0:1].isdigit() or ln.startswith("-") or "strategy" in ln.lower() or "RSI" in ln or "EMA" in ln)]
            if not suggestions:
                suggestions = lines[:10]
            return {"suggestions": suggestions[:15], "raw_response": text, "error": None}
        else:
            return {"suggestions": [], "raw_response": "", "error": "No response from AI"}
            
    except Exception as e:
        logger.exception("Strategy suggester API error")
        return {"suggestions": [], "raw_response": "", "error": str(e)}

