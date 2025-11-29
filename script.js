import './firebase.js';
import { WebRTCMultiplayer } from './webrtc.js';

import * as THREE from "three";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const hud=document.getElementById('hud');
const shiftLockIndicator=document.getElementById('shiftLockIndicator');
const settingsOverlay=document.getElementById('settingsOverlay');
const baseHudMessage='Right-click + drag to rotate camera | WASD to move | Hold Shift to sprint | Press Ctrl for Ctrl Lock';
const hudState={gamepad:false};
let shiftLockEnabled=false;
let fpsCounter=0, fpsDisplay=0;
let isSprinting=false;

// ---------- Settings ----------
const settings = {
  mouseSensitivity: 1,
  gamepadDeadzone: 0.1,
  gamepadSensitivity: 1,
  graphicsQuality: 'medium',
  showFPS: false
};

function updateHud(){
  if(settings.showFPS){
    hud.textContent=`FPS: ${fpsDisplay} | Right-click + drag to rotate camera | WASD to move | Gamepad: ${hudState.gamepad?'✓':'✗'} | Ctrl Lock: ${shiftLockEnabled?'On':'Off'} | Sprint: ${isSprinting?'On':'Off'}`;
  } else {
    hud.textContent=`${baseHudMessage} | Ctrl Lock: ${shiftLockEnabled?'On':'Off'}`;
  }
}

function updateSettingsUI(){
  document.getElementById('mouseSensitivity').value = settings.mouseSensitivity;
  document.getElementById('gamepadDeadzone').value = settings.gamepadDeadzone;
  document.getElementById('gamepadSensitivity').value = settings.gamepadSensitivity;
  document.getElementById('graphicsQuality').value = settings.graphicsQuality;
  document.getElementById('showFPS').checked = settings.showFPS;
}

document.getElementById('mouseSensitivity').addEventListener('change', e=>{ settings.mouseSensitivity=parseFloat(e.target.value); });
document.getElementById('gamepadDeadzone').addEventListener('change', e=>{ settings.gamepadDeadzone=parseFloat(e.target.value); });
document.getElementById('gamepadSensitivity').addEventListener('change', e=>{ settings.gamepadSensitivity=parseFloat(e.target.value); });
document.getElementById('graphicsQuality').addEventListener('change', e=>{ settings.graphicsQuality=e.target.value; });
document.getElementById('showFPS').addEventListener('change', e=>{ settings.showFPS=e.target.checked; updateHud(); });

document.getElementById('settingsBtn').addEventListener('click', ()=>settingsOverlay.classList.add('visible'));
document.getElementById('settingsClose').addEventListener('click', ()=>settingsOverlay.classList.remove('visible'));

settingsOverlay.addEventListener('click', e=>{
  if(e.target===settingsOverlay) settingsOverlay.classList.remove('visible');
});

updateSettingsUI();
updateHud();

// ---------- Hide joystick on PC ----------
if (!('ontouchstart' in window)) {
  document.getElementById('leftJoy').style.display = 'none';
  document.getElementById('touch-hint').style.display = 'none';
  document.getElementById('sprintBtn').style.display = 'none';
}

// ---------- Three.js ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d22);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight,0.1,500);

scene.add(new THREE.HemisphereLight(0xffffff,0x444444,1));
const light = new THREE.DirectionalLight(0xffffff,1.4);
light.position.set(5,10,7);
scene.add(light);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(100,100), new THREE.MeshStandardMaterial({color:0x202226}));
ground.rotation.x=-Math.PI/2;
scene.add(ground);

// Terrain objects
const geometry = new THREE.BoxGeometry(8,3,8);
const material = new THREE.MeshStandardMaterial({color:0x3a3d42});

const rock1 = new THREE.Mesh(geometry, material); rock1.position.set(15, 1.5, 20); scene.add(rock1);
const rock2 = new THREE.Mesh(geometry, material); rock2.position.set(-20, 1.5, 15); scene.add(rock2);
const rock3 = new THREE.Mesh(geometry, material); rock3.position.set(0, 1.5, -25); scene.add(rock3);

const pillarGeom = new THREE.CylinderGeometry(2,2,5,8);
const pillarMat = new THREE.MeshStandardMaterial({color:0x4a5563});
const pillar1 = new THREE.Mesh(pillarGeom, pillarMat); pillar1.position.set(-15, 2.5, -15); scene.add(pillar1);
const pillar2 = new THREE.Mesh(pillarGeom, pillarMat); pillar2.position.set(25, 2.5, 0); scene.add(pillar2);

const platformGeom = new THREE.BoxGeometry(12,0.5,12);
const platformMat = new THREE.MeshStandardMaterial({color:0x5a6370});
const platform = new THREE.Mesh(platformGeom, platformMat); platform.position.set(-35, 2, 30); scene.add(platform);

const wallGeom = new THREE.BoxGeometry(20,4,1);
const wallMat = new THREE.MeshStandardMaterial({color:0x454a52});
const wall1 = new THREE.Mesh(wallGeom, wallMat); wall1.position.set(30, 2, -30); scene.add(wall1);
const wall2 = new THREE.Mesh(wallGeom, wallMat); wall2.position.set(-30, 2, 30); wall2.rotation.y=Math.PI/2; scene.add(wall2);

// ---------- WebRTC Multiplayer Setup ----------
const myPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);
const otherPlayers = new Map();
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 50;
let multiplayerReady = false;
let webrtcMultiplayer = null;

// ---------- Player ----------
let model, mixer, idleAction, walkAction, runAction, idleSpecialAction;
const loader = new GLTFLoader();
const playerState = { pos:new THREE.Vector3(0,0,0), rot:0, moving:false };
let currentAnim = 'idle';
let idleTimer = 0;
let nextIdleSpecialTime = Math.random() * 15 + 5;

function loadPlayer(){
  loader.load("./model/idle.glb", idleGLB=>{
    model=idleGLB.scene;
    model.scale.set(0.35,0.35,0.35);
    model.rotation.y=Math.PI;
    scene.add(model);
    mixer=new THREE.AnimationMixer(model);
    idleAction=mixer.clipAction(idleGLB.animations[0]);
    idleAction.play();

    loader.load("./model/walk.glb", walkGLB=>{
      walkAction=mixer.clipAction(walkGLB.animations[0]);
      walkAction.timeScale=2;

      loader.load("./model/run.glb", runGLB=>{
        runAction=mixer.clipAction(runGLB.animations[0]);
        runAction.timeScale=3.3;

        loader.load("./model/idle_special1.glb", idleSpecialGLB=>{
          idleSpecialAction=mixer.clipAction(idleSpecialGLB.animations[0]);
          idleSpecialAction.loop=THREE.LoopOnce;
          idleSpecialAction.clampWhenFinished=true;
          document.getElementById("loading").style.display="none";
          initMultiplayer(); // Initialize after models load
        }, undefined, err=>{
          console.log("Idle special animation missing, using regular idle.");
          idleSpecialAction=null;
          document.getElementById("loading").style.display="none";
          initMultiplayer();
        });

      }, undefined, err=>{
        console.log("Run animation missing, using walk.");
        runAction = walkAction;
        document.getElementById("loading").style.display="none";
        initMultiplayer();
      });

    }, undefined, err=>{
      walkAction = idleAction;
      runAction = idleAction;
      document.getElementById("loading").style.display="none";
      initMultiplayer();
    });

  }, undefined, err=>{
    console.error("Model load error:", err);
    const fallbackGeom=new THREE.CapsuleGeometry(0.5,1,4,8);
    const fallbackMat=new THREE.MeshStandardMaterial({color:0x77c0ff});
    model=new THREE.Mesh(fallbackGeom,fallbackMat);
    model.position.copy(playerState.pos);
    scene.add(model);
    setTimeout(()=>{
      document.getElementById("loading").style.display="none";
      initMultiplayer();
    },1000);
  });
}
loadPlayer();

// ---------- WebRTC Multiplayer Functions ----------
function initMultiplayer() {
  webrtcMultiplayer = new WebRTCMultiplayer(
    myPlayerId,
    (peerId, data) => {
      // Handle incoming player update
      updateOtherPlayer(peerId, data);
    },
    (peerId) => {
      // Handle player leave
      if (otherPlayers.has(peerId)) {
        const playerData = otherPlayers.get(peerId);
        if (playerData.mesh) scene.remove(playerData.mesh);
        if (playerData.nameLabel) scene.remove(playerData.nameLabel);
        otherPlayers.delete(peerId);
      }
      updatePlayerListUI();
    },
    (peerId) => {
      // Handle player join
      console.log('Player joined:', peerId);
      updatePlayerListUI();
    }
  );

  multiplayerReady = true;
  console.log("WebRTC multiplayer initialized");

  // Send periodic updates
  setInterval(() => {
    if (webrtcMultiplayer && webrtcMultiplayer.connected) {
      webrtcMultiplayer.sendPlayerUpdate({
        x: playerState.pos.x,
        y: playerState.pos.y,
        z: playerState.pos.z,
        rotation: playerState.rot,
        moving: playerState.moving
      });
    }
  }, UPDATE_INTERVAL);
}

function updateOtherPlayer(playerId, data) {
  console.log('Received update for player:', playerId, data);
  if (!otherPlayers.has(playerId)) {
    console.log('Creating new player:', playerId);
    const playerData = {
      mesh: null,
      model: null,
      mixer: null,
      idleAction: null,
      walkAction: null,
      runAction: null,
      currentAnim: 'idle',
      nameLabel: null,
      targetPos: new THREE.Vector3(data.x || 0, data.y || 0, data.z || 0),
      targetRot: data.rotation || 0,
      moving: data.moving || false,
      health: data.health || 100
    };

    otherPlayers.set(playerId, playerData);
    createOtherPlayerModel(playerId, playerData, data);
  } else {
    const playerData = otherPlayers.get(playerId);
    if (playerData) {
      playerData.targetPos.set(data.x || playerData.targetPos.x, data.y || playerData.targetPos.y, data.z || playerData.targetPos.z);
      playerData.targetRot = data.rotation !== undefined ? data.rotation : playerData.targetRot;
      playerData.moving = data.moving || false;
      playerData.health = data.health || 100;
    }
  }
}

function createOtherPlayerModel(playerId, playerData, data) {
  const playerLoader = new GLTFLoader();
  const hue = (playerId.charCodeAt(0) * 137.508) % 360;
  
  playerLoader.load("./model/idle.glb", idleGLB => {
    const playerModel = idleGLB.scene;
    playerModel.scale.set(0.35, 0.35, 0.35);
    playerModel.rotation.y = playerData.targetRot;
    playerModel.position.set(playerData.targetPos.x, playerData.targetPos.y, playerData.targetPos.z);
    
    playerModel.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.color.setHSL(hue / 360, 0.6, 0.5);
      }
    });
    
    scene.add(playerModel);
    playerData.model = playerModel;
    playerData.mesh = playerModel;
    
    const playerMixer = new THREE.AnimationMixer(playerModel);
    const idleAction = playerMixer.clipAction(idleGLB.animations[0]);
    idleAction.play();
    playerData.mixer = playerMixer;
    playerData.idleAction = idleAction;

    createPlayerNameLabel(playerId, playerData);

    playerLoader.load("./model/walk.glb", walkGLB => {
      const walkAction = playerMixer.clipAction(walkGLB.animations[0]);
      walkAction.timeScale = 2;
      playerData.walkAction = walkAction;

      playerLoader.load("./model/run.glb", runGLB => {
        const runAction = playerMixer.clipAction(runGLB.animations[0]);
        runAction.timeScale = 3.3;
        playerData.runAction = runAction;
      }, undefined, err => {
        playerData.runAction = walkAction;
      });
    }, undefined, err => {
      playerData.walkAction = idleAction;
      playerData.runAction = idleAction;
    });
  }, undefined, err => {
    const geometry = new THREE.CapsuleGeometry(0.4, 1, 4, 8);
    const material = new THREE.MeshStandardMaterial({ 
      color: new THREE.Color().setHSL(hue / 360, 0.7, 0.6) 
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(playerData.targetPos.x, playerData.targetPos.y, playerData.targetPos.z);
    scene.add(mesh);
    playerData.mesh = mesh;
    playerData.model = mesh;
    
    createPlayerNameLabel(playerId, playerData);
  });
}

function createPlayerNameLabel(playerId, playerData) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = 'bold 24px Arial';
  context.fillStyle = '#77c0ff';
  context.textAlign = 'center';
  context.fillText(playerId.substring(7, 12), 128, 40);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const nameLabel = new THREE.Sprite(spriteMaterial);
  nameLabel.scale.set(2, 0.5, 1);
  scene.add(nameLabel);
  playerData.nameLabel = nameLabel;
}

function updatePlayerListUI() {
  const listContent = document.getElementById('playerListContent');
  const playerCount = otherPlayers.size + 1; // +1 for self

  let html = `
    <div class="player-item you">
      <div class="player-indicator"></div>
      <span>You</span>
    </div>
  `;

  otherPlayers.forEach((playerData, playerId) => {
    html += `
      <div class="player-item">
        <div class="player-indicator"></div>
        <span>${playerId.substring(7, 12)}</span>
      </div>
    `;
  });

  listContent.innerHTML = html || '<div style="color:#666;padding:8px;">No players</div>';
  document.querySelector('#playerList h3').textContent = `Players Online (${playerCount})`;
}

setTimeout(() => initMultiplayer(), 1500);

// ---------- Chat System ----------
const MAX_CHAT_MESSAGES = 50;
const chatMessages = [];
const db = window.firebaseDB; // Firebase database reference for chat

function addChatMessage(username, message) {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  chatMessages.unshift({ username, message, timestamp });
  if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.pop();
  updateChatUI();
}

function updateChatUI() {
  const chatDiv = document.getElementById('chatMessages');
  chatDiv.innerHTML = chatMessages.map(msg =>
    `<div class="chat-msg"><strong>${msg.username}:</strong> ${msg.message}</div>`
  ).join('');
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

function sendChatMessage() {
  const input = document.getElementById('chatField');
  const message = input.value.trim();
  if (!message || !multiplayerReady) return;

  const ref = window.firebaseRef;
  const push = window.firebasePush;
  if (!push) {
    console.error("Firebase push not available");
    return;
  }

  const chatRef = ref(db, 'chat');
  push(chatRef, {
    username: myPlayerId.substring(7, 12),
    message: message,
    timestamp: Date.now()
  }).catch(err => console.error("Chat error:", err));

  input.value = '';
}

function initChatListeners() {
  if (!db || !window.firebaseOnValue) return;
  const ref = window.firebaseRef;
  const onValue = window.firebaseOnValue;
  const chatRef = ref(db, 'chat');

  onValue(chatRef, (snapshot) => {
    const messages = snapshot.val() || {};
    Object.keys(messages).forEach(key => {
      const msg = messages[key];
      if (!chatMessages.find(m => m.timestamp === msg.timestamp && m.username === msg.username)) {
        addChatMessage(msg.username, msg.message);
      }
    });
  }, err => console.error("Chat listener error:", err));
}

document.getElementById('chatSend').addEventListener('click', sendChatMessage);
document.getElementById('chatField').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

setTimeout(() => initChatListeners(), 2000);

// ---------- Emotes System ----------
const emoteAnimations = {
  wave: { duration: 1.2, sound: '👋' },
  thumbs: { duration: 0.8, sound: '👍' },
  laugh: { duration: 1.5, sound: '😂' },
  point: { duration: 1.0, sound: '☝️' },
  dance: { duration: 2.0, sound: '💃' }
};

function playEmote(emoteName) {
  if (!multiplayerReady) return;

  // Send emote through WebRTC if connected, otherwise just show locally
  if (webrtcMultiplayer && webrtcMultiplayer.connected) {
    webrtcMultiplayer.sendPlayerUpdate({
      type: 'emote',
      emote: emoteName,
      timestamp: Date.now()
    });
  }

  // Show emote in chat
  addChatMessage('System', `${myPlayerId.substring(7, 12)} ${emoteAnimations[emoteName].sound}`);
}

document.querySelectorAll('.emote-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emote = btn.dataset.emote;
    playEmote(emote);
  });
});

// ---------- Camera ----------
let camYaw=0, camPitch=-0.35, camDist=6, camHeight=3;

// ---------- Input ----------
const keys = {KeyW:false, KeyA:false, KeyS:false, KeyD:false, ShiftLeft:false, ShiftRight:false};
window.addEventListener("keydown",e=>{ if(keys[e.code]!==undefined) keys[e.code]=true; if(e.code.includes("Control")&&!e.repeat) toggleShiftLock(); });
window.addEventListener("keyup",e=>{ if(keys[e.code]!==undefined) keys[e.code]=false; });

// Mouse look
let dragging=false;
document.addEventListener("contextmenu", e=>e.preventDefault());
document.addEventListener("mousedown", e=>{ if(e.button===2) dragging=true; });
document.addEventListener("mouseup", ()=>dragging=false);
document.addEventListener("mousemove", e=>{
  if(!dragging && !shiftLockEnabled) return;
  camYaw -= e.movementX*0.003*settings.mouseSensitivity;
  camPitch += e.movementY*0.003*settings.mouseSensitivity;
  camPitch=Math.max(-1.2, Math.min(0.4, camPitch));
});

// Pointer lock
function setShiftLockState(state){
  shiftLockEnabled=state;
  shiftLockIndicator.textContent=state?'Ctrl Lock: On':'Ctrl Lock: Off';
  shiftLockIndicator.classList.toggle('active', state);
  updateHud();
}
function toggleShiftLock(){
  if(!canvas.requestPointerLock) return;
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  else canvas.requestPointerLock();
}
document.addEventListener("pointerlockchange", ()=>{
  setShiftLockState(document.pointerLockElement===canvas);
  if(!document.pointerLockElement) dragging=false;
});
document.addEventListener("pointerlockerror", ()=>setShiftLockState(false));

// ---------- Gamepad ----------
const gamepad={active:null};
function updateGamepadInput(){
  const pads=navigator.getGamepads();
  if(!pads[0]){gamepad.active=null; return;}
  gamepad.active=pads[0];
}
window.addEventListener("gamepadconnected", e=>console.log("Gamepad:",e.gamepad.id));
window.addEventListener("gamepaddisconnected", e=>{ if(gamepad.active?.index===e.gamepad.index) gamepad.active=null; });

// ---------- Left Joystick ----------
const leftJoyEl=document.getElementById("leftJoy");
const leftStickEl=document.getElementById("leftStick");
const leftJoy={active:false, id:null, x:0, y:0, max:40};

function updateLeftStick(x,y){ leftStickEl.style.left=`${35+x}px`; leftStickEl.style.top=`${35+y}px`; }
function resetLeftStick(){ updateLeftStick(0,0); }

function getTouchOffset(touch){
  const rect=leftJoyEl.getBoundingClientRect();
  const cx=rect.left+rect.width/2;
  const cy=rect.top+rect.height/2;
  let dx=touch.clientX-cx;
  let dy=touch.clientY-cy;
  const dist=Math.sqrt(dx*dx+dy*dy);
  if(dist>leftJoy.max){ const s=leftJoy.max/dist; dx*=s; dy*=s; }
  return {x:dx, y:dy};
}

leftJoyEl.addEventListener("touchstart", e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(!leftJoy.active && t.clientX<window.innerWidth/2){
      leftJoy.active=true;
      leftJoy.id=t.identifier;
      const o=getTouchOffset(t);
      leftJoy.x=o.x; leftJoy.y=o.y;
      updateLeftStick(leftJoy.x,leftJoy.y);
    }
  }
},{passive:false});

leftJoyEl.addEventListener("touchmove", e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(leftJoy.active && t.identifier===leftJoy.id){
      const o=getTouchOffset(t);
      leftJoy.x=o.x; leftJoy.y=o.y;
      updateLeftStick(leftJoy.x,leftJoy.y);
    }
  }
},{passive:false});

function endLeftTouch(e){
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier===leftJoy.id){
      leftJoy.active=false; leftJoy.id=null; leftJoy.x=0; leftJoy.y=0;
      resetLeftStick();
    }
  }
}
leftJoyEl.addEventListener("touchend", endLeftTouch, {passive:false});
leftJoyEl.addEventListener("touchcancel", endLeftTouch, {passive:false});

// ---------- Right side touch look ----------
let touchLook={active:false, id:null, lastX:0, lastY:0};

document.addEventListener("touchstart", e=>{
  for(const t of e.changedTouches){
    if(t.clientX>=window.innerWidth/2 && !touchLook.active){
      touchLook.active=true;
      touchLook.id=t.identifier;
      touchLook.lastX=t.clientX;
      touchLook.lastY=t.clientY;
    }
  }
},{passive:false});

document.addEventListener("touchmove", e=>{
  for(const t of e.changedTouches){
    if(t.identifier===touchLook.id){
      const dx=t.clientX-touchLook.lastX;
      const dy=t.clientY-touchLook.lastY;
      camYaw-=dx*0.003;
      camPitch+=dy*0.003;
      camPitch=Math.max(-1.2, Math.min(0.4, camPitch));
      touchLook.lastX=t.clientX;
      touchLook.lastY=t.clientY;
    }
  }
},{passive:false});

document.addEventListener("touchend", e=>{
  for(const t of e.changedTouches){
    if(t.identifier===touchLook.id) touchLook.active=false;
  }
},{passive:false});
document.addEventListener("touchcancel", e=>{
  for(const t of e.changedTouches){
    if(t.identifier===touchLook.id) touchLook.active=false;
  }
},{passive:false});

// ---------- Mobile Sprint Button ----------
const sprintBtn=document.getElementById("sprintBtn");
let sprintTouch={active:false, id:null};

sprintBtn.addEventListener("touchstart", e=>{
  e.preventDefault();
  const t=e.changedTouches[0];
  sprintTouch.active=true;
  sprintTouch.id=t.identifier;
  sprintBtn.classList.add("active");
},{passive:false});

function endSprintTouch(e){
  for(const t of e.changedTouches){
    if(t.identifier===sprintTouch.id){
      sprintTouch.active=false;
      sprintTouch.id=null;
      sprintBtn.classList.remove("active");
    }
  }
}

sprintBtn.addEventListener("touchend", endSprintTouch, {passive:false});
sprintBtn.addEventListener("touchcancel", endSprintTouch, {passive:false});

// ---------- Animations ----------
const clock=new THREE.Clock();
const moveSpeed=5;
const sprintSpeed=8;

function normalizeAngle(a){ return Math.atan2(Math.sin(a),Math.cos(a)); }

function setAnim(target){
  if(!idleAction||!walkAction||currentAnim===target) return;
  const outgoing = currentAnim==='idle'?idleAction:currentAnim==='idleSpecial'?idleSpecialAction:currentAnim==='walk'?walkAction:runAction;

  if(target==="run" && runAction){
    outgoing.fadeOut(0.2);
    runAction.reset().fadeIn(0.05).play();
    currentAnim="run";
    idleTimer=0;
  }
  else if(target==="walk"){
    outgoing.fadeOut(0.2);
    walkAction.reset().fadeIn(0.2).play();
    currentAnim="walk";
    idleTimer=0;
  }
  else if(target==="idle"){
    outgoing.fadeOut(0.2);
    idleAction.reset().fadeIn(0.2).play();
    currentAnim="idle";
    idleTimer=0;
  }
  else if(target==="idleSpecial" && idleSpecialAction){
    outgoing.fadeOut(0.1);
    idleSpecialAction.reset().fadeIn(1).play();
    currentAnim="idleSpecial";
  }
}

// ---------- Main Loop ----------
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  if(mixer) mixer.update(dt);

  if(currentAnim==='idleSpecial' && idleSpecialAction && !idleSpecialAction.isRunning()){
    setAnim("idle");
  }

  updateGamepadInput();

  fpsCounter++;
  if(fpsCounter%10===0) fpsDisplay=Math.round(1/dt);

  if(model){
    let forward=(keys.KeyW?1:0)+(keys.KeyS?-1:0);
    let sideways=(keys.KeyD?1:0)+(keys.KeyA?-1:0);

    // Combine PC sprint, mobile sprint, gamepad sprint
    isSprinting =
      (
        keys.ShiftLeft ||
        keys.ShiftRight ||
        sprintTouch.active
      ) &&
      (Math.abs(forward)>0 || Math.abs(sideways)>0);

    // ---------- FIXED JOYSTICK SPRINT LOGIC ----------
    if (leftJoy.active) {
      // raw joystick input
      let rawForward = -leftJoy.y / leftJoy.max;
      let rawSideways = leftJoy.x / leftJoy.max;

      // detect joystick movement BEFORE deadzone
      const joyMoving = Math.abs(rawForward) > 0.01 || Math.abs(rawSideways) > 0.01;

      // apply deadzone AFTER sprint detection
      forward = Math.abs(rawForward) < 0.05 ? 0 : rawForward;
      sideways = Math.abs(rawSideways) < 0.05 ? 0 : rawSideways;

      // sprint only if joystick actually moves
      if (joyMoving) {
        isSprinting =
          (keys.ShiftLeft || keys.ShiftRight || sprintTouch.active) &&
          joyMoving;
      }
    }

    // Gamepad
    if(gamepad.active){
      const [lx,ly,rx,ry] = [...gamepad.active.axes];
      const dz=settings.gamepadDeadzone;

      const lmag=Math.sqrt(lx*lx+ly*ly);
      if(lmag>dz){
        const n=(lmag-dz)/(1-dz);
        forward=-ly/lmag*n;
        sideways=lx/lmag*n;
      }

      const rmag=Math.sqrt(rx*rx+ry*ry);
      if(rmag>dz){
        const n=(rmag-dz)/(1-dz);
        camYaw-=rx*n*0.06*settings.gamepadSensitivity;
        camPitch+=ry*n*0.06*settings.gamepadSensitivity;
        camPitch=Math.max(-1.2,Math.min(0.4,camPitch));
      }
    }

    const moving=Math.abs(forward)>0 || Math.abs(sideways)>0;
    if(moving){
      const camF=new THREE.Vector3(Math.sin(camYaw),0,Math.cos(camYaw));
      const camR=new THREE.Vector3(-Math.cos(camYaw),0,Math.sin(camYaw));
      let moveDir=new THREE.Vector3().addScaledVector(camF,forward).addScaledVector(camR,sideways);
      const mag=moveDir.length(); if(mag>1) moveDir.normalize();

      const targetRot=Math.atan2(moveDir.x, moveDir.z)+Math.PI;
      let rotDiff=normalizeAngle(targetRot-playerState.rot);
      playerState.rot+=rotDiff*0.2;
      playerState.rot=normalizeAngle(playerState.rot);
      model.rotation.y=playerState.rot;

      const speed=isSprinting?sprintSpeed:moveSpeed;
      playerState.pos.add(moveDir.multiplyScalar(speed*dt));
      model.position.copy(playerState.pos);

      if(isSprinting) setAnim("run");
      else setAnim("walk");
      playerState.moving=true;
    }
    else {
      idleTimer+=dt;
      if(idleTimer>=nextIdleSpecialTime && idleSpecialAction && currentAnim==='idle'){
        setAnim("idleSpecial");
        idleTimer=0;
        nextIdleSpecialTime=Math.random()*15+5;
      }
      else if(currentAnim!=='idle' && currentAnim!=='idleSpecial'){
        setAnim("idle");
      }
      playerState.moving=false;
      isSprinting=false;
    }

    const camX=playerState.pos.x-Math.sin(camYaw)*camDist;
    const camZ=playerState.pos.z-Math.cos(camYaw)*camDist;
    const camY=playerState.pos.y+camHeight+Math.sin(camPitch)*camDist;
    camera.position.set(camX,camY,camZ);
    camera.lookAt(playerState.pos.x,playerState.pos.y+2,playerState.pos.z);
  }

  // Update other players (smooth interpolation)
  otherPlayers.forEach((playerData) => {
    if (!playerData.mesh) return;
    
    // Update animations
    if (playerData.mixer) {
      playerData.mixer.update(dt);
      
      // Switch animations based on moving state
      if (playerData.moving && playerData.currentAnim === 'idle') {
        if (playerData.idleAction && playerData.walkAction) {
          playerData.idleAction.fadeOut(0.2);
          playerData.walkAction.reset().fadeIn(0.2).play();
          playerData.currentAnim = 'walk';
        }
      } else if (!playerData.moving && playerData.currentAnim !== 'idle') {
        if (playerData.idleAction && playerData.walkAction) {
          playerData.walkAction.fadeOut(0.2);
          playerData.idleAction.reset().fadeIn(0.2).play();
          playerData.currentAnim = 'idle';
        }
      }
    }
    
    // Smooth position interpolation
    playerData.mesh.position.lerp(playerData.targetPos, 0.2);
    
    // Smooth rotation interpolation
    let rotDiff = normalizeAngle(playerData.targetRot - playerData.mesh.rotation.y);
    playerData.mesh.rotation.y += rotDiff * 0.2;
    
    // Update name label position
    if (playerData.nameLabel) {
      playerData.nameLabel.position.copy(playerData.mesh.position);
      playerData.nameLabel.position.y += 2.5;
    }
  });

  renderer.render(scene,camera);
  hudState.gamepad=!!gamepad.active;
  updateHud();
}
animate();

// ---------- Resize ----------
window.addEventListener("resize", ()=>{
  renderer.setSize(window.innerWidth,window.innerHeight);
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
});

updateLeftStick(0,0);
