"""
Classroom Quiz System - Backend
Real-time AI-powered quiz with camera-based gesture recognition.
Supports both browser webcam and Hikvision DVR camera feeds via ISAPI.
"""

import asyncio
import base64
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import face_recognition
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from cv_pipeline import CVPipeline
from database import get_db, init_db
from dvr_capture import capture_snapshot, preprocess_snapshot
from models import (
    AnswerRecord,
    QuestionCreate,
    QuestionResponse,
    QuizCreate,
    QuizResponse,
    QuizSessionCreate,
    SessionStatus,
    StudentCreate,
    StudentResponse,
)

logger = logging.getLogger("quiz.main")

STUDENT_PHOTOS_DIR = Path(__file__).parent / "student_photos"
STUDENT_PHOTOS_DIR.mkdir(exist_ok=True)

cv_pipeline = CVPipeline()
cv_lock = threading.Lock()

# WebSocket connection manager
connected_clients: list[WebSocket] = []

# DVR polling state
dvr_poll_task: Optional[asyncio.Task] = None
dvr_active_camera: Optional[dict] = None  # {"dvr_id": int, "channel": int}


async def broadcast(data: dict):
    """Broadcast data to all connected WebSocket clients."""
    message = json.dumps(data, default=str)
    disconnected = []
    for ws in list(connected_clients):
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        try:
            connected_clients.remove(ws)
        except ValueError:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Load known student face encodings
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, face_encoding FROM students WHERE face_encoding IS NOT NULL"
        )
        for row in rows:
            cv_pipeline.face_recognizer.load_encoding(row[0], row[1], row[2])
    finally:
        await db.close()
    yield
    cv_pipeline.close()


app = FastAPI(title="Classroom Quiz System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Student Management ─────────────────────────────────────────────────────

@app.get("/api/students", response_model=list[StudentResponse])
async def list_students():
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, roll_number, photo_path, face_encoding, created_at FROM students ORDER BY name"
        )
        return [
            StudentResponse(
                id=r[0],
                name=r[1],
                roll_number=r[2],
                photo_path=r[3],
                has_face_encoding=r[4] is not None,
                created_at=r[5],
            )
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/students", response_model=StudentResponse)
async def create_student(student: StudentCreate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO students (name, roll_number) VALUES (?, ?)",
            (student.name, student.roll_number),
        )
        await db.commit()
        student_id = cursor.lastrowid
        return StudentResponse(id=student_id, name=student.name, roll_number=student.roll_number)
    finally:
        await db.close()


@app.post("/api/students/{student_id}/photo")
async def upload_student_photo(student_id: int, file: UploadFile = File(...)):
    db = await get_db()
    try:
        row = await db.execute_fetchall(
            "SELECT id, name FROM students WHERE id = ?", (student_id,)
        )
        if not row:
            raise HTTPException(status_code=404, detail="Student not found")

        name = row[0][1]
        photo_path = STUDENT_PHOTOS_DIR / f"{student_id}.jpg"
        contents = await file.read()
        photo_path.write_bytes(contents)

        # Generate face encoding
        image = await asyncio.to_thread(face_recognition.load_image_file, str(photo_path))
        encodings = await asyncio.to_thread(face_recognition.face_encodings, image)
        if not encodings:
            photo_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400, detail="No face detected in uploaded photo"
            )

        encoding_bytes = encodings[0].tobytes()
        await db.execute(
            "UPDATE students SET photo_path = ?, face_encoding = ? WHERE id = ?",
            (str(photo_path), encoding_bytes, student_id),
        )
        await db.commit()

        # Register in live pipeline
        def _load():
            with cv_lock:
                cv_pipeline.face_recognizer.load_encoding(student_id, name, encoding_bytes)
        await asyncio.to_thread(_load)

        return {"status": "ok", "message": f"Photo uploaded for {name}"}
    finally:
        await db.close()


@app.delete("/api/students/{student_id}")
async def delete_student(student_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM students WHERE id = ?", (student_id,))
        await db.commit()
        def _remove():
            with cv_lock:
                cv_pipeline.face_recognizer.remove_student(student_id)
        await asyncio.to_thread(_remove)
        photo_path = STUDENT_PHOTOS_DIR / f"{student_id}.jpg"
        photo_path.unlink(missing_ok=True)
        return {"status": "ok"}
    finally:
        await db.close()


# ─── Quiz Management ─────────────────────────────────────────────────────────

@app.get("/api/quizzes", response_model=list[QuizResponse])
async def list_quizzes():
    db = await get_db()
    try:
        rows = await db.execute_fetchall("""
            SELECT q.id, q.title, q.description, q.status, q.created_at,
                   COUNT(qn.id) as question_count
            FROM quizzes q
            LEFT JOIN questions qn ON qn.quiz_id = q.id
            GROUP BY q.id
            ORDER BY q.created_at DESC
        """)
        return [
            QuizResponse(
                id=r[0], title=r[1], description=r[2], status=r[3],
                created_at=r[4], question_count=r[5],
            )
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/quizzes", response_model=QuizResponse)
async def create_quiz(quiz: QuizCreate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO quizzes (title, description) VALUES (?, ?)",
            (quiz.title, quiz.description),
        )
        await db.commit()
        return QuizResponse(
            id=cursor.lastrowid, title=quiz.title,
            description=quiz.description, status="draft",
        )
    finally:
        await db.close()


@app.get("/api/quizzes/{quiz_id}", response_model=QuizResponse)
async def get_quiz(quiz_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall("""
            SELECT q.id, q.title, q.description, q.status, q.created_at,
                   COUNT(qn.id) as question_count
            FROM quizzes q
            LEFT JOIN questions qn ON qn.quiz_id = q.id
            WHERE q.id = ?
            GROUP BY q.id
        """, (quiz_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Quiz not found")
        r = rows[0]
        return QuizResponse(
            id=r[0], title=r[1], description=r[2], status=r[3],
            created_at=r[4], question_count=r[5],
        )
    finally:
        await db.close()


@app.delete("/api/quizzes/{quiz_id}")
async def delete_quiz(quiz_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM quizzes WHERE id = ?", (quiz_id,))
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


# ─── Question Management ─────────────────────────────────────────────────────

@app.get("/api/quizzes/{quiz_id}/questions", response_model=list[QuestionResponse])
async def list_questions(quiz_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, quiz_id, question_number, text, option_1, option_2, option_3, option_4, correct_option, time_limit "
            "FROM questions WHERE quiz_id = ? ORDER BY question_number",
            (quiz_id,),
        )
        return [
            QuestionResponse(
                id=r[0], quiz_id=r[1], question_number=r[2], text=r[3],
                option_1=r[4], option_2=r[5], option_3=r[6], option_4=r[7],
                correct_option=r[8], time_limit=r[9],
            )
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/quizzes/{quiz_id}/questions", response_model=QuestionResponse)
async def add_question(quiz_id: int, question: QuestionCreate):
    db = await get_db()
    try:
        # Get next question number
        rows = await db.execute_fetchall(
            "SELECT COALESCE(MAX(question_number), 0) FROM questions WHERE quiz_id = ?",
            (quiz_id,),
        )
        next_num = rows[0][0] + 1

        cursor = await db.execute(
            "INSERT INTO questions (quiz_id, question_number, text, option_1, option_2, option_3, option_4, correct_option, time_limit) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (quiz_id, next_num, question.text, question.option_1, question.option_2,
             question.option_3, question.option_4, question.correct_option, question.time_limit),
        )
        await db.commit()
        return QuestionResponse(
            id=cursor.lastrowid, quiz_id=quiz_id, question_number=next_num,
            text=question.text, option_1=question.option_1, option_2=question.option_2,
            option_3=question.option_3, option_4=question.option_4,
            correct_option=question.correct_option, time_limit=question.time_limit,
        )
    finally:
        await db.close()


@app.delete("/api/questions/{question_id}")
async def delete_question(question_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM questions WHERE id = ?", (question_id,))
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


# ─── Quiz Sessions ────────────────────────────────────────────────────────────

@app.post("/api/sessions")
async def start_session(data: QuizSessionCreate):
    db = await get_db()
    try:
        # Verify quiz exists and has questions
        rows = await db.execute_fetchall(
            "SELECT id FROM questions WHERE quiz_id = ? ORDER BY question_number LIMIT 1",
            (data.quiz_id,),
        )
        if not rows:
            raise HTTPException(status_code=400, detail="Quiz has no questions")

        first_question_id = rows[0][0]

        cursor = await db.execute(
            "INSERT INTO quiz_sessions (quiz_id, current_question_id, status, started_at) VALUES (?, ?, 'active', datetime('now'))",
            (data.quiz_id, first_question_id),
        )
        await db.commit()
        session_id = cursor.lastrowid

        # Initialize pending responses for all students
        students = await db.execute_fetchall("SELECT id FROM students WHERE face_encoding IS NOT NULL")
        for s in students:
            await db.execute(
                "INSERT OR IGNORE INTO responses (session_id, question_id, student_id, status) VALUES (?, ?, ?, 'pending')",
                (session_id, first_question_id, s[0]),
            )
        await db.commit()

        def _reset():
            with cv_lock:
                cv_pipeline.reset_stabilizer()
        await asyncio.to_thread(_reset)

        session_status = await _get_session_status(db, session_id)
        await broadcast({"type": "session_started", "data": session_status})
        return session_status
    finally:
        await db.close()


@app.post("/api/sessions/{session_id}/next-question")
async def next_question(session_id: int):
    db = await get_db()
    try:
        session = await db.execute_fetchall(
            "SELECT quiz_id, current_question_id, status FROM quiz_sessions WHERE id = ?",
            (session_id,),
        )
        if not session or session[0][2] != "active":
            raise HTTPException(status_code=400, detail="No active session")

        quiz_id = session[0][0]
        current_q_id = session[0][1]

        # Get current question number
        current = await db.execute_fetchall(
            "SELECT question_number FROM questions WHERE id = ?", (current_q_id,)
        )
        current_num = current[0][0] if current else 0

        # Get next question
        next_q = await db.execute_fetchall(
            "SELECT id FROM questions WHERE quiz_id = ? AND question_number > ? ORDER BY question_number LIMIT 1",
            (quiz_id, current_num),
        )
        if not next_q:
            # No more questions, end the session
            await db.execute(
                "UPDATE quiz_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
                (session_id,),
            )
            await db.execute(
                "UPDATE responses SET status = 'not_answered' WHERE session_id = ? AND status = 'pending'",
                (session_id,),
            )
            await db.commit()
            session_status = await _get_session_status(db, session_id)
            await broadcast({"type": "session_ended", "data": session_status})
            return session_status

        next_q_id = next_q[0][0]

        # Mark previous question's pending responses as not_answered
        await db.execute(
            "UPDATE responses SET status = 'not_answered' WHERE session_id = ? AND question_id = ? AND status = 'pending'",
            (session_id, current_q_id),
        )

        await db.execute(
            "UPDATE quiz_sessions SET current_question_id = ? WHERE id = ?",
            (next_q_id, session_id),
        )

        # Initialize pending responses for all students
        students = await db.execute_fetchall("SELECT id FROM students WHERE face_encoding IS NOT NULL")
        for s in students:
            await db.execute(
                "INSERT OR IGNORE INTO responses (session_id, question_id, student_id, status) VALUES (?, ?, ?, 'pending')",
                (session_id, next_q_id, s[0]),
            )
        await db.commit()

        def _reset():
            with cv_lock:
                cv_pipeline.reset_stabilizer()
        await asyncio.to_thread(_reset)

        session_status = await _get_session_status(db, session_id)
        await broadcast({"type": "next_question", "data": session_status})
        return session_status
    finally:
        await db.close()


@app.post("/api/sessions/{session_id}/end")
async def end_session(session_id: int):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE quiz_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
            (session_id,),
        )
        # Mark remaining pending as not_answered
        await db.execute(
            "UPDATE responses SET status = 'not_answered' WHERE session_id = ? AND status = 'pending'",
            (session_id,),
        )
        await db.commit()
        session_status = await _get_session_status(db, session_id)
        await broadcast({"type": "session_ended", "data": session_status})
        return session_status
    finally:
        await db.close()


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: int):
    db = await get_db()
    try:
        return await _get_session_status(db, session_id)
    finally:
        await db.close()


@app.get("/api/sessions")
async def list_sessions():
    db = await get_db()
    try:
        rows = await db.execute_fetchall("""
            SELECT qs.id, qs.quiz_id, q.title, qs.status, qs.started_at, qs.ended_at
            FROM quiz_sessions qs
            JOIN quizzes q ON q.id = qs.quiz_id
            ORDER BY qs.started_at DESC
        """)
        return [
            {
                "id": r[0], "quiz_id": r[1], "quiz_title": r[2],
                "status": r[3], "started_at": r[4], "ended_at": r[5],
            }
            for r in rows
        ]
    finally:
        await db.close()


# ─── Camera Frame Processing ─────────────────────────────────────────────────

@app.post("/api/process-frame")
async def process_frame(file: UploadFile = File(...)):
    """Process a camera frame: detect faces and gestures, record responses."""
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image")

    def _process():
        with cv_lock:
            return cv_pipeline.process_frame(frame)
    detections = await asyncio.to_thread(_process)

    # Find active session
    db = await get_db()
    try:
        session = await db.execute_fetchall(
            "SELECT id, current_question_id FROM quiz_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
        )

        if session:
            session_id = session[0][0]
            question_id = session[0][1]

            if not question_id:
                return {"detections": detections}

            for det in detections:
                if det["student_id"] and det["finger_count"]:
                    await db.execute(
                        """INSERT INTO responses (session_id, question_id, student_id, selected_option, status, detected_at)
                           VALUES (?, ?, ?, ?, 'answered', datetime('now'))
                           ON CONFLICT(session_id, question_id, student_id)
                           DO UPDATE SET selected_option = excluded.selected_option,
                                        status = 'answered',
                                        detected_at = excluded.detected_at""",
                        (session_id, question_id, det["student_id"], det["finger_count"]),
                    )
            await db.commit()

            session_status = await _get_session_status(db, session_id)
            await broadcast({"type": "detection_update", "data": session_status, "detections": detections})

        return {"detections": detections}
    finally:
        await db.close()


@app.post("/api/process-frame-base64")
async def process_frame_base64(data: dict):
    """Process a base64-encoded camera frame."""
    image_data = data.get("image", "")
    if "," in image_data:
        image_data = image_data.split(",")[1]

    contents = base64.b64decode(image_data)
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image")

    def _process():
        with cv_lock:
            return cv_pipeline.process_frame(frame)
    detections = await asyncio.to_thread(_process)

    db = await get_db()
    try:
        session = await db.execute_fetchall(
            "SELECT id, current_question_id FROM quiz_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
        )

        if session:
            session_id = session[0][0]
            question_id = session[0][1]

            if not question_id:
                return {"detections": detections}

            for det in detections:
                if det["student_id"] and det["finger_count"]:
                    await db.execute(
                        """INSERT INTO responses (session_id, question_id, student_id, selected_option, status, detected_at)
                           VALUES (?, ?, ?, ?, 'answered', datetime('now'))
                           ON CONFLICT(session_id, question_id, student_id)
                           DO UPDATE SET selected_option = excluded.selected_option,
                                        status = 'answered',
                                        detected_at = excluded.detected_at""",
                        (session_id, question_id, det["student_id"], det["finger_count"]),
                    )
            await db.commit()

            session_status = await _get_session_status(db, session_id)
            await broadcast({"type": "detection_update", "data": session_status, "detections": detections})

        return {"detections": detections}
    finally:
        await db.close()


# ─── Results & Analytics ──────────────────────────────────────────────────────

@app.get("/api/sessions/{session_id}/results")
async def get_session_results(session_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall("""
            SELECT s.name, s.roll_number, q.question_number, q.text, q.correct_option,
                   r.selected_option, r.status, r.detected_at
            FROM responses r
            JOIN students s ON s.id = r.student_id
            JOIN questions q ON q.id = r.question_id
            WHERE r.session_id = ?
            ORDER BY s.name, q.question_number
        """, (session_id,))

        results = []
        for r in rows:
            is_correct = r[4] is not None and r[5] == r[4]
            results.append({
                "student_name": r[0],
                "roll_number": r[1],
                "question_number": r[2],
                "question_text": r[3],
                "correct_option": r[4],
                "selected_option": r[5],
                "status": r[6],
                "is_correct": is_correct,
                "detected_at": r[7],
            })

        # Per-student summary
        student_scores: dict[str, dict] = {}
        for r in results:
            name = r["student_name"]
            if name not in student_scores:
                student_scores[name] = {"total": 0, "correct": 0, "answered": 0}
            student_scores[name]["total"] += 1
            if r["status"] == "answered":
                student_scores[name]["answered"] += 1
                if r["is_correct"]:
                    student_scores[name]["correct"] += 1

        return {
            "details": results,
            "summary": student_scores,
        }
    finally:
        await db.close()


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    try:
        while True:
            data = await ws.receive_text()
            # Keep connection alive; clients can send pings
    except (WebSocketDisconnect, Exception):
        if ws in connected_clients:
            connected_clients.remove(ws)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_session_status(db, session_id: int) -> dict:
    session = await db.execute_fetchall("""
        SELECT qs.id, qs.quiz_id, q.title, qs.current_question_id, qs.status
        FROM quiz_sessions qs
        JOIN quizzes q ON q.id = qs.quiz_id
        WHERE qs.id = ?
    """, (session_id,))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    s = session[0]
    current_question = None
    if s[3]:
        qrows = await db.execute_fetchall(
            "SELECT id, quiz_id, question_number, text, option_1, option_2, option_3, option_4, correct_option, time_limit "
            "FROM questions WHERE id = ?",
            (s[3],),
        )
        if qrows:
            qr = qrows[0]
            current_question = {
                "id": qr[0], "quiz_id": qr[1], "question_number": qr[2],
                "text": qr[3], "option_1": qr[4], "option_2": qr[5],
                "option_3": qr[6], "option_4": qr[7],
                "correct_option": qr[8], "time_limit": qr[9],
            }

    # Get responses for current question
    responses = []
    if s[3]:
        rrows = await db.execute_fetchall("""
            SELECT r.student_id, st.name, r.selected_option, r.status, r.detected_at
            FROM responses r
            JOIN students st ON st.id = r.student_id
            WHERE r.session_id = ? AND r.question_id = ?
            ORDER BY st.name
        """, (session_id, s[3]))
        responses = [
            {
                "student_id": r[0], "student_name": r[1],
                "selected_option": r[2], "status": r[3], "detected_at": r[4],
            }
            for r in rrows
        ]

    total_students = len(responses)
    answered_count = sum(1 for r in responses if r["status"] == "answered")

    return {
        "session_id": s[0],
        "quiz_id": s[1],
        "quiz_title": s[2],
        "current_question": current_question,
        "status": s[4],
        "responses": responses,
        "total_students": total_students,
        "answered_count": answered_count,
    }


# ─── DVR Management ───────────────────────────────────────────────────────────

@app.get("/api/dvrs")
async def list_dvrs():
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, ip, port, username, channels FROM dvrs ORDER BY id"
        )
        return [
            {"id": r[0], "name": r[1], "ip": r[2], "port": r[3],
             "username": r[4], "channels": r[5]}
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/dvrs")
async def add_dvr(data: dict):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO dvrs (name, ip, port, username, password, channels) VALUES (?, ?, ?, ?, ?, ?)",
            (data.get("name", ""), data["ip"], data.get("port", 80),
             data.get("username", "admin"), data.get("password", ""),
             data.get("channels", 64)),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "status": "ok"}
    finally:
        await db.close()


@app.delete("/api/dvrs/{dvr_id}")
async def delete_dvr(dvr_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM dvrs WHERE id = ?", (dvr_id,))
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@app.get("/api/dvrs/{dvr_id}/cameras")
async def list_cameras(dvr_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, location, channel, description FROM camera_mapping WHERE dvr_id = ? ORDER BY channel",
            (dvr_id,),
        )
        return [
            {"id": r[0], "location": r[1], "channel": r[2], "description": r[3]}
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/dvrs/{dvr_id}/cameras")
async def add_camera(dvr_id: int, data: dict):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO camera_mapping (location, dvr_id, channel, description) VALUES (?, ?, ?, ?)",
            (data.get("location", ""), dvr_id, data["channel"],
             data.get("description", "")),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "status": "ok"}
    finally:
        await db.close()


@app.delete("/api/cameras/{camera_id}")
async def delete_camera(camera_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM camera_mapping WHERE id = ?", (camera_id,))
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@app.get("/api/cameras")
async def list_all_cameras():
    """List all cameras across all DVRs."""
    db = await get_db()
    try:
        rows = await db.execute_fetchall("""
            SELECT cm.id, cm.location, cm.dvr_id, cm.channel, cm.description,
                   d.name as dvr_name, d.ip as dvr_ip
            FROM camera_mapping cm
            JOIN dvrs d ON d.id = cm.dvr_id
            ORDER BY d.name, cm.channel
        """)
        return [
            {"id": r[0], "location": r[1], "dvr_id": r[2], "channel": r[3],
             "description": r[4], "dvr_name": r[5], "dvr_ip": r[6]}
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/dvrs/{dvr_id}/test")
async def test_dvr_camera(dvr_id: int, data: dict):
    """Test capture a snapshot from a DVR camera channel."""
    channel = data.get("channel", 1)
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT ip, port, username, password FROM dvrs WHERE id = ?", (dvr_id,)
        )
        if not rows:
            raise HTTPException(status_code=404, detail="DVR not found")
        dvr = {"ip": rows[0][0], "port": rows[0][1],
               "username": rows[0][2], "password": rows[0][3]}
    finally:
        await db.close()

    frame_bytes = await capture_snapshot(dvr, channel, max_retries=1)
    if frame_bytes is None:
        raise HTTPException(status_code=502, detail="Failed to capture from DVR")

    encoded = base64.b64encode(frame_bytes).decode()
    return {"status": "ok", "image": f"data:image/jpeg;base64,{encoded}",
            "size_bytes": len(frame_bytes)}


@app.post("/api/dvrs/import-config")
async def import_dvr_config(data: dict):
    """Import DVR and camera configuration from campus agent database.

    Expects: {"db_path": "/path/to/campus-agent/campus_agent.db"}
    """
    import sqlite3

    db_path = data.get("db_path", "")
    if not db_path or not Path(db_path).exists():
        raise HTTPException(status_code=400, detail="Campus agent database not found")

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        agent_dvrs = conn.execute(
            "SELECT name, ip, port, username, password, channels FROM dvrs ORDER BY id"
        ).fetchall()

        agent_cameras = conn.execute(
            "SELECT location, dvr_index, channel, description FROM camera_mapping"
        ).fetchall()
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read campus agent DB: {e}")

    db = await get_db()
    try:
        dvr_id_map = {}
        for i, dvr in enumerate(agent_dvrs):
            cursor = await db.execute(
                "INSERT INTO dvrs (name, ip, port, username, password, channels) VALUES (?, ?, ?, ?, ?, ?)",
                (dvr["name"], dvr["ip"], dvr["port"], dvr["username"],
                 dvr["password"], dvr["channels"]),
            )
            dvr_id_map[i] = cursor.lastrowid

        for cam in agent_cameras:
            dvr_idx = cam["dvr_index"]
            if dvr_idx in dvr_id_map:
                await db.execute(
                    "INSERT INTO camera_mapping (location, dvr_id, channel, description) VALUES (?, ?, ?, ?)",
                    (cam["location"], dvr_id_map[dvr_idx], cam["channel"],
                     cam["description"]),
                )

        await db.commit()
        return {"status": "ok", "dvrs_imported": len(agent_dvrs),
                "cameras_imported": len(agent_cameras)}
    finally:
        await db.close()


@app.post("/api/students/import-faces")
async def import_student_faces(data: dict):
    """Import student face encodings from campus agent database.

    Expects: {"db_path": "/path/to/campus-agent/campus_agent.db"}
    Only imports face_recognition_128d encodings (compatible with this system).
    """
    import sqlite3

    db_path = data.get("db_path", "")
    if not db_path or not Path(db_path).exists():
        raise HTTPException(status_code=400, detail="Campus agent database not found")

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        faces = conn.execute(
            "SELECT DISTINCT person_id, name, encoding FROM registered_faces "
            "WHERE encoding_type = 'face_recognition_128d' "
            "ORDER BY person_id"
        ).fetchall()
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read campus agent DB: {e}")

    db = await get_db()
    try:
        imported_records: list[tuple[int, str, bytes]] = []
        for face in faces:
            person_id = face["person_id"]
            name = face["name"]
            encoding_bytes = face["encoding"]

            existing = await db.execute_fetchall(
                "SELECT id FROM students WHERE roll_number = ?", (person_id,)
            )
            if existing:
                student_id = existing[0][0]
                await db.execute(
                    "UPDATE students SET face_encoding = ? WHERE id = ?",
                    (encoding_bytes, student_id),
                )
            else:
                cursor = await db.execute(
                    "INSERT INTO students (name, roll_number, face_encoding) VALUES (?, ?, ?)",
                    (name, person_id, encoding_bytes),
                )
                student_id = cursor.lastrowid

            imported_records.append((student_id, name, encoding_bytes))

        await db.commit()

        for sid, n, eb in imported_records:
            def _load(sid=sid, n=n, eb=eb):
                with cv_lock:
                    cv_pipeline.face_recognizer.load_encoding(sid, n, eb)
            await asyncio.to_thread(_load)

        return {"status": "ok", "students_imported": len(imported_records)}
    finally:
        await db.close()


# ─── DVR Camera Polling ───────────────────────────────────────────────────────

async def _dvr_poll_loop():
    """Background loop that captures frames from DVR and processes them."""
    global dvr_active_camera
    while True:
        try:
            cam = dvr_active_camera
            if cam is None:
                await asyncio.sleep(1)
                continue

            db = await get_db()
            try:
                dvr_rows = await db.execute_fetchall(
                    "SELECT ip, port, username, password FROM dvrs WHERE id = ?",
                    (cam["dvr_id"],),
                )
                if not dvr_rows:
                    await asyncio.sleep(1)
                    continue

                dvr = {"ip": dvr_rows[0][0], "port": dvr_rows[0][1],
                       "username": dvr_rows[0][2], "password": dvr_rows[0][3]}
            finally:
                await db.close()

            frame_bytes = await capture_snapshot(dvr, cam["channel"])
            if frame_bytes is None:
                await asyncio.sleep(2)
                continue

            enhanced = await asyncio.to_thread(preprocess_snapshot, frame_bytes)
            nparr = np.frombuffer(enhanced, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                await asyncio.sleep(1)
                continue

            def _process():
                with cv_lock:
                    return cv_pipeline.process_frame(frame)
            detections = await asyncio.to_thread(_process)

            db = await get_db()
            try:
                session = await db.execute_fetchall(
                    "SELECT id, current_question_id FROM quiz_sessions "
                    "WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
                )
                if session:
                    session_id = session[0][0]
                    question_id = session[0][1]

                    if question_id:
                        for det in detections:
                            if det["student_id"] and det["finger_count"]:
                                await db.execute(
                                    """INSERT INTO responses (session_id, question_id, student_id, selected_option, status, detected_at)
                                       VALUES (?, ?, ?, ?, 'answered', datetime('now'))
                                       ON CONFLICT(session_id, question_id, student_id)
                                       DO UPDATE SET selected_option = excluded.selected_option,
                                                    status = 'answered',
                                                    detected_at = excluded.detected_at""",
                                    (session_id, question_id, det["student_id"], det["finger_count"]),
                                )
                        await db.commit()

                    session_status = await _get_session_status(db, session_id)
                    snapshot_b64 = base64.b64encode(frame_bytes).decode()
                    await broadcast({
                        "type": "detection_update",
                        "data": session_status,
                        "detections": detections,
                        "dvr_frame": f"data:image/jpeg;base64,{snapshot_b64}",
                    })
            finally:
                await db.close()

            await asyncio.sleep(1)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"DVR poll error: {e}")
            await asyncio.sleep(2)


@app.post("/api/dvr/start")
async def start_dvr_capture(data: dict):
    """Start capturing from a DVR camera. Expects: {"dvr_id": int, "channel": int}"""
    global dvr_poll_task, dvr_active_camera

    dvr_id = data.get("dvr_id")
    channel = data.get("channel")
    if not dvr_id or not channel:
        raise HTTPException(status_code=400, detail="dvr_id and channel required")

    dvr_active_camera = {"dvr_id": dvr_id, "channel": channel}

    if dvr_poll_task is None or dvr_poll_task.done():
        dvr_poll_task = asyncio.create_task(_dvr_poll_loop())

    return {"status": "ok", "message": f"DVR capture started: DVR {dvr_id} ch{channel}"}


@app.post("/api/dvr/stop")
async def stop_dvr_capture():
    """Stop DVR camera capture."""
    global dvr_poll_task, dvr_active_camera

    dvr_active_camera = None
    if dvr_poll_task and not dvr_poll_task.done():
        dvr_poll_task.cancel()
        try:
            await dvr_poll_task
        except asyncio.CancelledError:
            pass
    dvr_poll_task = None

    return {"status": "ok", "message": "DVR capture stopped"}


@app.get("/api/dvr/status")
async def dvr_capture_status():
    """Get current DVR capture status."""
    active = dvr_active_camera is not None
    return {
        "active": active,
        "camera": dvr_active_camera,
        "poll_task_running": dvr_poll_task is not None and not dvr_poll_task.done(),
    }


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ─── Serve Frontend Static Files ──────────────────────────────────────────────

STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve the React SPA for all non-API routes."""
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
