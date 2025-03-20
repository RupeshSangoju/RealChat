const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
//const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
const server = http.createServer(app);


require('dotenv').config(); // Add this to load .env file locally
const upload = multer({ dest: 'uploads/' });

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Adjust for production
  methods: ['GET', 'POST'],
  credentials: true,
}));

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000',methods: ['GET', 'POST'], credentials: true },
});

const { Pool } = require('pg');
require('dotenv').config(); // Add this to load .env file locally

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'chat_app',
      password: process.env.DB_PASSWORD || 'rupesh', // Your local password
      port: process.env.DB_PORT || 5432,
    };

const pool = new Pool(poolConfig);

// Create tables if they don’t exist
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
      .catch(err => console.error('Table creation error:', err));
  }
});

pool.connect((err) => {
  if (err) console.error('PostgreSQL connection error:', err);
  else console.log('Connected to PostgreSQL');
});

/*app.use(express.static(path.join(__dirname, 'build')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));  */  
app.use('/uploads', express.static('uploads'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

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
        socket.emit('registered', { userId: result.rows[0].id, username: result.rows[0].username });
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
        socket.emit('loggedIn', { userId: result.rows[0].id, username });
      } else {
        socket.emit('error', 'Invalid credentials');
      }
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('error', 'Login failed');
    }
  });

  socket.on('joinRoom', async (room) => {
    try {
      console.log('Attempting to join room:', room, 'User:', socket.username);
      if (!socket.username || !socket.userId) {
        console.log('No username or userId set on socket');
        return socket.emit('error', 'Please login first');
      }
  
      let roomResult = await pool.query('SELECT * FROM rooms WHERE name = $1', [room]);
      if (roomResult.rows.length === 0) {
        roomResult = await pool.query(
          'INSERT INTO rooms (name, created_by) VALUES ($1, $2) RETURNING id',
          [room, socket.userId]
        );
        console.log('New room created:', roomResult.rows[0].id);
      }
      const roomId = roomResult.rows[0].id;
  
      socket.join(room);
      const roomSockets = await io.in(room).fetchSockets();
      const userList = roomSockets.map(s => s.username).filter(Boolean);
      io.to(room).emit('userList', userList);
  
      // Fetch and emit message history
      const historyResult = await pool.query(
        'SELECT m.content AS text, u.username AS sender, m.created_at ' +
        'FROM messages m JOIN users u ON m.user_id = u.id ' +
        'WHERE m.room_id = $1 ORDER BY m.created_at',
        [roomId]
      );
      const history = historyResult.rows.map(row => ({
        sender: row.sender,
        text: row.text,
        timestamp: row.created_at // Optional: include timestamp if needed in frontend
      }));
      socket.emit('messageHistory', history);
  
      console.log(`User ${socket.id} (${socket.username}) joined room ${room} (ID: ${roomId})`);
    } catch (err) {
      console.error('Join room error:', err);
      socket.emit('error', 'Failed to join room');
    }
  });

  socket.on('chatMessage', async ({ room, message, username }) => {
    try {
      const roomResult = await pool.query('SELECT id FROM rooms WHERE name = $1', [room]);
      if (roomResult.rows.length > 0) {
        const roomId = roomResult.rows[0].id;
        await pool.query(
          'INSERT INTO messages (room_id, user_id, content) VALUES ($1, $2, $3)',
          [roomId, socket.userId, message]
        );
        io.to(room).emit('message', { sender: username, text: message });
        console.log(`Message sent in room ${room} by ${username}: ${message}`);
      }
    } catch (err) {
      console.error('Chat message error:', err);
    }
  });

  socket.on('privateMessage', async ({ toUsername, message, fromUsername }) => {
    try {
      const sockets = await io.fetchSockets();
      const toSocket = sockets.find(s => s.username === toUsername);
      if (toSocket) {
        toSocket.emit('privateMessage', { sender: fromUsername, text: message });
      }
    } catch (err) {
      console.error('Private message error:', err);
    }
  });

  socket.on('typing', ({ room, username, isTyping }) => {
    socket.to(room).emit('typing', { username, isTyping });
  });

  socket.on('file', ({ room, fileUrl, fileType, sender }) => {
    io.to(room).emit('file', { fileUrl, fileType, sender });
  });

  socket.on('react', ({ room, messageId, emoji, username }) => {
    io.to(room).emit('reaction', { messageId, emoji, username });
  });

  // Voice/Video Call Handlers
  socket.on('startCall', ({ room, callType, username }) => {
    console.log(`${username} started a ${callType} call in room ${room}`);
    socket.to(room).emit('incomingCall', { callType, initiator: username, socketId: socket.id });
  });

  socket.on('acceptCall', ({ room, callerSocketId, username }) => {
    io.to(callerSocketId).emit('callAccepted', { acceptor: username, socketId: socket.id });
  });

  socket.on('rejectCall', ({ room, callerSocketId, username }) => {
    io.to(callerSocketId).emit('callRejected', { rejector: username });
  });

  socket.on('signal', ({ toSocketId, signal }) => {
    io.to(toSocketId).emit('signal', { signal, fromSocketId: socket.id });
  });

  socket.on('endCall', ({ room }) => {
    socket.to(room).emit('callEnded');
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    const sockets = await io.fetchSockets();
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        const roomSockets = await io.in(room).fetchSockets();
        const userList = roomSockets.map(s => s.username).filter(Boolean);
        io.to(room).emit('userList', userList);
        socket.to(room).emit('callEnded'); // Notify others if in call
      }
    }
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, fileType: req.file.mimetype });
});

const PORT = process.env.PORT || 5000; // Align with Render
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});