require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const util = require('util');
const sharp = require('sharp');
const AWS = require('aws-sdk');

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET;

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
const S3_BUCKET = process.env.S3_BUCKET;

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'https://your-frontend.onrender.com'], // Add frontend URL after deployment
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Database setup (SQLite remains unchanged)
const dbPath = path.join(__dirname, 'pixperfect.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    return;
  }
  console.log('Connected to SQLite database at', dbPath);
});

// Promisify SQLite methods
const dbRun = util.promisify(db.run.bind(db));
const dbGet = util.promisify(db.get.bind(db));
const dbAll = util.promisify(db.all.bind(db));

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      imagePath TEXT,
      overlayProps TEXT,
      textOverlay TEXT,
      createdAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);
  console.log('Tables created');
});

// Multer setup for in-memory storage (before uploading to S3)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Authentication middleware (unchanged)
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    console.log('Authentication failed: No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Authentication failed: Invalid token', err.message);
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    console.log('Authentication successful for user:', user.username);
    next();
  });
};

// Upload endpoint (modified for S3)
app.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  const { overlayProps, textOverlay } = req.body;
  const userId = req.user.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileName = `${Date.now()}-${file.originalname}`;
  const params = {
    Bucket: S3_BUCKET,
    Key: `uploads/${fileName}`,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  };

  try {
    const { Location } = await s3.upload(params).promise();
    const imagePath = Location; // S3 URL

    await dbRun(
      'INSERT INTO images (userId, imagePath, overlayProps, textOverlay, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, imagePath, overlayProps, textOverlay, new Date().toISOString()]
    );
    const imageId = (await dbGet('SELECT last_insert_rowid() as id')).id;
    console.log('Image uploaded to S3:', { imageId, imagePath, userId });
    res.json({ imageId, imagePath, message: 'Image uploaded successfully' });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Rotate endpoint (modified for S3)
app.post('/rotate', authenticateToken, upload.single('image'), async (req, res) => {
  const { degrees } = req.body;
  const userId = req.user.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const outputFilename = `rotated-${Date.now()}.png`;
  try {
    console.log('Starting rotation:', { degrees });
    const rotatedBuffer = await sharp(file.buffer)
      .rotate(parseInt(degrees))
      .toBuffer();

    const params = {
      Bucket: S3_BUCKET,
      Key: `uploads/${outputFilename}`,
      Body: rotatedBuffer,
      ContentType: 'image/png',
      ACL: 'public-read',
    };

    const { Location } = await s3.upload(params).promise();
    const imagePath = Location;

    await dbRun(
      'INSERT INTO images (userId, imagePath, overlayProps, textOverlay, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, imagePath, JSON.stringify({ x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false }), JSON.stringify({ content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false }), new Date().toISOString()]
    );
    const imageId = (await dbGet('SELECT last_insert_rowid() as id')).id;

    res.json({ imageId, imagePath, message: 'Image rotated successfully' });
  } catch (err) {
    console.error('Rotation error:', err.message);
    res.status(500).json({ error: 'Failed to rotate image' });
  }
});

// Flip endpoint (modified for S3)
app.post('/flip', authenticateToken, upload.single('image'), async (req, res) => {
  const { direction } = req.body;
  const userId = req.user.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const outputFilename = `flipped-${Date.now()}.png`;
  try {
    console.log('Starting flip:', { direction });
    const sharpInstance = sharp(file.buffer);
    if (direction === 'horizontal') {
      await sharpInstance.flip();
    } else if (direction === 'vertical') {
      await sharpInstance.flop();
    } else {
      throw new Error('Invalid direction');
    }
    const flippedBuffer = await sharpInstance.toBuffer();

    const params = {
      Bucket: S3_BUCKET,
      Key: `uploads/${outputFilename}`,
      Body: flippedBuffer,
      ContentType: 'image/png',
      ACL: 'public-read',
    };

    const { Location } = await s3.upload(params).promise();
    const imagePath = Location;

    await dbRun(
      'INSERT INTO images (userId, imagePath, overlayProps, textOverlay, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, imagePath, JSON.stringify({ x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false }), JSON.stringify({ content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false }), new Date().toISOString()]
    );
    const imageId = (await dbGet('SELECT last_insert_rowid() as id')).id;

    res.json({ imageId, imagePath, message: 'Image flipped successfully' });
  } catch (err) {
    console.error('Flip error:', err.message);
    res.status(500).json({ error: 'Failed to flip image' });
  }
});

// Update image endpoint (modified for S3)
app.put('/image', authenticateToken, upload.single('image'), async (req, res) => {
  const { id, overlayProps, textOverlay } = req.body;
  const userId = req.user.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const newFileName = `${Date.now()}-${file.originalname}`;
  const params = {
    Bucket: S3_BUCKET,
    Key: `uploads/${newFileName}`,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  };

  try {
    const image = await dbGet('SELECT * FROM images WHERE id = ? AND userId = ?', [id, userId]);
    if (!image) {
      return res.status(404).json({ error: 'Image not found or not authorized' });
    }

    // Delete old image from S3
    const oldKey = image.imagePath.split('/').pop();
    await s3.deleteObject({ Bucket: S3_BUCKET, Key: `uploads/${oldKey}` }).promise();

    // Upload new image
    const { Location } = await s3.upload(params).promise();
    const newImagePath = Location;

    await dbRun(
      'UPDATE images SET imagePath = ?, overlayProps = ?, textOverlay = ? WHERE id = ? AND userId = ?',
      [newImagePath, overlayProps, textOverlay, id, userId]
    );

    console.log('Image updated:', { id, newImagePath, userId });
    res.json({ message: 'Image updated successfully' });
  } catch (err) {
    console.error('Update image error:', err.message);
    res.status(500).json({ error: 'Failed to update image' });
  }
});

// Delete image endpoint (modified for S3)
app.delete('/image/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const row = await dbGet('SELECT imagePath FROM images WHERE id = ? AND userId = ?', [id, userId]);
    if (!row) {
      console.log(`Image not found for deletion: id=${id}, userId=${userId}`);
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete from S3
    const key = row.imagePath.split('/').pop();
    await s3.deleteObject({ Bucket: S3_BUCKET, Key: `Uploads/${key}` }).promise();

    await dbRun('DELETE FROM images WHERE id = ? AND userId = ?', [id, userId]);
    console.log(`Image deleted: id=${id}, userId=${userId}`);
    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Delete image error:', err.message);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Other endpoints (signup, login, get images, etc.) remain unchanged

// Root endpoint
app.get('/', (req, res) => {
  res.send('PixPerfect Backend is running!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});