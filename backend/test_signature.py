import inspect
from google.genai.live import AsyncSession
try:
    print("SEND:", inspect.signature(AsyncSession.send))
except Exception as e:
    print("SEND ERROR:", e)

try:
    print("SEND_REALTIME_INPUT:", inspect.signature(AsyncSession.send_realtime_input))
except Exception as e:
    print("SEND_REALTIME_INPUT ERROR:", e)

try:
    print("SEND_CLIENT_CONTENT:", inspect.signature(AsyncSession.send_client_content))
except Exception as e:
    print("SEND_CLIENT_CONTENT ERROR:", e)
