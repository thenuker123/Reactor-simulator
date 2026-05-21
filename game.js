/*
* NUCLEARES - High-Fidelity Reactor Simulation
* Core Thermodynamic Engine, Grid Sync, and Firebase Cloud Logic
*/

// ===== STATE VARIABLES =====
let state = {
    // Core Physics
    coreTemperature: 20.0,
    primaryPressure: 1.0,
    boronConcentration: 0, // ppm
    controlRodsDepth: 100, // %

    // Secondary Loop
    sgWaterLevel: 100.0, // %
    secondaryPressure: 1.0, // Bar
    mainSteamValveOpen: false,

    // Turbine & Grid
    turbineRpm: 0,
    gridPhaseAngle: 0.0,
    gridConnected: false,
    gridDemand: 300, // MW

    // Financials
    accumulatedMoney: 0,

    // System Status
    isScrammed: false,
    gameOver: false,
    user: null, // Firebase user object
};

// ===== CONSTANTS & CONFIG =====
const TICK_RATE_MS = 1000;
const SAVE_INTERVAL_MS = 30000;
const GRID_FREQUENCY_HZ = 50;
const BASELINE_RPM = 3000;
const MAX_TURBINE_RPM = 4000;
const PHASE_LOCK_TOLERANCE = 5.0; // degrees
const GRID_MISMATCH_PENALTY = 4000;

// DOM element references
const DOMElements = {};

// ===== INITIALIZATION =====
window.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements
    const ids = [
        'core-temp-value', 'primary-pressure-value', 'rod-depth-display', 'boron-conc-display',
        'sg-water-level-value', 'secondary-pressure-value', 'turbine-rpm-value', 'phase-angle-value',
        'grid-demand-value', 'money-value', 'event-log', 'scram-btn', 'steam-valve-btn', 'breaker-btn',
        'annun-scram', 'annun-primary-overpressure', 'annun-core-void', 'annun-grid-mismatch', 'annun-sg-low', 'annun-turbine-trip'
    ];
    ids.forEach(id => DOMElements[id] = document.getElementById(id));

    initFirebase();
    setInterval(gameLoop, TICK_RATE_MS);
    setInterval(saveGameData, SAVE_INTERVAL_MS);
    logEvent('System Initialized. Ready for startup.', 'system');
});

// ===== FIREBASE INTEGRATION =====
function initFirebase() {
    const auth = firebase.auth();
    auth.signInAnonymously().then(credential => {
        state.user = credential.user;
        logEvent(`Anonymous user signed in: ${state.user.uid}`, 'success');
    }).catch(error => {
        logEvent(`Firebase Auth Error: ${error.message}`, 'danger');
    });
}

function saveGameData() {
    if (!state.user || state.gameOver) return;
    const db = firebase.firestore();
    const saveData = {
        coreTemperature: state.coreTemperature,
        primaryPressure: state.primaryPressure,
        boronConcentration: state.boronConcentration,
        sgWaterLevel: state.sgWaterLevel,
        secondaryPressure: state.secondaryPressure,
        turbineRpm: state.turbineRpm,
        accumulatedMoney: state.accumulatedMoney,
        isScrammed: state.isScrammed,
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection('player_saves').doc(state.user.uid).set(saveData, { merge: true })
        .then(() => logEvent('Cloud sync complete.', 'system'))
        .catch(error => logEvent(`Save Error: ${error.message}`, 'danger'));
}

// ===== CORE GAME LOOP =====
function gameLoop() {
    if (state.gameOver) return;

    // Run simulation modules
    simulateCore();
    simulateSecondaryLoop();
    simulateTurbineAndGrid();
    updateAnnunciator();

    // Update all UI readouts
    updateUI();
}

// ===== SIMULATION MODULES =====
function simulateCore() {
    if (state.isScrammed) {
        // Rapidly cool down if SCRAMmed
        state.coreTemperature = Math.max(20, state.coreTemperature * 0.95);
        return;
    }

    // Reactivity calculation
    const rodReactivity = 1 - (state.controlRodsDepth / 100); // 0 to 1
    const boronDampening = state.boronConcentration / 8000; // 0 to 0.5
    const netReactivity = Math.max(0, rodReactivity - boronDampening);

    // Temperature change - exponential based on reactivity
    const tempIncrease = netReactivity * Math.exp(netReactivity * 1.5) * 5;
    state.coreTemperature += tempIncrease;

    // Pressure increases with temperature
    state.primaryPressure = state.coreTemperature * 0.08;
    
    // Simple cooling effect
    state.coreTemperature *= 0.998;
}

function simulateSecondaryLoop() {
    // Heat transfer from primary to secondary
    if (state.coreTemperature > 100) {
        const energyTransfer = (state.coreTemperature - 100) / 50;
        state.secondaryPressure += energyTransfer;
        state.sgWaterLevel -= energyTransfer * 0.1;
    }

    // Steam usage by turbine
    if (state.mainSteamValveOpen && state.secondaryPressure > 1) {
        const steamDraw = state.turbineRpm / 1000;
        state.secondaryPressure -= steamDraw;
    }

    // Clamp values
    state.sgWaterLevel = Math.max(0, state.sgWaterLevel);
    state.secondaryPressure = Math.max(1, state.secondaryPressure);
}

function simulateTurbineAndGrid() {
    // Turbine RPM based on steam pressure
    if (state.mainSteamValveOpen) {
        const targetRpm = (state.secondaryPressure / 80) * MAX_TURBINE_RPM;
        state.turbineRpm = approach(state.turbineRpm, targetRpm, 150);
    } else {
        state.turbineRpm = approach(state.turbineRpm, 0, 100);
    }

    // Phase Angle Drift
    const rpmDifference = state.turbineRpm - BASELINE_RPM;
    const drift = rpmDifference / 20; // Degrees per second
    state.gridPhaseAngle = (state.gridPhaseAngle + drift) % 360;
    if (state.gridPhaseAngle < 0) state.gridPhaseAngle += 360;
    
    // Revenue Generation
    if(state.gridConnected) {
        state.accumulatedMoney += state.gridDemand * 0.1;
    }
}

// ===== UI & CONTROLS =====
function updateUI() {
    DOMElements['core-temp-value'].textContent = `${state.coreTemperature.toFixed(1)} °C`;
    DOMElements['primary-pressure-value'].textContent = `${state.primaryPressure.toFixed(1)} Bar`;
    DOMElements['rod-depth-display'].textContent = state.controlRodsDepth;
    DOMElements['boron-conc-display'].textContent = state.boronConcentration;
    DOMElements['sg-water-level-value'].textContent = `${state.sgWaterLevel.toFixed(1)} %`;
    DOMElements['secondary-pressure-value'].textContent = `${state.secondaryPressure.toFixed(1)} Bar`;
    DOMElements['turbine-rpm-value'].textContent = `${state.turbineRpm.toFixed(0)} RPM`;
    DOMElements['phase-angle-value'].textContent = `${state.gridPhaseAngle.toFixed(1)} °`;
    DOMElements['money-value'].textContent = `$${Math.floor(state.accumulatedMoney)}`;
}

function updateAnnunciator() {
    setIndicator('annun-scram', state.isScrammed);
    setIndicator('annun-primary-overpressure', state.primaryPressure > 160);
    setIndicator('annun-core-void', state.sgWaterLevel < 10);
    
    const phaseDiff = Math.abs((state.gridPhaseAngle + 180) % 360 - 180);
    setIndicator('annun-grid-mismatch', phaseDiff > PHASE_LOCK_TOLERANCE && !state.gridConnected);
}

function setIndicator(id, isActive) {
    DOMElements[id].classList.toggle('active', isActive);
}

function updateControlRods(value) { state.controlRodsDepth = parseInt(value); }

function adjustBoron(amount) {
    state.boronConcentration = Math.max(0, Math.min(4000, state.boronConcentration + amount));
    logEvent(`Boron concentration adjusted to ${state.boronConcentration} ppm.`, 'control');
}

function toggleSteamValve() {
    state.mainSteamValveOpen = !state.mainSteamValveOpen;
    DOMElements['steam-valve-btn'].textContent = state.mainSteamValveOpen ? 'OPEN' : 'CLOSED';
    DOMElements['steam-valve-btn'].classList.toggle('btn-on', state.mainSteamValveOpen);
    DOMElements['steam-valve-btn'].classList.toggle('btn-off', !state.mainSteamValveOpen);
    logEvent(`Main Steam Valve ${state.mainSteamValveOpen ? 'Opened' : 'Closed'}.`, 'control');
}

function toggleMainBreaker() {
    const phaseDifference = Math.min(state.gridPhaseAngle, 360 - state.gridPhaseAngle);
    if (!state.gridConnected && phaseDifference > PHASE_LOCK_TOLERANCE) {
        // Grid Explosion!
        state.accumulatedMoney -= GRID_MISMATCH_PENALTY;
        activateSCRAM();
        logEvent('GRID EXPLOSION! Phase mismatch lockout failed.', 'danger');
        triggerMajorFailure('GRID EXPLOSION', `Phase mismatch of ${phaseDifference.toFixed(1)}° caused a catastrophic grid failure. Financial penalty applied.`);
        return;
    }

    state.gridConnected = !state.gridConnected;
    DOMElements['breaker-btn'].textContent = state.gridConnected ? 'CONNECTED' : 'OPEN';
    DOMElements['breaker-btn'].classList.toggle('btn-on', state.gridConnected);
    DOMElements['breaker-btn'].classList.toggle('btn-off', !state.gridConnected);
    logEvent(`Main Breaker ${state.gridConnected ? 'Connected to Grid' : 'Disconnected'}.`, state.gridConnected ? 'success' : 'warning');
}

function activateSCRAM() {
    state.isScrammed = true;
    state.controlRodsDepth = 100; // Force rods in
    state.mainSteamValveOpen = false; // Trip turbine
    state.gridConnected = false; // Disconnect from grid
    logEvent('EMERGENCY REACTOR SCRAM INITIATED', 'danger');
}

function triggerMajorFailure(title, message) {
    state.gameOver = true;
    document.getElementById('game-over-overlay').classList.remove('hidden');
    document.getElementById('game-over-title').textContent = title;
    document.getElementById('game-over-message').textContent = message;
}

// ===== UTILITY FUNCTIONS =====
function approach(current, target, rate) {
    if (current < target) return Math.min(current + rate, target);
    if (current > target) return Math.max(current - rate, target);
    return target;
}

function logEvent(message, type = 'info') {
    const log = DOMElements['event-log'];
    const time = new Date().toLocaleTimeString();
    log.innerHTML += `<div class="log-${type}">[${time}] ${message}</div>`;
    log.scrollTop = log.scrollHeight;
}
