// Penis vs Vagina - A charmingly crude multiplayer platformer
// Using PartyKit for real-time multiplayer

// Global connection state
let partySocket = null;
let playerId = null;
let isMultiplayer = false;
let gameMode = null; // 'coop' or 'compete'
let isHost = false;
let roomCode = null;

// ============================================
// MANN.COOL VIRTUAL CONTROLLER SUPPORT
// ============================================
// Touch controls state for virtual controller
window.touchControls = {
    directions: { left: false, right: false, up: false, down: false, action: false },
    getDirections: function() { return this.directions; }
};

// Listen for postMessage from mann.cool virtual controller
window.addEventListener('message', (event) => {
    const { type, key, eventType } = event.data || {};

    // Resume audio context if suspended (browser suspends when clicking outside iframe)
    if (window.game && window.game.sound && window.game.sound.context) {
        const audioContext = window.game.sound.context;
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }

    // Handle keyboard events - update touchControls directly
    if (type === 'keyEvent' && key && eventType) {
        const isDown = eventType === 'keydown';
        const dirs = window.touchControls.directions;

        // Map keys to directions
        if (key === 'ArrowUp' || key === 'w' || key === 'W') {
            dirs.up = isDown;
        } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
            dirs.down = isDown;
        } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
            dirs.left = isDown;
        } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
            dirs.right = isDown;
        } else if (key === ' ' || key === 'Space') {
            dirs.action = isDown; // Space = shoot
        }
    }

    // Handle click events (for shoot button)
    if (type === 'clickEvent' && eventType) {
        const isDown = eventType === 'mousedown';
        window.touchControls.directions.action = isDown;
    }
});

// Detect if running in iframe and hide any native touch controls
if (window.parent !== window) {
    console.log('Running inside mann.cool iframe - virtual controls enabled');
}

// ============================================
// DIFFICULTY PROGRESSION SYSTEM
// ============================================
// Manages exponential difficulty scaling over ~10 minutes
// All values go from 0 (start) to 1 (max chaos) based on elapsed time

class DifficultyManager {
    constructor() {
        this.elapsedTime = 0; // in seconds
        this.maxTime = 300; // 5 minutes to reach full chaos
    }

    update(delta) {
        this.elapsedTime += delta / 1000; // convert ms to seconds
    }

    // Returns 0-1 based on elapsed time (smooth curve)
    // Uses a slight exponential curve so early game feels calmer
    getDifficultyMultiplier() {
        const t = Math.min(this.elapsedTime / this.maxTime, 1);
        return Math.pow(t, 1.3); // Slightly exponential
    }

    // Hat spawn interval - smooth ramp from 4000ms to 300ms
    getHatSpawnInterval() {
        const diff = this.getDifficultyMultiplier();
        return 4000 - (diff * 3700); // 4000ms -> 300ms
    }

    // Hat speed range - gradually increases
    getHatSpeedRange() {
        const diff = this.getDifficultyMultiplier();
        return {
            min: 100 + diff * 300,  // 100 -> 400
            max: 200 + diff * 400   // 200 -> 600
        };
    }

    // Hat scale range - gradually gets smaller (harder to hit)
    getHatScaleRange() {
        const diff = this.getDifficultyMultiplier();
        return {
            min: 0.18 - diff * 0.08,  // 0.18 -> 0.10
            max: 0.28 - diff * 0.13   // 0.28 -> 0.15
        };
    }

    // Pick a flight pattern with probability-based selection
    // Early game: 90% straight, 10% other
    // Late game: 10% straight, 90% complex patterns
    pickFlightPattern() {
        const diff = this.getDifficultyMultiplier();
        const roll = Math.random();

        // Probability of picking a "complex" pattern vs straight
        // Goes from 10% at start to 90% at end
        const complexChance = 0.1 + diff * 0.8;

        if (roll > complexChance) {
            return 'straight';
        }

        // Among complex patterns, weight them by difficulty
        // sineSmall available early, homing only late game
        const patternRoll = Math.random();

        // These thresholds shift as difficulty increases
        // Early: mostly sineSmall if complex
        // Late: more diagonal and homing
        const sineSmallMax = Math.max(0.2, 0.6 - diff * 0.4);  // 0.6 -> 0.2
        const sineLargeMax = sineSmallMax + Math.max(0.15, 0.3 - diff * 0.1); // +0.3 -> +0.2
        const diagonalMax = sineLargeMax + 0.15 + diff * 0.15; // +0.15 -> +0.3

        if (patternRoll < sineSmallMax) {
            return 'sineSmall';
        } else if (patternRoll < sineLargeMax) {
            return 'sineLarge';
        } else if (patternRoll < diagonalMax) {
            return 'diagonal';
        } else {
            // Homing - only really kicks in at higher difficulty
            // At low diff, this branch is rarely reached
            return diff > 0.3 ? 'homing' : 'sineLarge';
        }
    }

    // Number of hats to spawn - probability based
    // Early: 90% chance of 1 hat
    // Late: spread across 1-4 hats with bias toward more
    getHatsPerSpawn() {
        const diff = this.getDifficultyMultiplier();
        const roll = Math.random();

        // Probability thresholds for each count
        // At diff=0: [0.9, 0.97, 0.99, 1.0] -> 90% 1hat, 7% 2hat, 2% 3hat, 1% 4hat
        // At diff=1: [0.1, 0.35, 0.65, 1.0] -> 10% 1hat, 25% 2hat, 30% 3hat, 35% 4hat
        const oneHatMax = 0.9 - diff * 0.8;      // 0.9 -> 0.1
        const twoHatMax = oneHatMax + 0.07 + diff * 0.18;  // +0.07 -> +0.25
        const threeHatMax = twoHatMax + 0.02 + diff * 0.28; // +0.02 -> +0.30

        if (roll < oneHatMax) return 1;
        if (roll < twoHatMax) return 2;
        if (roll < threeHatMax) return 3;
        return 4;
    }

    // Ground terrain type - always flat
    getTerrainType() {
        return 'flat';
    }

    // Get difficulty phase name for UI display
    getDifficultyPhase() {
        const diff = this.getDifficultyMultiplier();
        if (diff >= 0.8) return 'PANDEMONIUM';
        if (diff >= 0.6) return 'CHAOS';
        if (diff >= 0.4) return 'INTENSE';
        if (diff >= 0.2) return 'RISING';
        return 'CALM';
    }

    // Terrain amplitude - always 0 since terrain is flat
    getTerrainAmplitude() {
        return 0;
    }

    // Terrain frequency - always 0 since terrain is flat
    getTerrainFrequency() {
        return 0;
    }

    // Get formatted time string for display
    getTimeString() {
        const mins = Math.floor(this.elapsedTime / 60);
        const secs = Math.floor(this.elapsedTime % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Mode Select Scene - Choose 1 Player or 2 Player
class ModeSelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ModeSelectScene' });
    }

    preload() {
        this.load.image('intro', 'assets/intro-screen.png');
        this.load.audio('introMusic', 'assets/intromusic.mp3');
    }

    create() {
        const { width, height } = this.scale;

        // Title
        const intro = this.add.image(width / 2, height * 0.2, 'intro');
        const introScale = Math.min(width / intro.width, height / intro.height) * 0.4;
        intro.setScale(introScale);

        // Play intro music
        if (!this.sound.get('introMusic')?.isPlaying) {
            this.introMusic = this.sound.add('introMusic', { loop: true });
            this.introMusic.play();
        }

        // Track menu options for keyboard/touch navigation
        this.menuOptions = [];
        this.selectedIndex = 0;

        // 1 Player button
        const onePlayerBtn = this.createButton(width / 2, height * 0.5, '1 PLAYER', () => {
            isMultiplayer = false;
            this.scene.start('SelectScene');
        });
        this.menuOptions.push({ btn: onePlayerBtn, callback: () => {
            isMultiplayer = false;
            this.scene.start('SelectScene');
        }});

        // 2 Player disabled (multiplayer not compatible with distance scoring / Play.fun)
        // const twoPlayerBtn = this.createButton(width / 2, height * 0.65, '2 PLAYER', () => {
        //     isMultiplayer = true;
        //     this.scene.start('LobbyChoiceScene');
        // });
        // this.menuOptions.push({ btn: twoPlayerBtn, callback: () => {
        //     isMultiplayer = true;
        //     this.scene.start('LobbyChoiceScene');
        // }});

        // Keyboard controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceBar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

        // Update visual selection
        this.updateMenuSelection();
    }

    createButton(x, y, text, callback) {
        // Responsive font and padding
        const { width, height } = this.scale;
        const screenScale = Math.min(width, height) / 1080;
        const fontSize = Math.round(36 * screenScale);
        const paddingX = Math.round(30 * screenScale);
        const paddingY = Math.round(15 * screenScale);

        const btn = this.add.text(x, y, text, {
            fontSize: fontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold',
            backgroundColor: '#ffffff',
            padding: { x: paddingX, y: paddingY }
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });

        // Hover effects
        btn.on('pointerover', () => {
            btn.setStyle({ backgroundColor: '#dddddd' });
        });
        btn.on('pointerout', () => {
            btn.setStyle({ backgroundColor: '#ffffff' });
        });
        btn.on('pointerdown', callback);

        // Draw border
        const borderPadding = 8 * screenScale;
        const border = this.add.rectangle(x, y, btn.width + borderPadding, btn.height + borderPadding);
        border.setStrokeStyle(3 * screenScale, 0x000000);
        border.setDepth(-1);
        btn.border = border;
        btn.screenScale = screenScale; // Store for updateMenuSelection

        return btn;
    }

    updateMenuSelection() {
        this.menuOptions.forEach((opt, i) => {
            const screenScale = opt.btn.screenScale || 1;
            if (i === this.selectedIndex) {
                opt.btn.setStyle({ backgroundColor: '#dddddd' });
                opt.btn.border.setStrokeStyle(5 * screenScale, 0x000000);
            } else {
                opt.btn.setStyle({ backgroundColor: '#ffffff' });
                opt.btn.border.setStrokeStyle(3 * screenScale, 0x000000);
            }
        });
    }

    update() {
        const touch = window.touchControls ? window.touchControls.directions : {};

        // Up/Down to navigate menu (keyboard or touch)
        const upPressed = Phaser.Input.Keyboard.JustDown(this.cursors.up) || (touch.up && !this.touchUpPressed);
        const downPressed = Phaser.Input.Keyboard.JustDown(this.cursors.down) || (touch.down && !this.touchDownPressed);

        if (upPressed && this.selectedIndex > 0) {
            this.selectedIndex--;
            this.updateMenuSelection();
        } else if (downPressed && this.selectedIndex < this.menuOptions.length - 1) {
            this.selectedIndex++;
            this.updateMenuSelection();
        }

        // Enter, Space, or action to select
        const actionPressed = Phaser.Input.Keyboard.JustDown(this.enterKey) ||
                              Phaser.Input.Keyboard.JustDown(this.spaceBar) ||
                              (touch.action && !this.touchActionPressed);
        if (actionPressed) {
            this.menuOptions[this.selectedIndex].callback();
        }

        // Track touch state for "just pressed" detection
        this.touchUpPressed = touch.up;
        this.touchDownPressed = touch.down;
        this.touchActionPressed = touch.action;
    }
}

// Lobby Choice Scene - Create or Join
class LobbyChoiceScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LobbyChoiceScene' });
    }

    create() {
        const { width, height } = this.scale;

        // Title
        const title = this.add.text(width / 2, height * 0.2, '2 PLAYER', {
            fontSize: '48px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        });
        title.setOrigin(0.5);

        // Track menu options for keyboard/touch navigation
        this.menuOptions = [];
        this.selectedIndex = 0;

        // Create Room button
        const createBtn = this.createButton(width / 2, height * 0.45, 'CREATE ROOM', () => {
            isHost = true;
            this.scene.start('CreateRoomScene');
        });
        this.menuOptions.push({ btn: createBtn, callback: () => {
            isHost = true;
            this.scene.start('CreateRoomScene');
        }});

        // Join Room button
        const joinBtn = this.createButton(width / 2, height * 0.6, 'JOIN ROOM', () => {
            isHost = false;
            this.scene.start('JoinRoomScene');
        });
        this.menuOptions.push({ btn: joinBtn, callback: () => {
            isHost = false;
            this.scene.start('JoinRoomScene');
        }});

        // Back button
        const backBtn = this.createButton(width / 2, height * 0.8, 'BACK', () => {
            this.scene.start('ModeSelectScene');
        });
        this.menuOptions.push({ btn: backBtn, callback: () => {
            this.scene.start('ModeSelectScene');
        }});

        // Keyboard controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceBar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

        // Update visual selection
        this.updateMenuSelection();
    }

    createButton(x, y, text, callback) {
        // Responsive font and padding
        const { width, height } = this.scale;
        const screenScale = Math.min(width, height) / 1080;
        const fontSize = Math.round(32 * screenScale);
        const paddingX = Math.round(25 * screenScale);
        const paddingY = Math.round(12 * screenScale);

        const btn = this.add.text(x, y, text, {
            fontSize: fontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold',
            backgroundColor: '#ffffff',
            padding: { x: paddingX, y: paddingY }
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#dddddd' }));
        btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#ffffff' }));
        btn.on('pointerdown', callback);

        const borderPadding = 8 * screenScale;
        const border = this.add.rectangle(x, y, btn.width + borderPadding, btn.height + borderPadding);
        border.setStrokeStyle(3 * screenScale, 0x000000);
        border.setDepth(-1);
        btn.border = border;
        btn.screenScale = screenScale; // Store for updateMenuSelection

        return btn;
    }

    updateMenuSelection() {
        this.menuOptions.forEach((opt, i) => {
            const screenScale = opt.btn.screenScale || 1;
            if (i === this.selectedIndex) {
                opt.btn.setStyle({ backgroundColor: '#dddddd' });
                opt.btn.border.setStrokeStyle(5 * screenScale, 0x000000);
            } else {
                opt.btn.setStyle({ backgroundColor: '#ffffff' });
                opt.btn.border.setStrokeStyle(3 * screenScale, 0x000000);
            }
        });
    }

    update() {
        const touch = window.touchControls ? window.touchControls.directions : {};

        // Up/Down to navigate menu (keyboard or touch)
        const upPressed = Phaser.Input.Keyboard.JustDown(this.cursors.up) || (touch.up && !this.touchUpPressed);
        const downPressed = Phaser.Input.Keyboard.JustDown(this.cursors.down) || (touch.down && !this.touchDownPressed);

        if (upPressed && this.selectedIndex > 0) {
            this.selectedIndex--;
            this.updateMenuSelection();
        } else if (downPressed && this.selectedIndex < this.menuOptions.length - 1) {
            this.selectedIndex++;
            this.updateMenuSelection();
        }

        // Enter, Space, or action to select
        const actionPressed = Phaser.Input.Keyboard.JustDown(this.enterKey) ||
                              Phaser.Input.Keyboard.JustDown(this.spaceBar) ||
                              (touch.action && !this.touchActionPressed);
        if (actionPressed) {
            this.menuOptions[this.selectedIndex].callback();
        }

        // Track touch state for "just pressed" detection
        this.touchUpPressed = touch.up;
        this.touchDownPressed = touch.down;
        this.touchActionPressed = touch.action;
    }
}

// Create Room Scene - Host creates a room and gets a code
class CreateRoomScene extends Phaser.Scene {
    constructor() {
        super({ key: 'CreateRoomScene' });
    }

    preload() {
        // Load character images for selection
        this.load.atlas('penis', 'assets/penis/penis.png', 'assets/penis/penis.json');
        this.load.image('vagina1', 'assets/vagina/vainga1.png');
    }

    create() {
        const { width, height } = this.scale;
        this.selectedCharacter = null;

        // Title
        this.add.text(width / 2, height * 0.08, 'CREATE ROOM', {
            fontSize: '42px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Character selection
        this.add.text(width / 2, height * 0.18, 'CHOOSE YOUR FIGHTER:', {
            fontSize: '24px',
            fontFamily: 'monospace',
            color: '#000000'
        }).setOrigin(0.5);

        // Character images
        const charY = height * 0.32;
        const charSpacing = width * 0.25;

        this.penisImg = this.add.image(width / 2 - charSpacing / 2, charY, 'penis', 'penis1.png');
        this.penisImg.setScale(0.15);
        this.penisImg.setInteractive({ useHandCursor: true });
        this.penisImg.on('pointerdown', () => this.selectCharacter('penis'));

        this.vaginaImg = this.add.image(width / 2 + charSpacing / 2, charY, 'vagina1');
        this.vaginaImg.setScale(0.15);
        this.vaginaImg.setInteractive({ useHandCursor: true });
        this.vaginaImg.on('pointerdown', () => this.selectCharacter('vagina'));

        // Selection boxes
        this.penisBox = this.add.graphics();
        this.vaginaBox = this.add.graphics();
        this.drawSelectionBoxes();

        // Status text
        this.statusText = this.add.text(width / 2, height * 0.48, 'Select a character to create room', {
            fontSize: '20px',
            fontFamily: 'monospace',
            color: '#666666'
        }).setOrigin(0.5);

        // Room code display (hidden initially)
        this.codeText = this.add.text(width / 2, height * 0.56, '', {
            fontSize: '64px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Waiting text
        this.waitingText = this.add.text(width / 2, height * 0.66, '', {
            fontSize: '18px',
            fontFamily: 'monospace',
            color: '#666666'
        }).setOrigin(0.5);

        // Player 2 info (positioned above mode selection)
        this.player2Text = this.add.text(width / 2, height * 0.60, '', {
            fontSize: '20px',
            fontFamily: 'monospace',
            color: '#00aa00',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Mode selection (hidden until player 2 joins)
        this.modeTitle = this.add.text(width / 2, height * 0.68, 'CHOOSE MODE:', {
            fontSize: '24px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5).setVisible(false);

        this.coopBtn = this.createButton(width / 2 - 100, height * 0.75, 'CO-OP', () => {
            this.selectMode('coop');
        });
        this.coopBtn.setVisible(false);

        this.competeBtn = this.createButton(width / 2 + 100, height * 0.75, 'COMPETE', () => {
            this.selectMode('compete');
        });
        this.competeBtn.setVisible(false);

        // Start button (hidden until mode selected)
        this.startBtn = this.createButton(width / 2, height * 0.85, 'START GAME', () => {
            this.startGame();
        });
        this.startBtn.setVisible(false);

        // Back button
        this.createButton(width / 2, height * 0.94, 'BACK', () => {
            this.disconnect();
            this.scene.start('LobbyChoiceScene');
        });
    }

    selectCharacter(character) {
        this.selectedCharacter = character;
        this.drawSelectionBoxes();

        // Now create room and connect
        if (!partySocket) {
            roomCode = this.generateRoomCode();
            this.statusText.setText('Creating room...');
            this.connectToParty(roomCode);
        }
    }

    drawSelectionBoxes() {
        const { width, height } = this.scale;
        const charY = height * 0.32;
        const charSpacing = width * 0.25;
        const boxSize = 200;

        this.penisBox.clear();
        this.vaginaBox.clear();

        // Penis box
        this.penisBox.lineStyle(this.selectedCharacter === 'penis' ? 6 : 2, 0x000000);
        this.penisBox.strokeRect(
            width / 2 - charSpacing / 2 - boxSize / 2,
            charY - boxSize / 2,
            boxSize, boxSize
        );

        // Vagina box
        this.vaginaBox.lineStyle(this.selectedCharacter === 'vagina' ? 6 : 2, 0x000000);
        this.vaginaBox.strokeRect(
            width / 2 + charSpacing / 2 - boxSize / 2,
            charY - boxSize / 2,
            boxSize, boxSize
        );
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    async connectToParty(code) {
        try {
            // Dynamic import of PartySocket
            const { PartySocket } = await import('https://esm.sh/partysocket@1.1.10');

            partySocket = new PartySocket({
                host: 'penis-vagina.songadaymann.partykit.dev',
                room: code,
            });

            partySocket.addEventListener('open', () => {
                console.log('Connected to party:', code);
                this.statusText.setText('Room created!');
                this.codeText.setText(code);
                this.waitingText.setText('Share this code with player 2');

                // Send join message with character choice
                partySocket.send(JSON.stringify({
                    type: 'join',
                    character: this.selectedCharacter
                }));
            });

            partySocket.addEventListener('message', (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            });

            partySocket.addEventListener('close', () => {
                console.log('Disconnected from party');
            });

            partySocket.addEventListener('error', (err) => {
                console.error('Party error:', err);
                this.statusText.setText('Connection error. Try again.');
            });

        } catch (err) {
            console.error('Failed to connect:', err);
            this.statusText.setText('Failed to create room. Try again.');
        }
    }

    handleMessage(data) {
        console.log('Received:', data);

        switch (data.type) {
            case 'roomState':
                playerId = data.yourId;
                isHost = data.state.hostId === playerId;
                this.updateLobbyState(data.state);
                break;

            case 'playerJoined':
                // Update lobby state with new player
                if (this.lobbyState) {
                    this.lobbyState.players[data.player.id] = data.player;
                }
                this.showPlayer2Info(this.lobbyState || { players: { [data.player.id]: data.player } });
                this.showModeSelection();
                break;

            case 'playerLeft':
                this.updatePlayerCount();
                break;

            case 'modeSet':
                gameMode = data.mode;
                this.updateModeDisplay();
                break;

            case 'gameStart':
                // Stop intro music before starting game
                const introMusic = this.sound.get('introMusic');
                if (introMusic) introMusic.stop();
                // Transition to game
                this.scene.start('MainScene', {
                    multiplayer: true,
                    gameState: data.state
                });
                break;
        }
    }

    updateLobbyState(state) {
        this.lobbyState = state;
        const playerCount = Object.keys(state.players).length;
        if (playerCount >= 2) {
            this.showPlayer2Info(state);
            this.showModeSelection();
        }
    }

    updatePlayerCount() {
        // Will be called with playerJoined event
        if (this.lobbyState) {
            const playerCount = Object.keys(this.lobbyState.players).length;
            if (playerCount >= 2) {
                this.showPlayer2Info(this.lobbyState);
                this.showModeSelection();
            }
        }
    }

    showPlayer2Info(state) {
        // Find the other player
        const players = Object.values(state.players);
        const otherPlayer = players.find(p => p.id !== playerId);
        if (otherPlayer) {
            const charName = otherPlayer.character === 'penis' ? 'PENIS' : 'VAGINA';
            this.player2Text.setText(`Player 2 joined as ${charName}!`);
        }
        // Don't show anything if no other player found
    }

    showModeSelection() {
        this.waitingText.setVisible(false);
        this.modeTitle.setVisible(true);
        this.coopBtn.setVisible(true);
        this.competeBtn.setVisible(true);
    }

    selectMode(mode) {
        gameMode = mode;
        partySocket.send(JSON.stringify({ type: 'setMode', mode }));
        this.updateModeDisplay();
    }

    updateModeDisplay() {
        // Highlight selected mode
        if (gameMode === 'coop') {
            this.coopBtn.setStyle({ backgroundColor: '#aaffaa' });
            this.competeBtn.setStyle({ backgroundColor: '#ffffff' });
        } else if (gameMode === 'compete') {
            this.competeBtn.setStyle({ backgroundColor: '#aaffaa' });
            this.coopBtn.setStyle({ backgroundColor: '#ffffff' });
        }
        this.startBtn.setVisible(true);
    }

    startGame() {
        partySocket.send(JSON.stringify({ type: 'startGame' }));
    }

    disconnect() {
        if (partySocket) {
            partySocket.close();
            partySocket = null;
        }
    }

    createButton(x, y, text, callback) {
        // Responsive font and padding
        const { width, height } = this.scale;
        const screenScale = Math.min(width, height) / 1080;
        const fontSize = Math.round(28 * screenScale);
        const paddingX = Math.round(20 * screenScale);
        const paddingY = Math.round(10 * screenScale);

        const btn = this.add.text(x, y, text, {
            fontSize: fontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold',
            backgroundColor: '#ffffff',
            padding: { x: paddingX, y: paddingY }
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => {
            if (btn.style.backgroundColor === '#ffffff') {
                btn.setStyle({ backgroundColor: '#dddddd' });
            }
        });
        btn.on('pointerout', () => {
            if (btn.style.backgroundColor === '#dddddd') {
                btn.setStyle({ backgroundColor: '#ffffff' });
            }
        });
        btn.on('pointerdown', callback);

        return btn;
    }
}

// Join Room Scene - Enter a code to join
class JoinRoomScene extends Phaser.Scene {
    constructor() {
        super({ key: 'JoinRoomScene' });
    }

    preload() {
        // Load character images for selection
        this.load.atlas('penis', 'assets/penis/penis.png', 'assets/penis/penis.json');
        this.load.image('vagina1', 'assets/vagina/vainga1.png');
    }

    create() {
        const { width, height } = this.scale;
        this.selectedCharacter = null;

        // Title
        this.add.text(width / 2, height * 0.08, 'JOIN ROOM', {
            fontSize: '42px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Character selection
        this.add.text(width / 2, height * 0.18, 'CHOOSE YOUR FIGHTER:', {
            fontSize: '24px',
            fontFamily: 'monospace',
            color: '#000000'
        }).setOrigin(0.5);

        // Character images
        const charY = height * 0.32;
        const charSpacing = width * 0.25;

        this.penisImg = this.add.image(width / 2 - charSpacing / 2, charY, 'penis', 'penis1.png');
        this.penisImg.setScale(0.15);
        this.penisImg.setInteractive({ useHandCursor: true });
        this.penisImg.on('pointerdown', () => this.selectCharacter('penis'));

        this.vaginaImg = this.add.image(width / 2 + charSpacing / 2, charY, 'vagina1');
        this.vaginaImg.setScale(0.15);
        this.vaginaImg.setInteractive({ useHandCursor: true });
        this.vaginaImg.on('pointerdown', () => this.selectCharacter('vagina'));

        // Selection boxes
        this.penisBox = this.add.graphics();
        this.vaginaBox = this.add.graphics();
        this.drawSelectionBoxes();

        // Instructions
        this.add.text(width / 2, height * 0.48, 'Enter room code:', {
            fontSize: '24px',
            fontFamily: 'monospace',
            color: '#000000'
        }).setOrigin(0.5);

        // Code input display
        this.enteredCode = '';
        this.codeDisplay = this.add.text(width / 2, height * 0.58, '____', {
            fontSize: '64px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold',
            letterSpacing: 20
        }).setOrigin(0.5);

        // Status text
        this.statusText = this.add.text(width / 2, height * 0.72, 'Select a character, then enter code', {
            fontSize: '18px',
            fontFamily: 'monospace',
            color: '#666666'
        }).setOrigin(0.5);

        // Keyboard input
        this.input.keyboard.on('keydown', (event) => {
            if (event.key === 'Backspace') {
                this.enteredCode = this.enteredCode.slice(0, -1);
            } else if (event.key.length === 1 && /[A-Za-z0-9]/.test(event.key) && this.enteredCode.length < 4) {
                this.enteredCode += event.key.toUpperCase();
            }
            this.updateCodeDisplay();

            // Auto-join when 4 characters entered AND character selected
            if (this.enteredCode.length === 4 && this.selectedCharacter) {
                this.joinRoom();
            } else if (this.enteredCode.length === 4 && !this.selectedCharacter) {
                this.statusText.setText('Please select a character first!');
            }
        });

        // Back button
        this.createButton(width / 2, height * 0.88, 'BACK', () => {
            this.disconnect();
            this.scene.start('LobbyChoiceScene');
        });
    }

    selectCharacter(character) {
        this.selectedCharacter = character;
        this.drawSelectionBoxes();
        this.statusText.setText('Now enter the room code');

        // If code already entered, join now
        if (this.enteredCode.length === 4) {
            this.joinRoom();
        }
    }

    drawSelectionBoxes() {
        const { width, height } = this.scale;
        const charY = height * 0.32;
        const charSpacing = width * 0.25;
        const boxSize = 200;

        this.penisBox.clear();
        this.vaginaBox.clear();

        // Penis box
        this.penisBox.lineStyle(this.selectedCharacter === 'penis' ? 6 : 2, 0x000000);
        this.penisBox.strokeRect(
            width / 2 - charSpacing / 2 - boxSize / 2,
            charY - boxSize / 2,
            boxSize, boxSize
        );

        // Vagina box
        this.vaginaBox.lineStyle(this.selectedCharacter === 'vagina' ? 6 : 2, 0x000000);
        this.vaginaBox.strokeRect(
            width / 2 + charSpacing / 2 - boxSize / 2,
            charY - boxSize / 2,
            boxSize, boxSize
        );
    }

    updateCodeDisplay() {
        const display = this.enteredCode.padEnd(4, '_').split('').join(' ');
        this.codeDisplay.setText(display);
    }

    async joinRoom() {
        if (!this.selectedCharacter) {
            this.statusText.setText('Please select a character first!');
            return;
        }

        this.statusText.setText('Connecting...');
        roomCode = this.enteredCode;

        try {
            const { PartySocket } = await import('https://esm.sh/partysocket@1.1.10');

            partySocket = new PartySocket({
                host: 'penis-vagina.songadaymann.partykit.dev',
                room: roomCode,
            });

            partySocket.addEventListener('open', () => {
                console.log('Connected to room:', roomCode);
                partySocket.send(JSON.stringify({
                    type: 'join',
                    character: this.selectedCharacter
                }));
            });

            partySocket.addEventListener('message', (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            });

            partySocket.addEventListener('error', () => {
                this.statusText.setText('Could not find room. Check code.');
                this.enteredCode = '';
                this.updateCodeDisplay();
            });

        } catch (err) {
            console.error('Failed to join:', err);
            this.statusText.setText('Connection failed. Try again.');
        }
    }

    handleMessage(data) {
        console.log('Received:', data);

        switch (data.type) {
            case 'roomState':
                playerId = data.yourId;
                isHost = data.state.hostId === playerId;
                gameMode = data.state.mode;
                this.statusText.setText('Joined! Waiting for host...');
                // Transition to waiting screen
                this.scene.start('WaitingScene', { state: data.state });
                break;

            case 'gameStart':
                // Stop intro music before starting game
                const introMusicJ = this.sound.get('introMusic');
                if (introMusicJ) introMusicJ.stop();
                this.scene.start('MainScene', {
                    multiplayer: true,
                    gameState: data.state
                });
                break;
        }
    }

    disconnect() {
        if (partySocket) {
            partySocket.close();
            partySocket = null;
        }
    }

    createButton(x, y, text, callback) {
        // Responsive font and padding
        const { width, height } = this.scale;
        const screenScale = Math.min(width, height) / 1080;
        const fontSize = Math.round(28 * screenScale);
        const paddingX = Math.round(20 * screenScale);
        const paddingY = Math.round(10 * screenScale);

        const btn = this.add.text(x, y, text, {
            fontSize: fontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold',
            backgroundColor: '#ffffff',
            padding: { x: paddingX, y: paddingY }
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#dddddd' }));
        btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#ffffff' }));
        btn.on('pointerdown', callback);

        return btn;
    }
}

// Waiting Scene - Non-host waits for host to start
class WaitingScene extends Phaser.Scene {
    constructor() {
        super({ key: 'WaitingScene' });
    }

    init(data) {
        this.gameState = data.state;
    }

    create() {
        const { width, height } = this.scale;

        // Title
        this.add.text(width / 2, height * 0.2, 'ROOM: ' + roomCode, {
            fontSize: '42px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Waiting message
        this.statusText = this.add.text(width / 2, height * 0.4, 'Waiting for host to start...', {
            fontSize: '24px',
            fontFamily: 'monospace',
            color: '#000000'
        }).setOrigin(0.5);

        // Mode display
        this.modeText = this.add.text(width / 2, height * 0.55, '', {
            fontSize: '28px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.updateModeDisplay();

        // Listen for messages
        if (partySocket) {
            partySocket.addEventListener('message', (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            });
        }

        // Back button
        this.createButton(width / 2, height * 0.85, 'LEAVE', () => {
            this.disconnect();
            this.scene.start('LobbyChoiceScene');
        });
    }

    handleMessage(data) {
        switch (data.type) {
            case 'modeSet':
                gameMode = data.mode;
                this.updateModeDisplay();
                break;

            case 'gameStart':
                // Stop intro music before starting game
                const introMusicW = this.sound.get('introMusic');
                if (introMusicW) introMusicW.stop();
                this.scene.start('MainScene', {
                    multiplayer: true,
                    gameState: data.state
                });
                break;

            case 'playerLeft':
                this.statusText.setText('Host disconnected!');
                break;
        }
    }

    updateModeDisplay() {
        if (gameMode) {
            this.modeText.setText('Mode: ' + (gameMode === 'coop' ? 'CO-OP' : 'COMPETE'));
        }
    }

    disconnect() {
        if (partySocket) {
            partySocket.close();
            partySocket = null;
        }
    }

    createButton(x, y, text, callback) {
        // Responsive font and padding
        const { width, height } = this.scale;
        const screenScale = Math.min(width, height) / 1080;
        const fontSize = Math.round(28 * screenScale);
        const paddingX = Math.round(20 * screenScale);
        const paddingY = Math.round(10 * screenScale);

        const btn = this.add.text(x, y, text, {
            fontSize: fontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold',
            backgroundColor: '#ffffff',
            padding: { x: paddingX, y: paddingY }
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#dddddd' }));
        btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#ffffff' }));
        btn.on('pointerdown', callback);

        return btn;
    }
}

// Character Select Scene (for single player only now)
class SelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SelectScene' });
    }

    preload() {
        this.load.image('intro', 'assets/intro-screen.png');
        this.load.image('chooseFighter', 'assets/chooseFighterText.png');
        this.load.atlas('penis', 'assets/penis/penis.png', 'assets/penis/penis.json');
        this.load.image('vagina1', 'assets/vagina/vainga1.png');
        this.load.audio('introMusic', 'assets/intromusic.mp3');
    }

    create() {
        const { width, height } = this.scale;

        // Title "PENIS VAGINA" at the top, smaller
        const intro = this.add.image(width / 2, height * 0.15, 'intro');
        const introScale = Math.min(width / intro.width, height / intro.height) * 0.35;
        intro.setScale(introScale);

        // Character sprites side by side in the middle
        const charY = height * 0.5;
        const charSpacing = width * 0.25;
        const charScale = Math.min(width, height) / 1080 * 0.4;

        // Penis character (left)
        this.penisSprite = this.add.image(width / 2 - charSpacing, charY, 'penis', 'penis1.png');
        this.penisSprite.setScale(charScale);

        // Vagina character (right)
        this.vaginaSprite = this.add.image(width / 2 + charSpacing, charY, 'vagina1');
        this.vaginaSprite.setScale(charScale);

        // Selection boxes around characters
        const boxWidth = this.penisSprite.displayWidth + 40;
        const boxHeight = this.penisSprite.displayHeight + 40;

        this.penisBox = this.add.rectangle(width / 2 - charSpacing, charY, boxWidth, boxHeight);
        this.penisBox.setStrokeStyle(4, 0x000000);
        this.penisBox.setFillStyle(0x000000, 0);

        this.vaginaBox = this.add.rectangle(width / 2 + charSpacing, charY, boxWidth, boxHeight);
        this.vaginaBox.setStrokeStyle(4, 0x000000);
        this.vaginaBox.setFillStyle(0x000000, 0);

        // "Choose Yer Fighter!" text at the bottom
        const chooseText = this.add.image(width / 2, height * 0.85, 'chooseFighter');
        const chooseScale = Math.min(width / chooseText.width, height / chooseText.height) * 0.4;
        chooseText.setScale(chooseScale);

        // Selection state
        this.selectedCharacter = 'penis';
        this.updateSelection();

        // Keyboard controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceBar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

        // Click/tap on boxes
        this.penisBox.setInteractive();
        this.vaginaBox.setInteractive();
        this.penisSprite.setInteractive();
        this.vaginaSprite.setInteractive();

        this.penisBox.on('pointerdown', () => {
            this.selectedCharacter = 'penis';
            this.updateSelection();
            this.startGame();
        });
        this.penisSprite.on('pointerdown', () => {
            this.selectedCharacter = 'penis';
            this.updateSelection();
            this.startGame();
        });

        this.vaginaBox.on('pointerdown', () => {
            this.selectedCharacter = 'vagina';
            this.updateSelection();
            this.startGame();
        });
        this.vaginaSprite.on('pointerdown', () => {
            this.selectedCharacter = 'vagina';
            this.updateSelection();
            this.startGame();
        });

        // Back button
        this.add.text(width / 2, height * 0.95, '< BACK', {
            fontSize: '20px',
            fontFamily: 'monospace',
            color: '#666666'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.scene.start('ModeSelectScene'));
    }

    updateSelection() {
        if (this.selectedCharacter === 'penis') {
            this.penisBox.setStrokeStyle(6, 0x000000);
            this.penisBox.setFillStyle(0x000000, 0.1);
            this.vaginaBox.setStrokeStyle(2, 0x888888);
            this.vaginaBox.setFillStyle(0x000000, 0);
        } else {
            this.vaginaBox.setStrokeStyle(6, 0x000000);
            this.vaginaBox.setFillStyle(0x000000, 0.1);
            this.penisBox.setStrokeStyle(2, 0x888888);
            this.penisBox.setFillStyle(0x000000, 0);
        }
    }

    startGame() {
        // Stop intro music if playing
        const introMusic = this.sound.get('introMusic');
        if (introMusic) introMusic.stop();

        this.scene.start('MainScene', {
            character: this.selectedCharacter,
            multiplayer: false
        });
    }

    update() {
        const touch = window.touchControls ? window.touchControls.directions : {};

        // Left/Right to switch selection (keyboard or touch)
        const leftPressed = Phaser.Input.Keyboard.JustDown(this.cursors.left) || (touch.left && !this.touchLeftPressed);
        const rightPressed = Phaser.Input.Keyboard.JustDown(this.cursors.right) || (touch.right && !this.touchRightPressed);

        if (leftPressed) {
            this.selectedCharacter = 'penis';
            this.updateSelection();
        } else if (rightPressed) {
            this.selectedCharacter = 'vagina';
            this.updateSelection();
        }

        // Enter, Space, or action button to start
        const actionPressed = Phaser.Input.Keyboard.JustDown(this.enterKey) ||
                              Phaser.Input.Keyboard.JustDown(this.spaceBar) ||
                              (touch.action && !this.touchActionPressed);
        if (actionPressed) {
            this.startGame();
        }

        // Track touch state for "just pressed" detection
        this.touchLeftPressed = touch.left;
        this.touchRightPressed = touch.right;
        this.touchActionPressed = touch.action;
    }
}

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    preload() {
        // Load the penis spritesheet
        this.load.atlas('penis', 'assets/penis/penis.png', 'assets/penis/penis.json');

        // Load the MAGA hat frames
        this.load.image('hat1', 'assets/hat/hat1.png');
        this.load.image('hat2', 'assets/hat/hat2.png');

        // Load the ICE hat frames
        this.load.image('icehat1', 'assets/hat/icehat1.png');
        this.load.image('icehat2', 'assets/hat/icehat2.png');

        // Load the projectile
        this.load.image('projectile', 'assets/projectile.png');

        // Load vagina frames
        this.load.image('vagina1', 'assets/vagina/vainga1.png'); // typo in filename
        for (let i = 2; i <= 8; i++) {
            this.load.image(`vagina${i}`, `assets/vagina/vagina${i}.png`);
        }

        // Load duck images
        this.load.image('penis_duck', 'assets/penis/penis-duck.png');
        this.load.image('vagina_duck', 'assets/vagina/vagina-duck.png');

        // Load explosion and smoke animations
        for (let i = 1; i <= 4; i++) {
            this.load.image(`explosionBig${i}`, `assets/Explosion/ExplosionBig${i}.png`);
            this.load.image(`explosionSmall${i}`, `assets/Explosion/ExplostionSmall${i}.png`); // typo in filename
            this.load.image(`smokeBig${i}`, `assets/GreySmoke/smokeBig${i}.png`);
            this.load.image(`smokeSmall${i}`, `assets/GreySmoke/smokeSmall${i}.png`);
        }

        // Load game music
        this.load.audio('gameMusic', 'assets/gameMusic.mp3');

        // Load parallax backgrounds
        this.load.image('sky', 'assets/parallax/sky.png');
        this.load.image('clouds_bg', 'assets/parallax/clouds_bg.png');
        this.load.image('mountains', 'assets/parallax/glacial_mountains.png');
        this.load.image('clouds_mg_3', 'assets/parallax/clouds_mg_3.png');
        this.load.image('clouds_mg_2', 'assets/parallax/clouds_mg_2.png');
        this.load.image('clouds_mg_1', 'assets/parallax/clouds_mg_1.png');
        this.load.image('cloud_lonely', 'assets/parallax/cloud_lonely.png');

        // Load health pizza frames (non-sequential numbering)
        this.load.image('healthPizza1', 'assets/healthPizza/healthPizza1.png');
        this.load.image('healthPizza2', 'assets/healthPizza/healthPizza2.png');
        this.load.image('healthPizza4', 'assets/healthPizza/healthPizza4.png');
        this.load.image('healthPizza5', 'assets/healthPizza/healthPizza5.png');
        for (let i = 12; i <= 17; i++) {
            this.load.image(`healthPizza${i}`, `assets/healthPizza/healthPizza${i}.png`);
        }

        // Load invincibility pizza frames (1-10)
        for (let i = 1; i <= 10; i++) {
            this.load.image(`invinciblePizza${i}`, `assets/infiinity-pizza/invinciblePizza${i}.png`);
        }

        // Load boss images
        this.load.image('boss_kristi', 'assets/kristi.png');
        this.load.image('boss_miller', 'assets/miller.png');
        this.load.image('boss_trump', 'assets/trump.png');
    }

    init(data) {
        // Get game configuration from scene data
        this.isMultiplayer = data.multiplayer || false;
        this.gameState = data.gameState || null;

        if (this.isMultiplayer && this.gameState) {
            // Multiplayer - get character from server-assigned player data
            const myPlayer = this.gameState.players[playerId];
            this.selectedCharacter = myPlayer ? myPlayer.character : 'penis';
            this.currentGameMode = this.gameState.mode;
        } else {
            // Single player - use selected character
            this.selectedCharacter = data.character || 'penis';
            this.currentGameMode = null;
        }
    }

    create() {
        const { width, height } = this.scale;

        // Create parallax background layers (furthest to closest)
        this.createParallaxBackgrounds(width, height);

        // Draw a wobbly hand-drawn ground line (scales with screen)
        this.groundY = height - (height * 0.04);
        this.drawGroundLine();

        // Initialize terrain segments array for dynamic terrain
        this.terrainSegments = [];
        this.lastTerrainX = -200;

        // Create the ground as a physics body (invisible) - used for flat terrain
        // For dynamic terrain, we'll use segmented physics bodies
        this.ground = this.add.rectangle(0, this.groundY, 10000000, 20, 0x000000, 0);
        this.ground.setOrigin(0.5, 0);
        this.physics.add.existing(this.ground, true);
        this.ground.body.position.y = this.groundY;

        // Create the local player sprite
        this.createPlayer();

        // Create remote player if multiplayer
        if (this.isMultiplayer) {
            this.createRemotePlayer();
            this.setupMultiplayerListeners();
        }

        // Handle window resize
        this.scale.on('resize', this.resize, this);

        // Set up camera to follow the player (horizontal fully, vertical with slight lerp for jumps)
        // Positive Y offset shifts camera down so ground stays near screen bottom
        this.cameras.main.startFollow(this.player, true, 1, 0.1);
        this.cameras.main.setFollowOffset(-width * 0.3, height * 0.15);

        // Track camera position for ground line
        this.cameraX = 0;

        // Add collision with ground
        this.physics.add.collider(this.player, this.ground);
        if (this.remotePlayer) {
            this.physics.add.collider(this.remotePlayer, this.ground);
        }

        // Create animations
        this.createAnimations();

        // Set up keyboard controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceBar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // Track facing direction
        this.facingRight = true;

        // Double jump tracking
        this.jumpCount = 0;
        this.maxJumps = 2;

        // Create projectiles group
        this.projectiles = this.physics.add.group();

        // Ammo/cooldown system
        this.ammo = 1.0; // 0 to 1, represents ammo bar fill
        this.ammoCost = 0.20; // How much ammo each shot costs (depletes slower)
        this.ammoRegenRate = 0.5; // How fast ammo regenerates per second
        this.minAmmoToShoot = 0.18; // Minimum ammo needed to fire
        this.ammoRegenDelay = 1000; // 1 second delay before regen starts when depleted
        this.ammoRegenTimer = 0; // Tracks time since depletion
        this.ammoWasDepleted = false; // Track if we hit empty
        this.createAmmoBar();

        // Charge-based shooting system
        this.isCharging = false;
        this.chargeStartTime = 0;
        this.minChargeTime = 50; // Minimum ms to register a charge (quick tap)
        this.maxChargeTime = 600; // Maximum charge time in ms
        this.minProjectileSpeed = { horiz: 350, vert: -500 }; // Quick tap
        this.maxProjectileSpeed = { horiz: 900, vert: -1200 }; // Full charge
        this.chargeDroplets = []; // Track active charge effect droplets
        this.lastSpurtTime = 0;

        // Tap/click charging
        this.input.on('pointerdown', () => {
            this.startCharging();
        });
        this.input.on('pointerup', () => {
            this.releaseCharge();
        });

        // Start with idle
        this.player.play('walk_' + this.selectedCharacter);
        this.player.play('idle_' + this.selectedCharacter);

        // Create hat animations
        this.createHatAnimations();

        // Create a group for the flying hats
        this.hats = this.physics.add.group();
        this.hatMap = {}; // Map hat IDs to sprites for multiplayer

        // Create pizza power-up group and animations
        this.pizzas = this.physics.add.group();
        this.createPizzaAnimations();

        // Invincibility power-up state
        this.isPowerInvincible = false; // Separate from damage invincibility
        this.powerInvincibleTimer = null;
        this.rainbowTween = null;

        // Create explosion and smoke animations
        this.createEffectAnimations();

        // Track which explosion to use (alternate big/small)
        this.useSmallExplosion = false;

        // Collision between projectiles and hats
        this.physics.add.overlap(this.projectiles, this.hats, (proj, hat) => {
            if (this.isMultiplayer) {
                // Tell server about the hit
                partySocket.send(JSON.stringify({
                    type: 'hatHit',
                    hatId: hat.hatId,
                    playerId: playerId
                }));
            }
            this.playHitEffect(hat.x, hat.y);
            proj.destroy();
            hat.destroy();
            if (hat.hatId) delete this.hatMap[hat.hatId];

            if (!this.isMultiplayer) {
                this.killScore += 10;
                this.score = this.killScore + this.distanceScore;
                this.updateScoreDisplay();
            }
        });

        // Collision between player BODY HITBOX and hats
        // We use the body sensor (not the player's foot hitbox) for hat collision
        // This gives us a larger collision area for the body while keeping small feet for terrain
        this.physics.add.overlap(this.playerBodySensor, this.hats, (_sensor, hat) => {
            if (this.isPowerInvincible) {
                // Power invincibility - destroy hats on contact!
                this.playHitEffect(hat.x, hat.y);
                hat.destroy();
                if (hat.hatId) delete this.hatMap[hat.hatId];
                if (!this.isMultiplayer) {
                    this.killScore += 10;
                    this.score = this.killScore + this.distanceScore;
                    this.updateScoreDisplay();
                }
            } else if (!this.isInvincible) {
                if (this.isMultiplayer) {
                    partySocket.send(JSON.stringify({
                        type: 'playerHit',
                        playerId: playerId
                    }));
                }
                this.loseLife();
                hat.destroy();
                if (hat.hatId) delete this.hatMap[hat.hatId];
            }
        });

        // Collision between player and pizzas
        this.physics.add.overlap(this.playerBodySensor, this.pizzas, (_sensor, pizza) => {
            // In multiplayer, send message to server; otherwise handle locally
            if (this.isMultiplayer && partySocket && pizza.pizzaId) {
                partySocket.send(JSON.stringify({
                    type: 'pizzaCollect',
                    pizzaId: pizza.pizzaId,
                    playerId: playerId
                }));
                // Apply effect locally immediately for responsiveness
                if (pizza.pizzaType === 'health') {
                    this.collectHealthPizza(pizza);
                } else if (pizza.pizzaType === 'invincible') {
                    this.collectInvincibilityPizza(pizza);
                }
                // Remove from map
                if (this.pizzaMap) delete this.pizzaMap[pizza.pizzaId];
            } else {
                // Single player - handle locally
                if (pizza.pizzaType === 'health') {
                    this.collectHealthPizza(pizza);
                } else if (pizza.pizzaType === 'invincible') {
                    this.collectInvincibilityPizza(pizza);
                }
            }
            pizza.destroy();
        });

        // Lives system
        this.lives = 3;
        this.sharedLives = this.isMultiplayer && this.currentGameMode === 'coop' ? 6 : null;
        this.isInvincible = false;
        this.createLivesDisplay();

        // Score system
        this.score = 0;
        this.killScore = 0;
        this.distanceScore = 0;
        this.startX = 200;
        this.lastDistanceX = 200;
        this.createScoreDisplay();

        // Timer for compete mode
        if (this.isMultiplayer && this.currentGameMode === 'compete') {
            this.timeRemaining = 90;
            this.createTimerDisplay();
        }

        // Play game music
        this.gameMusic = this.sound.add('gameMusic', { loop: true });
        this.gameMusic.play();

        // Initialize difficulty manager
        this.difficulty = new DifficultyManager();

        // Check URL for debug skips
        const urlParams = new URLSearchParams(window.location.search);
        // Time skip (e.g., ?time=120 for 2 minutes of difficulty)
        const startTime = urlParams.get('time');
        if (startTime) {
            this.difficulty.elapsedTime = parseInt(startTime, 10);
        }
        // Position skip (e.g., ?x=45000 to skip to Kristi boss)
        const startX = urlParams.get('x');
        if (startX && this.player) {
            this.player.x = parseInt(startX, 10);
        }

        // Spawn hats - only locally for single player, using dynamic timing
        if (!this.isMultiplayer) {
            this.lastHatSpawnTime = 0;
            this.nextHatSpawnDelay = this.difficulty.getHatSpawnInterval();
            // Initial spawn
            this.spawnHat();
        }

        // Pizza power-up spawning (single player only)
        if (!this.isMultiplayer) {
            this.lastPizzaSpawnTime = 0;
            this.pizzaSpawnInterval = 15000; // Spawn pizza every 15 seconds
        }

        // Boss system - three bosses at fixed positions
        this.setupBosses();

        // Create platforms
        this.platforms = this.physics.add.staticGroup();
        this.platformGraphics = this.add.graphics();
        this.platformData = [];

        this.platformGraphics.setDepth(0);
        this.player.setDepth(10);
        if (this.remotePlayer) this.remotePlayer.setDepth(9);

        // Platform collision
        this.physics.add.collider(this.player, this.platforms, null, (player, platform) => {
            return player.body.velocity.y >= 0 && player.body.bottom <= platform.body.top + 10;
        });
        if (this.remotePlayer) {
            this.physics.add.collider(this.remotePlayer, this.platforms, null, (player, platform) => {
                return player.body.velocity.y >= 0 && player.body.bottom <= platform.body.top + 10;
            });
        }

        this.lastPlatformX = width;
        this.spawnPlatformsAhead();

        // Network update rate limiter
        this.lastNetworkUpdate = 0;
        this.networkUpdateRate = 50; // ms between updates
    }

    createPlayer() {
        const { height } = this.scale;

        if (this.selectedCharacter === 'vagina') {
            this.player = this.physics.add.sprite(200, height / 2, 'vagina1');
            this.playerHitbox = { width: 522, height: 1585, offsetX: 93, offsetY: 68 };
            this.projectileOffset = { x: -26, y: -157 };
        } else {
            this.player = this.physics.add.sprite(200, height / 2, 'penis', 'penis1.png');
            this.playerHitbox = { width: 887, height: 1665, offsetX: 193, offsetY: 0 };
            this.projectileOffset = { x: 498, y: -814 };
        }

        this.updateCharacterScale();
        this.player.setBounce(0);

        // HITBOX CONFIGS: Store both standing and duck hitboxes for each character
        // Foot hitbox = circle at feet for terrain collision
        // Body hitbox = rectangle for hat/enemy collision
        if (this.selectedCharacter === 'vagina') {
            this.standingHitbox = {
                foot: { radius: 303, offsetX: 135, offsetY: 1083 },
                body: { width: 517, height: 1012, offsetX: -184, offsetY: -281 }
            };
            this.duckHitbox = {
                foot: { radius: 303, offsetX: 135, offsetY: 555 },
                body: { width: 983, height: 550, offsetX: 172, offsetY: -278 }
            };
        } else {
            this.standingHitbox = {
                foot: { radius: 294, offsetX: 134, offsetY: 1106 },
                body: { width: 1061, height: 1201, offsetX: 0, offsetY: -347 }
            };
            this.duckHitbox = {
                foot: { radius: 294, offsetX: 134, offsetY: 573 },
                body: { width: 1382, height: 617, offsetX: 100, offsetY: -253 }
            };
        }

        // Start with standing hitbox
        this.isDucking = false;
        this.applyHitbox(this.standingHitbox);

        // BODY HITBOX: Separate invisible sprite for hat/enemy collision
        // This allows the player to have a small foot hitbox for terrain
        // while still having a larger body hitbox for enemy collision
        this.createBodyHitbox();
    }

    // Apply a hitbox config (standing or duck) to the player
    applyHitbox(hitboxConfig) {
        this.currentHitbox = hitboxConfig;

        // Apply foot hitbox to player sprite
        this.player.body.setCircle(hitboxConfig.foot.radius);
        this.player.body.setOffset(hitboxConfig.foot.offsetX, hitboxConfig.foot.offsetY);

        // Store body config for the sensor (will be applied in updateBodyHitbox)
        this.bodyHitboxConfig = hitboxConfig.body;

        // Update the body sensor if it exists
        if (this.playerBodySensor) {
            this.updateBodyHitboxSize();
        }
    }

    // Update body hitbox sensor size (called when switching duck/standing)
    updateBodyHitboxSize() {
        const charScale = this.player.scale;
        const scaledWidth = this.bodyHitboxConfig.width * charScale;
        const scaledHeight = this.bodyHitboxConfig.height * charScale;
        this.playerBodySensor.body.setSize(scaledWidth, scaledHeight);
        this.playerBodySensor.body.setOffset(-scaledWidth / 2, -scaledHeight / 2);
    }

    createBodyHitbox() {
        const charScale = this.player.scale;

        // Create an invisible physics sprite for the body hitbox
        // Using a zone instead of sprite to avoid any rendering issues
        this.playerBodySensor = this.add.zone(this.player.x, this.player.y, 1, 1);
        this.physics.add.existing(this.playerBodySensor, false); // false = not static

        // Configure the body sensor physics
        this.playerBodySensor.body.setAllowGravity(false);
        this.playerBodySensor.body.setImmovable(true);

        // Set the size based on character and scale
        const scaledWidth = this.bodyHitboxConfig.width * charScale;
        const scaledHeight = this.bodyHitboxConfig.height * charScale;
        this.playerBodySensor.body.setSize(scaledWidth, scaledHeight);

        // Center the body on the zone position
        this.playerBodySensor.body.setOffset(-scaledWidth / 2, -scaledHeight / 2);
    }

    createRemotePlayer() {
        if (!this.gameState) return;

        // Find the other player
        const otherPlayerId = Object.keys(this.gameState.players).find(id => id !== playerId);
        if (!otherPlayerId) return;

        const otherPlayer = this.gameState.players[otherPlayerId];
        this.remotePlayerId = otherPlayerId;

        const { height } = this.scale;

        if (otherPlayer.character === 'vagina') {
            this.remotePlayer = this.physics.add.sprite(350, height / 2, 'vagina1');
            this.remotePlayerHitbox = { width: 522, height: 1585, offsetX: 93, offsetY: 68 };
        } else {
            this.remotePlayer = this.physics.add.sprite(350, height / 2, 'penis', 'penis1.png');
            this.remotePlayerHitbox = { width: 887, height: 1665, offsetX: 193, offsetY: 0 };
        }

        this.remotePlayer.setAlpha(0.7); // Slightly transparent to distinguish
        this.remotePlayer.setTint(0xaaaaff); // Slight blue tint
        this.updateRemoteCharacterScale();
        this.remotePlayer.setBounce(0.1);
        this.remotePlayer.body.setSize(this.remotePlayerHitbox.width, this.remotePlayerHitbox.height);
        this.remotePlayer.body.setOffset(this.remotePlayerHitbox.offsetX, this.remotePlayerHitbox.offsetY);

        this.remotePlayerCharacter = otherPlayer.character;

        // Start idle animation for remote player
        this.remotePlayer.play('idle_' + this.remotePlayerCharacter);
    }

    setupMultiplayerListeners() {
        if (!partySocket) return;

        partySocket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);
            this.handleMultiplayerMessage(data);
        });
    }

    handleMultiplayerMessage(data) {
        switch (data.type) {
            case 'playerUpdate':
                if (data.playerId !== playerId && this.remotePlayer) {
                    // Update remote player position
                    this.remotePlayer.x = data.x;
                    // Convert Y offset from ground to local screen coordinates
                    if (data.yOffsetFromGround !== undefined) {
                        this.remotePlayer.y = this.groundY + data.yOffsetFromGround;
                    } else if (data.y !== undefined) {
                        // Fallback for backwards compatibility
                        this.remotePlayer.y = data.y;
                    }
                    this.remotePlayer.setVelocity(data.velocityX, data.velocityY);
                    this.remotePlayer.setFlipX(!data.facingRight);

                    // Update animation
                    let animKey;
                    if (data.isDucking) {
                        animKey = 'duck_' + this.remotePlayerCharacter;
                    } else if (data.isWalking) {
                        animKey = 'walk_' + this.remotePlayerCharacter;
                    } else {
                        animKey = 'idle_' + this.remotePlayerCharacter;
                    }
                    if (this.remotePlayer.anims.currentAnim?.key !== animKey) {
                        this.remotePlayer.play(animKey, true);
                    }
                }
                break;

            case 'playerShoot':
                if (data.playerId !== playerId) {
                    // Create projectile for remote player's shot
                    this.createRemoteProjectile(data.x, data.y, data.velocityX, data.velocityY);
                }
                break;

            case 'hatSpawn':
                this.spawnHatFromServer(data.hat);
                break;

            case 'hatDestroyed':
                // Remove hat if it still exists locally
                if (this.hatMap[data.hatId]) {
                    this.playHitEffect(this.hatMap[data.hatId].x, this.hatMap[data.hatId].y);
                    this.hatMap[data.hatId].destroy();
                    delete this.hatMap[data.hatId];
                }
                break;

            case 'scoreUpdate':
                if (data.playerId === playerId) {
                    this.score = data.score;
                } else {
                    this.remoteScore = data.score;
                }
                if (data.combinedScore !== undefined) {
                    this.combinedScore = data.combinedScore;
                }
                this.updateScoreDisplay();
                break;

            case 'playerDamaged':
                if (data.playerId === playerId) {
                    // Already handled locally
                } else if (this.remotePlayer) {
                    // Flash remote player
                    this.remotePlayer.setTint(0xff0000);
                    this.time.delayedCall(200, () => {
                        if (this.remotePlayer) this.remotePlayer.setTint(0xaaaaff);
                    });
                }
                if (data.sharedLives !== undefined) {
                    this.sharedLives = data.sharedLives;
                    this.updateLivesDisplay();
                }
                break;

            case 'timerUpdate':
                this.timeRemaining = data.timeRemaining;
                this.updateTimerDisplay();
                break;

            case 'gameOver':
                this.handleMultiplayerGameOver(data);
                break;

            case 'pizzaSpawn':
                this.spawnPizzaFromServer(data.pizza);
                break;

            case 'pizzaCollected':
                // Remove pizza if it still exists locally
                if (this.pizzaMap && this.pizzaMap[data.pizzaId]) {
                    this.pizzaMap[data.pizzaId].destroy();
                    delete this.pizzaMap[data.pizzaId];
                }
                break;

            case 'playerHealed':
                if (data.sharedLives !== undefined) {
                    this.sharedLives = data.sharedLives;
                }
                if (data.playerId === playerId) {
                    this.lives = data.livesRemaining;
                }
                this.updateLivesDisplay();
                break;

            case 'playerInvincible':
                if (data.playerId === playerId) {
                    this.startInvincibility(data.duration);
                } else if (this.remotePlayer) {
                    // Remote player becomes invincible - show rainbow effect
                    this.startRemoteInvincibility(data.duration);
                }
                break;
        }
    }

    spawnPizzaFromServer(pizzaData) {
        const { width, height } = this.scale;
        const camX = this.cameras.main.scrollX;

        // Spawn relative to camera position
        const spawnX = camX + width + 200;
        const spawnY = pizzaData.y;

        const isHealthPizza = pizzaData.type === 'health';
        const pizzaKey = isHealthPizza ? 'healthPizza1' : 'invinciblePizza1';
        const pizzaAnim = isHealthPizza ? 'healthPizza_float' : 'invinciblePizza_float';

        const pizza = this.pizzas.create(spawnX, spawnY, pizzaKey);
        pizza.play(pizzaAnim);
        pizza.body.setAllowGravity(false);

        const pizzaScale = Math.min(width, height) / 1080 * 1.0;
        pizza.setScale(pizzaScale);
        pizza.pizzaType = pizzaData.type;
        pizza.pizzaId = pizzaData.id;
        pizza.speed = pizzaData.speed;
        pizza.bobOffset = pizzaData.bobOffset;
        pizza.baseY = spawnY;

        // Store in map for multiplayer sync
        if (!this.pizzaMap) this.pizzaMap = {};
        this.pizzaMap[pizzaData.id] = pizza;
    }

    startRemoteInvincibility(duration) {
        if (!this.remotePlayer) return;

        // Rainbow color cycle for remote player
        const colors = [0xff0000, 0xff7f00, 0xffff00, 0x00ff00, 0x0000ff, 0x4b0082, 0x9400d3];
        let colorIndex = 0;

        const rainbowTimer = this.time.addEvent({
            delay: 50,
            callback: () => {
                if (this.remotePlayer) {
                    this.remotePlayer.setTint(colors[colorIndex]);
                    colorIndex = (colorIndex + 1) % colors.length;
                }
            },
            loop: true
        });

        // End invincibility after duration
        this.time.delayedCall(duration, () => {
            rainbowTimer.destroy();
            if (this.remotePlayer) {
                this.remotePlayer.setTint(0xaaaaff); // Back to normal blue tint
            }
        });
    }

    createRemoteProjectile(x, y, velocityX, velocityY) {
        const charScale = this.player.scale;
        const projScale = charScale * 1.0;

        const proj = this.projectiles.create(x, y, 'projectile');
        proj.setScale(projScale);
        proj.setDepth(20);
        proj.setAlpha(0.7);
        proj.setTint(0xaaaaff);

        if (velocityX < 0) {
            proj.setFlipX(true);
        }

        proj.setVelocity(velocityX, velocityY);
        proj.body.setGravityY(600);
    }

    spawnHatFromServer(hatData) {
        const { width, height } = this.scale;

        // Spawn from the right side of the camera view
        const spawnX = this.cameras.main.scrollX + width + 100;
        const hatKey = hatData.type === 'ice' ? 'icehat1' : 'hat1';
        const hatAnim = hatData.type === 'ice' ? 'icehat_fly' : 'hat_fly';

        const hat = this.hats.create(spawnX, hatData.y, hatKey);
        hat.play(hatAnim);
        hat.body.setAllowGravity(false);

        // Apply screen-responsive scaling
        const screenScale = Math.min(width, height) / 1080;
        const hatScale = hatData.scale * screenScale;
        hat.setScale(hatScale);

        // Hitbox values tuned for the hat sprite (Phaser scales these with sprite.scale)
        hat.body.setSize(818, 554);
        hat.body.setOffset(1149, 456);

        hat.hatId = hatData.id;
        hat.speed = hatData.speed;
        hat.bobOffset = hatData.bobOffset;
        hat.bobSpeed = hatData.bobSpeed;
        hat.baseY = hatData.baseY;

        this.hatMap[hatData.id] = hat;
    }

    createAnimations() {
        // Vagina animations
        this.anims.create({
            key: 'walk_vagina',
            frames: [
                { key: 'vagina1' }, { key: 'vagina2' }, { key: 'vagina3' }, { key: 'vagina4' },
                { key: 'vagina5' }, { key: 'vagina6' }, { key: 'vagina7' }, { key: 'vagina8' }
            ],
            frameRate: 10,
            repeat: -1
        });

        this.anims.create({
            key: 'idle_vagina',
            frames: [{ key: 'vagina1' }],
            frameRate: 1,
            repeat: -1
        });

        // Penis animations
        this.anims.create({
            key: 'walk_penis',
            frames: [
                { key: 'penis', frame: 'penis1.png' }, { key: 'penis', frame: 'penis2.png' },
                { key: 'penis', frame: 'penis3.png' }, { key: 'penis', frame: 'penis4.png' },
                { key: 'penis', frame: 'penis5.png' }, { key: 'penis', frame: 'penis6.png' },
                { key: 'penis', frame: 'penis7.png' }, { key: 'penis', frame: 'penis8.png' }
            ],
            frameRate: 10,
            repeat: -1
        });

        this.anims.create({
            key: 'idle_penis',
            frames: [{ key: 'penis', frame: 'penis1.png' }],
            frameRate: 1,
            repeat: -1
        });

        // Duck animations (single frame each)
        this.anims.create({
            key: 'duck_vagina',
            frames: [{ key: 'vagina_duck' }],
            frameRate: 1,
            repeat: -1
        });

        this.anims.create({
            key: 'duck_penis',
            frames: [{ key: 'penis_duck' }],
            frameRate: 1,
            repeat: -1
        });
    }

    createHatAnimations() {
        this.anims.create({
            key: 'hat_fly',
            frames: [{ key: 'hat1' }, { key: 'hat2' }],
            frameRate: 8,
            repeat: -1
        });

        this.anims.create({
            key: 'icehat_fly',
            frames: [{ key: 'icehat1' }, { key: 'icehat2' }],
            frameRate: 8,
            repeat: -1
        });
    }

    createEffectAnimations() {
        this.anims.create({
            key: 'explosionBig',
            frames: [
                { key: 'explosionBig1' }, { key: 'explosionBig2' },
                { key: 'explosionBig3' }, { key: 'explosionBig4' }
            ],
            frameRate: 12,
            repeat: 0
        });

        this.anims.create({
            key: 'explosionSmall',
            frames: [
                { key: 'explosionSmall1' }, { key: 'explosionSmall2' },
                { key: 'explosionSmall3' }, { key: 'explosionSmall4' }
            ],
            frameRate: 12,
            repeat: 0
        });

        this.anims.create({
            key: 'smokeBig',
            frames: [
                { key: 'smokeBig1' }, { key: 'smokeBig2' },
                { key: 'smokeBig3' }, { key: 'smokeBig4' }
            ],
            frameRate: 10,
            repeat: 0
        });

        this.anims.create({
            key: 'smokeSmall',
            frames: [
                { key: 'smokeSmall1' }, { key: 'smokeSmall2' },
                { key: 'smokeSmall3' }, { key: 'smokeSmall4' }
            ],
            frameRate: 10,
            repeat: 0
        });
    }

    createPizzaAnimations() {
        // Health pizza animation (non-sequential frame numbers)
        this.anims.create({
            key: 'healthPizza_float',
            frames: [
                { key: 'healthPizza1' }, { key: 'healthPizza2' },
                { key: 'healthPizza4' }, { key: 'healthPizza5' },
                { key: 'healthPizza12' }, { key: 'healthPizza13' },
                { key: 'healthPizza14' }, { key: 'healthPizza15' },
                { key: 'healthPizza16' }, { key: 'healthPizza17' }
            ],
            frameRate: 10,
            repeat: -1
        });

        // Invincibility pizza animation (frames 1-10)
        this.anims.create({
            key: 'invinciblePizza_float',
            frames: [
                { key: 'invinciblePizza1' }, { key: 'invinciblePizza2' },
                { key: 'invinciblePizza3' }, { key: 'invinciblePizza4' },
                { key: 'invinciblePizza5' }, { key: 'invinciblePizza6' },
                { key: 'invinciblePizza7' }, { key: 'invinciblePizza8' },
                { key: 'invinciblePizza9' }, { key: 'invinciblePizza10' }
            ],
            frameRate: 10,
            repeat: -1
        });
    }

    spawnPizza() {
        const { width, height } = this.scale;

        // Spawn from the right side of the screen
        const spawnX = this.cameras.main.scrollX + width + 100;
        const spawnY = 150 + Math.random() * (height * 0.4);

        // 50/50 chance for health or invincibility pizza
        const isHealthPizza = Math.random() < 0.5;
        const pizzaKey = isHealthPizza ? 'healthPizza1' : 'invinciblePizza1';
        const pizzaAnim = isHealthPizza ? 'healthPizza_float' : 'invinciblePizza_float';

        const pizza = this.pizzas.create(spawnX, spawnY, pizzaKey);
        pizza.play(pizzaAnim);
        pizza.body.setAllowGravity(false);

        // Scale pizzas responsively like other game elements
        const pizzaScale = Math.min(width, height) / 1080 * 1.0;
        pizza.setScale(pizzaScale);
        pizza.pizzaType = isHealthPizza ? 'health' : 'invincible';

        // Float across screen with gentle bobbing
        pizza.speed = 80 + Math.random() * 40;
        pizza.bobOffset = Math.random() * Math.PI * 2;
        pizza.baseY = spawnY;
    }

    collectHealthPizza(_pizza) {
        // Restore 1 life, but cap at 3
        if (this.sharedLives !== null) {
            // Co-op mode - could sync with server, for now just local
            if (this.sharedLives < 6) {
                this.sharedLives++;
                this.updateLivesDisplay();
            }
        } else {
            if (this.lives < 3) {
                this.lives++;
                this.updateLivesDisplay();
                // Flash green to show life gained
                this.player.setTint(0x00ff00);
                this.time.delayedCall(200, () => {
                    if (!this.isPowerInvincible) {
                        this.player.clearTint();
                    }
                });
            }
        }
    }

    collectInvincibilityPizza(_pizza) {
        // Start 10 second invincibility with rainbow effect
        this.startInvincibility(10000);
    }

    startInvincibility(duration) {
        this.isPowerInvincible = true;
        this.isInvincible = true; // Also set damage invincibility

        // Clear any existing timer
        if (this.powerInvincibleTimer) {
            this.powerInvincibleTimer.remove();
        }

        // Start rainbow effect
        this.startRainbowEffect();

        // End after duration
        this.powerInvincibleTimer = this.time.delayedCall(duration, () => {
            this.stopRainbowEffect();
            this.isPowerInvincible = false;
            this.isInvincible = false;
            this.player.clearTint();
        });
    }

    startRainbowEffect() {
        // Rainbow colors to cycle through
        const rainbowColors = [
            0xff0000, // Red
            0xff7f00, // Orange
            0xffff00, // Yellow
            0x00ff00, // Green
            0x0000ff, // Blue
            0x4b0082, // Indigo
            0x9400d3  // Violet
        ];

        let colorIndex = 0;

        // Stop existing rainbow effect if any
        if (this.rainbowTimer) {
            this.rainbowTimer.remove();
        }

        // Cycle through colors rapidly
        this.rainbowTimer = this.time.addEvent({
            delay: 50, // Fast color cycling
            callback: () => {
                if (this.isPowerInvincible && this.player) {
                    this.player.setTint(rainbowColors[colorIndex]);
                    colorIndex = (colorIndex + 1) % rainbowColors.length;
                }
            },
            loop: true
        });
    }

    stopRainbowEffect() {
        if (this.rainbowTimer) {
            this.rainbowTimer.remove();
            this.rainbowTimer = null;
        }
    }

    // ============================================
    // BOSS SYSTEM
    // ============================================
    setupBosses() {
        const { height } = this.scale;

        // Boss configurations - appear at fixed X positions
        // At 750 px/sec: 1 min = 45000, 2 min = 90000, 3 min = 135000
        this.bossConfigs = [
            { key: 'boss_kristi', name: 'KRISTI', x: 45000, health: 20, hatSpawnRate: 800 },
            { key: 'boss_miller', name: 'MILLER', x: 90000, health: 30, hatSpawnRate: 600 },
            { key: 'boss_trump', name: 'TRUMP', x: 135000, health: 50, hatSpawnRate: 400 }
        ];

        // Debug: show boss hitboxes
        this.showBossHitboxes = false;

        this.bosses = [];
        this.activeBoss = null;

        // Create each boss (initially inactive/invisible until player gets close)
        this.bossConfigs.forEach((config, index) => {
            const bossY = height * 0.35; // Float in upper portion of screen

            const boss = this.add.sprite(config.x, bossY, config.key);

            // Scale boss to be large and imposing (about 2-3x player size)
            const bossScale = Math.min(this.scale.width, this.scale.height) / 1080 * 0.8;
            boss.setScale(bossScale);
            boss.setDepth(15);
            boss.setAlpha(0); // Start invisible

            // Boss data
            boss.bossIndex = index;
            boss.bossName = config.name;
            boss.maxHealth = config.health;
            boss.health = config.health;
            boss.hatSpawnRate = config.hatSpawnRate;
            boss.lastHatSpawn = 0;
            boss.isActive = false;
            boss.isDead = false;
            boss.baseY = bossY;
            boss.bobOffset = Math.random() * Math.PI * 2;

            // Create health bar background (below boss, slightly overlapping)
            const healthBarY = bossY + boss.displayHeight / 2 - 20;
            boss.healthBarBg = this.add.rectangle(config.x, healthBarY, 200, 20, 0x333333);
            boss.healthBarBg.setDepth(16);
            boss.healthBarBg.setAlpha(0);
            boss.healthBarBg.setStrokeStyle(3, 0x000000);

            // Create health bar fill
            boss.healthBarFill = this.add.rectangle(config.x - 100, healthBarY, 200, 16, 0xff0000);
            boss.healthBarFill.setOrigin(0, 0.5);
            boss.healthBarFill.setDepth(17);
            boss.healthBarFill.setAlpha(0);

            // Create boss name text (above health bar)
            boss.nameText = this.add.text(config.x, healthBarY - 20, config.name, {
                fontSize: '24px',
                fontFamily: 'monospace',
                color: '#ff0000',
                fontStyle: 'bold'
            });
            boss.nameText.setOrigin(0.5);
            boss.nameText.setDepth(17);
            boss.nameText.setAlpha(0);
            boss.nameText.setScrollFactor(1);

            this.bosses.push(boss);
        });
    }

    updateBosses(time, delta) {
        const camX = this.cameras.main.scrollX;
        const { width } = this.scale;

        this.bosses.forEach(boss => {
            if (boss.isDead) return;

            // Check if player is approaching this boss (within 1.5 screen widths)
            const distanceToBoss = boss.x - camX;

            // Activate boss when player gets within range
            if (!boss.isActive && distanceToBoss < width * 1.5 && distanceToBoss > -width * 0.5) {
                this.activateBoss(boss);
            }

            // Update active boss
            if (boss.isActive) {
                // Bob up and down
                boss.bobOffset += delta * 0.002;
                boss.y = boss.baseY + Math.sin(boss.bobOffset) * 20;

                // Update health bar position (below boss, slightly overlapping)
                const barY = boss.y + boss.displayHeight / 2 - 20;
                boss.healthBarBg.setPosition(boss.x, barY);
                boss.healthBarFill.setPosition(boss.x - 100, barY);
                boss.nameText.setPosition(boss.x, barY - 20);

                // Update debug hitbox position
                if (boss.hitboxDebug) {
                    boss.hitboxDebug.setPosition(boss.x, boss.y);
                }

                // Manual collision check with projectiles (backup)
                this.projectiles.getChildren().forEach(proj => {
                    if (!proj.active) return;
                    const dx = Math.abs(proj.x - boss.x);
                    const dy = Math.abs(proj.y - boss.y);
                    const hitWidth = boss.displayWidth * 0.4;
                    const hitHeight = boss.displayHeight * 0.4;
                    if (dx < hitWidth && dy < hitHeight) {
                        this.hitBoss(boss, proj);
                    }
                });

                // Spawn hats from mouth
                boss.lastHatSpawn += delta;
                if (boss.lastHatSpawn >= boss.hatSpawnRate) {
                    this.spawnBossHat(boss);
                    boss.lastHatSpawn = 0;
                }

                // Deactivate if player moves too far past
                if (distanceToBoss < -width) {
                    // Player passed the boss without killing it - keep it active but stop spawning
                }
            }
        });
    }

    activateBoss(boss) {
        boss.isActive = true;

        // Fade in boss and UI
        this.tweens.add({
            targets: [boss, boss.healthBarBg, boss.healthBarFill, boss.nameText],
            alpha: 1,
            duration: 500,
            ease: 'Power2'
        });

        // Add physics body for collision detection (dynamic so it updates position)
        this.physics.add.existing(boss, false);
        boss.body.setAllowGravity(false);
        boss.body.setImmovable(true);
        boss.body.setSize(boss.displayWidth * 0.8, boss.displayHeight * 0.8);

        // Debug hitbox visualization
        if (this.showBossHitboxes) {
            boss.hitboxDebug = this.add.rectangle(
                boss.x,
                boss.y,
                boss.displayWidth * 0.8,
                boss.displayHeight * 0.8
            );
            boss.hitboxDebug.setStrokeStyle(3, 0x00ff00);
            boss.hitboxDebug.setFillStyle(0x00ff00, 0.2);
            boss.hitboxDebug.setDepth(20);
        }

        // Setup collision between projectiles and this boss
        boss.collider = this.physics.add.overlap(this.projectiles, boss, (proj, b) => {
            this.hitBoss(b, proj);
        });
    }

    spawnBossHat(boss) {
        const { width, height } = this.scale;

        // Spawn hat from boss's mouth area (center-bottom of sprite)
        const spawnX = boss.x;
        const spawnY = boss.y + boss.displayHeight * 0.2; // Mouth area

        // Randomly choose hat type
        const hatType = Math.random() < 0.5 ? 'maga' : 'ice';
        const hatKey = hatType === 'maga' ? 'hat1' : 'icehat1';
        const animKey = hatType === 'maga' ? 'hat_fly' : 'icehat_fly';

        const hat = this.hats.create(spawnX, spawnY, hatKey);

        // Scale hats from boss
        const screenScale = Math.min(width, height) / 1080;
        const hatScale = (0.12 + Math.random() * 0.08) * screenScale;
        hat.setScale(hatScale);
        hat.play(animKey);

        // Set physics
        hat.body.setAllowGravity(false);

        // Random trajectory - spray outward from mouth
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8; // Mostly downward/outward
        const speed = 150 + Math.random() * 100;
        hat.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed + 50);

        // Hat properties for movement
        hat.flightPattern = 'straight';
        hat.elapsedTime = 0;
        hat.baseY = spawnY;
        hat.bobOffset = Math.random() * Math.PI * 2;
        hat.bobSpeed = 2 + Math.random() * 2;
        hat.speed = speed;
        hat.fromBoss = true;

        // Hitbox values tuned for the hat sprite (Phaser scales these with sprite.scale)
        hat.body.setSize(818, 554);
        hat.body.setOffset(1149, 456);
    }

    hitBoss(boss, projectile) {
        if (!boss || !boss.isActive || boss.isDead) return;
        if (!projectile || !projectile.active) return;

        console.log('Boss hit!', boss.bossName, 'Health:', boss.health);

        // Destroy the projectile
        projectile.destroy();

        // Damage the boss
        boss.health--;

        // Flash white then red for visibility
        boss.setTint(0xffffff);
        this.time.delayedCall(50, () => {
            if (!boss.isDead) boss.setTint(0xff0000);
        });
        this.time.delayedCall(150, () => {
            if (!boss.isDead) boss.clearTint();
        });

        // Update health bar - use scaleX directly
        const healthPercent = boss.health / boss.maxHealth;
        boss.healthBarFill.scaleX = healthPercent;

        console.log('Health percent:', healthPercent);

        // Check if boss is dead
        if (boss.health <= 0) {
            this.killBoss(boss);
        }

        // Screen shake
        this.cameras.main.shake(50, 0.005);

        // Add score
        this.killScore += 10;
        this.score = this.killScore + this.distanceScore;
        this.updateScoreDisplay();
    }

    killBoss(boss) {
        boss.isDead = true;
        boss.isActive = false;

        // Big explosion effect
        for (let i = 0; i < 5; i++) {
            this.time.delayedCall(i * 100, () => {
                const offsetX = (Math.random() - 0.5) * boss.displayWidth;
                const offsetY = (Math.random() - 0.5) * boss.displayHeight;
                this.playHitEffect(boss.x + offsetX, boss.y + offsetY);
            });
        }

        // Screen shake
        this.cameras.main.shake(500, 0.02);

        // Fade out and destroy
        const fadeTargets = [boss, boss.healthBarBg, boss.healthBarFill, boss.nameText];
        if (boss.hitboxDebug) fadeTargets.push(boss.hitboxDebug);

        this.tweens.add({
            targets: fadeTargets,
            alpha: 0,
            scale: boss.scale * 1.5,
            duration: 500,
            ease: 'Power2',
            onComplete: () => {
                boss.healthBarBg.destroy();
                boss.healthBarFill.destroy();
                boss.nameText.destroy();
                if (boss.hitboxDebug) boss.hitboxDebug.destroy();
                if (boss.collider) boss.collider.destroy();
                boss.destroy();
            }
        });

        // Bonus score for killing boss
        this.killScore += 50;
        this.score = this.killScore + this.distanceScore;
        this.updateScoreDisplay();

        // Show "BOSS DEFEATED" text
        const defeatText = this.add.text(boss.x, boss.y, boss.bossName + ' DEFEATED!', {
            fontSize: '36px',
            fontFamily: 'monospace',
            color: '#ffff00',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 4
        });
        defeatText.setOrigin(0.5);
        defeatText.setDepth(100);

        this.tweens.add({
            targets: defeatText,
            y: boss.y - 100,
            alpha: 0,
            duration: 2000,
            ease: 'Power2',
            onComplete: () => defeatText.destroy()
        });
    }

    spawnHat() {
        const { width, height } = this.scale;

        // How many hats to spawn at once (increases with difficulty)
        const hatsToSpawn = this.difficulty ? this.difficulty.getHatsPerSpawn() : 1;

        for (let i = 0; i < hatsToSpawn; i++) {
            this.spawnSingleHat(width, height, i);
        }
    }

    spawnSingleHat(width, height, spawnIndex = 0) {
        // Get difficulty-scaled values
        const speedRange = this.difficulty ? this.difficulty.getHatSpeedRange() : { min: 100, max: 200 };
        const scaleRange = this.difficulty ? this.difficulty.getHatScaleRange() : { min: 0.15, max: 0.25 };
        const flightPattern = this.difficulty ? this.difficulty.pickFlightPattern() : 'straight';

        // Spawn position - spread out if spawning multiple (responsive Y minimum)
        const screenScale = Math.min(width, height) / 1080;
        const minY = 100 * screenScale;
        const y = minY + Math.random() * (height * 0.5);
        const spawnX = this.cameras.main.scrollX + width + 100 * screenScale + (spawnIndex * 150 * screenScale);

        // Hat type
        const isIceHat = Math.random() < 0.5;
        const hatKey = isIceHat ? 'icehat1' : 'hat1';
        const hatAnim = isIceHat ? 'icehat_fly' : 'hat_fly';

        const hat = this.hats.create(spawnX, y, hatKey);
        hat.play(hatAnim);
        hat.body.setAllowGravity(false);

        // Scale from difficulty, adjusted for screen size (responsive)
        const baseHatScale = scaleRange.min + Math.random() * (scaleRange.max - scaleRange.min);
        const hatScale = baseHatScale * screenScale;
        hat.setScale(hatScale);

        // Hitbox values tuned for the hat sprite (Phaser scales these with sprite.scale)
        hat.body.setSize(818, 554);
        hat.body.setOffset(1149, 456);

        // Speed from difficulty
        hat.speed = speedRange.min + Math.random() * (speedRange.max - speedRange.min);

        // Flight pattern properties
        hat.flightPattern = flightPattern;
        hat.bobOffset = Math.random() * Math.PI * 2;
        hat.baseY = y;
        hat.spawnX = spawnX;
        hat.elapsedTime = 0;

        // Pattern-specific settings
        switch (flightPattern) {
            case 'straight':
                hat.bobSpeed = 0;
                hat.bobAmplitude = 0;
                break;
            case 'sineSmall':
                hat.bobSpeed = 2 + Math.random() * 2;
                hat.bobAmplitude = 20;
                break;
            case 'sineLarge':
                hat.bobSpeed = 3 + Math.random() * 3;
                hat.bobAmplitude = 60 + Math.random() * 40;
                break;
            case 'diagonal':
                // Diagonal movement - pick a direction
                hat.diagonalDirection = Math.random() < 0.5 ? 1 : -1;
                hat.diagonalSpeed = 50 + Math.random() * 100;
                hat.bobSpeed = 1;
                hat.bobAmplitude = 15;
                break;
            case 'homing':
                // Homing - will track player position
                hat.homingStrength = 0.02 + Math.random() * 0.02;
                hat.bobSpeed = 0;
                hat.bobAmplitude = 0;
                break;
        }
    }

    createLivesDisplay() {
        const { width, height } = this.scale;
        this.livesIcons = [];

        const lifeKey = this.selectedCharacter === 'vagina' ? 'vagina1' : 'penis';
        const lifeFrame = this.selectedCharacter === 'vagina' ? undefined : 'penis1.png';

        // Responsive scaling based on screen size
        const screenScale = Math.min(width, height) / 1080;
        const iconScale = 0.08 * screenScale;
        const spacing = 70 * screenScale;
        const startX = 50 * screenScale;
        const startY = 70 * screenScale;
        const fontSize = Math.round(14 * screenScale);

        const numLives = this.sharedLives || 3;

        for (let i = 0; i < numLives; i++) {
            const icon = this.add.image(startX + i * spacing, startY, lifeKey, lifeFrame);
            icon.setScale(iconScale);
            icon.setScrollFactor(0);
            icon.setDepth(100);
            this.livesIcons.push(icon);
        }

        // Label for co-op
        if (this.isMultiplayer && this.currentGameMode === 'coop') {
            this.livesLabel = this.add.text(startX, startY - 35 * screenScale, 'SHARED', {
                fontSize: fontSize + 'px',
                fontFamily: 'monospace',
                color: '#000000'
            });
            this.livesLabel.setScrollFactor(0);
            this.livesLabel.setDepth(100);
        }
    }

    updateLivesDisplay() {
        const currentLives = this.sharedLives !== null ? this.sharedLives : this.lives;
        for (let i = 0; i < this.livesIcons.length; i++) {
            this.livesIcons[i].setVisible(i < currentLives);
        }
    }

    createScoreDisplay() {
        const { width, height } = this.scale;

        // Responsive scaling
        const screenScale = Math.min(width, height) / 1080;
        const margin = 20 * screenScale;
        const scoreFontSize = Math.round(32 * screenScale);
        const labelFontSize = Math.round(14 * screenScale);
        const remoteScoreFontSize = Math.round(28 * screenScale);

        this.scoreText = this.add.text(width - margin, 30 * screenScale, '0', {
            fontSize: scoreFontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        });
        this.scoreText.setOrigin(1, 0.5);
        this.scoreText.setScrollFactor(0);
        this.scoreText.setDepth(100);

        // For compete mode, show both scores
        if (this.isMultiplayer && this.currentGameMode === 'compete') {
            this.remoteScore = 0;
            this.scoreLabel = this.add.text(width - margin, 55 * screenScale, 'YOU', {
                fontSize: labelFontSize + 'px',
                fontFamily: 'monospace',
                color: '#000000'
            });
            this.scoreLabel.setOrigin(1, 0.5);
            this.scoreLabel.setScrollFactor(0);
            this.scoreLabel.setDepth(100);

            this.remoteScoreText = this.add.text(width - margin, 85 * screenScale, '0', {
                fontSize: remoteScoreFontSize + 'px',
                fontFamily: 'monospace',
                color: '#6666ff',
                fontStyle: 'bold'
            });
            this.remoteScoreText.setOrigin(1, 0.5);
            this.remoteScoreText.setScrollFactor(0);
            this.remoteScoreText.setDepth(100);

            this.remoteScoreLabel = this.add.text(width - margin, 110 * screenScale, 'THEM', {
                fontSize: labelFontSize + 'px',
                fontFamily: 'monospace',
                color: '#6666ff'
            });
            this.remoteScoreLabel.setOrigin(1, 0.5);
            this.remoteScoreLabel.setScrollFactor(0);
            this.remoteScoreLabel.setDepth(100);
        }

        // For co-op mode, show combined score
        if (this.isMultiplayer && this.currentGameMode === 'coop') {
            this.combinedScore = 0;
            this.scoreLabel = this.add.text(width - margin, 55 * screenScale, 'TEAM', {
                fontSize: labelFontSize + 'px',
                fontFamily: 'monospace',
                color: '#000000'
            });
            this.scoreLabel.setOrigin(1, 0.5);
            this.scoreLabel.setScrollFactor(0);
            this.scoreLabel.setDepth(100);
        }
    }

    updateScoreDisplay() {
        this.scoreText.setText(this.score.toString());

        if (this.remoteScoreText) {
            this.remoteScoreText.setText(this.remoteScore.toString());
        }
    }

    createTimerDisplay() {
        const { width, height } = this.scale;

        // Responsive scaling
        const screenScale = Math.min(width, height) / 1080;
        const fontSize = Math.round(36 * screenScale);

        this.timerText = this.add.text(width / 2, 40 * screenScale, '1:30', {
            fontSize: fontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        });
        this.timerText.setOrigin(0.5);
        this.timerText.setScrollFactor(0);
        this.timerText.setDepth(100);
    }

    createTimeDisplay() {
        const { width, height } = this.scale;

        // Responsive scaling
        const screenScale = Math.min(width, height) / 1080;
        const timeFontSize = Math.round(24 * screenScale);
        const difficultyFontSize = Math.round(14 * screenScale);

        // Elapsed time display for single player
        this.elapsedTimeText = this.add.text(width / 2, 30 * screenScale, '0:00', {
            fontSize: timeFontSize + 'px',
            fontFamily: 'monospace',
            color: '#000000'
        });
        this.elapsedTimeText.setOrigin(0.5);
        this.elapsedTimeText.setScrollFactor(0);
        this.elapsedTimeText.setDepth(100);

        // Difficulty indicator below time
        this.difficultyText = this.add.text(width / 2, 55 * screenScale, 'CALM', {
            fontSize: difficultyFontSize + 'px',
            fontFamily: 'monospace',
            color: '#666666'
        });
        this.difficultyText.setOrigin(0.5);
        this.difficultyText.setScrollFactor(0);
        this.difficultyText.setDepth(100);
    }

    updateTimeDisplay() {
        if (!this.elapsedTimeText || !this.difficulty) return;

        this.elapsedTimeText.setText(this.difficulty.getTimeString());

        // Update difficulty indicator based on game phase (hat patterns)
        const phase = this.difficulty.getDifficultyPhase();
        const colors = {
            'CALM': '#666666',
            'RISING': '#336633',
            'INTENSE': '#996600',
            'CHAOS': '#cc3300',
            'PANDEMONIUM': '#ff0000'
        };

        this.difficultyText.setText(phase);
        this.difficultyText.setColor(colors[phase] || '#666666');
    }

    updateTimerDisplay() {
        if (!this.timerText) return;

        const minutes = Math.floor(this.timeRemaining / 60);
        const seconds = this.timeRemaining % 60;
        this.timerText.setText(`${minutes}:${seconds.toString().padStart(2, '0')}`);

        // Flash red when low
        if (this.timeRemaining <= 10) {
            this.timerText.setColor(this.timeRemaining % 2 === 0 ? '#ff0000' : '#000000');
        }
    }

    createAmmoBar() {
        const { width, height } = this.scale;

        // Responsive scaling
        const screenScale = Math.min(width, height) / 1080;

        // Position vertically under the score (upper right)
        const barWidth = 15 * screenScale;
        const barHeight = 80 * screenScale;
        const barX = width - 25 * screenScale; // Right aligned with score
        const barY = 70 * screenScale; // Below score text

        // Create graphics for the hand-drawn ammo bar
        this.ammoBarGraphics = this.add.graphics();
        this.ammoBarGraphics.setScrollFactor(0);
        this.ammoBarGraphics.setDepth(100);

        // Store bar dimensions for updates (vertical bar)
        this.ammoBarConfig = {
            x: barX - barWidth / 2,
            y: barY,
            width: barWidth,
            height: barHeight,
            isVertical: true
        };

        // Draw the initial bar
        this.updateAmmoBar();
    }

    updateAmmoBar() {
        if (!this.ammoBarGraphics || !this.ammoBarConfig) return;

        const { x, y, width, height } = this.ammoBarConfig;
        const g = this.ammoBarGraphics;

        g.clear();

        // Draw white fill (the ammo amount) - fills from bottom up
        const fillHeight = height * this.ammo;
        if (fillHeight > 0) {
            g.fillStyle(0xffffff, 1);
            // Draw with slight wobble for hand-drawn feel
            const fillY = y + height - fillHeight; // Start from bottom
            g.beginPath();
            g.moveTo(x + this.getWobble(), fillY + this.getWobble());
            g.lineTo(x + width + this.getWobble(), fillY + this.getWobble());
            g.lineTo(x + width + this.getWobble(), y + height + this.getWobble());
            g.lineTo(x + this.getWobble(), y + height + this.getWobble());
            g.closePath();
            g.fillPath();
        }

        // Draw black outline (hand-drawn wobbly style)
        g.lineStyle(3, 0x000000, 1);

        // Left edge
        g.beginPath();
        g.moveTo(x + this.getWobble(), y + this.getWobble());
        for (let py = y; py <= y + height; py += 10) {
            g.lineTo(x + this.getWobble(), py + this.getWobble());
        }
        g.strokePath();

        // Bottom edge
        g.beginPath();
        g.moveTo(x + this.getWobble(), y + height + this.getWobble());
        g.lineTo(x + width + this.getWobble(), y + height + this.getWobble());
        g.strokePath();

        // Right edge
        g.beginPath();
        g.moveTo(x + width + this.getWobble(), y + height + this.getWobble());
        for (let py = y + height; py >= y; py -= 10) {
            g.lineTo(x + width + this.getWobble(), py + this.getWobble());
        }
        g.strokePath();

        // Top edge
        g.beginPath();
        g.moveTo(x + width + this.getWobble(), y + this.getWobble());
        g.lineTo(x + this.getWobble(), y + this.getWobble());
        g.strokePath();

        // Draw threshold line (where you can shoot again) - horizontal line
        const thresholdY = y + height - (height * this.minAmmoToShoot);
        g.lineStyle(2, 0x666666, 0.5);
        g.beginPath();
        g.moveTo(x + 2, thresholdY);
        g.lineTo(x + width - 2, thresholdY);
        g.strokePath();

        // If ammo is below threshold, tint the bar red
        if (this.ammo < this.minAmmoToShoot) {
            g.lineStyle(2, 0xff0000, 0.3);
            g.strokeRect(x - 2, y - 2, width + 4, height + 4);
        }
    }

    regenerateAmmo(delta) {
        if (this.ammo < 1.0) {
            // If ammo was fully depleted, wait for delay before regenerating
            if (this.ammoWasDepleted) {
                this.ammoRegenTimer += delta;
                if (this.ammoRegenTimer >= this.ammoRegenDelay) {
                    // Delay is over, start regenerating
                    this.ammoWasDepleted = false;
                    this.ammoRegenTimer = 0;
                }
                // Still in delay period - just update the bar (shows empty)
                this.updateAmmoBar();
                return;
            }

            // Normal regeneration
            this.ammo = Math.min(1.0, this.ammo + this.ammoRegenRate * (delta / 1000));
            this.updateAmmoBar();
        }
    }

    loseLife() {
        if (this.sharedLives !== null) {
            // Co-op mode - server manages shared lives
        } else {
            this.lives--;
            this.updateLivesDisplay();
        }

        this.isInvincible = true;
        this.player.setTint(0xff0000);

        this.cameras.main.shake(200, 0.02);

        this.time.addEvent({
            delay: 100,
            repeat: 5,
            callback: () => {
                this.player.visible = !this.player.visible;
            }
        });

        this.time.delayedCall(1500, () => {
            this.isInvincible = false;
            this.player.clearTint();
            this.player.visible = true;
        });

        if (!this.isMultiplayer && this.lives <= 0) {
            this.gameOver();
        }
    }

    gameOver() {
        this.physics.pause();
        this.gameMusic.stop();

        // Get time string for leaderboard
        const timeString = this.difficulty ? this.difficulty.getTimeString() : '0:00';

        // Transition to GameOverScene with score data
        this.scene.start('GameOverScene', {
            score: this.score,
            killScore: this.killScore,
            distanceScore: this.distanceScore,
            time: timeString,
            character: this.selectedCharacter
        });
    }

    handleMultiplayerGameOver(data) {
        this.physics.pause();
        this.gameMusic.stop();

        const { width, height } = this.scale;

        let titleText, resultText;

        if (this.currentGameMode === 'coop') {
            titleText = 'GAME OVER';
            resultText = `Team Score: ${data.combinedScore}`;
        } else {
            // Compete mode
            if (data.winner === playerId) {
                titleText = 'YOU WIN!';
            } else if (data.winner) {
                titleText = 'YOU LOSE!';
            } else {
                titleText = 'TIE GAME!';
            }
            resultText = `Your Score: ${data.finalScores[playerId] || 0}`;
        }

        const gameOverText = this.add.text(width / 2, height / 2 - 30, titleText, {
            fontSize: '64px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        });
        gameOverText.setOrigin(0.5);
        gameOverText.setScrollFactor(0);
        gameOverText.setDepth(200);

        const scoreText = this.add.text(width / 2, height / 2 + 40, resultText, {
            fontSize: '32px',
            fontFamily: 'monospace',
            color: '#000000'
        });
        scoreText.setOrigin(0.5);
        scoreText.setScrollFactor(0);
        scoreText.setDepth(200);

        const restartText = this.add.text(width / 2, height / 2 + 100, 'Click to return to menu', {
            fontSize: '20px',
            fontFamily: 'monospace',
            color: '#000000'
        });
        restartText.setOrigin(0.5);
        restartText.setScrollFactor(0);
        restartText.setDepth(200);

        this.input.once('pointerdown', () => {
            if (partySocket) {
                partySocket.close();
                partySocket = null;
            }
            this.scene.start('ModeSelectScene');
        });
    }

    playHitEffect(x, y) {
        const explosionKey = this.useSmallExplosion ? 'explosionSmall' : 'explosionBig';
        const smokeKey = this.useSmallExplosion ? 'smokeSmall' : 'smokeBig';
        this.useSmallExplosion = !this.useSmallExplosion;

        const scale = Math.min(this.scale.width, this.scale.height) / 1080 * 6;

        const explosion = this.add.sprite(x, y, explosionKey + '1');
        explosion.setScale(scale);
        explosion.setDepth(25);
        explosion.play(explosionKey);
        explosion.on('animationcomplete', () => explosion.destroy());

        this.time.delayedCall(100, () => {
            const smoke = this.add.sprite(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, smokeKey + '1');
            smoke.setScale(scale * 0.8);
            smoke.setDepth(24);
            smoke.play(smokeKey);
            smoke.on('animationcomplete', () => smoke.destroy());
        });

        this.cameras.main.shake(150, 0.01);
    }

    shootProjectile(chargeAmount = 1.0) {
        // Check if we have enough ammo or if we're in depleted cooldown
        if (this.ammo < this.minAmmoToShoot || this.ammoWasDepleted) {
            // Not enough ammo - could add a "click" sound here
            return;
        }

        // Consume ammo
        this.ammo = Math.max(0, this.ammo - this.ammoCost);

        // Check if we just depleted the bar
        if (this.ammo < this.minAmmoToShoot) {
            this.ammoWasDepleted = true;
            this.ammoRegenTimer = 0;
        }

        this.updateAmmoBar();

        const charScale = this.player.scale;
        const projScale = charScale * 1.0;

        const offsetX = this.facingRight ? this.projectileOffset.x * charScale : -this.projectileOffset.x * charScale;
        const offsetY = this.projectileOffset.y * charScale;

        const spawnX = this.player.x + offsetX;
        const spawnY = this.player.y + offsetY;

        const proj = this.projectiles.create(spawnX, spawnY, 'projectile');
        proj.setScale(projScale);
        proj.setDepth(20);

        if (!this.facingRight) {
            proj.setFlipX(true);
        }

        // Calculate velocity based on charge amount (0-1)
        const minH = this.minProjectileSpeed.horiz;
        const maxH = this.maxProjectileSpeed.horiz;
        const minV = this.minProjectileSpeed.vert;
        const maxV = this.maxProjectileSpeed.vert;

        const baseHorizSpeed = minH + (maxH - minH) * chargeAmount;
        const baseVertSpeed = minV + (maxV - minV) * chargeAmount;

        // Add player's velocity so projectile always moves away from player (Mario fireball style)
        const playerVelX = this.player.body.velocity.x;
        const horizSpeed = (this.facingRight ? baseHorizSpeed : -baseHorizSpeed) + playerVelX;
        const vertSpeed = baseVertSpeed;
        proj.setVelocity(horizSpeed, vertSpeed);
        proj.body.setGravityY(600);

        // Notify other player in multiplayer
        if (this.isMultiplayer && partySocket) {
            partySocket.send(JSON.stringify({
                type: 'shoot',
                x: spawnX,
                y: spawnY,
                velocityX: horizSpeed,
                velocityY: vertSpeed
            }));
        }

        this.createSpurtEffect(spawnX, spawnY, charScale);
        this.cameras.main.shake(50, 0.003);
    }

    createSpurtEffect(x, y, scale) {
        const spurtScale = scale * 0.7;

        for (let i = 0; i < 4; i++) {
            const droplet = this.add.image(x, y, 'projectile');
            droplet.setScale(spurtScale);
            droplet.setDepth(19);

            const goingRight = i < 2;
            droplet.setFlipX(!goingRight);

            const hSpeed = (goingRight ? 1 : -1) * (150 + Math.random() * 200);
            const vSpeed = -200 - Math.random() * 300;

            this.tweens.add({
                targets: droplet,
                x: droplet.x + hSpeed * 0.5,
                y: droplet.y + vSpeed * 0.3 + 100,
                alpha: 0,
                scale: spurtScale * 0.3,
                duration: 400 + Math.random() * 200,
                ease: 'Quad.easeOut',
                onComplete: () => droplet.destroy()
            });
        }
    }

    startCharging() {
        // Don't start charging if we can't shoot
        if (this.ammo < this.minAmmoToShoot || this.ammoWasDepleted) {
            return;
        }

        this.isCharging = true;
        this.chargeStartTime = this.time.now;
        this.lastSpurtTime = 0;

        // Clean up any existing charge droplets
        if (this.chargeDroplets) {
            this.chargeDroplets.forEach(d => d.destroy());
        }
        this.chargeDroplets = [];
    }

    releaseCharge() {
        if (!this.isCharging) return;

        const chargeTime = this.time.now - this.chargeStartTime;
        const clampedChargeTime = Math.min(chargeTime, this.maxChargeTime);
        const chargeAmount = Math.max(0, Math.min(1, clampedChargeTime / this.maxChargeTime));

        this.isCharging = false;

        // Clean up charge droplets
        if (this.chargeDroplets) {
            this.chargeDroplets.forEach(d => {
                if (d && d.destroy) d.destroy();
            });
            this.chargeDroplets = [];
        }

        // Fire the projectile with the charge amount
        this.shootProjectile(chargeAmount);
    }

    updateChargeIndicator(time) {
        if (!this.player) return;

        const chargeTime = time - this.chargeStartTime;
        const chargeAmount = Math.min(1, chargeTime / this.maxChargeTime);

        const charScale = this.player.scale;
        const offsetX = this.facingRight ? this.projectileOffset.x * charScale : -this.projectileOffset.x * charScale;
        const offsetY = this.projectileOffset.y * charScale;

        const x = this.player.x + offsetX;
        const y = this.player.y + offsetY;

        // Shake the player as charge builds (subtle at first, intense at full)
        if (chargeAmount > 0.2) {
            const shakeIntensity = (chargeAmount - 0.2) * 3; // 0 to 2.4
            this.player.x += (Math.random() - 0.5) * shakeIntensity;
            this.player.y += (Math.random() - 0.5) * shakeIntensity * 0.5;
        }

        // Spawn rate increases with charge (from every 150ms to every 30ms)
        const spawnInterval = 150 - chargeAmount * 120;

        if (time - this.lastSpurtTime > spawnInterval) {
            this.lastSpurtTime = time;

            // Number of droplets per spawn increases with charge (1-4)
            const dropletCount = Math.ceil(1 + chargeAmount * 3);

            // Spawn radius increases with charge (droplets spread further apart)
            const spawnRadius = chargeAmount * 25 * charScale;

            for (let i = 0; i < dropletCount; i++) {
                // Offset spawn position by random amount within radius
                const spawnAngle = Math.random() * Math.PI * 2;
                const spawnDist = Math.random() * spawnRadius;
                const spawnX = x + Math.cos(spawnAngle) * spawnDist;
                const spawnY = y + Math.sin(spawnAngle) * spawnDist;

                const droplet = this.add.image(spawnX, spawnY, 'projectile');

                // Scale increases with charge
                const baseScale = charScale * (0.3 + chargeAmount * 0.5);
                droplet.setScale(baseScale);
                droplet.setDepth(19);
                droplet.setAlpha(0.7 + chargeAmount * 0.3);

                // Random direction, biased upward
                const angle = Math.random() * Math.PI * 2;
                const speed = 30 + chargeAmount * 70 + Math.random() * 40;
                const hSpeed = Math.cos(angle) * speed;
                const vSpeed = Math.sin(angle) * speed - 20 - chargeAmount * 30; // bias upward

                // Flip based on horizontal direction
                droplet.setFlipX(hSpeed > 0);

                // Duration gets shorter as charge builds (more frantic)
                const duration = 300 - chargeAmount * 150 + Math.random() * 100;

                this.tweens.add({
                    targets: droplet,
                    x: droplet.x + hSpeed * (duration / 1000),
                    y: droplet.y + vSpeed * (duration / 1000),
                    alpha: 0,
                    scale: baseScale * 0.2,
                    duration: duration,
                    ease: 'Quad.easeOut',
                    onComplete: () => {
                        droplet.destroy();
                        // Remove from tracking array
                        if (this.chargeDroplets) {
                            const idx = this.chargeDroplets.indexOf(droplet);
                            if (idx > -1) this.chargeDroplets.splice(idx, 1);
                        }
                    }
                });

                if (this.chargeDroplets) {
                    this.chargeDroplets.push(droplet);
                }
            }
        }
    }

    createParallaxBackgrounds(width, height) {
        // Store layer data for dynamic extension
        this.parallaxLayers = [];

        const createLayer = (key, scrollFactor, depth) => {
            const texture = this.textures.get(key);
            const imgWidth = texture.getSourceImage().width;
            const imgHeight = texture.getSourceImage().height;

            const scale = height / imgHeight;
            const scaledWidth = imgWidth * scale;

            // Create initial tiles to cover screen plus buffer
            const tilesNeeded = Math.ceil(width / scaledWidth) + 3;
            const tiles = [];

            for (let i = -2; i < tilesNeeded; i++) {
                const layer = this.add.image(i * scaledWidth, 0, key);
                layer.setOrigin(0, 0);
                layer.setScale(scale);
                layer.setScrollFactor(scrollFactor, 0);
                layer.setDepth(depth);
                tiles.push(layer);
            }

            // Store layer info for dynamic extension
            this.parallaxLayers.push({
                key,
                scrollFactor,
                depth,
                scale,
                scaledWidth,
                tiles,
                lastTileX: (tilesNeeded - 1) * scaledWidth
            });
        };

        createLayer('sky', 0, -100);
        createLayer('clouds_bg', 0.1, -90);
        createLayer('mountains', 0.2, -80);
        createLayer('clouds_mg_3', 0.3, -70);
        createLayer('clouds_mg_2', 0.4, -60);
        createLayer('clouds_mg_1', 0.5, -50);

        this.lonelyCloudTimer = 0;
        this.lonelyClouds = [];
    }

    updateParallaxBackgrounds() {
        const { width } = this.scale;
        const camX = this.cameras.main.scrollX;

        this.parallaxLayers.forEach(layerData => {
            // Calculate the effective camera position for this layer's scroll factor
            const effectiveCamX = camX * layerData.scrollFactor;
            const rightEdge = effectiveCamX + width + 200;

            // Add new tiles ahead if needed
            while (layerData.lastTileX < rightEdge) {
                layerData.lastTileX += layerData.scaledWidth;
                const newTile = this.add.image(layerData.lastTileX, 0, layerData.key);
                newTile.setOrigin(0, 0);
                newTile.setScale(layerData.scale);
                newTile.setScrollFactor(layerData.scrollFactor, 0);
                newTile.setDepth(layerData.depth);
                layerData.tiles.push(newTile);
            }

            // Remove old tiles that are far behind camera
            const leftCleanup = effectiveCamX - layerData.scaledWidth * 2;
            layerData.tiles = layerData.tiles.filter(tile => {
                if (tile.x + layerData.scaledWidth < leftCleanup) {
                    tile.destroy();
                    return false;
                }
                return true;
            });
        });
    }

    updateLonelyClouds(delta) {
        const { width, height } = this.scale;
        const camX = this.cameras.main.scrollX;

        this.lonelyCloudTimer += delta;
        if (this.lonelyCloudTimer > 5000 + Math.random() * 10000) {
            this.lonelyCloudTimer = 0;

            const cloud = this.add.image(camX + width + 200, 50 + Math.random() * (height * 0.3), 'cloud_lonely');
            const scale = (height / 1080) * (0.3 + Math.random() * 0.4);
            cloud.setScale(scale);
            cloud.setDepth(-55);
            cloud.setScrollFactor(0.35, 0);
            cloud.speed = 20 + Math.random() * 30;
            this.lonelyClouds.push(cloud);
        }

        this.lonelyClouds = this.lonelyClouds.filter(cloud => {
            cloud.x -= cloud.speed * (delta / 1000);
            if (cloud.x < camX - 500) {
                cloud.destroy();
                return false;
            }
            return true;
        });
    }

    spawnPlatformsAhead() {
        const { width, height } = this.scale;
        const camX = this.cameras.main.scrollX;
        const spawnAhead = camX + width + 400;

        while (this.lastPlatformX < spawnAhead) {
            this.lastPlatformX += 400 + Math.random() * 400;

            const platWidth = 100 + Math.random() * 150;

            const minY = this.groundY - (height * 0.6);
            const maxY = this.groundY - (height * 0.15);
            const platY = minY + Math.random() * (maxY - minY);

            const platform = this.add.rectangle(this.lastPlatformX, platY, platWidth, 20, 0x000000, 0);
            platform.setOrigin(0.5, 0);
            this.physics.add.existing(platform, true);
            this.platforms.add(platform);

            this.platformData.push({
                x: this.lastPlatformX - platWidth / 2,
                y: platY,
                width: platWidth,
                body: platform
            });
        }

        this.platformData = this.platformData.filter(plat => {
            if (plat.x + plat.width < camX - 300) {
                plat.body.destroy();
                return false;
            }
            return true;
        });

        this.drawPlatforms();
    }

    drawPlatforms() {
        this.platformGraphics.clear();
        this.platformGraphics.lineStyle(4, 0x000000, 1);

        this.platformData.forEach(plat => {
            this.platformGraphics.beginPath();

            let x = plat.x;
            this.platformGraphics.moveTo(x + this.getWobble(), plat.y + this.getWobble());
            while (x < plat.x + plat.width) {
                x += 5 + Math.random() * 8;
                this.platformGraphics.lineTo(x + this.getWobble(), plat.y + this.getWobble());
            }

            this.platformGraphics.lineTo(plat.x + plat.width + this.getWobble(), plat.y + 20 + this.getWobble());

            x = plat.x + plat.width;
            while (x > plat.x) {
                x -= 5 + Math.random() * 8;
                this.platformGraphics.lineTo(x + this.getWobble(), plat.y + 20 + this.getWobble());
            }

            this.platformGraphics.lineTo(plat.x + this.getWobble(), plat.y + this.getWobble());
            this.platformGraphics.strokePath();
        });
    }

    drawGroundLine() {
        if (this.groundGraphics) {
            this.groundGraphics.destroy();
        }

        this.groundGraphics = this.add.graphics();
        this.groundGraphics.lineStyle(4, 0x000000, 1);

        // ============================================
        // HEIGHTFIELD TERRAIN SYSTEM
        // Single source of truth for terrain height
        // Both visual and physics read from this
        // ============================================
        this.heightfield = new Map(); // x -> y mapping
        this.heightfieldResolution = 20; // pixels between samples
        this.heightfieldWobble = new Map(); // x -> wobble offset (stored separately for consistency)

        // Track terrain bounds
        this.terrainXMin = 0;
        this.terrainXMax = 0;

        // Track terrain segments for physics bodies
        this.terrainSegments = [];
        this.lastTerrainXRight = 0;
        this.lastTerrainXLeft = 0;

        // Track current terrain type to detect changes
        this.lastTerrainType = this.difficulty ? this.difficulty.getTerrainType() : 'flat';

        // Initialize heightfield around starting position
        this.initializeHeightfield();

        this.groundGraphics.beginPath();
        const startY = this.getHeightAtX(0);
        this.groundGraphics.moveTo(0, startY);
    }

    // Initialize heightfield around starting position
    initializeHeightfield() {
        const { width } = this.scale;
        const startX = -300;
        const endX = width + 300;

        for (let x = startX; x <= endX; x += this.heightfieldResolution) {
            this.computeAndStoreHeight(x);
        }

        this.terrainXMin = startX;
        this.terrainXMax = endX;
    }

    // Compute terrain height and store in heightfield (with wobble)
    computeAndStoreHeight(x) {
        // Snap to grid
        const gridX = Math.round(x / this.heightfieldResolution) * this.heightfieldResolution;

        // Don't recompute if already exists
        if (this.heightfield.has(gridX)) {
            return this.heightfield.get(gridX);
        }

        // Get base terrain height from formula
        const baseY = this.getTerrainYAtX(gridX);

        // Generate and store wobble for this X (so it's consistent)
        const terrainType = this.difficulty ? this.difficulty.getTerrainType() : 'flat';
        const wobbleAmount = terrainType === 'flat' ? 1.0 : 0.3;
        const wobble = (Math.random() - 0.5) * 3 * wobbleAmount;
        this.heightfieldWobble.set(gridX, wobble);

        // Store final height
        const finalY = baseY + wobble;
        this.heightfield.set(gridX, finalY);

        return finalY;
    }

    // Get height at any X position (interpolates between grid points)
    getHeightAtX(x) {
        const res = this.heightfieldResolution;
        const gridX1 = Math.floor(x / res) * res;
        const gridX2 = gridX1 + res;

        // Ensure both points exist in heightfield
        if (!this.heightfield.has(gridX1)) {
            this.computeAndStoreHeight(gridX1);
        }
        if (!this.heightfield.has(gridX2)) {
            this.computeAndStoreHeight(gridX2);
        }

        const y1 = this.heightfield.get(gridX1);
        const y2 = this.heightfield.get(gridX2);

        // Linear interpolation
        const t = (x - gridX1) / res;
        return y1 + t * (y2 - y1);
    }

    // Extend heightfield as camera moves
    extendHeightfield() {
        const { width } = this.scale;
        const camX = this.cameraX;
        const res = this.heightfieldResolution;

        // Extend to the right
        const targetRight = camX + width + 400;
        while (this.terrainXMax < targetRight) {
            this.terrainXMax += res;
            this.computeAndStoreHeight(this.terrainXMax);
        }

        // Extend to the left
        const targetLeft = camX - 400;
        while (this.terrainXMin > targetLeft) {
            this.terrainXMin -= res;
            this.computeAndStoreHeight(this.terrainXMin);
        }

        // Clean up heightfield entries that are too far away (memory management)
        const cleanupLeft = camX - 1000;
        const cleanupRight = camX + width + 1000;

        for (const [gridX] of this.heightfield) {
            if (gridX < cleanupLeft || gridX > cleanupRight) {
                this.heightfield.delete(gridX);
                this.heightfieldWobble.delete(gridX);
            }
        }
    }

    // Rebuild heightfield when terrain type changes
    rebuildHeightfield() {
        const { width } = this.scale;
        const camX = this.cameraX;

        // Clear existing heightfield
        this.heightfield.clear();
        this.heightfieldWobble.clear();

        // Clear existing terrain segments
        this.terrainSegments.forEach(seg => {
            if (seg.collider) seg.collider.destroy();
            seg.body.destroy();
        });
        this.terrainSegments = [];

        // Rebuild around current camera position
        const startX = camX - 400;
        const endX = camX + width + 400;

        for (let x = startX; x <= endX; x += this.heightfieldResolution) {
            this.computeAndStoreHeight(x);
        }

        this.terrainXMin = startX;
        this.terrainXMax = endX;

        // Reset physics tracking
        this.lastTerrainXRight = camX;
        this.lastTerrainXLeft = camX;
    }

    // Calculate ground Y at a given X position based on terrain type
    getTerrainYAtX(x) {
        const { height } = this.scale;
        const baseY = height - (height * 0.04);

        if (!this.difficulty) return baseY;

        const terrainType = this.difficulty.getTerrainType();
        const amplitude = this.difficulty.getTerrainAmplitude();

        if (terrainType === 'flat' || amplitude === 0) {
            return baseY;
        }

        let offset = 0;

        switch (terrainType) {
            case 'gentleHills':
                // Long rolling hills - very wide gentle waves
                const gentleWavelength = 4000; // Wide gentle waves
                offset = Math.sin(x * (Math.PI * 2 / gentleWavelength)) * amplitude;
                break;

            case 'steepHills':
                // Dramatic sweeping hills - wide waves for gradual climb
                const steepWavelength = 3500;
                offset = Math.sin(x * (Math.PI * 2 / steepWavelength)) * amplitude;
                // Add slower underlying wave for extra variation
                offset += Math.sin(x * (Math.PI * 2 / 8000)) * (amplitude * 0.4);
                break;

            case 'blocky':
                // Big rolling hills with occasional flat plateaus
                const blockyWave = 3000;
                offset = Math.sin(x * (Math.PI * 2 / blockyWave)) * amplitude;
                offset += Math.sin(x * (Math.PI * 2 / 6000)) * (amplitude * 0.4);

                // Add flat plateau sections
                const plateauBlock = Math.floor(x / 800);
                const plateauRandom = Math.sin(plateauBlock * 12.9898) * 43758.5453;
                const plateauVal = plateauRandom - Math.floor(plateauRandom);
                if (plateauVal > 0.75) {
                    // Create a flat plateau at current height
                    const plateauHeight = Math.sin(plateauBlock * 400 * (Math.PI * 2 / blockyWave)) * amplitude;
                    offset = plateauHeight;
                }
                break;

            case 'chaotic':
                // Maximum drama - huge sweeping hills, still walkable
                const chaoticWavelength = 2500;
                offset = Math.sin(x * (Math.PI * 2 / chaoticWavelength)) * amplitude;
                offset += Math.sin(x * (Math.PI * 2 / 5000)) * (amplitude * 0.4);
                offset += Math.sin(x * (Math.PI * 2 / 10000)) * (amplitude * 0.3);
                break;
        }

        // Clamp to reasonable bounds (don't go too high or below ground level)
        // Allow hills to go up to 70% of screen height for dramatic effect
        const maxOffset = height * 0.70;
        // Don't let terrain go below baseline (into the "ground") - allow slight dips
        const minOffset = -height * 0.15;
        offset = Math.max(minOffset, Math.min(maxOffset, offset));

        return baseY - offset; // Subtract because Y increases downward
    }

    extendGroundLine() {
        // Check if terrain type changed - if so, rebuild heightfield
        const terrainType = this.difficulty ? this.difficulty.getTerrainType() : 'flat';
        if (this.lastTerrainType !== terrainType) {
            this.lastTerrainType = terrainType;
            this.rebuildHeightfield();
        }

        // Extend heightfield as needed
        this.extendHeightfield();

        // Draw ground line from heightfield
        this.drawGroundFromHeightfield();

        // Update terrain physics from heightfield
        this.updateTerrainPhysics();
    }

    // Draw the ground line from heightfield data
    drawGroundFromHeightfield() {
        const { width } = this.scale;
        const camX = this.cameraX;
        const res = this.heightfieldResolution;

        this.groundGraphics.clear();
        this.groundGraphics.lineStyle(4, 0x000000, 1);
        this.groundGraphics.beginPath();

        // Draw from left of camera to right
        const startX = Math.floor((camX - 100) / res) * res;
        const endX = Math.ceil((camX + width + 100) / res) * res;

        let first = true;
        for (let x = startX; x <= endX; x += res) {
            const y = this.getHeightAtX(x);
            if (first) {
                this.groundGraphics.moveTo(x, y);
                first = false;
            } else {
                this.groundGraphics.lineTo(x, y);
            }
        }

        this.groundGraphics.strokePath();
    }

    updateTerrainPhysics() {
        const { width, height } = this.scale;
        const camX = this.cameraX;

        // For flat terrain, just use the main ground body
        if (!this.difficulty || this.difficulty.getTerrainType() === 'flat') {
            // Make sure ground is at correct Y
            this.ground.body.position.y = this.groundY;

            // Clean up any terrain segments from previous hilly section
            this.terrainSegments.forEach(seg => {
                if (seg.collider) seg.collider.destroy();
                seg.body.destroy();
            });
            this.terrainSegments = [];
            return;
        }

        // Move the flat ground down FIRST so it doesn't interfere
        this.ground.body.position.y = height + 1000;

        // For dynamic terrain, create segmented physics bodies
        const segmentWidth = 40; // Smaller segments = more accurate terrain following

        // If we just switched to hilly terrain, fill the ENTIRE visible area with segments
        if (this.terrainSegments.length === 0) {
            // Start from left of camera and fill to right
            for (let x = camX - 300; x < camX + width + 400; x += segmentWidth) {
                this.createTerrainSegment(x, segmentWidth, height);
            }
            this.lastTerrainXRight = camX + width + 400;
            this.lastTerrainXLeft = camX - 300;
        }

        // Spawn new segments ahead (to the right)
        while (this.lastTerrainXRight < camX + width + 400) {
            this.lastTerrainXRight += segmentWidth;
            this.createTerrainSegment(this.lastTerrainXRight, segmentWidth, height);
        }

        // Spawn new segments behind (to the left)
        while (this.lastTerrainXLeft > camX - 300) {
            this.lastTerrainXLeft -= segmentWidth;
            this.createTerrainSegment(this.lastTerrainXLeft, segmentWidth, height);
        }

        // Clean up segments that are too far off screen (either side)
        this.terrainSegments = this.terrainSegments.filter(seg => {
            if (seg.x < camX - 500 || seg.x > camX + width + 600) {
                if (seg.collider) {
                    seg.collider.destroy();
                }
                seg.body.destroy();
                return false;
            }
            return true;
        });
    }

    createTerrainSegment(x, segmentWidth, height) {
        // Use the heightfield for physics - same data source as visual
        // This ensures perfect sync between what player sees and physics
        const yLeft = this.getHeightAtX(x - segmentWidth / 2);
        const yCenter = this.getHeightAtX(x);
        const yRight = this.getHeightAtX(x + segmentWidth / 2);

        // Use the MINIMUM Y value (highest point on screen) so player can't fall through
        const terrainY = Math.min(yLeft, yCenter, yRight);

        // Create a physics body for this segment
        // Make it tall enough to catch the player from any height
        const segmentHeight = height - terrainY + 100;

        // Make segments wider than their spacing to ensure overlap
        const actualWidth = segmentWidth + 20; // 20px overlap on each side

        const segment = this.add.rectangle(
            x,
            terrainY,
            actualWidth,
            segmentHeight,
            0x000000, 0 // Invisible
        );
        segment.setOrigin(0.5, 0);
        this.physics.add.existing(segment, true);

        this.terrainSegments.push({
            x: x,
            body: segment,
            collider: this.physics.add.collider(this.player, segment)
        });

        // Add collision for remote player too
        if (this.remotePlayer) {
            this.physics.add.collider(this.remotePlayer, segment);
        }
    }

    resize(gameSize) {
        const { width, height } = gameSize;

        this.groundY = height - (height * 0.04);
        this.drawGroundLine();

        if (this.ground) {
            this.ground.setPosition(0, this.groundY);
            this.ground.setSize(10000000, 20);
            this.ground.body.updateFromGameObject();
        }

        this.updateCharacterScale();
        if (this.remotePlayer) this.updateRemoteCharacterScale();

        // Update camera follow offset so ground stays near screen bottom
        this.cameras.main.setFollowOffset(-width * 0.3, height * 0.15);
    }

    updateCharacterScale() {
        const { width, height } = this.scale;

        // Use same formula as hats for consistency: min(width, height) / 1080
        const screenScale = Math.min(width, height) / 1080;
        const baseScale = 0.35;
        const scale = screenScale * baseScale;

        // Lower minimum for mobile (was 0.15, now 0.08)
        const clampedScale = Math.max(0.08, Math.min(0.45, scale));
        this.player.setScale(clampedScale);
    }

    updateRemoteCharacterScale() {
        if (!this.remotePlayer) return;

        const { width, height } = this.scale;

        // Use same formula as hats for consistency
        const screenScale = Math.min(width, height) / 1080;
        const baseScale = 0.35;
        const scale = screenScale * baseScale;

        const clampedScale = Math.max(0.08, Math.min(0.45, scale));
        this.remotePlayer.setScale(clampedScale);
    }

    getWobble() {
        return (Math.random() - 0.5) * 3;
    }

    update(time, delta) {
        const speed = 750;
        const jumpSpeed = -750;

        // Update difficulty manager
        if (this.difficulty) {
            this.difficulty.update(delta);
        }

        // Update distance score (1 point per 100px of forward progress)
        if (this.player.x > this.lastDistanceX) {
            this.lastDistanceX = this.player.x;
            const newDistanceScore = Math.floor((this.player.x - this.startX) / 100);
            if (newDistanceScore !== this.distanceScore) {
                this.distanceScore = newDistanceScore;
                this.score = this.killScore + this.distanceScore;
                this.updateScoreDisplay();
            }
        }

        // Update bosses
        if (this.bosses) {
            this.updateBosses(time, delta);
        }

        // Regenerate ammo
        this.regenerateAmmo(delta);

        // Update body hitbox position to follow player
        // The body sensor is used for hat collision (separate from foot hitbox for terrain)
        if (this.playerBodySensor) {
            const charScale = this.player.scale;
            this.playerBodySensor.x = this.player.x + (this.bodyHitboxConfig.offsetX * charScale);
            this.playerBodySensor.y = this.player.y + (this.bodyHitboxConfig.offsetY * charScale);
        }

        // Dynamic hat spawning (single player only)
        if (!this.isMultiplayer && this.difficulty) {
            this.lastHatSpawnTime = (this.lastHatSpawnTime || 0) + delta;

            if (this.lastHatSpawnTime >= this.nextHatSpawnDelay) {
                this.spawnHat();
                this.lastHatSpawnTime = 0;
                // Get new spawn delay from difficulty (it gets shorter over time)
                this.nextHatSpawnDelay = this.difficulty.getHatSpawnInterval();
            }
        }

        // Pizza power-up spawning (single player only)
        if (!this.isMultiplayer) {
            this.lastPizzaSpawnTime = (this.lastPizzaSpawnTime || 0) + delta;

            if (this.lastPizzaSpawnTime >= this.pizzaSpawnInterval) {
                this.spawnPizza();
                this.lastPizzaSpawnTime = 0;
            }
        }

        // Track if we're walking for network sync
        let isWalking = false;
        // DUCKING DISABLED
        // let isDucking = false;

        // Get touch controls from mann.cool virtual controller
        const touch = window.touchControls ? window.touchControls.directions : {};

        // DUCKING DISABLED
        // const wantsToDuck = (this.cursors.down.isDown || touch.down) && this.player.body.touching.down;

        // Horizontal movement (keyboard OR virtual controller)
        if (this.cursors.left.isDown || touch.left) {
            this.player.setVelocityX(-speed);
            this.player.setFlipX(true);
            this.facingRight = false;
            if (this.player.body.touching.down) {
                this.player.play('walk_' + this.selectedCharacter, true);
                isWalking = true;
            }
        } else if (this.cursors.right.isDown || touch.right) {
            this.player.setVelocityX(speed);
            this.player.setFlipX(false);
            this.facingRight = true;
            if (this.player.body.touching.down) {
                this.player.play('walk_' + this.selectedCharacter, true);
                isWalking = true;
            }
        } else {
            this.player.setVelocityX(0);
            if (this.player.body.touching.down) {
                // DUCKING DISABLED
                // if (wantsToDuck) {
                //     this.player.play('duck_' + this.selectedCharacter, true);
                //     isDucking = true;
                // } else {
                    this.player.play('idle_' + this.selectedCharacter, true);
                // }
            }
        }

        // DUCKING HITBOX DISABLED FOR NOW - timing issues with sprite dimension updates
        /*
        // Switch hitboxes when duck state changes
        // DEBUG: Log every frame when duck-related state changes
        if (wantsToDuck) {
            console.log('DUCK STATE CHECK - wantsToDuck:', wantsToDuck,
                        'isDucking(local):', isDucking,
                        'this.isDucking:', this.isDucking,
                        'onGround:', this.player.body.touching.down);
        }

        if (isDucking && !this.isDucking) {
            // Just started ducking - switch to duck hitbox
            console.log('>>> DUCKING - switching to duck hitbox');
            console.log('duckHitbox.foot:', JSON.stringify(this.duckHitbox.foot));
            console.log('Current sprite texture:', this.player.texture.key, this.player.frame ? this.player.frame.name : 'no frame');
            this.applyHitbox(this.duckHitbox);
            this.isDucking = true;
        } else if (!isDucking && this.isDucking) {
            // Just stopped ducking - switch back to standing hitbox
            // BUT only if sprite has transitioned to standing dimensions
            // (Phaser doesn't update sprite.height immediately when animation changes)
            const isStandingSprite = this.player.height > 1500; // Standing sprites are ~1728 tall, duck is 1161
            if (isStandingSprite) {
                console.log('>>> STANDING - switching to standing hitbox');
                console.log('standingHitbox.foot:', JSON.stringify(this.standingHitbox.foot));
                this.applyHitbox(this.standingHitbox);
                this.isDucking = false;
            } else {
                console.log('Waiting for sprite transition... height:', this.player.height);
            }
        }
        */

        // Reset jump count when on ground
        if (this.player.body.touching.down) {
            this.jumpCount = 0;
        }

        // Jumping (with double jump) - keyboard OR virtual controller up
        const jumpPressed = Phaser.Input.Keyboard.JustDown(this.cursors.up) || (touch.up && !this.touchJumpPressed);
        if (jumpPressed && this.jumpCount < this.maxJumps) {
            this.player.setVelocityY(jumpSpeed);
            this.jumpCount++;
        }
        this.touchJumpPressed = touch.up; // Track touch state to detect "just pressed"

        // Charge-based shooting with spacebar OR virtual controller action button
        const shootKeyJustPressed = Phaser.Input.Keyboard.JustDown(this.spaceBar) || (touch.action && !this.touchActionPressed);
        const shootKeyJustReleased = Phaser.Input.Keyboard.JustUp(this.spaceBar) || (!touch.action && this.touchActionPressed);

        if (shootKeyJustPressed && !this.isCharging) {
            this.startCharging();
        }
        if (shootKeyJustReleased && this.isCharging) {
            this.releaseCharge();
        }

        // Update charge indicator while charging
        if (this.isCharging) {
            this.updateChargeIndicator(time);
        }

        this.touchActionPressed = touch.action; // Track touch state to detect "just pressed"

        // Send position update to server (rate limited)
        if (this.isMultiplayer && partySocket && time - this.lastNetworkUpdate > this.networkUpdateRate) {
            this.lastNetworkUpdate = time;
            // Send Y as offset from ground (negative = above ground) for cross-screen-size compatibility
            const yOffsetFromGround = this.player.y - this.groundY;
            partySocket.send(JSON.stringify({
                type: 'playerUpdate',
                x: this.player.x,
                yOffsetFromGround: yOffsetFromGround,
                velocityX: this.player.body.velocity.x,
                velocityY: this.player.body.velocity.y,
                facingRight: this.facingRight,
                isWalking: isWalking,
                isDucking: false // DUCKING DISABLED
            }));
        }

        // Update camera position tracking and extend ground line
        this.cameraX = this.cameras.main.scrollX;
        this.extendGroundLine();

        // Spawn new platforms
        this.spawnPlatformsAhead();

        // Update parallax backgrounds (extend as needed)
        this.updateParallaxBackgrounds();

        // Update lonely clouds
        this.updateLonelyClouds(delta);

        // Update flying hats with different flight patterns
        const camX = this.cameras.main.scrollX;
        const { width, height } = this.scale;

        this.hats.getChildren().forEach(hat => {
            const dt = delta / 1000;
            hat.elapsedTime = (hat.elapsedTime || 0) + dt;

            // Base horizontal movement (always moving left)
            hat.x -= hat.speed * dt;

            // Apply flight pattern
            switch (hat.flightPattern) {
                case 'straight':
                    // No vertical movement
                    break;

                case 'sineSmall':
                case 'sineLarge':
                    // Sine wave movement
                    hat.bobOffset += hat.bobSpeed * dt;
                    hat.y = hat.baseY + Math.sin(hat.bobOffset) * (hat.bobAmplitude || 20);
                    break;

                case 'diagonal':
                    // Move diagonally while also bobbing slightly
                    hat.baseY += hat.diagonalDirection * hat.diagonalSpeed * dt;
                    hat.bobOffset += hat.bobSpeed * dt;
                    hat.y = hat.baseY + Math.sin(hat.bobOffset) * (hat.bobAmplitude || 15);

                    // Bounce off top/bottom of screen
                    if (hat.baseY < 50 || hat.baseY > height * 0.7) {
                        hat.diagonalDirection *= -1;
                    }
                    break;

                case 'homing':
                    // Track toward player position
                    const targetY = this.player.y - 50; // Aim slightly above player
                    const targetX = this.player.x;

                    // Gradually adjust Y toward player
                    const yDiff = targetY - hat.y;
                    hat.y += yDiff * hat.homingStrength;

                    // Accelerate toward player horizontally (get faster as they approach)
                    const xDiff = targetX - hat.x;
                    if (xDiff < 400) {
                        // When close, speed up
                        hat.speed = Math.min(hat.speed * 1.002, 600);
                    }
                    break;

                default:
                    // Legacy bobbing (for multiplayer hats from server)
                    if (hat.bobSpeed) {
                        hat.bobOffset += hat.bobSpeed * dt;
                        hat.y = hat.baseY + Math.sin(hat.bobOffset) * 20;
                    }
            }

            // Destroy hats that are off screen left
            if (hat.x < camX - 150) {
                if (hat.hatId) delete this.hatMap[hat.hatId];
                hat.destroy();
            }
        });

        // Update projectiles
        this.projectiles.getChildren().forEach(proj => {
            if (proj.x < camX - 50 || proj.x > camX + width + 50 || proj.y > height + 50) {
                proj.destroy();
            }
        });

        // Update pizzas - float across screen with gentle bobbing
        this.pizzas.getChildren().forEach(pizza => {
            const dt = delta / 1000;

            // Move left across screen
            pizza.x -= pizza.speed * dt;

            // Gentle bobbing motion
            pizza.bobOffset = (pizza.bobOffset || 0) + 2 * dt;
            pizza.y = pizza.baseY + Math.sin(pizza.bobOffset) * 15;

            // Destroy pizzas that are off screen left
            if (pizza.x < camX - 150) {
                pizza.destroy();
            }
        });
    }
}

// ============================================
// GAME OVER SCENE WITH LEADERBOARD
// ============================================
class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    init(data) {
        this.finalScore = data.score || 0;
        this.killScore = data.killScore || 0;
        this.distanceScore = data.distanceScore || 0;
        this.gameTime = data.time || '0:00';
        this.character = data.character || 'penis';
    }

    create() {
        const { width, height } = this.scale;

        // Semi-transparent background
        const bg = this.add.rectangle(0, 0, width, height, 0xffffff, 0.95);
        bg.setOrigin(0, 0);

        // Hand-drawn border
        this.drawWobblyBorder(width, height);

        // GAME OVER title
        const titleText = this.add.text(width / 2, height * 0.1, 'GAME OVER', {
            fontSize: '48px',
            fontFamily: 'monospace',
            color: '#000000',
            fontStyle: 'bold'
        });
        titleText.setOrigin(0.5);

        // Your score
        const scoreText = this.add.text(width / 2, height * 0.18, `YOUR SCORE: ${this.finalScore}`, {
            fontSize: '28px',
            fontFamily: 'monospace',
            color: '#000000'
        });
        scoreText.setOrigin(0.5);

        // Score breakdown
        const breakdownText = this.add.text(width / 2, height * 0.24, `KILLS: ${this.killScore}  DISTANCE: ${this.distanceScore}`, {
            fontSize: '16px',
            fontFamily: 'monospace',
            color: '#666666'
        });
        breakdownText.setOrigin(0.5);

        // Time survived
        const timeText = this.add.text(width / 2, height * 0.29, `TIME: ${this.gameTime}`, {
            fontSize: '20px',
            fontFamily: 'monospace',
            color: '#666666'
        });
        timeText.setOrigin(0.5);

        // Send final score to Play.fun
        if (window.playfunSDK) {
            window.playfunSDK.addPoints(this.finalScore);
            window.playfunSDK.savePoints();
        }

        // Restart button
        this.createRestartButton(width, height);

        // Keyboard/touch to restart
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
        this.spaceBar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }

    drawWobblyBorder(width, height) {
        const graphics = this.add.graphics();
        graphics.lineStyle(4, 0x000000);

        const margin = 20;
        const wobbleAmount = 3;
        const segments = 30;

        // Draw wobbly rectangle
        graphics.beginPath();

        // Top edge
        for (let i = 0; i <= segments; i++) {
            const x = margin + (width - 2 * margin) * (i / segments);
            const y = margin + Math.sin(i * 0.5) * wobbleAmount;
            if (i === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
        }

        // Right edge
        for (let i = 0; i <= segments; i++) {
            const x = width - margin + Math.sin(i * 0.5) * wobbleAmount;
            const y = margin + (height - 2 * margin) * (i / segments);
            graphics.lineTo(x, y);
        }

        // Bottom edge
        for (let i = segments; i >= 0; i--) {
            const x = margin + (width - 2 * margin) * (i / segments);
            const y = height - margin + Math.sin(i * 0.5) * wobbleAmount;
            graphics.lineTo(x, y);
        }

        // Left edge
        for (let i = segments; i >= 0; i--) {
            const x = margin + Math.sin(i * 0.5) * wobbleAmount;
            const y = margin + (height - 2 * margin) * (i / segments);
            graphics.lineTo(x, y);
        }

        graphics.closePath();
        graphics.strokePath();
    }

    createRestartButton(width, height) {
        const restartBtn = this.add.text(width / 2, height * 0.5, '[ PLAY AGAIN ]', {
            fontSize: '24px',
            fontFamily: 'monospace',
            color: '#000000',
            backgroundColor: '#ffffff',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        // Hand-drawn border
        const btnBorder = this.add.graphics();
        btnBorder.lineStyle(3, 0x000000);
        const btnWidth = restartBtn.width + 44;
        const btnHeight = restartBtn.height + 24;
        btnBorder.strokeRect(width / 2 - btnWidth / 2, height * 0.5 - btnHeight / 2, btnWidth, btnHeight);

        restartBtn.on('pointerover', () => restartBtn.setStyle({ backgroundColor: '#dddddd' }));
        restartBtn.on('pointerout', () => restartBtn.setStyle({ backgroundColor: '#ffffff' }));
        restartBtn.on('pointerdown', () => this.scene.start('ModeSelectScene'));
    }

    update() {
        const touch = window.touchControls ? window.touchControls.directions : {};
        const actionPressed = Phaser.Input.Keyboard.JustDown(this.enterKey) ||
                              Phaser.Input.Keyboard.JustDown(this.spaceBar) ||
                              (touch.action && !this.touchActionPressed);
        if (actionPressed) {
            this.scene.start('ModeSelectScene');
        }
        this.touchActionPressed = touch.action;
    }
}

// Phaser game configuration
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.RESIZE,
        parent: 'game-container',
        width: '100%',
        height: '100%'
    },
    backgroundColor: '#ffffff',
    pixelArt: true,
    pauseOnBlur: false, // Critical: prevents game from pausing when clicking mann.cool virtual controls
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 800 },
            debug: false
        }
    },
    scene: [ModeSelectScene, LobbyChoiceScene, CreateRoomScene, JoinRoomScene, WaitingScene, SelectScene, MainScene, GameOverScene]
};

// Create the game
window.game = new Phaser.Game(config);
