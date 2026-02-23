import asyncio
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

async def test():
    client = genai.Client(http_options={'api_version': 'v1alpha'})
    async with client.aio.live.connect(model='gemini-2.5-flash-native-audio-preview-12-2025', config=types.LiveConnectConfig(
        response_modalities=['AUDIO'],
    )) as session:
        generator = session.receive()
        async for msg in generator:
            print(msg)
            break

try:
    asyncio.run(test())
except Exception as e:
    print(e)
