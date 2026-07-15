import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { gbmabi } from '../../abis/gbmabi';
import { GBM_CONTRACT_ADDRESS } from '../../config/constants';
import { formatAddress } from '../../hooks/useAuction';

/**
 * BidModal - Modal for placing bids
 * Uses a portal to escape transformed ancestors (which break position:fixed)
 */
export function BidModal({ auction, gameTitle, onClose }) {
  const { address, isConnected } = useAccount();
  const [bidAmount, setBidAmount] = useState('');
  const [error, setError] = useState('');

  // Pre-fill with minimum bid
  useEffect(() => {
    if (auction.minimumBidEth) {
      // Add a tiny bit extra to ensure it's above minimum
      const minBid = parseFloat(auction.minimumBidEth);
      setBidAmount(minBid > 0 ? minBid.toFixed(4) : '0.1');
    }
  }, [auction.minimumBidEth]);

  // Contract write
  const { data: hash, error: writeError, isPending, writeContract } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Handle successful bid
  useEffect(() => {
    if (isSuccess) {
      setTimeout(() => {
        onClose();
      }, 2000);
    }
  }, [isSuccess, onClose]);

  const handleBid = async () => {
    setError('');

    if (!isConnected || !address) {
      setError('Please connect your wallet');
      return;
    }

    const bidWei = parseEther(bidAmount);
    const minimumWei = auction.minimumBid || parseEther('0.1');

    if (bidWei < minimumWei) {
      setError(`Bid must be at least ${formatEther(minimumWei)} ETH`);
      return;
    }

    try {
      writeContract({
        address: GBM_CONTRACT_ADDRESS,
        abi: gbmabi,
        functionName: 'bid',
        args: [
          auction.auctionId,
          bidWei,
          auction.highestBid || 0n,
          address,
        ],
        value: bidWei,
      });
    } catch (err) {
      setError(err.message || 'Failed to place bid');
    }
  };

  // Calculate potential incentive if outbid (simplified)
  const potentialIncentive = bidAmount ? 
    (parseFloat(bidAmount) * 0.1).toFixed(4) : '0';

  return createPortal(
    <div className="bid-modal-overlay" onClick={onClose}>
      <div className="bid-modal" onClick={(e) => e.stopPropagation()}>
        <button className="bid-modal-close" onClick={onClose}>✕</button>
        
        <h2 className="bid-modal-title">Place Bid</h2>
        <p className="bid-modal-game">{gameTitle}</p>

        {/* Auction Info */}
        <div className="bid-modal-info">
          <div className="bid-info-row">
            <span className="bid-info-label">Current Bid</span>
            <span className="bid-info-value">
              {auction.hasBids ? `${parseFloat(auction.highestBidEth).toFixed(4)} ETH` : 'No bids yet'}
            </span>
          </div>
          
          {auction.highestBidder && auction.hasBids && (
            <div className="bid-info-row">
              <span className="bid-info-label">Leading Bidder</span>
              <span className="bid-info-value">{formatAddress(auction.highestBidder)}</span>
            </div>
          )}
          
          <div className="bid-info-row">
            <span className="bid-info-label">
              {auction.hasStarted ? 'Time Remaining' : 'Status'}
            </span>
            <span className="bid-info-value bid-time-urgent">
              {auction.hasStarted ? auction.timeRemaining : 'Starting soon - place bid now!'}
            </span>
          </div>
          
          <div className="bid-info-row">
            <span className="bid-info-label">Minimum Bid</span>
            <span className="bid-info-value">{parseFloat(auction.minimumBidEth || '0.1').toFixed(4)} ETH</span>
          </div>
        </div>

        {/* GBM Info */}
        <div className="bid-modal-gbm-info">
          <p className="gbm-info-title">🎮 GBM Auction</p>
          <p className="gbm-info-text">
            If you get outbid, you'll receive your bid back <strong>plus up to ~{potentialIncentive} ETH</strong> as an incentive!
          </p>
        </div>

        {/* Wallet Connection or Bid Input */}
        {!isConnected ? (
          <div className="bid-modal-connect">
            <p>Connect your wallet to bid</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Bid Input */}
            <div className="bid-input-wrapper">
              <label className="bid-input-label">Your Bid (ETH)</label>
              <div className="bid-input-row">
                <input
                  type="number"
                  step="0.001"
                  min={auction.minimumBidEth}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="bid-input"
                  placeholder="0.1"
                  disabled={isPending || isConfirming}
                />
                <span className="bid-input-suffix">ETH</span>
              </div>
            </div>

            {/* Quick Bid Buttons */}
            <div className="bid-quick-buttons">
              <button 
                className="bid-quick-btn"
                onClick={() => setBidAmount(auction.minimumBidEth)}
                disabled={isPending || isConfirming}
              >
                Min ({parseFloat(auction.minimumBidEth).toFixed(3)})
              </button>
              <button 
                className="bid-quick-btn"
                onClick={() => setBidAmount((parseFloat(auction.minimumBidEth) * 1.5).toFixed(4))}
                disabled={isPending || isConfirming}
              >
                +50%
              </button>
              <button 
                className="bid-quick-btn"
                onClick={() => setBidAmount((parseFloat(auction.minimumBidEth) * 2).toFixed(4))}
                disabled={isPending || isConfirming}
              >
                2x
              </button>
            </div>

            {/* Error Display */}
            {(error || writeError) && (
              <div className="bid-error">
                {error || writeError?.message}
              </div>
            )}

            {/* Success Display */}
            {isSuccess && (
              <div className="bid-success">
                ✓ Bid placed successfully!
              </div>
            )}

            {/* Submit Button */}
            <button
              className="bid-submit-btn"
              onClick={handleBid}
              disabled={isPending || isConfirming || !bidAmount}
            >
              {isPending ? 'Confirm in wallet...' : 
               isConfirming ? 'Placing bid...' :
               `Place ${bidAmount || '0'} ETH Bid`}
            </button>
          </>
        )}

        {/* Transaction Hash */}
        {hash && (
          <a 
            href={`https://etherscan.io/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bid-tx-link"
          >
            View transaction on Etherscan →
          </a>
        )}
      </div>
    </div>,
    document.body
  );
}

