// GBM Auction Contract ABI
// Mainnet: 0x06c85C9Df7a5A4b4f2bC7fB4eE2F7894BEBd277c

export const gbmabi = [
  // Register an auction for a token
  {
    inputs: [
      { name: "_contract", type: "address" },
      { name: "_tokenID", type: "uint256" },
      { name: "_startTimestamp", type: "uint256" },
      { name: "_endTimestamp", type: "uint256" }
    ],
    name: "registerAnAuctionToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  // Get auction ID for a token
  {
    inputs: [
      { name: "_contract", type: "address" },
      { name: "_tokenID", type: "uint256" }
    ],
    name: "getAuctionIDSongADao",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  // Get highest bid
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "getAuctionHighestBid",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  // Get highest bidder
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "getAuctionHighestBidder",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  // Get auction start time
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "getAuctionStartTime",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  // Get auction end time
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "getAuctionEndTime",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  // Get minimum bid
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "getMinimumBid",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  // Bid on auction
  {
    inputs: [
      { name: "_auctionID", type: "uint256" },
      { name: "_bidAmount", type: "uint256" },
      { name: "_highestBid", type: "uint256" },
      { name: "_bidder", type: "address" }
    ],
    name: "bid",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  // Claim won auction
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  // Cancel auction (owner only, before any bids)
  {
    inputs: [{ name: "_auctionID", type: "uint256" }],
    name: "cancelAuction",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  // Owner check
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
];






