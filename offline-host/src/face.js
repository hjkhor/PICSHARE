import * as faceapi from "@vladmandic/face-api";

let ready;
export function loadModels() {
  if (!ready) ready = (async () => {
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
  })();
  return ready;
}

export async function descriptors(blob) {
  await loadModels();
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const results = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
      .withFaceLandmarks().withFaceDescriptors();
    return results.map((result) => ({
      vector: Array.from(result.descriptor),
      area: result.detection.box.width * result.detection.box.height,
    }));
  } finally {
    URL.revokeObjectURL(url);
  }
}
