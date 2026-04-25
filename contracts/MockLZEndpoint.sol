// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title MockLZEndpoint
 * @notice Mock LayerZero V2 endpoint for testing CrossChainIdentity
 */
contract MockLZEndpoint {
    struct MessagingParams {
        uint32 dstEid;
        bytes32 receiver;
        bytes message;
        bytes options;
        bool payInLzToken;
    }

    struct MessagingReceipt {
        bytes32 guid;
        uint64 nonce;
        MessagingFee fee;
    }

    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }

    mapping(uint32 => bytes) public storedPayloads;
    mapping(bytes32 => bool) public failedMessages;
    mapping(address => uint64) public nonces;
    uint256 public fee = 0;
    uint64 public globalNonce = 1;

    event SendCalled(uint32 dstEid, bytes32 receiver, bytes message);
    event QuoteCalled(uint32 dstEid, bytes message, uint256 fee);

    function send(
        MessagingParams calldata _params,
        address payable _refundAddress
    ) external payable returns (MessagingReceipt memory) {
        storedPayloads[_params.dstEid] = _params.message;
        bytes32 guid = keccak256(abi.encodePacked(msg.sender, _params.dstEid, nonces[msg.sender]++));
        globalNonce++;
        
        emit SendCalled(_params.dstEid, _params.receiver, _params.message);
        
        return MessagingReceipt({
            guid: guid,
            nonce: nonces[msg.sender],
            fee: MessagingFee({ nativeFee: fee, lzTokenFee: 0 })
        });
    }

    function quote(
        MessagingParams calldata _params,
        address _sender
    ) external view returns (MessagingFee memory) {
        return MessagingFee({ nativeFee: fee, lzTokenFee: 0 });
    }

    function setFee(uint256 _fee) external {
        fee = _fee;
    }

    function receivePayload(uint32 _srcEid, bytes memory _payload) external {
        storedPayloads[_srcEid] = _payload;
    }

    function clearPayload(uint32 _dstEid) external {
        delete storedPayloads[_dstEid];
    }

    receive() external payable {}
}
