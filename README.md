# Classroom Quiz System

Real-time AI-powered classroom quiz system that uses camera feeds to automatically capture student answers using hand gestures (finger counting) and map them to identified students via face recognition.

## How It Works

1. **Teacher** creates a quiz and starts a session from the dashboard
2. **Questions** are displayed on a smart board (projected via the web UI)
3. **Students** respond by showing fingers (1–4 fingers = options 1–4)
4. **Camera** captures the classroom — the CV pipeline detects faces and counts fingers
5. **System** maps each recognized student to their gesture and records the answer
6. **Live Dashboard** shows real-time response status for each student

## Architecture

```
Camera Feed → Face Recognition → Hand Gesture Detection → Student Mapping → Live Dashboard
                (face_recognition)    (MediaPipe Hands)
```

### Backend (Python/FastAPI)
- **Face Recognition**: Uses `face_recognition` library (dlib) to identify students from a photo database
- **Gesture Detection**: MediaPipe Hands for real-time finger counting
- **Gesture Stabilization**: Requires gesture to be held for 1.5 seconds to avoid accidental detection
- **WebSocket**: Real-time updates pushed to all connected dashboard clients
- **Database**: SQLite with WAL mode for concurrent access

### Frontend (React + Tailwind CSS)
- **Teacher Dashboard**: Overview, quick-start quizzes, active session indicator
- **Student Manager**: Add students, upload face photos, view enrollment status
- **Quiz Manager**: Create quizzes, add questions with options and timers
- **Quiz Session**: Live camera feed, question display, real-time response panel
- **Live Dashboard**: Full-screen view of student responses updating in real-time
- **Results & Analytics**: Per-student scores, detailed response history

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- Camera access (webcam or CCTV/IP camera)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

The API server starts at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with API proxy to the backend.

## Usage

### 1. Register Students
- Go to **Students** tab
- Add each student with name and optional roll number
- Upload a clear face photo for each student (one face per photo)

### 2. Create a Quiz
- Go to **Quizzes** tab
- Create a new quiz and add questions
- Each question has 2–4 options mapped to finger counts (1–4)
- Set correct answers and time limits per question

### 3. Run a Quiz Session
- Click **Start** on any quiz from the Dashboard or Quiz Manager
- Click **Start Camera** to begin capturing the classroom
- The system processes frames at ~1 FPS, detecting faces and gestures
- Responses appear in the live panel as students show their answers
- Use **Next Question** to advance, **End Quiz** to finish

### 4. View Results
- Go to **Results** tab
- Select any past session to see per-student scores and detailed responses

## System Rules

- Only recognized students' responses are recorded
- One response per student per question (last stable gesture wins)
- Gestures must be held for 1.5 seconds (configurable)
- Unknown faces are ignored
- Fingers outside 1–4 range are ignored

## Database Schema

| Table | Purpose |
|-------|---------|
| `students` | Student info + face encoding blobs |
| `quizzes` | Quiz metadata |
| `questions` | Questions with options, correct answer, time limit |
| `quiz_sessions` | Active/completed session tracking |
| `responses` | Per-student, per-question answer records |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/students` | List/create students |
| POST | `/api/students/:id/photo` | Upload face photo |
| GET/POST | `/api/quizzes` | List/create quizzes |
| GET/POST | `/api/quizzes/:id/questions` | List/add questions |
| POST | `/api/sessions` | Start quiz session |
| POST | `/api/sessions/:id/next-question` | Advance to next question |
| POST | `/api/sessions/:id/end` | End session |
| GET | `/api/sessions/:id/results` | Get detailed results |
| POST | `/api/process-frame` | Process camera frame (multipart) |
| POST | `/api/process-frame-base64` | Process camera frame (base64) |
| WS | `/ws` | Real-time updates |

## Tech Stack

- **Backend**: Python, FastAPI, SQLite (aiosqlite), MediaPipe, OpenCV, face_recognition
- **Frontend**: React 18, React Router, Tailwind CSS, Vite, Lucide Icons
- **Real-time**: WebSocket for live dashboard updates
