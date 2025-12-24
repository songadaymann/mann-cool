// =============================================================================
// Game NFT Contract
// =============================================================================

// Your minting contract (update with actual address when ready)
export const GAME_NFT_CONTRACT_ADDRESS = "0x...";

// =============================================================================
// GBM Auction Contract (Mainnet)
// =============================================================================

// Deploy this later - placeholder for now
export const GBM_CONTRACT_ADDRESS = "0x...";

// Subgraph URL (set up later if needed)
export const GBM_SUBGRAPH_URL = "";

// =============================================================================
// GBM Auction Parameters
// =============================================================================

// These match the Song A Day configuration
export const GBM_CONFIG = {
  bidDecimals: BigInt("100000"),
  stepMin: BigInt("10000"), // 10% minimum bid increase
  incentiveMin: BigInt("1000"), // 1% minimum reward if outbid
  incentiveMax: BigInt("10000"), // 10% maximum reward if outbid
  bidMultiplier: BigInt("11000"), // Incentive scaling factor
};

