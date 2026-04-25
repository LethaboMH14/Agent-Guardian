// Minimal ABIs — only the functions needed by the UI
export const AGENT_REGISTRY_ABI = [
  "function totalSupply() view returns (uint256)",
  "function getReputation(uint256 tokenId) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)"
];

export const INSURANCE_POOL_ABI = [
  "function totalStaked() view returns (uint256)",
  "function activePolicyCount() view returns (uint256)",
  "function totalClaims() view returns (uint256)",
  "function getStake(address user) view returns (uint256)",
  "function getEarnings(address user) view returns (uint256)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)"
];

export const UNDERWRITER_DAO_ABI = [
  "function activeUnderwriterCount() view returns (uint256)",
  "function totalRagntStaked() view returns (uint256)",
  "function pendingApplicationCount() view returns (uint256)",
  "function getPendingApplications() view returns (address[])",
  "function castBackingVote(uint256 applicationId, bool approve)"
];

export const BATCH_VERIFIER_ABI = [
  "function queueDepth() view returns (uint256)",
  "function MAX_BATCH() view returns (uint256)"
];

export const COGNITION_VERIFIER_ABI = [
  "function modelCommitment(address agent) view returns (bytes32)"
];

// Expose ABIs globally for non-module scripts
window.AGENT_REGISTRY_ABI = AGENT_REGISTRY_ABI;
window.INSURANCE_POOL_ABI = INSURANCE_POOL_ABI;
window.UNDERWRITER_DAO_ABI = UNDERWRITER_DAO_ABI;
window.BATCH_VERIFIER_ABI = BATCH_VERIFIER_ABI;
window.COGNITION_VERIFIER_ABI = COGNITION_VERIFIER_ABI;
window.BATCH_PROOF_ENGINE_ABI = BATCH_VERIFIER_ABI;
