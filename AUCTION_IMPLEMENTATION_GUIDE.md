# Game A Day Auction Implementation Guide

> **Purpose:** Port the GBM auction infrastructure from songaday.world to mann.cool for auctioning daily game NFTs.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | **Keep Vite** | Simpler, faster builds, SSR not needed for game arcade |
| Auction Chain | **Ethereum Mainnet** | Simpler than L2, no cross-chain bridging needed |
| UI Framework | TBD | Can keep retro CSS or add Chakra for auction components |

---

## Overview: What We're Porting

From `songaday.world-main`, we need:

### 1. Wallet Infrastructure
- **RainbowKit** for wallet connection UI
- **wagmi v2** for React hooks to interact with contracts
- **viem** for low-level Ethereum utilities
- **@tanstack/react-query** for data caching (required by wagmi)

### 2. GBM Auction System
- Contract ABI for bidding, claiming, reading auction state
- Incentive calculations (GBM rewards outbid users)
- Minimum bid calculations (10% step minimum)

### 3. Subgraph Queries (Optional)
- Apollo Client for GraphQL
- Can skip initially and use direct contract reads

---

## Phase 1: Wallet Connection

### Dependencies to Add

```bash
npm install wagmi viem @tanstack/react-query @rainbow-me/rainbowkit
```

### Files to Create

#### `src/config/wagmi.js`
```javascript
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";

// Get a free project ID from https://cloud.walletconnect.com/
const WALLET_CONNECT_PROJECT_ID = "YOUR_PROJECT_ID";

export const config = getDefaultConfig({
  appName: "mann.cool",
  chains: [mainnet],
  projectId: WALLET_CONNECT_PROJECT_ID,
  ssr: false, // Vite doesn't use SSR
});
```

#### `src/config/constants.js`
```javascript
// Game NFT Contract (you have this)
export const GAME_NFT_CONTRACT_ADDRESS = "0x..."; // Your minting contract

// GBM Auction Contract (deploy later)
export const GBM_CONTRACT_ADDRESS = "0x..."; // TBD when deployed

// Subgraph URL (set up later)
export const GBM_SUBGRAPH_URL = ""; // TBD
```

#### `src/providers/Web3Provider.jsx`
```jsx
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "../config/wagmi";

import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

export function Web3Provider({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

#### Update `src/main.jsx`
```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { Web3Provider } from "./providers/Web3Provider.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Web3Provider>
        <App />
      </Web3Provider>
    </BrowserRouter>
  </React.StrictMode>
);
```

#### Add Connect Button to Header
```jsx
import { ConnectButton } from "@rainbow-me/rainbowkit";

// In your header component:
<ConnectButton />
```

### Environment Variables

Create `.env` file:
```
VITE_WALLET_CONNECT_PROJECT_ID=your_project_id_here
```

Then reference in wagmi.js:
```javascript
const WALLET_CONNECT_PROJECT_ID = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID;
```

---

## Phase 2: GBM Contract Deployment

### What You Need to Deploy

A GBM auction contract on mainnet. Reference the Song A Day contract structure:

**Key Functions:**
- `bid(auctionID, bidAmount, highestBid, bidder)` - Place a bid
- `claim(auctionID)` - Winner claims NFT after auction ends
- `getAuctionHighestBid(auctionID)` - Current highest bid
- `getAuctionHighestBidder(auctionID)` - Current leader
- `getAuctionEndTime(auctionID)` - When auction ends
- `getAuctionStartTime(auctionID)` - When auction started
- `registerAnAuctionToken(...)` - Admin: create new auction

**GBM Parameters to Configure:**
- `bidDecimals`: 100000 (for percentage calculations)
- `stepMin`: 10000 (10% minimum bid increase)
- `incentiveMin`: 1000 (1% minimum reward if outbid)
- `incentiveMax`: 10000 (10% maximum reward if outbid)
- `bidMultiplier`: 11000 (incentive scaling factor)

### Copy ABI

Copy from `songaday.world-main/abis/gbml2abi.ts` to `mann-dot-cool/src/abis/gbmabi.js`:

```javascript
export const gbmabi = [
  // ... full ABI from songaday.world-main/abis/gbml2abi.ts
];
```

---

## Phase 3: Auction UI Components

### Files to Port/Adapt from Song A Day

| Source File | Purpose | Adaptation Needed |
|-------------|---------|-------------------|
| `components/auction/gbm/AuctionGBML2Auction.tsx` | Main bidding interface | Change "song" references to "game" |
| `components/auction/gbm/BidList.tsx` | Display bid history | Minimal changes |
| `components/auction/gbm/WhatIsGBMModal.tsx` | Explain GBM to users | Copy as-is |
| `components/modals/TransactionWaitModal.tsx` | Show pending tx | Copy as-is |
| `lib/helpers.ts` → `incentiveCalculator` | Calculate GBM rewards | Copy as-is |

### Key Helper Functions to Copy

```javascript
// From songaday.world-main/lib/helpers.ts

// Format wallet addresses
export function formatAddress(address, ensName, chars = 4) {
  if (ensName) return ensName;
  if (address) {
    return `${address.substring(0, chars)}...${address.substring(address.length - chars)}`;
  }
  return "";
}

// Calculate minimum valid bid (10% above current)
export function calculateMinBid(currentBid) {
  const bidDecimals = BigInt("100000");
  const stepMin = BigInt("10000"); // 10%
  const previousBid = BigInt(currentBid);
  return (previousBid * (bidDecimals + stepMin)) / bidDecimals;
}

// Calculate GBM incentive reward
export const incentiveCalculator = {
  calculateIncentivesRawFromBidAndPreset(
    _bidDecimals,
    _incentiveMin,
    _incentiveMax,
    _stepMin,
    _bidMultiplier,
    _previousBid,
    _newBid
  ) {
    // ... full implementation in songaday.world-main/lib/helpers.ts lines 290-337
  }
};
```

---

## Phase 4: Subgraph (Optional Enhancement)

### Why Use a Subgraph?
- Faster queries for bid history
- Don't need to scan blockchain for events
- Better for displaying past auctions

### Alternative: Direct Contract Reads
For a simpler start, you can read directly from the contract:
```javascript
import { useReadContract } from 'wagmi';
import { gbmabi } from '../abis/gbmabi';

function useAuctionData(auctionId) {
  const { data: highestBid } = useReadContract({
    address: GBM_CONTRACT_ADDRESS,
    abi: gbmabi,
    functionName: 'getAuctionHighestBid',
    args: [BigInt(auctionId)],
  });
  
  // ... more reads
}
```

### If You Want a Subgraph Later
1. Deploy subgraph to The Graph or Goldsky
2. Add Apollo Client: `npm install @apollo/client graphql`
3. Reference `songaday.world-main/lib/graphs/fetchGraphGBML2Base.ts` for query patterns

---

## File Structure After Implementation

```
mann-dot-cool/
├── src/
│   ├── abis/
│   │   └── gbmabi.js           # GBM contract ABI
│   ├── components/
│   │   ├── auction/
│   │   │   ├── AuctionInterface.jsx  # Main bidding UI
│   │   │   ├── BidList.jsx           # Bid history
│   │   │   ├── BidInput.jsx          # Bid amount input
│   │   │   └── GBMInfoModal.jsx      # What is GBM?
│   │   ├── ConnectWallet.jsx         # Wallet button wrapper
│   │   └── TransactionModal.jsx      # Pending tx modal
│   ├── config/
│   │   ├── constants.js        # Contract addresses
│   │   └── wagmi.js            # Wallet config
│   ├── hooks/
│   │   └── useAuction.js       # Auction data hook
│   ├── lib/
│   │   └── helpers.js          # Formatting, calculations
│   ├── providers/
│   │   └── Web3Provider.jsx    # Wagmi + RainbowKit
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── .env                        # VITE_WALLET_CONNECT_PROJECT_ID
└── package.json
```

---

## Quick Reference: Song A Day Source Files

When implementing, reference these files in `songaday.world-main`:

| What | File Path |
|------|-----------|
| Wagmi config | `config/wagmi.ts` |
| Constants | `config/constants.ts` |
| GBM ABI | `abis/gbml2abi.ts` |
| Main auction component | `components/auction/gbm/AuctionGBML2Auction.tsx` |
| Bid list | `components/auction/gbm/BidList.tsx` |
| GBM info modal | `components/auction/gbm/WhatIsGBMModal.tsx` |
| Incentive calculator | `lib/helpers.ts` (lines 290-386) |
| Auction types | `lib/auction-types.ts` |
| Bid types | `lib/types.ts` |
| Transaction modal | `components/modals/TransactionWaitModal.tsx` |
| Wallet providers | `app/providers.tsx` |

---

## Checklist

### Phase 1: Wallet ✅
- [ ] Install dependencies (wagmi, viem, rainbowkit, react-query)
- [ ] Create wagmi config
- [ ] Create Web3Provider
- [ ] Update main.jsx with provider
- [ ] Add ConnectButton to header
- [ ] Get WalletConnect project ID
- [ ] Test wallet connection

### Phase 2: Contract
- [ ] Deploy GBM contract to mainnet
- [ ] Copy ABI to project
- [ ] Update constants with contract address
- [ ] Test contract reads

### Phase 3: Auction UI
- [ ] Create auction interface component
- [ ] Add bid input with validation
- [ ] Add bid list component
- [ ] Add transaction pending modal
- [ ] Add GBM explainer modal
- [ ] Style to match retro aesthetic

### Phase 4: Polish
- [ ] Add ENS name resolution for bidders
- [ ] Add blockies avatars
- [ ] Consider subgraph for bid history
- [ ] Mobile responsive testing

---

## Notes

- **No cross-chain bridging needed** since we're on mainnet only
- **Simpler than Song A Day** because we skip the Relay SDK complexity
- **UI is flexible** - can keep the retro CSS or add Chakra just for auction components
- **Contract first** - need GBM contract deployed before Phase 3 can be fully tested

