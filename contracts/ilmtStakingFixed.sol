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
    uint256 public totalActiveStakers; // Total number of active stakers across all pools
    uint256 public emergencyPenaltyRate; // Emergency withdraw penalty in basis points (default: 1000 = 10%)
    
    // Constants
    uint256 public constant BASIS_POINTS = 10000; // 100% = 10,000 basis points
    uint256 public constant MAX_EMERGENCY_PENALTY = 1000; // Maximum 10% emergency penalty
    uint256 public constant MIN_STAKE_AMOUNT = 1e18; // Minimum 1 token to stake

    struct Stake {
        uint256 amount;
        uint256 since;
        uint256 lastClaimedTimestamp;
        bool rewardsActive; // Track if rewards are still active for this stake
    }

    struct Pool {
        address rewardToken;
        uint256 totalStaked;
        uint256 rewardRate; // Reward rate in basis points per lockup period (e.g., 1000 = 10%, 250 = 2.5%)
        uint256 lockupPeriod;
        uint256 maxStakingAmount;
        bool isActive;
        uint256 activeStakers; // Number of active stakers in this pool
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
    
    // Track if user is active in any pool (to avoid double counting)
    mapping(address => bool) public isActiveStaker;
    
    // Track user's active pools count
    mapping(address => uint256) public userActivePoolsCount;
    
    // Events
    event Staked(address indexed user, uint256 indexed poolId, uint256 amount);
    event Unstaked(address indexed user, uint256 indexed poolId, uint256 amount);
    event RewardClaimed(address indexed user, uint256 indexed poolId, uint256 reward);
    event Restaked(address indexed user, uint256 indexed poolId, uint256 stakedAmount, uint256 rewardAmount, uint256 totalRestaked);
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
    event EmergencyPenaltyUpdated(uint256 newPenaltyRate);

    constructor(address _stakingToken) {
        require(_stakingToken != address(0), "Invalid token address");
        stakingToken = IERC20(_stakingToken);
        unbondingPeriod = 7 days; // Default 7 days unbonding period
        emergencyPenaltyRate = 1000; // Default 10% emergency penalty
    }

    // ============ User Functions ============

    function stake(
        uint256 poolId,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(poolId < pools.length, "Invalid pool ID");
        require(pools[poolId].isActive, "Pool is not active");
        require(amount >= MIN_STAKE_AMOUNT, "Amount below minimum stake");
        
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

        // Track new stakers
        bool isNewStaker = false;
        bool isNewPoolStaker = false;
        
        // If this is the first stake in any pool for this user
        if (!isActiveStaker[msg.sender]) {
            isActiveStaker[msg.sender] = true;
            totalActiveStakers++;
            isNewStaker = true;
        }
        
        // If this is the first stake in this specific pool
        if (userStake.amount == 0) {
            userStake.since = block.timestamp;
            userStake.lastClaimedTimestamp = block.timestamp;
            userStake.rewardsActive = true;
            pools[poolId].activeStakers++;
            userActivePoolsCount[msg.sender]++;
            isNewPoolStaker = true;
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
        userStake.rewardsActive = false;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;
        
        // Update staker tracking
        pools[poolId].activeStakers--;
        userActivePoolsCount[msg.sender]--;
        
        // If user has no more active pools, remove from global active stakers
        if (userActivePoolsCount[msg.sender] == 0) {
            isActiveStaker[msg.sender] = false;
            totalActiveStakers--;
        }

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

        // Update last claimed timestamp and STOP future rewards
        userStake.lastClaimedTimestamp = block.timestamp;
        userStake.rewardsActive = false; // Stop rewards after claiming - must restake to reactivate

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
        userStake.rewardsActive = false;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;
        
        // Update staker tracking
        pools[poolId].activeStakers--;
        userActivePoolsCount[msg.sender]--;
        
        // If user has no more active pools, remove from global active stakers
        if (userActivePoolsCount[msg.sender] == 0) {
            isActiveStaker[msg.sender] = false;
            totalActiveStakers--;
        }

        // Calculate emergency penalty
        uint256 penalty = (stakedAmount * emergencyPenaltyRate) / BASIS_POINTS;
        uint256 withdrawAmount = stakedAmount - penalty;

        // Transfer tokens (minus penalty, no rewards)
        require(
            stakingToken.transfer(msg.sender, withdrawAmount),
            "Transfer failed"
        );
        
        // Penalty stays in contract for treasury

        emit EmergencyWithdraw(msg.sender, poolId, withdrawAmount);
    }

    function restake(uint256 poolId, bool includeRewards) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        require(pools[poolId].isActive, "Pool is not active");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        require(
            block.timestamp >= userStake.since + pools[poolId].lockupPeriod,
            "Tokens are still locked"
        );

        uint256 currentStakedAmount = userStake.amount;
        uint256 pendingReward = _calculatePendingReward(msg.sender, poolId);
        uint256 totalRestakeAmount = currentStakedAmount;
        uint256 rewardToRestake = 0;

        if (includeRewards && pendingReward > 0) {
            // Check if reward token is the same as staking token
            if (pools[poolId].rewardToken == address(stakingToken)) {
                rewardToRestake = pendingReward;
                totalRestakeAmount += rewardToRestake;
            } else {
                // If different tokens, claim rewards separately and only restake original amount
                require(
                    IERC20(pools[poolId].rewardToken).transfer(msg.sender, pendingReward),
                    "Reward transfer failed"
                );
                emit RewardClaimed(msg.sender, poolId, pendingReward);
            }
        } else if (pendingReward > 0 && !includeRewards) {
            // Claim rewards without including in restake
            require(
                IERC20(pools[poolId].rewardToken).transfer(msg.sender, pendingReward),
                "Reward transfer failed"
            );
            emit RewardClaimed(msg.sender, poolId, pendingReward);
        }

        // Check max staking limit for total restake amount
        require(
            totalRestakeAmount <= pools[poolId].maxStakingAmount,
            "Restake amount exceeds maximum staking limit"
        );

        // Reset staking period and update amounts
        userStake.amount = totalRestakeAmount;
        userStake.since = block.timestamp;
        userStake.lastClaimedTimestamp = block.timestamp;
        userStake.rewardsActive = true; // Reactivate rewards when restaking
        
        // Update pool totals (remove old amount, add new amount)
        pools[poolId].totalStaked = pools[poolId].totalStaked - currentStakedAmount + totalRestakeAmount;
        totalStaked = totalStaked - currentStakedAmount + totalRestakeAmount;

        emit Restaked(msg.sender, poolId, currentStakedAmount, rewardToRestake, totalRestakeAmount);
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
        userStake.rewardsActive = false;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;
        
        // Update staker tracking
        pools[poolId].activeStakers--;
        userActivePoolsCount[msg.sender]--;
        
        // If user has no more active pools, remove from global active stakers
        if (userActivePoolsCount[msg.sender] == 0) {
            isActiveStaker[msg.sender] = false;
            totalActiveStakers--;
        }

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
        bool rewardsActive, // New field to track if rewards are still active
        uint256 pendingReward
    ) {
        Stake memory userStake = stakes[user][poolId];
        return (
            userStake.amount,
            userStake.since,
            userStake.lastClaimedTimestamp,
            userStake.rewardsActive,
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
        
        uint256 timeRemaining = 0;
        if (request.availableAt > block.timestamp) {
            timeRemaining = request.availableAt - block.timestamp;
        }
        
        return (
            request.amount,
            request.availableAt,
            request.claimed,
            timeRemaining
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

    function getRestakeInfo(
        address user,
        uint256 poolId
    ) external view returns (
        bool canRestake,
        uint256 currentStakedAmount,
        uint256 pendingReward,
        uint256 maxRestakeAmount,
        bool rewardTokenSameAsStaking
    ) {
        require(poolId < pools.length, "Invalid pool ID");
        Stake memory userStake = stakes[user][poolId];
        
        if (userStake.amount == 0) {
            return (false, 0, 0, 0, false);
        }
        
        bool unlocked = block.timestamp >= userStake.since + pools[poolId].lockupPeriod;
        bool poolActive = pools[poolId].isActive;
        uint256 reward = _calculatePendingReward(user, poolId);
        bool sameToken = pools[poolId].rewardToken == address(stakingToken);
        
        uint256 maxPossibleRestake = userStake.amount;
        if (sameToken && reward > 0) {
            maxPossibleRestake += reward;
        }
        
        // Check if max restake would exceed pool limit
        bool withinLimit = maxPossibleRestake <= pools[poolId].maxStakingAmount;
        
        return (
            unlocked && poolActive && withinLimit,
            userStake.amount,
            reward,
            maxPossibleRestake,
            sameToken
        );
    }

    // ============ Statistics Functions ============

    function getTotalValueLocked() external view returns (uint256) {
        return totalStaked;
    }

    function getPoolTVL(uint256 poolId) external view returns (uint256) {
        require(poolId < pools.length, "Invalid pool ID");
        return pools[poolId].totalStaked;
    }

    function getTotalActiveStakers() external view returns (uint256) {
        return totalActiveStakers;
    }

    function getPoolActiveStakers(uint256 poolId) external view returns (uint256) {
        require(poolId < pools.length, "Invalid pool ID");
        return pools[poolId].activeStakers;
    }

    function getPoolStats(uint256 poolId) external view returns (
        uint256 poolTotalStaked,
        uint256 poolActiveStakers,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 maxStakingAmount,
        bool isActive,
        address rewardToken
    ) {
        require(poolId < pools.length, "Invalid pool ID");
        Pool memory pool = pools[poolId];
        
        return (
            pool.totalStaked,
            pool.activeStakers,
            pool.rewardRate,
            pool.lockupPeriod,
            pool.maxStakingAmount,
            pool.isActive,
            pool.rewardToken
        );
    }

    function getProtocolStats() external view returns (
        uint256 totalValueLocked,
        uint256 protocolActiveStakers,
        uint256 totalPools,
        uint256 activePools
    ) {
        uint256 activePoolCount = 0;
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i].isActive) {
                activePoolCount++;
            }
        }
        
        return (
            totalStaked,
            totalActiveStakers,
            pools.length,
            activePoolCount
        );
    }

    function getUserStats(address user) external view returns (
        uint256 totalStakedByUser,
        uint256 activePoolsCount,
        uint256 totalPendingRewards,
        bool isActive
    ) {
        uint256 userTotalStaked = 0;
        uint256 userTotalRewards = 0;
        
        for (uint256 i = 0; i < pools.length; i++) {
            Stake memory userStake = stakes[user][i];
            if (userStake.amount > 0) {
                userTotalStaked += userStake.amount;
                userTotalRewards += _calculatePendingReward(user, i);
            }
        }
        
        return (
            userTotalStaked,
            userActivePoolsCount[user],
            userTotalRewards,
            isActiveStaker[user]
        );
    }

    // ============ Admin Functions ============

    function addPool(
        address rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 maxStakingAmount
    ) external onlyOwner {
        require(rewardToken != address(0), "Invalid reward token");
        require(rewardRate > 0 && rewardRate <= BASIS_POINTS, "Invalid reward rate"); // Max 100% (10,000 bp)
        require(lockupPeriod > 0, "Invalid lockup period");
        require(maxStakingAmount > 0, "Invalid max staking amount");

        pools.push(
            Pool({
                rewardToken: rewardToken,
                totalStaked: 0,
                rewardRate: rewardRate,
                lockupPeriod: lockupPeriod,
                maxStakingAmount: maxStakingAmount,
                isActive: true,
                activeStakers: 0
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

    function setEmergencyPenalty(uint256 _penaltyRate) external onlyOwner {
        require(_penaltyRate <= MAX_EMERGENCY_PENALTY, "Penalty exceeds maximum");
        emergencyPenaltyRate = _penaltyRate;
        emit EmergencyPenaltyUpdated(_penaltyRate);
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
        if (!userStake.rewardsActive) return 0; // No rewards if rewards are deactivated

        Pool memory pool = pools[poolId];
        if (!pool.isActive) return 0; // No rewards if pool is deactivated
        
        // Calculate time eligible for rewards
        uint256 timeStaked = block.timestamp - userStake.since;
        if (timeStaked < pool.lockupPeriod) return 0;

        // Calculate time since last claim
        uint256 timeSinceLastClaim = block.timestamp - userStake.lastClaimedTimestamp;
        
        // Cap reward time to exactly one lockup period
        // This ensures users get exactly the promised reward rate, no more
        uint256 rewardTime = timeSinceLastClaim > pool.lockupPeriod ? pool.lockupPeriod : timeSinceLastClaim;
        
        // Calculate reward based on capped time
        // Reward = (amount * rewardRate * rewardTime) / (lockupPeriod * BASIS_POINTS)
        return (userStake.amount * pool.rewardRate * rewardTime) / 
               (pool.lockupPeriod * BASIS_POINTS);
    }
} 