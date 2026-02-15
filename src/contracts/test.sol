// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SenderExample {
    function getSender() public view returns (address) {
        return msg.sender;
    }
}