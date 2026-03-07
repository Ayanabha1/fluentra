from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, BackgroundTasks
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
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import boto3
from botocore.config import Config as BotoConfig

from google import genai
from google.genai import types

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ── S3 client for session recordings ──────────────────────────────────────────
S3_BUCKET = os.environ.get('S3_BUCKET', 'fluentra-recordings')
S3_REGION = os.environ.get('AWS_REGION', 'ap-south-1')

s3_client = None
try:
    s3_client = boto3.client(
        's3',
        region_name=S3_REGION,
        endpoint_url=f"https://s3.{S3_REGION}.amazonaws.com",
        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
        config=BotoConfig(signature_version='s3v4', s3={'addressing_style': 'virtual'}),
    )
    logger.info(f"S3 client initialized for bucket: {S3_BUCKET} in {S3_REGION}")
except Exception as e:
    logger.warning(f"S3 client initialization failed (recordings disabled): {e}")

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
gemini_client = None
gemini_live_client = None
if GEMINI_API_KEY:
    try:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        gemini_live_client = genai.Client(api_key=GEMINI_API_KEY, http_options={"api_version": "v1alpha"})
        logger.info("Gemini clients initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini client: {e}")

def get_gemini_client():
    global gemini_client
    if gemini_client is None:
        key = os.environ.get('GEMINI_API_KEY', '')
        if key:
            gemini_client = genai.Client(api_key=key)
    return gemini_client

def get_gemini_live_client():
    global gemini_live_client
    if gemini_live_client is None:
        key = os.environ.get('GEMINI_API_KEY', '')
        if key:
            gemini_live_client = genai.Client(api_key=key, http_options={"api_version": "v1alpha"})
    return gemini_live_client

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
TEXT_MODEL = "gemini-2.5-pro"  # 1500 req/day free vs gemini-2.5-flash 20 req/day


async def ensure_tutor_persona(user_id: str) -> dict:
    """
    Ensure the user has a stored human tutor persona + base system prompt in Mongo.
    If missing, generate one with Gemini, persist it, and return the updated user doc.
    """
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    if user_doc.get("tutor_system_prompt"):
        return user_doc

    lvl = user_doc.get("cefr_level") or "A1"
    goals = user_doc.get("learning_goals", [])

    persona_prompt = f"""You are an expert character designer for language tutors.

Create a single HUMAN Indian English tutor persona that will talk to the student in every session.

Student context:
- Current CEFR level: {lvl}
- Learning goals: {', '.join(goals) if goals else "General English improvement"}

Design a persona who:
- Has an Indian first name
- Lives in an Indian city
- Has a brief life story and a few hobbies
- Speaks warm, natural conversational English
- Occasionally shares things about her own life, plans, or past experiences
- Never describes herself as an AI assistant

Respond ONLY with valid JSON:
{{
  "name": "Pooja",
  "age": 27,
  "city": "Bengaluru",
  "background": "Short 1–2 sentence life/background summary.",
  "hobbies": ["reading", "music"],
  "teaching_style": "Warm, encouraging, conversational, never just firing questions.",
  "system_prompt": "You are Pooja, a warm Indian English coach from Bengaluru. You are a real human tutor, not an AI assistant. You speak natural, friendly English, sometimes sharing small details about your own life and plans so it feels like a two-way conversation, not an interview."
}}"""

    try:
        response = await asyncio.to_thread(
            get_gemini_client().models.generate_content,
            model=TEXT_MODEL,
            contents=persona_prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        data = json.loads(response.text)
    except Exception:
        # Fallback simple persona if generation fails
        data = {
            "name": "Pooja",
            "age": 27,
            "city": "Bengaluru",
            "background": "An Indian English coach who loves helping learners gain confidence.",
            "hobbies": ["reading", "music"],
            "teaching_style": "Warm, encouraging, conversational, never just firing questions.",
            "system_prompt": ""
        }

    name = data.get("name") or "Pooja"
    city = data.get("city") or "Bengaluru"
    base_system_prompt = data.get("system_prompt") or (
        f"You are {name}, a warm Indian English coach from {city}. "
        "You are a real human tutor, not an AI assistant. "
        "You speak natural, friendly English and occasionally share small details about your own life and plans so it feels like a two-way conversation, not an interview."
    )

    tutor_profile = {
        "name": name,
        "age": data.get("age", 27),
        "city": city,
        "background": data.get("background", ""),
        "hobbies": data.get("hobbies", []),
        "teaching_style": data.get("teaching_style", ""),
    }

    update_fields = {
        "tutor_profile": tutor_profile,
        "tutor_system_prompt": base_system_prompt,
    }
    await db.users.update_one({"id": user_id}, {"$set": update_fields})
    user_doc.update(update_fields)
    return user_doc

JWT_SECRET = os.environ.get('JWT_SECRET', 'fluentra-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 72

app = FastAPI(title="Fluentra API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

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
    plan_module_index: Optional[int] = None    # which module (0-indexed)
    plan_session_index: Optional[int] = None   # which session within module (0-indexed)
    plan_session_id: Optional[str] = None      # e.g. "<plan_id>_week_2_3"
    system_prompt: Optional[str] = None        # baked-in prompt from plan session template
    target_duration_minutes: Optional[int] = 30

class SessionComplete(BaseModel):
    metrics: Dict[str, Any] = {}
    transcript: List[Dict[str, Any]] = []

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
    # Ensure a per-user tutor persona is created and stored
    user_with_persona = await ensure_tutor_persona(user["id"])
    return {"token": token, "user": clean_user(user_with_persona)}

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
        "plan_module_index": input.plan_module_index,
        "plan_session_index": input.plan_session_index,
        "plan_session_id": input.plan_session_id,   # e.g. "<plan_id>_week_2_3"
        "system_prompt": input.system_prompt,        # stored so live-token can read it
        "target_duration_minutes": input.target_duration_minutes,
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
    mistakes = await db.mistakes.find({"session_id": session_id}, {"_id": 0}).to_list(100)
    s["extracted_mistakes"] = mistakes
    return s

async def analyze_session(session_id: str, user_id: str, transcript: list):
    try:
        import re
        def _clean(t): return re.sub(r'  +', ' ', t.get('text', '')).strip()
        transcript_text = "\n".join([f"{t.get('speaker','?')}: {_clean(t)}" for t in transcript if _clean(t)])
        if not transcript_text.strip():
            return
        prompt = f"""You are an expert English tutor analyzing a session.
Transcript:
{transcript_text}

Extract structured data. Respond ONLY with valid JSON:
{{
  "summary": "2-3 sentence recap of conversation topics and any homework given",
  "mistakes": ["mistake 1 -> correction", "mistake 2 -> correction"],
  "new_words": ["word1", "word2"],
  "other_details": "Any other notable progress or details"
}}"""
        async def _do_analyze():
            for attempt in range(3):
                try:
                    return await asyncio.to_thread(
                        get_gemini_client().models.generate_content,
                        model=TEXT_MODEL,
                        contents=prompt,
                        config=types.GenerateContentConfig(response_mime_type="application/json")
                    )
                except Exception as e:
                    if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < 2:
                        wait = 15 * (2 ** attempt)
                        logger.warning(f"Analyze rate limited, retrying in {wait}s")
                        await asyncio.sleep(wait)
                    else:
                        raise
        response = await _do_analyze()
        analysis = json.loads(response.text)
        await db.sessions.update_one({"id": session_id}, {"$set": {"analysis": analysis}})
        logger.info(f"Successfully analyzed session {session_id}")
    except Exception as e:
        logger.error(f"Session analysis error: {e}")

@api_router.put("/sessions/{session_id}/complete")
async def complete_session(session_id: str, input: SessionComplete, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    # FIX: Idempotency check — if already completed, return existing data without re-processing
    if s.get("status") == "completed":
        logger.info(f"Session {session_id} already completed, returning existing data")
        return s

    now = datetime.now(timezone.utc)
    started = datetime.fromisoformat(s["started_at"])
    duration = (now - started).total_seconds() / 60
    # Always prefer input transcript (frontend sends clean version); fall back to stored
    transcript = input.transcript if input.transcript else s.get("transcript", [])
    # Ensure all entries are marked final
    transcript = [dict(t, final=True) for t in transcript if t.get("text", "").strip()]
    update_data = {
        "status": "completed",
        "completed_at": now.isoformat(),
        "duration_minutes": round(duration, 1),
        "metrics": input.metrics if input.metrics else s.get("metrics", {}),
        "transcript": transcript,
    }
    await db.sessions.update_one({"id": session_id}, {"$set": update_data})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"total_sessions": 1}})

    # Day streak logic:
    # - Only counts DISTINCT days with at least one completed session
    # - Multiple sessions on the same day do NOT increase the streak
    # - Streak increments only when today is exactly 1 day after the last session day
    # - Any gap > 1 day resets the streak back to 1
    last_session = await db.sessions.find_one(
        {"user_id": user["id"], "status": "completed", "id": {"$ne": session_id}},
        {"_id": 0}, sort=[("completed_at", -1)]
    )
    new_streak = 1
    current_streak = user.get("current_streak", 0) or 0
    if last_session and last_session.get("completed_at"):
        last_date = datetime.fromisoformat(last_session["completed_at"]).date()
        day_diff = (now.date() - last_date).days
        if day_diff == 0:
            # Another session on the same day: keep existing streak
            new_streak = max(1, current_streak)
        elif day_diff == 1:
            # Consecutive day: extend streak
            new_streak = max(1, current_streak) + 1
        else:
            # Gap > 1 day: reset streak to 1 (today only)
            new_streak = 1

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "current_streak": new_streak,
            "longest_streak": max(new_streak, user.get("longest_streak", 0) or 0),
        }}
    )
    background_tasks.add_task(analyze_session, session_id, user["id"], transcript)
    return await db.sessions.find_one({"id": session_id}, {"_id": 0})

# ==================== Session Recording Upload ====================

class RecordingStatusInput(BaseModel):
    status: str  # "uploaded" or "failed"
    error: str = ""

@api_router.get("/sessions/{session_id}/recording-upload-url")
async def get_recording_upload_url(session_id: str, user=Depends(get_current_user)):
    """Generate a presigned PUT URL for the frontend to upload the session recording directly to S3."""
    if not s3_client:
        raise HTTPException(status_code=503, detail="Recording service not configured")

    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    s3_key = f"recordings/{user['id']}/{session_id}.webm"

    try:
        upload_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': s3_key,
                'ContentType': 'audio/webm',
            },
            ExpiresIn=600,  # 10 minutes to upload
        )

        # Set recording status to "uploading"
        await db.sessions.update_one(
            {"id": session_id},
            {"$set": {"recording_status": "uploading", "recording_s3_key": s3_key}}
        )

        logger.info(f"Generated presigned upload URL for session {session_id}")
        return {"upload_url": upload_url, "s3_key": s3_key}

    except Exception as e:
        logger.error(f"Failed to generate presigned URL for session {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {str(e)}")


@api_router.put("/sessions/{session_id}/recording-status")
async def update_recording_status(session_id: str, input: RecordingStatusInput, user=Depends(get_current_user)):
    """Called by the frontend after upload completes (or fails) to finalize the recording URL."""
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    if input.status == "uploaded":
        s3_key = s.get("recording_s3_key", "")
        if s3_key and s3_client:
            # Generate the public S3 URL (or use presigned GET for private buckets)
            recording_url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{s3_key}"
            await db.sessions.update_one(
                {"id": session_id},
                {"$set": {"recording_status": "uploaded", "recording_url": recording_url}}
            )
            logger.info(f"Recording uploaded for session {session_id}: {recording_url}")
            return {"recording_status": "uploaded", "recording_url": recording_url}
        else:
            raise HTTPException(status_code=400, detail="No S3 key found for this session")
    elif input.status == "failed":
        await db.sessions.update_one(
            {"id": session_id},
            {"$set": {"recording_status": "failed", "recording_error": input.error}}
        )
        logger.warning(f"Recording upload failed for session {session_id}: {input.error}")
        return {"recording_status": "failed"}
    else:
        raise HTTPException(status_code=400, detail="Invalid status — use 'uploaded' or 'failed'")


@api_router.get("/sessions/{session_id}/recording-url")
async def get_recording_playback_url(session_id: str, user=Depends(get_current_user)):
    """Generate a presigned GET URL for playing back the recording."""
    if not s3_client:
        raise HTTPException(status_code=503, detail="Recording service not configured")

    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    if s.get("recording_status") != "uploaded":
        raise HTTPException(status_code=404, detail="No recording available")

    s3_key = s.get("recording_s3_key", "")
    if not s3_key:
        raise HTTPException(status_code=404, detail="No recording found")

    try:
        playback_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': S3_BUCKET, 'Key': s3_key},
            ExpiresIn=3600,  # 1 hour
        )
        return {"playback_url": playback_url, "recording_status": s.get("recording_status")}
    except Exception as e:
        logger.error(f"Failed to generate playback URL: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate playback URL")

# ==================== Assessment Scoring ====================
class ScoreAssessmentInput(BaseModel):
    transcript: list = []

@api_router.post("/sessions/{session_id}/score-assessment")
async def score_assessment(session_id: str, input: ScoreAssessmentInput = ScoreAssessmentInput(), user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    # FIX: Idempotency check — don't re-score an already scored assessment
    if s.get("assessment_scores"):
        logger.info(f"Assessment {session_id} already scored, returning cached scores")
        return s["assessment_scores"]

    # Prefer transcript from payload (live, always fresh) — fall back to DB
    transcript = input.transcript if input.transcript else s.get("transcript", [])
    transcript_text = "\n".join([f"{t.get('speaker','?')}: {t.get('text','')}" for t in transcript])
    prompt = f"""You are an expert English assessor. Analyze this conversation and provide CEFR scoring.

Transcript:
{transcript_text if transcript_text.strip() else "No transcript available - provide default B1 assessment."}

Evaluate: Fluency(30%), Grammar(30%), Vocabulary(25%), Confidence(15%). Provide a realistic score out of 100 based strictly on the transcript provided. Do not use default or static scores like 50. If the transcript is very short, scoring should legitimately reflect that lack of context.
CEFR: A1(0-16), A2(17-33), B1(34-50), B2(51-67), C1(68-84), C2(85-100).

Respond ONLY with valid JSON:
{{"fluency_score":0,"grammar_score":0,"vocabulary_score":0,"confidence_score":0,"weighted_score":0,"cefr_level":"B1","strengths":["str1","str2"],"areas_to_improve":["area1","area2"],"detailed_feedback":"feedback text"}}"""

    try:
        response = get_gemini_client().models.generate_content(
            model=TEXT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        scores = json.loads(response.text)
    except Exception as e:
        logger.error(f"Assessment scoring error: {e}")
        scores = {"fluency_score": 5, "grammar_score": 5, "vocabulary_score": 5, "confidence_score": 5, "weighted_score": 50, "cefr_level": "B1", "strengths": ["Good communication willingness", "Engaged in conversation"], "areas_to_improve": ["Grammar accuracy", "Vocabulary range"], "detailed_feedback": "Assessment completed. Let's work together to improve your English!"}

    cefr = scores.get("cefr_level", "B1")
    await db.sessions.update_one({"id": session_id}, {"$set": {
        "metrics.grammar_accuracy": scores.get("grammar_score", 0),
        "metrics.overall_score": scores.get("weighted_score", 0),
        "assessment_scores": scores,
    }})
    await db.users.update_one({"id": user["id"]}, {"$set": {"cefr_level": cefr, "assessment_completed": True, "assessment_completed_at": datetime.now(timezone.utc).isoformat()}})
    await db.memories.insert_one({"user_id": user["id"], "type": "assessment", "content": f"Initial assessment: CEFR {cefr}. Strengths: {', '.join(scores.get('strengths', []))}. Improve: {', '.join(scores.get('areas_to_improve', []))}.", "created_at": datetime.now(timezone.utc).isoformat()})
    return scores

# ==================== Learning Plans ====================
@api_router.get("/learning-plan")
async def get_learning_plan(user=Depends(get_current_user)):
    plan = await db.learning_plans.find_one({"user_id": user["id"], "is_active": True}, {"_id": 0})
    if plan:
        for mod in plan.get("modules", []):
            for sess in mod.get("sessions", []):
                if sess.get("status") == "completed" and "score" not in sess and sess.get("completed_session_id"):
                    s = await db.sessions.find_one({"id": sess["completed_session_id"]}, {"metrics": 1, "_id": 0})
                    if s and s.get("metrics"):
                        sess["score"] = s["metrics"].get("overall_score", 0)
    return plan

@api_router.post("/learning-plan/generate")
async def generate_learning_plan(user=Depends(get_current_user)):
    # Refresh user with tutor persona info
    user = await ensure_tutor_persona(user["id"])
    current_level = user.get("cefr_level", "A1")
    target_level = user.get("target_cefr_level", "B2")
    goals = user.get("learning_goals", [])
    spw = user.get("sessions_per_week", 3)
    tutor_profile = user.get("tutor_profile", {}) or {}
    tutor_name = tutor_profile.get("name", "your tutor")
    prompt = f"""You are an expert English curriculum designer. Create a personalized spoken English learning plan that this tutor will follow in live sessions.

Student profile:
- Current CEFR level: {current_level}
- Target CEFR level: {target_level}
- Learning goals: {', '.join(goals) if goals else "General English improvement"}
- Sessions per week: {spw}
- Each session is a SHORT voice conversation between 5 and 10 minutes (target duration in that range, not strictly fixed)

Tutor persona (already created and stored for this user — you MUST keep her identity consistent):
- Name: {tutor_profile.get('name', 'Pooja')}
- City: {tutor_profile.get('city', 'an Indian city')}
- Background: {tutor_profile.get('background', 'An Indian English coach who loves helping learners.')}
- Hobbies: {', '.join(tutor_profile.get('hobbies', [])) or 'reading, music'}
- Teaching style: {tutor_profile.get('teaching_style', 'Warm, encouraging, conversational, never just firing questions.')}

Create exactly 4 weekly modules. Each module must have EXACTLY {spw} sessions.
Sessions are SEQUENTIAL and PROGRESSIVE — each builds on the previous one.

For EVERY session, write a "system_prompt" field. This is the FULL instruction given to the voice tutor PERSONA for that session. It must:
1. Start with the persona, e.g. "You are {tutor_name}, a warm Indian English coach. This is [Week X, Session Y]."
2. Briefly restate 1–2 key facts from her bio (for this specific user) so the model stays in character.
3. Specify the EXACT topic and activity for the conversation (assume roughly 5–10 minutes).
4. List 2–3 specific phrases, structures, or vocabulary to introduce.
5. Describe how to correct errors for a {current_level} student (gently, inline).
6. Conversation style: It must feel like a two-way chat, NOT an interview.
   - The tutor should sometimes volunteer information about herself, react to what the student says, and relate it to her own life.
   - Avoid rapid-fire questions; mix questions with comments, short stories, and encouragement.
7. Rule: Keep the conversation completely open-ended at all times by asking follow-up questions to keep the user engaged. Do NOT abruptly end the conversation.
8. End instruction: "Before closing the session, always ask the student if they have any other questions or anything else they want to practice. ONLY close the session after they confirm they have nothing else."
Difficulty progression:
- Week 1: Very easy, welcoming, short sentences, present tense only
- Week 2: Slightly harder, introduce past tense, more vocabulary
- Week 3: Medium, complex sentences, opinions
- Week 4: Consolidation, mix of all skills

Respond ONLY with valid JSON matching this EXACT structure:
{{
  "estimated_weeks": 4,
  "modules": [
    {{
      "title": "Week 1: Daily Life",
      "week_number": 1,
      "focus_areas": ["introductions", "present tense"],
      "difficulty": "easy",
      "sessions": [
        {{
          "type": "speaking",
          "title": "Introducing Yourself",
          "description": "Practice introducing yourself with name, job, and where you live",
          "duration_minutes": 8,
          "system_prompt": "You are {tutor_name}, a warm Indian English coach. This is Week 1, Session 1 — the student's first ever session. Be very welcoming and encouraging. Start by briefly introducing yourself (name, where you live, one hobby) and then ask their name and where they are from. Practice these phrases: 'My name is...', 'I live in...', 'I work as a...'. Mix questions with natural comments about your own life so it feels like two humans chatting, not an interview. Always keep the conversation open-ended. If they make grammar errors, repeat the correct form naturally in your response without making them feel bad. Towards the end, ask if they have any other questions or anything else to practice. If they say no, close the session by saying: 'Great work today! You practiced introducing yourself in English.'"
        }}
      ]
    }}
  ]
}}"""

    try:
        response = get_gemini_client().models.generate_content(
            model=TEXT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        plan_data = json.loads(response.text)
    except Exception as e:
        logger.error(f"Plan generation error: {e}")
        week_titles = ["Foundations", "Building Skills", "Fluency Practice", "Consolidation"]
        week_difficulties = ["easy", "medium", "medium", "hard"]
        fallback_modules = []
        for w in range(4):
            fallback_sessions = []
            for s in range(spw):
                if w == 0 and s == 0:
                    opening = "Start with a warm welcome and ask the student about themselves."
                else:
                    opening = "Briefly recap what was covered last session, then continue with today's practice."
                fallback_sessions.append({
                    "type": "speaking",
                    "title": "Week " + str(w+1) + " - Session " + str(s+1),
                    "description": "Introductions and basics" if w == 0 else "Conversation practice building on previous sessions",
                    "duration_minutes": 8,
                    "system_prompt": (
                        "You are Fluentra, a warm English coach. This is Week " + str(w+1) + ", Session " + str(s+1) + ". "
                        "Conduct a short speaking session (around 5–10 minutes) for a " + current_level + " student. "
                        "Focus on natural conversation. Always keep the conversation open-ended and ask follow-up questions. Correct errors gently by repeating the correct form naturally. "
                        "Before ending, ask if they have any other questions or want to practice anything else. Once they say no, end with: Great session! Today you practiced speaking in English."
                    )
                })
            fallback_modules.append({
                "title": "Week " + str(w+1) + ": " + week_titles[w],
                "week_number": w + 1,
                "focus_areas": ["speaking", "vocabulary"],
                "difficulty": week_difficulties[w],
                "sessions": fallback_sessions,
            })
        plan_data = {"estimated_weeks": 4, "modules": fallback_modules}

    plan_id = str(uuid.uuid4())

    # Stamp every session with a deterministic plan_session_id.
    # Status: first session of week 1 = "unlocked", all others = "locked".
    # Sessions unlock one-by-one as each is completed.
    raw_modules = plan_data.get("modules", [])
    first_session = True
    for mod in raw_modules:
        week_num = mod.get("week_number", 1)
        for seq, sess in enumerate(mod.get("sessions", []), start=1):
            sess["plan_session_id"] = f"{plan_id}_week_{week_num}_{seq}"
            sess["status"] = "unlocked" if first_session else "locked"
            sess["duration_minutes"] = min(sess.get("duration_minutes", 10), 10)  # enforce 10 min cap
            first_session = False

    plan = {
        "id": plan_id, "user_id": user["id"], "current_cefr_level": current_level, "target_cefr_level": target_level,
        "estimated_weeks": plan_data.get("estimated_weeks", 8),
        "estimated_completion_date": (datetime.now(timezone.utc) + timedelta(weeks=plan_data.get("estimated_weeks", 8))).isoformat(),
        "sessions_per_week": spw, "modules": raw_modules,
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

# ==================== Gemini Live Token (ephemeral, direct client connection) ====================

"""
Drop-in replacement for the /sessions/live-token endpoint in server.py.

Replace the block between:
  # ==================== Gemini Live Token ====================
and the next section comment with this entire file content.
"""

# ==================== Gemini Live Token ====================

class LiveTokenRequest(BaseModel):
    session_id: str
    system_prompt: str = ""


@api_router.post("/sessions/live-token")
async def get_live_token(input: LiveTokenRequest, user=Depends(get_current_user)):
    """
    Mint a short-lived ephemeral token with the full Live session config
    baked in server-side. The frontend connects DIRECTLY to Gemini Live
    using this token — the real API key never leaves the server.
    """
    s_doc = await db.sessions.find_one(
        {"id": input.session_id, "user_id": user["id"]}
    )
    if not s_doc:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── Build system prompt ────────────────────────────────────────────────────
    user = await ensure_tutor_persona(user["id"])
    tutor_system_prompt = user.get("tutor_system_prompt", "")
    base_prompt = s_doc.get("system_prompt") or input.system_prompt or ""

    if tutor_system_prompt and tutor_system_prompt.strip() in base_prompt:
        system_prompt = base_prompt
    else:
        system_prompt = (tutor_system_prompt + "\n\n" + base_prompt).strip()

    # Append previous session recap
    try:
        last_session = await db.sessions.find_one(
            {
                "user_id": user["id"],
                "status": "completed",
                "analysis.summary": {"$exists": True},
                "id": {"$ne": input.session_id},
            },
            {"_id": 0},
            sort=[("started_at", -1)],
        )
        if last_session and last_session.get("analysis", {}).get("summary"):
            system_prompt += f"\n\nPrevious session recap:\n{last_session['analysis']['summary']}"
    except Exception as e:
        logger.warning(f"Could not fetch previous session summary: {e}")

    system_prompt += "\n\nCRITICAL INSTRUCTION: The user will speak in English. You MUST transcribe and understand their speech strictly in English. Do NOT transcribe into Hindi or any other language, even if they have an accent or use loan words. Your generated transcripts and responses must always be in English."

    # ── Mint the token ─────────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)

    try:
        token = get_gemini_live_client().auth_tokens.create(
            config={
                "uses": 1,
                # Session stays valid for 30 min once started
                "expire_time": (now + timedelta(minutes=30)).isoformat(),
                # Client must open the session within 2 min of receiving the token
                "new_session_expire_time": (now + timedelta(minutes=2)).isoformat(),

                "live_connect_constraints": {
                    "model": LIVE_MODEL,
                    "config": {
                        # ── Output ──────────────────────────────────────────
                        "response_modalities": ["AUDIO"],

                        # ── System prompt (persona + session plan) ──────────
                        "system_instruction": system_prompt,

                        # ── Voice ────────────────────────────────────────────
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {"voice_name": "Aoede"}
                            }
                        },

                        # ── Transcription (free, side-channel) ───────────────
                        "input_audio_transcription": {},
                        "output_audio_transcription": {},

                        # ── Latency: disable thinking for conversation ────────
                        # thinking_budget=0 removes the reasoning pass entirely,
                        # cutting time-to-first-audio-chunk significantly.
                        "thinking_config": {"thinking_budget": 0},

                        # ── VAD — most impactful latency knob ────────────────
                        # The defaults are too aggressive: they end turns too
                        # quickly (model talks before you finish) AND they are
                        # too sensitive to silence gaps (choppy back-and-forth).
                        #
                        # Tuning guide:
                        #   start_of_speech_sensitivity HIGH  → model starts
                        #     processing as soon as you open your mouth (fast).
                        #   end_of_speech_sensitivity   LOW   → model waits a
                        #     beat before deciding you're done (natural pauses).
                        #   silence_duration_ms         600   → 600 ms of silence
                        #     confirms end of turn. Shorter = faster but cuts off
                        #     mid-thought; longer = more natural but slightly
                        #     higher perceived latency after you stop talking.
                        #   prefix_padding_ms           100   → ignore very short
                        #     noise bursts (< 100 ms) at start of turn.
                        "realtime_input_config": {
                            "automatic_activity_detection": {
                                "disabled": False,
                                "start_of_speech_sensitivity": "START_SENSITIVITY_HIGH",
                                "end_of_speech_sensitivity":   "END_SENSITIVITY_LOW",
                                "silence_duration_ms":         600,
                                "prefix_padding_ms":           100,
                            },
                            # Only send audio the user actually spoke —
                            # not silence between turns.
                            "turn_coverage": "TURN_INCLUDES_ONLY_ACTIVITY",
                        },

                        # ── Proactivity ──────────────────────────────────────
                        # Lets the model stay silent when it decides the user's
                        # speech was ambient / not directed at it.
                        "proactivity": {"proactive_audio": True},

                        # ── Context window compression ───────────────────────
                        # Native audio burns ~25 tokens/sec. Without compression
                        # a 10-min session uses ~15k tokens of context and the
                        # model slows down noticeably.
                        "context_window_compression": {
                            "sliding_window": {},
                            "trigger_tokens": 10000,
                        },
                    },
                },

                "http_options": {"api_version": "v1alpha"},
            }
        )

        logger.info(f"Minted ephemeral token for session {input.session_id}")
        return {"token": token.name, "model": LIVE_MODEL}

    except Exception as e:
        logger.error(f"Failed to mint ephemeral token: {e}")
        raise HTTPException(status_code=500, detail=f"Could not create live token: {str(e)}")

# ==================== Gemini Live WebSocket (DEPRECATED — kept as fallback) ====================
@app.websocket("/api/ws/session")
async def websocket_session(websocket: WebSocket):
    # This remains for fallback
    await websocket.accept()
    await websocket.close()

# ==================== Real-time Voice Agent App ====================

LANGUAGE_MAP = {
    "en-US": "English (US)",
    "en-IN": "English (India)",
    "hi-IN": "Hindi",
    "fr-FR": "French",
    "de-DE": "German",
    "es-US": "Spanish",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "pt-BR": "Portuguese (Brazil)",
    "ar-EG": "Arabic (Egypt)"
}

async def generate_session_report(session_id: str, transcripts: list):
    try:
        transcript_text = "\n".join([f"{t['speaker'].upper()}: {t['text']}" for t in transcripts])
        prompt = f"""Analyze this voice session transcript and provide a detailed report.
TRANSCRIPT:
{transcript_text}

SCORING CRITERIA (Strictly evaluate out of 100 based on the transcript, DO NOT output default numbers like 85):
- Provide a realistic score based on the actual transcript. If the user spoke very little or made many errors, give a lower score (e.g., 20-40). If they did well, give a higher score.

Respond with strictly valid JSON matching this schema:
{{
  "score": 0,
  "executive_summary": "Overall good session...",
  "strengths": ["Clear pronunciation"],
  "weaknesses": ["Grammar errors in past tense"],
  "suggestions": ["Practice past tense"],
  "communication_style": "Friendly and clear",
  "engagement_metrics": {{"talk_time_percentage": 45}},
  "key_takeaways": ["Needs work on verb forms"],
  "transcript_highlights": ["User: ..."]
}}"""
        response = await get_gemini_client().aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        report = json.loads(response.text)
        await db.sessions.update_one(
            {"id": session_id},
            {"$set": {"report": report, "transcripts": transcripts, "status": "completed"}}
        )
    except Exception as e:
        logger.error(f"Report generation error: {e}")
        await db.sessions.update_one(
            {"id": session_id},
            {"$set": {"status": "completed", "transcripts": transcripts}}
        )

@app.websocket("/api/ws/voice-agent/")
async def websocket_voice_agent(
    websocket: WebSocket,
    prompt: str = "",
    agent_id: str = "default",
    voice: str = "Aoede",
    language: str = "en-US",
    token: str = ""
):
    await websocket.accept()
    logger.info("Voice connection established")
    
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
        if not user:
            await websocket.close(code=1008)
            return
    except Exception as e:
        logger.error(f"WS auth error: {e}")
        await websocket.close(code=1008)
        return

    lang_name = LANGUAGE_MAP.get(language, "English")
    if language and not language.startswith("en-"):
        prompt += f"\n\nIMPORTANT: You must speak and respond in {lang_name}."

    session_id = str(uuid.uuid4())
    
    session_doc = {
        "id": session_id,
        "user_id": user["id"],
        "agent_id": agent_id,
        "language": language,
        "transcripts": [],
        "report": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": None,
        "session_type": "speaking",
        "status": "active",
        "system_prompt": prompt
    }
    await db.sessions.insert_one(session_doc)
    
    await websocket.send_json({"type": "session_created", "sessionId": session_id})

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part(text=prompt)]),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice
                )
            )
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    done_event = asyncio.Event()
    session_transcripts = []
    ai_text_fragments = []
    user_text_fragments = []

    try:
        async with get_gemini_live_client().aio.live.connect(
            model=LIVE_MODEL,
            config=config
        ) as gemini_session:
            
            async def receive_from_gemini():
                nonlocal ai_text_fragments, user_text_fragments
                try:
                    while not done_event.is_set():
                        turn = gemini_session.receive()
                        async for response in turn:
                            if done_event.is_set():
                                return
                            sc = response.server_content
                            if sc is None:
                                continue

                            if sc.model_turn and sc.model_turn.parts:
                                for part in sc.model_turn.parts:
                                    if part.inline_data and part.inline_data.data:
                                        b64_audio = base64.b64encode(part.inline_data.data).decode('utf-8')
                                        await websocket.send_json({"type": "audio", "data": b64_audio})

                            if hasattr(sc, 'output_transcription') and sc.output_transcription:
                                text = getattr(sc.output_transcription, 'text', '')
                                if text:
                                    ai_text_fragments.append(text)
                                    await websocket.send_json({"type": "text", "data": text, "isPartial": True})
                            
                            if hasattr(sc, 'input_transcription') and sc.input_transcription:
                                text = getattr(sc.input_transcription, 'text', '')
                                if text:
                                    user_text_fragments.append(text)
                                    await websocket.send_json({"type": "transcription", "role": "user", "text": text, "isPartial": True})

                            if sc.turn_complete:
                                if ai_text_fragments:
                                    final_ai_text = " ".join(ai_text_fragments).strip()
                                    session_transcripts.append({"speaker": "ai", "text": final_ai_text})
                                    ai_text_fragments = []
                                    await websocket.send_json({"type": "text_complete"})
                                if user_text_fragments:
                                    final_user_text = " ".join(user_text_fragments).strip()
                                    session_transcripts.append({"speaker": "user", "text": final_user_text})
                                    user_text_fragments = []
                                    await websocket.send_json({"type": "transcription_complete"})
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error(f"Gemini receive error: {e}")
                finally:
                    done_event.set()

            async def receive_from_client():
                try:
                    while not done_event.is_set():
                        message = await websocket.receive_text()
                        data = json.loads(message)
                        if data.get("type") == "audio" and data.get("data"):
                            audio_bytes = base64.b64decode(data["data"])
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                            )
                        elif data.get("type") == "end":
                            done_event.set()
                            break
                        elif data.get("type") == "text":
                            await gemini_session.send_client_content(
                                turns=types.Content(parts=[types.Part(text=data["text"])]),
                                turn_complete=True
                            )
                except asyncio.CancelledError:
                    pass
                except WebSocketDisconnect:
                    logger.info("Client disconnected")
                except Exception as e:
                    logger.error(f"Client receive error: {e}")
                finally:
                    done_event.set()

            task_client = asyncio.create_task(receive_from_client())
            task_gemini = asyncio.create_task(receive_from_gemini())
            
            done, pending = await asyncio.wait(
                [task_client, task_gemini],
                return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except Exception as e:
        logger.error(f"Session connect error: {e}")
    finally:
        now = datetime.now(timezone.utc).isoformat()
        await db.sessions.update_one(
            {"id": session_id},
            {"$set": {"ended_at": now, "status": "generating_report", "duration_minutes": 30}}
        )
        if session_transcripts:
            asyncio.create_task(generate_session_report(session_id, session_transcripts))
        else:
            await db.sessions.update_one(
                {"id": session_id},
                {"$set": {"status": "completed"}}
            )
            
        try:
            await websocket.close()
        except:
            pass

# ==================== AI Session Scoring ====================
class ScoreSessionInput(BaseModel):
    session_id: str
    transcript: list = []
    force_rescore: bool = False

@api_router.post("/ai/score-session")
async def score_session_ai(input: ScoreSessionInput, user=Depends(get_current_user)):
    import re
    # Ensure tutor persona exists for this user (used when adapting future prompts)
    user = await ensure_tutor_persona(user["id"])
    session_id = input.session_id
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    # Idempotency — if already scored, return cached result (unless force_rescore)
    if not input.force_rescore and s.get("metrics", {}).get("overall_score", 0) > 0:
        logger.info(f"Session {session_id} already scored, returning cached result")
        return {"metrics": s.get("metrics", {}), "analysis": s.get("analysis", {})}

    # Use transcript from payload to avoid race condition with /complete write
    transcript = input.transcript if input.transcript else s.get("transcript", [])
    cefr = user.get("cefr_level", "B1")
    session_type = s.get("session_type", "speaking")

    def clean_text(t):
        return re.sub(r"  +", " ", t.get("text", "")).strip()

    user_turns = [clean_text(t) for t in transcript if t.get("speaker") == "user" and clean_text(t) and clean_text(t) not in ("<noise>", ".")]
    user_word_count = sum(len(t.split()) for t in user_turns)
    user_turn_count = len(user_turns)

    transcript_text = "\n".join([
        f"{t.get('speaker','?').upper()}: {clean_text(t)}"
        for t in transcript if clean_text(t)
    ])
    logger.info(f"Scoring session {session_id}, transcript length: {len(transcript_text)} chars, user words: {user_word_count}, user turns: {user_turn_count}")

    async def call_with_retry(fn, retries=3, base_delay=15):
        for attempt in range(retries):
            try:
                return fn()
            except Exception as e:
                if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < retries - 1:
                    wait = base_delay * (2 ** attempt)
                    logger.warning(f"Rate limited, retrying in {wait}s (attempt {attempt+1}/{retries})")
                    await asyncio.sleep(wait)
                else:
                    raise

    prompt = f"""You are an expert English language evaluator. Deeply analyze this {session_type} session for a {cefr}-level student and return a comprehensive, HONEST evaluation.

TRANSCRIPT:
{transcript_text if transcript_text.strip() else "Very short session — provide very low scores (10-25)."}

TRANSCRIPT STATISTICS:
- The student spoke {user_word_count} words across {user_turn_count} turns.
- For reference: a good 8-minute session should have 150-400 student words.

## CRITICAL SCORING RULES — READ CAREFULLY:
1. You MUST score based ONLY on what the student actually said in the transcript above.
2. DO NOT give default/safe scores. Each metric must be independently calculated.
3. Every score across the different metrics MUST be different — grammar, vocabulary, fluency, confidence should NOT all be the same number.
4. Reference these calibration examples:
   - Student who only says "Yes", "No", "Okay", single words, or non-English → overall 15-30
   - Student who speaks in fragments ("I go school", "breakfast toast") → overall 25-40
   - Student who forms basic sentences with frequent errors → overall 35-50
   - Student who speaks in mostly correct simple sentences → overall 50-65
   - Student who speaks fluently with minor errors → overall 65-80
   - Student who speaks very fluently with rare errors → overall 80-95
5. The student in this transcript spoke only {user_word_count} words. Score accordingly — fewer words = lower fluency and confidence scores.
6. If the student used non-English words (Hindi, Telugu, Arabic, etc.), this should LOWER their scores significantly.
7. The "strengths" and "areas_for_improvement" arrays are MANDATORY — you MUST include at least 2 items in each.

SCORING CRITERIA (each independently 0-100):
- Grammar Accuracy: Correct tenses, articles, prepositions, sentence structure. Missing subjects/verbs = low score.
- Fluency WPM: Approximate words per minute the student spoke in English. Raw count: {user_word_count} words in ~{s.get('duration_minutes', 8)} minutes.
- Vocabulary: Variety and appropriateness of words used. Single-word answers = very low.
- Confidence: Willingness to speak, length of responses, self-correction attempts.
- Overall Score: Weighted average reflecting true ability. Must NOT be the same as any individual metric.

Return ONLY valid JSON with this exact structure:
{{
  "overall_score": 0,
  "grammar_accuracy": 0,
  "fluency_wpm": 0,
  "confidence_score": 0,
  "vocabulary_score": 0,
  "pronunciation_score": 0,
  "filler_word_count": 0,
  "topic_relevance_score": 0,

  "skill_breakdown": {{
    "grammar": 0,
    "vocabulary": 0,
    "fluency": 0,
    "confidence": 0,
    "listening": 0,
    "coherence": 0
  }},

  "summary": "2-3 sentence recap of what was discussed and the student's overall performance.",

  "strengths": [
    "Specific strength 1: describe with example from transcript",
    "Specific strength 2: describe with example from transcript"
  ],

  "areas_for_improvement": [
    "Specific area 1: concrete advice on what to practice",
    "Specific area 2: concrete advice on what to practice"
  ],

  "homework": [
    {{
      "title": "Exercise title",
      "description": "Detailed description of what to do",
      "estimated_minutes": 15,
      "type": "writing|speaking|reading|grammar|vocabulary"
    }}
  ],

  "new_words": ["word1", "word2"],

  "mistakes": [
    {{
      "original": "what they said",
      "corrected": "what they should say",
      "explanation": "why this is wrong and how to remember the correct form",
      "error_type": "grammar|vocabulary|pronunciation|structure",
      "severity": "minor|moderate|major"
    }}
  ],

  "encouraging_note": "A warm, personalized 1-2 sentence motivational note based on their specific progress.",

  "next_session_focus": "One specific topic or skill to focus on next session based on their weaknesses.",

  "filler_words_used": ["um", "uh"],

  "conversation_topics": ["topic1", "topic2"],

  "other_details": "Any other noteworthy observation about their learning style or progress."
}}"""

    try:
        response = await call_with_retry(lambda: get_gemini_client().models.generate_content(
            model=TEXT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        ))
        scores = json.loads(response.text)
    except Exception as e:
        logger.error(f"Session scoring error for {session_id}: {type(e).__name__}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        scores = {
            "overall_score": 0, "grammar_accuracy": 0, "fluency_wpm": 0,
            "confidence_score": 0, "vocabulary_score": 0, "pronunciation_score": 0,
            "filler_word_count": 0, "topic_relevance_score": 0,
            "skill_breakdown": {"grammar": 0, "vocabulary": 0, "fluency": 0, "confidence": 0, "listening": 0, "coherence": 0},
            "summary": f"Scoring failed: {str(e)[:100]}", "strengths": [], "areas_for_improvement": [],
            "homework": [], "new_words": [], "mistakes": [],
            "encouraging_note": "Keep practising!", "next_session_focus": "General conversation",
            "filler_words_used": [], "conversation_topics": [], "other_details": ""
        }

    metrics = {
        "overall_score": scores.get("overall_score", 0),
        "grammar_accuracy": scores.get("grammar_accuracy", 0),
        "fluency_wpm": scores.get("fluency_wpm", 0),
        "confidence_score": scores.get("confidence_score", 0),
        "vocabulary_score": scores.get("vocabulary_score", 0),
        "pronunciation_score": scores.get("pronunciation_score", 0),
        "filler_word_count": scores.get("filler_word_count", 0),
        "topic_relevance_score": scores.get("topic_relevance_score", 0),
        "skill_breakdown": scores.get("skill_breakdown", {}),
    }

    # Ensure strengths and areas_for_improvement are always populated
    strengths = scores.get("strengths", [])
    areas_for_improvement = scores.get("areas_for_improvement", [])

    # Fallback: if Gemini didn't return strengths, generate from context
    if not strengths:
        if user_word_count > 0:
            strengths.append("Willingness to communicate: Made an effort to participate in the conversation despite limited vocabulary.")
        if user_turn_count >= 3:
            strengths.append("Engagement: Stayed engaged throughout the session and responded to questions.")
        if not strengths:
            strengths.append("Showed up and practiced, which is the most important step in language learning.")

    if not areas_for_improvement:
        if user_word_count < 50:
            areas_for_improvement.append("Speaking volume: Try to speak in longer sentences instead of single words or short phrases.")
        areas_for_improvement.append("Sentence structure: Practice forming complete sentences with subject + verb + object pattern.")
        if not areas_for_improvement:
            areas_for_improvement.append("Continue practicing to build fluency and confidence.")

    analysis = {
        "summary": scores.get("summary", ""),
        "strengths": strengths,
        "areas_for_improvement": areas_for_improvement,
        "homework": scores.get("homework", []),
        "new_words": scores.get("new_words", []),
        "mistakes": [],  # structured mistakes stored in db.mistakes separately
        "encouraging_note": scores.get("encouraging_note", ""),
        "next_session_focus": scores.get("next_session_focus", ""),
        "filler_words_used": scores.get("filler_words_used", []),
        "conversation_topics": scores.get("conversation_topics", []),
        "other_details": scores.get("other_details", ""),
    }

    logger.info(f"Session {session_id} scored: overall={metrics['overall_score']}, grammar={metrics['grammar_accuracy']}, vocab={metrics['vocabulary_score']}, strengths={len(strengths)}, areas={len(areas_for_improvement)}")

    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"metrics": metrics, "analysis": analysis, "feedback": strengths}}
    )

    for m in scores.get("mistakes", []):
        if m.get("original") and m.get("corrected"):
            await db.mistakes.insert_one({
                "id": str(uuid.uuid4()), "user_id": user["id"], "session_id": session_id,
                "error_type": m.get("error_type", "grammar"), "severity": m.get("severity", "minor"),
                "original": m.get("original", ""), "corrected": m.get("corrected", ""),
                "explanation": m.get("explanation", ""), "context": "", "acknowledged": False,
                "recurrence": 1, "created_at": datetime.now(timezone.utc).isoformat()
            })

    # ── Update plan: complete current session, unlock next, adapt its prompt ────
    plan_session_id = s.get("plan_session_id")
    plan_id_ref = s.get("plan_id")
    plan_mod_idx = s.get("plan_module_index")
    plan_sess_idx = s.get("plan_session_index")

    if plan_id_ref and (plan_session_id or (plan_mod_idx is not None and plan_sess_idx is not None)):
        plan_doc = await db.learning_plans.find_one({"id": plan_id_ref}, {"_id": 0})
        if plan_doc:
            modules = plan_doc.get("modules", [])

            # ── Step 1: Find and mark the just-completed session ──────────────
            completed_mod_i = None
            completed_sess_i = None

            for mi, mod in enumerate(modules):
                for si, tmpl in enumerate(mod.get("sessions", [])):
                    match = (
                        (plan_session_id and tmpl.get("plan_session_id") == plan_session_id) or
                        (plan_mod_idx == mi and plan_sess_idx == si)
                    )
                    if match:
                        tmpl["status"] = "completed"
                        tmpl["completed_session_id"] = session_id
                        tmpl["completed_at"] = datetime.now(timezone.utc).isoformat()
                        tmpl["score"] = scores.get("overall_score", 0)
                        completed_mod_i = mi
                        completed_sess_i = si
                        break
                if completed_mod_i is not None:
                    break

            if completed_mod_i is not None:
                # ── Step 2: Find the next locked session ─────────────────────
                next_sess = None
                next_mod_i = completed_mod_i
                next_sess_i = completed_sess_i + 1
                # If past end of current module, move to next module
                if next_sess_i >= len(modules[next_mod_i].get("sessions", [])):
                    next_mod_i += 1
                    next_sess_i = 0
                if next_mod_i < len(modules) and next_sess_i < len(modules[next_mod_i].get("sessions", [])):
                    next_sess = modules[next_mod_i]["sessions"][next_sess_i]

                # ── Step 3: Unlock the next session ──────────────────────────
                if next_sess:
                    next_sess["status"] = "unlocked"

                # ── Step 4: Adaptively rewrite next session's system_prompt ──
                # Use scores from THIS session to tailor the next session's prompt
                if next_sess and next_sess.get("system_prompt"):
                    try:
                        top_mistakes = [
                            f"'{m.get('original')}' → should be '{m.get('corrected')}' ({m.get('explanation', '')})"
                            for m in scores.get("mistakes", [])[:3] if m.get("original")
                        ]
                        tutor_profile = user.get("tutor_profile", {}) or {}
                        tutor_name = tutor_profile.get("name", "your tutor")
                        tutor_city = tutor_profile.get("city", "an Indian city")
                        adapt_prompt = f"""You are an expert English curriculum designer.
A student just completed a 10-minute English speaking session with a HUMAN Indian tutor persona named {tutor_name} from {tutor_city}. Based on their performance, rewrite the system_prompt for their NEXT session to be perfectly tailored to their needs while KEEPING the same human persona, name, and backstory.

JUST-COMPLETED SESSION PERFORMANCE:
- Overall score: {scores.get('overall_score', 0)}/100
- Grammar accuracy: {scores.get('grammar_accuracy', 0)}%
- Confidence: {scores.get('confidence_score', 0)}%
- Fluency WPM: {scores.get('fluency_wpm', 0)}
- Key mistakes made: {json.dumps(top_mistakes) if top_mistakes else "None significant"}
- Areas for improvement: {json.dumps(scores.get('areas_for_improvement', [])[:2])}
- Next session focus recommended: {scores.get('next_session_focus', 'general practice')}

NEXT SESSION'S ORIGINAL PLAN:
Title: {next_sess.get('title')}
Original system_prompt: {next_sess.get('system_prompt')}

REWRITE RULES:
- Keep the same topic/title AND the same human tutor persona (same Indian name, city, and personality).
- The tutor should sound like a real person, not an AI assistant.
- If score < 50: slow down, revisit basics, be extra gentle and encouraging.
- If score 50-75: build on strengths, gently address weak areas mid-session.
- If score > 75: add slightly more complexity, introduce new vocabulary.
- The tutor must naturally slip in correction of top mistakes without making it feel like drilling.
- Conversation style: it should feel like two humans chatting, not an interview; mix questions with comments, short stories, and personal reactions from the tutor.
- Keep the conversation open-ended at all times, making sure to ask follow-up questions.
- Before ending the session, ALWAYS ask the student if they have any other questions or anything else they want to practice. ONLY close the session after they confirm they do not.
- Start with acknowledging progress from last session.

Respond ONLY with the new system_prompt string (no JSON wrapper, just the plain text instruction)."""

                        adapt_response = await call_with_retry(lambda: get_gemini_client().models.generate_content(
                            model=TEXT_MODEL,
                            contents=adapt_prompt,
                        ))
                        new_prompt = adapt_response.text.strip().strip('"')
                        if new_prompt and len(new_prompt) > 50:
                            next_sess["system_prompt"] = new_prompt
                            next_sess["prompt_adapted_from"] = session_id
                            logger.info(f"Adapted next session prompt for {next_sess.get('plan_session_id')}")
                    except Exception as e:
                        logger.error(f"Failed to adapt next session prompt: {e}")
                        # Keep original prompt — not a fatal error

                # ── Step 5: Advance current_module_index if module done ───────
                extra_updates = {}
                cur_mod_idx = plan_doc.get("current_module_index", 0)
                cur_mod = modules[cur_mod_idx] if cur_mod_idx < len(modules) else None
                if cur_mod and all(t.get("status") == "completed" for t in cur_mod.get("sessions", [])):
                    cur_mod["completed_at"] = datetime.now(timezone.utc).isoformat()
                    if cur_mod_idx + 1 < len(modules):
                        extra_updates["current_module_index"] = cur_mod_idx + 1
                        logger.info(f"Module {cur_mod_idx} complete — advancing to {cur_mod_idx + 1}")

                await db.learning_plans.update_one(
                    {"id": plan_id_ref},
                    {"$set": {"modules": modules, **extra_updates}}
                )
                logger.info(f"Plan updated: completed session {plan_session_id}, unlocked next")

    return {"metrics": metrics, "analysis": analysis}

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
