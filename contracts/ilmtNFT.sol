// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ilmtNFT is ERC721, Ownable, ReentrancyGuard {
    bytes32 private constant DOMAIN_NAME = keccak256("ILMT");
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256(
            abi.encodePacked("Mint(address to,uint256 tokenId,uint256 nonce)")
        );

    bytes32 public DOMAIN_SEPARATOR;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) used;
    uint256 public totalSupply;
    string public baseURI;

    event Minted(address indexed to, uint256 tokenId);

    constructor(string memory baseURI_) ERC721("ILMT", "ILMT") {
        baseURI = baseURI_;

        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                DOMAIN_NAME,
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function setBaseURI(string memory baseURI_) external onlyOwner {
        baseURI = baseURI_;
    }

    function mint(address to) external onlyOwner returns (uint256) {
        require(to != address(0), "ilmtNFT: Zero address");
        uint256 tokenId = totalSupply + 1;
        _safeMint(to, totalSupply);
        totalSupply += 1;
        emit Minted(to, totalSupply);

        return tokenId;
    }

    function permitMint(
        address to,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256) {
        require(to != address(0), "ilmtNFT: Zero address");
        uint256 nonce = nonces[msg.sender];

        uint256 tokenId = totalSupply + 1;
        bytes32 digest = buildClaimSeparator(to, tokenId, nonce);
        require(!used[digest], "ilmtNFT:Invalid Digest");
        used[digest] = true;
        nonces[msg.sender] += 1;

        address signer = ecrecover(digest, v, r, s);
        require(signer == owner(), "ilmtNFT:Invalid signatures");

        _safeMint(to, tokenId);
        totalSupply += 1;

        emit Minted(to, tokenId);

        return tokenId;
    }

    function buildClaimSeparator(
        address to,
        uint256 tokenId,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR,
                    keccak256(abi.encode(CLAIM_TYPEHASH, to, tokenId, nonce))
                )
            );
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireMinted(tokenId);
        return baseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }
}
