# RealChat

RealChat is a real-time chat application built with **React** (frontend), **Node.js** with **Express** and **Socket.IO** (backend), and **PostgreSQL** (database). It supports text messaging, file and voice message sharing, audio-only voice calls, and profile picture uploads. The application is deployed on **Render** with a PostgreSQL database and persistent file storage. This project is designed for seamless real-time communication without storing chat history on room join.

## Features
- **Real-Time Messaging**: Send and receive text messages, private messages, and files in real-time using Socket.IO.
- **Voice Calls**: Initiate audio-only calls with up to three users per room.
- **Video Calls**: Start video calls with up to three users per room for face-to-face communication.
- **File Sharing**: Upload and share files (e.g., images, voice messages) within chat rooms.
- **No Chat History**: Chat history is cleared every time a user enters a room, ensuring a fresh chat experience.
- **Change Chat Background**: Customize the chat interface background for a personalized user experience.
- **Profile Pictures**: Upload and display user profile pictures, with a fallback to a default image.
- **User Authentication**: Register and log in with username and password (stored securely with bcrypt).
- **Room Management**: Create and join chat rooms dynamically, stored in PostgreSQL.
- **Reactions**: Add emoji reactions to messages.
- **Typing Indicators**: Show when users are typing in a room.

## Project Structure
The project is organized as a monorepo with separate backend and frontend directories:

## Prerequisites
- **Node.js** (v16 or higher)
- **PostgreSQL** (Render-hosted or local)
- **Git**
- **Render** account (for deployment)
- A modern web browser (for testing the frontend)

## Setup Instructions
Follow these steps to set up and run RealChat locally.

### 1. Clone the Repository
git clone https://github.com/your-username/RealChat.git
cd RealChat

### 2. Backend Setup
cd server
npm install 

Run the backend:
npm start

### 3. Frontend Setup
cd client
npm install

Run the frontend:
npm start

### 4.Test Locally

Open http://localhost:3000 in a browser.

Register or log in (e.g., username: user1, password: pass).

Join a room (e.g., 1), send messages, upload a profile picture, and start a voice call.

Verify:
Profile pictures load from http://localhost:5000/Uploads/....

Default profile picture (/default-pic.png) loads if an upload fails.

No chat history is displayed on room join.

Voice and video calls function correctly.

Chat background can be customized via the UI.

## Database Schema
The PostgreSQL database includes three tables:

users: Stores user IDs, usernames, hashed passwords, and creation timestamps.

rooms: Stores room IDs, names, creator IDs, and creation timestamps.

messages: Stores message IDs, room IDs, user IDs, content (text or JSON for files/voice), sent timestamps, and reactions.

The schema is created automatically on backend startup (server.js).

##  Future Improvements

Replace message alerts with a proper chat UI.

Enhance video call quality and support for more users.

Integrate AWS S3 or Cloudinary for scalable file storage.

Add optional chat history persistence.

Implement advanced user profile management (e.g., update username, password, or background preferences).

## Contributing

Fork the repository.

Create a feature branch (git checkout -b feature/your-feature).

Commit changes (git commit -m "Add your feature").

Push to the branch (git push origin feature/your-feature).

Open a Pull Request.

## License

This project is licensed under the MIT License.

## Contact

For questions or support, contact [rupeshbabu.sangoju@gmail.com] or open an issue on GitHub.


