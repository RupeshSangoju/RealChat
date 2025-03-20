import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import './App.css';

const socket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000', {
  autoConnect: true,
  withCredentials: true, // Add this if backend requires credentials
});

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
  const [callType, setCallType] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [peers, setPeers] = useState([]);
  const [profilePic, setProfilePic] = useState(null);
  const videoRef = useRef(null);
  const peersRef = useRef([]);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    console.log('Setting up socket listeners');
    socket.on('connect', () => console.log('Connected to server'));
    socket.on('registered', ({ userId, username: registeredUsername }) => {
      setIsAuthenticated(true);
      setUsername(registeredUsername);
    });
    socket.on('loggedIn', ({ userId, username: loggedInUsername }) => {
      setIsAuthenticated(true);
      setUsername(loggedInUsername);
    });
    socket.on('message', (msg) => setMessages((prev) => [...prev, msg]));
    socket.on('file', (fileData) => setMessages((prev) => [...prev, fileData]));
    socket.on('typing', ({ username, isTyping }) => {
      setTypingUsers((prev) =>
        isTyping ? [...prev, username] : prev.filter((u) => u !== username)
      );
    });
    socket.on('error', (msg) => alert(msg));
    socket.on('messageHistory', (history) => setMessages(history));
    socket.on('reaction', ({ messageId, emoji, username }) => {
      setReactions((prev) => ({
        ...prev,
        [messageId]: [...(prev[messageId] || []), { emoji, username }],
      }));
    });
    socket.on('userList', (userList) => setUsers(userList));
    socket.on('privateMessage', (msg) => {
      setMessages((prev) => [...prev, { ...msg, isPrivate: true }]);
    });
    socket.on('notification', ({ sender, message }) => {
      alert(`${sender} mentioned you: ${message}`);
    });
    socket.on('voiceMessage', (data) => {
      setMessages((prev) => [...prev, data]);
    });
    socket.on('incomingCall', ({ callType, initiator, socketId }) => {
      if (window.confirm(`${initiator} started a ${callType} call. Join?`)) {
        socket.emit('acceptCall', { room, callerSocketId: socketId, username });
        joinCall(callType, socketId);
      } else {
        socket.emit('rejectCall', { room, callerSocketId: socketId, username });
      }
    });
    socket.on('callAccepted', ({ acceptor, socketId }) => {
      const peer = addPeer(socketId, true);
      peersRef.current.push({ peerId: socketId, peer, username: acceptor });
      setPeers((prev) => [...prev, { peerId: socketId, peer, username: acceptor }]);
    });
    socket.on('callRejected', ({ rejector }) => alert(`${rejector} rejected the call`));
    socket.on('signal', ({ signal, fromSocketId }) => {
      const peerData = peersRef.current.find((p) => p.peerId === fromSocketId);
      if (peerData) peerData.peer.signal(signal);
    });
    socket.on('callEnded', () => endCall());

    return () => {
      socket.off('connect');
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
      socket.off('notification');
      socket.off('voiceMessage');
      socket.on('incomingCall');
      socket.off('callAccepted');
      socket.off('callRejected');
      socket.off('signal');
      socket.off('callEnded');
    };
  }, [room]);

  const register = () => {
    if (username && password) socket.emit('register', { username, password });
  };

  const login = () => {
    if (username && password) socket.emit('login', { username, password });
  };

  const joinRoom = () => {
    if (room) {
      socket.emit('joinRoom', room);
      setJoined(true);
    }
  };

  const sendMessage = () => {
    if (message && room) {
      if (privateRecipient) {
        socket.emit('privateMessage', { toUsername: privateRecipient, message, fromUsername: username });
      } else {
        socket.emit('chatMessage', { room, message, username });
      }
      setMessage('');
      socket.emit('typing', { room, username, isTyping: false });
    }
  };

  const handleTyping = (e) => {
    setMessage(e.target.value);
    socket.emit('typing', { room, username, isTyping: e.target.value.length > 0 });
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
        socket.emit('file', { room, fileUrl, fileType, sender: username });
        setFile(null);
        setShowOptions(false);
      } catch (error) {
        console.error('File upload failed:', error);
        alert('Failed to upload file: ' + error.message);
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

  const handleProfilePic = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setProfilePic(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const addReaction = (messageId, emoji) => {
    socket.emit('react', { room, messageId, emoji, username });
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
      alert('Could not access microphone');
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
          socket.emit('voiceMessage', { room, fileUrl, fileType: 'audio/webm', sender: username });
          setAudioBlob(null);
          setShowOptions(false);
        })
        .catch((error) => {
          console.error('Voice message upload failed:', error);
          alert('Failed to send voice message');
        });
    }
  };

  const startCall = async (type) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true,
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCallType(type);
      setInCall(true);
      socket.emit('startCall', { room, callType: type, username });
      setShowOptions(false);
    } catch (error) {
      console.error('Failed to start call:', error);
      alert('Could not access camera/microphone: ' + error.message);
      setInCall(false);
    }
  };

  const joinCall = async (type, callerSocketId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true,
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCallType(type);
      setInCall(true);
      const peer = addPeer(callerSocketId, false, stream);
      peersRef.current.push({ peerId: callerSocketId, peer, username });
      setPeers((prev) => [...prev, { peerId: callerSocketId, peer, username }]);
    } catch (error) {
      console.error('Failed to join call:', error);
      alert('Could not access camera/microphone: ' + error.message);
      setInCall(false);
    }
  };

  const addPeer = (peerSocketId, initiator, stream) => {
    const peer = new Peer({
      initiator,
      trickle: false,
      stream: stream || videoRef.current.srcObject,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    });
    peer.on('signal', (signal) => {
      socket.emit('signal', { toSocketId: peerSocketId, signal });
    });
    peer.on('stream', (remoteStream) => {
      setPeers((prev) => {
        if (!prev.some((p) => p.peerId === peerSocketId)) {
          return [...prev, { peerId: peerSocketId, peer, stream: remoteStream, username: peerSocketId }];
        }
        return prev;
      });
    });
    peer.on('error', (err) => console.error('Peer error:', err));
    return peer;
  };

  const endCall = () => {
    if (!inCall) return;
    peersRef.current.forEach((p) => p.peer && p.peer.destroy());
    peersRef.current = [];
    setPeers([]);
    setInCall(false);
    setCallType(null);
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    socket.emit('endCall', { room });
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
    <div className={`app-container ${theme}`} style={{ backgroundImage: wallpaper ? `url(${wallpaper})` : 'none', backgroundSize: 'cover' }}>
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
                {profilePic && user === username ? (
                  <img src={profilePic} alt="Profile" className="profile-pic" />
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
                <button onClick={() => startCall('voice')} className="call-btn animate-btn">Voice Call</button>
                <button onClick={() => startCall('video')} className="call-btn animate-btn">Video Call</button>
                {inCall && <button onClick={endCall} className="end-call-btn animate-btn">End Call</button>}
                <button onClick={isRecording ? stopRecording : startRecording} className="record-btn animate-btn">
                  {isRecording ? 'Stop Recording' : 'Record Voice'}
                </button>
                {audioBlob && (
                  <button onClick={sendVoiceMessage} className="send-voice-btn animate-btn">Send Voice Message</button>
                )}
              </div>
            )}
          </div>
          <div className="video-container">
            <video ref={videoRef} muted className={`local-video ${inCall ? 'visible' : ''}`} />
            {peers.map((peer) => (
              <video
                key={peer.peerId}
                autoPlay
                ref={(video) => video && (video.srcObject = peer.stream)}
                className="peer-video"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;