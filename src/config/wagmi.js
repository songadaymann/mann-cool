import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { mainnet } from "wagmi/chains";

// Get a free project ID from https://cloud.walletconnect.com/
// For now using a placeholder - replace with your own
const WALLET_CONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || "YOUR_PROJECT_ID";

export const config = getDefaultConfig({
  appName: "mann.cool",
  chains: [mainnet],
  projectId: WALLET_CONNECT_PROJECT_ID,
  ssr: false, // Vite doesn't use SSR
  transports: {
    [mainnet.id]: http(),
  },
});

