// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title ilmtStakingFixed
 * @dev Secure staking contract with fixed lockup periods and unbonding for early withdrawals
 */
contract ilmtStakingFixed is Ownable, Pausable, ReentrancyGuard {
    IERC20 public immutable stakingToken;
    uint256 public totalStaked;
    uint256 public unbondingPeriod; // Waiting period for early unstake (in seconds)

    struct Stake {
        uint256 amount;
        uint256 since;
        uint256 lastClaimedTimestamp;
    }

    struct Pool {
        address rewardToken;
        uint256 totalStaked;
        uint256 rewardRate; // Percentage per lockup period (e.g., 10 = 10%)
        uint256 lockupPeriod;
        uint256 maxStakingAmount;
        bool isActive;
    }

    struct UnbondingRequest {
        uint256 amount;
        uint256 availableAt; // When tokens will be available
        bool claimed;
    }

    Pool[] public pools;
    
    // user => poolId => Stake
    mapping(address => mapping(uint256 => Stake)) public stakes;
    
    // user => poolId => UnbondingRequest for early unstake
    mapping(address => mapping(uint256 => UnbondingRequest)) public unbondingRequests;
    
    // Events
    event Staked(address indexed user, uint256 indexed poolId, uint256 amount);
    event Unstaked(address indexed user, uint256 indexed poolId, uint256 amount);
    event RewardClaimed(address indexed user, uint256 indexed poolId, uint256 reward);
    event PoolAdded(
        uint256 indexed poolId,
        address indexed rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 maxStakingAmount
    );
    event PoolStatusUpdated(uint256 indexed poolId, bool isActive);
    event EmergencyWithdraw(address indexed user, uint256 indexed poolId, uint256 amount);
    event EarlyUnstakeRequested(address indexed user, uint256 indexed poolId, uint256 amount, uint256 availableAt);
    event UnbondingClaimed(address indexed user, uint256 indexed poolId, uint256 amount);
    event UnbondingPeriodUpdated(uint256 newPeriod);

    constructor(address _stakingToken) {
        require(_stakingToken != address(0), "Invalid token address");
        stakingToken = IERC20(_stakingToken);
        unbondingPeriod = 7 days; // Default 7 days unbonding period
    }

    // ============ User Functions ============

    function stake(
        uint256 poolId,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(poolId < pools.length, "Invalid pool ID");
        require(pools[poolId].isActive, "Pool is not active");
        require(amount > 0, "Amount must be greater than 0");
        
        Stake storage userStake = stakes[msg.sender][poolId];
        require(
            userStake.amount + amount <= pools[poolId].maxStakingAmount,
            "Exceeds maximum staking limit"
        );

        // Transfer tokens first (CEI pattern)
        require(
            stakingToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );

        // If this is the first stake, set the timestamp
        if (userStake.amount == 0) {
            userStake.since = block.timestamp;
            userStake.lastClaimedTimestamp = block.timestamp;
        }

        // Update state
        userStake.amount += amount;
        pools[poolId].totalStaked += amount;
        totalStaked += amount;

        emit Staked(msg.sender, poolId, amount);
    }

    function unstake(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        require(
            block.timestamp >= userStake.since + pools[poolId].lockupPeriod,
            "Tokens are still locked"
        );

        uint256 stakedAmount = userStake.amount;
        uint256 reward = _calculatePendingReward(msg.sender, poolId);

        // Update state first (CEI pattern)
        userStake.amount = 0;
        userStake.since = 0;
        userStake.lastClaimedTimestamp = 0;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;

        // Then perform external calls
        if (reward > 0) {
            require(
                IERC20(pools[poolId].rewardToken).transfer(msg.sender, reward),
                "Reward transfer failed"
            );
        }
        
        require(
            stakingToken.transfer(msg.sender, stakedAmount),
            "Stake transfer failed"
        );

        emit Unstaked(msg.sender, poolId, stakedAmount);
        if (reward > 0) {
            emit RewardClaimed(msg.sender, poolId, reward);
        }
    }

    function claimReward(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        
        uint256 reward = _calculatePendingReward(msg.sender, poolId);
        require(reward > 0, "No rewards to claim");

        // Update last claimed timestamp
        userStake.lastClaimedTimestamp = block.timestamp;

        // Transfer rewards
        require(
            IERC20(pools[poolId].rewardToken).transfer(msg.sender, reward),
            "Reward transfer failed"
        );

        emit RewardClaimed(msg.sender, poolId, reward);
    }

    function emergencyWithdraw(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");

        uint256 stakedAmount = userStake.amount;

        // Update state first
        userStake.amount = 0;
        userStake.since = 0;
        userStake.lastClaimedTimestamp = 0;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;

        // Transfer tokens (no rewards in emergency withdraw)
        require(
            stakingToken.transfer(msg.sender, stakedAmount),
            "Transfer failed"
        );

        emit EmergencyWithdraw(msg.sender, poolId, stakedAmount);
    }

    // ============ Unbonding Functions ============

    function requestEarlyUnstake(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        require(
            block.timestamp < userStake.since + pools[poolId].lockupPeriod,
            "Already unlocked, use regular unstake"
        );
        
        UnbondingRequest storage unbondingRequest = unbondingRequests[msg.sender][poolId];
        require(unbondingRequest.amount == 0, "Unbonding request already exists");

        uint256 stakedAmount = userStake.amount;
        uint256 availableAt = block.timestamp + unbondingPeriod;

        // Update state - remove from staking
        userStake.amount = 0;
        userStake.since = 0;
        userStake.lastClaimedTimestamp = 0;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;

        // Create unbonding request
        unbondingRequest.amount = stakedAmount;
        unbondingRequest.availableAt = availableAt;
        unbondingRequest.claimed = false;

        emit EarlyUnstakeRequested(msg.sender, poolId, stakedAmount, availableAt);
    }

    function claimUnbonding(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        UnbondingRequest storage unbondingRequest = unbondingRequests[msg.sender][poolId];
        require(unbondingRequest.amount > 0, "No unbonding request");
        require(!unbondingRequest.claimed, "Already claimed");
        require(
            block.timestamp >= unbondingRequest.availableAt,
            "Unbonding period not finished"
        );

        uint256 amount = unbondingRequest.amount;
        unbondingRequest.claimed = true;

        // Transfer tokens
        require(
            stakingToken.transfer(msg.sender, amount),
            "Transfer failed"
        );

        emit UnbondingClaimed(msg.sender, poolId, amount);
    }

    // ============ View Functions ============

    function getPendingReward(
        address user,
        uint256 poolId
    ) external view returns (uint256) {
        return _calculatePendingReward(user, poolId);
    }

    function getStakeInfo(
        address user,
        uint256 poolId
    ) external view returns (
        uint256 amount,
        uint256 since,
        uint256 lastClaimedTimestamp,
        uint256 pendingReward
    ) {
        Stake memory userStake = stakes[user][poolId];
        return (
            userStake.amount,
            userStake.since,
            userStake.lastClaimedTimestamp,
            _calculatePendingReward(user, poolId)
        );
    }

    function getPoolsLength() external view returns (uint256) {
        return pools.length;
    }

    function getUnbondingInfo(
        address user,
        uint256 poolId
    ) external view returns (
        uint256 amount,
        uint256 availableAt,
        bool claimed,
        uint256 timeLeft
    ) {
        require(poolId < pools.length, "Invalid pool ID");
        UnbondingRequest memory request = unbondingRequests[user][poolId];
        
        uint256 timeLeft = 0;
        if (request.availableAt > block.timestamp) {
            timeLeft = request.availableAt - block.timestamp;
        }
        
        return (
            request.amount,
            request.availableAt,
            request.claimed,
            timeLeft
        );
    }

    function getTimeUntilUnlock(
        address user,
        uint256 poolId
    ) external view returns (uint256) {
        require(poolId < pools.length, "Invalid pool ID");
        Stake memory userStake = stakes[user][poolId];
        
        if (userStake.amount == 0) return 0;
        
        uint256 unlockTime = userStake.since + pools[poolId].lockupPeriod;
        if (block.timestamp >= unlockTime) return 0;
        
        return unlockTime - block.timestamp;
    }

    // ============ Admin Functions ============

    function addPool(
        address rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 maxStakingAmount
    ) external onlyOwner {
        require(rewardToken != address(0), "Invalid reward token");
        require(rewardRate > 0 && rewardRate <= 100, "Invalid reward rate");
        require(lockupPeriod > 0, "Invalid lockup period");
        require(maxStakingAmount > 0, "Invalid max staking amount");

        pools.push(
            Pool({
                rewardToken: rewardToken,
                totalStaked: 0,
                rewardRate: rewardRate,
                lockupPeriod: lockupPeriod,
                maxStakingAmount: maxStakingAmount,
                isActive: true
            })
        );

        emit PoolAdded(
            pools.length - 1,
            rewardToken,
            rewardRate,
            lockupPeriod,
            maxStakingAmount
        );
    }

    function setPoolStatus(uint256 poolId, bool isActive) external onlyOwner {
        require(poolId < pools.length, "Invalid pool ID");
        pools[poolId].isActive = isActive;
        emit PoolStatusUpdated(poolId, isActive);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setUnbondingPeriod(uint256 _unbondingPeriod) external onlyOwner {
        require(_unbondingPeriod > 0, "Unbonding period must be > 0");
        unbondingPeriod = _unbondingPeriod;
        emit UnbondingPeriodUpdated(_unbondingPeriod);
    }

    function withdrawTokens(
        address _token,
        uint256 _amount
    ) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        
        if (_token == address(stakingToken)) {
            // Ensure we don't withdraw staked tokens
            uint256 contractBalance = stakingToken.balanceOf(address(this));
            require(
                contractBalance >= totalStaked + _amount,
                "Insufficient balance"
            );
        }

        require(
            IERC20(_token).transfer(msg.sender, _amount),
            "Transfer failed"
        );
    }

    // ============ Internal Functions ============

    function _calculatePendingReward(
        address user,
        uint256 poolId
    ) internal view returns (uint256) {
        if (poolId >= pools.length) return 0;
        
        Stake memory userStake = stakes[user][poolId];
        if (userStake.amount == 0) return 0;

        Pool memory pool = pools[poolId];
        
        // Calculate time eligible for rewards
        uint256 timeStaked = block.timestamp - userStake.since;
        if (timeStaked < pool.lockupPeriod) return 0;

        // Calculate time since last claim
        uint256 timeSinceLastClaim = block.timestamp - userStake.lastClaimedTimestamp;
        
        // Calculate reward based on time since last claim
        // Reward = (amount * rewardRate * timeSinceLastClaim) / (lockupPeriod * 100)
        // This ensures rewards are proportional to time held after lockup
        return (userStake.amount * pool.rewardRate * timeSinceLastClaim) / 
               (pool.lockupPeriod * 100);
    }
} 