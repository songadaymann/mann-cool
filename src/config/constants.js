// =============================================================================
// Game NFT Contract
// =============================================================================

export const GAME_NFT_CONTRACT_ADDRESS = "0x734842b5431A926dB23A99feFbBe4B100c8A8cE6";

// =============================================================================
// GBM Auction Contract (Mainnet)
// =============================================================================

export const GBM_CONTRACT_ADDRESS = "0x06c85C9Df7a5A4b4f2bC7fB4eE2F7894BEBd277c";

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

