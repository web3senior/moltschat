// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

// ■■■ External Dependencies ■■■
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PrivateChat
 * @dev Secure chat with Session Key delegation and On-Chain Conversation Tracking.
 * Optimized for scaling and gasless interactions on LUKSO.
 */
contract PrivateChat is ERC2771Context, Ownable {

    // ■■■ State Variables ■■■

    address private _activeForwarder;
    uint256 private nextMessageId;

    struct Session {
        address burnerKey;
        uint256 expiresAt;
    }

    struct ChatMessage {
        address sender;
        address receiver;
        uint256 timestamp;
        bytes32 cidHash;
        string fullCID;
        bytes senderEncryptedKey;
        bytes receiverEncryptedKey;
        bool isEdited;
        bool isDeleted;
    }

    struct DecryptionData {
        uint256 messageId;
        address sender;
        address receiver;
        uint256 timestamp;
        bytes32 cidHash;
        string fullCID;
        bytes encryptedKeyForCaller;
        bool isEdited;
        bool isDeleted;
    }

    mapping(address => Session) public userSessions;
    mapping(address => bytes) public publicKeyRegistry;
    mapping(uint256 => ChatMessage) public messages;
    mapping(bytes32 => uint256[]) public conversationIndex;
    mapping(address => mapping(address => bool)) public isBlocked;

    // Scaling: On-Chain Conversation Tracking
    mapping(address => address[]) private _activeConversations;
    mapping(address => mapping(address => bool)) private _isConversationTracked;

    // ■■■ Events ■■■

    event MessageSent(uint256 indexed messageId, address indexed sender, address indexed receiver, bytes32 cidHash, uint256 timestamp);
    event MessageUpdated(uint256 indexed messageId, bytes32 newCidHash);
    event MessageDeleted(uint256 indexed messageId);
    event UserBlocked(address indexed owner, address indexed blockedUser, bool status);
    event PublicKeyRegistered(address indexed user);
    event SessionAuthorized(address indexed owner, address indexed burner, uint256 expiry);
    event ForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);

    // ■■■ Constructor ■■■

    constructor(address initialForwarder) ERC2771Context(initialForwarder) Ownable(msg.sender) {
        _activeForwarder = initialForwarder;
    }

    // ■■■ Access Control ■■■

    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return forwarder == _activeForwarder;
    }

    function updateForwarder(address newForwarder) external onlyOwner {
        require(newForwarder != address(0), "Invalid address");
        address oldForwarder = _activeForwarder;
        _activeForwarder = newForwarder;
        emit ForwarderUpdated(oldForwarder, newForwarder);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    // ■■■ Logic Control ■■■

    /**
     * @dev Generates a unique deterministic key for a pair of addresses.
     * Sorting ensures that (A, B) and (B, A) yield the same key.
     */
    function getConversationKey(address _addrA, address _addrB) public pure returns (bytes32) {
        return _addrA < _addrB ? keccak256(abi.encodePacked(_addrA, _addrB)) : keccak256(abi.encodePacked(_addrB, _addrA));
    }

    function _resolveActor(address _owner) internal view returns (address actor) {
        if (_owner == address(0)) {
            return _msgSender();
        } else {
            Session memory session = userSessions[_owner];
            require(session.burnerKey == _msgSender(), "Not authorized burner");
            require(block.timestamp < session.expiresAt, "Session expired");
            return _owner;
        }
    }

    function _updateConversationList(address _user, address _contact) internal {
        if (!_isConversationTracked[_user][_contact]) {
            _isConversationTracked[_user][_contact] = true;
            _activeConversations[_user].push(_contact);
        }
    }

    function _storeMessage(address _sender, address _receiver, bytes32 _cidHash, string memory _fullCID, bytes memory _sKey, bytes memory _rKey) internal {
        require(!isBlocked[_receiver][_sender], "You are blocked by this user");
        require(publicKeyRegistry[_receiver].length > 0, "Receiver not registered");

        _updateConversationList(_sender, _receiver);
        _updateConversationList(_receiver, _sender);

        uint256 messageId = nextMessageId++;
        ChatMessage storage newMessage = messages[messageId];

        newMessage.sender = _sender;
        newMessage.receiver = _receiver;
        newMessage.timestamp = block.timestamp;
        newMessage.cidHash = _cidHash;
        newMessage.fullCID = _fullCID;
        newMessage.senderEncryptedKey = _sKey;
        newMessage.receiverEncryptedKey = _rKey;

        conversationIndex[getConversationKey(_sender, _receiver)].push(messageId);
        emit MessageSent(messageId, _sender, _receiver, _cidHash, block.timestamp);
    }

    // ■■■ Session Management ■■■

    function authorizeSession(address _burner, uint256 _duration) external {
        require(_burner != address(0), "Invalid burner");
        userSessions[_msgSender()] = Session({burnerKey: _burner, expiresAt: block.timestamp + _duration});
        emit SessionAuthorized(_msgSender(), _burner, block.timestamp + _duration);
    }

    // ■■■ User Operations ■■■

    function registerPublicKey(address _owner, bytes calldata _publicKey) external {
        address actor = _resolveActor(_owner);
        require(_publicKey.length == 65, "Invalid key length");
        publicKeyRegistry[actor] = _publicKey;
        emit PublicKeyRegistered(actor);
    }

    function setBlockUser(address _owner, address _target, bool _status) external {
        address actor = _resolveActor(_owner);
        isBlocked[actor][_target] = _status;
        emit UserBlocked(actor, _target, _status);
    }

    // ■■■ Messaging Logic ■■■

    function sendMessage(address _owner, address _receiver, bytes32 _cidHash, string memory _fullCID, bytes calldata _sKey, bytes calldata _rKey) external {
        address actor = _resolveActor(_owner);
        _storeMessage(actor, _receiver, _cidHash, _fullCID, _sKey, _rKey);
    }

    function editMessage(address _owner, uint256 _messageId, bytes32 _newCidHash, string memory _newFullCID) external {
        address actor = _resolveActor(_owner);
        ChatMessage storage m = messages[_messageId];
        require(actor == m.sender, "Not the sender");
        require(!m.isDeleted, "Message deleted");

        m.cidHash = _newCidHash;
        m.fullCID = _newFullCID;
        m.isEdited = true;
        emit MessageUpdated(_messageId, _newCidHash);
    }

    function deleteMessage(address _owner, uint256 _messageId) external {
        address actor = _resolveActor(_owner);
        ChatMessage storage m = messages[_messageId];
        require(actor == m.sender, "Not the sender");
        
        m.isDeleted = true;
        m.cidHash = bytes32(0);
        m.fullCID = "";
        m.senderEncryptedKey = "";
        m.receiverEncryptedKey = "";
        emit MessageDeleted(_messageId);
    }

    // ■■■ Data Retrieval ■■■

    function getPaginatedConversations(address _user, uint256 _offset, uint256 _limit) 
        external 
        view 
        returns (address[] memory result, uint256 total) 
    {
        total = _activeConversations[_user].length;
        if (_offset >= total) return (new address[](0), total);
        
        uint256 size = _limit;
        if (_offset + _limit > total) size = total - _offset;
        
        result = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = _activeConversations[_user][total - 1 - (_offset + i)];
        }
        return (result, total);
    }

    function getPaginatedConversationHistory(address _otherUser, uint256 _page, uint256 _pageSize) 
        public view returns (DecryptionData[] memory result, uint256 totalMessages) 
    {
        address caller = _msgSender();
        bytes32 conversationKey = getConversationKey(caller, _otherUser);
        uint256[] storage fullHistory = conversationIndex[conversationKey];
        totalMessages = fullHistory.length;

        if (totalMessages == 0 || (_page - 1) * _pageSize >= totalMessages) return (new DecryptionData[](0), totalMessages);

        uint256 startIndex = (_page - 1) * _pageSize;
        uint256 endIndex = startIndex + _pageSize;
        if (endIndex > totalMessages) endIndex = totalMessages;

        result = new DecryptionData[](endIndex - startIndex);
        for (uint256 i = 0; i < result.length; i++) {
            uint256 mId = fullHistory[totalMessages - 1 - (startIndex + i)];
            ChatMessage storage m = messages[mId];
            result[i] = DecryptionData({
                messageId: mId,
                sender: m.sender,
                receiver: m.receiver,
                timestamp: m.timestamp,
                cidHash: m.cidHash,
                fullCID: m.fullCID,
                encryptedKeyForCaller: (caller == m.sender) ? m.senderEncryptedKey : m.receiverEncryptedKey,
                isEdited: m.isEdited,
                isDeleted: m.isDeleted
            });
        }
        return (result, totalMessages);
    }
}