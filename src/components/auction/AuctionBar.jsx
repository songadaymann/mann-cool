import { useState } from 'react';
import { useAuction, formatAddress } from '../../hooks/useAuction';
import { BidModal } from './BidModal';

/**
 * AuctionBar - Shows auction status below a game
 * 
 * States:
 * 1. No auction registered - shows nothing (or "Coming Soon")
 * 2. Auction waiting for first bid - "Place Bid" button, hover shows "min 0.1 ETH"
 * 3. Auction active with bids - Shows current bid, time left, bid button
 * 4. Auction ended - Shows winner info
 */
export function AuctionBar({ tokenId, gameTitle }) {
  const [showModal, setShowModal] = useState(false);
  const auction = useAuction(tokenId);

  // Prevent click from bubbling up to parent Link
  const handleBidClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowModal(true);
  };

  // Don't show anything if no auction registered
  if (!auction.hasAuction) {
    return null;
  }

  // Loading state
  if (auction.isLoading) {
    return (
      <div className="auction-bar auction-bar-loading">
        <span className="auction-loading-text">Loading auction...</span>
      </div>
    );
  }

  // Auction ended
  if (auction.hasEnded) {
    return (
      <div className="auction-bar auction-bar-ended">
        <span className="auction-ended-label">SOLD</span>
        <span className="auction-ended-price">{parseFloat(auction.highestBidEth).toFixed(3)} ETH</span>
        {auction.highestBidder && (
          <span className="auction-ended-winner">
            to {formatAddress(auction.highestBidder)}
          </span>
        )}
      </div>
    );
  }

  // Auction not started yet - still let them click to see details/place bid
  if (!auction.hasStarted) {
    return (
      <>
        <div className="auction-bar auction-bar-upcoming" onClick={(e) => e.stopPropagation()}>
          <button 
            className="auction-bid-button auction-bid-button-first"
            onClick={handleBidClick}
            title="min 0.1 ETH"
          >
            <span className="bid-button-text">Place First Bid</span>
            <span className="bid-button-hint">min 0.1 ETH</span>
          </button>
        </div>
        
        {showModal && (
          <BidModal 
            auction={auction}
            gameTitle={gameTitle}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  // Active auction - waiting for first bid
  if (!auction.hasBids) {
    return (
      <>
        <div className="auction-bar auction-bar-waiting" onClick={(e) => e.stopPropagation()}>
          <button 
            className="auction-bid-button auction-bid-button-first"
            onClick={handleBidClick}
            title="min 0.1 ETH"
          >
            <span className="bid-button-text">Place Bid</span>
            <span className="bid-button-hint">min 0.1 ETH</span>
          </button>
          <span className="auction-time-left">{auction.timeRemaining} left</span>
        </div>
        
        {showModal && (
          <BidModal 
            auction={auction}
            gameTitle={gameTitle}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  // Active auction with bids
  return (
    <>
      <div className="auction-bar auction-bar-active" onClick={(e) => e.stopPropagation()}>
        <div className="auction-current-bid">
          <span className="auction-bid-label">Current Bid</span>
          <span className="auction-bid-amount">{parseFloat(auction.highestBidEth).toFixed(3)} ETH</span>
        </div>
        
        <button 
          className="auction-bid-button"
          onClick={handleBidClick}
          title={`min ${parseFloat(auction.minimumBidEth).toFixed(3)} ETH`}
        >
          <span className="bid-button-text">Bid</span>
          <span className="bid-button-hint">min {parseFloat(auction.minimumBidEth).toFixed(3)}</span>
        </button>
        
        <div className="auction-time-remaining">
          <span className="auction-time-value">{auction.timeRemaining}</span>
          <span className="auction-time-label">left</span>
        </div>
      </div>
      
      {showModal && (
        <BidModal 
          auction={auction}
          gameTitle={gameTitle}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

