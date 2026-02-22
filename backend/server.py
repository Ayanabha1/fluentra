from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import base64
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt

from google import genai
from google.genai import types

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
gemini_client = None
if GEMINI_API_KEY:
    try:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        logger.info("Gemini client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini client: {e}")

def get_gemini_client():
    global gemini_client
    if gemini_client is None:
        key = os.environ.get('GEMINI_API_KEY', '')
        if key:
            gemini_client = genai.Client(api_key=key)
    return gemini_client

JWT_SECRET = os.environ.get('JWT_SECRET', 'fluentra-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 72

app = FastAPI(title="Fluentra API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== Auth Helpers ====================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str) -> str:
    payload = {"user_id": user_id, "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def clean_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k not in ("password_hash", "_id")}

# ==================== Models ====================
class RegisterInput(BaseModel):
    name: str
    email: str
    password: str

class LoginInput(BaseModel):
    email: str
    password: str

class OnboardingInput(BaseModel):
    native_language: str
    target_cefr_level: str
    learning_goals: List[str]
    sessions_per_week: int = 3

class SessionCreate(BaseModel):
    session_type: str
    plan_id: Optional[str] = None

class SessionComplete(BaseModel):
    metrics: Dict[str, Any] = {}
    transcript: List[Dict[str, str]] = []

class VocabularyCreate(BaseModel):
    word: str
    definition: str
    example_sentence: str
    cefr_level: str

class VocabularyReview(BaseModel):
    quality: int

class MistakeCreate(BaseModel):
    session_id: str
    error_type: str
    severity: str
    original: str
    corrected: str
    explanation: str
    context: str = ""

class MemoryCreateInput(BaseModel):
    content: str
    memory_type: str = "session"

# ==================== Auth Routes ====================
@api_router.post("/auth/register")
async def register(input: RegisterInput):
    existing = await db.users.find_one({"email": input.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = {
        "id": str(uuid.uuid4()),
        "name": input.name,
        "email": input.email,
        "password_hash": hash_password(input.password),
        "cefr_level": None,
        "target_cefr_level": None,
        "native_language": None,
        "learning_goals": [],
        "sessions_per_week": 3,
        "current_streak": 0,
        "longest_streak": 0,
        "total_sessions": 0,
        "total_vocabulary_acquired": 0,
        "assessment_completed": False,
        "onboarding_completed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one({**user})
    token = create_token(user["id"])
    return {"token": token, "user": clean_user(user)}

@api_router.post("/auth/login")
async def login(input: LoginInput):
    user = await db.users.find_one({"email": input.email}, {"_id": 0})
    if not user or not verify_password(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"])
    return {"token": token, "user": clean_user(user)}

@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return clean_user(user)

# ==================== Onboarding ====================
@api_router.put("/users/onboard")
async def onboard_user(input: OnboardingInput, user=Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "native_language": input.native_language,
            "target_cefr_level": input.target_cefr_level,
            "learning_goals": input.learning_goals,
            "sessions_per_week": input.sessions_per_week,
            "onboarding_completed": True,
        }}
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return clean_user(updated)

# ==================== Sessions ====================
@api_router.post("/sessions")
async def create_session(input: SessionCreate, user=Depends(get_current_user)):
    session_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "session_type": input.session_type,
        "plan_id": input.plan_id,
        "status": "active",
        "cefr_level_at_start": user.get("cefr_level"),
        "duration_minutes": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "metrics": {"grammar_accuracy": 0, "fluency_wpm": 0, "filler_word_count": 0, "vocabulary_introduced": [], "vocabulary_retention_rate": 0, "listening_score": 0, "overall_score": 0},
        "transcript": [],
        "feedback": [],
    }
    await db.sessions.insert_one({**session_doc})
    return session_doc

@api_router.get("/sessions")
async def list_sessions(user=Depends(get_current_user)):
    return await db.sessions.find({"user_id": user["id"]}, {"_id": 0}).sort("started_at", -1).to_list(100)

@api_router.get("/sessions/{session_id}")
async def get_session(session_id: str, user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s

@api_router.put("/sessions/{session_id}/complete")
async def complete_session(session_id: str, input: SessionComplete, user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    now = datetime.now(timezone.utc)
    started = datetime.fromisoformat(s["started_at"])
    duration = (now - started).total_seconds() / 60
    update_data = {
        "status": "completed",
        "completed_at": now.isoformat(),
        "duration_minutes": round(duration, 1),
        "metrics": input.metrics if input.metrics else s.get("metrics", {}),
        "transcript": input.transcript if input.transcript else s.get("transcript", []),
    }
    await db.sessions.update_one({"id": session_id}, {"$set": update_data})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"total_sessions": 1}})
    # Update streak
    last_session = await db.sessions.find_one(
        {"user_id": user["id"], "status": "completed", "id": {"$ne": session_id}},
        {"_id": 0}, sort=[("completed_at", -1)]
    )
    new_streak = 1
    if last_session and last_session.get("completed_at"):
        last_date = datetime.fromisoformat(last_session["completed_at"]).date()
        if (now.date() - last_date).days <= 1:
            new_streak = user.get("current_streak", 0) + 1
    await db.users.update_one({"id": user["id"]}, {"$set": {"current_streak": new_streak, "longest_streak": max(new_streak, user.get("longest_streak", 0))}})
    return await db.sessions.find_one({"id": session_id}, {"_id": 0})

# ==================== Assessment Scoring ====================
@api_router.post("/sessions/{session_id}/score-assessment")
async def score_assessment(session_id: str, user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    transcript = s.get("transcript", [])
    transcript_text = "\n".join([f"{t.get('speaker','?')}: {t.get('text','')}" for t in transcript])
    prompt = f"""You are an expert English assessor. Analyze this conversation and provide CEFR scoring.

Transcript:
{transcript_text if transcript_text.strip() else "No transcript available - provide default B1 assessment."}

Evaluate: Fluency(30%), Grammar(30%), Vocabulary(25%), Confidence(15%).
CEFR: A1(0-16), A2(17-33), B1(34-50), B2(51-67), C1(68-84), C2(85-100).

Respond ONLY with valid JSON:
{{"fluency_score":0,"grammar_score":0,"vocabulary_score":0,"confidence_score":0,"weighted_score":0,"cefr_level":"B1","strengths":["str1","str2"],"areas_to_improve":["area1","area2"],"detailed_feedback":"feedback text"}}"""

    try:
        client = get_gemini_client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        scores = json.loads(response.text)
    except Exception as e:
        logger.error(f"Assessment scoring error: {e}")
        scores = {"fluency_score": 5, "grammar_score": 5, "vocabulary_score": 5, "confidence_score": 5, "weighted_score": 50, "cefr_level": "B1", "strengths": ["Good communication willingness", "Engaged in conversation"], "areas_to_improve": ["Grammar accuracy", "Vocabulary range"], "detailed_feedback": "Assessment completed. Let's work together to improve your English!"}

    cefr = scores.get("cefr_level", "B1")
    await db.sessions.update_one({"id": session_id}, {"$set": {"metrics.grammar_accuracy": scores.get("grammar_score", 0) * 10, "metrics.overall_score": scores.get("weighted_score", 0), "assessment_scores": scores}})
    await db.users.update_one({"id": user["id"]}, {"$set": {"cefr_level": cefr, "assessment_completed": True, "assessment_completed_at": datetime.now(timezone.utc).isoformat()}})
    await db.memories.insert_one({"user_id": user["id"], "type": "assessment", "content": f"Initial assessment: CEFR {cefr}. Strengths: {', '.join(scores.get('strengths', []))}. Improve: {', '.join(scores.get('areas_to_improve', []))}.", "created_at": datetime.now(timezone.utc).isoformat()})
    return scores

# ==================== Learning Plans ====================
@api_router.get("/learning-plan")
async def get_learning_plan(user=Depends(get_current_user)):
    plan = await db.learning_plans.find_one({"user_id": user["id"], "is_active": True}, {"_id": 0})
    return plan

@api_router.post("/learning-plan/generate")
async def generate_learning_plan(user=Depends(get_current_user)):
    current_level = user.get("cefr_level", "A1")
    target_level = user.get("target_cefr_level", "B2")
    goals = user.get("learning_goals", [])
    spw = user.get("sessions_per_week", 3)
    prompt = f"""Create a personalized English learning plan.
Current CEFR: {current_level}, Target: {target_level}, Goals: {', '.join(goals)}, Sessions/week: {spw}.
Create 4-8 weekly modules with session templates.

Respond ONLY with valid JSON:
{{"estimated_weeks":8,"modules":[{{"title":"Week 1: Title","week_number":1,"focus_areas":["grammar","vocabulary"],"difficulty":"easy","session_templates":[{{"type":"vocabulary","title":"Title","description":"Desc","duration_minutes":20,"focus":"focus"}}]}}]}}"""

    try:
        response = gemini_client.models.generate_content(model="gemini-2.5-flash", contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json"))
        plan_data = json.loads(response.text)
    except Exception as e:
        logger.error(f"Plan generation error: {e}")
        plan_data = {"estimated_weeks": 8, "modules": [
            {"title": f"Week {i+1}: {'Foundations' if i<2 else 'Development' if i<5 else 'Mastery'}", "week_number": i+1, "focus_areas": ["grammar", "vocabulary", "speaking"], "difficulty": "easy" if i<2 else "medium" if i<5 else "hard",
             "session_templates": [{"type": "vocabulary", "title": "Word Power", "description": "Learn new vocabulary", "duration_minutes": 20, "focus": "vocabulary"}, {"type": "speaking", "title": "Conversation", "description": "Practice speaking", "duration_minutes": 25, "focus": "speaking"}, {"type": "grammar", "title": "Grammar Clinic", "description": "Grammar exercises", "duration_minutes": 20, "focus": "grammar"}]}
            for i in range(8)
        ]}

    plan = {
        "id": str(uuid.uuid4()), "user_id": user["id"], "current_cefr_level": current_level, "target_cefr_level": target_level,
        "estimated_weeks": plan_data.get("estimated_weeks", 8),
        "estimated_completion_date": (datetime.now(timezone.utc) + timedelta(weeks=plan_data.get("estimated_weeks", 8))).isoformat(),
        "sessions_per_week": spw, "modules": plan_data.get("modules", []),
        "current_module_index": 0, "adaptation_history": [], "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.learning_plans.update_many({"user_id": user["id"], "is_active": True}, {"$set": {"is_active": False}})
    await db.learning_plans.insert_one({**plan})
    return plan

# ==================== Vocabulary ====================
@api_router.get("/vocabulary")
async def get_vocabulary(user=Depends(get_current_user)):
    return await db.vocabulary.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.post("/vocabulary")
async def add_vocabulary(input: VocabularyCreate, user=Depends(get_current_user)):
    item = {"id": str(uuid.uuid4()), "user_id": user["id"], "word": input.word, "definition": input.definition, "example_sentence": input.example_sentence, "cefr_level": input.cefr_level, "status": "new", "sm2_interval": 1, "sm2_repetitions": 0, "sm2_easiness": 2.5, "next_review_date": datetime.now(timezone.utc).isoformat(), "correct_attempts": 0, "total_attempts": 0, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.vocabulary.insert_one({**item})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"total_vocabulary_acquired": 1}})
    return item

@api_router.put("/vocabulary/{item_id}/review")
async def review_vocabulary(item_id: str, input: VocabularyReview, user=Depends(get_current_user)):
    item = await db.vocabulary.find_one({"id": item_id, "user_id": user["id"]}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    q = input.quality
    ef = item.get("sm2_easiness", 2.5)
    rep = item.get("sm2_repetitions", 0)
    interval = item.get("sm2_interval", 1)
    if q >= 3:
        interval = 1 if rep == 0 else (6 if rep == 1 else round(interval * ef))
        rep += 1
        ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    else:
        rep = 0
        interval = 1
    ef = max(1.3, ef)
    status = "mastered" if rep >= 5 else ("reviewing" if rep >= 2 else "learning")
    await db.vocabulary.update_one({"id": item_id}, {"$set": {"sm2_interval": interval, "sm2_repetitions": rep, "sm2_easiness": round(ef, 2), "next_review_date": (datetime.now(timezone.utc) + timedelta(days=interval)).isoformat(), "status": status, "total_attempts": item.get("total_attempts", 0) + 1, "correct_attempts": item.get("correct_attempts", 0) + (1 if q >= 3 else 0)}})
    return await db.vocabulary.find_one({"id": item_id}, {"_id": 0})

@api_router.get("/vocabulary/due")
async def get_due_vocabulary(user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    return await db.vocabulary.find({"user_id": user["id"], "next_review_date": {"$lte": now}}, {"_id": 0}).to_list(20)

# ==================== Mistakes ====================
@api_router.get("/mistakes")
async def get_mistakes(user=Depends(get_current_user)):
    return await db.mistakes.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)

@api_router.post("/mistakes")
async def add_mistake(input: MistakeCreate, user=Depends(get_current_user)):
    count = await db.mistakes.count_documents({"user_id": user["id"], "error_type": input.error_type})
    mistake = {"id": str(uuid.uuid4()), "user_id": user["id"], "session_id": input.session_id, "error_type": input.error_type, "severity": input.severity, "original": input.original, "corrected": input.corrected, "explanation": input.explanation, "context": input.context, "acknowledged": False, "recurrence": count + 1, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.mistakes.insert_one({**mistake})
    return mistake

# ==================== Progress ====================
@api_router.get("/progress")
async def get_progress(user=Depends(get_current_user)):
    sessions = await db.sessions.find({"user_id": user["id"], "status": "completed"}, {"_id": 0}).sort("completed_at", 1).to_list(100)
    vocab_count = await db.vocabulary.count_documents({"user_id": user["id"]})
    vocab_mastered = await db.vocabulary.count_documents({"user_id": user["id"], "status": "mastered"})
    vocab_learning = await db.vocabulary.count_documents({"user_id": user["id"], "status": "learning"})
    mistakes = await db.mistakes.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    mistake_types = {}
    for m in mistakes:
        t = m.get("error_type", "other")
        mistake_types[t] = mistake_types.get(t, 0) + 1
    session_metrics = []
    for s in sessions:
        met = s.get("metrics", {})
        session_metrics.append({"date": s.get("completed_at", s.get("started_at")), "type": s.get("session_type"), "grammar_accuracy": met.get("grammar_accuracy", 0), "fluency_wpm": met.get("fluency_wpm", 0), "overall_score": met.get("overall_score", 0), "vocabulary_introduced": len(met.get("vocabulary_introduced", []))})
    vocab_items = await db.vocabulary.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    weekly_vocab = {}
    for v in vocab_items:
        c = v.get("created_at", "")
        if c:
            week = datetime.fromisoformat(c).strftime("%Y-W%U")
            weekly_vocab[week] = weekly_vocab.get(week, 0) + 1
    session_dates = {}
    for s in sessions:
        d = s.get("completed_at", s.get("started_at", ""))
        if d:
            day = datetime.fromisoformat(d).strftime("%Y-%m-%d")
            session_dates[day] = session_dates.get(day, 0) + 1
    return {"total_sessions": len(sessions), "current_streak": user.get("current_streak", 0), "longest_streak": user.get("longest_streak", 0), "cefr_level": user.get("cefr_level"), "target_cefr_level": user.get("target_cefr_level"), "vocabulary": {"total": vocab_count, "mastered": vocab_mastered, "learning": vocab_learning, "new": vocab_count - vocab_mastered - vocab_learning}, "mistake_types": mistake_types, "session_metrics": session_metrics, "weekly_vocabulary": weekly_vocab, "session_dates": session_dates}

# ==================== Memories ====================
@api_router.get("/memories")
async def get_memories(user=Depends(get_current_user)):
    return await db.memories.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)

@api_router.post("/memories")
async def add_memory(input: MemoryCreateInput, user=Depends(get_current_user)):
    mem = {"id": str(uuid.uuid4()), "user_id": user["id"], "type": input.memory_type, "content": input.content, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.memories.insert_one({**mem})
    return mem

# ==================== Gemini Live WebSocket ====================
@app.websocket("/api/ws/session")
async def websocket_session(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection established")
    gemini_session = None
    try:
        init_data = await websocket.receive_json()
        system_prompt = init_data.get("system_prompt", "You are Fluentra, a friendly English tutor.")
        session_id = init_data.get("session_id", "")
        logger.info(f"Starting Gemini Live session for: {session_id}")

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            input_audio_transcription=types.AudioTranscriptionConfig(),
        )

        async with gemini_client.aio.live.connect(
            model="gemini-live-2.5-flash-native-audio",
            config=config
        ) as gemini_session:
            await websocket.send_json({"type": "connected", "message": "Session started"})

            async def receive_from_client():
                try:
                    while True:
                        raw = await websocket.receive_text()
                        msg = json.loads(raw)
                        if msg.get("type") == "audio":
                            audio_bytes = base64.b64decode(msg["data"])
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                            )
                        elif msg.get("type") == "text":
                            await gemini_session.send_client_content(
                                turns=types.Content(parts=[types.Part(text=msg["data"])]),
                                turn_complete=True
                            )
                        elif msg.get("type") == "end":
                            return
                except WebSocketDisconnect:
                    logger.info("Client disconnected")
                except Exception as e:
                    logger.error(f"Client receive error: {e}")

            async def send_to_client():
                try:
                    async for response in gemini_session:
                        try:
                            sc = response.server_content
                            if sc is None:
                                continue
                            if sc.model_turn and sc.model_turn.parts:
                                for part in sc.model_turn.parts:
                                    if part.inline_data and part.inline_data.data:
                                        audio_b64 = base64.b64encode(part.inline_data.data).decode()
                                        await websocket.send_json({"type": "audio", "data": audio_b64, "mime_type": getattr(part.inline_data, 'mime_type', 'audio/pcm')})
                                    if part.text:
                                        await websocket.send_json({"type": "transcript", "data": part.text, "speaker": "ai"})
                            if hasattr(sc, 'output_transcription') and sc.output_transcription:
                                text = getattr(sc.output_transcription, 'text', '')
                                if text:
                                    await websocket.send_json({"type": "transcript", "data": text, "speaker": "ai"})
                            if hasattr(sc, 'input_transcription') and sc.input_transcription:
                                text = getattr(sc.input_transcription, 'text', '')
                                if text:
                                    await websocket.send_json({"type": "transcript", "data": text, "speaker": "user"})
                            if sc.turn_complete:
                                await websocket.send_json({"type": "turn_complete"})
                        except Exception as inner_e:
                            logger.error(f"Response processing error: {inner_e}")
                except Exception as e:
                    logger.error(f"Gemini receive error: {e}")

            await asyncio.gather(receive_from_client(), send_to_client(), return_exceptions=True)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass

# ==================== AI Session Scoring ====================
@api_router.post("/ai/score-session")
async def score_session_ai(session_id: str, user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    transcript = s.get("transcript", [])
    transcript_text = "\n".join([f"{t.get('speaker','?')}: {t.get('text','')}" for t in transcript])
    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"""Analyze this English tutoring session ({s.get('session_type')}) and score it.
Transcript:
{transcript_text if transcript_text.strip() else "Short session - provide moderate scores."}

Respond ONLY with valid JSON:
{{"grammar_accuracy":0,"fluency_wpm":0,"filler_word_count":0,"vocabulary_retention_rate":0,"overall_score":0,"feedback":["point1"],"mistakes":[{{"error_type":"type","severity":"minor","original":"said","corrected":"correct","explanation":"why"}}]}}""",
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        scores = json.loads(response.text)
    except Exception as e:
        logger.error(f"Session scoring error: {e}")
        scores = {"grammar_accuracy": 70, "fluency_wpm": 100, "filler_word_count": 3, "vocabulary_retention_rate": 70, "overall_score": 70, "feedback": ["Good effort!"], "mistakes": []}
    await db.sessions.update_one({"id": session_id}, {"$set": {"metrics": scores, "feedback": scores.get("feedback", [])}})
    for m in scores.get("mistakes", []):
        await db.mistakes.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "session_id": session_id, "error_type": m.get("error_type", "other"), "severity": m.get("severity", "minor"), "original": m.get("original", ""), "corrected": m.get("corrected", ""), "explanation": m.get("explanation", ""), "context": "", "acknowledged": False, "recurrence": 1, "created_at": datetime.now(timezone.utc).isoformat()})
    return scores

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
