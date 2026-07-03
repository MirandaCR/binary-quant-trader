"""
Generic client for any OpenAI-compatible /chat/completions API.
DeepSeek and OpenAI both implement this exact shape, so they share this implementation
and only differ in default base_url / model (see deepseek.py, openai_provider.py).
"""
import logging
from typing import List, Dict, Any, Optional

import httpx

from .base import BaseLLMProvider

logger = logging.getLogger(__name__)


class OpenAICompatibleProvider(BaseLLMProvider):
    def chat_completion(self, messages: List[Dict[str, str]]) -> Optional[str]:
        if not self.api_key:
            logger.warning("%s: no API key provided", self.name)
            return None

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        data: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(url, headers=headers, json=data)
                response.raise_for_status()
                result = response.json()
                return result["choices"][0]["message"]["content"]
        except Exception as e:
            logger.error("%s chat completion failed: %s", self.name, e)
            return None
