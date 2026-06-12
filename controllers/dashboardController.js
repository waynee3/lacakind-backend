import { Types } from 'mongoose';
import Device from '../models/Device.js';
import Client from '../models/Client.js';
import Contract from '../models/Contract.js';
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

      BulkOperation.find({ owner })
        .sort({ timestamp: -1 })
        .limit(10)
        .lean(),
    ]);

    const deployed      = statusGroups['Deployed']       || 0;
    const spareDeployed = statusGroups['Spare Deployed']  || 0;
    const underRepair   = statusGroups['Under Repair']   || 0;
    const inWarehouse   = statusGroups['In Warehouse']   || 0;
    const inStock       = statusGroups['InStock']         || 0;
    const repaired      = statusGroups['Repaired']        || 0;
    const returned      = statusGroups['Returned']        || 0;
    const retired       = statusGroups['Retired']         || 0;

    const activeDevices   = totalDevices - retired;
    const utilizationRate = activeDevices > 0
      ? Math.round(((deployed + spareDeployed) / activeDevices) * 100)
      : 0;

    const repairStats = await computeRepairStats(ownerObjectId);

    const procureToDeployDays = await computeProcureToDeploy(owner);

    const alerts = buildAlerts({
      underRepair, deployed, totalDevices,
      utilizationRate, activeDevices, retired, repairStats,
    });

    res.json({
      devices: {
        total: totalDevices, deployed: deployed + spareDeployed,
        underRepair, inWarehouse: inWarehouse + inStock,
        repaired, returned, retired, utilizationRate,
        statusBreakdown: statusGroups,
      },
      clients:    totalClients,
      contracts:  { total: totalContracts, active: activeContracts },
      repairs:    repairStats,
      procureToDeployDays,
      recentActivity,
      alerts,
    });
  } catch (err) {
    next(err);
  }
};

async function computeRepairStats(ownerObjectId) {
  const devicesWithRepair = await Device.find(
    {
      owner: ownerObjectId,
      deletedAt: null,
      'lifecycleEvents.eventType': 'maintenancestart',
    },
    'lifecycleEvents',
  ).lean();

  let reported   = 0;
  let completed  = 0;
  let totalRepairMs = 0;

  for (const device of devicesWithRepair) {
    const events = device.lifecycleEvents || [];

    const starts = events
      .filter(e => e.eventType === 'maintenancestart')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const completes = events
      .filter(e => e.eventType === 'maintenancecomplete')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    reported += starts.length;

    let ci = 0;
    for (const start of starts) {
      while (ci < completes.length && new Date(completes[ci].timestamp) <= new Date(start.timestamp)) {
        ci++;
      }
      if (ci < completes.length) {
        completed++;
        totalRepairMs += new Date(completes[ci].timestamp) - new Date(start.timestamp);
        ci++;
      }
    }
  }

  const avgRepairDays = completed > 0
    ? Math.round(totalRepairMs / completed / 86400000)
    : 0;

  const completionRate = reported > 0
    ? Math.round((completed / reported) * 100)
    : 0;

  const currentlyUnderRepair = await Device.countDocuments({
    owner: ownerObjectId,
    status: { $in: ['Under Repair', 'Repaired'] },
    deletedAt: null,
  });

  return {
    reported,
    pickedUp:   currentlyUnderRepair,
    diagnosed:  currentlyUnderRepair,
    completed,
    avgRepairDays,
    completionRate,
  };
}

async function computeProcureToDeploy(owner) {
  const ownerObjectId = new Types.ObjectId(owner);
  const deployedDevices = await Device.find({
    owner: ownerObjectId,
    deletedAt: null,
    'lifecycleEvents.eventType': 'deployment',
  }, 'createdAt lifecycleEvents').lean();

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

function buildAlerts({ underRepair, utilizationRate, activeDevices, retired, repairStats }) {
  const alerts = [];

  if (underRepair > 0) {
    alerts.push({ type: 'warning', icon: 'build',
      message: `${underRepair} device${underRepair === 1 ? '' : 's'} currently under repair` });
  }
  if (utilizationRate < 50 && activeDevices > 0) {
    alerts.push({ type: 'info', icon: 'inventory',
      message: `Low utilization rate: ${utilizationRate}% of devices are deployed` });
  }
  if (repairStats.completionRate < 70 && repairStats.reported > 3) {
    alerts.push({ type: 'warning', icon: 'warning',
      message: `Repair completion rate is ${repairStats.completionRate}% — ${repairStats.reported - repairStats.completed} pending` });
  }
  if (retired > 0) {
    alerts.push({ type: 'info', icon: 'archive',
      message: `${retired} device${retired === 1 ? '' : 's'} marked as retired` });
  }
  if (alerts.length === 0) {
    alerts.push({ type: 'success', icon: 'check_circle',
      message: 'All systems operating normally' });
  }
  return alerts;
}

export { getDashboardStats };