import aiosqlite
import json
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "quiz_system.db"


async def get_db():
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                roll_number TEXT UNIQUE,
                photo_path TEXT,
                face_encoding BLOB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER NOT NULL,
                question_number INTEGER NOT NULL,
                text TEXT NOT NULL,
                option_1 TEXT NOT NULL,
                option_2 TEXT NOT NULL,
                option_3 TEXT,
                option_4 TEXT,
                correct_option INTEGER,
                time_limit INTEGER DEFAULT 15,
                FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS quiz_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER NOT NULL,
                current_question_id INTEGER,
                status TEXT DEFAULT 'waiting',
                started_at TIMESTAMP,
                ended_at TIMESTAMP,
                FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
                FOREIGN KEY (current_question_id) REFERENCES questions(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                question_id INTEGER NOT NULL,
                student_id INTEGER NOT NULL,
                selected_option INTEGER,
                status TEXT DEFAULT 'pending',
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                UNIQUE(session_id, question_id, student_id)
            );

            CREATE TABLE IF NOT EXISTS dvrs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 80,
                username TEXT NOT NULL DEFAULT 'admin',
                password TEXT NOT NULL DEFAULT '',
                channels INTEGER NOT NULL DEFAULT 64
            );

            CREATE TABLE IF NOT EXISTS camera_mapping (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                location TEXT NOT NULL,
                dvr_id INTEGER NOT NULL,
                channel INTEGER NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (dvr_id) REFERENCES dvrs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
            CREATE INDEX IF NOT EXISTS idx_responses_question ON responses(question_id);
            CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id);
        """)
        await db.commit()
    finally:
        await db.close()
