"""
Computer Vision Pipeline
- Face detection and recognition using face_recognition library
- Hand gesture (finger counting) detection using MediaPipe Hands
"""

import cv2
import numpy as np
import mediapipe as mp
import face_recognition
import pickle
import time
from pathlib import Path
from collections import defaultdict
from typing import Optional

STUDENT_PHOTOS_DIR = Path(__file__).parent / "student_photos"
STUDENT_PHOTOS_DIR.mkdir(exist_ok=True)

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils


class GestureStabilizer:
    """Requires a gesture to be held stable for a minimum duration before accepting it."""

    def __init__(self, stability_duration: float = 1.5):
        self.stability_duration = stability_duration
        self.current_gestures: dict[str, dict] = {}

    def update(self, person_id: str, finger_count: Optional[int]) -> Optional[int]:
        now = time.time()

        if finger_count is None or finger_count < 1 or finger_count > 4:
            if person_id in self.current_gestures:
                del self.current_gestures[person_id]
            return None

        if person_id not in self.current_gestures:
            self.current_gestures[person_id] = {
                "count": finger_count,
                "start_time": now,
                "confirmed": False,
            }
            return None

        state = self.current_gestures[person_id]

        if state["count"] != finger_count:
            self.current_gestures[person_id] = {
                "count": finger_count,
                "start_time": now,
                "confirmed": False,
            }
            return None

        elapsed = now - state["start_time"]
        if elapsed >= self.stability_duration and not state["confirmed"]:
            state["confirmed"] = True
            return finger_count

        if state["confirmed"]:
            return finger_count

        return None

    def reset(self, person_id: Optional[str] = None):
        if person_id:
            self.current_gestures.pop(person_id, None)
        else:
            self.current_gestures.clear()


class FaceRecognizer:
    """Handles face detection and recognition using known student encodings."""

    def __init__(self):
        self.known_encodings: list[np.ndarray] = []
        self.known_ids: list[int] = []
        self.known_names: list[str] = []

    def register_student(
        self, student_id: int, name: str, image_path: str
    ) -> bool:
        image = face_recognition.load_image_file(image_path)
        encodings = face_recognition.face_encodings(image)
        if not encodings:
            return False
        self.known_encodings.append(encodings[0])
        self.known_ids.append(student_id)
        self.known_names.append(name)
        return True

    def remove_student(self, student_id: int):
        indices = [i for i, sid in enumerate(self.known_ids) if sid == student_id]
        for i in reversed(indices):
            del self.known_encodings[i]
            del self.known_ids[i]
            del self.known_names[i]

    def load_encoding(self, student_id: int, name: str, encoding_bytes: bytes):
        self.remove_student(student_id)
        encoding = pickle.loads(encoding_bytes)
        self.known_encodings.append(encoding)
        self.known_ids.append(student_id)
        self.known_names.append(name)

    def identify_faces(
        self, frame: np.ndarray, tolerance: float = 0.6
    ) -> list[dict]:
        small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        rgb_small = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

        face_locations = face_recognition.face_locations(rgb_small, model="hog")
        face_encodings = face_recognition.face_encodings(rgb_small, face_locations)

        results = []
        for encoding, location in zip(face_encodings, face_locations):
            top, right, bottom, left = location
            top *= 2
            right *= 2
            bottom *= 2
            left *= 2

            if not self.known_encodings:
                results.append(
                    {
                        "student_id": None,
                        "name": "Unknown",
                        "bbox": [left, top, right, bottom],
                        "confidence": 0.0,
                    }
                )
                continue

            distances = face_recognition.face_distance(
                self.known_encodings, encoding
            )
            best_idx = int(np.argmin(distances))
            best_distance = distances[best_idx]

            if best_distance <= tolerance:
                results.append(
                    {
                        "student_id": self.known_ids[best_idx],
                        "name": self.known_names[best_idx],
                        "bbox": [left, top, right, bottom],
                        "confidence": float(1.0 - best_distance),
                    }
                )
            else:
                results.append(
                    {
                        "student_id": None,
                        "name": "Unknown",
                        "bbox": [left, top, right, bottom],
                        "confidence": 0.0,
                    }
                )

        return results


class FingerCounter:
    """Counts raised fingers using MediaPipe Hands."""

    def __init__(self):
        self.hands = mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=10,
            min_detection_confidence=0.7,
            min_tracking_confidence=0.6,
        )
        self.tip_ids = [4, 8, 12, 16, 20]

    def count_fingers(self, hand_landmarks, handedness: str) -> int:
        landmarks = hand_landmarks.landmark
        fingers = []

        # Thumb: compare x position based on handedness
        if handedness == "Right":
            fingers.append(
                1 if landmarks[self.tip_ids[0]].x < landmarks[self.tip_ids[0] - 1].x else 0
            )
        else:
            fingers.append(
                1 if landmarks[self.tip_ids[0]].x > landmarks[self.tip_ids[0] - 1].x else 0
            )

        # Other fingers: tip y < pip y means finger is up
        for tip_id in self.tip_ids[1:]:
            fingers.append(
                1 if landmarks[tip_id].y < landmarks[tip_id - 2].y else 0
            )

        return sum(fingers)

    def detect_in_frame(self, frame: np.ndarray) -> list[dict]:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb_frame)

        detections = []
        if results.multi_hand_landmarks and results.multi_handedness:
            h, w, _ = frame.shape
            for hand_landmarks, hand_info in zip(
                results.multi_hand_landmarks, results.multi_handedness
            ):
                handedness = hand_info.classification[0].label
                finger_count = self.count_fingers(hand_landmarks, handedness)

                # Get hand bounding box center
                x_coords = [lm.x for lm in hand_landmarks.landmark]
                y_coords = [lm.y for lm in hand_landmarks.landmark]
                cx = int(((min(x_coords) + max(x_coords)) / 2) * w)
                cy = int(((min(y_coords) + max(y_coords)) / 2) * h)

                detections.append(
                    {
                        "finger_count": finger_count,
                        "center": (cx, cy),
                        "handedness": handedness,
                        "confidence": hand_info.classification[0].score,
                    }
                )

        return detections

    def close(self):
        self.hands.close()


class CVPipeline:
    """Main CV pipeline combining face recognition and gesture detection."""

    def __init__(self):
        self.face_recognizer = FaceRecognizer()
        self.finger_counter = FingerCounter()
        self.stabilizer = GestureStabilizer(stability_duration=1.5)

    def match_hands_to_faces(
        self, faces: list[dict], hands: list[dict], frame_width: int
    ) -> list[dict]:
        """Match detected hands to the nearest face based on proximity."""
        matched = []

        for face in faces:
            if face["student_id"] is None:
                continue

            face_cx = (face["bbox"][0] + face["bbox"][2]) / 2
            face_bottom = face["bbox"][3]
            best_hand = None
            best_dist = float("inf")

            for hand in hands:
                hx, hy = hand["center"]
                # Hand should be below the face
                if hy < face_bottom:
                    continue
                dist = abs(hx - face_cx)
                if dist < best_dist and dist < frame_width * 0.3:
                    best_dist = dist
                    best_hand = hand

            finger_count = best_hand["finger_count"] if best_hand else None

            # Only accept 1-4 as valid quiz answers
            if finger_count is not None and (finger_count < 1 or finger_count > 4):
                finger_count = None

            stable_count = self.stabilizer.update(
                str(face["student_id"]), finger_count
            )

            matched.append(
                {
                    "student_id": face["student_id"],
                    "student_name": face["name"],
                    "finger_count": stable_count,
                    "raw_finger_count": finger_count,
                    "confidence": face["confidence"],
                    "bbox": face["bbox"],
                }
            )

        return matched

    def process_frame(self, frame: np.ndarray) -> list[dict]:
        faces = self.face_recognizer.identify_faces(frame)
        hands = self.finger_counter.detect_in_frame(frame)
        h, w, _ = frame.shape
        return self.match_hands_to_faces(faces, hands, w)

    def reset_stabilizer(self):
        self.stabilizer.reset()

    def close(self):
        self.finger_counter.close()
