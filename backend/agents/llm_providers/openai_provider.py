from .openai_compatible import OpenAICompatibleProvider

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIProvider(OpenAICompatibleProvider):
    name = "openai"
