declare module 'snarkjs' {
  export const zKey: {
    newZKey(r1csFile: string, ptauFile: string, zkeyFile: string): Promise<void>;
    contribute(zkeyFile: string, newZkeyFile: string, name: string, entropy: string): Promise<void>;
    exportVerificationKey(zkeyFile: string): Promise<any>;
    exportSolidityVerifier(zkeyFile: string, templates: any): Promise<string>;
  };
}
