/*
 * NUCLEARES - Complex Reactor Simulator
 * Core simulation logic and Firebase integration
 */

// ===== GAME STATE =====
const state = {
    running: false,
    time: 0,
    revenue: 0,
    gameOver: false,
    uid: null, // Firebase anonymous user ID

    // Reactor Core
    coreTemp: 20,           // °C
    waterLevel: 100,        // %
    steamPressure: 0,       // bar
    controlRodDepth: 100,   // % (100 = fully in)

    // Primary Coolant Loop
    coolantPumpOn: false,
    coolantPumpOutput: 0,   // %
    primaryFlowRate: 0,     // kg/s

    // Turbine & Generator
    turbineRPM: 0,          
    generatorOutput: 0,     // MW

    // Emergency
    radiationLevel: 0.1,    // mSv/h
    containmentStatus: 'NORMAL',
    alarms: [],
};

// ===== CONSTANTS =====
const TICK_RATE = 1000; // 1-second interval for the main game loop
const SAVE_INTERVAL = 30000; // 30 seconds for autosave
const MAX_CORE_TEMP = 1200;
const MAX_STEAM_PRESSURE = 100;
const PRESSURE_ALARM_THRESHOLD = 85;

// ===== DOM REFERENCES =====
let logEl, alarmListEl;

// ===== INITIALIZATION =====
window.addEventListener('DOMContentLoaded', () => {
    logEl = document.getElementById('event-log');
    alarmListEl = document.getElementById('alarm-list');
    initFirebase();
    updateAllDisplays();
});

function initFirebase() {
    auth.signInAnonymously().then(userCredential => {
        state.uid = userCredential.user.uid;
        logEvent('info', 'Firebase anonymous authentication successful.');
        // Set up the recurring save function
        setInterval(savePlayerData, SAVE_INTERVAL);
    }).catch(error => {
        logEvent('danger', `Firebase Auth Error: ${error.message}`);
    });
}

function startGame() {
    document.getElementById('start-overlay').classList.add('hidden');
    state.running = true;
    logEvent('info', 'Simulation started.');
    gameLoop();
}

function restartGame() { location.reload(); }

// ===== GAME LOOP (1-second interval) =====
function gameLoop() {
    if (!state.running || state.gameOver) return;

    simulatePhysics();
    checkAlarms();
    updateAllDisplays();

    setTimeout(gameLoop, TICK_RATE);
}


// ===== PHYSICS SIMULATION =====
function simulatePhysics() {
    // --- Temperature Calculation ---
    const rodEffectiveness = 1 - (state.controlRodDepth / 100); // 0 (in) to 1 (out)
    const pumpEffectiveness = state.coolantPumpOutput / 100; // 0 to 1
    
    // Exponential temperature increase based on rods, cooled by pumps
    let tempChange = (rodEffectiveness * 5) * Math.exp(rodEffectiveness * 0.5) - (pumpEffectiveness * 10);
    state.coreTemp += tempChange;
    state.coreTemp = Math.max(20, state.coreTemp);

    // --- Steam Pressure Calculation ---
    if(state.coreTemp > 100) {
        // Pressure builds faster at higher temperatures
        let pressureIncrease = (state.coreTemp / MAX_CORE_TEMP) * 2;
        state.steamPressure += pressureIncrease;
    }
    state.steamPressure = Math.min(MAX_STEAM_PRESSURE, Math.max(0, state.steamPressure));

    // --- Turbine and Generator ---
    if(state.steamPressure > 10) {
        state.turbineRPM = (state.steamPressure / MAX_STEAM_PRESSURE) * 3500;
        state.generatorOutput = (state.turbineRPM / 3000) * (state.coreTemp/MAX_CORE_TEMP) * 1000;
    } else {
        state.turbineRPM = 0;
        state.generatorOutput = 0;
    }
    state.generatorOutput = Math.max(0, state.generatorOutput);

    // --- Revenue ---
    state.revenue += state.generatorOutput * 0.1; // Arbitrary revenue calculation

    // --- Meltdown Check ---
    if (state.coreTemp >= MAX_CORE_TEMP) {
        triggerMeltdown();
    }
}

// ===== FIREBASE DATA SAVE =====
function savePlayerData() {
    if (!state.uid || state.gameOver) return;

    const saveData = {
        coreTemp: state.coreTemp,
        revenue: state.revenue,
        steamPressure: state.steamPressure,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('player_saves').doc(state.uid).set(saveData)
        .then(() => {
            logEvent('info', 'Game state saved to cloud.');
        })
        .catch(error => {
            logEvent('warning', `Save failed: ${error.message}`);
        });
}

// ===== ALARMS =====
function checkAlarms() {
    state.alarms = []; // Reset alarms each tick
    if (state.steamPressure > PRESSURE_ALARM_THRESHOLD) {
        state.alarms.push({ text: 'HIGH STEAM PRESSURE', level: 'danger' });
    }
    if (state.coreTemp > 800) {
        state.alarms.push({ text: 'CRITICAL CORE TEMP', level: 'danger' });
    }
    renderAlarms();
}

function renderAlarms() {
    alarmListEl.innerHTML = state.alarms.map(a => 
        `<span class="alarm-item ${a.level}">${a.text}</span>`
    ).join('');
    document.getElementById('alarm-bar').classList.toggle('has-alarms', state.alarms.length > 0);
}

// ===== CONTROLS =====
function updateRodPosition(val) {
    state.controlRodDepth = parseInt(val);
}

function toggleSwitch(name) {
    if(name === 'primaryPump') {
        state.coolantPumpOn = !state.coolantPumpOn;
        // For simplicity, let's say pump output is 100% when on.
        state.coolantPumpOutput = state.coolantPumpOn ? 100 : 0;
        document.getElementById('primary-pump-btn').className = state.coolantPumpOn ? 'btn btn-small btn-on' : 'btn btn-small btn-off';
    }
}

function ventSteam() {
    if(state.steamPressure > 0) {
        state.steamPressure -= 15;
        logEvent('warning', 'Manual steam vent activated.');
    }
}

function activateSCRAM() {
    state.controlRodDepth = 100;
    logEvent('danger', 'SCRAM ACTIVATED! Control rods fully inserted.');
}

// ===== DISPLAY UPDATES =====
function updateAllDisplays() {
    // Core
    document.getElementById('core-temp-value').textContent = `${state.coreTemp.toFixed(1)}°C`;
    document.getElementById('steam-pressure-value').textContent = `${state.steamPressure.toFixed(1)} bar`;
    document.getElementById('rod-pos-display').textContent = `${state.controlRodDepth}%`;
    document.getElementById('control-rods').value = state.controlRodDepth;

    // Visual Bars
    setGaugeBar('core-temp-bar', state.coreTemp, MAX_CORE_TEMP);
    setGaugeBar('steam-pressure-bar', state.steamPressure, MAX_STEAM_PRESSURE);

    // Turbine & Revenue
    document.getElementById('turbine-rpm-value').textContent = `${state.turbineRPM.toFixed(0)} RPM`;
    document.getElementById('generator-output-value').textContent = `${state.generatorOutput.toFixed(0)} MW`;
    document.getElementById('revenue-value').textContent = `$${state.revenue.toFixed(0)}`;
}

function setGaugeBar(id, value, max) {
    const el = document.getElementById(id);
    if (!el) return;
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    el.style.width = pct + '%';
    // Add color logic based on percentage
    if (pct > 85) el.className = 'gauge-bar danger';
    else if (pct > 60) el.className = 'gauge-bar orange';
    else el.className = 'gauge-bar green';
}

function triggerMeltdown() {
    state.gameOver = true;
    state.running = false;
    const overlay = document.getElementById('game-over-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('game-over-message').textContent = `Core meltdown at ${state.coreTemp.toFixed(0)}°C. Catastrophic failure.`;
}

function logEvent(level, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    entry.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString()}]</span> ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}
