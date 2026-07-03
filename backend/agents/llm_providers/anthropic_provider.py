"""
Anthropic direct API (Claude). Kept as an option since Fuelix was proxying Claude
models — lets users point straight at Anthropic instead of a third-party gateway.
Different shape: x-api-key header, /v1/messages endpoint, system is a top-level field.
"""
import logging
from typing import List, Dict, Optional

import httpx

from .base import BaseLLMProvider

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
DEFAULT_MODEL = "claude-sonnet-4-5"
ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider(BaseLLMProvider):
    name = "anthropic"

    def chat_completion(self, messages: List[Dict[str, str]]) -> Optional[str]:
        if not self.api_key:
            logger.warning("anthropic: no API key provided")
            return None

        base = self.base_url or DEFAULT_BASE_URL
        url = f"{base}/messages"

        system_parts = [m["content"] for m in messages if m.get("role") == "system"]
        chat_messages = [m for m in messages if m.get("role") != "system"]

        payload = {
            "model": self.model or DEFAULT_MODEL,
            "max_tokens": 4096,
            "messages": chat_messages,
        }
        if system_parts:
            payload["system"] = "\n".join(system_parts)

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": self.api_key,
                        "anthropic-version": ANTHROPIC_VERSION,
                    },
                    json=payload,
                )
                response.raise_for_status()
                result = response.json()
                return result["content"][0]["text"]
        except Exception as e:
            logger.error("anthropic chat completion failed: %s", e)
            return None
