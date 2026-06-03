import multer from 'multer';

const storage = multer.memoryStorage();

export const multerUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
