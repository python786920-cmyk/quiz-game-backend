const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Matchmaker = require('./matchmaker');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Database Connection
const dbConfig = {
  host: process.env.DB_HOST || 'cashearnersofficial.xyz',
  user: process.env.DB_USER || 'cztldhwx_Auto_PostTg',
  password: process.env.DB_PASSWORD || 'Aptap786920',
  database: process.env.DB_NAME || 'cztldhwx_Auto_PostTg',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);
const matchmaker = new Matchmaker(io, pool);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || '7fd81c2aa5c17cb969e6e0c0bba03e35e49f84b41d4c444e';

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Generate random username
function generateUsername() {
  const prefixes = ['Player', 'Gamer', 'Pro', 'Master', 'Champion'];
  const suffix = Math.floor(Math.random() * 10000);
  return prefixes[Math.floor(Math.random() * prefixes.length)] + suffix;
}

// Generate math questions
function generateQuestions() {
  const questions = [];
  for (let i = 0; i < 20; i++) {
    const num1 = Math.floor(Math.random() * 50) + 1;
    const num2 = Math.floor(Math.random() * 50) + 1;
    const correct = num1 + num2;
    const options = [correct];
    
    // Generate 3 wrong options
    while (options.length < 4) {
      const wrong = correct + Math.floor(Math.random() * 20) - 10;
      if (wrong > 0 && !options.includes(wrong)) {
        options.push(wrong);
      }
    }
    
    // Shuffle options
    options.sort(() => Math.random() - 0.5);
    
    questions.push({
      id: i + 1,
      question: `${num1} + ${num2} = ?`,
      options: options,
      correct: correct
    });
  }
  return questions;
}

// API Routes

// Register User
app.post('/api/register', async (req, res) => {
  try {
    const { phone_number, password, confirm_password } = req.body;

    if (!phone_number || !password || !confirm_password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if phone number already exists
    const [existing] = await pool.execute(
      'SELECT phone_number FROM users WHERE phone_number = ?',
      [phone_number]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Hash password and generate username
    const password_hash = await bcrypt.hash(password, 10);
    const username = generateUsername();
    const profile_logo = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;

    // Insert new user
    const [result] = await pool.execute(
      `INSERT INTO users (phone_number, password_hash, username, profile_logo, coins) 
       VALUES (?, ?, ?, ?, 1000)`,
      [phone_number, password_hash, username, profile_logo]
    );

    // Generate JWT token
    const token = jwt.sign(
      { user_id: result.insertId, phone_number, username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        user_id: result.insertId,
        username,
        profile_logo,
        coins: 1000,
        total_matches: 0,
        wins: 0,
        losses: 0
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login User
app.post('/api/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;

    if (!phone_number || !password) {
      return res.status(400).json({ error: 'Phone number and password required' });
    }

    // Find user by phone number
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE phone_number = ?',
      [phone_number]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    const user = users[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { user_id: user.user_id, phone_number: user.phone_number, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        profile_logo: user.profile_logo,
        coins: user.coins,
        total_matches: user.total_matches,
        wins: user.wins,
        losses: user.losses
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get User Profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT user_id, username, profile_logo, coins, total_matches, wins, losses FROM users WHERE user_id = ?',
      [req.user.user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: users[0] });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update Profile
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { username, profile_logo } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    await pool.execute(
      'UPDATE users SET username = ?, profile_logo = ? WHERE user_id = ?',
      [username, profile_logo, req.user.user_id]
    );

    res.json({ message: 'Profile updated successfully' });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Match History
app.get('/api/matches', authenticateToken, async (req, res) => {
  try {
    const [matches] = await pool.execute(`
      SELECT m.*, 
             u1.username as player1_name, u1.profile_logo as player1_logo,
             u2.username as player2_name, u2.profile_logo as player2_logo
      FROM matches m
      JOIN users u1 ON m.player1_id = u1.user_id
      JOIN users u2 ON m.player2_id = u2.user_id
      WHERE m.player1_id = ? OR m.player2_id = ?
      ORDER BY m.created_at DESC
      LIMIT 20
    `, [req.user.user_id, req.user.user_id]);

    res.json({ matches });

  } catch (error) {
    console.error('Match history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.IO Game Logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle authentication
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.user_id;
      socket.username = decoded.username;
      
      // Get latest user data
      const [users] = await pool.execute(
        'SELECT * FROM users WHERE user_id = ?',
        [decoded.user_id]
      );
      
      if (users.length > 0) {
        socket.userData = users[0];
        socket.emit('authenticated', { success: true });
      } else {
        socket.emit('authenticated', { success: false, error: 'User not found' });
      }
    } catch (error) {
      socket.emit('authenticated', { success: false, error: 'Invalid token' });
    }
  });

  // Join matchmaking queue
  socket.on('joinQueue', async (data) => {
    if (!socket.userId || !socket.userData) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    const { entry_fee } = data;
    
    if (![200, 500, 1000, 2000, 5000].includes(entry_fee)) {
      socket.emit('error', 'Invalid entry fee');
      return;
    }

    if (socket.userData.coins < entry_fee) {
      socket.emit('error', 'Insufficient coins');
      return;
    }

    try {
      await matchmaker.addToQueue(socket, entry_fee);
    } catch (error) {
      console.error('Queue error:', error);
      socket.emit('error', 'Failed to join queue');
    }
  });

  // Leave queue
  socket.on('leaveQueue', () => {
    matchmaker.removeFromQueue(socket);
  });

  // Submit answer
  socket.on('submitAnswer', async (data) => {
    await matchmaker.handleAnswer(socket, data);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    matchmaker.removeFromQueue(socket);
    matchmaker.handleDisconnect(socket);
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Quiz Game Server running on port ${PORT}`);
  console.log(`🎮 Ready for connections!`);
});

module.exports = { app, server, io, pool };
