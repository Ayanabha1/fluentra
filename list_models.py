import os
import requests
from dotenv import load_dotenv
load_dotenv("backend/.env")
api_key = os.environ["GEMINI_API_KEY"]
res = requests.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}")
print([m["name"] for m in res.json().get("models", [])])
