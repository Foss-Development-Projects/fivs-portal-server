import { Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export const compressImages = async (req: Request, res: Response, next: NextFunction) => {
    const logFile = path.join(process.cwd(), 'logs', 'debug_compression.log');
    const log = (msg: string) => {
        try {
            // Ensure logs dir exists
            const logsDir = path.dirname(logFile);
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

            fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
        } catch (e) {
            console.error('Failed to write to debug log:', e);
        }
    };

    log(`Middleware hit. URL: ${req.originalUrl}, Method: ${req.method}`);

    if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        log('No files found in request.');
        return next();
    }

    const files = req.files as Express.Multer.File[];
    log(`Processing ${files.length} files`);

    try {
        await Promise.all(files.map(async (file) => {
            log(`Checking file: ${file.originalname} (${file.mimetype})`);
            // Only process image files
            if (!file.mimetype.startsWith('image/')) {
                log(`Skipping non-image: ${file.originalname}`);
                return;
            }

            const filePath = file.path;
            const tempFilePath = path.join(path.dirname(filePath), `temp_${path.basename(filePath)}`);

            try {
                // Initialize sharp instance
                let imageProcessor = sharp(filePath);
                const metadata = await imageProcessor.metadata();

                // Apply lossless compression based on format
                if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
                    imageProcessor = imageProcessor.jpeg({
                        mozjpeg: true,
                        quality: 90, // Visually lossless usually 
                        chromaSubsampling: '4:4:4'
                    });
                } else if (metadata.format === 'png') {
                    imageProcessor = imageProcessor.png({
                        compressionLevel: 9,
                        adaptiveFiltering: true,
                        quality: 100
                    });
                } else if (metadata.format === 'webp') {
                    imageProcessor = imageProcessor.webp({
                        lossless: true,
                        quality: 100
                    });
                }

                // Save to temp file first to avoid read/write conflict
                await imageProcessor.toFile(tempFilePath);

                // Calculate stats
                const originalSize = fs.statSync(filePath).size;
                const compressedSize = fs.statSync(tempFilePath).size;
                const savings = originalSize > 0 ? ((originalSize - compressedSize) / originalSize * 100).toFixed(2) + '%' : '0%';

                // Replace original file with compressed version
                fs.renameSync(tempFilePath, filePath);

                // Update file size in req object
                file.size = compressedSize;

                // Log stats
                if (!(req as any).compressionLogs) (req as any).compressionLogs = [];
                const logEntry = {
                    file: file.originalname,
                    original: `${(originalSize / 1024).toFixed(2)} KB`,
                    compressed: `${(compressedSize / 1024).toFixed(2)} KB`,
                    savings: savings
                };
                (req as any).compressionLogs.push(logEntry);
                log(`Compressed: ${JSON.stringify(logEntry)}`);

            } catch (err) {
                log(`Error compressing image ${file.originalname}: ${err}`);
                // Clean up temp file if it exists and error occurred
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            }
        }));

        next();
    } catch (error) {
        log(`Critical error in image compression middleware: ${error}`);
        next(); // Proceed even if compression fails critically
    }
};
