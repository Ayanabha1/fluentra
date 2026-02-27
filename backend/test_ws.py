import asyncio
import websockets

async def test():
    uri = "ws://127.0.0.1:8000/api/ws/voice-agent/?prompt=test&language=en-US&agent_id=default&voice=Aoede&token="
    try:
        async with websockets.connect(uri) as ws:
            print("Connected")
            msg = await ws.recv()
            print("Received:", msg)
    except Exception as e:
        print("Error:", e)
        print("Headers:", getattr(e, "headers", None))

asyncio.run(test())
