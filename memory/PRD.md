# Fluentra.ai - Product Requirements Document

## Original Problem Statement
Build Fluentra.ai - an adaptive English tutoring web app with real-time voice sessions powered by Google Gemini Live API. Features include initial spoken assessment, dynamic learning plans, live tutoring sessions, progress tracking, vocabulary builder with SM-2 spaced repetition, and dark/light mode.

## Architecture
- **Frontend**: React + Tailwind CSS + Shadcn UI + Framer Motion + Recharts
- **Backend**: FastAPI (Python) + MongoDB (Motor async driver)
- **AI**: Google Gemini Live API (bidirectional audio), Gemini 2.5 Flash (text scoring/generation)
- **Auth**: JWT (bcrypt + PyJWT)
- **Memory**: MongoDB-based persistent memory (replacing Mem0)

## User Personas
1. **Non-native English speakers** - Need structured practice
2. **Working professionals** - Business English improvement
3. **Students** - IELTS/TOEFL preparation
4. **Casual learners** - Daily conversation practice

## Core Requirements
- CEFR A1-C2 level assessment via spoken conversation
- Personalized learning plans that adapt to performance
- Real-time voice tutoring with Gemini Live API
- SM-2 spaced repetition vocabulary system
- Progress tracking with charts
- Dark/Light mode

## What's Been Implemented (Feb 22, 2026)

### Backend (server.py)
- JWT Authentication (register, login, profile)
- User onboarding (native language, target CEFR, goals, sessions/week)
- Session CRUD with completion and scoring
- Gemini-powered assessment scoring (CEFR evaluation)
- Learning plan generation via Gemini AI
- Vocabulary CRUD with SM-2 spaced repetition
- Mistake tracking with recurrence counting
- Progress aggregation endpoint
- Memory system (MongoDB-based)
- Gemini Live API WebSocket proxy (bidirectional audio)
- AI session scoring endpoint

### Frontend Pages
- Landing page (hero, features, how-it-works, CTA)
- Login / Register (JWT auth)
- Onboarding (4-step: language, target, goals, sessions)
- Assessment (live audio with VoiceVisualizer, transcript, 4 stages)
- Dashboard (bento grid: CEFR card, streak, stats, plan, sessions)
- Session page (live audio tutoring with transcript)
- Progress (tabs: grammar/vocabulary/fluency/mistakes with charts)
- Vocabulary (search, filter, add word dialog, SM-2 review)
- Learning Plan (modules accordion, session templates)
- Settings (profile, preferences, theme toggle)

### Theme
- "Organic Intelligence" - Dark Moss Green + Warm Sand + Terracotta
- Fonts: Fraunces (headings), Manrope (body), JetBrains Mono (data)
- Full dark/light mode with CSS variables

## Prioritized Backlog

### P0 (Critical)
- None remaining for MVP

### P1 (High)
- Image description stage in assessment (show actual image)
- Session audio recording and playback
- Auto-vocabulary extraction from sessions
- Push notifications for review reminders

### P2 (Medium)
- User avatar upload
- Session scheduling/calendar integration
- Mistake pattern analysis over time
- Weekly progress email reports
- Social sharing of milestones

### P3 (Nice to have)
- Multi-language interface
- Pronunciation analysis with spectrograms
- Gamification (badges, leaderboards)
- Mobile app (React Native)
- Export progress reports as PDF

## Next Tasks
1. Test Gemini Live API end-to-end with real audio (requires browser with mic)
2. Add vocabulary auto-extraction from session transcripts
3. Build session review page (replay past sessions)
4. Add more assessment detail (show per-stage feedback)
5. Implement plan adaptation triggers based on session scores
