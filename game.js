// ============================================================
// NUCLEARES - Nuclear Reactor Simulator
// Full PWR (Pressurized Water Reactor) Simulation
// ============================================================

// ===== GAME STATE =====
const state = {
    running: false,
    speed: 1,
    time: 0, // in-game seconds
    revenue: 0,
    gameOver: false,
    scramActive: false,
    meltdown: false,

    // Fuel
    fuelLoaded: false,
    fuelIntegrity: 100, // 0-100%

    // Reactor Core
    coreTemp: 20,           // °C (ambient to ~350 max safe, >500 damage, >1200 meltdown)
    reactorPower: 0,        // 0-100% thermal power
    neutronFlux: 0,         // 0-100%
    controlRodPosition: 100, // 100 = fully inserted (no reaction), 0 = fully withdrawn
    xenonLevel: 0,          // Xenon-135 poisoning 0-100
    decayHeat: 0,           // residual decay heat after shutdown

    // Pressurizer
    pzrHeaters: false,
    pzrThermostat: false,
    pzrPressure: 1,         // bar (target ~155 bar for PWR)
    pzrTemp: 20,            // °C

    // Primary Coolant Loop
    primaryPump: false,
    primaryPumpSpeed: 0,    // 0-100%
    primaryFlowRate: 0,     // kg/s (max ~1000)
    primaryCoolantTemp: 20, // °C

    // Steam Generator
    steamTemp: 20,          // °C
    steamPressure: 0,       // bar (max ~70)
    steamFlowRate: 0,       // kg/s

    // Secondary / Condenser
    condenserPump: false,
    condenserPumpSpeed: 0,
    condenserVacuum: false,
    condenserVacuumLevel: 0, // 0-100%
    secondaryPump: false,
    secondaryPumpSpeed: 0,
    secondaryFlowRate: 0,

    // Turbine & Generator
    mscvOpen: false,
    mscvOpening: 0,         // 0-100%
    turbineRPM: 0,          // target ~3000 RPM
    generatorOutput: 0,     // MW (max ~1000)
    generatorMode: false,   // false=manual, true=auto
    circuitBreaker: false,  // open/closed
    synchroAngle: 0,        // synchroscope angle

    // Grid & City
    cityConnection: false,
    cityDemand: 0,          // MW - varies over time
    powerSupplied: 0,       // MW
    gridFrequency: 0,       // Hz (target 50 Hz)

    // External Power
    externalPower: false,

    // Emergency
    containmentSpray: false,
    radiationLevel: 0.1,    // mSv/h
    containmentStatus: 'NORMAL', // NORMAL, ELEVATED, CRITICAL, BREACH

    // Alarms
    alarms: [],

    // Random events
    nextEventTime: 300,
    eventActive: null
};

// ===== CONSTANTS =====
const TICK_RATE = 50; // ms per tick
const MAX_CORE_TEMP = 1200;
const MELTDOWN_TEMP = 1200;
const DAMAGE_TEMP = 500;
const NOMINAL_PRESSURE = 155; // bar
const NOMINAL_CORE_TEMP = 300; // °C
const TARGET_RPM = 3000;
const TARGET_FREQUENCY = 50; // Hz
const MAX_POWER_MW = 1000;
const MAX_CITY_DEMAND = 800;

// ===== DOM REFERENCES =====
let logEl, alarmListEl;

// ===== INITIALIZATION =====
function startGame() {
    document.getElementById('start-overlay').classList.add('hidden');
    state.running = true;
    state.speed = 1;
    updateSpeedButtons();
    logEvent('info', 'Simulation started. Plant is in cold shutdown state.');
    logEvent('info', 'Begin by turning on External Power from the Emergency panel.');
    gameLoop();
}

function restartGame() {
    location.reload();
}

function init() {
    logEl = document.getElementById('event-log');
    alarmListEl = document.getElementById('alarm-list');
    drawReactorCanvas();
    drawSynchroscope();
    updateAllDisplays();
}

// ===== GAME LOOP =====
let lastTick = 0;
function gameLoop() {
    if (!state.running || state.gameOver) return;
    const now = performance.now();
    if (now - lastTick >= TICK_RATE) {
        const dt = (state.speed * TICK_RATE) / 1000; // seconds of game time per tick
        state.time += dt;
        simulatePhysics(dt);
        checkAlarms();
        checkEvents(dt);
        updateAllDisplays();
        lastTick = now;
    }
    requestAnimationFrame(gameLoop);
}

// ===== PHYSICS SIMULATION =====
function simulatePhysics(dt) {
    if (state.gameOver) return;

    // === External Power ===
    const hasPower = state.externalPower || state.generatorOutput > 5;

    // === Pressurizer ===
    if (state.pzrHeaters && hasPower) {
        const heatRate = state.pzrThermostat ? 0.8 : 1.5;
        state.pzrTemp = approach(state.pzrTemp, 345, heatRate * dt);
        state.pzrPressure = approach(state.pzrPressure, NOMINAL_PRESSURE, 2.0 * dt);
    } else {
        state.pzrTemp = approach(state.pzrTemp, 20, 0.3 * dt);
        state.pzrPressure = approach(state.pzrPressure, 1, 0.5 * dt);
    }

    // === Neutron Flux & Reactor Power ===
    if (state.fuelLoaded && !state.scramActive) {
        const rodReactivity = (100 - state.controlRodPosition) / 100; // 0 to 1
        const xenonPoisoning = state.xenonLevel / 200; // dampening factor
        const targetFlux = Math.max(0, (rodReactivity - xenonPoisoning) * 100);
        const fluxRate = rodReactivity > 0.5 ? 3.0 : 1.5;
        state.neutronFlux = approach(state.neutronFlux, targetFlux, fluxRate * dt);
    } else if (state.scramActive) {
        state.neutronFlux = approach(state.neutronFlux, 0, 20 * dt);
    } else {
        state.neutronFlux = approach(state.neutronFlux, 0, 5 * dt);
    }

    // Reactor thermal power follows flux with delay
    const pressureFactor = Math.min(state.pzrPressure / NOMINAL_PRESSURE, 1);
    const targetPower = state.neutronFlux * pressureFactor;
    state.reactorPower = approach(state.reactorPower, targetPower, 2.0 * dt);

    // Decay heat after shutdown
    if (state.reactorPower < 5 && state.decayHeat > 0) {
        state.decayHeat = approach(state.decayHeat, 0, 0.05 * dt);
    } else if (state.reactorPower > 20) {
        state.decayHeat = state.reactorPower * 0.07; // 7% of operating power
    }

    // Xenon-135 buildup/decay
    if (state.neutronFlux > 10) {
        state.xenonLevel = approach(state.xenonLevel, state.neutronFlux * 0.3, 0.1 * dt);
    } else if (state.xenonLevel > 0) {
        // Xenon peak after shutdown then decay
        if (state.reactorPower < 5) {
            state.xenonLevel = approach(state.xenonLevel, 0, 0.02 * dt);
        }
    }

    // === Core Temperature ===
    const heatGeneration = (state.reactorPower + state.decayHeat) * 5.0; // heat input
    const coolantCooling = state.primaryPump && hasPower ? (state.primaryFlowRate / 1000) * 4.0 * Math.max(state.coreTemp - state.primaryCoolantTemp, 0) * 0.01 : 0;
    const ambientCooling = (state.coreTemp - 20) * 0.001; // very slow ambient
    const sprayCooling = state.containmentSpray && hasPower ? (state.coreTemp - 80) * 0.02 : 0;

    state.coreTemp += (heatGeneration - coolantCooling - ambientCooling - sprayCooling) * dt;
    state.coreTemp = Math.max(20, state.coreTemp);

    // === Vessel Pressure (follows core temp) ===
    // In a real PWR, vessel pressure is maintained by the pressurizer
    const targetVesselPressure = state.pzrPressure * (state.coreTemp / 350);
    // Clamp to something reasonable

    // === Primary Coolant ===
    if (state.primaryPump && hasPower) {
        state.primaryFlowRate = approach(state.primaryFlowRate, state.primaryPumpSpeed * 10, 8 * dt); // max 1000 kg/s
    } else {
        state.primaryFlowRate = approach(state.primaryFlowRate, 0, 15 * dt);
    }
    // Coolant temp absorbs heat from core
    if (state.primaryFlowRate > 0) {
        const heatTransfer = (state.coreTemp - state.primaryCoolantTemp) * 0.05;
        state.primaryCoolantTemp = approach(state.primaryCoolantTemp, state.coreTemp - 30, 0.5 * dt);
    } else {
        state.primaryCoolantTemp = approach(state.primaryCoolantTemp, state.coreTemp * 0.8, 0.1 * dt);
    }

    // === Steam Generator ===
    if (state.primaryFlowRate > 10 && state.primaryCoolantTemp > 100) {
        const steamTarget = state.primaryCoolantTemp - 20;
        state.steamTemp = approach(state.steamTemp, steamTarget, 1.0 * dt);
        state.steamPressure = approach(state.steamPressure, Math.min((state.steamTemp - 100) * 0.7, 70), 0.8 * dt);
        state.steamPressure = Math.max(0, state.steamPressure);
    } else {
        state.steamTemp = approach(state.steamTemp, 20, 0.5 * dt);
        state.steamPressure = approach(state.steamPressure, 0, 0.5 * dt);
    }

    // Steam flow depends on MSCV opening and pressure
    if (state.mscvOpen && state.steamPressure > 5) {
        state.steamFlowRate = (state.mscvOpening / 100) * state.steamPressure * 5;
    } else {
        state.steamFlowRate = approach(state.steamFlowRate, 0, 10 * dt);
    }

    // === Condenser ===
    if (state.condenserVacuum && hasPower) {
        state.condenserVacuumLevel = approach(state.condenserVacuumLevel, 100, 2 * dt);
    } else {
        state.condenserVacuumLevel = approach(state.condenserVacuumLevel, 0, 3 * dt);
    }

    // Secondary feedwater
    if (state.secondaryPump && hasPower) {
        state.secondaryFlowRate = approach(state.secondaryFlowRate, state.secondaryPumpSpeed * 5, 5 * dt);
    } else {
        state.secondaryFlowRate = approach(state.secondaryFlowRate, 0, 8 * dt);
    }

    // === Turbine ===
    if (state.steamFlowRate > 5 && state.condenserVacuumLevel > 50) {
        const targetRPM = Math.min(state.steamFlowRate * 12, 3200);
        state.turbineRPM = approach(state.turbineRPM, targetRPM, 15 * dt);
    } else {
        state.turbineRPM = approach(state.turbineRPM, 0, 30 * dt);
    }

    // === Generator Output ===
    if (state.circuitBreaker && state.turbineRPM > 2800) {
        state.generatorOutput = (state.turbineRPM / TARGET_RPM) * MAX_POWER_MW * (state.reactorPower / 100);
        state.generatorOutput = Math.max(0, Math.min(MAX_POWER_MW, state.generatorOutput));
    } else {
        state.generatorOutput = approach(state.generatorOutput, 0, 20 * dt);
    }

    // === Synchroscope ===
    if (state.turbineRPM > 2500) {
        const freqDiff = (state.turbineRPM / TARGET_RPM * TARGET_FREQUENCY) - TARGET_FREQUENCY;
        state.synchroAngle += freqDiff * 10 * dt;
        state.synchroAngle = state.synchroAngle % 360;
    }

    // === Grid & City ===
    // City demand varies sinusoidally over time
    state.cityDemand = MAX_CITY_DEMAND * (0.5 + 0.3 * Math.sin(state.time / 600) + 0.2 * Math.sin(state.time / 180));
    state.cityDemand = Math.max(200, Math.min(MAX_CITY_DEMAND, state.cityDemand));

    if (state.cityConnection && state.circuitBreaker && state.generatorOutput > 0) {
        state.powerSupplied = Math.min(state.generatorOutput, state.cityDemand);
        state.gridFrequency = TARGET_FREQUENCY * (state.turbineRPM / TARGET_RPM);
        // Revenue: $per MW per second
        state.revenue += state.powerSupplied * 0.05 * dt;
    } else {
        state.powerSupplied = 0;
        state.gridFrequency = state.turbineRPM > 100 ? TARGET_FREQUENCY * (state.turbineRPM / TARGET_RPM) : 0;
    }

    // === Radiation ===
    if (state.coreTemp > DAMAGE_TEMP) {
        state.radiationLevel = 0.1 + (state.coreTemp - DAMAGE_TEMP) * 0.1;
    } else {
        state.radiationLevel = approach(state.radiationLevel, 0.1, 0.01 * dt);
    }

    // === Containment Status ===
    if (state.radiationLevel > 50) {
        state.containmentStatus = 'BREACH';
    } else if (state.radiationLevel > 10) {
        state.containmentStatus = 'CRITICAL';
    } else if (state.radiationLevel > 2) {
        state.containmentStatus = 'ELEVATED';
    } else {
        state.containmentStatus = 'NORMAL';
    }

    // === Fuel Integrity ===
    if (state.coreTemp > DAMAGE_TEMP && state.fuelLoaded) {
        const damageRate = (state.coreTemp - DAMAGE_TEMP) * 0.005;
        state.fuelIntegrity = Math.max(0, state.fuelIntegrity - damageRate * dt);
    }

    // === MELTDOWN CHECK ===
    if (state.coreTemp >= MELTDOWN_TEMP) {
        triggerMeltdown();
    }

    // === Auto-SCRAM conditions ===
    if (!state.scramActive) {
        if (state.coreTemp > 400 && !state.eventActive) {
            // Warning only, no auto-scram yet
        }
        if (state.coreTemp > 800) {
            logEvent('danger', 'AUTO-SCRAM: Core temperature exceeding safe limits!');
            activateSCRAM();
        }
        if (state.pzrPressure > 180) {
            logEvent('danger', 'AUTO-SCRAM: Pressurizer overpressure!');
            activateSCRAM();
        }
    }
}

// ===== RANDOM EVENTS =====
function checkEvents(dt) {
    if (state.time > state.nextEventTime && !state.eventActive && state.fuelLoaded) {
        const events = [
            { name: 'Primary Pump Trip', action: pumpTripEvent },
            { name: 'Condenser Leak', action: condenserLeakEvent },
            { name: 'Power Line Surge', action: powerSurgeEvent },
            { name: 'Xenon Transient', action: xenonTransientEvent },
            { name: 'Turbine Vibration', action: turbineVibrationEvent }
        ];
        const event = events[Math.floor(Math.random() * events.length)];
        state.eventActive = event.name;
        event.action();
        state.nextEventTime = state.time + 200 + Math.random() * 400;
    }
}

function pumpTripEvent() {
    logEvent('danger', 'EVENT: Primary coolant pump has tripped! Restart manually.');
    state.primaryPump = false;
    updateButtonState('primary-pump-btn', false, 'OFF');
    setTimeout(() => { state.eventActive = null; }, 5000);
}

function condenserLeakEvent() {
    logEvent('warning', 'EVENT: Minor condenser leak detected. Vacuum level dropping.');
    state.condenserVacuumLevel = Math.max(0, state.condenserVacuumLevel - 30);
    setTimeout(() => { state.eventActive = null; }, 8000);
}

function powerSurgeEvent() {
    logEvent('warning', 'EVENT: External power grid surge detected.');
    if (state.cityConnection) {
        state.gridFrequency += 2;
    }
    setTimeout(() => { state.eventActive = null; }, 3000);
}

function xenonTransientEvent() {
    logEvent('warning', 'EVENT: Unexpected Xenon-135 buildup. Reactivity decreasing.');
    state.xenonLevel = Math.min(100, state.xenonLevel + 20);
    setTimeout(() => { state.eventActive = null; }, 10000);
}

function turbineVibrationEvent() {
    logEvent('warning', 'EVENT: Abnormal turbine vibration detected. Monitor RPM closely.');
    state.turbineRPM *= 0.9;
    setTimeout(() => { state.eventActive = null; }, 6000);
}

// ===== ALARMS =====
function checkAlarms() {
    const newAlarms = [];

    if (state.coreTemp > 350) newAlarms.push({ text: 'HIGH CORE TEMP', level: state.coreTemp > 500 ? 'danger' : 'warning' });
    if (state.coreTemp > 800) newAlarms.push({ text: 'CRITICAL CORE TEMP - MELTDOWN IMMINENT', level: 'danger' });
    if (state.pzrPressure > 170) newAlarms.push({ text: 'HIGH PRESSURIZER PRESSURE', level: 'warning' });
    if (state.pzrPressure < 100 && state.reactorPower > 20) newAlarms.push({ text: 'LOW PRESSURIZER PRESSURE', level: 'warning' });
    if (state.turbineRPM > 3100) newAlarms.push({ text: 'HIGH TURBINE RPM', level: 'warning' });
    if (state.turbineRPM > 3200) newAlarms.push({ text: 'TURBINE OVERSPEED', level: 'danger' });
    if (state.fuelIntegrity < 50) newAlarms.push({ text: 'FUEL DAMAGE: ' + state.fuelIntegrity.toFixed(0) + '%', level: 'danger' });
    if (state.radiationLevel > 2) newAlarms.push({ text: 'HIGH RADIATION: ' + state.radiationLevel.toFixed(1) + ' mSv/h', level: state.radiationLevel > 10 ? 'danger' : 'warning' });
    if (state.scramActive) newAlarms.push({ text: 'SCRAM ACTIVE', level: 'danger' });
    if (state.eventActive) newAlarms.push({ text: 'EVENT: ' + state.eventActive.toUpperCase(), level: 'warning' });
    if (state.gridFrequency > 0 && Math.abs(state.gridFrequency - 50) > 2) newAlarms.push({ text: 'GRID FREQUENCY DEVIATION', level: 'warning' });
    if (state.primaryFlowRate < 50 && state.reactorPower > 20) newAlarms.push({ text: 'LOW PRIMARY COOLANT FLOW', level: 'danger' });
    if (!state.externalPower && state.generatorOutput < 5 && state.fuelLoaded) newAlarms.push({ text: 'LOSS OF POWER', level: 'danger' });

    state.alarms = newAlarms;
    renderAlarms();
}

function renderAlarms() {
    const bar = document.getElementById('alarm-bar');
    if (state.alarms.length === 0) {
        alarmListEl.innerHTML = '<span style="color: #335500; font-size: 11px;">ALL SYSTEMS NOMINAL</span>';
        bar.classList.remove('has-alarms');
    } else {
        bar.classList.add('has-alarms');
        alarmListEl.innerHTML = state.alarms.map(a =>
            `<span class="alarm-item ${a.level === 'warning' ? 'warning' : ''}">${a.text}</span>`
        ).join('');
    }
}

// ===== CONTROLS =====
function toggleSwitch(name) {
    const hasPower = state.externalPower || state.generatorOutput > 5;

    switch(name) {
        case 'pzrHeaters':
            if (!hasPower) { logEvent('warning', 'No power available. Turn on External Power first.'); return; }
            state.pzrHeaters = !state.pzrHeaters;
            updateButtonState('pzr-heater-btn', state.pzrHeaters);
            logEvent('info', `Pressurizer heaters ${state.pzrHeaters ? 'ON' : 'OFF'}`);
            break;
        case 'pzrThermostat':
            state.pzrThermostat = !state.pzrThermostat;
            updateButtonState('pzr-thermo-btn', state.pzrThermostat);
            logEvent('info', `Pressurizer thermostat ${state.pzrThermostat ? 'ON' : 'OFF'}`);
            break;
        case 'primaryPump':
            if (!hasPower) { logEvent('warning', 'No power available.'); return; }
            state.primaryPump = !state.primaryPump;
            updateButtonState('primary-pump-btn', state.primaryPump);
            logEvent('info', `Primary coolant pump ${state.primaryPump ? 'ON' : 'OFF'}`);
            break;
        case 'condenserPump':
            if (!hasPower) { logEvent('warning', 'No power available.'); return; }
            state.condenserPump = !state.condenserPump;
            updateButtonState('condenser-pump-btn', state.condenserPump);
            logEvent('info', `Condenser pump ${state.condenserPump ? 'ON' : 'OFF'}`);
            break;
        case 'condenserVacuum':
            if (!hasPower) { logEvent('warning', 'No power available.'); return; }
            state.condenserVacuum = !state.condenserVacuum;
            updateButtonState('condenser-vacuum-btn', state.condenserVacuum);
            logEvent('info', `Condenser vacuum ${state.condenserVacuum ? 'ON' : 'OFF'}`);
            break;
        case 'secondaryPump':
            if (!hasPower) { logEvent('warning', 'No power available.'); return; }
            state.secondaryPump = !state.secondaryPump;
            updateButtonState('secondary-pump-btn', state.secondaryPump);
            logEvent('info', `Secondary feedwater pump ${state.secondaryPump ? 'ON' : 'OFF'}`);
            break;
        case 'mscv':
            state.mscvOpen = !state.mscvOpen;
            updateButtonState('mscv-btn', state.mscvOpen, state.mscvOpen ? 'OPEN' : 'CLOSED');
            logEvent('info', `Main Steam Control Valve ${state.mscvOpen ? 'OPEN' : 'CLOSED'}`);
            break;
        case 'generatorMode':
            state.generatorMode = !state.generatorMode;
            updateButtonState('gen-mode-btn', state.generatorMode, state.generatorMode ? 'AUTO' : 'MANUAL');
            logEvent('info', `Generator mode: ${state.generatorMode ? 'AUTO' : 'MANUAL'}`);
            break;
        case 'circuitBreaker':
            if (state.turbineRPM < 2800) {
                logEvent('warning', 'Cannot close circuit breaker: Turbine RPM too low (need >2800).');
                return;
            }
            state.circuitBreaker = !state.circuitBreaker;
            updateButtonState('breaker-btn', state.circuitBreaker, state.circuitBreaker ? 'CLOSED' : 'OPEN');
            logEvent('info', `Circuit breaker ${state.circuitBreaker ? 'CLOSED' : 'OPEN'}`);
            break;
        case 'cityConnection':
            if (!state.circuitBreaker) {
                logEvent('warning', 'Cannot connect to city: Circuit breaker is open.');
                return;
            }
            state.cityConnection = !state.cityConnection;
            updateButtonState('city-btn', state.cityConnection, state.cityConnection ? 'CONNECTED' : 'DISCONNECTED');
            logEvent(state.cityConnection ? 'success' : 'info', `City grid ${state.cityConnection ? 'CONNECTED' : 'DISCONNECTED'}`);
            break;
        case 'externalPower':
            state.externalPower = !state.externalPower;
            updateButtonState('ext-power-btn', state.externalPower);
            logEvent('info', `External power ${state.externalPower ? 'ON' : 'OFF'}`);
            break;
        case 'containmentSpray':
            if (!hasPower) { logEvent('warning', 'No power available.'); return; }
            state.containmentSpray = !state.containmentSpray;
            updateButtonState('spray-btn', state.containmentSpray);
            logEvent('info', `Containment spray ${state.containmentSpray ? 'ACTIVATED' : 'OFF'}`);
            break;
    }
}

function updateButtonState(id, isOn, onText, offText) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.className = isOn ? 'btn btn-small btn-on' : 'btn btn-small btn-off';
    if (onText || offText) {
        btn.textContent = isOn ? (onText || 'ON') : (offText || 'OFF');
    } else {
        btn.textContent = isOn ? 'ON' : 'OFF';
    }
}

function updateRodPosition(val) {
    if (state.scramActive) {
        document.getElementById('control-rods').value = 100;
        logEvent('warning', 'Cannot move control rods during SCRAM. Reset SCRAM first.');
        return;
    }
    state.controlRodPosition = parseInt(val);
    document.getElementById('rod-pos-display').textContent = val + '%';
}

function toggleFuel() {
    if (state.fuelLoaded) {
        if (state.reactorPower > 1) {
            logEvent('warning', 'Cannot unload fuel while reactor is critical!');
            return;
        }
        state.fuelLoaded = false;
        state.fuelIntegrity = 100;
        document.getElementById('fuel-btn').textContent = 'LOAD FUEL';
        document.getElementById('fuel-btn').className = 'btn btn-warning';
        document.getElementById('fuel-status').textContent = 'NOT LOADED';
        logEvent('info', 'Fuel unloaded from reactor.');
    } else {
        state.fuelLoaded = true;
        document.getElementById('fuel-btn').textContent = 'UNLOAD FUEL';
        document.getElementById('fuel-btn').className = 'btn btn-success';
        document.getElementById('fuel-status').textContent = 'LOADED (' + state.fuelIntegrity.toFixed(0) + '%)';
        logEvent('success', 'Nuclear fuel loaded into reactor core.');
    }
}

function updatePumpSpeed(pump, val) {
    val = parseInt(val);
    switch(pump) {
        case 'primary':
            state.primaryPumpSpeed = val;
            document.getElementById('primary-pump-speed-display').textContent = val;
            break;
        case 'condenser':
            state.condenserPumpSpeed = val;
            document.getElementById('condenser-pump-speed-display').textContent = val;
            break;
        case 'secondary':
            state.secondaryPumpSpeed = val;
            document.getElementById('secondary-pump-speed-display').textContent = val;
            break;
    }
}

function updateMSCV(val) {
    state.mscvOpening = parseInt(val);
    document.getElementById('mscv-opening-display').textContent = val;
}

function setSpeed(s) {
    state.speed = s;
    if (s === 0) {
        state.running = false;
        logEvent('info', 'Simulation PAUSED.');
    } else {
        if (!state.running && !state.gameOver) {
            state.running = true;
            gameLoop();
        }
        logEvent('info', `Simulation speed: ${s}x`);
    }
    updateSpeedButtons();
}

function updateSpeedButtons() {
    const btns = document.querySelectorAll('#game-speed button');
    btns.forEach((btn, i) => {
        const speeds = [0, 1, 5, 10];
        btn.classList.toggle('active', speeds[i] === state.speed);
    });
}

function activateSCRAM() {
    if (state.scramActive) {
        // Reset SCRAM
        state.scramActive = false;
        logEvent('success', 'SCRAM reset. Control rods can now be moved.');
        document.getElementById('scram-btn').textContent = 'SCRAM';
        document.getElementById('scram-btn').className = 'btn btn-danger btn-large';
        return;
    }
    state.scramActive = true;
    state.controlRodPosition = 100;
    document.getElementById('control-rods').value = 100;
    document.getElementById('rod-pos-display').textContent = '100%';
    // Trip turbine
    state.mscvOpen = false;
    state.mscvOpening = 0;
    document.getElementById('mscv-opening').value = 0;
    document.getElementById('mscv-opening-display').textContent = '0';
    updateButtonState('mscv-btn', false, 'CLOSED');
    // Open breaker
    state.circuitBreaker = false;
    updateButtonState('breaker-btn', false, 'OPEN');
    state.cityConnection = false;
    updateButtonState('city-btn', false, 'DISCONNECTED');

    document.getElementById('scram-btn').textContent = 'RESET SCRAM';
    document.getElementById('scram-btn').className = 'btn btn-warning btn-large';
    logEvent('danger', 'SCRAM ACTIVATED! All control rods inserted. Turbine tripped. Grid disconnected.');
}

function triggerMeltdown() {
    state.gameOver = true;
    state.meltdown = true;
    state.running = false;
    const overlay = document.getElementById('game-over-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('game-over-title').textContent = 'MELTDOWN';
    document.getElementById('game-over-message').textContent = 'Core temperature exceeded ' + MELTDOWN_TEMP + '°C. The reactor core has melted down. Containment has been breached. This is a catastrophic failure.';
    document.getElementById('game-over-stats').textContent =
        `Time survived: ${formatTime(state.time)} | Revenue earned: $${state.revenue.toFixed(0)} | Final core temp: ${state.coreTemp.toFixed(0)}°C`;
    logEvent('danger', '*** MELTDOWN *** Core temperature: ' + state.coreTemp.toFixed(0) + '°C');
}

// ===== DISPLAY UPDATES =====
function updateAllDisplays() {
    // Clock
    document.getElementById('clock').textContent = formatTime(state.time);

    // Core
    setGaugeBar('core-temp-bar', state.coreTemp, MAX_CORE_TEMP,
        state.coreTemp > DAMAGE_TEMP ? 'danger' : (state.coreTemp > 350 ? '' : 'green'));
    document.getElementById('core-temp-value').textContent = state.coreTemp.toFixed(1) + '°C';

    setGaugeBar('reactor-power-bar', state.reactorPower, 100, 'green');
    document.getElementById('reactor-power-value').textContent = state.reactorPower.toFixed(1) + '%';

    setGaugeBar('vessel-pressure-bar', state.pzrPressure, 200, 'blue');
    document.getElementById('vessel-pressure-value').textContent = state.pzrPressure.toFixed(1) + ' bar';

    setGaugeBar('neutron-flux-bar', state.neutronFlux, 100, 'yellow');
    document.getElementById('neutron-flux-value').textContent = state.neutronFlux.toFixed(1) + '%';

    // Fuel
    if (state.fuelLoaded) {
        document.getElementById('fuel-status').textContent = 'LOADED (' + state.fuelIntegrity.toFixed(0) + '%)';
    }

    // Pressurizer
    document.getElementById('pzr-pressure-value').textContent = state.pzrPressure.toFixed(1) + ' bar';
    document.getElementById('pzr-temp-value').textContent = state.pzrTemp.toFixed(1) + '°C';

    // Primary
    document.getElementById('primary-flow-value').textContent = state.primaryFlowRate.toFixed(0) + ' kg/s';
    document.getElementById('primary-coolant-temp').textContent = state.primaryCoolantTemp.toFixed(1) + '°C';

    // Steam Generator
    document.getElementById('steam-temp-value').textContent = state.steamTemp.toFixed(1) + '°C';
    document.getElementById('steam-pressure-value').textContent = state.steamPressure.toFixed(1) + ' bar';
    document.getElementById('steam-flow-value').textContent = state.steamFlowRate.toFixed(0) + ' kg/s';

    // Condenser
    document.getElementById('condenser-vacuum-value').textContent = state.condenserVacuumLevel.toFixed(0) + '%';

    // Secondary
    document.getElementById('secondary-flow-value').textContent = state.secondaryFlowRate.toFixed(0) + ' kg/s';

    // Turbine
    setGaugeBar('turbine-rpm-bar', state.turbineRPM, 3500, 'cyan');
    document.getElementById('turbine-rpm-value').textContent = state.turbineRPM.toFixed(0) + ' RPM';

    setGaugeBar('generator-output-bar', state.generatorOutput, MAX_POWER_MW, 'green');
    document.getElementById('generator-output-value').textContent = state.generatorOutput.toFixed(0) + ' MW';

    // City
    setGaugeBar('city-demand-bar', state.cityDemand, MAX_CITY_DEMAND, 'orange');
    document.getElementById('city-demand-value').textContent = state.cityDemand.toFixed(0) + ' MW';

    setGaugeBar('power-supplied-bar', state.powerSupplied, MAX_CITY_DEMAND, 'green');
    document.getElementById('power-supplied-value').textContent = state.powerSupplied.toFixed(0) + ' MW';

    document.getElementById('grid-frequency-value').textContent = state.gridFrequency.toFixed(2) + ' Hz';
    document.getElementById('grid-frequency-value').style.color =
        state.gridFrequency > 0 && Math.abs(state.gridFrequency - 50) > 1 ? '#ff4444' : '#ffffff';

    document.getElementById('revenue-value').textContent = '$' + state.revenue.toFixed(0);

    // Emergency
    document.getElementById('radiation-value').textContent = state.radiationLevel.toFixed(1) + ' mSv/h';
    document.getElementById('radiation-value').style.color = state.radiationLevel > 2 ? '#ff4444' : '#ffffff';

    const containmentEl = document.getElementById('containment-value');
    containmentEl.textContent = state.containmentStatus;
    containmentEl.style.color = state.containmentStatus === 'NORMAL' ? '#00ff88' :
        state.containmentStatus === 'ELEVATED' ? '#ffaa00' : '#ff0000';

    // Canvas visuals
    drawReactorCanvas();
    drawSynchroscope();
}

function setGaugeBar(id, value, max, colorClass) {
    const el = document.getElementById(id);
    if (!el) return;
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    el.style.width = pct + '%';
    el.className = 'gauge-bar ' + (colorClass || '');
}

// ===== CANVAS: REACTOR CORE VISUALIZATION =====
function drawReactorCanvas() {
    const canvas = document.getElementById('reactor-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background - reactor vessel
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, w, h);

    // Vessel outline
    ctx.strokeStyle = '#2a3a5a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(20, 10, w - 40, h - 20, 10);
    ctx.stroke();

    // Core heat glow
    if (state.coreTemp > 50) {
        const intensity = Math.min(1, (state.coreTemp - 50) / 500);
        const r = Math.floor(255 * intensity);
        const g = Math.floor(100 * (1 - intensity));
        const gradient = ctx.createRadialGradient(w/2, h/2, 10, w/2, h/2, 80);
        gradient.addColorStop(0, `rgba(${r}, ${g}, 0, ${intensity * 0.6})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    // Control rods (8 rods)
    const rodCount = 8;
    const rodWidth = 8;
    const rodSpacing = (w - 60) / rodCount;
    const rodMaxHeight = h - 50;
    const rodInserted = (state.controlRodPosition / 100) * rodMaxHeight;

    for (let i = 0; i < rodCount; i++) {
        const x = 30 + i * rodSpacing + rodSpacing / 2 - rodWidth / 2;
        // Rod channel
        ctx.fillStyle = '#1a2030';
        ctx.fillRect(x - 1, 15, rodWidth + 2, rodMaxHeight + 5);
        // Rod itself
        ctx.fillStyle = state.scramActive ? '#ff4444' : '#5588bb';
        ctx.fillRect(x, 15, rodWidth, rodInserted);
        // Rod tip
        ctx.fillStyle = '#aaccee';
        ctx.fillRect(x, 15 + rodInserted - 3, rodWidth, 3);
    }

    // Fuel assemblies (if loaded)
    if (state.fuelLoaded) {
        const fuelY = h - 30;
        for (let i = 0; i < rodCount; i++) {
            const x = 30 + i * rodSpacing + rodSpacing / 2;
            const glow = state.neutronFlux > 5 ? Math.min(1, state.neutronFlux / 50) : 0;
            ctx.fillStyle = `rgba(0, ${Math.floor(200 * glow)}, ${Math.floor(255 * glow)}, ${0.3 + glow * 0.7})`;
            ctx.beginPath();
            ctx.arc(x, fuelY, 6, 0, Math.PI * 2);
            ctx.fill();
            // Cherenkov radiation glow
            if (state.neutronFlux > 20) {
                ctx.fillStyle = `rgba(80, 150, 255, ${glow * 0.3})`;
                ctx.beginPath();
                ctx.arc(x, fuelY, 12, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Labels
    ctx.fillStyle = '#4466aa';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('REACTOR CORE VESSEL', w / 2, h - 5);

    // Meltdown effect
    if (state.coreTemp > 800) {
        const flicker = Math.random() * 0.3;
        ctx.fillStyle = `rgba(255, 0, 0, ${0.1 + flicker})`;
        ctx.fillRect(0, 0, w, h);
    }
}

// ===== CANVAS: SYNCHROSCOPE =====
function drawSynchroscope() {
    const canvas = document.getElementById('synchro-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = 80;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#050810';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.fill();

    // Dial markings
    ctx.strokeStyle = '#2a3a5a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(angle) * (r - 5);
        const y1 = cy + Math.sin(angle) * (r - 5);
        const x2 = cx + Math.cos(angle) * r;
        const y2 = cy + Math.sin(angle) * r;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // "SYNC" marker at top
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    const syncAngle = -Math.PI / 2;
    ctx.moveTo(cx + Math.cos(syncAngle) * (r + 5), cy + Math.sin(syncAngle) * (r + 5));
    ctx.lineTo(cx + Math.cos(syncAngle - 0.1) * (r + 15), cy + Math.sin(syncAngle - 0.1) * (r + 15));
    ctx.lineTo(cx + Math.cos(syncAngle + 0.1) * (r + 15), cy + Math.sin(syncAngle + 0.1) * (r + 15));
    ctx.fill();

    // Needle
    if (state.turbineRPM > 2500) {
        const needleAngle = (state.synchroAngle * Math.PI / 180) - Math.PI / 2;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(needleAngle) * (r - 10), cy + Math.sin(needleAngle) * (r - 10));
        ctx.stroke();

        // Center dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        // Check if in sync zone
        const normalizedAngle = ((state.synchroAngle % 360) + 360) % 360;
        const inSync = normalizedAngle > 350 || normalizedAngle < 10;
        const statusEl = document.getElementById('synchro-status');
        if (inSync && state.turbineRPM > 2900 && state.turbineRPM < 3100) {
            statusEl.textContent = 'SYNCHRONIZED';
            statusEl.className = 'synchro-status ready';
            // Green glow
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            statusEl.textContent = 'NOT SYNCED';
            statusEl.className = 'synchro-status';
        }
    } else {
        const statusEl = document.getElementById('synchro-status');
        statusEl.textContent = 'NOT READY';
        statusEl.className = 'synchro-status';

        // Dim center
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // Labels
    ctx.fillStyle = '#4466aa';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('FAST', cx + r - 15, cy + 4);
    ctx.fillText('SLOW', cx - r + 15, cy + 4);
    ctx.fillText('SYNC', cx, cy - r + 20);
}

// ===== UTILITY =====
function approach(current, target, rate) {
    if (current < target) {
        return Math.min(current + rate, target);
    } else if (current > target) {
        return Math.max(current - rate, target);
    }
    return current;
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function logEvent(level, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    entry.innerHTML = `<span class="log-time">[${formatTime(state.time)}]</span>${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;

    // Keep log manageable
    while (logEl.children.length > 200) {
        logEl.removeChild(logEl.firstChild);
    }
}

// ===== INIT ON LOAD =====
window.addEventListener('DOMContentLoaded', init);
