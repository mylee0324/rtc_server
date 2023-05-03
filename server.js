const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const twilio = require('twilio');

const PORT = process.env.PORT || 5002;

const app = express();

const server = http.createServer(app);

app.use(cors());

let connectedUsers = [];
let rooms = [];

// create route to check if room exists
app.get('/api/room-exists/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.find((room) => room.id === roomId);

  if (room) {
    // send yes
    if (room.connectedUsers.length > 3) {
      return res.send({ roomExists: true, full: true });
    } else {
      return res.send({ roomExists: true, full: false });
    }
  } else {
    // send no
    return res.send({ roomExists: false });
  }
});

// create route to check if room exists
app.get('/api/get-turn-credentials', (req, res) => {
  const accountSid = '';
  const authToken = '';

  const client = twilio(accountSid, authToken);

  let responseToken = null;

  try {
    client.tokens.create().then((token) => {
      responseToken = token;
      res.send({ token });
    });
  } catch (error) {
    console.log('error in turn server credential');
    console.log(error);
    res.send({ token: null });
  }
});

const io = require('socket.io')(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`user connected ${socket.id}`);

  socket.on('create-new-room', (data) => {
    createNewRoomHandler(data, socket);
  });

  socket.on('join-room', (data) => {
    joinRoomHandler(data, socket);
  });

  socket.on('disconnect', () => {
    disconnectHandler(socket);
  });

  socket.on('conn-signal', (data) => {
    signalingHandler(data, socket);
  });

  socket.on('conn-init', (data) => {
    initializeConnectionHandler(data, socket);
  });

  socket.on('direct-message', (data) => {
    directMessageHandler(data, socket);
  });
});

// socket.io handlers

const createNewRoomHandler = (data, socket) => {
  console.log('host is creating new room');
  console.log(data);

  const { identity, onlyAudio } = data;

  const roomId = uuidv4();

  // create new user
  const newUser = { identity, id: uuidv4(), socketId: socket.id, roomId, onlyAudio };

  // push that user to connectedUsers
  connectedUsers = [...connectedUsers, newUser];

  // create new room
  const newRoom = { id: roomId, connectedUsers: [newUser] };

  // join socket.io room
  socket.join(roomId);

  rooms = [...rooms, newRoom];

  // emit roomId back to him
  socket.emit('room-id', { roomId });

  // emit an event to all users connected to that room about new users
  socket.emit('room-update', { connectedUsers: newRoom.connectedUsers });
};

const joinRoomHandler = (data, socket) => {
  const { identity, roomId, onlyAudio } = data;

  // create new user
  const newUser = { identity, id: uuidv4(), socketId: socket.id, roomId, onlyAudio };

  // join room as user (room id)
  const room = rooms.find((room) => room.id === roomId);
  room.connectedUsers = [...room.connectedUsers, newUser];

  // join socket.io room
  socket.join(roomId);

  // add new user
  connectedUsers = [...connectedUsers, newUser];

  // WebRTC : ask Prepare
  room.connectedUsers.forEach((user) => {
    if (user.socketId !== socket.id) {
      const data = { connUserSocketId: socket.id };
      io.to(user.socketId).emit('conn-prepare', data);
    }
  });

  io.to(roomId).emit('room-update', { connectedUsers: room.connectedUsers });
};

const disconnectHandler = (socket) => {
  // find if user has been registered -> remove from room and users
  const user = connectedUsers.find((user) => user.socketId === socket.id);

  if (user) {
    // remove from room
    const room = rooms.find((room) => room.id === user.roomId);

    room.connectedUsers = room.connectedUsers.filter(
      (user) => user.socketId !== socket.id
    );

    // leave socket io
    socket.leave(user.roomId);

    // notify or close room
    if (room.connectedUsers.length > 0) {
      // emit event (user disconnected)
      io.to(room.id).emit('user-disconnected', { socketId: socket.id });
      // emit event (room update)
      io.to(room.id).emit('room-update', { connectedUsers: room.connectedUsers });
    } else {
      // close when 0
      rooms = rooms.filter((r) => r.id !== room.id);
    }
  }
};

const signalingHandler = (data, socket) => {
  const { connUserSocketId, signal } = data;

  const signalingData = { signal, connUserSocketId: socket.id };
  io.to(connUserSocketId).emit('conn-signal', signalingData);
};

// information from clients who are already in room that they prepared for incomming connection
const initializeConnectionHandler = (data, socket) => {
  const { connUserSocketId } = data;

  const initData = { connUserSocketId: socket.id };
  io.to(connUserSocketId).emit('conn-init', initData);
};

const directMessageHandler = (data, socket) => {
  if (connectedUsers.find((connUser) => connUser.socketId === data.receiverSocketId)) {
    const receiverData = {
      authorSocketId: socket.id,
      messageContent: data.messageContent,
      isAuthor: false,
      identity: data.identity,
    };

    socket.to(data.receiverSocketId).emit('direct-message', receiverData);

    const authorData = {
      receiverSocketId: data.receiverSocketId,
      messageContent: data.messageContent,
      isAuthor: true,
      identity: data.identity,
    };

    socket.emit('direct-message', authorData);
  }
};

server.listen(PORT, () => {
  console.log(`Server is listening on ${PORT}`);
});
