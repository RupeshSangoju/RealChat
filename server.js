const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // Allow all origins (adjust later)
});


const upload = multer({ dest: 'uploads/' });

app.use(cors({
  origin: 'http://localhost:5000',
  methods: ['GET', 'POST'],
  credentials: true
}));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'chat_app',
  password: 'rupesh', // Replace with your PostgreSQL password
  port: 5432,
});

pool.connect((err) => {
  if (err) console.error('PostgreSQL connection error:', err);
  else console.log('Connected to PostgreSQL');
});

app.use(express.static(path.join(__dirname, 'build')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));
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


server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`Server on port ${process.env.PORT || 3000}`);
}); 