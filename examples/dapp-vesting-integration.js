// Example: How to integrate ILMTVesting contract with a dApp frontend
// This shows all available methods to get user vesting information

import { ethers } from 'ethers';

// Contract ABI - only the view functions needed for dApp
const VESTING_ABI = [
  // Get count of vesting schedules for a user
  "function getVestingSchedulesCountByBeneficiary(address _beneficiary) external view returns (uint256)",
  
  // Get all vesting schedules for a user (complete data)
  "function getAllVestingSchedulesForBeneficiary(address holder) external view returns (tuple(address beneficiary, uint256 cliff, uint256 start, uint256 duration, uint256 slicePeriodSeconds, bool revocable, uint256 amountTotal, uint256 released, bool revoked)[] schedules)",
  
  // Get all vesting schedule IDs for a user
  "function getAllVestingScheduleIdsForBeneficiary(address holder) external view returns (bytes32[] scheduleIds)",
  
  // Get total amount that can be released now across all schedules
  "function getTotalReleasableAmountForBeneficiary(address holder) external view returns (uint256 totalReleasable)",
  
  // Get total amount vested across all schedules
  "function getTotalVestedAmountForBeneficiary(address holder) external view returns (uint256 totalVested)",
  
  // Get releasable amount for a specific schedule
  "function computeReleasableAmount(bytes32 vestingScheduleId) external view returns (uint256)",
  
  // Get specific vesting schedule by ID
  "function getVestingSchedule(bytes32 vestingScheduleId) external view returns (tuple(address beneficiary, uint256 cliff, uint256 start, uint256 duration, uint256 slicePeriodSeconds, bool revocable, uint256 amountTotal, uint256 released, bool revoked))",
  
  // Release tokens from a specific schedule
  "function release(bytes32 vestingScheduleId, uint256 amount) external"
];

class VestingDAppIntegration {
  constructor(contractAddress, provider) {
    this.contract = new ethers.Contract(contractAddress, VESTING_ABI, provider);
  }

  /**
   * Get complete vesting information for a user - MAIN FUNCTION FOR DAPP
   * @param {string} userAddress - User's wallet address
   * @returns {Object} Complete vesting information
   */
  async getUserVestingInfo(userAddress) {
    try {
      // 1. Get count of vesting schedules
      const scheduleCount = await this.contract.getVestingSchedulesCountByBeneficiary(userAddress);
      
      if (scheduleCount.toString() === '0') {
        return {
          hasVesting: false,
          schedules: [],
          totalVested: '0',
          totalReleasable: '0',
          summary: 'No vesting schedules found'
        };
      }

      // 2. Get all vesting schedules with complete data
      const schedules = await this.contract.getAllVestingSchedulesForBeneficiary(userAddress);
      
      // 3. Get totals
      const [totalVested, totalReleasable] = await Promise.all([
        this.contract.getTotalVestedAmountForBeneficiary(userAddress),
        this.contract.getTotalReleasableAmountForBeneficiary(userAddress)
      ]);

      // 4. Process and format schedules
      const processedSchedules = await this.processSchedules(schedules, userAddress);

      return {
        hasVesting: true,
        scheduleCount: scheduleCount.toString(),
        schedules: processedSchedules,
        totalVested: ethers.formatEther(totalVested),
        totalReleasable: ethers.formatEther(totalReleasable),
        summary: `${scheduleCount} vesting schedule(s) found`
      };

    } catch (error) {
      console.error('Error fetching vesting info:', error);
      throw error;
    }
  }

  /**
   * Process raw schedule data into user-friendly format
   * @param {Array} rawSchedules - Raw schedule data from contract
   * @param {string} userAddress - User address for computing schedule IDs
   * @returns {Array} Processed schedules
   */
  async processSchedules(rawSchedules, userAddress) {
    const processedSchedules = [];

    for (let i = 0; i < rawSchedules.length; i++) {
      const schedule = rawSchedules[i];
      
      // Compute schedule ID for this index
      const scheduleId = ethers.keccak256(
        ethers.solidityPacked(['address', 'uint256'], [userAddress, i])
      );

      // Get current releasable amount for this specific schedule
      let releasableAmount = '0';
      if (!schedule.revoked) {
        try {
          const releasable = await this.contract.computeReleasableAmount(scheduleId);
          releasableAmount = ethers.formatEther(releasable);
        } catch (error) {
          console.warn(`Could not get releasable amount for schedule ${i}:`, error);
        }
      }

      // Calculate progress
      const now = Math.floor(Date.now() / 1000);
      const startTime = Number(schedule.start);
      const endTime = startTime + Number(schedule.duration);
      const cliffTime = Number(schedule.cliff);
      
      let status = 'pending';
      let progress = 0;
      
      if (schedule.revoked) {
        status = 'revoked';
      } else if (now < cliffTime) {
        status = 'cliff_period';
        progress = Math.min(100, ((now - startTime) / (cliffTime - startTime)) * 100);
      } else if (now >= endTime) {
        status = 'completed';
        progress = 100;
      } else {
        status = 'vesting';
        progress = ((now - startTime) / (endTime - startTime)) * 100;
      }

      processedSchedules.push({
        index: i,
        scheduleId: scheduleId,
        // Basic info
        amountTotal: ethers.formatEther(schedule.amountTotal),
        released: ethers.formatEther(schedule.released),
        releasableNow: releasableAmount,
        remaining: ethers.formatEther(schedule.amountTotal - schedule.released),
        
        // Timing info
        startDate: new Date(startTime * 1000).toISOString(),
        cliffDate: new Date(cliffTime * 1000).toISOString(),
        endDate: new Date(endTime * 1000).toISOString(),
        slicePeriodHours: Number(schedule.slicePeriodSeconds) / 3600,
        
        // Status info
        status: status,
        progress: Math.round(progress),
        isRevocable: schedule.revocable,
        isRevoked: schedule.revoked,
        
        // Raw data (for advanced users)
        raw: {
          beneficiary: schedule.beneficiary,
          cliff: schedule.cliff.toString(),
          start: schedule.start.toString(),
          duration: schedule.duration.toString(),
          slicePeriodSeconds: schedule.slicePeriodSeconds.toString(),
          revocable: schedule.revocable,
          amountTotal: schedule.amountTotal.toString(),
          released: schedule.released.toString(),
          revoked: schedule.revoked
        }
      });
    }

    return processedSchedules;
  }

  /**
   * Get quick summary for dashboard display
   * @param {string} userAddress - User's wallet address
   * @returns {Object} Quick summary
   */
  async getQuickSummary(userAddress) {
    try {
      const [scheduleCount, totalVested, totalReleasable] = await Promise.all([
        this.contract.getVestingSchedulesCountByBeneficiary(userAddress),
        this.contract.getTotalVestedAmountForBeneficiary(userAddress),
        this.contract.getTotalReleasableAmountForBeneficiary(userAddress)
      ]);

      return {
        scheduleCount: scheduleCount.toString(),
        totalVested: ethers.formatEther(totalVested),
        totalReleasable: ethers.formatEther(totalReleasable),
        hasReleasableTokens: totalReleasable.toString() !== '0'
      };
    } catch (error) {
      console.error('Error fetching quick summary:', error);
      throw error;
    }
  }

  /**
   * Release tokens from a specific vesting schedule
   * @param {string} scheduleId - Vesting schedule ID
   * @param {string} amount - Amount to release (in wei)
   * @param {ethers.Signer} signer - Connected signer
   * @returns {Promise} Transaction result
   */
  async releaseFromSchedule(scheduleId, amount, signer) {
    try {
      const contractWithSigner = this.contract.connect(signer);
      const tx = await contractWithSigner.release(scheduleId, amount);
      return tx;
    } catch (error) {
      console.error('Error releasing tokens:', error);
      throw error;
    }
  }

  /**
   * Release all available tokens from all schedules
   * @param {string} userAddress - User's wallet address  
   * @param {ethers.Signer} signer - Connected signer
   * @returns {Promise} Array of transaction results
   */
  async releaseAllAvailable(userAddress, signer) {
    try {
      const scheduleIds = await this.contract.getAllVestingScheduleIdsForBeneficiary(userAddress);
      const transactions = [];
      
      for (const scheduleId of scheduleIds) {
        const releasableAmount = await this.contract.computeReleasableAmount(scheduleId);
        
        if (releasableAmount.toString() !== '0') {
          const tx = await this.releaseFromSchedule(scheduleId, releasableAmount, signer);
          transactions.push(tx);
        }
      }
      
      return transactions;
    } catch (error) {
      console.error('Error releasing all tokens:', error);
      throw error;
    }
  }
}

// Example usage in React/Vue/Angular component:
/*
const VestingComponent = () => {
  const [vestingInfo, setVestingInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const vestingContract = new VestingDAppIntegration(
    '0x...', // contract address
    provider
  );
  
  useEffect(() => {
    async function loadVestingInfo() {
      if (userAddress) {
        try {
          const info = await vestingContract.getUserVestingInfo(userAddress);
          setVestingInfo(info);
        } catch (error) {
          console.error('Failed to load vesting info:', error);
        } finally {
          setLoading(false);
        }
      }
    }
    
    loadVestingInfo();
  }, [userAddress]);
  
  const handleRelease = async (scheduleId, amount) => {
    try {
      const tx = await vestingContract.releaseFromSchedule(scheduleId, amount, signer);
      await tx.wait();
      // Refresh vesting info
      const updatedInfo = await vestingContract.getUserVestingInfo(userAddress);
      setVestingInfo(updatedInfo);
    } catch (error) {
      console.error('Release failed:', error);
    }
  };
  
  if (loading) return <div>Loading vesting information...</div>;
  
  if (!vestingInfo.hasVesting) {
    return <div>No vesting schedules found for this address.</div>;
  }
  
  return (
    <div>
      <h2>Your Vesting Schedules</h2>
      <p>Total Vested: {vestingInfo.totalVested} ILMT</p>
      <p>Available to Release: {vestingInfo.totalReleasable} ILMT</p>
      
      {vestingInfo.schedules.map((schedule, index) => (
        <div key={index} className="vesting-schedule">
          <h3>Schedule #{schedule.index + 1}</h3>
          <p>Total Amount: {schedule.amountTotal} ILMT</p>
          <p>Released: {schedule.released} ILMT</p>
          <p>Available Now: {schedule.releasableNow} ILMT</p>
          <p>Status: {schedule.status}</p>
          <p>Progress: {schedule.progress}%</p>
          
          {schedule.releasableNow !== '0' && (
            <button onClick={() => handleRelease(schedule.scheduleId, ethers.parseEther(schedule.releasableNow))}>
              Release {schedule.releasableNow} ILMT
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
*/

export default VestingDAppIntegration; 