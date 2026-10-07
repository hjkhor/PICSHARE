import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis
from app.core.config import get_settings

settings = get_settings()


class FaceService:

    def __init__(self):
        self.app = None

    def _ensure_initialized(self):
        if self.app is None:
            # name='antelopev2' or 'buffalo_l' for better accuracy
            self.app = FaceAnalysis(name='buffalo_l',
                                    allowed_modules=['detection', 'recognition'],
                                    providers=['CPUExecutionProvider'],
                                    root=settings.FACE_MODEL_ROOT)
            self.app.prepare(ctx_id=0, det_size=(640, 640))

    def get_embeddings(self, image_path: str):
        """Detects faces and returns a list of dictionaries containing embeddings and bboxes."""
        self._ensure_initialized()
        img = cv2.imread(image_path)
        if img is None:
            return []

        faces = self.app.get(img)
        results = []
        for face in faces:
            results.append({
                "embedding": face.normed_embedding.tolist(),
                "bbox": face.bbox.tolist(),  # [x1, y1, x2, y2]
                "score": float(face.det_score)
            })
        return results

    def compute_similarity(self, embedding1, embedding2):
        """Cosine similarity between two embeddings."""
        embedding1 = np.array(embedding1)
        embedding2 = np.array(embedding2)
        return np.dot(embedding1, embedding2) / (np.linalg.norm(embedding1) *
                                                 np.linalg.norm(embedding2))


face_service = FaceService()
