// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ilmtNFTStaking is ReentrancyGuard, AccessControl {
    struct Staker {
        uint64 amountStaked;
        uint64 stakeIdOflastUpdate;
        uint128 timeOfLastUpdate;
        uint256 unclaimedRewards;
    }

    struct StakingState {
        uint256 timeUnit;
        uint256 rewardsPerUnitTime;
        uint256 startTimestamp;
        uint256 endTimestamp;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public immutable stakingToken;

    address public immutable rewardToken;

    uint64 private nextStakeId;

    uint256[] public indexedTokens;

    address[] public stakersArray;

    mapping(uint256 => bool) public isIndexed;

    mapping(address => Staker) public stakers;

    mapping(uint256 => address) public stakerAddress;

    mapping(uint256 => StakingState) private stakingStates;

    event TokensStaked(address indexed staker, uint256[] indexed tokenIds);

    event TokensWithdrawn(address indexed staker, uint256[] indexed tokenIds);

    event RewardsClaimed(address indexed staker, uint256 rewardAmount);

    event UpdatedTimeUnit(uint256 oldTimeUnit, uint256 newTimeUnit);

    event UpdatedRewardsPerUnitTime(
        uint256 oldRewardsPerUnitTime,
        uint256 newRewardsPerUnitTime
    );

    constructor(address _stakingToken, address _rewardToken) ReentrancyGuard() {
        require(
            address(_stakingToken) != address(0),
            "ilmtNFTStaking: invalid staking address"
        );
        require(
            address(_rewardToken) != address(0),
            "ilmtNFTStaking: invalid reward address"
        );
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    function stake(uint256[] calldata _tokenIds) external nonReentrant {
        _stake(_tokenIds);
    }

    function withdraw(uint256[] calldata _tokenIds) external nonReentrant {
        _withdraw(_tokenIds);
    }

    function claimRewards() external nonReentrant {
        _claimRewards();
    }

    function withdrawRewardToken(
        uint256 _amount
    ) external onlyRole(ADMIN_ROLE) {
        uint256 rewardTokenBalance = getRewardTokenBalance();
        require(
            rewardTokenBalance >= _amount,
            "ilmtNFTStaking: insufficient reward balance"
        );

        IERC20(rewardToken).transfer(msg.sender, _amount);
    }

    function setTimeUnit(uint256 _timeUnit) external onlyRole(ADMIN_ROLE) {
        StakingState memory stakingState = stakingStates[nextStakeId - 1];
        require(
            _timeUnit != stakingState.timeUnit,
            "ilmtNFTStaking: time unit unchanged"
        );

        _setStakingStatus(_timeUnit, stakingState.rewardsPerUnitTime);

        emit UpdatedTimeUnit(stakingState.timeUnit, _timeUnit);
    }

    function setRewardsPerUnitTime(
        uint256 _rewardsPerUnitTime
    ) external onlyRole(ADMIN_ROLE) {
        StakingState memory stakingState = stakingStates[nextStakeId - 1];
        require(
            _rewardsPerUnitTime != stakingState.rewardsPerUnitTime,
            "ilmtNFTStaking: reward unchanged."
        );

        _setStakingStatus(stakingState.timeUnit, _rewardsPerUnitTime);

        emit UpdatedRewardsPerUnitTime(
            stakingState.rewardsPerUnitTime,
            _rewardsPerUnitTime
        );
    }

    function getStakeInfo(
        address _staker
    ) external view returns (uint256[] memory _tokensStaked, uint256 _rewards) {
        uint256[] memory _indexedTokens = indexedTokens;
        bool[] memory _isStakerToken = new bool[](_indexedTokens.length);
        uint256 indexedTokenCount = _indexedTokens.length;
        uint256 stakerTokenCount = 0;

        for (uint256 i = 0; i < indexedTokenCount; i++) {
            _isStakerToken[i] = stakerAddress[_indexedTokens[i]] == _staker;
            if (_isStakerToken[i]) stakerTokenCount += 1;
        }

        _tokensStaked = new uint256[](stakerTokenCount);
        uint256 count = 0;
        for (uint256 i = 0; i < indexedTokenCount; i++) {
            if (_isStakerToken[i]) {
                _tokensStaked[count] = _indexedTokens[i];
                count += 1;
            }
        }

        _rewards = _availableRewards(_staker);
    }

    function getTimeUnit() public view returns (uint256 _timeUnit) {
        _timeUnit = stakingStates[nextStakeId - 1].timeUnit;
    }

    function getRewardsPerUnitTime()
        public
        view
        returns (uint256 _rewardsPerUnitTime)
    {
        _rewardsPerUnitTime = stakingStates[nextStakeId - 1].rewardsPerUnitTime;
    }

    function _stake(uint256[] calldata _tokenIds) internal {
        uint64 len = uint64(_tokenIds.length);
        require(len != 0, "ilmtNFTStaking: invalid token ids");

        address _stakingToken = stakingToken;

        if (stakers[msg.sender].amountStaked > 0) {
            _updateUnclaimedRewardsForStaker(msg.sender);
        } else {
            stakersArray.push(msg.sender);
            stakers[msg.sender].timeOfLastUpdate = uint128(block.timestamp);
            stakers[msg.sender].stakeIdOflastUpdate = nextStakeId - 1;
        }
        for (uint256 i = 0; i < len; ++i) {
            IERC721(_stakingToken).safeTransferFrom(
                msg.sender,
                address(this),
                _tokenIds[i]
            );

            stakerAddress[_tokenIds[i]] = msg.sender;

            if (!isIndexed[_tokenIds[i]]) {
                isIndexed[_tokenIds[i]] = true;
                indexedTokens.push(_tokenIds[i]);
            }
        }
        stakers[msg.sender].amountStaked += len;

        emit TokensStaked(msg.sender, _tokenIds);
    }

    function _withdraw(uint256[] calldata _tokenIds) internal {
        uint256 _amountStaked = stakers[msg.sender].amountStaked;
        uint64 len = uint64(_tokenIds.length);
        require(len != 0, "ilmtNFTStaking: withdrawing 0 tokens");
        require(
            _amountStaked >= len,
            "ilmtNFTStaking: withdrawing more than staked"
        );

        address _stakingToken = stakingToken;

        _updateUnclaimedRewardsForStaker(msg.sender);

        if (_amountStaked == len) {
            address[] memory _stakersArray = stakersArray;
            for (uint256 i = 0; i < _stakersArray.length; ++i) {
                if (_stakersArray[i] == msg.sender) {
                    stakersArray[i] = _stakersArray[_stakersArray.length - 1];
                    stakersArray.pop();
                    break;
                }
            }
        }
        stakers[msg.sender].amountStaked -= len;

        for (uint256 i = 0; i < len; ++i) {
            require(
                stakerAddress[_tokenIds[i]] == msg.sender,
                "ilmtNFTStaking: not staker"
            );
            stakerAddress[_tokenIds[i]] = address(0);
            IERC721(_stakingToken).safeTransferFrom(
                address(this),
                msg.sender,
                _tokenIds[i]
            );
        }

        emit TokensWithdrawn(msg.sender, _tokenIds);
    }

    function _claimRewards() internal {
        uint256 rewards = stakers[msg.sender].unclaimedRewards +
            _calculateRewards(msg.sender);

        require(rewards != 0, "ilmtNFTStaking: no rewards");

        stakers[msg.sender].timeOfLastUpdate = uint128(block.timestamp);
        stakers[msg.sender].unclaimedRewards = 0;
        stakers[msg.sender].stakeIdOflastUpdate = nextStakeId - 1;

        _mintRewards(msg.sender, rewards);

        emit RewardsClaimed(msg.sender, rewards);
    }

    function _availableRewards(
        address _user
    ) internal view returns (uint256 _rewards) {
        if (stakers[_user].amountStaked == 0) {
            _rewards = stakers[_user].unclaimedRewards;
        } else {
            _rewards =
                stakers[_user].unclaimedRewards +
                _calculateRewards(_user);
        }
    }

    function _updateUnclaimedRewardsForStaker(address _staker) internal {
        uint256 rewards = _calculateRewards(_staker);
        stakers[_staker].unclaimedRewards += rewards;
        stakers[_staker].timeOfLastUpdate = uint128(block.timestamp);
        stakers[_staker].stakeIdOflastUpdate = nextStakeId - 1;
    }

    function _setStakingStatus(
        uint256 _timeUnit,
        uint256 _rewardsPerUnitTime
    ) internal {
        require(_timeUnit != 0, "time-unit can't be 0");
        uint256 stakeId = nextStakeId;
        nextStakeId += 1;

        stakingStates[stakeId] = StakingState({
            timeUnit: _timeUnit,
            rewardsPerUnitTime: _rewardsPerUnitTime,
            startTimestamp: block.timestamp,
            endTimestamp: 0
        });

        if (stakeId > 0) {
            stakingStates[stakeId - 1].endTimestamp = block.timestamp;
        }
    }

    function _calculateRewards(
        address _staker
    ) internal view returns (uint256 _rewards) {
        Staker memory staker = stakers[_staker];

        uint256 _stakerStakeId = staker.stakeIdOflastUpdate;
        uint256 _nextStakeId = nextStakeId;

        for (uint256 i = _stakerStakeId; i < _nextStakeId; i += 1) {
            StakingState memory stakingState = stakingStates[i];

            uint256 startTime = i != _stakerStakeId
                ? stakingState.startTimestamp
                : staker.timeOfLastUpdate;
            uint256 endTime = stakingState.endTimestamp != 0
                ? stakingState.endTimestamp
                : block.timestamp;

            (bool noOverflowProduct, uint256 rewardsProduct) = SafeMath.tryMul(
                (endTime - startTime) * staker.amountStaked,
                stakingState.rewardsPerUnitTime
            );
            (bool noOverflowSum, uint256 rewardsSum) = SafeMath.tryAdd(
                _rewards,
                rewardsProduct / stakingState.timeUnit
            );

            _rewards = noOverflowProduct && noOverflowSum
                ? rewardsSum
                : _rewards;
        }
    }

    function getRewardTokenBalance() public view returns (uint256) {
        return IERC20(rewardToken).balanceOf(address(this));
    }

    function _mintRewards(address _staker, uint256 _rewards) internal {
        uint256 rewardTokenBalance = getRewardTokenBalance();
        require(
            rewardTokenBalance >= _rewards,
            "ilmtNFTStaking: insufficient reward balance"
        );

        IERC20(rewardToken).transfer(_staker, _rewards);
    }
}
