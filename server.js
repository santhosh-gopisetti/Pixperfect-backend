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

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'temporary-secret-for-testing'; // Fallback for demo

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'https://pixperfectfrontend.netlify.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use('/uploads', express.static('Uploads'));

// Database setup (in-memory for demo)
const dbPath = process.env.DATABASE_URL || ':memory:';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    return;
  }
  console.log('Connected to SQLite database at', dbPath);
});

// Promisify SQLite methods for async/await
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

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'Uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Authentication middleware
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

// Signup endpoint
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be 6 characters long' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    console.log('User registered:', { id: user.id, username: user.username });
    res.json({ message: 'User created successfully' });
  } catch (err) {
    console.error('Signup error:', err.message);
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be 6 characters long' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      console.log('Login failed: User not found for username:', username);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log('Login failed: Password mismatch for username:', username);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    console.log('Login successful for username:', username);
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Upload endpoint
app.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  const { overlayProps, textOverlay } = req.body;
  const userId = req.user.id;
  const imagePath = `/uploads/${req.file.filename}`;

  try {
    await dbRun(
      'INSERT INTO images (userId, imagePath, overlayProps, textOverlay, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, imagePath, overlayProps, textOverlay, new Date().toISOString()]
    );
    const imageId = (await dbGet('SELECT last_insert_rowid() as id')).id;
    console.log('Image uploaded:', { imageId, imagePath, userId });
    res.json({ imageId, imagePath, message: 'Image uploaded successfully' });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Failed to save image' });
  }
});

// Rotate endpoint
app.post('/rotate', authenticateToken, upload.single('image'), async (req, res) => {
  const { degrees } = req.body;
  const userId = req.user.id;
  const inputPath = req.file.path;
  const outputFilename = `rotated-${Date.now()}.png`;
  const outputPath = path.join(__dirname, 'Uploads', outputFilename);

  try {
    console.log('Starting rotation:', { degrees, inputPath });
    await sharp(inputPath)
      .rotate(parseInt(degrees))
      .toFile(outputPath);
    console.log('Rotation completed:', { outputPath });

    // Clean up input file
    fs.unlink(inputPath, (err) => {
      if (err) console.error('Failed to delete input file:', err);
    });

    // Save to database
    const imagePath = `/Uploads/${outputFilename}`;
    await dbRun(
      'INSERT INTO images (userId, imagePath, overlayProps, textOverlay, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, imagePath, JSON.stringify({ x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false }), JSON.stringify({ content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false }), new Date().toISOString()]
    );
    const imageId = (await dbGet('SELECT last_insert_rowid() as id')).id;

    res.json({ imageId, imagePath, message: 'Image rotated successfully' });
  } catch (err) {
    console.error('Rotation error:', err.message);
    fs.unlink(inputPath, (err) => {
      if (err) console.error('Failed to delete input file:', err);
    });
    res.status(500).json({ error: 'Failed to rotate image' });
  }
});

// Flip endpoint
app.post('/flip', authenticateToken, upload.single('image'), async (req, res) => {
  const { direction } = req.body;
  const userId = req.user.id;
  const inputPath = req.file.path;
  const outputFilename = `flipped-${Date.now()}.png`;
  const outputPath = path.join(__dirname, 'Uploads', outputFilename);

  try {
    console.log('Starting flip:', { direction, inputPath });
    const sharpInstance = sharp(inputPath);
    if (direction === 'horizontal') {
      await sharpInstance.flip().toFile(outputPath);
    } else if (direction === 'vertical') {
      await sharpInstance.flop().toFile(outputPath);
    } else {
      throw new Error('Invalid direction');
    }
    console.log('Flip completed:', { outputPath });

    // Clean up input file
    fs.unlink(inputPath, (err) => {
      if (err) console.error('Failed to delete input file:', err);
    });

    // Save to database
    const imagePath = `/Uploads/${outputFilename}`;
    await dbRun(
      'INSERT INTO images (userId, imagePath, overlayProps, textOverlay, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, imagePath, JSON.stringify({ x: 50, y: 50, scale: 1, opacity: 1.0, dragging: false }), JSON.stringify({ content: "", font: "Arial", size: 20, color: "#ffffff", x: 50, y: 50, opacity: 1.0, dragging: false }), new Date().toISOString()]
    );
    const imageId = (await dbGet('SELECT last_insert_rowid() as id')).id;

    res.json({ imageId, imagePath, message: 'Image flipped successfully' });
  } catch (err) {
    console.error('Flip error:', err.message);
    fs.unlink(inputPath, (err) => {
      if (err) console.error('Failed to delete input file:', err);
    });
    res.status(500).json({ error: 'Failed to flip image' });
  }
});

// Update image endpoint
app.put('/image', authenticateToken, upload.single('image'), async (req, res) => {
  const { id, overlayProps, textOverlay } = req.body;
  const userId = req.user.id;
  const newImagePath = `/Uploads/${req.file.filename}`;

  try {
    // Check if the image exists and belongs to the user
    const image = await dbGet('SELECT * FROM images WHERE id = ? AND userId = ?', [id, userId]);
    if (!image) {
      return res.status(404).json({ error: 'Image not found or not authorized' });
    }

    // Delete the old image file
    const oldFilePath = path.join(__dirname, image.imagePath);
    fs.unlink(oldFilePath, (err) => {
      if (err) console.error('Failed to delete old image file:', err);
    });

    // Update the database with the new image path and properties
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

// Get all images for a user
app.get('/images', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const rows = await dbAll('SELECT * FROM images WHERE userId = ?', [userId]);
    console.log(`Fetched ${rows.length} images for user ${userId}`);
    res.json(rows);
  } catch (err) {
    console.error('Fetch images error:', err.message);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// Get a specific image
app.get('/image/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const row = await dbGet('SELECT * FROM images WHERE id = ? AND userId = ?', [id, userId]);
    if (!row) {
      console.log(`Image not found: id=${id}, userId=${userId}`);
      return res.status(404).json({ error: 'Image not found' });
    }
    console.log(`Fetched image: id=${id}, userId=${userId}`);
    res.json(row);
  } catch (err) {
    console.error('Fetch image error:', err.message);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

// Delete an image
app.delete('/image/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const row = await dbGet('SELECT imagePath FROM images WHERE id = ? AND userId = ?', [id, userId]);
    if (!row) {
      console.log(`Image not found for deletion: id=${id}, userId=${userId}`);
      return res.status(404).json({ error: 'Image not found' });
    }

    const filePath = path.join(__dirname, row.imagePath);
    fs.unlink(filePath, (err) => {
      if (err) console.error('Failed to delete file:', err);
    });

    await dbRun('DELETE FROM images WHERE id = ? AND userId = ?', [id, userId]);
    console.log(`Image deleted: id=${id}, userId=${userId}`);
    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Delete image error:', err.message);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.send('PixPerfect Backend is running!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});