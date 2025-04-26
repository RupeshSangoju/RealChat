import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import VideoCall from './VideoCall';
import './App.css';

function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [room, setRoom] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [joined, setJoined] = useState(false);
  const [file, setFile] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [typingUsers, setTypingUsers] = useState([]);
  const [theme, setTheme] = useState('default');
  const [wallpaper, setWallpaper] = useState('');
  const [reactions, setReactions] = useState({});
  const [users, setUsers] = useState([]);
  const [privateRecipient, setPrivateRecipient] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [showWallpaperOptions, setShowWallpaperOptions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [callNotification, setCallNotification] = useState(null);
  const [profilePics, setProfilePics] = useState({});
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState(''); // Added for socket errors
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  // Initialize socket and set up listeners
  useEffect(() => {
    if (socketRef.current) return;

    const socket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: true,
    });
    socketRef.current = socket;

    console.log('Setting up socket listeners');
    socket.on('connect', () => {
      console.log('Connected to server');
      setError('');
    });
    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      setError('Failed to connect to server. Please check if the server is running.');
    });
    socket.on('registered', ({ userId, username: registeredUsername }) => {
      setIsAuthenticated(true);
      setUsername(registeredUsername);
      setUserId(userId);
      setError('');
    });
    socket.on('loggedIn', ({ userId, username: loggedInUsername }) => {
      setIsAuthenticated(true);
      setUsername(loggedInUsername);
      setUserId(userId);
      setError('');
    });
    socket.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    socket.on('file', (fileData) => {
      setMessages((prev) => [...prev, fileData]);
    });
    socket.on('typing', ({ username, isTyping }) => {
      setTypingUsers((prev) =>
        isTyping ? [...new Set([...prev, username])] : prev.filter((u) => u !== username)
      );
    });
    socket.on('error', (msg) => {
      setError(msg);
    });
    socket.on('messageHistory', (history) => {
      setMessages(history);
    });
    socket.on('reaction', ({ messageId, emoji, username }) => {
      setReactions((prev) => ({
        ...prev,
        [messageId]: [...(prev[messageId] || []), { emoji, username }],
      }));
    });
    socket.on('userList', (userList) => {
      setUsers(userList);
    });
    socket.on('privateMessage', (msg) => {
      setMessages((prev) => [...prev, { ...msg, isPrivate: true }]);
    });
    socket.on('voiceMessage', (data) => {
      setMessages((prev) => [...prev, data]);
    });
    socket.on('call-notification', ({ initiator, callType }) => {
      setCallNotification({ initiator, callType });
    });
    socket.on('profile-pic-update', ({ username, profilePicUrl }) => {
      console.log('Received profile pic update:', { username, profilePicUrl });
      setProfilePics((prev) => ({ ...prev, [username]: profilePicUrl }));
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('registered');
      socket.off('loggedIn');
      socket.off('message');
      socket.off('file');
      socket.off('typing');
      socket.off('error');
      socket.off('messageHistory');
      socket.off('reaction');
      socket.off('userList');
      socket.off('privateMessage');
      socket.off('voiceMessage');
      socket.off('call-notification');
      socket.off('profile-pic-update');
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const register = () => {
    if (username && password) {
      socketRef.current.emit('register', { username, password });
    } else {
      setError('Please enter username and password');
    }
  };

  const login = () => {
    if (username && password) {
      socketRef.current.emit('login', { username, password });
    } else {
      setError('Please enter username and password');
    }
  };

  const joinRoom = () => {
    if (room) {
      socketRef.current.emit('joinRoom', room);
      setJoined(true);
    } else {
      setError('Please enter a room name');
    }
  };

  const sendMessage = () => {
    if (message && room) {
      if (privateRecipient) {
        socketRef.current.emit('privateMessage', { toUsername: privateRecipient, message, fromUsername: username });
      } else {
        socketRef.current.emit('chatMessage', { room, message, username });
      }
      setMessage('');
      socketRef.current.emit('typing', { room, username, isTyping: false });
    }
  };

  const handleTyping = (e) => {
    setMessage(e.target.value);
    socketRef.current.emit('typing', { room, username, isTyping: e.target.value.length > 0 });
  };

  const sendFile = async () => {
    if (file && room) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
        const response = await fetch(`${backendUrl}/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) throw new Error(`Upload failed with status: ${response.status}`);
        const { fileUrl, fileType } = await response.json();
        socketRef.current.emit('file', { room, fileUrl, fileType, sender: username });
        setFile(null);
        setShowOptions(false);
      } catch (error) {
        console.error('File upload failed:', error);
        setError('Failed to upload file: ' + error.message);
      }
    }
  };

  const handleWallpaperChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setWallpaper(reader.result);
      reader.readAsDataURL(file);
      setShowWallpaperOptions(false);
    }
  };

  const handleProfilePic = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      try {
        const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
        const response = await fetch(`${backendUrl}/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) throw new Error(`Upload failed with status: ${response.status}`);
        const { fileUrl } = await response.json();
        console.log('Profile pic uploaded:', { fileUrl });
        setProfilePics((prev) => ({ ...prev, [username]: fileUrl }));
        socketRef.current.emit('profile-pic-update', { room, username, profilePicUrl: fileUrl });
      } catch (error) {
        console.error('Profile pic upload failed:', error);
        setError('Failed to upload profile picture: ' + error.message);
      }
    }
  };

  const addReaction = (messageId, emoji) => {
    socketRef.current.emit('react', { room, messageId, emoji, username });
  };

  const startRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(audioStream);
      const chunks = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        audioStream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setError('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendVoiceMessage = () => {
    if (audioBlob && room) {
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice-message.webm');
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
      fetch(`${backendUrl}/upload`, {
        method: 'POST',
        body: formData,
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Upload failed with status: ${response.status}`);
          return response.json();
        })
        .then(({ fileUrl, fileType }) => {
          socketRef.current.emit('voiceMessage', { room, fileUrl, fileType: 'audio/webm', sender: username });
          setAudioBlob(null);
          setShowOptions(false);
        })
        .catch((error) => {
          console.error('Voice message upload failed:', error);
          setError('Failed to send voice message');
        });
    }
  };

  const handleJoinCall = () => {
    setInCall(true);
    setCallNotification(null);
  };

  const handleDismissCall = () => {
    setCallNotification(null);
  };

  const renderMessage = (msg, index) => {
    const isSender = msg.sender === username;
    const messageId = msg.messageId || index;
    return (
      <div
        key={index}
        className={`message ${isSender ? 'message-sender' : 'message-other'} animate-message ${msg.isPrivate ? 'private' : ''}`}
      >
        {msg.text ? (
          <>
            <span className="username">{msg.isPrivate ? '[Private] ' : ''}{msg.sender}</span>: {msg.text}
            {msg.timestamp && <span className="timestamp"> ({new Date(msg.timestamp).toLocaleTimeString()})</span>}
            <div className="reactions">
              <span className="emoji-trigger">😊</span>
              <div className="emoji-dropdown">
                {['😊', '👍', '😂', '❤️', '😢', '😡', '🎉', '👏', '🤓', '🙏'].map((emoji) => (
                  <button key={emoji} onClick={() => addReaction(messageId, emoji)} className="reaction-btn">
                    {emoji}
                  </button>
                ))}
              </div>
              {(reactions[messageId] || []).map((r, i) => (
                <span key={i}>{r.emoji} ({r.username})</span>
              ))}
            </div>
          </>
        ) : msg.fileType === 'audio/webm' ? (
          <>
            <span className="username">{msg.sender}</span> sent a voice message:
            <audio controls src={msg.fileUrl} className="shared-media" />
          </>
        ) : msg.fileType?.startsWith('image/') ? (
          <>
            <span className="username">{msg.sender}</span> shared an image:
            <img src={msg.fileUrl} alt="Shared" className="shared-media" />
          </>
        ) : msg.fileType?.startsWith('video/') ? (
          <>
            <span className="username">{msg.sender}</span> shared a video:
            <video controls src={msg.fileUrl} className="shared-media" />
          </>
        ) : (
          <>
            <span className="username">{msg.sender}</span> shared a file:
            <a href={msg.fileUrl} download className="file-link">Download File</a>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`app-container ${theme} ${inCall ? 'call-active' : ''}`} style={{ backgroundImage: wallpaper ? `url(${wallpaper})` : 'none', backgroundSize: 'cover' }}>
      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError('')} className="dismiss-error-btn">Dismiss</button>
        </div>
      )}
      {!isAuthenticated ? (
        <div className="login-container animate-page">
          <h1 className="title animate-title">
            {isLoginMode ? 'Login to RealChat' : 'Register for RealChat'}
          </h1>
          <div className="login-inputs">
            <input
              type="text"
              placeholder="Enter Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="login-input animate-input"
            />
            <input
              type="password"
              placeholder="Enter Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-input animate-input"
            />
          </div>
          <div className="button-group">
            <button onClick={isLoginMode ? login : register} className="action-btn animate-btn">
              {isLoginMode ? 'Login' : 'Register'}
            </button>
            <button onClick={() => setIsLoginMode(!isLoginMode)} className="toggle-btn animate-btn">
              Switch to {isLoginMode ? 'Register' : 'Login'}
            </button>
          </div>
        </div>
      ) : !joined ? (
        <div className="join-room animate-page">
          <h1 className="title animate-title">Welcome, {username}</h1>
          <div className="join-inputs">
            <input
              type="text"
              placeholder="Enter Room Name"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className="login-input animate-input"
            />
          </div>
          <div className="button-group">
            <button onClick={joinRoom} className="action-btn animate-btn">Join Room</button>
          </div>
        </div>
      ) : (
        <div className="chat-container animate-page">
          <header className="chat-header animate-header">
            <div className="room-name">Room: {room}</div>
            <div className="header-options">
              <button onClick={() => setShowWallpaperOptions(!showWallpaperOptions)} className="wallpaper-toggle-btn animate-btn">
                Wallpaper
              </button>
              {showWallpaperOptions && (
                <div className="wallpaper-options animate-dropdown">
                  <label className="wallpaper-label animate-btn">
                    <input type="file" accept="image/*" onChange={handleWallpaperChange} className="wallpaper-input" />
                    Choose Wallpaper
                  </label>
                  <select onChange={(e) => setTheme(e.target.value)} value={theme} className="theme-select animate-btn">
                    <option value="default">Default Theme</option>
                    <option value="dark">Dark Mode</option>
                    <option value="light-blue">Light Blue</option>
                  </select>
                </div>
              )}
            </div>
          </header>
          <div className="user-list">
            Online: {users.map((user, i) => (
              <span key={i} className="user">
                {profilePics[user] ? (
                  <img src={profilePics[user]} alt="Profile" className="profile-pic" 
                  onError={(e) => {
                    console.error('Profile pic failed to load:', profilePics[user]);
                    e.target.src = '/default-pic.png'; // Fallback image
                  }}
                  />
                ) : (
                  <span className="default-pic">{user[0]}</span>
                )}
                {user}
              </span>
            ))}
            <label className="profile-pic-label animate-btn">
              <input type="file" accept="image/*" onChange={handleProfilePic} className="profile-pic-input" />
              Set Profile Pic
            </label>
          </div>
          {callNotification && (
            <div className="call-notification animate-notification">
              {callNotification.initiator} started a {callNotification.callType} call
              <button onClick={handleJoinCall} className="join-call-btn animate-btn">Join</button>
              <button onClick={handleDismissCall} className="dismiss-btn animate-btn">Dismiss</button>
            </div>
          )}
          <div className="chat-messages">
            {messages.map((msg, index) => renderMessage(msg, index))}
            {typingUsers.length > 0 && (
              <div className="typing-indicator animate-typing">
                {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </div>
            )}
          </div>
          <div className="chat-input animate-input-bar">
            <input
              type="text"
              placeholder="Type your message..."
              value={message}
              onChange={handleTyping}
              className="message-input"
            />
            <button onClick={sendMessage} className="send-btn animate-btn">Send</button>
            <button onClick={() => setShowOptions(!showOptions)} className="options-btn animate-btn">
              Options
            </button>
            {showOptions && (
              <div className="options-menu animate-dropdown">
                <select
                  onChange={(e) => setPrivateRecipient(e.target.value)}
                  value={privateRecipient}
                  className="user-select animate-btn"
                >
                  <option value="">Send to Public</option>
                  {users.filter((u) => u !== username).map((user, i) => (
                    <option key={i} value={user}>{user}</option>
                  ))}
                </select>
                <label className="file-label animate-btn">
                  <input type="file" onChange={(e) => setFile(e.target.files[0])} className="file-input" />
                  Choose File
                </label>
                <button onClick={sendFile} className="share-btn animate-btn" disabled={!file}>
                  Share File
                </button>
                <button
                  onClick={() => {
                    socketRef.current.emit('start-video-call', { room, username, callType: 'video' });
                    setInCall(true);
                    setShowOptions(false);
                  }}
                  className="call-btn animate-btn"
                >
                  Video Call
                </button>
                <button
                  onClick={() => {
                    socketRef.current.emit('start-video-call', { room, username, callType: 'voice' });
                    setInCall(true);
                    setShowOptions(false);
                  }}
                  className="call-btn animate-btn"
                >
                  Voice Call
                </button>
                <button onClick={isRecording ? stopRecording : startRecording} className="record-btn animate-btn">
                  {isRecording ? 'Stop Recording' : 'Record Voice'}
                </button>
                {audioBlob && (
                  <button onClick={sendVoiceMessage} className="send-voice-btn animate-btn">Send Voice Message</button>
                )}
              </div>
            )}
          </div>
          <VideoCall
            socket={socketRef.current}
            room={room}
            userId={userId}
            username={username}
            inCall={inCall}
            setInCall={setInCall}
            callType={callNotification?.callType || 'video'}
          />
        </div>
      )}
    </div>
  );
}

export default App;