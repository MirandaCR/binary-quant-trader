"""
Google Gemini (Generative Language API). Different request/response shape than
OpenAI-compatible providers: no chat/completions endpoint, no Bearer header,
and roles are "user"/"model" instead of "user"/"assistant".
"""
import logging
from typing import List, Dict, Optional

import httpx

from .base import BaseLLMProvider

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-2.0-flash"


class GeminiProvider(BaseLLMProvider):
    name = "gemini"

    def chat_completion(self, messages: List[Dict[str, str]]) -> Optional[str]:
        if not self.api_key:
            logger.warning("gemini: no API key provided")
            return None

        base = self.base_url or DEFAULT_BASE_URL
        model = self.model or DEFAULT_MODEL
        url = f"{base}/models/{model}:generateContent"

        system_parts = [m["content"] for m in messages if m.get("role") == "system"]
        contents = [
            {
                "role": "model" if m.get("role") == "assistant" else "user",
                "parts": [{"text": m.get("content", "")}],
            }
            for m in messages
            if m.get("role") != "system"
        ]
        payload = {"contents": contents}
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n".join(system_parts)}]}

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    url,
                    headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                    json=payload,
                )
                response.raise_for_status()
                result = response.json()
                return result["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            logger.error("gemini chat completion failed: %s", e)
            return None
