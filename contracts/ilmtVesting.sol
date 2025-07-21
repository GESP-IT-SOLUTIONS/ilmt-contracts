// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title ILMTVesting
 * @dev A vesting contract for ILMT tokens with support for multiple vesting schedules,
 * cliff periods, and revocable vesting. Supports batch operations and emergency pause.
 */
contract ILMTVesting is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // Constants
    uint256 public constant MAX_BATCH_SIZE = 100; // Maximum number of vesting schedules per batch
    
    /**
     * @dev Represents a vesting schedule for a beneficiary
     * @param beneficiary Address of the beneficiary
     * @param cliff Timestamp when cliff period ends
     * @param start Timestamp when vesting starts
     * @param duration Total duration of vesting in seconds
     * @param slicePeriodSeconds Duration of each vesting slice in seconds
     * @param revocable Whether the vesting schedule can be revoked
     * @param amountTotal Total amount of tokens to be vested
     * @param released Amount of tokens already released
     * @param revoked Whether the vesting schedule has been revoked
     */
    struct VestingSchedule {
        address beneficiary;
        uint256 cliff;
        uint256 start;
        uint256 duration;
        uint256 slicePeriodSeconds;
        bool revocable;
        uint256 amountTotal;
        uint256 released;
        bool revoked;
    }

    /**
     * @dev Parameters for creating a vesting schedule
     * @param beneficiary Address of the beneficiary
     * @param start Timestamp when vesting starts
     * @param cliff Cliff period duration in seconds
     * @param duration Total duration of vesting in seconds
     * @param slicePeriodSeconds Duration of each vesting slice in seconds
     * @param revocable Whether the vesting schedule can be revoked
     * @param amount Total amount of tokens to be vested
     */
    struct CreateVestingScheduleParam {
        address beneficiary;
        uint256 start;
        uint256 cliff;
        uint256 duration;
        uint256 slicePeriodSeconds;
        bool revocable;
        uint256 amount;
    }

    // Events
    event VestingScheduleCreated(
        bytes32 indexed vestingScheduleId,
        address indexed beneficiary,
        uint256 amount,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 slicePeriodSeconds,
        bool revocable
    );
    
    event TokensReleased(
        bytes32 indexed vestingScheduleId,
        address indexed beneficiary,
        uint256 amount
    );
    
    event VestingScheduleRevoked(
        bytes32 indexed vestingScheduleId,
        address indexed beneficiary,
        uint256 releasedAmount,
        uint256 revokedAmount
    );
    
    event TokensWithdrawn(address indexed owner, uint256 amount);
    
    event ContractPaused(address indexed by);
    event ContractUnpaused(address indexed by);

    IERC20 public immutable token;

    bytes32[] private vestingSchedulesIds;
    mapping(bytes32 => VestingSchedule) private vestingSchedules;
    uint256 private vestingSchedulesTotalAmount;
    mapping(address => uint256) private holdersVestingCount;

    modifier onlyIfVestingScheduleNotRevoked(bytes32 vestingScheduleId) {
        require(!vestingSchedules[vestingScheduleId].revoked, "ILMTVesting: vesting schedule is revoked");
        _;
    }

    /**
     * @dev Contract constructor
     * @param token_ Address of the ERC20 token to be vested
     */
    constructor(address token_) {
        require(token_ != address(0x0), "ILMTVesting: invalid token address");
        token = IERC20(token_);
    }

    /**
     * @dev Creates multiple vesting schedules in a single transaction
     * @param params Array of vesting schedule parameters
     * @notice Maximum batch size is limited to prevent gas limit issues
     */
    function createVestingSchedule(
        CreateVestingScheduleParam[] memory params
    ) external onlyOwner whenNotPaused {
        require(params.length > 0, "ILMTVesting: empty params array");
        require(params.length <= MAX_BATCH_SIZE, "ILMTVesting: batch size exceeds limit");
        for (uint i = 0; i < params.length; i++) {
            CreateVestingScheduleParam memory schedule = params[i];
            require(
                schedule.beneficiary != address(0),
                "ILMTVesting: beneficiary cannot be zero address"
            );
            require(
                getWithdrawableAmount() >= schedule.amount,
                "ILMTVesting: cannot create vesting schedule because not sufficient tokens"
            );
            require(schedule.duration > 0, "ILMTVesting: duration must be > 0");
            require(schedule.amount > 0, "ILMTVesting: amount must be > 0");
            require(
                schedule.slicePeriodSeconds >= 1,
                "ILMTVesting: slicePeriodSeconds must be >= 1"
            );
            require(
                schedule.duration >= schedule.cliff,
                "ILMTVesting: duration must be >= cliff"
            );
            require(
                schedule.slicePeriodSeconds <= schedule.duration,
                "ILMTVesting: slicePeriodSeconds must be <= duration"
            );
            
            bytes32 vestingScheduleId = computeNextVestingScheduleIdForHolder(
                schedule.beneficiary
            );
            uint256 cliff = schedule.start + schedule.cliff;
            
            vestingSchedules[vestingScheduleId] = VestingSchedule(
                schedule.beneficiary,
                cliff,
                schedule.start,
                schedule.duration,
                schedule.slicePeriodSeconds,
                schedule.revocable,
                schedule.amount,
                0,
                false
            );
            vestingSchedulesTotalAmount =
                vestingSchedulesTotalAmount +
                schedule.amount;
            vestingSchedulesIds.push(vestingScheduleId);
            uint256 currentVestingCount = holdersVestingCount[
                schedule.beneficiary
            ];
            holdersVestingCount[schedule.beneficiary] = currentVestingCount + 1;
            
            emit VestingScheduleCreated(
                vestingScheduleId,
                schedule.beneficiary,
                schedule.amount,
                schedule.start,
                schedule.cliff,
                schedule.duration,
                schedule.slicePeriodSeconds,
                schedule.revocable
            );
        }
    }

    /**
     * @dev Revokes a vesting schedule, releasing any vested tokens to the beneficiary
     * @param vestingScheduleId The ID of the vesting schedule to revoke
     * @notice Only revocable vesting schedules can be revoked
     */
    function revoke(
        bytes32 vestingScheduleId
    ) external onlyOwner whenNotPaused onlyIfVestingScheduleNotRevoked(vestingScheduleId) {
        VestingSchedule storage vestingSchedule = vestingSchedules[
            vestingScheduleId
        ];
        require(
            vestingSchedule.revocable,
            "ILMTVesting: vesting is not revocable"
        );
        uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);
        uint256 releasedAmount = 0;
        
        if (vestedAmount > 0) {
            releasedAmount = vestedAmount;
            release(vestingScheduleId, vestedAmount);
        }
        
        uint256 unreleased = vestingSchedule.amountTotal -
            vestingSchedule.released;
        vestingSchedulesTotalAmount = vestingSchedulesTotalAmount - unreleased;
        vestingSchedule.revoked = true;
        
        emit VestingScheduleRevoked(
            vestingScheduleId,
            vestingSchedule.beneficiary,
            releasedAmount,
            unreleased
        );
    }

    /**
     * @dev Allows the owner to withdraw tokens not allocated to vesting schedules
     * @param amount The amount of tokens to withdraw
     * @notice Only withdrawable tokens (not allocated to vesting) can be withdrawn
     */
    function withdraw(uint256 amount) external nonReentrant onlyOwner whenNotPaused {
        require(
            getWithdrawableAmount() >= amount,
            "ILMTVesting: not enough withdrawable funds"
        );

        token.safeTransfer(msg.sender, amount);
        emit TokensWithdrawn(msg.sender, amount);
    }

    /**
     * @dev Releases vested tokens to the beneficiary
     * @param vestingScheduleId The ID of the vesting schedule
     * @param amount The amount of tokens to release
     * @notice Can be called by the beneficiary or the owner
     */
    function release(
        bytes32 vestingScheduleId,
        uint256 amount
    ) public nonReentrant whenNotPaused onlyIfVestingScheduleNotRevoked(vestingScheduleId) {
        VestingSchedule storage vestingSchedule = vestingSchedules[
            vestingScheduleId
        ];
        bool isBeneficiary = msg.sender == vestingSchedule.beneficiary;

        bool isReleasor = (msg.sender == owner());
        require(
            isBeneficiary || isReleasor,
            "ILMTVesting: only beneficiary and owner can release vested tokens"
        );
        uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);
        require(
            vestedAmount >= amount,
            "ILMTVesting: cannot release tokens, not enough vested tokens"
        );
        vestingSchedule.released = vestingSchedule.released + amount;
        address payable beneficiaryPayable = payable(
            vestingSchedule.beneficiary
        );
        vestingSchedulesTotalAmount = vestingSchedulesTotalAmount - amount;
        token.safeTransfer(beneficiaryPayable, amount);
        
        emit TokensReleased(vestingScheduleId, vestingSchedule.beneficiary, amount);
    }

    /**
     * @dev Pauses the contract, preventing all token operations
     * @notice Only the owner can pause the contract
     */
    function pause() external onlyOwner {
        _pause();
        emit ContractPaused(msg.sender);
    }

    /**
     * @dev Unpauses the contract, allowing token operations to resume
     * @notice Only the owner can unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Returns the number of vesting schedules for a beneficiary
     * @param _beneficiary The address of the beneficiary
     * @return The number of vesting schedules
     */
    function getVestingSchedulesCountByBeneficiary(
        address _beneficiary
    ) external view returns (uint256) {
        return holdersVestingCount[_beneficiary];
    }

    /**
     * @dev Returns the vesting schedule ID at the given index
     * @param index The index of the vesting schedule
     * @return The vesting schedule ID
     */
    function getVestingIdAtIndex(
        uint256 index
    ) external view returns (bytes32) {
        require(
            index < getVestingSchedulesCount(),
            "ILMTVesting: index out of bounds"
        );
        return vestingSchedulesIds[index];
    }

    /**
     * @dev Returns the vesting schedule for a beneficiary at a specific index
     * @param holder The address of the beneficiary
     * @param index The index of the vesting schedule
     * @return The vesting schedule
     */
    function getVestingScheduleByAddressAndIndex(
        address holder,
        uint256 index
    ) external view returns (VestingSchedule memory) {
        return
            getVestingSchedule(
                computeVestingScheduleIdForAddressAndIndex(holder, index)
            );
    }

    /**
     * @dev Returns the total amount of tokens allocated to all vesting schedules
     * @return The total amount of tokens in vesting schedules
     */
    function getVestingSchedulesTotalAmount() external view returns (uint256) {
        return vestingSchedulesTotalAmount;
    }

    /**
     * @dev Returns the total number of vesting schedules
     * @return The total number of vesting schedules
     */
    function getVestingSchedulesCount() public view returns (uint256) {
        return vestingSchedulesIds.length;
    }

    /**
     * @dev Computes the releasable amount for a vesting schedule
     * @param vestingScheduleId The ID of the vesting schedule
     * @return The amount of tokens that can be released
     */
    function computeReleasableAmount(
        bytes32 vestingScheduleId
    )
        external
        view
        onlyIfVestingScheduleNotRevoked(vestingScheduleId)
        returns (uint256)
    {
        VestingSchedule storage vestingSchedule = vestingSchedules[
            vestingScheduleId
        ];
        return _computeReleasableAmount(vestingSchedule);
    }

    /**
     * @dev Returns the vesting schedule for a given ID
     * @param vestingScheduleId The ID of the vesting schedule
     * @return The vesting schedule
     */
    function getVestingSchedule(
        bytes32 vestingScheduleId
    ) public view returns (VestingSchedule memory) {
        return vestingSchedules[vestingScheduleId];
    }

    /**
     * @dev Returns the amount of tokens available for withdrawal by the owner
     * @return The amount of tokens not allocated to vesting schedules
     */
    function getWithdrawableAmount() public view returns (uint256) {
        return token.balanceOf(address(this)) - vestingSchedulesTotalAmount;
    }

    /**
     * @dev Computes the next vesting schedule ID for a beneficiary
     * @param holder The address of the beneficiary
     * @return The next vesting schedule ID
     */
    function computeNextVestingScheduleIdForHolder(
        address holder
    ) public view returns (bytes32) {
        return
            computeVestingScheduleIdForAddressAndIndex(
                holder,
                holdersVestingCount[holder]
            );
    }

    /**
     * @dev Returns the last vesting schedule for a beneficiary
     * @param holder The address of the beneficiary
     * @return The last vesting schedule
     */
    function getLastVestingScheduleForHolder(
        address holder
    ) external view returns (VestingSchedule memory) {
        return
            vestingSchedules[
                computeVestingScheduleIdForAddressAndIndex(
                    holder,
                    holdersVestingCount[holder] - 1
                )
            ];
    }

    /**
     * @dev Computes the vesting schedule ID for a beneficiary at a specific index
     * @param holder The address of the beneficiary
     * @param index The index of the vesting schedule
     * @return The vesting schedule ID
     */
    function computeVestingScheduleIdForAddressAndIndex(
        address holder,
        uint256 index
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(holder, index));
    }

    /**
     * @dev Returns all vesting schedules for a beneficiary
     * @param holder The address of the beneficiary
     * @return schedules Array of vesting schedules
     */
    function getAllVestingSchedulesForBeneficiary(
        address holder
    ) external view returns (VestingSchedule[] memory schedules) {
        uint256 count = holdersVestingCount[holder];
        schedules = new VestingSchedule[](count);
        
        for (uint256 i = 0; i < count; i++) {
            bytes32 scheduleId = computeVestingScheduleIdForAddressAndIndex(holder, i);
            schedules[i] = vestingSchedules[scheduleId];
        }
    }

    /**
     * @dev Returns all vesting schedule IDs for a beneficiary
     * @param holder The address of the beneficiary
     * @return scheduleIds Array of vesting schedule IDs
     */
    function getAllVestingScheduleIdsForBeneficiary(
        address holder
    ) external view returns (bytes32[] memory scheduleIds) {
        uint256 count = holdersVestingCount[holder];
        scheduleIds = new bytes32[](count);
        
        for (uint256 i = 0; i < count; i++) {
            scheduleIds[i] = computeVestingScheduleIdForAddressAndIndex(holder, i);
        }
    }

    /**
     * @dev Returns the total releasable amount for a beneficiary across all their vesting schedules
     * @param holder The address of the beneficiary
     * @return totalReleasable The total amount that can be released
     */
    function getTotalReleasableAmountForBeneficiary(
        address holder
    ) external view returns (uint256 totalReleasable) {
        uint256 count = holdersVestingCount[holder];
        
        for (uint256 i = 0; i < count; i++) {
            bytes32 scheduleId = computeVestingScheduleIdForAddressAndIndex(holder, i);
            VestingSchedule storage schedule = vestingSchedules[scheduleId];
            
            if (!schedule.revoked) {
                totalReleasable += _computeReleasableAmount(schedule);
            }
        }
    }

    /**
     * @dev Returns the total vested amount for a beneficiary across all their vesting schedules
     * @param holder The address of the beneficiary
     * @return totalVested The total amount vested
     */
    function getTotalVestedAmountForBeneficiary(
        address holder
    ) external view returns (uint256 totalVested) {
        uint256 count = holdersVestingCount[holder];
        
        for (uint256 i = 0; i < count; i++) {
            bytes32 scheduleId = computeVestingScheduleIdForAddressAndIndex(holder, i);
            VestingSchedule storage schedule = vestingSchedules[scheduleId];
            
            if (!schedule.revoked) {
                totalVested += schedule.amountTotal;
            }
        }
    }

    /**
     * @dev Checks if a vesting schedule exists
     * @param vestingScheduleId The ID of the vesting schedule
     * @return exists True if the vesting schedule exists
     */
    function vestingScheduleExists(
        bytes32 vestingScheduleId
    ) external view returns (bool exists) {
        return vestingSchedules[vestingScheduleId].beneficiary != address(0);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Internal function to compute the releasable amount for a vesting schedule
     * @param vestingSchedule The vesting schedule
     * @return The amount of tokens that can be released
     */
    function _computeReleasableAmount(
        VestingSchedule memory vestingSchedule
    ) internal view returns (uint256) {
        uint256 currentTime = block.timestamp;
        if ((currentTime < vestingSchedule.cliff) || vestingSchedule.revoked) {
            return 0;
        } else if (
            currentTime >= vestingSchedule.start + vestingSchedule.duration
        ) {
            return vestingSchedule.amountTotal - vestingSchedule.released;
        } else {
            uint256 totalAmount = vestingSchedule.amountTotal;
            uint256 timeFromStart = currentTime - vestingSchedule.start;
            uint256 secondsPerSlice = vestingSchedule.slicePeriodSeconds;
            uint256 vestedSlicePeriods = timeFromStart / secondsPerSlice;
            uint256 vestedSeconds = vestedSlicePeriods * secondsPerSlice;
            uint256 vestedAmount = (totalAmount * vestedSeconds) /
                vestingSchedule.duration;
            return vestedAmount - vestingSchedule.released;
        }
    }
}
