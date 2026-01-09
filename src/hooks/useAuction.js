import { useReadContract, useReadContracts } from 'wagmi';
import { formatEther } from 'viem';
import { gbmabi } from '../abis/gbmabi';
import { GBM_CONTRACT_ADDRESS, GAME_NFT_CONTRACT_ADDRESS } from '../config/constants';

/**
 * Hook to get auction data for a game token
 * @param {number} tokenId - The game token ID
 * @returns Auction state and data
 */
export function useAuction(tokenId) {
  // First, get the auction ID for this token
  const { data: auctionId, isLoading: loadingAuctionId } = useReadContract({
    address: GBM_CONTRACT_ADDRESS,
    abi: gbmabi,
    functionName: 'getAuctionIDSongADao',
    args: [GAME_NFT_CONTRACT_ADDRESS, BigInt(tokenId)],
  });

  const hasAuction = auctionId && auctionId > 0n;

  // Batch read all auction data
  const { data: auctionData, isLoading: loadingAuctionData } = useReadContracts({
    contracts: hasAuction ? [
      {
        address: GBM_CONTRACT_ADDRESS,
        abi: gbmabi,
        functionName: 'getAuctionHighestBid',
        args: [auctionId],
      },
      {
        address: GBM_CONTRACT_ADDRESS,
        abi: gbmabi,
        functionName: 'getAuctionHighestBidder',
        args: [auctionId],
      },
      {
        address: GBM_CONTRACT_ADDRESS,
        abi: gbmabi,
        functionName: 'getAuctionStartTime',
        args: [auctionId],
      },
      {
        address: GBM_CONTRACT_ADDRESS,
        abi: gbmabi,
        functionName: 'getAuctionEndTime',
        args: [auctionId],
      },
      {
        address: GBM_CONTRACT_ADDRESS,
        abi: gbmabi,
        functionName: 'getMinimumBid',
        args: [auctionId],
      },
    ] : [],
    query: {
      enabled: hasAuction,
      refetchInterval: 10000, // Refresh every 10 seconds
    },
  });

  // Parse the batch results
  const highestBid = auctionData?.[0]?.result;
  const highestBidder = auctionData?.[1]?.result;
  const startTime = auctionData?.[2]?.result;
  const endTime = auctionData?.[3]?.result;
  const minimumBid = auctionData?.[4]?.result;

  // Determine auction state
  const now = BigInt(Math.floor(Date.now() / 1000));
  const hasStarted = startTime && now >= startTime;
  const hasEnded = endTime && now >= endTime;
  const hasBids = highestBid && highestBid > 0n;
  
  // Calculate time remaining
  let timeRemaining = null;
  if (hasAuction && hasStarted && !hasEnded && endTime) {
    const remaining = Number(endTime - now);
    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      const seconds = remaining % 60;
      
      if (hours > 0) {
        timeRemaining = `${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        timeRemaining = `${minutes}m ${seconds}s`;
      } else {
        timeRemaining = `${seconds}s`;
      }
    }
  }

  // Format values for display
  const highestBidEth = highestBid ? formatEther(highestBid) : '0';
  const minimumBidEth = minimumBid ? formatEther(minimumBid) : '0.1';

  return {
    // Raw values
    auctionId,
    highestBid,
    highestBidder,
    startTime,
    endTime,
    minimumBid,
    
    // Formatted for display
    highestBidEth,
    minimumBidEth,
    timeRemaining,
    
    // State flags
    hasAuction,
    hasStarted,
    hasEnded,
    hasBids,
    isLoading: loadingAuctionId || loadingAuctionData,
    
    // Auction status
    status: !hasAuction ? 'no_auction' :
            !hasStarted ? 'not_started' :
            hasEnded ? 'ended' :
            hasBids ? 'active' : 'waiting_for_bids',
  };
}

/**
 * Format an address for display
 */
export function formatAddress(address, chars = 4) {
  if (!address) return '';
  return `${address.substring(0, chars + 2)}...${address.substring(address.length - chars)}`;
}







