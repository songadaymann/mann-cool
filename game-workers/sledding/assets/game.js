console.log('Game script loading...');

// Matter.js module aliases
const { Engine, Render, Runner, Bodies, Body, Composite, Events, Vector } = Matter;
console.log('Matter.js loaded:', typeof Matter);

// Game state
const GameState = {
    DRAWING: 'drawing',
    PLACING: 'placing',
    LAUNCHING: 'launching',
    FLYING: 'flying',
    LANDED: 'landed'
};

// Game configuration
const config = {
    drawZoneStart: 0.25, // Left 25% is off-limits for drawing
    gravity: 0.4, // Floaty gravity
    sledFriction: 0.0001, // Very slippery!
    sledRestitution: 0.2,
    hillFriction: 0.0001, // Icy hill
    groundY: 50, // Distance from bottom for ground
    pixelsPerMeter: 50
};

// Game variables
let canvas, ctx;
let engine, runner;
let gameState = GameState.DRAWING;
let hillPoints = [];
let isDrawing = false;
let sled = null;
let cameraX = 0;
let maxDistance = 0;
let hillBodies = [];
let groundBody = null;
let sledStartX = 0;

// Dragging state
let isDraggingSled = false;

// Physics state
let sledOnGround = false;
let wasOnGround = false;
let hasBeenAirborne = false;

// Sprite
let sledKidImage = new Image();
let spriteLoaded = false;

// Audio
let musicStarted = false;

// Leaderboard
const API_BASE = 'https://mann.cool/api/leaderboard';
const GAME_NAME = 'sledlaunch2';
let pendingScore = null;

// Initialize the game
function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    // Load the sled kid sprite
    sledKidImage.onload = () => {
        spriteLoaded = true;
    };
    sledKidImage.src = 'assets/sledKid.png';

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Set up Matter.js
    engine = Engine.create();
    engine.gravity.y = config.gravity;

    // Create ground (extends far to the left for landing)
    createGround();

    // Set up event listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    document.getElementById('launchBtn').addEventListener('click', launch);
    document.getElementById('resetBtn').addEventListener('click', reset);

    // Mute button
    document.getElementById('muteBtn').addEventListener('click', () => {
        const music = document.getElementById('bgMusic');
        const muteBtn = document.getElementById('muteBtn');
        if (music.muted) {
            music.muted = false;
            muteBtn.textContent = 'Mute';
        } else {
            music.muted = true;
            muteBtn.textContent = 'Unmute';
        }
    });

    // Leaderboard button
    document.getElementById('leaderboardBtn').addEventListener('click', () => {
        openLeaderboard();
    });

    // Close modal
    document.getElementById('closeModal').addEventListener('click', () => {
        document.getElementById('leaderboardModal').classList.remove('active');
    });

    // Close modal on outside click
    document.getElementById('leaderboardModal').addEventListener('click', (e) => {
        if (e.target.id === 'leaderboardModal') {
            document.getElementById('leaderboardModal').classList.remove('active');
        }
    });

    // Submit score
    document.getElementById('submitScore').addEventListener('click', submitScore);

    // Enter key to submit
    document.getElementById('playerName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitScore();
    });

    // Set up collision detection for ground contact
    Events.on(engine, 'collisionStart', (event) => {
        for (let pair of event.pairs) {
            if (pair.bodyA === sled || pair.bodyB === sled) {
                // Only count landing if sled has passed the draw zone (to the left of it)
                const pastDrawZone = sled && sled.position.x < canvas.width * config.drawZoneStart;

                // If we were in the air and now landed past the draw zone, stop and record!
                if (!sledOnGround && hasBeenAirborne && gameState === GameState.LAUNCHING && pastDrawZone) {
                    // Stop the sled
                    Body.setVelocity(sled, { x: 0, y: 0 });
                    Body.setAngularVelocity(sled, 0);

                    // Record final distance
                    const distance = (sledStartX - sled.position.x) / config.pixelsPerMeter;
                    if (distance > maxDistance) {
                        maxDistance = distance;
                    }

                    // End the run
                    gameState = GameState.LANDED;
                    updateUI();
                    Events.off(engine, 'afterUpdate', checkSledStopped);

                    // Open leaderboard with submit form
                    setTimeout(() => {
                        openLeaderboard(true, distance);
                    }, 500);
                }
                sledOnGround = true;
            }
        }
    });

    Events.on(engine, 'collisionEnd', (event) => {
        for (let pair of event.pairs) {
            if (pair.bodyA === sled || pair.bodyB === sled) {
                sledOnGround = false;

                // Launch boost! Apply impulse when leaving the ground
                if (wasOnGround && sled && gameState === GameState.LAUNCHING) {
                    hasBeenAirborne = true; // Mark that we've jumped!

                    const speed = Math.hypot(sled.velocity.x, sled.velocity.y);
                    if (speed > 1) {
                        // Big boost in direction of travel, with upward bias for nice arc
                        const boostStrength = 0.025;
                        Body.applyForce(sled, sled.position, {
                            x: sled.velocity.x * boostStrength,
                            y: -Math.abs(sled.velocity.x) * boostStrength * 1.0
                        });
                    }
                }
            }
        }
    });

    // Start game loop
    runner = Runner.create();
    Runner.run(runner, engine);

    gameLoop();
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function createGround() {
    // Ground extends from far left to the right edge
    const groundWidth = canvas.width * 20;
    groundBody = Bodies.rectangle(
        -groundWidth / 2 + canvas.width,
        canvas.height - config.groundY + 25,
        groundWidth,
        50,
        { isStatic: true, friction: 0.8 }
    );
    Composite.add(engine.world, groundBody);
}

// Drawing functions
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function getTouchPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
    };
}

function isInDrawZone(x) {
    return x > canvas.width * config.drawZoneStart;
}

function isClickOnSled(pos) {
    if (!sled) return false;
    const dx = pos.x - sled.position.x;
    const dy = pos.y - sled.position.y;
    return Math.abs(dx) < 60 && Math.abs(dy) < 60;
}

function startMusic() {
    if (!musicStarted) {
        const music = document.getElementById('bgMusic');
        music.volume = 0.3; // Lower volume
        music.play();
        musicStarted = true;
    }
}

function onMouseDown(e) {
    startMusic();
    const pos = getMousePos(e);

    // Check if clicking on sled during placing phase
    if (gameState === GameState.PLACING && isClickOnSled(pos)) {
        isDraggingSled = true;
        return;
    }

    startDrawing(pos);
}

function onMouseMove(e) {
    const pos = getMousePos(e);

    // Drag sled if we're dragging it
    if (isDraggingSled && sled && gameState === GameState.PLACING) {
        Body.setPosition(sled, { x: pos.x, y: pos.y });
        return;
    }

    continueDrawing(pos);
}

function onMouseUp(e) {
    if (isDraggingSled) {
        isDraggingSled = false;
        return;
    }
    stopDrawing();
}

function onTouchStart(e) {
    e.preventDefault();
    startMusic();
    const pos = getTouchPos(e);

    // Check if touching sled during placing phase
    if (gameState === GameState.PLACING && isClickOnSled(pos)) {
        isDraggingSled = true;
        return;
    }

    startDrawing(pos);
}

function onTouchMove(e) {
    e.preventDefault();
    const pos = getTouchPos(e);

    // Drag sled if we're dragging it
    if (isDraggingSled && sled && gameState === GameState.PLACING) {
        Body.setPosition(sled, { x: pos.x, y: pos.y });
        return;
    }

    continueDrawing(pos);
}

function onTouchEnd(e) {
    if (isDraggingSled) {
        isDraggingSled = false;
        return;
    }
    stopDrawing();
}

function startDrawing(pos) {
    if (gameState !== GameState.DRAWING) return;
    if (!isInDrawZone(pos.x)) return;

    isDrawing = true;
    hillPoints = [pos];
}

function continueDrawing(pos) {
    if (!isDrawing || gameState !== GameState.DRAWING) return;
    if (!isInDrawZone(pos.x)) return;

    // Only add point if it's far enough from the last one
    const lastPoint = hillPoints[hillPoints.length - 1];
    const dist = Math.hypot(pos.x - lastPoint.x, pos.y - lastPoint.y);
    if (dist > 10) {
        hillPoints.push(pos);
    }
}

function stopDrawing() {
    if (isDrawing && hillPoints.length > 2) {
        isDrawing = false;
        createHillCollision();

        // Place sled in center of screen, with gravity disabled
        createSled(canvas.width / 2, canvas.height / 2, true); // true = static (no gravity)

        gameState = GameState.PLACING;
        updateUI();
    }
    isDrawing = false;
}

function createHillCollision() {
    // Clear any existing hill bodies
    hillBodies.forEach(body => Composite.remove(engine.world, body));
    hillBodies = [];

    // Create line segments between each pair of points
    for (let i = 0; i < hillPoints.length - 1; i++) {
        const p1 = hillPoints[i];
        const p2 = hillPoints[i + 1];

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        const segment = Bodies.rectangle(midX, midY, length, 8, {
            isStatic: true,
            angle: angle,
            friction: config.hillFriction,
            restitution: 0.05
        });

        hillBodies.push(segment);
        Composite.add(engine.world, segment);
    }
}

function createSled(x, y, isStatic = false) {
    // Remove existing sled if any
    if (sled) {
        Composite.remove(engine.world, sled);
    }

    sledStartX = x;

    // Create a circle body - rolls smoothly over bumps!
    sled = Bodies.circle(x, y, 25, {
        friction: config.sledFriction,
        restitution: config.sledRestitution,
        frictionAir: 0.001,
        density: 0.002,
        isStatic: isStatic // No gravity/physics when static
    });

    Composite.add(engine.world, sled);
}

function launch() {
    if (gameState === GameState.PLACING && sled) {
        // Record the starting position for distance calculation
        sledStartX = sled.position.x;

        // Enable physics on the sled (turn off static)
        Body.setStatic(sled, false);

        gameState = GameState.LAUNCHING;
        updateUI();

        // Track when sled stops
        Events.on(engine, 'afterUpdate', checkSledStopped);
    }
}

function checkSledStopped() {
    if (!sled || gameState !== GameState.LAUNCHING) return;

    const speed = Math.hypot(sled.velocity.x, sled.velocity.y);
    const distanceTraveled = (sledStartX - sled.position.x) / config.pixelsPerMeter;

    // Update max distance
    if (distanceTraveled > maxDistance) {
        maxDistance = distanceTraveled;
    }

    // Check if sled has effectively stopped
    if (speed < 0.1 && sled.position.y > canvas.height - config.groundY - 50) {
        gameState = GameState.LANDED;
        updateUI();
        Events.off(engine, 'afterUpdate', checkSledStopped);
    }
}

function reset() {
    // Remove sled
    if (sled) {
        Composite.remove(engine.world, sled);
        sled = null;
    }

    // Remove hill bodies
    hillBodies.forEach(body => Composite.remove(engine.world, body));
    hillBodies = [];

    // Reset state
    hillPoints = [];
    gameState = GameState.DRAWING;
    cameraX = 0;
    maxDistance = 0;

    // Reset physics state
    sledOnGround = false;
    wasOnGround = false;
    hasBeenAirborne = false;
    engine.gravity.y = config.gravity;

    updateUI();
}

function updateUI() {
    const phaseText = document.getElementById('phase-text');
    const launchBtn = document.getElementById('launchBtn');

    switch (gameState) {
        case GameState.DRAWING:
            phaseText.textContent = 'Draw your hill on the right →';
            launchBtn.textContent = 'Launch!';
            break;
        case GameState.PLACING:
            phaseText.textContent = 'Drag the sled to position it, then Launch!';
            launchBtn.textContent = 'Launch!';
            break;
        case GameState.LAUNCHING:
            phaseText.textContent = 'Wheeeee!';
            launchBtn.textContent = 'Go!';
            break;
        case GameState.LANDED:
            phaseText.textContent = `Final: ${maxDistance.toFixed(1)}m! Click Reset to try again`;
            launchBtn.textContent = 'Launch!';
            break;
    }
}

// Main game loop
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

function update() {
    // Camera follows sled during launch
    if (gameState === GameState.LAUNCHING && sled) {
        const targetCameraX = Math.max(0, sledStartX - sled.position.x);
        cameraX += (targetCameraX - cameraX) * 0.1;

        // Update distance display
        const distance = (sledStartX - sled.position.x) / config.pixelsPerMeter;
        if (distance > 0) {
            document.getElementById('distance').textContent = `${Math.max(0, distance).toFixed(1)}m`;
        }

        // Variable gravity: higher on ground (fast acceleration), lower in air (floaty)
        if (sledOnGround) {
            engine.gravity.y = 2; // Really fast downhill!

            // Extra push while on the ground - like a rocket sled!
            Body.applyForce(sled, sled.position, {
                x: -0.005, // Constant push to the left (downhill)
                y: 0
            });
        } else {
            engine.gravity.y = 0.15; // Very floaty air time!

            // Gentle self-righting torque when in the air
            const targetAngle = 0;
            const angleDiff = targetAngle - sled.angle;
            // Apply a gentle corrective angular velocity
            Body.setAngularVelocity(sled, sled.angularVelocity + angleDiff * 0.02);
        }

        // Track ground state for launch detection
        wasOnGround = sledOnGround;
    }
}

function render() {
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(cameraX, 0);

    // Draw zone indicator (subtle line)
    if (gameState === GameState.DRAWING) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(canvas.width * config.drawZoneStart - cameraX, 0);
        ctx.lineTo(canvas.width * config.drawZoneStart - cameraX, canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw ground line
    drawHandDrawnLine(
        -canvas.width * 10,
        canvas.height - config.groundY,
        canvas.width * 2 - cameraX,
        canvas.height - config.groundY
    );

    // Draw distance markers
    drawDistanceMarkers();

    // Draw hill
    if (hillPoints.length > 1) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(hillPoints[0].x, hillPoints[0].y);

        for (let i = 1; i < hillPoints.length; i++) {
            // Add slight wobble for hand-drawn effect
            const wobbleX = (Math.random() - 0.5) * 2;
            const wobbleY = (Math.random() - 0.5) * 2;
            ctx.lineTo(hillPoints[i].x + wobbleX, hillPoints[i].y + wobbleY);
        }
        ctx.stroke();
    }

    // Draw sled
    if (sled) {
        drawSled(sled.position.x, sled.position.y, sled.angle);
    }

    ctx.restore();
}

function drawHandDrawnLine(x1, y1, x2, y2) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();

    const segments = 20;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
}

function drawDistanceMarkers() {
    ctx.fillStyle = '#fff';
    ctx.font = '16px Fredericka the Great, cursive';
    ctx.textAlign = 'center';

    // Draw markers every 10 meters
    for (let m = 0; m <= 200; m += 10) {
        const x = sledStartX - (m * config.pixelsPerMeter);
        const y = canvas.height - 15;

        // Draw tick mark
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, canvas.height - config.groundY);
        ctx.lineTo(x, canvas.height - config.groundY + 10);
        ctx.stroke();

        // Draw label
        ctx.fillText(`${m}m`, x, y);
    }
}

function drawSled(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    if (spriteLoaded) {
        // Draw the sprite - adjust size and position as needed
        const spriteWidth = 100;
        const spriteHeight = 120;

        // Draw without filter first to debug
        ctx.drawImage(
            sledKidImage,
            -spriteWidth / 2,
            -spriteHeight + 20, // Offset so bottom of sprite aligns with sled physics body
            spriteWidth,
            spriteHeight
        );
    } else {
        // Fallback to simple drawn version if sprite hasn't loaded
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        // Draw sled base (curved runner)
        ctx.beginPath();
        ctx.moveTo(-30, 10);
        ctx.quadraticCurveTo(-35, 15, -30, 15);
        ctx.lineTo(25, 15);
        ctx.quadraticCurveTo(35, 15, 30, 5);
        ctx.stroke();

        // Draw sled top
        ctx.beginPath();
        ctx.moveTo(-25, 10);
        ctx.lineTo(-25, 0);
        ctx.lineTo(20, 0);
        ctx.lineTo(20, 10);
        ctx.stroke();

        // Draw kid (simple stick figure sitting)
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -20);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -28, 8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-15, -5);
        ctx.lineTo(0, -15);
        ctx.lineTo(15, -5);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, 5);
        ctx.lineTo(0, 0);
        ctx.lineTo(10, 5);
        ctx.stroke();
    }

    ctx.restore();
}

// Leaderboard functions
async function fetchLeaderboard() {
    try {
        const params = new URLSearchParams({
            game: GAME_NAME,
            variant: 'default',
            limit: '10'
        });
        const response = await fetch(`${API_BASE}?${params}`);
        const data = await response.json();
        if (data.success) {
            return data.entries || [];
        }
        return [];
    } catch (error) {
        console.error('Leaderboard fetch error:', error);
        return [];
    }
}

async function openLeaderboard(showSubmitForm = false, score = null) {
    const modal = document.getElementById('leaderboardModal');
    const list = document.getElementById('leaderboardList');
    const nameForm = document.getElementById('nameForm');
    const yourScore = document.getElementById('yourScore');

    modal.classList.add('active');
    list.innerHTML = '<li>Loading...</li>';

    if (showSubmitForm && score !== null) {
        pendingScore = score;
        yourScore.textContent = `Your distance: ${score.toFixed(1)}m`;
        nameForm.style.display = 'block';
        // Load saved name if exists
        const savedName = localStorage.getItem('sledlaunch_playerName');
        if (savedName) {
            document.getElementById('playerName').value = savedName;
        }
    } else {
        nameForm.style.display = 'none';
    }

    const entries = await fetchLeaderboard();

    if (entries.length === 0) {
        list.innerHTML = '<li>No scores yet. Be the first!</li>';
    } else {
        list.innerHTML = entries.map((entry, i) => `
            <li>
                <span class="rank">${i + 1}.</span>
                <span class="name">${entry.name}</span>
                <span class="score">${Math.abs(entry.score).toFixed(1)}m</span>
            </li>
        `).join('');
    }
}

async function submitScore() {
    if (pendingScore === null) return;

    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim();

    if (!name) {
        alert('Please enter your name!');
        return;
    }

    // Save name for next time
    localStorage.setItem('sledlaunch_playerName', name);

    try {
        const response = await fetch(API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                game: GAME_NAME,
                variant: 'default',
                name: name,
                score: -pendingScore // Negative because API sorts lower = better, but we want higher distance = better
            })
        });

        const data = await response.json();

        if (data.success) {
            pendingScore = null;
            document.getElementById('nameForm').style.display = 'none';
            // Refresh leaderboard
            openLeaderboard();
        } else {
            alert('Failed to submit score. Try again!');
        }
    } catch (error) {
        console.error('Submit error:', error);
        alert('Failed to submit score. Try again!');
    }
}

// Start the game
init();
