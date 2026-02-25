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

from google import genai
from google.genai import types

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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
    background_tasks.add_task(analyze_session, session_id, user["id"], transcript)
    return await db.sessions.find_one({"id": session_id}, {"_id": 0})

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

Evaluate: Fluency(30%), Grammar(30%), Vocabulary(25%), Confidence(15%).
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
    prompt = f"""You are an expert English curriculum designer. Create a personalized spoken English learning plan.

Student profile:
- Current CEFR level: {current_level}
- Target CEFR level: {target_level}
- Learning goals: {', '.join(goals) if goals else "General English improvement"}
- Sessions per week: {spw}
- Each session is EXACTLY 10 minutes (voice conversation with AI tutor)

Create exactly 4 weekly modules. Each module must have EXACTLY {spw} sessions.
Sessions are SEQUENTIAL and PROGRESSIVE — each builds on the previous one.

For EVERY session, write a "system_prompt" field. This is the FULL instruction given to the AI voice tutor for that session. It must:
1. Start: "You are Fluentra, a warm English coach. This is [Week X, Session Y]."
2. Specify the EXACT topic and activity for the 10 minutes
3. List 2-3 specific phrases, structures, or vocabulary to introduce
4. Describe how to correct errors for a {current_level} student (gently, inline)
5. End instruction: "Close the session by summarizing what was practiced in one sentence."

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
          "duration_minutes": 10,
          "system_prompt": "You are Fluentra, a warm English coach. This is Week 1, Session 1 — the student's first ever session. Be very welcoming and encouraging. Start by asking their name and where they are from. Practice these phrases: 'My name is...', 'I live in...', 'I work as a...'. Ask 3-4 simple follow-up questions. If they make grammar errors, repeat the correct form naturally in your response without making them feel bad. After 8-9 minutes, close the session by saying: 'Great work today! You practiced introducing yourself in English.'"
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
                    "duration_minutes": 10,
                    "system_prompt": (
                        "You are Fluentra, a warm English coach. This is Week " + str(w+1) + ", Session " + str(s+1) + ". "
                        "Conduct a 10-minute speaking session for a " + current_level + " student. "
                        + opening + " "
                        "Focus on natural conversation. Correct errors gently by repeating the correct form naturally. "
                        "End with: Great session! Today you practiced speaking in English."
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

class LiveTokenRequest(BaseModel):
    session_id: str
    system_prompt: str

@api_router.post("/sessions/live-token")
async def get_live_token(input: LiveTokenRequest, user=Depends(get_current_user)):
    """
    Mints a short-lived ephemeral token with the system prompt baked in server-side.
    The frontend uses this token to connect DIRECTLY to Gemini — no audio relay,
    zero latency overhead from the Python proxy.
    """
    s_doc = await db.sessions.find_one({"id": input.session_id, "user_id": user["id"]})
    if not s_doc:
        raise HTTPException(status_code=404, detail="Session not found")

    # Prefer system_prompt baked into the session doc (from plan template).
    # Fall back to whatever the frontend sent.
    system_prompt = s_doc.get("system_prompt") or input.system_prompt
    try:
        last_session = await db.sessions.find_one(
            {"user_id": user["id"], "status": "completed", "analysis.summary": {"$exists": True},
             "id": {"$ne": input.session_id}},
            {"_id": 0}, sort=[("started_at", -1)]
        )
        if last_session and last_session.get("analysis", {}).get("summary"):
            system_prompt += f"\n\nPrevious session recap:\n{last_session['analysis']['summary']}"
    except Exception as e:
        logger.warning(f"Could not fetch previous session summary: {e}")

    try:
        now = datetime.now(timezone.utc)
        token = get_gemini_live_client().auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": (now + timedelta(minutes=30)).isoformat(),
                "new_session_expire_time": (now + timedelta(minutes=2)).isoformat(),
                "live_connect_constraints": {
                    "model": LIVE_MODEL,
                    "config": {
                        "response_modalities": ["AUDIO"],
                        "system_instruction": system_prompt,
                        "input_audio_transcription": {},
                        "output_audio_transcription": {},
                    }
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
    await websocket.accept()
    logger.info("WebSocket connection established")
    user_id = None
    try:
        # First message is always JSON init
        init_data = await websocket.receive_json()
        system_prompt = init_data.get("system_prompt", "You are Fluentra, a friendly English tutor.")
        session_id = init_data.get("session_id", "")

        if session_id:
            s_doc = await db.sessions.find_one({"id": session_id})
            if s_doc:
                user_id = s_doc.get("user_id")

        if user_id:
            try:
                last_session = await db.sessions.find_one(
                    {"user_id": user_id, "status": "completed", "analysis.summary": {"$exists": True}},
                    {"_id": 0}, sort=[("started_at", -1)]
                )
                if last_session and last_session.get("analysis") and last_session["analysis"].get("summary"):
                    summary = last_session["analysis"]["summary"]
                    system_prompt += f"\n\nPrevious session recap:\n{summary}"
            except Exception as e:
                logger.error(f"Failed to fetch previous session summary: {e}")

        logger.info(f"Starting Gemini Live session for: {session_id}")
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )

        async with get_gemini_live_client().aio.live.connect(
            model=LIVE_MODEL,
            config=config
        ) as gemini_session:
            await websocket.send_json({"type": "connected"})
            logger.info("Gemini Live session connected")

            done_event = asyncio.Event()

            async def receive_from_client():
                try:
                    while not done_event.is_set():
                        # FIX: receive raw bytes OR text — audio takes the fast binary path
                        message = await websocket.receive()
                        if message.get("bytes") is not None:
                            # RAW BINARY PATH: Int16 PCM bytes sent directly, zero JSON/base64 overhead
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(data=message["bytes"], mime_type="audio/pcm;rate=16000")
                            )
                        elif message.get("text") is not None:
                            msg = json.loads(message["text"])
                            if msg.get("type") == "text":
                                await gemini_session.send_client_content(
                                    turns=types.Content(parts=[types.Part(text=msg["data"])]),
                                    turn_complete=True
                                )
                            elif msg.get("type") == "end":
                                done_event.set()
                                return
                except WebSocketDisconnect:
                    logger.info("Client disconnected")
                    done_event.set()
                except Exception as e:
                    logger.error(f"Client receive error: {e}")
                    done_event.set()

            async def send_to_client():
                try:
                    while not done_event.is_set():
                        turn = gemini_session.receive()
                        async for response in turn:
                            if done_event.is_set():
                                return
                            try:
                                sc = response.server_content
                                if sc is None:
                                    continue

                                if sc.model_turn and sc.model_turn.parts:
                                    for part in sc.model_turn.parts:
                                        if part.inline_data and part.inline_data.data:
                                            # FIX: Send audio as RAW BINARY frame — eliminates base64
                                            # encode on backend AND decode on frontend
                                            await websocket.send_bytes(part.inline_data.data)
                                        if part.text:
                                            await websocket.send_json({
                                                "type": "transcript",
                                                "data": part.text,
                                                "speaker": "ai"
                                            })

                                if hasattr(sc, 'output_transcription') and sc.output_transcription:
                                    text = getattr(sc.output_transcription, 'text', '')
                                    if text:
                                        await websocket.send_json({"type": "transcript", "data": text, "speaker": "ai"})

                                if hasattr(sc, 'input_transcription') and sc.input_transcription:
                                    text = getattr(sc.input_transcription, 'text', '')
                                    if text:
                                        await websocket.send_json({"type": "transcript", "data": text, "speaker": "user"})

                                if getattr(sc, 'interrupted', False):
                                    await websocket.send_json({"type": "interrupted"})

                                if sc.turn_complete:
                                    await websocket.send_json({"type": "turn_complete"})
                                    break

                            except WebSocketDisconnect:
                                done_event.set()
                                return
                            except Exception as inner_e:
                                err_str = str(inner_e)
                                if "1005" not in err_str and "1000" not in err_str:
                                    logger.error(f"Response processing error: {inner_e}")
                                done_event.set()
                                return

                except Exception as e:
                    if not done_event.is_set():
                        logger.error(f"Gemini receive error: {e}")
                    done_event.set()

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
    import re
    s = await db.sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    # Idempotency — if already scored, return cached result immediately
    if s.get("metrics", {}).get("overall_score", 0) > 0:
        logger.info(f"Session {session_id} already scored, returning cached result")
        return {"metrics": s.get("metrics", {}), "analysis": s.get("analysis", {})}

    transcript = s.get("transcript", [])
    cefr = user.get("cefr_level", "B1")
    session_type = s.get("session_type", "speaking")

    def clean_text(t):
        return re.sub(r"  +", " ", t.get("text", "")).strip()

    transcript_text = "\n".join([
        f"{t.get('speaker','?').upper()}: {clean_text(t)}"
        for t in transcript if clean_text(t)
    ])
    logger.info(f"Scoring session {session_id}, transcript length: {len(transcript_text)} chars")

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

    prompt = f"""You are an expert English language coach. Deeply analyze this {session_type} session for a {cefr}-level student and return a comprehensive evaluation.

TRANSCRIPT:
{transcript_text if transcript_text.strip() else "Very short session — provide conservative but encouraging scores."}

Return ONLY valid JSON with this exact structure:
{{
  "overall_score": 72,
  "grammar_accuracy": 68,
  "fluency_wpm": 95,
  "confidence_score": 70,
  "vocabulary_score": 65,
  "pronunciation_score": 72,
  "filler_word_count": 4,
  "topic_relevance_score": 80,

  "skill_breakdown": {{
    "grammar": 68,
    "vocabulary": 65,
    "fluency": 72,
    "confidence": 70,
    "listening": 75,
    "coherence": 68
  }},

  "summary": "2-3 sentence recap of what was discussed and the student's overall performance.",

  "strengths": [
    "Specific strength 1 with example from transcript",
    "Specific strength 2 with example from transcript"
  ],

  "areas_for_improvement": [
    "Specific area 1 with concrete advice",
    "Specific area 2 with concrete advice"
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

    analysis = {
        "summary": scores.get("summary", ""),
        "strengths": scores.get("strengths", []),
        "areas_for_improvement": scores.get("areas_for_improvement", []),
        "homework": scores.get("homework", []),
        "new_words": scores.get("new_words", []),
        "mistakes": [],  # structured mistakes stored in db.mistakes separately
        "encouraging_note": scores.get("encouraging_note", ""),
        "next_session_focus": scores.get("next_session_focus", ""),
        "filler_words_used": scores.get("filler_words_used", []),
        "conversation_topics": scores.get("conversation_topics", []),
        "other_details": scores.get("other_details", ""),
    }

    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"metrics": metrics, "analysis": analysis, "feedback": scores.get("strengths", [])}}
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
                        adapt_prompt = f"""You are an expert English curriculum designer.
A student just completed a 10-minute English speaking session. Based on their performance, rewrite the system_prompt for their NEXT session to be perfectly tailored to their needs.

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
- Keep the same topic/title but weave in targeted review of the mistakes above
- If score < 50: slow down, revisit basics, be extra gentle and encouraging
- If score 50-75: build on strengths, gently address weak areas mid-session
- If score > 75: add slightly more complexity, introduce new vocabulary
- The tutor must naturally slip in correction of top mistakes without making it feel like drilling
- Keep it a 10-minute voice session — warm, conversational, progressive
- Start with acknowledging progress from last session

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