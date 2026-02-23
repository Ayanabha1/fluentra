import os
import json
from mem0 import Memory
from dotenv import load_dotenv

load_dotenv("backend/.env")

gemini_key = os.environ.get("GEMINI_API_KEY")
mongo_uri = os.environ.get("MONGO_URL")

os.environ["MONGO_URI"] = mongo_uri

config = {
    "llm": {
        "provider": "gemini",
        "config": {
            "api_key": gemini_key,
        }
    },
    "embedder": {
        "provider": "gemini",
        "config": {
            "api_key": gemini_key,
            "model": "models/text-embedding-004"
        }
    },
    "vector_store": {
        "provider": "mongodb",
        "config": {
            "collection_name": "memories",
            "db_name": "fluentra",
            "mongo_uri": mongo_uri
        }
    }
}

try:
    m = Memory.from_config(config_dict=config)
    res = m.add("I love playing guitar", user_id="user_123")
    print("Memory created:", res)
    memories = m.search("What instrument does the user play?", user_id="user_123")
    print("Found memory:", memories)
except Exception as e:
    import traceback
    traceback.print_exc()
