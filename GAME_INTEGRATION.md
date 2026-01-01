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

## 3D Games: Virtual Joystick Camera Control

For 3D games that need mouse-look controls, mann.cool provides a virtual joystick that sends continuous `mouseMoveEvent` messages. Your game must handle these to rotate the camera.

### Enabling the Look Stick in mann.cool

Add `hasLookStick: true` to your game's controls config:

```javascript
{
  slug: "your-3d-game",
  controls: {
    dpad: { up: "w", down: "s", left: "a", right: "d" },
    hasLookStick: true,  // Enables virtual joystick for camera
    actions: [
      { key: " ", label: "JUMP" },
      // ... other actions
    ],
  },
}
```

### Message Format

When the player uses the look stick, your game receives continuous messages:

```javascript
{ type: 'mouseMoveEvent', deltaX: 5.2, deltaY: -3.1 }
```

- `deltaX`: Horizontal movement (positive = look right, negative = look left)
- `deltaY`: Vertical movement (positive = look down, negative = look up)
- Values typically range from -10 to 10 based on joystick position

### Testing Mouse Movement

```javascript
// Simulate looking right and down
window.postMessage({ type: 'mouseMoveEvent', deltaX: 5, deltaY: 3 }, '*');

// Simulate looking left and up
window.postMessage({ type: 'mouseMoveEvent', deltaX: -5, deltaY: -3 }, '*');
```

---

## Other Game Engines

### Unity WebGL

Unity WebGL has similar challenges with audio context and focus:

```javascript
// Add to your index.html template
window.addEventListener('message', (event) => {
  const { type, key, eventType, deltaX, deltaY } = event.data || {};
  
  // Resume audio context
  if (window.unityInstance) {
    const audioContext = window.AudioContext && new AudioContext();
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }
  
  // Handle keyboard events
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
  
  // Handle mouse/camera movement from virtual joystick
  if (type === 'mouseMoveEvent' && window.unityInstance) {
    // Call a C# method to handle camera rotation
    window.unityInstance.SendMessage('GameManager', 'OnVirtualMouseMove', JSON.stringify({ deltaX, deltaY }));
  }
});
```

**Unity C# Script for Camera Control:**

```csharp
using UnityEngine;

public class GameManager : MonoBehaviour
{
    public Transform cameraTransform;
    public float sensitivity = 0.5f;
    
    private float rotationX = 0f;
    private float rotationY = 0f;

    // Called from JavaScript
    public void OnVirtualMouseMove(string jsonData)
    {
        var data = JsonUtility.FromJson<MouseMoveData>(jsonData);
        
        rotationY += data.deltaX * sensitivity;
        rotationX -= data.deltaY * sensitivity;
        rotationX = Mathf.Clamp(rotationX, -90f, 90f);
        
        cameraTransform.localRotation = Quaternion.Euler(rotationX, rotationY, 0f);
    }
}

[System.Serializable]
public class MouseMoveData
{
    public float deltaX;
    public float deltaY;
}
```

You may also need to:
- Set `WebGLInput.captureAllKeyboardInput = false;` in Unity
- Handle focus management in your Unity C# scripts
- Disable Unity's default mouse look when running in iframe

### Babylon.js

```javascript
// Store camera reference globally for virtual joystick access
window.gameCamera = null;

window.addEventListener('message', (event) => {
  const { type, key, eventType, deltaX, deltaY } = event.data || {};
  
  // Resume audio
  if (BABYLON.Engine.audioEngine) {
    BABYLON.Engine.audioEngine.unlock();
  }
  
  // Handle keyboard events
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
  
  // Handle mouse/camera movement from virtual joystick
  if (type === 'mouseMoveEvent' && window.gameCamera) {
    const sensitivity = 0.005;
    
    // For FreeCamera or UniversalCamera
    if (window.gameCamera.rotation) {
      window.gameCamera.rotation.y += deltaX * sensitivity;
      window.gameCamera.rotation.x += deltaY * sensitivity;
      
      // Clamp vertical rotation
      window.gameCamera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, window.gameCamera.rotation.x));
    }
    
    // For ArcRotateCamera
    if (window.gameCamera.alpha !== undefined) {
      window.gameCamera.alpha -= deltaX * sensitivity;
      window.gameCamera.beta += deltaY * sensitivity;
      
      // Clamp beta to prevent flipping
      window.gameCamera.beta = Math.max(0.1, Math.min(Math.PI - 0.1, window.gameCamera.beta));
    }
  }
});

// In your scene setup, expose the camera:
// window.gameCamera = camera;
```

**Example Scene Setup:**

```javascript
const createScene = function() {
  const scene = new BABYLON.Scene(engine);
  
  // Create camera
  const camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 2, -5), scene);
  camera.attachControl(canvas, true);
  
  // Expose camera for virtual joystick
  window.gameCamera = camera;
  
  // Detect iframe and disable default mouse controls if needed
  if (window.parent !== window) {
    camera.inputs.removeByType("FreeCameraMouseInput");
  }
  
  return scene;
};
```

### Godot WebGL

```javascript
// Add to your HTML shell (web_shell.html)

// Store virtual joystick state for Godot to read
window.virtualMouseDelta = { x: 0, y: 0 };

window.addEventListener('message', (event) => {
  const { type, key, eventType, deltaX, deltaY } = event.data || {};
  
  // Godot's audio context
  if (window.Godot && window.Godot.audio && window.Godot.audio.ctx) {
    if (window.Godot.audio.ctx.state === 'suspended') {
      window.Godot.audio.ctx.resume();
    }
  }
  
  // Handle keyboard events
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
  
  // Handle click events
  if (type === 'clickEvent' && eventType) {
    const canvas = document.querySelector('#canvas');
    if (canvas) {
      canvas.dispatchEvent(new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
      }));
    }
  }
  
  // Handle mouse/camera movement from virtual joystick
  if (type === 'mouseMoveEvent') {
    window.virtualMouseDelta.x = deltaX || 0;
    window.virtualMouseDelta.y = deltaY || 0;
  }
});

// Reset delta each frame (call this from Godot after reading)
window.getAndResetMouseDelta = function() {
  const delta = { x: window.virtualMouseDelta.x, y: window.virtualMouseDelta.y };
  // Don't reset - let Godot read continuously while stick is held
  return delta;
};
```

**Godot GDScript for Camera Control:**

```gdscript
# camera_controller.gd
extends Node3D

@export var camera: Camera3D
@export var sensitivity: float = 0.1
@export var max_pitch: float = 89.0

var rotation_x: float = 0.0
var rotation_y: float = 0.0

func _ready():
    # Check if running in browser
    if OS.has_feature("web"):
        print("Running in web - virtual joystick enabled")

func _process(delta):
    if OS.has_feature("web"):
        _handle_virtual_joystick()

func _handle_virtual_joystick():
    # Read from JavaScript
    var js_code = "window.virtualMouseDelta ? window.virtualMouseDelta : {x: 0, y: 0}"
    var result = JavaScriptBridge.eval(js_code)
    
    if result:
        var delta_x = result.x if result.has("x") else 0.0
        var delta_y = result.y if result.has("y") else 0.0
        
        if abs(delta_x) > 0.1 or abs(delta_y) > 0.1:
            rotation_y -= delta_x * sensitivity
            rotation_x -= delta_y * sensitivity
            rotation_x = clamp(rotation_x, -max_pitch, max_pitch)
            
            camera.rotation_degrees = Vector3(rotation_x, rotation_y, 0)

# Also handle regular mouse input for desktop
func _input(event):
    if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        rotation_y -= event.relative.x * sensitivity
        rotation_x -= event.relative.y * sensitivity
        rotation_x = clamp(rotation_x, -max_pitch, max_pitch)
        
        camera.rotation_degrees = Vector3(rotation_x, rotation_y, 0)
```

**Alternative: Using Godot's JavaScriptBridge with Callbacks:**

```gdscript
# For Godot 4.x with JavaScriptBridge
extends Node

var js_callback: JavaScriptObject

func _ready():
    if OS.has_feature("web"):
        # Create a callback that JavaScript can call
        js_callback = JavaScriptBridge.create_callback(_on_mouse_move)
        var window = JavaScriptBridge.get_interface("window")
        window.onVirtualMouseMove = js_callback

func _on_mouse_move(args):
    var delta_x = args[0]
    var delta_y = args[1]
    # Apply to camera rotation
    # ...
```

Then in your HTML shell, call the Godot callback:

```javascript
if (type === 'mouseMoveEvent' && window.onVirtualMouseMove) {
    window.onVirtualMouseMove(deltaX, deltaY);
}
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

---

## Tallgrass Godot Integration

### Custom HTML Shell

A custom HTML shell has been created at `godot/export/web_shell.html` that includes:

1. **mann.cool message listener** - Receives virtual controller input
2. **Audio context resume** - Prevents audio from stopping when using virtual controls
3. **Keyboard event dispatching** - Sends key events to both canvas and document
4. **Click event handling** - Supports attack button (left click)

### How to Export with Custom Shell

1. In Godot, go to **Project → Export**
2. Select or create a **Web** export preset
3. Under **HTML**, find **Custom HTML Shell**
4. Browse to `export/web_shell.html`
5. Export the project

### Tallgrass Control Configuration for mann.cool

Add this to the mann.cool `games` array:

```javascript
{
  id: X,  // next available ID
  slug: "tallgrass",
  title: "Tallgrass",
  image: "/nes-game-images/tallgrass.png",
  gameUrl: "https://tallgrass.vercel.app",  // Update with actual URL
  platform: "desktop",
  aspectRatio: "16 / 9",
  controls: {
    dpad: { 
      up: "ArrowUp",      // Move forward (W)
      down: "ArrowDown",  // Move backward (S)
      left: "ArrowLeft",  // Move left (A)
      right: "ArrowRight" // Move right (D)
    },
    actions: [
      { key: "f", label: "COLLECT" },           // Pick up items
      { key: "click", label: "SWORD", isClick: true },  // Swing sword
      { key: "i", label: "INV" },               // Open inventory
      { key: "m", label: "MAP" },               // Open map
      { key: "Shift", label: "RUN" },           // Sprint
    ],
  },
}
```

### Tallgrass Controls Reference

| Action | Keyboard | Virtual Button |
|--------|----------|----------------|
| Move | WASD / Arrows | D-pad |
| Run | Shift | RUN button |
| Collect item | F | COLLECT button |
| Swing sword | Left Click / X | SWORD button |
| Open inventory | I | INV button |
| Open map | M | MAP button |
| Accept trade | Y | (not mapped) |
| Release mouse | ESC | (not needed on mobile) |

### Virtual Analog Stick for Camera Control

For games that use mouse movement for camera control (like Tallgrass), mann.cool can send `mouseMoveEvent` messages from a virtual analog stick:

```javascript
// Message format from mann.cool
{
  type: 'mouseMoveEvent',
  deltaX: number,  // Horizontal movement (-100 to 100)
  deltaY: number   // Vertical movement (-100 to 100)
}
```

**Handling in your game's HTML shell:**

```javascript
window.addEventListener('message', (event) => {
  const { type, deltaX, deltaY } = event.data || {};
  
  // Handle mouse/camera movement from virtual analog stick
  if (type === 'mouseMoveEvent' && (deltaX !== undefined || deltaY !== undefined)) {
    const canvas = document.querySelector('#canvas');
    if (canvas) {
      // Dispatch a mousemove event with movement deltas
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        view: window,
        movementX: deltaX || 0,
        movementY: deltaY || 0,
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2
      }));
    }
  }
});
```

**mann.cool config with camera stick:**

```javascript
{
  slug: "tallgrass",
  controls: {
    dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
    actions: [
      { key: "f", label: "COLLECT" },
      { key: "click", label: "SWORD", isClick: true },
    ],
    cameraStick: true,  // Enables the right analog stick for camera
    cameraSensitivity: 2.0,  // Multiplier for deltaX/deltaY values
  },
}
```

The Tallgrass web shell (`godot/export/web_shell.html`) already includes this handler
