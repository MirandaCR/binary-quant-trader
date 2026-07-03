import logging
from typing import Optional

from .base import BaseLLMProvider
from .deepseek import DeepSeekProvider, DEFAULT_BASE_URL as DEEPSEEK_URL, DEFAULT_MODEL as DEEPSEEK_MODEL
from .openai_provider import OpenAIProvider, DEFAULT_BASE_URL as OPENAI_URL, DEFAULT_MODEL as OPENAI_MODEL
from .gemini import GeminiProvider, DEFAULT_BASE_URL as GEMINI_URL, DEFAULT_MODEL as GEMINI_MODEL
from .anthropic_provider import AnthropicProvider, DEFAULT_BASE_URL as ANTHROPIC_URL, DEFAULT_MODEL as ANTHROPIC_MODEL

logger = logging.getLogger(__name__)

# provider key → (class, default_base_url, default_model)
PROVIDERS = {
    "deepseek": (DeepSeekProvider, DEEPSEEK_URL, DEEPSEEK_MODEL),
    "openai": (OpenAIProvider, OPENAI_URL, OPENAI_MODEL),
    "gemini": (GeminiProvider, GEMINI_URL, GEMINI_MODEL),
    "anthropic": (AnthropicProvider, ANTHROPIC_URL, ANTHROPIC_MODEL),
}

DEFAULT_PROVIDER = "deepseek"


def create_llm_provider(config) -> BaseLLMProvider:
    """
    Build the LLM provider selected in BotConfig (config.ai_provider), falling back
    to DeepSeek. config.ai_base_url / config.ai_model override the provider's defaults
    when set, so users can still point at a self-hosted or compatible endpoint.
    """
    provider_key = (getattr(config, "ai_provider", None) or DEFAULT_PROVIDER).lower().strip()
    cls, default_url, default_model = PROVIDERS.get(provider_key, PROVIDERS[DEFAULT_PROVIDER])
    if provider_key not in PROVIDERS:
        logger.warning("Unknown ai_provider '%s', falling back to %s", provider_key, DEFAULT_PROVIDER)

    base_url = getattr(config, "ai_base_url", None) or default_url
    model = getattr(config, "ai_model", None) or default_model
    api_key = getattr(config, "ai_api_key", None) or ""

    return cls(api_key=api_key, base_url=base_url, model=model)
