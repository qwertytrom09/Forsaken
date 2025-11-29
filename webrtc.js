import './firebase.js';

const db = window.firebaseDB;
const ref = window.firebaseRef;
const set = window.firebaseSet;
const onValue = window.firebaseOnValue;
const update = window.firebaseUpdate;
const remove = window.firebaseRemove;

class WebRTCMultiplayer {
  constructor(playerId, onPlayerUpdate, onPlayerLeave, onPlayerJoin) {
    this.playerId = playerId;
    this.peers = new Map(); // peerId -> {pc, dc, connected}
    this.onPlayerUpdate = onPlayerUpdate;
    this.onPlayerLeave = onPlayerLeave;
    this.onPlayerJoin = onPlayerJoin;
    this.roomId = 'game_room'; // Simple room for all players
    this.isHost = false;
    this.hostId = null;
    this.connected = false;

    this.initSignaling();
  }

  initSignaling() {
    // Listen for room changes
    const roomRef = ref(db, `rooms/${this.roomId}`);
    onValue(roomRef, (snapshot) => {
      const roomData = snapshot.val() || {};
      this.updateRoom(roomData);
    });

    // Join room
    this.joinRoom();
  }

  joinRoom() {
    const roomRef = ref(db, `rooms/${this.roomId}/players/${this.playerId}`);
    set(roomRef, {
      id: this.playerId,
      joined: Date.now(),
      connected: true
    });

    // Listen for offers
    const offersRef = ref(db, `rooms/${this.roomId}/offers/${this.playerId}`);
    onValue(offersRef, (snapshot) => {
      const offers = snapshot.val() || {};
      Object.entries(offers).forEach(([fromId, offer]) => {
        if (fromId !== this.playerId && !this.peers.has(fromId)) {
          this.handleOffer(fromId, offer);
        }
      });
    });

    // Listen for answers
    const answersRef = ref(db, `rooms/${this.roomId}/answers/${this.playerId}`);
    onValue(answersRef, (snapshot) => {
      const answers = snapshot.val() || {};
      Object.entries(answers).forEach(([fromId, answer]) => {
        this.handleAnswer(fromId, answer);
      });
    });

    // Listen for ICE candidates
    const iceRef = ref(db, `rooms/${this.roomId}/ice/${this.playerId}`);
    onValue(iceRef, (snapshot) => {
      const iceCandidates = snapshot.val() || {};
      Object.entries(iceCandidates).forEach(([fromId, candidates]) => {
        Object.values(candidates).forEach(candidate => {
          this.handleIceCandidate(fromId, candidate);
        });
      });
    });
  }

  updateRoom(roomData) {
    const players = roomData.players || {};
    const playerIds = Object.keys(players);

    console.log('Room update, players:', playerIds);

    // Find host (oldest player)
    this.hostId = playerIds.sort((a, b) => players[a].joined - players[b].joined)[0];
    this.isHost = this.hostId === this.playerId;

    // Connect to existing players
    playerIds.forEach(peerId => {
      if (peerId !== this.playerId && !this.peers.has(peerId) && players[peerId].connected) {
        if (this.isHost || peerId < this.playerId) { // Simple ordering to avoid duplicate connections
          console.log('Connecting to peer:', peerId);
          this.createPeerConnection(peerId);
        }
      }
    });

    // Remove disconnected players
    this.peers.forEach((peer, peerId) => {
      if (!players[peerId] || !players[peerId].connected) {
        this.removePeer(peerId);
      }
    });
  }

  createPeerConnection(peerId) {
    console.log('Creating connection to', peerId);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    const dc = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
    this.setupDataChannel(peerId, dc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIceCandidate(peerId, event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state with', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'connected') {
        this.peers.get(peerId).connected = true;
        this.connected = true;
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.removePeer(peerId);
      }
    };

    pc.ondatachannel = (event) => {
      if (event.channel.label === 'game') {
        this.setupDataChannel(peerId, event.channel);
      }
    };

    this.peers.set(peerId, { pc, dc, connected: false });

    if (this.isHost || peerId < this.playerId) {
      this.createOffer(peerId);
    }
  }

  setupDataChannel(peerId, dc) {
    dc.onopen = () => {
      console.log('Data channel open with', peerId);
      this.peers.get(peerId).connected = true;
      this.connected = true;
      if (this.onPlayerJoin) {
        this.onPlayerJoin(peerId);
      }
    };

    dc.onclose = () => {
      console.log('Data channel closed with', peerId);
      this.removePeer(peerId);
    };

    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'player_update') {
          this.onPlayerUpdate(peerId, data);
        } else if (data.type === 'emote') {
          // Handle emote if needed
        }
      } catch (e) {
        console.error('Error parsing WebRTC message:', e);
      }
    };

    this.peers.get(peerId).dc = dc;
  }

  createOffer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.pc.createOffer()
      .then(offer => peer.pc.setLocalDescription(offer))
      .then(() => {
        const offersRef = ref(db, `rooms/${this.roomId}/offers/${peerId}/${this.playerId}`);
        set(offersRef, {
          offer: peer.pc.localDescription,
          from: this.playerId,
          timestamp: Date.now()
        });
      })
      .catch(error => console.error('Error creating offer:', error));
  }

  handleOffer(fromId, offerData) {
    if (!offerData.offer) return;

    this.createPeerConnection(fromId);
    const peer = this.peers.get(fromId);

    peer.pc.setRemoteDescription(new RTCSessionDescription(offerData.offer))
      .then(() => peer.pc.createAnswer())
      .then(answer => peer.pc.setLocalDescription(answer))
      .then(() => {
        const answersRef = ref(db, `rooms/${this.roomId}/answers/${fromId}/${this.playerId}`);
        set(answersRef, {
          answer: peer.pc.localDescription,
          from: this.playerId,
          timestamp: Date.now()
        });
      })
      .catch(error => console.error('Error handling offer:', error));
  }

  handleAnswer(fromId, answerData) {
    if (!answerData.answer) return;

    const peer = this.peers.get(fromId);
    if (peer) {
      peer.pc.setRemoteDescription(new RTCSessionDescription(answerData.answer))
        .catch(error => console.error('Error setting remote description:', error));
    }
  }

  sendIceCandidate(peerId, candidate) {
    const iceRef = ref(db, `rooms/${this.roomId}/ice/${peerId}/${this.playerId}/${Date.now()}`);
    set(iceRef, {
      candidate: candidate,
      from: this.playerId
    });
  }

  handleIceCandidate(fromId, candidateData) {
    const peer = this.peers.get(fromId);
    if (peer && candidateData.candidate) {
      peer.pc.addIceCandidate(new RTCIceCandidate(candidateData.candidate))
        .catch(error => console.error('Error adding ICE candidate:', error));
    }
  }

  sendPlayerUpdate(data) {
    if (!this.connected) return;

    const message = JSON.stringify({
      type: 'player_update',
      id: this.playerId,
      ...data,
      timestamp: Date.now()
    });

    this.peers.forEach(peer => {
      if (peer.connected && peer.dc && peer.dc.readyState === 'open') {
        peer.dc.send(message);
      }
    });
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      if (peer.dc) peer.dc.close();
      if (peer.pc) peer.pc.close();
      this.peers.delete(peerId);
      this.onPlayerLeave(peerId);
    }
  }

  disconnect() {
    // Remove from room
    const playerRef = ref(db, `rooms/${this.roomId}/players/${this.playerId}`);
    remove(playerRef);

    // Close all connections
    this.peers.forEach((peer, peerId) => {
      this.removePeer(peerId);
    });
  }
}

export { WebRTCMultiplayer };
