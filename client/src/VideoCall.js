import React, { useState, useEffect, useRef, useCallback } from 'react';
import './VideoCall.css';

const VideoCall = ({ socket, room, userId, username, inCall, setInCall, callType }) => {
  const [error, setError] = useState('');
  const [videos, setVideos] = useState([]); // [{ userId, videoElement, stream, username }]
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(callType === 'video');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const myStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // { userId: RTCPeerConnection }
  const videoGridRef = useRef(null);
  const callContainerRef = useRef(null);
  const connectedUsersRef = useRef(new Set());

  // Memoized peer connection creation
  const createPeerConnection = useCallback(
    (otherUserId) => {
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ],
      });
      peerConnectionsRef.current[otherUserId] = peerConnection;

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', { candidate: event.candidate, target: otherUserId, room });
          console.log(`Sent ICE candidate to ${otherUserId}`);
        }
      };

      peerConnection.ontrack = (event) => {
        if (callType === 'voice' && event.track.kind === 'video') {
          event.track.stop(); // Discard video tracks in voice call
          return;
        }
        console.log(`Received ${event.track.kind} stream from ${otherUserId}`, {
          streamId: event.streams[0].id,
          tracks: event.streams[0].getTracks().map((t) => t.kind),
        });
        setVideos((prev) => {
          if (prev.find((v) => v.userId === otherUserId)) return prev;
          const element = callType === 'video' ? document.createElement('video') : document.createElement('audio');
          element.srcObject = event.streams[0];
          element.autoplay = true;
          element.playsInline = true;
          if (callType === 'video') element.muted = otherUserId === userId;
          return [
            ...prev,
            { userId: otherUserId, videoElement: element, stream: event.streams[0], username: `User-${otherUserId}` },
          ];
        });
      };

      if (myStreamRef.current) {
        myStreamRef.current.getTracks().forEach((track) => {
          if (callType === 'voice' && track.kind === 'video') return; // Skip video tracks
          peerConnection.addTrack(track, myStreamRef.current);
          console.log(`Added track: ${track.kind}`);
        });
      }
      console.log(`Created peer connection for ${otherUserId}`);
      return peerConnection;
    },
    [socket, room, userId, callType]
  );

  // Memoized connect to new user
  const connectToNewUser = useCallback(
    async (otherUserId) => {
      if (otherUserId === userId || connectedUsersRef.current.has(otherUserId)) {
        console.log(`Skipping connection to ${otherUserId} (self or already connected)`);
        return;
      }
      console.log(`Connecting to new user ${otherUserId}`);
      connectedUsersRef.current.add(otherUserId);

      if (!peerConnectionsRef.current[otherUserId]) {
        const peerConnection = createPeerConnection(otherUserId);
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit('offer', { offer, target: otherUserId, room });
          console.log(`Sent offer to ${otherUserId}`);
        } catch (error) {
          console.error(`Error creating offer for ${otherUserId}:`, error);
          setError('Failed to create offer');
          connectedUsersRef.current.delete(otherUserId);
        }
      }
    },
    [createPeerConnection, socket, room, userId]
  );

  // Memoized end call
  const endCall = useCallback(() => {
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    peerConnectionsRef.current = {};
    setVideos([]);
    setInCall(false);
    setIsFullScreen(false);
    connectedUsersRef.current.clear();
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach((track) => track.stop());
      myStreamRef.current = null;
    }
    socket.emit('end-video-call', { room });
    console.log('Call ended');
  }, [socket, room, setInCall]);

  // Handle media stream and socket events
  useEffect(() => {
    console.log('VideoCall useEffect triggered', { inCall, userId, callType });
    if (!inCall || !socket || !userId) {
      if (myStreamRef.current) {
        myStreamRef.current.getTracks().forEach((track) => track.stop());
        myStreamRef.current = null;
      }
      setVideos([]);
      connectedUsersRef.current.clear();
      return () => {};
    }

    const getMediaStream = async () => {
      if (myStreamRef.current) {
        console.log('Stream already exists, skipping getMediaStream');
        return;
      }
      try {
        const constraints = { video: callType === 'video', audio: true };
        console.log('getMediaStream constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        myStreamRef.current = stream;
        if (callType === 'voice') {
          stream.getVideoTracks().forEach((track) => track.stop()); // Ensure no video tracks
        }
        const element = callType === 'video' ? document.createElement('video') : document.createElement('audio');
        element.srcObject = stream;
        element.autoplay = true;
        element.playsInline = true;
        element.muted = true; // Mute local stream
        setVideos((prev) => {
          if (prev.find((v) => v.userId === userId)) return prev;
          return [{ userId, videoElement: element, stream, username }, ...prev];
        });
        console.log(`${callType === 'video' ? 'Video' : 'Audio'} stream obtained`, {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length,
        });
        socket.emit('join-video-call', { room, username });
      } catch (err) {
        console.error('Media error:', err);
        setError(`Media error: ${err.message}. Trying audio-only...`);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          myStreamRef.current = audioStream;
          const element = document.createElement('audio');
          element.srcObject = audioStream;
          element.autoplay = true;
          element.playsInline = true;
          element.muted = true;
          setVideos((prev) => {
            if (prev.find((v) => v.userId === userId)) return prev;
            return [{ userId, videoElement: element, stream: audioStream, username }, ...prev];
          });
          console.log('Audio-only stream obtained', {
            videoTracks: audioStream.getVideoTracks().length,
            videoTracks: audioStream.getVideoTracks().length,
          });
          socket.emit('join-video-call', { room, username });
        } catch (audioErr) {
          setError(`Audio error: ${audioErr.message}. Please check your devices.`);
          console.error('Audio error:', audioErr);
        }
      }
    };

    getMediaStream();

    const handleUserConnected = (otherUserId) => {
      if (otherUserId === userId || connectedUsersRef.current.has(otherUserId)) {
        console.log(`Ignoring user-connected for ${otherUserId} (self or already connected)`);
        return;
      }
      console.log(`User connected: ${otherUserId}`);
      if (myStreamRef.current && userId > otherUserId) {
        connectToNewUser(otherUserId);
      }
    };

    const handleUserDisconnected = (otherUserId) => {
      console.log(`User disconnected: ${otherUserId}`);
      if (peerConnectionsRef.current[otherUserId]) {
        peerConnectionsRef.current[otherUserId].close();
        delete peerConnectionsRef.current[otherUserId];
      }
      setVideos((prev) => prev.filter((v) => v.userId !== otherUserId));
      connectedUsersRef.current.delete(otherUserId);
    };

    const handleOffer = async ({ offer, sender }) => {
      console.log(`Received offer from ${sender}`);
      if (!peerConnectionsRef.current[sender]) {
        const peerConnection = createPeerConnection(sender);
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit('answer', { answer, target: sender, room });
          console.log(`Sent answer to ${sender}`);
        } catch (error) {
          console.error(`Error handling offer from ${sender}:`, error);
          setError('Failed to process offer');
        }
      }
    };

    const handleAnswer = async ({ answer, sender }) => {
      console.log(`Received answer from ${sender}`);
      const peerConnection = peerConnectionsRef.current[sender];
      if (peerConnection) {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
          console.error(`Error setting answer from ${sender}:`, error);
          setError('Failed to process answer');
        }
      }
    };

    const handleIceCandidate = async ({ candidate, sender }) => {
      console.log(`Received ICE candidate from ${sender}`);
      const peerConnection = peerConnectionsRef.current[sender];
      if (peerConnection && candidate) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error(`Error adding ICE candidate from ${sender}:`, error);
        }
      }
    };

    socket.on('room-full', (message) => {
      setError(message);
      console.log(message);
      endCall();
    });
    socket.on('user-connected', handleUserConnected);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('callEnded', () => {
      console.log('Call ended by another user');
      endCall();
    });

    return () => {
      socket.off('room-full');
      socket.off('user-connected', handleUserConnected);
      socket.off('user-disconnected', handleUserDisconnected);
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('callEnded');
    };
  }, [inCall, socket, userId, room, username, callType, connectToNewUser, createPeerConnection, endCall, setInCall]);

  const toggleMute = () => {
    if (myStreamRef.current) {
      const audioTrack = myStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (callType === 'voice') return; // Disable for voice calls
    if (myStreamRef.current) {
      const videoTrack = myStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(!videoTrack.enabled);
      }
    }
  };

  const toggleFullScreen = () => {
    if (callType === 'voice') return; // Disable for voice calls
    if (!isFullScreen) {
      if (callContainerRef.current.requestFullscreen) {
        callContainerRef.current.requestFullscreen();
      } else if (callContainerRef.current.webkitRequestFullscreen) {
        callContainerRef.current.webkitRequestFullscreen();
      }
      setIsFullScreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      setIsFullScreen(false);
    }
  };

  useEffect(() => {
    if (videoGridRef.current) {
      videoGridRef.current.innerHTML = '';
      videos.forEach(({ videoElement, username }) => {
        const container = document.createElement('div');
        container.className = 'video-wrapper';
        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = username;
        container.appendChild(videoElement);
        container.appendChild(label);
        if (callType === 'voice') {
          const audioIcon = document.createElement('div');
          audioIcon.className = 'audio-icon';
          audioIcon.textContent = '🎙️';
          container.appendChild(audioIcon);
        }
        videoGridRef.current.appendChild(container);
      });
    }
  }, [videos, callType]);

  return (
    <div className={`video-call-container ${inCall ? 'active' : ''}`} ref={callContainerRef}>
      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError('')} className="dismiss-error-btn">
            Dismiss
          </button>
        </div>
      )}
      <div className="video-grid" ref={videoGridRef}></div>
      {inCall && (
        <div className="call-controls">
          <button onClick={endCall} className="end-call-btn animate-btn">
            End Call
          </button>
          <button onClick={toggleMute} className="mute-btn animate-btn">
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          {callType === 'video' && (
            <>
              <button onClick={toggleVideo} className="video-btn animate-btn">
                {isVideoOn ? 'Video Off' : 'Video On'}
              </button>
              <button onClick={toggleFullScreen} className="fullscreen-btn animate-btn">
                {isFullScreen ? 'Exit Full Screen' : 'Full Screen'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoCall;