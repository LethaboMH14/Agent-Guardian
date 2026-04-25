import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    arcTestnet: {
      url: process.env.ARC_TESTNET_URL || "https://testnet.arc.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 1000000000, // 1 gwei
      chainId: 1234 // Arc testnet chain ID
    },
    arcMainnet: {
      url: process.env.ARC_MAINNET_URL || "https://mainnet.arc.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 12345 // Arc mainnet chain ID
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  },
  etherscan: {
    apiKey: {
      arcTestnet: process.env.ARCSCAN_API_KEY || "",
      arcMainnet: process.env.ARCSCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "arcTestnet",
        chainId: 1234,
        urls: {
          apiURL: "https://testnet.arcscan.xyz/api",
          browserURL: "https://testnet.arcscan.xyz"
        }
      },
      {
        network: "arcMainnet",
        chainId: 12345,
        urls: {
          apiURL: "https://arcscan.xyz/api",
          browserURL: "https://arcscan.xyz"
        }
      }
    ]
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    token: "ETH",
    gasPrice: 21
  }
};

export default config;
