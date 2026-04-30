from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class StudentCreate(BaseModel):
    name: str
    roll_number: Optional[str] = None


class StudentResponse(BaseModel):
    id: int
    name: str
    roll_number: Optional[str] = None
    photo_path: Optional[str] = None
    has_face_encoding: bool = False
    created_at: Optional[str] = None


class QuizCreate(BaseModel):
    title: str
    description: Optional[str] = None


class QuizResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    status: str
    created_at: Optional[str] = None
    question_count: int = 0


class QuestionCreate(BaseModel):
    text: str
    option_1: str
    option_2: str
    option_3: Optional[str] = None
    option_4: Optional[str] = None
    correct_option: Optional[int] = None
    time_limit: int = 15


class QuestionResponse(BaseModel):
    id: int
    quiz_id: int
    question_number: int
    text: str
    option_1: str
    option_2: str
    option_3: Optional[str] = None
    option_4: Optional[str] = None
    correct_option: Optional[int] = None
    time_limit: int = 15


class AnswerRecord(BaseModel):
    student_id: int
    student_name: str
    selected_option: Optional[int] = None
    status: str = "pending"
    detected_at: Optional[str] = None


class SessionStatus(BaseModel):
    session_id: int
    quiz_id: int
    quiz_title: str
    current_question: Optional[QuestionResponse] = None
    status: str
    responses: list[AnswerRecord] = []
    total_students: int = 0
    answered_count: int = 0
    time_remaining: Optional[int] = None


class QuizSessionCreate(BaseModel):
    quiz_id: int


class DetectionResult(BaseModel):
    student_id: Optional[int] = None
    student_name: Optional[str] = None
    finger_count: Optional[int] = None
    confidence: float = 0.0
    bbox: Optional[list[int]] = None
