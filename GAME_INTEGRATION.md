# Game Integration Guide for mann.cool

This document explains how to make your browser game work with the mann.cool virtual controller system.

## Context

When desktop games are played on mobile devices via mann.cool, they're displayed inside a virtual PICO-8-style console with on-screen D-pad and action buttons. These buttons send control messages to your game via `postMessage`.

## Quick Start (Basic Integration)

Add this listener to your game's JavaScript:

```javascript
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  
  // Handle keyboard events
  if (type === 'keyEvent' && key && eventType) {
    document.dispatchEvent(new KeyboardEvent(eventType, {
      key: key,
      code: key,
      bubbles: true,
      cancelable: true,
    }));
  }
  
  // Handle click events (for attack buttons)
  if (type === 'clickEvent' && eventType) {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
  }
});
```

---

## Complete Phaser 3 Integration (Recommended)

Based on real-world integration with CTN, here's the complete solution for Phaser games:

### 1. Add the Control Listener (game.js or main entry point)

```javascript
// --- mann.cool Virtual Controller Support ---
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
    if (type === 'keyEvent' && key && eventType && window.game && window.game.touchControls) {
        const isDown = eventType === 'keydown';
        const dirs = window.game.touchControls.directions;
        
        // Map keys to your game's control directions
        if (key === 'ArrowUp' || key === 'w' || key === 'W') {
            dirs.up = isDown;
        } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
            dirs.down = isDown;
        } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
            dirs.left = isDown;
        } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
            dirs.right = isDown;
        } else if (key === ' ' || key === 'Space') {
            dirs.up = isDown; // or dirs.jump if you have a separate jump flag
        }
    }
    
    // Handle click events (for attack/action buttons)
    if (type === 'clickEvent' && eventType && window.game && window.game.touchControls) {
        const isDown = eventType === 'mousedown';
        window.game.touchControls.directions.action = isDown;
    }
});
```

### 2. Configure Phaser to Not Pause on Blur

```javascript
const config = {
    type: Phaser.AUTO,
    pauseOnBlur: false,  // Critical: prevents game from pausing when clicking virtual controls
    // ... rest of your config
};
```

### 3. Detect Iframe and Disable Native Touch Controls

```javascript
// In your game initialization (e.g., window.onload or after game creation)
if (window.parent !== window) {
    // Running inside mann.cool iframe - disable native touch controls
    const touchControlsContainer = document.querySelector('.touch-controls');
    if (touchControlsContainer) {
        touchControlsContainer.style.display = 'none';
    }
    
    // Hide any "rotate phone" warnings
    const rotateWarning = document.getElementById('rotate-warning');
    if (rotateWarning) {
        rotateWarning.style.display = 'none';
    }
    
    // Ensure touchControls object exists for mann.cool to update
    if (!window.game.touchControls) {
        window.game.touchControls = {
            directions: { left: false, right: false, up: false, down: false, action: false },
            getDirections: function() { return this.directions; }
        };
    }
}
```

### 4. Use touchControls in Your Player Update

```javascript
// In your Player.js update() method
update(time, delta) {
    const touch = this.scene.game.touchControls ? this.scene.game.touchControls.directions : {};
    
    // Movement
    if (this.cursors.left.isDown || touch.left) {
        // move left
    } else if (this.cursors.right.isDown || touch.right) {
        // move right
    }
    
    // Jump
    const jumpPressed = this.cursors.up.isDown || this.keySpace.isDown || touch.up;
    if (onGround && jumpPressed) {
        // jump
    }
    
    // Action (attack, etc.)
    if (touch.action && !this.isAttacking) {
        this.attack();
    }
}
```

---

## Key Lessons Learned

### Why Dispatching KeyboardEvents Isn't Always Enough

Many games (especially those with mobile support) use their own touch control systems that maintain internal state. Simply dispatching `KeyboardEvent`s won't update this internal state.

**Solution**: Directly update the game's internal touch/input state object.

### Audio Context Suspension

When users click on the virtual controller (which is outside the game's iframe), browsers suspend the Web Audio context.

**Solution**: Resume the audio context on every message received:

```javascript
if (window.game.sound.context.state === 'suspended') {
    window.game.sound.context.resume();
}
```

### Game Pausing on Blur

Phaser (and other engines) pause by default when the window loses focus.

**Solution**: Set `pauseOnBlur: false` in your game config.

### Native Touch Controls Conflicting

If your game has its own mobile touch controls, they'll conflict with mann.cool's virtual controller.

**Solution**: Detect iframe embedding and hide your native controls:

```javascript
if (window.parent !== window) {
    // Hide your game's touch controls
}
```

---

## Message Format Reference

```typescript
// Keyboard control message
interface KeyMessage {
  type: 'keyEvent';
  key: string;        // 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'x', ' ', etc.
  eventType: string;  // 'keydown' or 'keyup'
}

// Click/tap control message  
interface ClickMessage {
  type: 'clickEvent';
  eventType: string;  // 'mousedown' or 'mouseup'
}
```

---

## Control Configuration in mann.cool

### Simple 2-Button Game

```javascript
{
  slug: "your-game",
  controls: {
    dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
    actions: [
      { key: "z", label: "A" },
      { key: "x", label: "B" },
    ],
  },
}
```

### Game with Click-Based Attack

```javascript
{
  slug: "your-platformer",
  controls: {
    dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
    actions: [
      { key: "ArrowUp", label: "JUMP" },
      { key: "click", label: "ATTACK", isClick: true },  // Sends clickEvent instead of keyEvent
    ],
  },
}
```

### Complex Game with Many Controls

```javascript
{
  slug: "your-action-game",
  controls: {
    dpad: { up: "w", down: "s", left: "a", right: "d" },
    actions: [
      { key: " ", label: "JUMP" },
      { key: "click", label: "ATTACK", isClick: true },
      { key: "f", label: "DASH" },
      { key: "e", label: "POUND" },
      { key: "q", label: "CROUCH" },
    ],
  },
}
```

---

## Other Game Engines

### Unity WebGL

Unity WebGL has similar challenges with audio context and focus:

```javascript
// Add to your index.html template
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  
  // Resume audio context
  if (window.unityInstance) {
    const audioContext = window.AudioContext && new AudioContext();
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }
  
  if (type === 'keyEvent' && key && eventType) {
    const canvas = document.querySelector('#unity-canvas');
    if (canvas) {
      canvas.dispatchEvent(new KeyboardEvent(eventType, {
        key: key,
        code: key,
        bubbles: true,
        cancelable: true,
      }));
    }
  }
});
```

You may also need to:
- Set `WebGLInput.captureAllKeyboardInput = false;` in Unity
- Handle focus management in your Unity C# scripts

### Babylon.js

```javascript
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  
  // Resume audio
  if (BABYLON.Engine.audioEngine) {
    BABYLON.Engine.audioEngine.unlock();
  }
  
  if (type === 'keyEvent' && key && eventType) {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(new KeyboardEvent(eventType, {
        key: key,
        code: key,
        bubbles: true,
        cancelable: true,
      }));
    }
  }
});
```

### Godot WebGL

```javascript
// Add to your HTML shell
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  
  // Godot's audio context
  if (window.Godot && window.Godot.audio && window.Godot.audio.ctx) {
    if (window.Godot.audio.ctx.state === 'suspended') {
      window.Godot.audio.ctx.resume();
    }
  }
  
  if (type === 'keyEvent' && key && eventType) {
    const canvas = document.querySelector('#canvas');
    if (canvas) {
      canvas.dispatchEvent(new KeyboardEvent(eventType, {
        key: key,
        code: key,
        bubbles: true,
        cancelable: true,
      }));
    }
  }
});
```

---

## Testing Locally

1. Open your game in a browser
2. Open the browser console
3. Simulate control messages:

```javascript
// Simulate pressing the up arrow
window.postMessage({ type: 'keyEvent', key: 'ArrowUp', eventType: 'keydown' }, '*');

// Simulate releasing it
window.postMessage({ type: 'keyEvent', key: 'ArrowUp', eventType: 'keyup' }, '*');

// Simulate attack button
window.postMessage({ type: 'clickEvent', eventType: 'mousedown' }, '*');
window.postMessage({ type: 'clickEvent', eventType: 'mouseup' }, '*');
```

---

## Troubleshooting

### Controls not working?
1. Add `console.log` in your message listener to verify messages are received
2. Check if your game uses internal touch/input state that needs direct updates
3. Make sure keyboard events are dispatched to the right element (document, window, or canvas)

### Music/audio stops when using virtual controls?
- Add audio context resume logic in your message handler
- Set `pauseOnBlur: false` in your game engine config

### Game pauses when clicking virtual controls?
- Set `pauseOnBlur: false` in Phaser config
- In Unity: handle `OnApplicationFocus` appropriately
- In other engines: find the equivalent "pause on blur" setting

### Your native touch controls appear alongside mann.cool's?
- Detect iframe embedding: `if (window.parent !== window)`
- Hide your native touch UI when embedded

### Game works locally but not in iframe?
- Check for `X-Frame-Options` or `Content-Security-Policy` headers blocking iframe embedding
- Your Vercel/hosting config may need to allow framing

---

## Adding Your Game to mann.cool

In the mann.cool repo (`src/App.jsx`), add your game to the `games` array:

```javascript
{
  id: 5,  // next available ID
  slug: "your-game-slug",
  title: "Your Game Title",
  image: "/nes-game-images/your-game.png",
  gameUrl: "https://your-game.vercel.app",
  platform: "desktop",  // "desktop" or "mobile"
  aspectRatio: "16 / 9",
  controls: {
    dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
    actions: [
      { key: "ArrowUp", label: "JUMP" },
      { key: "click", label: "ATTACK", isClick: true },
    ],
  },
}
```
