# Game Integration Guide for mann.cool

This document explains how to make your browser game work with the mann.cool virtual controller system.

## Context

When desktop games are played on mobile devices via mann.cool, they're displayed inside a virtual PICO-8-style console with on-screen D-pad and A/B buttons. These buttons send control messages to your game via `postMessage`.

## Required: Add the Control Listener

Add this script to your game's HTML (or in your game's JavaScript initialization):

```javascript
// Listen for control inputs from mann.cool virtual controller
window.addEventListener('message', (event) => {
  // Optional: Verify origin for security
  // if (event.origin !== 'https://mann.cool') return;
  
  const { type, key, eventType } = event.data || {};
  
  if (type === 'keyEvent' && key && eventType) {
    // Create and dispatch a keyboard event
    const keyboardEvent = new KeyboardEvent(eventType, {
      key: key,
      code: key,
      bubbles: true,
      cancelable: true,
    });
    
    // Dispatch to the document (or your game's canvas element)
    document.dispatchEvent(keyboardEvent);
  }
});
```

## How It Works

1. User taps a button on the mann.cool virtual controller
2. mann.cool sends a `postMessage` to your game's iframe:
   ```javascript
   { type: 'keyEvent', key: 'ArrowUp', eventType: 'keydown' }
   ```
3. Your listener receives it and dispatches a native KeyboardEvent
4. Your game's existing keyboard handlers respond normally

## Message Format

```typescript
interface ControlMessage {
  type: 'keyEvent';
  key: string;      // The key identifier (e.g., 'ArrowUp', 'z', 'x')
  eventType: string; // 'keydown' or 'keyup'
}
```

## Default Key Mappings

The mann.cool game config specifies which keys each button sends:

| Button | Default Key | Description |
|--------|-------------|-------------|
| D-pad Up | `ArrowUp` | Move up |
| D-pad Down | `ArrowDown` | Move down |
| D-pad Left | `ArrowLeft` | Move left |
| D-pad Right | `ArrowRight` | Move right |
| A Button | `z` | Primary action |
| B Button | `x` | Secondary action |

These can be customized per-game in the mann.cool config. If your game uses different keys (e.g., WASD), update the `controls` object in `App.jsx`:

```javascript
{
  slug: "your-game",
  controls: {
    up: "w",      // or "ArrowUp"
    down: "s",    // or "ArrowDown"
    left: "a",    // or "ArrowLeft"
    right: "d",   // or "ArrowRight"
    a: "Space",   // primary action
    b: "Shift",   // secondary action
  },
}
```

## Framework-Specific Examples

### Vanilla JavaScript / Canvas Games

```javascript
// Add to your game's init or at the top of your main JS file
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  if (type === 'keyEvent' && key && eventType) {
    document.dispatchEvent(new KeyboardEvent(eventType, {
      key: key,
      code: key,
      bubbles: true,
      cancelable: true,
    }));
  }
});
```

### Phaser 3

```javascript
// In your game's create() or as a scene plugin
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  if (type === 'keyEvent' && key && eventType) {
    // Phaser listens to window events, so dispatch there
    window.dispatchEvent(new KeyboardEvent(eventType, {
      key: key,
      code: key,
      bubbles: true,
      cancelable: true,
    }));
  }
});
```

### React Games (with custom key handling)

```javascript
// In your App.jsx or game component
useEffect(() => {
  const handleMessage = (event) => {
    const { type, key, eventType } = event.data || {};
    if (type === 'keyEvent' && key && eventType) {
      document.dispatchEvent(new KeyboardEvent(eventType, {
        key: key,
        code: key,
        bubbles: true,
        cancelable: true,
      }));
    }
  };
  
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

### Unity WebGL

For Unity WebGL builds, add this to your HTML template or index.html:

```javascript
window.addEventListener('message', (event) => {
  const { type, key, eventType } = event.data || {};
  if (type === 'keyEvent' && key && eventType) {
    // Unity WebGL captures events from the canvas
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

## Testing Locally

1. Open your game in a browser
2. Open the browser console
3. Simulate a control message:

```javascript
// Simulate pressing the up arrow
window.postMessage({ type: 'keyEvent', key: 'ArrowUp', eventType: 'keydown' }, '*');

// Simulate releasing it
window.postMessage({ type: 'keyEvent', key: 'ArrowUp', eventType: 'keyup' }, '*');
```

## Adding Your Game to mann.cool

In the mann.cool repo (`src/App.jsx`), add your game to the `games` array:

```javascript
{
  id: 5,  // next available ID
  slug: "your-game-slug",           // URL path: mann.cool/your-game-slug
  title: "Your Game Title",          // Display name
  image: "/nes-game-images/your-game.png",  // Cover art (add to public/)
  gameUrl: "https://your-game.vercel.app",  // Your game's URL
  platform: "desktop",               // "desktop" or "mobile"
  aspectRatio: "16 / 9",            // Game's aspect ratio
  controls: {                        // Key mappings for virtual controller
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    a: "z",
    b: "x",
  },
}
```

## Troubleshooting

**Controls not working?**
- Check browser console for errors
- Verify the postMessage listener is running (add a `console.log` inside it)
- Make sure your game is listening for keyboard events on `document` or `window`
- Some game frameworks need events on specific elements (like a canvas)

**Game works locally but not in iframe?**
- Check for X-Frame-Options or Content-Security-Policy headers blocking iframe embedding
- Your Vercel/hosting config may need to allow framing

**Keys are wrong?**
- Update the `controls` object in mann.cool's `App.jsx` to match your game's expected keys

