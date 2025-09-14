// server.js - Main Server File
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Database Configuration
const dbConfig = {
    host: 'cashearnersofficial.xyz',
    user: 'cztldhwx_Auto_PostTg',
    password: 'Aptap786920',
    database: 'cztldhwx_Auto_PostTg',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);
const JWT_SECRET = '7fd81c2aa5c17cb969e6e0c0bba03e35e49f84b41d4c444e';

// Game State
let matchQueue = {
    200: [],
    500: [],
    1000: [],
    2000: [],
    5000: []
};

let activeGames = new Map();
let connectedUsers = new Map();

// Initialize Database Tables
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Create users table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INT AUTO_INCREMENT PRIMARY KEY,
                phone VARCHAR(15) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                username VARCHAR(50) NOT NULL,
                profile_logo VARCHAR(255) DEFAULT '👤',
                coins INT DEFAULT 1000,
                total_matches INT DEFAULT 0,
                wins INT DEFAULT 0,
                losses INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create matches table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS matches (
                match_id INT AUTO_INCREMENT PRIMARY KEY,
                room_id VARCHAR(100) NOT NULL,
                entry_fee INT NOT NULL,
                player1_id INT NOT NULL,
                player2_id INT NOT NULL,
                winner_id INT DEFAULT NULL,
                score_p1 INT DEFAULT 0,
                score_p2 INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player1_id) REFERENCES users(user_id),
                FOREIGN KEY (player2_id) REFERENCES users(user_id),
                FOREIGN KEY (winner_id) REFERENCES users(user_id)
            )
        `);

        connection.release();
        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
}

// Middleware for JWT verification
function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.headers.token;
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

// Generate random username
function generateUsername() {
    const adjectives = ['Cool', 'Smart', 'Fast', 'Lucky', 'Brave', 'Quick'];
    const nouns = ['Player', 'Gamer', 'Champion', 'Hero', 'Master', 'Pro'];
    const number = Math.floor(Math.random() * 1000);
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${number}`;
}

// Generate quiz questions
function generateQuestions(count = 20) {
    const questions = [];
    for (let i = 0; i < count; i++) {
        const num1 = Math.floor(Math.random() * 50) + 1;
        const num2 = Math.floor(Math.random() * 50) + 1;
        const correct = num1 + num2;
        
        const options = [correct];
        while (options.length < 4) {
            const wrong = correct + Math.floor(Math.random() * 20) - 10;
            if (wrong > 0 && !options.includes(wrong)) {
                options.push(wrong);
            }
        }
        
        // Shuffle options
        for (let j = options.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [options[j], options[k]] = [options[k], options[j]];
        }

        questions.push({
            id: i,
            num1,
            num2,
            options,
            correctIndex: options.indexOf(correct),
            correctAnswer: correct
        });
    }
    return questions;
}

// API Routes

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Phone and password are required'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        const connection = await pool.getConnection();
        
        // Check if user exists
        const [existing] = await connection.execute(
            'SELECT user_id FROM users WHERE phone = ?',
            [phone]
        );

        if (existing.length > 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Phone number already registered'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const username = generateUsername();

        // Insert user
        const [result] = await connection.execute(
            'INSERT INTO users (phone, password_hash, username) VALUES (?, ?, ?)',
            [phone, hashedPassword, username]
        );

        connection.release();

        res.json({
            success: true,
            message: 'Registration successful',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Phone and password are required'
            });
        }

        const connection = await pool.getConnection();
        
        // Get user
        const [users] = await connection.execute(
            'SELECT * FROM users WHERE phone = ?',
            [phone]
        );

        connection.release();

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid phone or password'
            });
        }

        const user = users[0];

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid phone or password'
            });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user.user_id, phone: user.phone },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Remove password from response
        delete user.password_hash;

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Get user profile
app.get('/api/user/profile', verifyToken, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [users] = await connection.execute(
            'SELECT user_id, phone, username, profile_logo, coins, total_matches, wins, losses FROM users WHERE user_id = ?',
            [req.user.userId]
        );

        connection.release();

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.id}`);

    // Join queue for match
    socket.on('joinQueue', async (data) => {
        try {
            const { userId, entryFee, token } = data;
            
            // Verify token
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.userId !== userId) {
                socket.emit('error', { message: 'Invalid token' });
                return;
            }

            const connection = await pool.getConnection();
            
            // Get user and check balance
            const [users] = await connection.execute(
                'SELECT * FROM users WHERE user_id = ?',
                [userId]
            );

            if (users.length === 0 || users[0].coins < entryFee) {
                connection.release();
                socket.emit('error', { message: 'Insufficient balance' });
                return;
            }

            const user = users[0];
            
            // Deduct entry fee
            await connection.execute(
                'UPDATE users SET coins = coins - ? WHERE user_id = ?',
                [entryFee, userId]
            );

            connection.release();

            // Add to queue
            const queueData = {
                userId,
                socketId: socket.id,
                username: user.username,
                entryFee,
                joinedAt: Date.now()
            };

            // Check for existing player in queue
            const queue = matchQueue[entryFee];
            if (queue.length > 0) {
                // Match found!
                const opponent = queue.shift();
                const roomId = `room_${userId}_${opponent.userId}_${Date.now()}`;
                
                const gameData = {
                    roomId,
                    player1: { ...queueData },
                    player2: { ...opponent },
                    entryFee,
                    prizePool: entryFee * 2,
                    questions: generateQuestions(20),
                    scores: { [userId]: 0, [opponent.userId]: 0 },
                    startTime: null,
                    gameTimer: 120
                };

                activeGames.set(roomId, gameData);

                // Join both players to room
                socket.join(roomId);
                io.sockets.sockets.get(opponent.socketId)?.join(roomId);

                // Notify both players
                io.to(roomId).emit('matchFound', {
                    roomId,
                    players: {
                        player1: { username: user.username, userId },
                        player2: { username: opponent.username, userId: opponent.userId }
                    },
                    prizePool: entryFee * 2,
                    entryFee
                });

                // Start game after 5 seconds
                setTimeout(() => {
                    gameData.startTime = Date.now();
                    io.to(roomId).emit('gameStart', {
                        questions: gameData.questions,
                        timer: 120
                    });

                    // Start game timer
                    startGameTimer(roomId);
                }, 5000);

            } else {
                // Add to queue
                queue.push(queueData);
                connectedUsers.set(socket.id, queueData);
                socket.emit('queueJoined', { position: queue.length });
            }

        } catch (error) {
            console.error('Join queue error:', error);
            socket.emit('error', { message: 'Server error' });
        }
    });

    // Submit answer
    socket.on('submitAnswer', async (data) => {
        try {
            const { questionId, answer, isCorrect } = data;
            const user = connectedUsers.get(socket.id);
            
            if (!user) return;

            // Find active game
            let gameRoom = null;
            for (const [roomId, game] of activeGames) {
                if (game.player1.userId === user.userId || game.player2.userId === user.userId) {
                    gameRoom = { roomId, game };
                    break;
                }
            }

            if (!gameRoom) return;

            const { roomId, game } = gameRoom;

            // Update score
            if (isCorrect) {
                game.scores[user.userId]++;
            }

            // Emit score update to room
            io.to(roomId).emit('updateScore', {
                scores: game.scores,
                yourScore: game.scores[user.userId],
                opponentScore: game.scores[user.userId === game.player1.userId ? game.player2.userId : game.player1.userId]
            });

        } catch (error) {
            console.error('Submit answer error:', error);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.id}`);
        
        // Remove from queues
        const user = connectedUsers.get(socket.id);
        if (user) {
            for (const [fee, queue] of Object.entries(matchQueue)) {
                const index = queue.findIndex(p => p.socketId === socket.id);
                if (index !== -1) {
                    queue.splice(index, 1);
                    // Refund entry fee
                    refundUser(user.userId, user.entryFee);
                }
            }
            connectedUsers.delete(socket.id);
        }
    });
});

// Game timer function
function startGameTimer(roomId) {
    const game = activeGames.get(roomId);
    if (!game) return;

    const gameInterval = setInterval(async () => {
        game.gameTimer--;

        io.to(roomId).emit('timeUpdate', {
            remaining: game.gameTimer
        });

        if (game.gameTimer <= 0) {
            clearInterval(gameInterval);
            await endGame(roomId);
        }
    }, 1000);
}

// End game function
async function endGame(roomId) {
    try {
        const game = activeGames.get(roomId);
        if (!game) return;

        const { player1, player2, scores, prizePool, entryFee } = game;
        const score1 = scores[player1.userId] || 0;
        const score2 = scores[player2.userId] || 0;

        let winner = null;
        let result1, result2, coinsWon1 = 0, coinsWon2 = 0;

        if (score1 > score2) {
            winner = player1.userId;
            result1 = 'win';
            result2 = 'lose';
            coinsWon1 = prizePool;
        } else if (score2 > score1) {
            winner = player2.userId;
            result1 = 'lose';
            result2 = 'win';
            coinsWon2 = prizePool;
        } else {
            result1 = result2 = 'draw';
            coinsWon1 = coinsWon2 = entryFee; // Refund
        }

        const connection = await pool.getConnection();

        // Update coins and stats
        if (coinsWon1 > 0) {
            await connection.execute(
                'UPDATE users SET coins = coins + ?, total_matches = total_matches + 1, wins = wins + ? WHERE user_id = ?',
                [coinsWon1, result1 === 'win' ? 1 : 0, player1.userId]
            );
        }

        if (coinsWon2 > 0) {
            await connection.execute(
                'UPDATE users SET coins = coins + ?, total_matches = total_matches + 1, wins = wins + ? WHERE user_id = ?',
                [coinsWon2, result2 === 'win' ? 1 : 0, player2.userId]
            );
        }

        // Update losses
        if (result1 === 'lose') {
            await connection.execute(
                'UPDATE users SET total_matches = total_matches + 1, losses = losses + 1 WHERE user_id = ?',
                [player1.userId]
            );
        }

        if (result2 === 'lose') {
            await connection.execute(
                'UPDATE users SET total_matches = total_matches + 1, losses = losses + 1 WHERE user_id = ?',
                [player2.userId]
            );
        }

        // Save match result
        await connection.execute(
            'INSERT INTO matches (room_id, entry_fee, player1_id, player2_id, winner_id, score_p1, score_p2) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [roomId, entryFee, player1.userId, player2.userId, winner, score1, score2]
        );

        connection.release();

        // Emit results
        const player1Socket = io.sockets.sockets.get(player1.socketId);
        const player2Socket = io.sockets.sockets.get(player2.socketId);

        player1Socket?.emit('gameOver', {
            result: result1,
            scores: { yourScore: score1, opponentScore: score2 },
            coinsWon: coinsWon1
        });

        player2Socket?.emit('gameOver', {
            result: result2,
            scores: { yourScore: score2, opponentScore: score1 },
            coinsWon: coinsWon2
        });

        activeGames.delete(roomId);

    } catch (error) {
        console.error('End game error:', error);
    }
}

// Refund user function
async function refundUser(userId, amount) {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            'UPDATE users SET coins = coins + ? WHERE user_id = ?',
            [amount, userId]
        );
        connection.release();
    } catch (error) {
        console.error('Refund error:', error);
    }
}

// API Health Check
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Quiz Game Backend API is running!',
        version: '1.0.0',
        endpoints: {
            register: 'POST /api/auth/register',
            login: 'POST /api/auth/login',
            profile: 'GET /api/user/profile'
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
    await initializeDatabase();
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📱 Game URL: http://localhost:${PORT}`);
    });
}

startServer();
