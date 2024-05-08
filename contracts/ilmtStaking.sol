// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ilmtStaking is Ownable, Pausable, ReentrancyGuard {
    IERC20 public token;
    uint256 public totalStaked;

    struct Stake {
        uint256 poolId;
        uint256 amount;
        uint256 since;
    }

    struct Pool {
        address rewardToken;
        uint256 totalStaked;
        uint256 rewardRate;
        uint256 lockupPeriod;
        uint256 maxStakingAmount;
        bool isActive;
    }

    Pool[] public pools;
    mapping(address => mapping(uint256 => Stake)) public stakes;

    event Staked(address indexed user, uint256 indexed poolId, uint256 amount);
    event Unstaked(
        address indexed user,
        uint256 indexed poolId,
        uint256 amount
    );
    event RewardClaimed(
        address indexed user,
        uint256 indexed poolId,
        uint256 reward
    );
    event PoolAdded(
        uint256 indexed poolId,
        address indexed rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 maxStakingAmount
    );

    constructor(address _token) {
        token = IERC20(_token);
    }

    function stake(
        uint256 poolId,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(poolId < pools.length, "ilmtStaking: Invalid pool ID");
        require(pools[poolId].isActive, "ilmtStaking: Pool is not active");
        require(amount > 0, "ilmtStaking: Amount must be greater than 0");
        require(
            amount + stakes[msg.sender][poolId].amount <=
                pools[poolId].maxStakingAmount,
            "ilmtStaking: Staking amount exceeds maximum limit"
        );
        require(
            token.transferFrom(msg.sender, address(this), amount),
            "ilmtStaking: Transfer failed"
        );

        stakes[msg.sender][poolId].amount += amount;
        stakes[msg.sender][poolId].since = block.timestamp;
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
            "ilmtStaking: Tokens are still locked"
        );

        uint256 stakedAmount = userStake.amount;
        uint256 stakingDuration = block.timestamp - userStake.since;

        uint256 reward = _calculateReward(
            stakedAmount,
            pools[poolId].rewardRate,
            stakingDuration,
            pools[poolId].lockupPeriod
        );

        require(
            IERC20(pools[poolId].rewardToken).transfer(msg.sender, reward),
            "ilmtStaking: Reward transfer failed"
        );

        userStake.amount = 0;
        pools[poolId].totalStaked -= stakedAmount;
        totalStaked -= stakedAmount;
        require(
            token.transfer(msg.sender, stakedAmount),
            "ilmtStaking: Transfer failed"
        );

        emit Unstaked(msg.sender, poolId, stakedAmount);
    }

    function claimReward(uint256 poolId) external nonReentrant {
        require(poolId < pools.length, "ilmtStaking: Invalid pool ID");
        Stake storage userStake = stakes[msg.sender][poolId];
        require(userStake.amount > 0, "ilmtStaking: No tokens staked");
        require(
            block.timestamp >= userStake.since + pools[poolId].lockupPeriod,
            "ilmtStaking: Stake is still locked"
        );

        uint256 stakingDuration = block.timestamp - userStake.since;
        uint256 reward = _calculateReward(
            userStake.amount,
            pools[poolId].rewardRate,
            stakingDuration,
            pools[poolId].lockupPeriod
        );
        userStake.since = block.timestamp; // Resetting the staking timestamp

        require(
            IERC20(pools[poolId].rewardToken).transfer(msg.sender, reward),
            "ilmtStaking: Reward transfer failed"
        );
        emit RewardClaimed(msg.sender, poolId, reward);
    }

    function withdrawTokens(
        address _token,
        uint256 _amount
    ) external onlyOwner {
        require(
            _token != address(token) ||
                IERC20(_token).balanceOf(address(this)) >=
                _amount + totalStaked,
            "ilmtStaking: Insufficient Balance"
        );

        IERC20(_token).transfer(msg.sender, _amount);
    }

    function addPool(
        address rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 maxStakingAmount
    ) external onlyOwner {
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

    function getReward(
        uint256 poolId,
        address user
    ) public view returns (uint256) {
        require(poolId < pools.length, "ilmtStaking: Invalid pool ID");
        Stake memory userStake = stakes[user][poolId];
        if (userStake.amount == 0) return 0;
        return
            _calculateReward(
                userStake.amount,
                pools[poolId].rewardRate,
                block.timestamp - userStake.since,
                pools[poolId].lockupPeriod
            );
    }

    function _calculateReward(
        uint256 amount,
        uint256 rewardRate,
        uint256 stakedDuration,
        uint256 totalDuration
    ) internal pure returns (uint256) {
        return
            (amount * (rewardRate) * (stakedDuration)) /
            (totalDuration) /
            (100);
    }
}
