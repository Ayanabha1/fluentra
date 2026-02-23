import asyncio
from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

def main():
    gemini_client = genai.Client()
    print("Available models:")
    for model in gemini_client.models.list():
        if "bidiGenerateContent" in model.supported_actions or "bidiGenerateContent" in str(model):
            print(model.name, "supports bidiGenerateContent")
        else:
            if "gemini" in model.name:
                print(model.name, model.supported_actions)


if __name__ == '__main__':
    main()
