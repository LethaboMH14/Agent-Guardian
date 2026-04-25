import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { AgentGuardian } from "../typechain-types";

declare global {
  namespace Chai {
    interface Assertion {
      emit(eventName: string, ...args: any[]): Promise<void>;
      revertedWithCustomError(contract: any, errorName: string): Promise<void>;
    }
  }
}

export {};
