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
        
        async def send():
             await asyncio.sleep(1)
             await session.send(input="Hello, can you hear me? Say something long and clear so I can test the audio.", end_of_turn=True)

        asyncio.create_task(send())

        generator = session.receive()
        async for msg in generator:
            print(f"Received msg type: {type(msg)}")
            # it might be that generator is yielding the actual server contents, not another generator
            if hasattr(msg, 'server_content'):
                if msg.server_content.model_turn:
                    for part in msg.server_content.model_turn.parts:
                        if part.inline_data:
                            print(f"Audio chunk size: {len(part.inline_data.data)}")
            if hasattr(msg, 'server_content') and msg.server_content.turn_complete:
                print("Turn completed")
                break

try:
    asyncio.run(test())
except Exception as e:
    print(e)
