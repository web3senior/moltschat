// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PrivateFundTransfer is ReentrancyGuard {
    bytes32 public merkleRoot;
    mapping(bytes32 => bool) public nullifierHashes;
    mapping(bytes32 => bool) public usedCommitments;

    event Deposited(bytes32 indexed commitment, uint256 amount);
    event Withdrawn(address to, bytes32 nullifierHash);

    uint256 public constant TRANSFER_AMOUNT = 0.1 ether; // Fixed amount for better privacy

    constructor(bytes32 _initialRoot) {
        merkleRoot = _initialRoot;
    }

    // In a real scenario, an operator updates the root after deposits
    // or the contract calculates it on-chain (gas intensive).
    function updateRoot(bytes32 _newRoot) external {
        // Restricted to an authorized sequencer/operator
        merkleRoot = _newRoot;
    }

    /**
     * @dev Step 1: User deposits funds and provides a commitment (hash of secret + nullifier)
     */
    function deposit(bytes32 commitment) external payable {
        require(msg.value == TRANSFER_AMOUNT, "Invalid amount");
        require(!usedCommitments[commitment], "Commitment already used");
        
        usedCommitments[commitment] = true;
        emit Deposited(commitment, msg.value);
    }

    /**
     * @dev Step 2: User withdraws to a NEW address by proving membership in the tree
     * @param proof The Merkle proof generated off-chain
     * @param nullifierHash The hash of the nullifier to prevent double-spending
     * @param recipient The address receiving the funds
     */
    function withdraw(
        bytes32[] calldata proof,
        bytes32 nullifierHash,
        address payable recipient
    ) external nonReentrant {
        require(!nullifierHashes[nullifierHash], "Proof already spent");

        // Reconstruct the leaf: In this case, the leaf is the commitment
        // We hash the nullifierHash with a secret off-chain to get the commitment
        // For simplicity here, we assume the leaf = hash(nullifier + secret)
        
        // Check if the leaf (commitment) exists in the Merkle Tree
        // Note: The leaf must be hashed again if using OpenZeppelin's StandardMerkleTree
        bytes32 leaf = keccak256(abi.encodePacked(nullifierHash)); 
        
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Invalid Merkle Proof");

        nullifierHashes[nullifierHash] = true;
        
        (bool success, ) = recipient.call{value: TRANSFER_AMOUNT}("");
        require(success, "Transfer failed");

        emit Withdrawn(recipient, nullifierHash);
    }
}