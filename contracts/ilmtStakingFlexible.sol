// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title ilmtStakingFlexible
 * @dev Flexible staking contract with daily rewards and cooldown period for unstaking
 */
contract ilmtStakingFlexible is Ownable, Pausable, ReentrancyGuard {
    IERC20 public immutable stakingToken;
    uint256 public totalStaked;
    uint256 public cooldownPeriod; // Cooldown period for unstaking (in seconds)
    uint256 public totalActiveStakers; // Total number of active stakers across all pools

    struct Stake {
        uint256 amount;
        uint256 since; // When staking started
        uint256 lastClaimedTimestamp; // Last time rewards were claimed
    }

    struct Pool {
        address rewardToken;
        uint256 totalStaked;
        uint256 dailyRewardRate; // Daily reward rate (e.g., 100 = 1% per day)
        uint256 maxStakingAmount;
        bool isActive;
        uint256 activeStakers; // Number of active stakers in this pool
    }

    struct CooldownRequest {
        uint256 amount;
        uint256 availableAt; // When tokens will be available for withdrawal
        bool claimed;
    }

    Pool[] public pools;
    
    // user => poolId => Stake
    mapping(address => mapping(uint256 => Stake)) public stakes;
    
    // user => poolId => CooldownRequest for unstaking
    mapping(address => mapping(uint256 => CooldownRequest)) public cooldownRequests;
    
    // Track if user is active in any pool (to avoid double counting)
    mapping(address => bool) public isActiveStaker;
    
    // Track user's active pools count
    mapping(address => uint256) public userActivePoolsCount;
    
    // Events
    event Staked(address indexed user, uint256 indexed poolId, uint256 amount);
    event Unstaked(address indexed user, uint256 indexed poolId, uint256 amount);
    event RewardClaimed(address indexed user, uint256 indexed poolId, uint256 reward);
    event PoolAdded(
        uint256 indexed poolId,
        address indexed rewardToken,
        uint256 dailyRewardRate,
        uint256 maxStakingAmount
    );
    event PoolStatusUpdated(uint256 indexed poolId, bool isActive);
    event EmergencyWithdraw(address indexed user, uint256 indexed poolId, uint256 amount);
    event CooldownRequested(address indexed user, uint256 indexed poolId, uint256 amount, uint256 availableAt);
    event CooldownClaimed(address indexed user, uint256 indexed poolId, uint256 amount);
    event CooldownPeriodUpdated(uint256 newPeriod);
    event RewardCompounded(address indexed user, uint256 indexed poolId, uint256 reward);

    constructor(address _stakingToken) {
        require(_stakingToken != address(0), "Invalid token address");
        stakingToken = IERC20(_stakingToken);
        cooldownPeriod = 10 days; // Default 10 days cooldown period
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

    function requestUnstake(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        
        CooldownRequest storage cooldownRequest = cooldownRequests[msg.sender][poolId];
        require(cooldownRequest.amount == 0, "Cooldown request already exists");

        uint256 stakedAmount = userStake.amount;
        uint256 availableAt = block.timestamp + cooldownPeriod;

        // Calculate and auto-claim pending rewards before unstaking
        uint256 pendingReward = _calculatePendingReward(msg.sender, poolId);
        if (pendingReward > 0) {
            require(
                IERC20(pools[poolId].rewardToken).transfer(msg.sender, pendingReward),
                "Reward transfer failed"
            );
            emit RewardClaimed(msg.sender, poolId, pendingReward);
        }

        // Update state - remove from staking
        userStake.amount = 0;
        userStake.since = 0;
        userStake.lastClaimedTimestamp = 0;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;
        
        // Update staker counts
        pools[poolId].activeStakers--;
        userActivePoolsCount[msg.sender]--;
        
        // If user has no more active stakes in any pool, remove from total count
        if (userActivePoolsCount[msg.sender] == 0) {
            isActiveStaker[msg.sender] = false;
            totalActiveStakers--;
        }

        // Create cooldown request
        cooldownRequest.amount = stakedAmount;
        cooldownRequest.availableAt = availableAt;
        cooldownRequest.claimed = false;

        emit CooldownRequested(msg.sender, poolId, stakedAmount, availableAt);
    }

    function claimUnstake(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "Invalid pool ID");
        CooldownRequest storage cooldownRequest = cooldownRequests[msg.sender][poolId];
        require(cooldownRequest.amount > 0, "No cooldown request");
        require(!cooldownRequest.claimed, "Already claimed");
        require(
            block.timestamp >= cooldownRequest.availableAt,
            "Cooldown period not finished"
        );

        uint256 amount = cooldownRequest.amount;
        cooldownRequest.claimed = true;

        // Transfer tokens
        require(
            stakingToken.transfer(msg.sender, amount),
            "Transfer failed"
        );

        emit CooldownClaimed(msg.sender, poolId, amount);
        emit Unstaked(msg.sender, poolId, amount);
    }

    /**
     * @dev Claim rewards and automatically re-stake them (compound)
     * @param poolId Pool identifier
     */
    function compoundRewards(uint256 poolId) external nonReentrant whenNotPaused {
        require(poolId < pools.length, "Invalid pool ID");
        require(pools[poolId].isActive, "Pool is not active");
        
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        
        uint256 reward = _calculatePendingReward(msg.sender, poolId);
        require(reward > 0, "No rewards to compound");

        // Check if compounding would exceed max staking limit
        require(
            userStake.amount + reward <= pools[poolId].maxStakingAmount,
            "Compounding would exceed maximum staking limit"
        );

        // Update last claimed timestamp (same as claimReward)
        userStake.lastClaimedTimestamp = block.timestamp;

        // Add rewards to stake (auto-compound)
        userStake.amount += reward;
        pools[poolId].totalStaked += reward;
        totalStaked += reward;

        emit RewardClaimed(msg.sender, poolId, reward);
        emit Staked(msg.sender, poolId, reward); // Also emit staked event for compounding
        emit RewardCompounded(msg.sender, poolId, reward);
    }

    /**
     * @dev Claim rewards with option to auto-compound
     * @param poolId Pool identifier
     * @param autoCompound If true, automatically re-stake rewards
     */
    function claimRewardWithOption(
        uint256 poolId, 
        bool autoCompound
    ) external nonReentrant whenNotPaused {
        require(poolId < pools.length, "Invalid pool ID");
        require(pools[poolId].isActive, "Pool is not active");
        
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "No tokens staked");
        
        uint256 reward = _calculatePendingReward(msg.sender, poolId);
        require(reward > 0, "No rewards to claim/compound");

        // Update last claimed timestamp
        userStake.lastClaimedTimestamp = block.timestamp;

        if (autoCompound) {
            // Check if compounding would exceed max staking limit
            require(
                userStake.amount + reward <= pools[poolId].maxStakingAmount,
                "Compounding would exceed maximum staking limit"
            );

            // Add rewards to stake (auto-compound)
            userStake.amount += reward;
            pools[poolId].totalStaked += reward;
            totalStaked += reward;

            emit RewardClaimed(msg.sender, poolId, reward);
            emit Staked(msg.sender, poolId, reward); // Also emit staked event for compounding
            emit RewardCompounded(msg.sender, poolId, reward);
        } else {
            // Transfer rewards to user
            require(
                IERC20(pools[poolId].rewardToken).transfer(msg.sender, reward),
                "Reward transfer failed"
            );

            emit RewardClaimed(msg.sender, poolId, reward);
        }
    }



    /**
     * @dev Get potential compounded amount (current stake + pending rewards)
     * @param user User address
     * @param poolId Pool identifier
     * @return Current stake amount plus pending rewards
     */
    function getCompoundedAmount(
        address user,
        uint256 poolId
    ) external view returns (uint256) {
        if (poolId >= pools.length) return 0;
        
        Stake memory userStake = stakes[user][poolId];
        if (userStake.amount == 0) return 0;

        uint256 pendingReward = _calculatePendingReward(user, poolId);
        return userStake.amount + pendingReward;
    }

    /**
     * @dev Check if user can compound rewards (won't exceed max limit)
     * @param user User address  
     * @param poolId Pool identifier
     * @return Whether compounding is possible
     */
    function canCompoundRewards(
        address user,
        uint256 poolId
    ) external view returns (bool) {
        if (poolId >= pools.length) return false;
        if (!pools[poolId].isActive) return false;
        
        Stake memory userStake = stakes[user][poolId];
        if (userStake.amount == 0) return false;

        uint256 pendingReward = _calculatePendingReward(user, poolId);
        if (pendingReward == 0) return false;

        return (userStake.amount + pendingReward <= pools[poolId].maxStakingAmount);
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
        
        // Update staker counts for emergency withdraw
        pools[poolId].activeStakers--;
        userActivePoolsCount[msg.sender]--;
        
        // If user has no more active stakes in any pool, remove from total count
        if (userActivePoolsCount[msg.sender] == 0) {
            isActiveStaker[msg.sender] = false;
            totalActiveStakers--;
        }

        // Transfer tokens (no rewards in emergency withdraw)
        require(
            stakingToken.transfer(msg.sender, stakedAmount),
            "Transfer failed"
        );

        emit EmergencyWithdraw(msg.sender, poolId, stakedAmount);
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

    function getCooldownInfo(
        address user,
        uint256 poolId
    ) external view returns (
        uint256 amount,
        uint256 availableAt,
        bool claimed,
        uint256 timeLeft
    ) {
        require(poolId < pools.length, "Invalid pool ID");
        CooldownRequest memory request = cooldownRequests[user][poolId];
        
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

    function getDailyReward(
        address user,
        uint256 poolId
    ) external view returns (uint256) {
        if (poolId >= pools.length) return 0;
        
        Stake memory userStake = stakes[user][poolId];
        if (userStake.amount == 0) return 0;

        Pool memory pool = pools[poolId];
        
        // Calculate daily reward: (amount * dailyRewardRate) / 10000
        return (userStake.amount * pool.dailyRewardRate) / 10000;
    }

    // ============ Statistics Functions ============

    /**
     * @dev Get total value locked across all pools
     * @return Total amount of tokens staked
     */
    function getTotalValueLocked() external view returns (uint256) {
        return totalStaked;
    }

    /**
     * @dev Get total value locked in a specific pool
     * @param poolId Pool identifier
     * @return Total amount of tokens staked in the pool
     */
    function getPoolTVL(uint256 poolId) external view returns (uint256) {
        require(poolId < pools.length, "Invalid pool ID");
        return pools[poolId].totalStaked;
    }

    /**
     * @dev Get total number of active stakers across all pools
     * @return Number of unique active stakers
     */
    function getTotalActiveStakers() external view returns (uint256) {
        return totalActiveStakers;
    }

    /**
     * @dev Get number of active stakers in a specific pool
     * @param poolId Pool identifier
     * @return Number of active stakers in the pool
     */
    function getPoolActiveStakers(uint256 poolId) external view returns (uint256) {
        require(poolId < pools.length, "Invalid pool ID");
        return pools[poolId].activeStakers;
    }

    /**
     * @dev Get comprehensive pool statistics
     * @param poolId Pool identifier
     * @return poolTotalStaked Total value locked in pool
     * @return activeStakers Number of active stakers
     * @return dailyRewardRate Daily reward rate (basis points)
     * @return maxStakingAmount Maximum staking amount per user
     * @return isActive Whether pool is active
     */
    function getPoolStats(uint256 poolId) external view returns (
        uint256 poolTotalStaked,
        uint256 activeStakers,
        uint256 dailyRewardRate,
        uint256 maxStakingAmount,
        bool isActive
    ) {
        require(poolId < pools.length, "Invalid pool ID");
        Pool memory pool = pools[poolId];
        
        return (
            pool.totalStaked,
            pool.activeStakers,
            pool.dailyRewardRate,
            pool.maxStakingAmount,
            pool.isActive
        );
    }

    /**
     * @dev Get global protocol statistics
     * @return totalValueLocked Total tokens staked across all pools
     * @return globalActiveStakers Total unique active stakers
     * @return totalPools Number of pools created
     */
    function getProtocolStats() external view returns (
        uint256 totalValueLocked,
        uint256 globalActiveStakers,
        uint256 totalPools
    ) {
        return (
            totalStaked,
            totalActiveStakers,
            pools.length
        );
    }

    // ============ Admin Functions ============

    function addPool(
        address rewardToken,
        uint256 dailyRewardRate,
        uint256 maxStakingAmount
    ) external onlyOwner {
        require(rewardToken != address(0), "Invalid reward token");
        require(dailyRewardRate > 0 && dailyRewardRate <= 1000, "Invalid daily reward rate"); // Max 10% per day
        require(maxStakingAmount > 0, "Invalid max staking amount");

        pools.push(
            Pool({
                rewardToken: rewardToken,
                totalStaked: 0,
                dailyRewardRate: dailyRewardRate,
                maxStakingAmount: maxStakingAmount,
                isActive: true,
                activeStakers: 0
            })
        );

        emit PoolAdded(
            pools.length - 1,
            rewardToken,
            dailyRewardRate,
            maxStakingAmount
        );
    }

    function setPoolStatus(uint256 poolId, bool isActive) external onlyOwner {
        require(poolId < pools.length, "Invalid pool ID");
        pools[poolId].isActive = isActive;
        emit PoolStatusUpdated(poolId, isActive);
    }

    function setCooldownPeriod(uint256 _cooldownPeriod) external onlyOwner {
        require(_cooldownPeriod > 0, "Cooldown period must be > 0");
        cooldownPeriod = _cooldownPeriod;
        emit CooldownPeriodUpdated(_cooldownPeriod);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
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
        
        // Calculate time since last claim in days
        uint256 timeSinceLastClaim = block.timestamp - userStake.lastClaimedTimestamp;
        uint256 daysSinceLastClaim = timeSinceLastClaim / 1 days;
        
        if (daysSinceLastClaim == 0) return 0;
        
        // Calculate reward: (amount * dailyRewardRate * days) / 10000
        return (userStake.amount * pool.dailyRewardRate * daysSinceLastClaim) / 10000;
    }
} 