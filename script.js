import './firebase.js';

import * as THREE from "three";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const hud=document.getElementById('hud');
const settingsOverlay=document.getElementById('settingsOverlay');
const baseHudMessage='Right-click + drag to rotate camera | Mouse wheel to zoom | WASD to move | Hold Shift to sprint';
const hudState={gamepad:false};
let fpsCounter=0, fpsDisplay=0;
let isSprinting=false;
let chatVisible=true;

// Health & Stamina
let playerHealth = 100;
let playerStamina = 100;
const maxHealth = 100;
const maxStamina = 100;
let staminaRecoveryTimer = 0; // Timer for recovery delay when stamina reaches 0
let sprintBlockTimer = 0; // Timer that blocks sprinting after stamina depletion

// ---------- Settings ----------
// Detect mobile device
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

const settings = {
  mouseSensitivity: 1,
  gamepadDeadzone: 0.1,
  gamepadSensitivity: 1,
  graphicsQuality: isMobile ? 'low' : 'medium'
};

// ---------- ACCESSORY SYSTEM ----------
// Available accessories by category
const accessoryConfig = {
  hat: {
    none: null,
    hat_basic: {
      file: 'HAT_GLB.glb',
      defaultPosition: [0, 1.8, 0],
      defaultRotation: [0, 0, 0],
      defaultScale: [0.3, 0.3, 0.3],
      defaultAttachment: 'head'
    }
  },
  face: {
    none: null
  },
  back: {
    none: null
  }
};



// Custom accessory positions (saved by user)
let customAccessoryPositions = {};

// Store loaded accessory models
const loadedAccessoryModels = new Map();



// ---------- ACCESSORY FUNCTIONS ----------
// Load accessory model
function loadAccessoryModel(accessoryKey, callback) {
  if (!accessoryKey || accessoryKey === 'none') {
    callback(null);
    return;
  }

  // Check if already loaded
  if (loadedAccessoryModels.has(accessoryKey)) {
    callback(loadedAccessoryModels.get(accessoryKey));
    return;
  }

  // Find accessory config
  let config = null;
  for (const category in accessoryConfig) {
    if (accessoryConfig[category][accessoryKey]) {
      config = accessoryConfig[category][accessoryKey];
      break;
    }
  }

  if (!config) {
    console.error('Accessory config not found:', accessoryKey);
    callback(null);
    return;
  }

  const loader = new GLTFLoader();
  loader.load(`./model/accesories/${config.file}`, (gltf) => {
    const model = gltf.scene;

    // Store original model for reuse (without transforms)
    loadedAccessoryModels.set(accessoryKey, model.clone());
    callback(model);
  }, undefined, (error) => {
    console.error('Failed to load accessory:', accessoryKey, error);
    callback(null);
  });
}

// Apply accessories to player model
function applyAccessoriesToPlayer(playerModel, accessories) {
  // Remove ALL existing accessories from anywhere in the model hierarchy
  const accessoriesToRemove = [];
  playerModel.traverse((child) => {
    if (child.userData && child.userData.isAccessory) {
      accessoriesToRemove.push(child);
    }
  });

  // Remove accessories from their current parents
  accessoriesToRemove.forEach(acc => {
    if (acc.parent) {
      acc.parent.remove(acc);
    }
  });

  // Load and add new accessories
  const categories = ['hat', 'face', 'back'];
  categories.forEach(category => {
    const accessoryKey = accessories[category];
    if (accessoryKey && accessoryKey !== 'none') {
      loadAccessoryModel(accessoryKey, (accessoryModel) => {
        if (accessoryModel) {
          const accessoryClone = accessoryModel.clone();
          accessoryClone.userData = { isAccessory: true, category: category, key: accessoryKey };

          // Get custom position or use default
          const customPos = customAccessoryPositions[accessoryKey];
          let position, rotation, scale, attachmentPoint;

          if (customPos) {
            position = customPos.position;
            rotation = customPos.rotation;
            scale = customPos.scale;
            attachmentPoint = customPos.attachment;
          } else {
            const config = accessoryConfig[category][accessoryKey];
            position = config.defaultPosition;
            rotation = config.defaultRotation;
            scale = config.defaultScale[0];
            attachmentPoint = config.defaultAttachment;
          }

          // Apply custom transform
          accessoryClone.position.set(...position);
          accessoryClone.rotation.set(...rotation.map(r => r * Math.PI / 180)); // Convert degrees to radians
          accessoryClone.scale.set(scale, scale, scale);

          // Find attachment point - use cache to avoid repeated traversal
          let attachPoint = playerModel;
          if (attachmentPoint && boneMappings[attachmentPoint]) {
            const cacheKey = `${playerModel.uuid}_${attachmentPoint}`;
            if (boneCache.has(cacheKey)) {
              attachPoint = boneCache.get(cacheKey);
            } else {
              const boneNames = boneMappings[attachmentPoint];
              playerModel.traverse((child) => {
                if (child.isBone && boneNames.includes(child.name)) {
                  attachPoint = child;
                  boneCache.set(cacheKey, child); // Cache the bone reference
                  return; // Stop after finding first matching bone
                }
              });
            }
          }

          attachPoint.add(accessoryClone);
        }
      });
    }
  });
}

// ---------- ACCESSORY POSITION EDITOR ----------
let currentEditingAccessory = null;

// Bone name mappings for different body parts
const boneMappings = {
  head: ['Head', 'head', 'mixamorigHead', 'Bone.Head'],
  torso: ['Spine2', 'spine2', 'mixamorigSpine2', 'Bone.Spine2', 'Torso'],
  leftArm: ['LeftArm', 'leftArm', 'mixamorigLeftArm', 'Bone.LeftArm', 'Left_Arm'],
  rightArm: ['RightArm', 'rightArm', 'mixamorigRightArm', 'Bone.RightArm', 'Right_Arm'],
  leftLeg: ['LeftUpLeg', 'leftLeg', 'mixamorigLeftUpLeg', 'Bone.LeftLeg'],
  rightLeg: ['RightUpLeg', 'rightLeg', 'mixamorigRightUpLeg', 'Bone.RightLeg']
};

// Cache for bone references to avoid repeated traversal
const boneCache = new Map();

// Show/hide accessory editor based on selection
function updateAccessoryEditor() {
  const editor = document.getElementById('accessoryEditor');
  // Don't show physics accessories like cape in position editor
  const hasAccessory = Object.values(customization.accessories).some(acc => acc !== 'none' && acc !== 'cape');

  if (hasAccessory) {
    editor.style.display = 'block';
    // Auto-select first available accessory for editing (excluding physics ones)
    const availableAccessories = Object.entries(customization.accessories)
      .filter(([key, value]) => value !== 'none' && value !== 'cape');
    if (availableAccessories.length > 0) {
      currentEditingAccessory = availableAccessories[0][1]; // accessory key
      loadAccessoryPosition(currentEditingAccessory);
    }
  } else {
    editor.style.display = 'none';
    currentEditingAccessory = null;
  }
}

// Load accessory position into editor
function loadAccessoryPosition(accessoryKey) {
  // Find the config for this accessory
  let config = null;
  let category = null;
  for (const cat in accessoryConfig) {
    if (accessoryConfig[cat][accessoryKey]) {
      config = accessoryConfig[cat][accessoryKey];
      category = cat;
      break;
    }
  }

  if (!config) {
    console.error('Accessory config not found for:', accessoryKey);
    return;
  }

  const customPos = customAccessoryPositions[accessoryKey];

  if (customPos) {
    document.getElementById('attachmentPoint').value = customPos.attachment || config.defaultAttachment;
    document.getElementById('posX').value = customPos.position[0];
    document.getElementById('posY').value = customPos.position[1];
    document.getElementById('posZ').value = customPos.position[2];
    document.getElementById('rotX').value = customPos.rotation[0];
    document.getElementById('rotY').value = customPos.rotation[1];
    document.getElementById('rotZ').value = customPos.rotation[2];
    document.getElementById('accScale').value = customPos.scale;
  } else {
    document.getElementById('attachmentPoint').value = config.defaultAttachment;
    document.getElementById('posX').value = config.defaultPosition[0];
    document.getElementById('posY').value = config.defaultPosition[1];
    document.getElementById('posZ').value = config.defaultPosition[2];
    document.getElementById('rotX').value = config.defaultRotation[0];
    document.getElementById('rotY').value = config.defaultRotation[1];
    document.getElementById('rotZ').value = config.defaultRotation[2];
    document.getElementById('accScale').value = config.defaultScale[0];
  }

  // Sync number inputs with slider values
  syncInputsToSliders();
  updateAccessoryValueDisplays();
}

// Sync number inputs to match slider values
function syncInputsToSliders() {
  document.getElementById('posXNum').value = document.getElementById('posX').value;
  document.getElementById('posYNum').value = document.getElementById('posY').value;
  document.getElementById('posZNum').value = document.getElementById('posZ').value;
  document.getElementById('rotXNum').value = document.getElementById('rotX').value;
  document.getElementById('rotYNum').value = document.getElementById('rotY').value;
  document.getElementById('rotZNum').value = document.getElementById('rotZ').value;
  document.getElementById('accScaleNum').value = document.getElementById('accScale').value;
}

// Sync sliders to match number input values
function syncSlidersToInputs() {
  document.getElementById('posX').value = document.getElementById('posXNum').value;
  document.getElementById('posY').value = document.getElementById('posYNum').value;
  document.getElementById('posZ').value = document.getElementById('posZNum').value;
  document.getElementById('rotX').value = document.getElementById('rotXNum').value;
  document.getElementById('rotY').value = document.getElementById('rotYNum').value;
  document.getElementById('rotZ').value = document.getElementById('rotZNum').value;
  document.getElementById('accScale').value = document.getElementById('accScaleNum').value;
}

// Save current accessory position
function saveAccessoryPosition() {
  if (!currentEditingAccessory) return;

  customAccessoryPositions[currentEditingAccessory] = {
    attachment: document.getElementById('attachmentPoint').value,
    position: [
      parseFloat(document.getElementById('posX').value),
      parseFloat(document.getElementById('posY').value),
      parseFloat(document.getElementById('posZ').value)
    ],
    rotation: [
      parseFloat(document.getElementById('rotX').value),
      parseFloat(document.getElementById('rotY').value),
      parseFloat(document.getElementById('rotZ').value)
    ],
    scale: parseFloat(document.getElementById('accScale').value)
  };

  // Reapply accessories with new position
  if (model) {
    applyAccessoriesToPlayer(model, customization.accessories);
  }

  // Save to localStorage
  localStorage.setItem('customAccessoryPositions', JSON.stringify(customAccessoryPositions));
}

// Reset accessory position to default
function resetAccessoryPosition() {
  if (!currentEditingAccessory) return;

  delete customAccessoryPositions[currentEditingAccessory];
  loadAccessoryPosition(currentEditingAccessory);

  // Reapply accessories with default position
  if (model) {
    applyAccessoriesToPlayer(model, customization.accessories);
  }

  // Save to localStorage
  localStorage.setItem('customAccessoryPositions', JSON.stringify(customAccessoryPositions));
}

// Debounce timer for real-time accessory updates
let accessoryUpdateTimer = null;

// Update accessory position in real-time (debounced)
function updateAccessoryPosition(accessoryKey, newTransform) {
  if (!model) return;

  // Clear previous timer
  if (accessoryUpdateTimer) {
    clearTimeout(accessoryUpdateTimer);
  }

  // Debounce updates to every 50ms to reduce lag
  accessoryUpdateTimer = setTimeout(() => {
    // Find the accessory in the model
    let foundAccessory = null;
    model.traverse((child) => {
      if (child.userData && child.userData.isAccessory && child.userData.key === accessoryKey) {
        foundAccessory = child;
        return;
      }
    });

    if (foundAccessory) {
      // Update transforms
      foundAccessory.position.set(...newTransform.position);
      foundAccessory.rotation.set(...newTransform.rotation.map(r => r * Math.PI / 180));
      foundAccessory.scale.set(newTransform.scale, newTransform.scale, newTransform.scale);

      // If attachment point changed, need to reattach
      if (newTransform.attachment !== foundAccessory.userData.attachmentPoint) {
        // Remove from current parent
        if (foundAccessory.parent) {
          foundAccessory.parent.remove(foundAccessory);
        }

        // Find new attachment point
        let attachPoint = model;
        if (newTransform.attachment && boneMappings[newTransform.attachment]) {
          const boneNames = boneMappings[newTransform.attachment];
          model.traverse((child) => {
            if (child.isBone && boneNames.includes(child.name)) {
              attachPoint = child;
              return;
            }
          });
        }

        attachPoint.add(foundAccessory);
        foundAccessory.userData.attachmentPoint = newTransform.attachment;
      }
    }
  }, 50); // 50ms debounce
}

// Update value displays
function updateAccessoryValueDisplays() {
  document.getElementById('posXValue').textContent = document.getElementById('posX').value;
  document.getElementById('posYValue').textContent = document.getElementById('posY').value;
  document.getElementById('posZValue').textContent = document.getElementById('posZ').value;
  document.getElementById('rotXValue').textContent = document.getElementById('rotX').value + '°';
  document.getElementById('rotYValue').textContent = document.getElementById('rotY').value + '°';
  document.getElementById('rotZValue').textContent = document.getElementById('rotZ').value + '°';
  document.getElementById('accScaleValue').textContent = document.getElementById('accScale').value;
}

// Load custom positions from localStorage
function loadCustomAccessoryPositions() {
  const saved = localStorage.getItem('customAccessoryPositions');
  if (saved) {
    customAccessoryPositions = JSON.parse(saved);
  }
}

// ---------- Customization ----------
const customization = {
  bodyColor: '#77c0ff',
  accentColor: '#ffffff',
  scale: 1.0,
  accessories: {
    hat: 'none',
    face: 'none',
    back: 'none'
  }
};

function updateHud(){
  if(hud){
    const fpsText = `FPS: ${fpsDisplay} | `;
    const statusText = `Gamepad: ${hudState.gamepad?'✓':'✗'} | Sprint: ${isSprinting?'On':'Off'}`;
    hud.textContent = fpsText + baseHudMessage + ' | ' + statusText;
  }
}

function updateStatsUI(){
  const healthFill = document.getElementById('healthFill');
  const staminaFill = document.getElementById('staminaFill');
  const healthLabel = document.querySelector('#healthBar .stat-label');
  const staminaLabel = document.querySelector('#staminaBar .stat-label');

  if (healthFill && healthLabel) {
    const healthPercent = (playerHealth / maxHealth) * 100;
    healthFill.style.width = healthPercent + '%';
    healthLabel.textContent = `Health: ${Math.round(playerHealth)}/${maxHealth}`;

    // Add/remove low health class
    if (playerHealth < 30) {
      healthFill.classList.add('low');
    } else {
      healthFill.classList.remove('low');
    }
  }

  if (staminaFill && staminaLabel) {
    const staminaPercent = (playerStamina / maxStamina) * 100;
    staminaFill.style.width = staminaPercent + '%';
    staminaLabel.textContent = `Stamina: ${Math.round(playerStamina)}/${maxStamina}`;

    // Add/remove low stamina class
    if (playerStamina < 25) {
      staminaFill.classList.add('low');
    } else {
      staminaFill.classList.remove('low');
    }
  }
}

function updateSettingsUI(){
  document.getElementById('mouseSensitivity').value = settings.mouseSensitivity;
  document.getElementById('gamepadDeadzone').value = settings.gamepadDeadzone;
  document.getElementById('gamepadSensitivity').value = settings.gamepadSensitivity;
  document.getElementById('graphicsQuality').value = settings.graphicsQuality;
}

document.getElementById('mouseSensitivity').addEventListener('change', e=>{ settings.mouseSensitivity=parseFloat(e.target.value); });
document.getElementById('gamepadDeadzone').addEventListener('change', e=>{ settings.gamepadDeadzone=parseFloat(e.target.value); });
document.getElementById('gamepadSensitivity').addEventListener('change', e=>{ settings.gamepadSensitivity=parseFloat(e.target.value); });
document.getElementById('graphicsQuality').addEventListener('change', e=>{ settings.graphicsQuality=e.target.value; });

document.getElementById('customizeBtn').addEventListener('click', ()=>{
  document.getElementById('customizeOverlay').classList.add('visible');
  updateAccessoryEditor();
});
document.getElementById('customizeClose').addEventListener('click', ()=>document.getElementById('customizeOverlay').classList.remove('visible'));
document.getElementById('customizeApply').addEventListener('click', applyCustomization);

// Accessory position editor events
document.getElementById('saveAccessoryPos').addEventListener('click', saveAccessoryPosition);
document.getElementById('resetAccessoryPos').addEventListener('click', resetAccessoryPosition);

// Update accessory in real-time when sliders change
function updateAccessoryRealtime() {
  if (!currentEditingAccessory || !model) return;

  // Get current slider values
  const position = [
    parseFloat(document.getElementById('posX').value),
    parseFloat(document.getElementById('posY').value),
    parseFloat(document.getElementById('posZ').value)
  ];
  const rotation = [
    parseFloat(document.getElementById('rotX').value),
    parseFloat(document.getElementById('rotY').value),
    parseFloat(document.getElementById('rotZ').value)
  ];
  const scale = parseFloat(document.getElementById('accScale').value);
  const attachmentPoint = document.getElementById('attachmentPoint').value;

  // Update the accessory in real-time
  updateAccessoryPosition(currentEditingAccessory, {
    position,
    rotation,
    scale,
    attachment: attachmentPoint
  });

  // Update value displays
  updateAccessoryValueDisplays();
}

// Event listeners for real-time updates
['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'accScale', 'attachmentPoint'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateAccessoryRealtime);
});

// Sync number inputs to sliders when typing
['posXNum', 'posYNum', 'posZNum', 'rotXNum', 'rotYNum', 'rotZNum', 'accScaleNum'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    syncSlidersToInputs();
    updateAccessoryRealtime();
  });
});

document.getElementById('customizeOverlay').addEventListener('click', e=>{
  if(e.target===document.getElementById('customizeOverlay')) document.getElementById('customizeOverlay').classList.remove('visible');
});

document.getElementById('settingsBtn').addEventListener('click', ()=>settingsOverlay.classList.add('visible'));
document.getElementById('settingsClose').addEventListener('click', ()=>settingsOverlay.classList.remove('visible'));

// Chat toggle functionality
document.getElementById('chatToggleBtn').addEventListener('click', toggleChat);

settingsOverlay.addEventListener('click', e=>{
  if(e.target===settingsOverlay) settingsOverlay.classList.remove('visible');
});

// Chat toggle function
function toggleChat() {
  const chatBox = document.getElementById('chatBox');
  const chatToggleBtn = document.getElementById('chatToggleBtn');

  chatVisible = !chatVisible;

  if (chatVisible) {
    chatBox.style.display = 'flex';
    chatToggleBtn.classList.add('active');
  } else {
    chatBox.style.display = 'none';
    chatToggleBtn.classList.remove('active');
  }
}

function applyCustomization() {
  customization.bodyColor = document.getElementById('bodyColor').value;
  customization.accentColor = document.getElementById('accentColor').value;
  customization.scale = parseFloat(document.getElementById('playerScale').value);

  // Get accessory selections
  customization.accessories.hat = document.getElementById('hatSelect').value;
  customization.accessories.face = document.getElementById('faceSelect').value;
  customization.accessories.back = document.getElementById('backSelect').value;

  // Apply to own model
  if (model) {
    model.scale.set(customization.scale * 0.35, customization.scale * 0.35, customization.scale * 0.35);
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.color.set(customization.bodyColor);
      }
    });

    // Apply accessories
    applyAccessoriesToPlayer(model, customization.accessories);
  }

  // Update Firebase
  if (multiplayerReady && myPlayerRef) {
    const update = window.firebaseUpdate;
    update(myPlayerRef, {
      bodyColor: customization.bodyColor,
      accentColor: customization.accentColor,
      scale: customization.scale,
      accessories: customization.accessories
    }).catch(err => console.error("Customization update error:", err));
  }

  document.getElementById('customizeOverlay').classList.remove('visible');
}

updateSettingsUI();
loadCustomAccessoryPositions(); // Load saved accessory positions
updateHud();

// ---------- Hide joystick on PC ----------
if (!('ontouchstart' in window)) {
  document.getElementById('leftJoy').style.display = 'none';
  document.getElementById('touch-hint').style.display = 'none';
  document.getElementById('sprintBtn').style.display = 'none';
}

// ---------- Three.js ----------
// Performance optimization: Reduce pixel ratio and disable antialiasing on mobile
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobile, // Disable antialiasing on mobile for better performance
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
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





// ---------- Particle Systems ----------
// Performance optimization: Reduce particle counts on mobile
const dustCount = isMobile ? 50 : 200;
const sparkleCount = isMobile ? 10 : 20;
const sweatCount = isMobile ? 15 : 30;

// Dust particles
const dustGeometry = new THREE.BufferGeometry();
const dustPositions = new Float32Array(dustCount * 3);
const dustVelocities = [];
const dustOscillation = [];
const dustLifetimes = [];
for (let i = 0; i < dustCount; i++) {
  dustPositions[i * 3] = (Math.random() - 0.5) * 80; // Smaller area
  dustPositions[i * 3 + 1] = Math.random() * 4 + 1; // Lower height range
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
  dustVelocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.01, (Math.random() - 0.5) * 0.02)); // Much slower
  dustOscillation.push({ phase: Math.random() * Math.PI * 2, amplitude: Math.random() * 0.5 + 0.2 });
  dustLifetimes.push(Math.random() * 10 + 5); // Random lifetimes
}
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dustMaterial = new THREE.PointsMaterial({ color: 0xf5f5f5, size: 0.08, transparent: true, opacity: 0.4, vertexColors: true });
const dustColors = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  // Slightly varying colors for more realism
  const brightness = 0.9 + Math.random() * 0.1;
  dustColors[i * 3] = brightness; // R
  dustColors[i * 3 + 1] = brightness; // G
  dustColors[i * 3 + 2] = brightness; // B
}
dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
const dustParticles = new THREE.Points(dustGeometry, dustMaterial);
scene.add(dustParticles);

// Sparkle particles
const sparkleGeometry = new THREE.BufferGeometry();
const sparklePositions = new Float32Array(sparkleCount * 3);
const sparkleVelocities = [];
const sparkleLifetimes = [];
for (let i = 0; i < sparkleCount; i++) {
  sparklePositions[i * 3] = 0;
  sparklePositions[i * 3 + 1] = 0;
  sparklePositions[i * 3 + 2] = 0;
  sparkleVelocities.push(new THREE.Vector3((Math.random() - 0.5) * 1, Math.random() * 0.5 + 0.5, (Math.random() - 0.5) * 1));
  sparkleLifetimes.push(0);
}
sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
const sparkleMaterial = new THREE.PointsMaterial({ color: 0xffff00, size: 0.5, transparent: true, opacity: 0.9 });
const sparkleParticles = new THREE.Points(sparkleGeometry, sparkleMaterial);
scene.add(sparkleParticles);

// Sweat particles (for low stamina)
const sweatGeometry = new THREE.BufferGeometry();
const sweatPositions = new Float32Array(sweatCount * 3);
const sweatVelocities = [];
const sweatLifetimes = [];
for (let i = 0; i < sweatCount; i++) {
  sweatPositions[i * 3] = 0;
  sweatPositions[i * 3 + 1] = 0;
  sweatPositions[i * 3 + 2] = 0;
  sweatVelocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.2 - 0.5, (Math.random() - 0.5) * 0.5));
  sweatLifetimes.push(0);
}
sweatGeometry.setAttribute('position', new THREE.BufferAttribute(sweatPositions, 3));
const sweatMaterial = new THREE.PointsMaterial({ color: 0x88ddff, size: 0.3, transparent: true, opacity: 0.7 });
const sweatParticles = new THREE.Points(sweatGeometry, sweatMaterial);
scene.add(sweatParticles);



// ---------- Firebase Multiplayer Setup ----------
const myPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);
const otherPlayers = new Map();
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 50;
let multiplayerReady = false;
let myPlayerRef = null;
const db = window.firebaseDB;

// ---------- Player ----------
let model, mixer, idleAction, walkAction, runAction, idleSpecialAction, emoteWaveAction, emoteLaughAction, emotePointAction;
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
        runAction.timeScale=3;

        loader.load("./model/idle_special1.glb", idleSpecialGLB=>{
          idleSpecialAction=mixer.clipAction(idleSpecialGLB.animations[0]);
          idleSpecialAction.loop=THREE.LoopOnce;
          idleSpecialAction.clampWhenFinished=true;

          // Load emote animations (same pattern as idle_special1)
          loader.load("./model/emote_wave.glb", emoteWaveGLB=>{
            emoteWaveAction=mixer.clipAction(emoteWaveGLB.animations[0]);
            emoteWaveAction.loop=THREE.LoopOnce;
            emoteWaveAction.clampWhenFinished=true;

            loader.load("./model/emote_laugh.glb", emoteLaughGLB=>{
              emoteLaughAction=mixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop=THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished=true;

              loader.load("./model/emote_point.glb", emotePointGLB=>{
                emotePointAction=mixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop=THREE.LoopOnce;
                emotePointAction.clampWhenFinished=true;
                document.getElementById("loading").style.display="none";
                initMultiplayer(); // Initialize after models load
              }, undefined, err=>{
                console.log("Point emote animation missing, using regular idle.");
                emotePointAction=null;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              });
            }, undefined, err=>{
              console.log("Laugh emote animation missing, using regular idle.");
              emoteLaughAction=null;
              loader.load("./model/emote_point.glb", emotePointGLB=>{
                emotePointAction=mixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop=THREE.LoopOnce;
                emotePointAction.clampWhenFinished=true;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              }, undefined, err=>{
                console.log("Point emote animation missing, using regular idle.");
                emotePointAction=null;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              });
            });
          }, undefined, err=>{
            console.log("Wave emote animation missing, using regular idle.");
            emoteWaveAction=null;
            loader.load("./model/emote_laugh.glb", emoteLaughGLB=>{
              emoteLaughAction=mixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop=THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished=true;
              loader.load("./model/emote_point.glb", emotePointGLB=>{
                emotePointAction=mixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop=THREE.LoopOnce;
                emotePointAction.clampWhenFinished=true;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              }, undefined, err=>{
                console.log("Point emote animation missing, using regular idle.");
                emotePointAction=null;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              });
            }, undefined, err=>{
              console.log("Laugh emote animation missing, using regular idle.");
              emoteLaughAction=null;
              loader.load("./model/emote_point.glb", emotePointGLB=>{
                emotePointAction=mixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop=THREE.LoopOnce;
                emotePointAction.clampWhenFinished=true;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              }, undefined, err=>{
                console.log("Point emote animation missing, using regular idle.");
                emotePointAction=null;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              });
            });
          });
        }, undefined, err=>{
          console.log("Idle special animation missing, using regular idle.");
          idleSpecialAction=null;
          // Load emote animations even if idle special is missing
          loader.load("./model/emote_wave.glb", emoteWaveGLB=>{
            emoteWaveAction=mixer.clipAction(emoteWaveGLB.animations[0]);
            emoteWaveAction.loop=THREE.LoopOnce;
            emoteWaveAction.clampWhenFinished=true;

            loader.load("./model/emote_laugh.glb", emoteLaughGLB=>{
              emoteLaughAction=mixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop=THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished=true;
              loader.load("./model/emote_point.glb", emotePointGLB=>{
                emotePointAction=mixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop=THREE.LoopOnce;
                emotePointAction.clampWhenFinished=true;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              }, undefined, err=>{
                console.log("Point emote animation missing.");
                emotePointAction=null;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              });
            }, undefined, err=>{
              console.log("Laugh emote animation missing.");
              emoteLaughAction=null;
              loader.load("./model/emote_point.glb", emotePointGLB=>{
                emotePointAction=mixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop=THREE.LoopOnce;
                emotePointAction.clampWhenFinished=true;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              }, undefined, err=>{
                console.log("Point emote animation missing.");
                emotePointAction=null;
                document.getElementById("loading").style.display="none";
                initMultiplayer();
              });
            });
          }, undefined, err=>{
            console.log("Wave emote animation missing.");
            emoteWaveAction=null;
            loader.load("./model/emote_laugh.glb", emoteLaughGLB=>{
              emoteLaughAction=mixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop=THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished=true;
              document.getElementById("loading").style.display="none";
              initMultiplayer();
            }, undefined, err=>{
              console.log("Laugh emote animation missing.");
              emoteLaughAction=null;
              document.getElementById("loading").style.display="none";
              initMultiplayer();
            });
          });
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

// ---------- Firebase Multiplayer Functions ----------
function initMultiplayer() {
  if (!window.firebaseDB || !window.firebaseRef) {
    console.error("Firebase not initialized yet");
    setTimeout(initMultiplayer, 500);
    return;
  }

  const ref = window.firebaseRef;
  const set = window.firebaseSet;
  const onValue = window.firebaseOnValue;
  const onDisconnect = window.firebaseOnDisconnect;
  const update = window.firebaseUpdate;

  myPlayerRef = ref(db, `players/${myPlayerId}`);
  const playersRef = ref(db, 'players');

  onDisconnect(myPlayerRef).remove().catch(err => console.error("Disconnect handler error:", err));

  set(myPlayerRef, {
    id: myPlayerId,
    x: playerState.pos.x,
    y: playerState.pos.y,
    z: playerState.pos.z,
    rotation: playerState.rot,
    moving: false,
    animation: currentAnim,
    timestamp: Date.now(),
    health: 100,
    stamina: 100,
    bodyColor: customization.bodyColor,
    accentColor: customization.accentColor,
    scale: customization.scale,
    accessories: customization.accessories
  }).then(() => {
    console.log("Player registered:", myPlayerId);
    multiplayerReady = true;
  }).catch(err => console.error("Error registering player:", err));

  onValue(playersRef, (snapshot) => {
    const players = snapshot.val() || {};
    updatePlayerListUI(players);

    otherPlayers.forEach((playerData, playerId) => {
      if (!players[playerId]) {
        if (playerData.mesh) scene.remove(playerData.mesh);
        if (playerData.nameLabel) scene.remove(playerData.nameLabel);
        otherPlayers.delete(playerId);
      }
    });

    Object.keys(players).forEach(playerId => {
      if (playerId !== myPlayerId) {
        const playerData = players[playerId];
        updateOtherPlayer(playerId, playerData);
      }
    });
  }, err => console.error("Error listening to players:", err));

  setInterval(() => {
    if (model && multiplayerReady && myPlayerRef) {
      update(myPlayerRef, {
        x: playerState.pos.x,
        y: playerState.pos.y,
        z: playerState.pos.z,
        rotation: playerState.rot,
        moving: playerState.moving,
        animation: currentAnim,
        timestamp: Date.now()
      }).catch(err => console.error("Update error:", err));
    }
  }, UPDATE_INTERVAL);
}

function updateOtherPlayer(playerId, data) {
  if (!otherPlayers.has(playerId)) {
    const playerData = {
      mesh: null,
      model: null,
      mixer: null,
      idleAction: null,
      walkAction: null,
      runAction: null,
      idleSpecialAction: null,
      emoteWaveAction: null,
      emoteLaughAction: null,
      emotePointAction: null,
      currentAnim: 'idle',
      animation: data.animation || 'idle',
      nameLabel: null,
      targetPos: new THREE.Vector3(data.x || 0, data.y || 0, data.z || 0),
      targetRot: data.rotation || 0,
      moving: data.moving || false,
      health: data.health || 100,
      customization: {
        bodyColor: data.bodyColor || '#77c0ff',
        scale: data.scale || 1.0,
        accessories: data.accessories || { hat: 'none', face: 'none', back: 'none' }
      }
    };

    otherPlayers.set(playerId, playerData);
    createOtherPlayerModel(playerId, playerData, data);
  } else {
    const playerData = otherPlayers.get(playerId);
    if (playerData) {
      playerData.targetPos.set(data.x || playerData.targetPos.x, data.y || playerData.targetPos.y, data.z || playerData.targetPos.z);
      playerData.targetRot = data.rotation !== undefined ? data.rotation : playerData.targetRot;
      playerData.moving = data.moving || false;
      playerData.animation = data.animation || 'idle';
      playerData.health = data.health || 100;

      // Update customization if changed
      if (data.bodyColor) playerData.customization.bodyColor = data.bodyColor;
      if (data.scale) playerData.customization.scale = data.scale;
      // Skip accessories for other players to improve performance
      // if (data.accessories) {
      //   playerData.customization.accessories = data.accessories;
      //   // Reapply accessories if they changed
      //   if (playerData.model) {
      //     applyAccessoriesToPlayer(playerData.model, data.accessories);
      //   }
      // }
    }
  }
}

function createOtherPlayerModel(playerId, playerData, data) {
  const playerLoader = new GLTFLoader();
  const bodyColor = data.bodyColor || '#77c0ff';
  const scale = data.scale || 1.0;

  playerLoader.load("./model/idle.glb", idleGLB => {
    const playerModel = idleGLB.scene;
    playerModel.scale.set(0.35 * scale, 0.35 * scale, 0.35 * scale);
    playerModel.rotation.y = playerData.targetRot;
    playerModel.position.set(playerData.targetPos.x, playerData.targetPos.y, playerData.targetPos.z);

    playerModel.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.color.set(bodyColor);
      }
    });

    // Skip accessories for other players to improve performance
    // applyAccessoriesToPlayer(playerModel, data.accessories || { hat: 'none', face: 'none', back: 'none' });

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
        runAction.timeScale = 3;
        playerData.runAction = runAction;

        playerLoader.load("./model/idle_special1.glb", idleSpecialGLB => {
          const idleSpecialAction = playerMixer.clipAction(idleSpecialGLB.animations[0]);
          idleSpecialAction.loop = THREE.LoopOnce;
          idleSpecialAction.clampWhenFinished = true;
          playerData.idleSpecialAction = idleSpecialAction;

          playerLoader.load("./model/emote_wave.glb", emoteWaveGLB => {
            const emoteWaveAction = playerMixer.clipAction(emoteWaveGLB.animations[0]);
            emoteWaveAction.loop = THREE.LoopOnce;
            emoteWaveAction.clampWhenFinished = true;
            playerData.emoteWaveAction = emoteWaveAction;

            playerLoader.load("./model/emote_laugh.glb", emoteLaughGLB => {
              const emoteLaughAction = playerMixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop = THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished = true;
              playerData.emoteLaughAction = emoteLaughAction;

              playerLoader.load("./model/emote_point.glb", emotePointGLB => {
                const emotePointAction = playerMixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop = THREE.LoopOnce;
                emotePointAction.clampWhenFinished = true;
                playerData.emotePointAction = emotePointAction;
              }, undefined, err => {
                playerData.emotePointAction = null;
              });
            }, undefined, err => {
              playerData.emoteLaughAction = null;
              playerLoader.load("./model/emote_point.glb", emotePointGLB => {
                const emotePointAction = playerMixer.clipAction(emotePointGLB.animations[0]);
                emotePointAction.loop = THREE.LoopOnce;
                emotePointAction.clampWhenFinished = true;
                playerData.emotePointAction = emotePointAction;
              }, undefined, err => {
                playerData.emotePointAction = null;
              });
            });
          }, undefined, err => {
            playerData.emoteWaveAction = null;
            playerLoader.load("./model/emote_laugh.glb", emoteLaughGLB => {
              const emoteLaughAction = playerMixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop = THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished = true;
              playerData.emoteLaughAction = emoteLaughAction;
            }, undefined, err => {
              playerData.emoteLaughAction = null;
            });
          });
        }, undefined, err => {
          playerData.idleSpecialAction = null;
          playerLoader.load("./model/emote_wave.glb", emoteWaveGLB => {
            const emoteWaveAction = playerMixer.clipAction(emoteWaveGLB.animations[0]);
            emoteWaveAction.loop = THREE.LoopOnce;
            emoteWaveAction.clampWhenFinished = true;
            playerData.emoteWaveAction = emoteWaveAction;

            playerLoader.load("./model/emote_laugh.glb", emoteLaughGLB => {
              const emoteLaughAction = playerMixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop = THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished = true;
              playerData.emoteLaughAction = emoteLaughAction;
            }, undefined, err => {
              playerData.emoteLaughAction = null;
            });
          }, undefined, err => {
            playerData.emoteWaveAction = null;
            playerLoader.load("./model/emote_laugh.glb", emoteLaughGLB => {
              const emoteLaughAction = playerMixer.clipAction(emoteLaughGLB.animations[0]);
              emoteLaughAction.loop = THREE.LoopOnce;
              emoteLaughAction.clampWhenFinished = true;
              playerData.emoteLaughAction = emoteLaughAction;
            }, undefined, err => {
              playerData.emoteLaughAction = null;
            });
          });
        });
      }, undefined, err => {
        playerData.runAction = walkAction;
        playerData.idleSpecialAction = null;
        playerData.emoteWaveAction = null;
        playerData.emoteLaughAction = null;
        playerData.emotePointAction = null;
      });
    }, undefined, err => {
      playerData.walkAction = idleAction;
      playerData.runAction = idleAction;
      playerData.idleSpecialAction = null;
      playerData.emoteWaveAction = null;
      playerData.emoteLaughAction = null;
    });
  }, undefined, err => {
    const geometry = new THREE.CapsuleGeometry(0.4 * scale, 1 * scale, 4, 8);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(bodyColor)
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

function updatePlayerListUI(players) {
  const listContent = document.getElementById('playerListContent');
  const playerCount = Object.keys(players).length;

  let html = '';
  Object.keys(players).forEach(playerId => {
    const isMe = playerId === myPlayerId;
    html += `
      <div class="player-item ${isMe ? 'you' : ''}">
        <div class="player-indicator"></div>
        <span>${isMe ? 'You' : playerId.substring(7, 12)}</span>
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

function addChatMessage(username, message) {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgId = Date.now() + Math.random();
  chatMessages.push({ username, message, timestamp, id: msgId });
  if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
  updateChatUI();

  // Fade out after 10 seconds
  setTimeout(() => {
    const msgElement = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (msgElement) msgElement.classList.add('faded');
  }, 10000);
}

function getUsernameColor(username) {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function updateChatUI() {
  const chatDiv = document.getElementById('chatMessages');
  chatDiv.innerHTML = chatMessages.map(msg => {
    const color = getUsernameColor(msg.username);
    return `<div class="chat-msg" data-msg-id="${msg.id}"><strong style="color: ${color};">${msg.username}:</strong> ${msg.message}</div>`;
  }).join('');
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

  // Emit sparkles
  const headPos = new THREE.Vector3(playerState.pos.x, playerState.pos.y + 1.5, playerState.pos.z);
  for (let i = 0; i < sparkleCount; i++) {
    if (sparkleLifetimes[i] <= 0) {
      sparklePositions[i * 3] = headPos.x + (Math.random() - 0.5) * 0.5;
      sparklePositions[i * 3 + 1] = headPos.y + (Math.random() - 0.5) * 0.5;
      sparklePositions[i * 3 + 2] = headPos.z + (Math.random() - 0.5) * 0.5;
      sparkleVelocities[i].set((Math.random() - 0.5) * 1, Math.random() * 0.5 + 0.5, (Math.random() - 0.5) * 1);
      sparkleLifetimes[i] = 1.5;
    }
  }

  // Play 3D animation if available
  if (emoteName === 'wave' && emoteWaveAction) {
    setAnim('emote_wave');
  } else if (emoteName === 'laugh' && emoteLaughAction) {
    setAnim('emote_laugh');
  } else if (emoteName === 'point' && emotePointAction) {
    setAnim('emote_point');
  }
}

document.querySelectorAll('.emote-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emote = btn.dataset.emote;
    playEmote(emote);
  });
});

// ---------- Camera ----------
class CameraController {
  constructor() {
    this.yaw = 0;
    this.pitch = -0.35;
    this.distance = 8;
    this.height = 2;
    this.sensitivity = 0.002;
    this.minDistance = 1;
    this.maxDistance = 15;
    this.minPitch = -1.4;
    this.maxPitch = 0.4;
    this.targetPosition = new THREE.Vector3();
    this.currentPosition = new THREE.Vector3();
    this.smoothSpeed = 0.1;
    this.raycaster = new THREE.Raycaster();
    this.collisionObjects = [];
  }

  addCollisionObject(object) {
    this.collisionObjects.push(object);
  }

  updateMouse(deltaX, deltaY) {
    this.yaw -= deltaX * this.sensitivity;
    this.pitch += deltaY * this.sensitivity;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  zoom(delta) {
    this.distance += delta * 0.5;
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
  }

  update(playerPosition) {
    // Calculate desired camera position
    const offsetX = Math.sin(this.yaw) * this.distance;
    const offsetZ = Math.cos(this.yaw) * this.distance;
    const offsetY = this.height + Math.sin(this.pitch) * this.distance;

    const desiredPosition = new THREE.Vector3(
      playerPosition.x - offsetX,
      playerPosition.y + offsetY,
      playerPosition.z - offsetZ
    );

    // Prevent camera from going below ground level
    const minCameraY = playerPosition.y + 0.5; // Camera should be at least 0.5 units above player
    if (desiredPosition.y < minCameraY) {
      desiredPosition.y = minCameraY;
    }

    // Check for collisions with objects
    const direction = new THREE.Vector3().subVectors(desiredPosition, playerPosition).normalize();
    const distance = playerPosition.distanceTo(desiredPosition);

    this.raycaster.set(playerPosition, direction);

    let closestIntersection = null;
    let minDistance = distance;

    // Check intersections with all collision objects
    for (const object of this.collisionObjects) {
      const intersections = this.raycaster.intersectObject(object, true);
      for (const intersection of intersections) {
        if (intersection.distance < minDistance && intersection.distance > 0.5) { // Don't collide too close to player
          minDistance = intersection.distance;
          closestIntersection = intersection;
        }
      }
    }

    // If we found a collision, adjust camera position
    if (closestIntersection) {
      // Position camera just before the intersection point
      this.targetPosition.copy(direction).multiplyScalar(minDistance - 0.2).add(playerPosition);
    } else {
      this.targetPosition.copy(desiredPosition);
    }

    // Ensure camera doesn't go below minimum height
    if (this.targetPosition.y < minCameraY) {
      this.targetPosition.y = minCameraY;
    }

    // Smooth camera movement
    this.currentPosition.lerp(this.targetPosition, this.smoothSpeed);

    // Update camera
    camera.position.copy(this.currentPosition);
    camera.lookAt(playerPosition.x, playerPosition.y + 2, playerPosition.z);
  }
}

const cameraController = new CameraController();
let lastMouseX = 0, lastMouseY = 0;

// Add collision objects to camera controller
cameraController.addCollisionObject(ground);
cameraController.addCollisionObject(rock1);
cameraController.addCollisionObject(rock2);
cameraController.addCollisionObject(rock3);
cameraController.addCollisionObject(pillar1);
cameraController.addCollisionObject(pillar2);
cameraController.addCollisionObject(platform);
cameraController.addCollisionObject(wall1);
cameraController.addCollisionObject(wall2);

// ---------- Input ----------
const keys = {KeyW:false, KeyA:false, KeyS:false, KeyD:false, ShiftLeft:false, ShiftRight:false};
window.addEventListener("keydown",e=>{ if(keys[e.code]!==undefined) keys[e.code]=true; });
window.addEventListener("keyup",e=>{ if(keys[e.code]!==undefined) keys[e.code]=false; });

// Mouse look
let dragging = false;
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("mousedown", e => {
  if (e.button === 2) {
    dragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
});
document.addEventListener("mouseup", () => dragging = false);
document.addEventListener("mousemove", e => {
  if (!dragging) return;
  const deltaX = e.clientX - lastMouseX;
  const deltaY = e.clientY - lastMouseY;
  cameraController.updateMouse(deltaX, deltaY);
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

// Mouse wheel zoom
document.addEventListener("wheel", e => {
  e.preventDefault();
  cameraController.zoom(e.deltaY * 0.01);
});

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
      leftJoyEl.classList.add('active');
      leftStickEl.classList.add('active');
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
      leftJoyEl.classList.remove('active');
      leftStickEl.classList.remove('active');
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
      cameraController.updateMouse(dx, dy);
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
  const outgoing = currentAnim==='idle'?idleAction:currentAnim==='idleSpecial'?idleSpecialAction:currentAnim==='walk'?walkAction:currentAnim==='run'?runAction:currentAnim==='emote_wave'?emoteWaveAction:currentAnim==='emote_laugh'?emoteLaughAction:currentAnim==='emote_point'?emotePointAction:idleAction;

  if(target==="run" && runAction){
    outgoing.fadeOut(0.2);
    runAction.reset().fadeIn(0.2).play();
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
  else if(target==="emote_wave" && emoteWaveAction){
    outgoing.fadeOut(0.1);
    emoteWaveAction.reset().fadeIn(1).play();
    currentAnim="emote_wave";
  }
  else if(target==="emote_laugh" && emoteLaughAction){
    outgoing.fadeOut(0.1);
    emoteLaughAction.reset().fadeIn(1).play();
    currentAnim="emote_laugh";
  }
  else if(target==="emote_point" && emotePointAction){
    outgoing.fadeOut(0.1);
    emotePointAction.reset().fadeIn(1).play();
    currentAnim="emote_point";
  }
}

function setOtherAnim(playerData, target){
  if(!playerData.idleAction||!playerData.walkAction||playerData.currentAnim===target) return;
  const outgoing = playerData.currentAnim==='idle'?playerData.idleAction:playerData.currentAnim==='idleSpecial'?playerData.idleSpecialAction:playerData.currentAnim==='walk'?playerData.walkAction:playerData.currentAnim==='run'?playerData.runAction:playerData.currentAnim==='emote_wave'?playerData.emoteWaveAction:playerData.currentAnim==='emote_laugh'?playerData.emoteLaughAction:playerData.currentAnim==='emote_point'?playerData.emotePointAction:playerData.idleAction;

  if(target==="run" && playerData.runAction){
    outgoing.fadeOut(0.2);
    playerData.runAction.reset().fadeIn(0.05).play();
    playerData.currentAnim="run";
  }
  else if(target==="walk"){
    outgoing.fadeOut(0.2);
    playerData.walkAction.reset().fadeIn(0.2).play();
    playerData.currentAnim="walk";
  }
  else if(target==="idle"){
    outgoing.fadeOut(0.2);
    playerData.idleAction.reset().fadeIn(0.2).play();
    playerData.currentAnim="idle";
  }
  else if(target==="idleSpecial" && playerData.idleSpecialAction){
    outgoing.fadeOut(0.1);
    playerData.idleSpecialAction.reset().fadeIn(1).play();
    playerData.currentAnim="idleSpecial";
  }
  else if(target==="emote_wave" && playerData.emoteWaveAction){
    outgoing.fadeOut(0.1);
    playerData.emoteWaveAction.reset().fadeIn(1).play();
    playerData.currentAnim="emote_wave";
  }
  else if(target==="emote_laugh" && playerData.emoteLaughAction){
    outgoing.fadeOut(0.1);
    playerData.emoteLaughAction.reset().fadeIn(1).play();
    playerData.currentAnim="emote_laugh";
  }
  else if(target==="emote_point" && playerData.emotePointAction){
    outgoing.fadeOut(0.1);
    playerData.emotePointAction.reset().fadeIn(1).play();
    playerData.currentAnim="emote_point";
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
  if(currentAnim==='emote_wave' && emoteWaveAction && !emoteWaveAction.isRunning()){
    setAnim("idle");
  }
  if(currentAnim==='emote_laugh' && emoteLaughAction && !emoteLaughAction.isRunning()){
    setAnim("idle");
  }
  if(currentAnim==='emote_point' && emotePointAction && !emotePointAction.isRunning()){
    setAnim("idle");
  }

  updateGamepadInput();

  fpsCounter++;
  if(fpsCounter%10===0) fpsDisplay=Math.round(1/dt);

  if(model){
    let forward=(keys.KeyW?1:0)+(keys.KeyS?-1:0);
    let sideways=(keys.KeyD?1:0)+(keys.KeyA?-1:0);

    // Combine PC sprint, mobile sprint, gamepad sprint (can't sprint if stamina is 0 or sprint is blocked)
    isSprinting =
      (
        keys.ShiftLeft ||
        keys.ShiftRight ||
        sprintTouch.active
      ) &&
      (Math.abs(forward)>0 || Math.abs(sideways)>0) &&
      playerStamina > 0 &&
      sprintBlockTimer <= 0;

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
        cameraController.updateMouse(rx*n*0.06*settings.gamepadSensitivity, ry*n*0.06*settings.gamepadSensitivity);
      }
    }

    const moving=Math.abs(forward)>0 || Math.abs(sideways)>0;
    if(moving){
      const camF=new THREE.Vector3(Math.sin(cameraController.yaw),0,Math.cos(cameraController.yaw));
      const camR=new THREE.Vector3(-Math.cos(cameraController.yaw),0,Math.sin(cameraController.yaw));
      let moveDir=new THREE.Vector3().addScaledVector(camF,forward).addScaledVector(camR,sideways);
      const mag=moveDir.length(); if(mag>1) moveDir.normalize();

      const targetRot=Math.atan2(moveDir.x, moveDir.z)+Math.PI;
      let rotDiff=normalizeAngle(targetRot-playerState.rot);
      playerState.rot+=rotDiff*0.2;
      playerState.rot=normalizeAngle(playerState.rot);
      model.rotation.y=playerState.rot;

      // Update camera with new controller
      cameraController.update(playerState.pos);

      const speed=isSprinting?sprintSpeed:moveSpeed;
      playerState.pos.add(moveDir.multiplyScalar(speed*dt));
      model.position.copy(playerState.pos);

      setAnim(isSprinting ? "run" : "walk");
      playerState.moving=true;

      // Stamina depletion when sprinting
      if(isSprinting && playerStamina > 0){
        const prevStamina = playerStamina;
        playerStamina = Math.max(0, playerStamina - 10 * dt);
        // Start timers when stamina reaches 0
        if (prevStamina > 0 && playerStamina === 0) {
          staminaRecoveryTimer = 1.0; // 1 second delay before recovery starts
          sprintBlockTimer = 1.0; // 1 second sprint block
        }
      }
    }
    else {
      idleTimer+=dt;
      if(idleTimer>=nextIdleSpecialTime && idleSpecialAction && currentAnim==='idle'){
        setAnim("idleSpecial");
        idleTimer=0;
        nextIdleSpecialTime=Math.random()*15+5;
      }
      else if(currentAnim!=='idle' && currentAnim!=='idleSpecial' && !currentAnim.includes('emote')){
        setAnim("idle");
      }
      playerState.moving=false;
      isSprinting=false;

      // Update camera even when not moving
      cameraController.update(playerState.pos);
    }

    // Update timers (always)
    if (staminaRecoveryTimer > 0) {
      staminaRecoveryTimer -= dt;
    }
    if (sprintBlockTimer > 0) {
      sprintBlockTimer -= dt;
    }

    // Stamina recovery when recovery timer is done (while walking or standing, but not sprinting)
    if(playerStamina < maxStamina && staminaRecoveryTimer <= 0 && !isSprinting){
      playerStamina = Math.min(maxStamina, playerStamina + 15 * dt);
    }
  }

  // Update other players (smooth interpolation)
  otherPlayers.forEach((playerData) => {
    if (!playerData.mesh) return;

    // Update animations
    if (playerData.mixer) {
      playerData.mixer.update(dt);

      // Switch animations based on synced animation state
      if (playerData.animation !== playerData.currentAnim) {
        setOtherAnim(playerData, playerData.animation);
      }

      // Reset finished one-shot animations to idle
      if (playerData.currentAnim === 'idleSpecial' && playerData.idleSpecialAction && !playerData.idleSpecialAction.isRunning()) {
        setOtherAnim(playerData, 'idle');
      }
      if (playerData.currentAnim === 'emote_wave' && playerData.emoteWaveAction && !playerData.emoteWaveAction.isRunning()) {
        setOtherAnim(playerData, 'idle');
      }
      if (playerData.currentAnim === 'emote_laugh' && playerData.emoteLaughAction && !playerData.emoteLaughAction.isRunning()) {
        setOtherAnim(playerData, 'idle');
      }
      if (playerData.currentAnim === 'emote_point' && playerData.emotePointAction && !playerData.emotePointAction.isRunning()) {
        setOtherAnim(playerData, 'idle');
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



  // Emit sweat particles when stamina is low (performance optimization: less frequent on mobile)
  const sweatEmitChance = isMobile ? 0.03 : 0.1; // 3% chance on mobile, 10% on desktop
  if (playerStamina < 50 && Math.random() < sweatEmitChance) {
    for (let i = 0; i < sweatCount; i++) {
      if (sweatLifetimes[i] <= 0) {
        sweatPositions[i * 3] = playerState.pos.x + (Math.random() - 0.5) * 2.0; // Wider spread
        sweatPositions[i * 3 + 1] = playerState.pos.y + 2.0; // Higher up
        sweatPositions[i * 3 + 2] = playerState.pos.z + (Math.random() - 0.5) * 2.0; // Wider spread
        sweatVelocities[i].set((Math.random() - 0.5) * 1.0, 0, (Math.random() - 0.5) * 1.0); // No initial Y velocity
        sweatLifetimes[i] = 2.0; // Shorter lifetime to free up slots faster
        if (!isMobile) console.log('Sweat particle emitted at:', sweatPositions[i * 3], sweatPositions[i * 3 + 1], sweatPositions[i * 3 + 2]); // Only log on desktop
        break;
      }
    }
  }





  // Update dust particles
  for (let i = 0; i < dustCount; i++) {
    // Update lifetime
    dustLifetimes[i] -= dt;

    // Respawn particle if lifetime expired or out of bounds
    if (dustLifetimes[i] <= 0 || dustPositions[i * 3 + 1] > 8 || dustPositions[i * 3 + 1] < 0) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 80;
      dustPositions[i * 3 + 1] = Math.random() * 4 + 1;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      dustVelocities[i].set((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.01, (Math.random() - 0.5) * 0.02);
      dustOscillation[i].phase = Math.random() * Math.PI * 2;
      dustLifetimes[i] = Math.random() * 10 + 5;
    } else {
      // Check distance to player and react if close
      const dx = dustPositions[i * 3] - playerState.pos.x;
      const dy = dustPositions[i * 3 + 1] - playerState.pos.y;
      const dz = dustPositions[i * 3 + 2] - playerState.pos.z;
      const distanceToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // If player is close (within 8 units) and moving, disturb the dust
      if (distanceToPlayer < 8 && playerState.moving) {
        const disturbanceStrength = (8 - distanceToPlayer) / 8; // Stronger when closer
        const pushDirection = new THREE.Vector3(dx, 0, dz).normalize();

        // Push dust away from player (stronger push)
        dustVelocities[i].x += pushDirection.x * disturbanceStrength * 0.3;
        dustVelocities[i].z += pushDirection.z * disturbanceStrength * 0.3;
        dustVelocities[i].y += 0.02; // Very slight upward boost

        // Add some randomness to make it more natural
        dustVelocities[i].x += (Math.random() - 0.5) * 0.05;
        dustVelocities[i].z += (Math.random() - 0.5) * 0.05;

        // Increase oscillation for disturbed particles
        dustOscillation[i].phase += dt * 2.0;
      } else {
        // Apply friction to slow down disturbed particles
        dustVelocities[i].x *= 0.98;
        dustVelocities[i].y *= 0.98;
        dustVelocities[i].z *= 0.98;

        // Normal oscillation for undisturbed particles
        dustOscillation[i].phase += dt * 0.5;
      }

      // Apply movement
      dustPositions[i * 3] += dustVelocities[i].x * dt;
      dustPositions[i * 3 + 1] += dustVelocities[i].y * dt;
      dustPositions[i * 3 + 2] += dustVelocities[i].z * dt;

      // Add subtle floating oscillation
      dustPositions[i * 3 + 1] += Math.sin(dustOscillation[i].phase) * dustOscillation[i].amplitude * dt * 0.1;
    }
  }
  dustGeometry.attributes.position.needsUpdate = true;

  // Update sparkle particles
  for (let i = 0; i < sparkleCount; i++) {
    if (sparkleLifetimes[i] > 0) {
      sparklePositions[i * 3] += sparkleVelocities[i].x * dt;
      sparklePositions[i * 3 + 1] += sparkleVelocities[i].y * dt;
      sparklePositions[i * 3 + 2] += sparkleVelocities[i].z * dt;
      sparkleVelocities[i].y -= 9.8 * dt;
      sparkleLifetimes[i] -= dt;
    } else {
      sparklePositions[i * 3] = 0;
      sparklePositions[i * 3 + 1] = 0;
      sparklePositions[i * 3 + 2] = 0;
    }
  }
  sparkleGeometry.attributes.position.needsUpdate = true;

  // Update sweat particles
  for (let i = 0; i < sweatCount; i++) {
    if (sweatLifetimes[i] > 0) {
      sweatPositions[i * 3] += sweatVelocities[i].x * dt;
      sweatPositions[i * 3 + 1] += sweatVelocities[i].y * dt;
      sweatPositions[i * 3 + 2] += sweatVelocities[i].z * dt;
      sweatVelocities[i].y -= 9.8 * dt;
      sweatLifetimes[i] -= dt;
    } else {
      sweatPositions[i * 3] = 0;
      sweatPositions[i * 3 + 1] = 0;
      sweatPositions[i * 3 + 2] = 0;
    }
  }
  sweatGeometry.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
  hudState.gamepad=!!gamepad.active;
  updateHud();
  updateStatsUI();
}
animate();

// ---------- Resize ----------
window.addEventListener("resize", ()=>{
  renderer.setSize(window.innerWidth,window.innerHeight);
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
});

updateLeftStick(0,0);
