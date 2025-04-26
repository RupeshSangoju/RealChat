const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', methods: ['GET', 'POST'], credentials: true },
});

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: './Uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());
app.use('/Uploads', express.static(path.join(__dirname, 'Uploads')));

// PostgreSQL setup
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'chat_app',
      password: process.env.DB_PASSWORD || 'rupesh',
      port: process.env.DB_PORT || 5432,
    };

const pool = new Pool(poolConfig);

// Create database tables
pool.connect((err) => {
  if (err) {
    console.error('PostgreSQL connection error:', err);
  } else {
    console.log('Connected to PostgreSQL');
    pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id),
        user_id INTEGER REFERENCES users(id),
        content TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reactions JSONB DEFAULT '{}'
      );
    `)
      .then(() => console.log('Database tables ensured'))
      .catch((err) => console.error('Table creation error:', err));
  }
});

// Video call room management
const videoCallRooms = new Map(); // Map<roomName, { users: Set<userId> }>
const socketToUserId = new Map(); // Map<socketId, userId>

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Authentication
  socket.on('register', async ({ username, password }) => {
    try {
      const userCheck = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (userCheck.rows.length > 0) {
        socket.emit('error', 'Username already taken');
      } else {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
          'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
          [username, hashedPassword]
        );
        socket.username = username;
        socket.userId = result.rows[0].id;
        socketToUserId.set(socket.id, result.rows[0].id);
        socket.emit('registered', { userId: result.rows[0].id, username: result.rows[0].username });
        console.log(`User registered: ${username} (ID: ${result.rows[0].id})`);
      }
    } catch (err) {
      console.error('Register error:', err);
      socket.emit('error', 'Registration failed');
    }
  });

  socket.on('login', async ({ username, password }) => {
    try {
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        socket.username = username;
        socket.userId = result.rows[0].id;
        socketToUserId.set(socket.id, result.rows[0].id);
        socket.emit('loggedIn', { userId: result.rows[0].id, username });
        console.log(`User logged in: ${username} (ID: ${result.rows[0].id})`);
      } else {
        socket.emit('error', 'Invalid credentials');
      }
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('error', 'Login failed');
    }
  });

  // Chat room handling
  socket.on('joinRoom', async (room) => {
    try {
      if (!socket.username || !socket.userId) {
        console.log('Join room failed: User not authenticated', { socketId: socket.id });
        return socket.emit('error', 'Please login first');
      }

      let roomResult = await pool.query('SELECT * FROM rooms WHERE name = $1', [room]);
      if (roomResult.rows.length === 0) {
        roomResult = await pool.query(
          'INSERT INTO rooms (name, created_by) VALUES ($1, $2) RETURNING id',
          [room, socket.userId]
        );
      }
      const roomId = roomResult.rows[0].id;

      socket.join(room);
      socket.room = room;
      const roomSockets = await io.in(room).fetchSockets();
      const userList = roomSockets.map((s) => s.username).filter(Boolean);
      io.to(room).emit('userList', userList);

      console.log(`User ${socket.id} (${socket.username}) joined room ${room} (ID: ${roomId})`);
    } catch (err) {
      console.error('Join room error:', err.message, err.stack);
      socket.emit('error', `Failed to join room: ${err.message}`);
    }
  });

  socket.on('chatMessage', async ({ room, message, username }) => {
    try {
      const roomResult = await pool.query('SELECT id FROM rooms WHERE name = $1', [room]);
      if (roomResult.rows.length > 0) {
        const roomId = roomResult.rows[0].id;
        const result = await pool.query(
          'INSERT INTO messages (room_id, user_id, content, sent_at) VALUES ($1, $2, $3, $4) RETURNING sent_at',
          [roomId, socket.userId, message, new Date()]
        );
        const msg = { sender: username, text: message, timestamp: result.rows[0].sent_at };
        io.to(room).emit('message', msg);
        console.log(`Message sent in room ${room} by ${username}: ${message}`);
      }
    } catch (err) {
      console.error('Chat message error:', err);
      socket.emit('error', 'Failed to send message');
    }
  });

  socket.on('privateMessage', async ({ toUsername, message, fromUsername }) => {
    try {
      const roomResult = await pool.query('SELECT id FROM rooms WHERE name = $1', [socket.room]);
      if (roomResult.rows.length > 0) {
        const roomId = roomResult.rows[0].id;
        const content = JSON.stringify({ content: message, isPrivate: true });
        const result = await pool.query(
          'INSERT INTO messages (room_id, user_id, content, sent_at) VALUES ($1, $2, $3, $4) RETURNING sent_at',
          [roomId, socket.userId, content, new Date()]
        );
        const msg = { sender: fromUsername, text: message, isPrivate: true, timestamp: result.rows[0].sent_at };
        const sockets = await io.fetchSockets();
        const toSocket = sockets.find((s) => s.username === toUsername);
        if (toSocket) {
          toSocket.emit('privateMessage', msg);
          socket.emit('privateMessage', msg);
          console.log(`Private message from ${fromUsername} to ${toUsername}: ${message}`);
        } else {
          socket.emit('error', `User ${toUsername} not found`);
        }
      }
    } catch (err) {
      console.error('Private message error:', err);
      socket.emit('error', 'Failed to send private message');
    }
  });

  socket.on('typing', ({ room, username, isTyping }) => {
    socket.to(room).emit('typing', { username, isTyping });
    console.log(`${username} is ${isTyping ? 'typing' : 'not typing'} in room ${room}`);
  });

  socket.on('file', async ({ room, fileUrl, fileType, sender }) => {
    try {
      const roomResult = await pool.query('SELECT id FROM rooms WHERE name = $1', [room]);
      if (roomResult.rows.length > 0) {
        const roomId = roomResult.rows[0].id;
        const content = JSON.stringify({ type: 'file', fileUrl, fileType });
        await pool.query(
          'INSERT INTO messages (room_id, user_id, content, sent_at) VALUES ($1, $2, $3, $4)',
          [roomId, socket.userId, content, new Date()]
        );
        const fileData = { sender, fileUrl, fileType, timestamp: new Date() };
        io.to(room).emit('file', fileData);
        console.log(`File sent in room ${room} by ${sender}: ${fileUrl} (${fileType})`);
      }
    } catch (err) {
      console.error('File message error:', err);
      socket.emit('error', 'Failed to send file');
    }
  });

  socket.on('voiceMessage', async ({ room, fileUrl, fileType, sender }) => {
    try {
      const roomResult = await pool.query('SELECT id FROM rooms WHERE name = $1', [room]);
      if (roomResult.rows.length > 0) {
        const roomId = roomResult.rows[0].id;
        const content = JSON.stringify({ type: 'voice', fileUrl, fileType });
        await pool.query(
          'INSERT INTO messages (room_id, user_id, content, sent_at) VALUES ($1, $2, $3, $4)',
          [roomId, socket.userId, content, new Date()]
        );
        const voiceData = { sender, fileUrl, fileType, timestamp: new Date() };
        io.to(room).emit('voiceMessage', voiceData);
        console.log(`Voice message sent in room ${room} by ${sender}: ${fileUrl}`);
      }
    } catch (err) {
      console.error('Voice message error:', err);
      socket.emit('error', 'Failed to send voice message');
    }
  });

  socket.on('react', async ({ room, messageId, emoji, username }) => {
    try {
      const result = await pool.query(
        'UPDATE messages SET reactions = reactions || $1::jsonb WHERE id = $2 RETURNING reactions',
        [JSON.stringify({ [username]: emoji }), messageId]
      );
      io.to(room).emit('reaction', { messageId, emoji, username });
      console.log(`Reaction added in room ${room}: ${emoji} by ${username} on message ${messageId}`);
    } catch (err) {
      console.error('Reaction error:', err);
      socket.emit('error', 'Failed to add reaction');
    }
  });

  socket.on('profile-pic-update', ({ room, username, profilePicUrl }) => {
    io.to(room).emit('profile-pic-update', { username, profilePicUrl });
    console.log(`Profile pic updated for ${username} in room ${room}: ${profilePicUrl}`);
  });

  // Video call handling
  socket.on('start-video-call', ({ room, username, callType }) => {
    io.to(room).emit('call-notification', { initiator: username, callType });
    console.log(`${username} started a ${callType} call in room ${room}`);
  });

  socket.on('join-video-call', ({ room, username }) => {
    if (!socket.userId || !socket.username) {
      socket.emit('error', 'Please login first');
      return;
    }

    if (!videoCallRooms.has(room)) {
      videoCallRooms.set(room, { users: new Set() });
    }
    const videoRoom = videoCallRooms.get(room);
    if (videoRoom.users.size >= 3) {
      socket.emit('room-full', 'Video call room is full (max 3 users)');
      console.log(`Video call room ${room} is full. Rejecting user ${socket.userId}`);
      return;
    }

    videoRoom.users.add(socket.userId);
    socket.join(`video-${room}`);
    console.log(`User ${socket.userId} (${socket.username}) joined video call in room ${room}. Current users: ${videoRoom.users.size}`);

    socket.to(`video-${room}`).emit('user-connected', socket.userId);

    videoRoom.users.forEach((existingUserId) => {
      if (existingUserId !== socket.userId) {
        socket.emit('user-connected', existingUserId);
        console.log(`Notified ${socket.userId} about existing video call user ${existingUserId}`);
      }
    });
  });

  socket.on('offer', ({ offer, target, room }) => {
    const targetSocketId = Array.from(socketToUserId.entries()).find(([sid, uid]) => uid === target)?.[0];
    if (targetSocketId) {
      console.log(`Offer from ${socket.userId} to ${target} in room ${room}`);
      io.to(targetSocketId).emit('offer', { offer, sender: socket.userId });
    } else {
      console.error(`Target user ${target} not found`);
      socket.emit('error', `Target user ${target} not found`);
    }
  });

  socket.on('answer', ({ answer, target, room }) => {
    const targetSocketId = Array.from(socketToUserId.entries()).find(([sid, uid]) => uid === target)?.[0];
    if (targetSocketId) {
      console.log(`Answer from ${socket.userId} to ${target} in room ${room}`);
      io.to(targetSocketId).emit('answer', { answer, sender: socket.userId });
    } else {
      console.error(`Target user ${target} not found`);
      socket.emit('error', `Target user ${target} not found`);
    }
  });

  socket.on('ice-candidate', ({ candidate, target, room }) => {
    const targetSocketId = Array.from(socketToUserId.entries()).find(([sid, uid]) => uid === target)?.[0];
    if (targetSocketId) {
      console.log(`ICE candidate from ${socket.userId} to ${target} in room ${room}`);
      io.to(targetSocketId).emit('ice-candidate', { candidate, sender: socket.userId });
    } else {
      console.error(`Target user ${target} not found`);
      socket.emit('error', `Target user ${target} not found`);
    }
  });

  socket.on('end-video-call', ({ room }) => {
    socket.to(`video-${room}`).emit('callEnded');
    if (videoCallRooms.has(room)) {
      const videoRoom = videoCallRooms.get(room);
      videoRoom.users.delete(socket.userId);
      if (videoRoom.users.size === 0) {
        videoCallRooms.delete(room);
      }
      socket.to(`video-${room}`).emit('user-disconnected', socket.userId);
      console.log(`User ${socket.userId} ended video call in room ${room}. Current users: ${videoRoom.users.size}`);
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    socketToUserId.delete(socket.id);

    const sockets = await io.fetchSockets();
    for (const room of socket.rooms) {
      if (room !== socket.id && !room.startsWith('video-')) {
        const roomSockets = await io.in(room).fetchSockets();
        const userList = roomSockets.map((s) => s.username).filter(Boolean);
        io.to(room).emit('userList', userList);
      }
    }

    videoCallRooms.forEach((videoRoom, room) => {
      if (videoRoom.users.has(socket.userId)) {
        videoRoom.users.delete(socket.userId);
        socket.to(`video-${room}`).emit('user-disconnected', socket.userId);
        console.log(`User ${socket.userId} disconnected from video call in room ${room}. Current users: ${videoRoom.users.size}`);
        if (videoRoom.users.size === 0) {
          videoCallRooms.delete(room);
        }
      }
    });
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `${process.env.BACKEND_URL || 'http://localhost:5000'}/Uploads/${req.file.filename}`;
  console.log('File uploaded:', { fileUrl, fileType: req.file.mimetype });
  res.json({ fileUrl, fileType: req.file.mimetype });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});