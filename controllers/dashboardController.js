import { Types } from 'mongoose';
import Device from '../models/Device.js';
import Client from '../models/Client.js';
import Contract from '../models/Contract.js';
import RepairIncident from '../models/RepairIncident.js';
import BulkOperation from '../models/BulkOperation.js';

const getDashboardStats = async (req, res, next) => {
  try {
    const owner = req.user.id;
    const ownerObjectId = new Types.ObjectId(owner);

    const [
      totalDevices,
      statusGroups,
      totalClients,
      totalContracts,
      activeContracts,
      repairIncidents,
      recentActivity,
    ] = await Promise.all([
      Device.countDocuments({ owner, deletedAt: null }),

      Device.aggregate([
        { $match: { owner: ownerObjectId, deletedAt: null } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).then(results => {
        const map = {};
        results.forEach(r => { map[r._id] = r.count; });
        return map;
      }),

      Client.countDocuments({ owner }),

      Contract.countDocuments({ owner }),

      Contract.countDocuments({ owner, status: 'Active' }),

      RepairIncident.find({ owner }),

      BulkOperation.find({ owner })
        .sort({ timestamp: -1 })
        .limit(10)
        .lean(),
    ]);

    const deployed    = statusGroups['Deployed']      || 0;
    const spareDeployed = statusGroups['Spare Deployed'] || 0;
    const underRepair = statusGroups['Under Repair']  || 0;
    const inWarehouse = statusGroups['In Warehouse']  || 0;
    const inStock     = statusGroups['InStock']        || 0;
    const repaired    = statusGroups['Repaired']       || 0;
    const returned    = statusGroups['Returned']       || 0;
    const retired     = statusGroups['Retired']        || 0;

    const activeDevices = totalDevices - retired;
    const utilizationRate = activeDevices > 0
      ? Math.round(((deployed + spareDeployed) / activeDevices) * 100)
      : 0;

    const repairStats = computeRepairStats(repairIncidents);

    const procureToDeployDays = await computeProcureToDeploy(owner);

    const alerts = buildAlerts({
      underRepair,
      deployed,
      totalDevices,
      utilizationRate,
      activeDevices,
      retired,
      repairStats,
    });

    res.json({
      devices: {
        total:        totalDevices,
        deployed:     deployed + spareDeployed,
        underRepair,
        inWarehouse:  inWarehouse + inStock,
        repaired,
        returned,
        retired,
        utilizationRate,
        statusBreakdown: statusGroups,
      },
      clients:         totalClients,
      contracts:       { total: totalContracts, active: activeContracts },
      repairs:         repairStats,
      procureToDeployDays,
      recentActivity,
      alerts,
    });
  } catch (err) {
    next(err);
  }
};

function computeRepairStats(incidents) {
  const reported   = incidents.length;
  const pickedUp   = incidents.filter(i => i.pickupDate).length;
  const completed  = incidents.filter(i => i.repairCompletedDate).length;
  const diagnosed  = incidents.filter(i => i.diagnosticNotes).length;

  const completedIncidents = incidents.filter(
    i => i.repairCompletedDate && i.dateReported,
  );
  let avgRepairDays = 0;
  if (completedIncidents.length > 0) {
    const totalMs = completedIncidents.reduce((sum, i) => {
      return sum + (new Date(i.repairCompletedDate) - new Date(i.dateReported));
    }, 0);
    avgRepairDays = Math.round(totalMs / completedIncidents.length / 86400000);
  }

  const completionRate = reported > 0
    ? Math.round((completed / reported) * 100)
    : 0;

  return { reported, pickedUp, diagnosed, completed, avgRepairDays, completionRate };
}

async function computeProcureToDeploy(owner) {
  const ownerObjectId = new Types.ObjectId(owner);
  const deployedDevices = await Device.find({
    owner: ownerObjectId,
    deletedAt: null,
    'lifecycleEvents.eventType': 'deployment',
  }, 'createdAt lifecycleEvents');

  if (!deployedDevices.length) return null;

  const totalMs = deployedDevices.reduce((sum, device) => {
    const firstDeploy = device.lifecycleEvents
      .filter(e => e.eventType === 'deployment')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];
    if (!firstDeploy) return sum;
    return sum + (new Date(firstDeploy.timestamp) - new Date(device.createdAt));
  }, 0);

  return Math.round(totalMs / deployedDevices.length / 86400000);
}

function buildAlerts({ underRepair, deployed, totalDevices, utilizationRate, activeDevices, retired, repairStats }) {
  const alerts = [];

  if (underRepair > 0) {
    alerts.push({
      type: 'warning',
      icon: 'build',
      message: `${underRepair} device${underRepair === 1 ? '' : 's'} currently under repair`,
    });
  }
  if (utilizationRate < 50 && activeDevices > 0) {
    alerts.push({
      type: 'info',
      icon: 'inventory',
      message: `Low utilization rate: ${utilizationRate}% of devices are deployed`,
    });
  }
  if (repairStats.completionRate < 70 && repairStats.reported > 5) {
    alerts.push({
      type: 'warning',
      icon: 'warning',
      message: `Repair completion rate is ${repairStats.completionRate}% — ${repairStats.reported - repairStats.completed} pending`,
    });
  }
  if (retired > 0) {
    alerts.push({
      type: 'info',
      icon: 'archive',
      message: `${retired} device${retired === 1 ? '' : 's'} marked as retired`,
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      type: 'success',
      icon: 'check_circle',
      message: 'All systems operating normally',
    });
  }

  return alerts;
}

export { getDashboardStats };