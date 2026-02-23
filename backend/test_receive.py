import asyncio
from google import genai

async def test():
    client = genai.Client(api_key='test')
    async with client.aio.live.connect(model='gemini-2.0-flash-exp') as session:
        t = session.receive()
        print(type(t))

try:
    asyncio.run(test())
except Exception as e:
    print(e)
