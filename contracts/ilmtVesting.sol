// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title $ILMT Vesting

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);
}

/**
 * @dev Interface for the optional metadata functions from the ERC-20 standard.
 */
interface IERC20Metadata is IERC20 {
    /**
     * @dev Returns the name of the token.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);
}

// OpenZeppelin Contracts v4.4.1 (utils/Context.sol)

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}

// OpenZeppelin Contracts (last updated v4.7.0) (access/Ownable.sol)

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * By default, the owner account will be the one that deploys the contract. This
 * can later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    /**
     * @dev Initializes the contract setting the deployer as the initial owner.
     */
    constructor() {
        _transferOwnership(_msgSender());
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions anymore. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby removing any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(
            newOwner != address(0),
            "Ownable: new owner is the zero address"
        );
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

/**
 * @title ILMTVesting
 * @dev This contract manages the vesting of $ILMT tokens for designated beneficiaries. It supports multiple vesting schedules for various stakeholders, including team members, advisors, and marketing and R&D personnel.
 * The contract allows the distribution of tokens over specified cliffs, ensuring that tokens are released over time rather than all at once.
 */
contract ILMTVesting is Ownable {
    // Defines a vesting schedule for a beneficiary
    struct VestingSchedule {
        uint256[] tokensPerCliff; // Amount of tokens to release at each cliff
        uint256[] cliffs; // Timestamps when each token release (cliff) occurs
        uint lastCliffClaimed; // The index of the last cliff that was claimed
    }

    // Maps a beneficiary's address to their vesting schedule
    mapping(address => VestingSchedule) private vestingSchedules;

    // The contract address of the $ILMT token
    address public tokenContract;

    /**
     * @dev Constructor that initializes the contract. It can optionally set up initial vesting schedules.
     */
    constructor() {
        // tokenContract = ;

        /*

        Minting the amount released at TGE to the respective wallets and minting the vested amount to the vesting contract

        Some phases like SEED & PRIVATE will be distributed between various addresses, so we establish no vesting schedule initially and allow the owner to set further down the line
        */

    }

    /**
     * @notice Retrieves the vesting schedule for a beneficiary.
     * @param beneficiary The address of the beneficiary whose vesting schedule is being queried.
     * @return The vesting schedule of the specified beneficiary.
     */
    function getVestingSchedule(
        address beneficiary
    ) external view returns (VestingSchedule memory) {
        return vestingSchedules[beneficiary];
    }

    /**
     * @notice Adds or updates a vesting schedule for multiple beneficiaries. Only callable by the contract owner.
     * @param receivers An array of addresses for the beneficiaries.
     * @param tokens An array of token amounts to be released per cliff.
     * @param cliffs An array of timestamps for each cliff.
     */
    function addVestingSchedule(
        address[] memory receivers,
        uint256[] memory tokens,
        uint256[] memory cliffs
    ) external onlyOwner {
        require(tokens.length == cliffs.length, "Array sizes do not match!");

        for (uint i = 0; i < receivers.length; i++) {
            require(
                vestingSchedules[receivers[i]].tokensPerCliff.length == 0 ||
                    vestingSchedules[receivers[i]].lastCliffClaimed ==
                    vestingSchedules[receivers[i]].cliffs.length,
                "Vesting Schedule already active!"
            );

            vestingSchedules[receivers[i]].tokensPerCliff = tokens;
            vestingSchedules[receivers[i]].cliffs = cliffs;
        }
    }

    /**
     * @notice Calculates the total amount of vested tokens available for a beneficiary to claim.
     * @param beneficiary The address of the beneficiary.
     * @return The total amount of tokens that the beneficiary can currently claim.
     */
    function vestedTokensAvailable(
        address beneficiary
    ) external view returns (uint256) {
        (uint256 availableTokens, ) = vestedTokensAvailable_(beneficiary);
        return availableTokens;
    }

    /**
     * @dev Internal function to calculate vested tokens and the last cliff reached. Used by `vestedTokensAvailable` and `claimVestedTokens`.
     * @param beneficiary The address of the beneficiary.
     * @return availableTokens The total amount of vested tokens available for claim.
     * @return lastCliff The index of the last cliff reached.
     */
    function vestedTokensAvailable_(
        address beneficiary
    ) internal view returns (uint256, uint) {
        VestingSchedule memory vestingSchedule_ = vestingSchedules[beneficiary];
        uint256 availableTokens = 0;
        uint lastCliff = vestingSchedule_.cliffs.length;
        for (uint i = vestingSchedule_.lastCliffClaimed; i < lastCliff; i++) {
            if (block.timestamp >= vestingSchedule_.cliffs[i]) {
                availableTokens += vestingSchedule_.tokensPerCliff[i];
            } else {
                lastCliff = i;
                if (lastCliff > 0) {
                    availableTokens +=
                        (((vestingSchedule_.cliffs[i] - block.timestamp) /
                            1 days) * vestingSchedule_.tokensPerCliff[i]) /
                        ((vestingSchedule_.cliffs[i] -
                            vestingSchedule_.cliffs[i - 1]) / 1 days);
                }
                break;
            }
        }
        return (availableTokens, lastCliff);
    }

    /**
     * @notice Allows a beneficiary to claim their vested tokens.
     * @dev Transfers the available vested tokens to the beneficiary. Updates the last cliff claimed to prevent double claiming.
     * @param claimer The address of the beneficiary claiming their tokens.
     */
    function claimVestedTokens(address claimer) external {
        (uint256 availableTokens, uint lastCliff) = vestedTokensAvailable_(
            claimer
        );
        require(availableTokens > 0, "No tokens available to claim!");

        vestingSchedules[claimer].lastCliffClaimed = lastCliff;
        require(
            IERC20(tokenContract).transfer(claimer, availableTokens),
            "Unsuccessful Transfer!"
        );
    }

    /// Administrative functions

    /**
     * @notice Sets the contract address for the $ILMT token. Only callable by the contract owner.
     * @param newContract The new contract address for the $ILMT token.
     */
    function setTokenContract(address newContract) external onlyOwner {
        require(newContract != address(0), "Invalid Address!");
        tokenContract = newContract;
    }

    /**
     * @notice Allows the owner to withdraw Ether from the contract. Only callable by the contract owner.
     * @param recipient The address to receive the Ether.
     * @param amount The amount of Ether to withdraw.
     */
    function withdraw(address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid Address!");
        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "Failed to send Ether");
    }

    /**
     * @notice Allows the owner to withdraw tokens from the contract. Only callable by the contract owner.
     * @param recipient The address to receive the tokens.
     * @param amount The amount of tokens to withdraw.
     * @param token The contract address of the token to withdraw.
     */
    function withdraw(
        address recipient,
        uint256 amount,
        address token
    ) external onlyOwner {
        require(recipient != address(0), "Invalid Address!");
        require(amount > 0, "Invalid Amount!");
        require(token != address(0), "Invalid Token!");
        require(
            IERC20(token).transfer(recipient, amount),
            "Unsuccessful Transfer!"
        );
    }
}
