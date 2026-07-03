"""
Common interface every LLM provider must implement.
Keeps orchestrator.py / suggestions_pipeline.py / strategy_suggester.py provider-agnostic.
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Optional


class BaseLLMProvider(ABC):
    name: str = "base"

    def __init__(self, api_key: str, base_url: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key
        self.base_url = (base_url or "").rstrip("/")
        self.model = model

    @abstractmethod
    def chat_completion(self, messages: List[Dict[str, str]]) -> Optional[str]:
        """Send chat messages (OpenAI role/content format) and return the text reply, or None on failure."""
        raise NotImplementedError
