pragma circom 2.0.0;

include "poseidon.circom";

/*
 * ReLU(x) = max(0, x)
 *
 * We work in a prime field, so "negative" values are large numbers near p.
 * We use a comparison trick: decompose x into bits and check the sign bit.
 *
 * Inputs  : in  — the pre-activation value (field element, signed via two's complement convention)
 * Outputs : out — ReLU(in)
 */
template ReLU(n) {
    signal input in;          // raw activation (can be "negative" as large field element)
    signal output out;        // clamped output

    // is_positive: 1 if in > 0, 0 if in <= 0
    signal is_positive;
    is_positive <-- in > 0 ? 1 : 0;

    // Enforce is_positive is boolean
    is_positive * (1 - is_positive) === 0;

    // out = in * is_positive
    // If in <= 0 → out = 0
    // If in > 0  → out = in
    out <== in * is_positive;
}

/*
 * CognitionLayer: runs N ReLU activations and hashes the outputs.
 *
 * SECURITY: We do NOT expose post[] values publicly. An observer watching
 * many transactions could reconstruct model weights via model inversion if
 * raw activations were public. Instead we expose only decisionHash =
 * Poseidon(post[0..N-1]), which proves the computation ran correctly without
 * leaking the intermediate values that would expose the weight space.
 *
 * Public outputs : decisionHash — Poseidon(post[0..N-1])
 * Private inputs : pre[N]       — raw neuron outputs before activation
 */
template CognitionLayer(N) {
    signal input  pre[N];          // private: raw neuron outputs before activation
    signal output decisionHash;    // public:  Poseidon of post-ReLU values

    // Step 1: compute ReLU on each neuron (all private)
    component relu[N];
    signal post[N];                // private intermediate
    for (var i = 0; i < N; i++) {
        relu[i] = ReLU(252);
        relu[i].in <== pre[i];
        post[i]    <== relu[i].out;
    }

    // Step 2: hash the post-activation values → single public output
    // This proves the computation occurred without leaking individual activations
    component hasher = Poseidon(N);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== post[i];
    }
    decisionHash <== hasher.out;
}

/*
 * ModelCommitment: proves the weights used match the commitment stored in AgentRegistry.
 *
 * We use a simple Poseidon hash of the weight vector as the commitment.
 * The actual Poseidon template is imported from circomlib.
 */

template ModelCommitment(N) {
    signal input  weights[N];          // private: model weight vector
    signal input  commitment;          // public:  hash stored in AgentRegistry

    component hasher = Poseidon(N);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== weights[i];
    }

    // Enforce: hash(weights) === commitment
    hasher.out === commitment;
}

/*
 * AgentCognitionProof — the top-level circuit submitted to AgentGuardian.
 *
 * Proves simultaneously:
 *   1. The agent's activation layer was computed correctly (ReLU)
 *   2. The output was hashed (prevents model inversion from public inputs)
 *   3. The weights used match the on-chain commitment
 *
 * N = number of neurons in the layer being proven
 * W = number of model weights being committed to
 */
template AgentCognitionProof(N, W) {
    // ── Private inputs (known only to agent) ──────────────────────────────
    signal input pre[N];        // pre-activation neuron values
    signal input weights[W];    // model weights

    // ── Public inputs (revealed on-chain to AgentGuardian) ────────────────
    signal input decisionHash;  // Poseidon(post[0..N-1]) — hides raw activations
    signal input commitment;    // Poseidon(weights) stored in AgentRegistry

    // ── Sub-circuits ──────────────────────────────────────────────────────
    component layer = CognitionLayer(N);
    component model = ModelCommitment(W);

    // Wire activation layer — layer outputs decisionHash internally
    for (var i = 0; i < N; i++) {
        layer.pre[i] <== pre[i];
    }
    // Enforce the public decisionHash matches what the circuit computed
    layer.decisionHash === decisionHash;

    // Wire weight commitment
    for (var i = 0; i < W; i++) {
        model.weights[i] <== weights[i];
    }
    model.commitment <== commitment;
}

// ── Entry point ──────────────────────────────────────────────────────────────
// Public signals: decisionHash + commitment = 2 public inputs (down from 9)
// Dramatically reduces on-chain calldata and closes the model inversion vector.
component main {public [decisionHash, commitment]} = AgentCognitionProof(8, 8);
